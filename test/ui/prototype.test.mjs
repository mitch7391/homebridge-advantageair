import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { Draft, validate } from '../../homebridge-ui/public/draft.mjs';

const fixture = () => [
  { platform: 'AdvantageAir', name: 'Preserved log name', future: { nested: [1, 2] }, devices: [
    { name: 'Controller log A', homeName: 'Main Home', ipAddress: '192.0.2.1', excludedLightIds: ['light1'],
      things: [{ controllerId: 'synthetic-a', id: 'door1', type: 'gate', disabled: true, invert: true }] },
    { name: 'Controller log B', homeName: 'Things Only', ipAddress: '192.0.2.2', port: 10211, extra: { keep: true } },
  ] },
  { accessory: 'Other block', future: ['keep'] },
];
test('removing an incomplete newly added controller restores the exact prior draft', async () => {
  // Test callbacks run after the host helper declaration.
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  const api = host();
  const draft = new Draft(fixture(), api);
  await draft.addController();
  assert.equal(api.enabled, false);
  await draft.removeController(draft.keys.at(-1));
  assert.deepEqual(draft.snapshot(), fixture());
  assert.equal(api.enabled, true);
});

test('UI offers direct addition and independent keyed close buttons, without confirmation', async () => {
  const source = await readFile(new URL('../../homebridge-ui/public/app.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Confirm addition|Confirm removal|confirmation/);
  assert.match(source, /draft.addController\(\)/);
  assert.match(source, /draft.removeController\(key\)/);
  assert.match(source, /input.required = true/);
});

test('presentation uses the native schema styling scope and accessible switch decoration', async () => {
  const source = await readFile(new URL('../../homebridge-ui/public/app.mjs', import.meta.url), 'utf8');
  const html = await readFile(new URL('../../homebridge-ui/public/index.html', import.meta.url), 'utf8');
  assert.match(html, /class="prototype ng-bs5-validate"/);
  assert.match(html, /<ul id="tabs" class="nav nav-tabs"/);
  assert.match(source, /createElement\('li'\)/);
  assert.match(source, /add.textContent = 'Add Controller'/);
  assert.match(source, /'hb-uix-switch'/);
  assert.match(source, /graphic.className = 'hb-uix-slider hb-uix-round'/);
  assert.match(source, /graphic.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(html, /input:focus-visible ~ \.hb-uix-slider/);
  assert.match(html, /flex-wrap: nowrap/);
  assert.match(html, /\.controller-tab \.nav-link \{[^}]*background: transparent/);
  assert.doesNotMatch(html, /border-color: #555 #555|form-check-input:not\(:checked\)/);
});
function host(update = async () => {}) {
  return { enabled: false, calls: [], enableSaveButton() {
    this.enabled = true;
  },
  disableSaveButton() {
    this.enabled = false;
  },
  async updatePluginConfig(config) {
    this.calls.push(config); return update(config);
  } };
}

test('opening, selecting and collapsing preserve complete JSON without updating host', () => {
  const original = fixture();
  const api = host();
  const draft = new Draft(original, api);
  draft.select(1);
  draft.toggleThings(true);
  draft.toggleThings(false);
  draft.select(0);
  assert.deepEqual(draft.snapshot(), original);
  assert.deepEqual(api.calls, []);
  assert.equal(api.enabled, true);
  assert.equal(Object.hasOwn(draft.block().devices[0], 'port'), false);
});

test('editing one field preserves hidden, future, sparse and other-block values', async () => {
  const original = fixture();
  const api = host();
  const draft = new Draft(original, api);
  await draft.edit('homeName', 'New name');
  const expected = fixture();
  expected[0].devices[0].homeName = 'New name';
  assert.deepEqual(draft.snapshot(), expected);
  assert.deepEqual(api.calls.at(-1), expected);
  assert.deepEqual(original, fixture());
});

test('controller switching retains unsaved edits and integer Fujitsu port', async () => {
  const draft = new Draft(fixture(), host());
  await draft.edit('port', 10211);
  draft.select(1);
  await draft.edit('homeName', 'Other name');
  draft.select(0);
  assert.equal(draft.block().devices[0].port, 10211);
  assert.equal(draft.block().devices[1].homeName, 'Other name');
  assert.equal(validate(draft.block()), '');
});

test('serialized rapid updates ignore stale responses and enable Save only at latest revision', async () => {
  const releases = [];
  const api = host(config => new Promise(resolve => releases.push(() => resolve(config))));
  const draft = new Draft(fixture(), api);
  const pending = draft.edit('homeName', 'First');
  draft.select(1);
  draft.edit('homeName', 'Second');
  draft.edit('debug', true, true);
  assert.equal(api.calls.length, 1);
  assert.equal(api.enabled, false);
  releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(api.calls.length, 2);
  assert.equal(api.enabled, false);
  releases.shift()();
  await pending;
  assert.deepEqual(api.calls.at(-1), draft.snapshot());
  assert.equal(draft.block().devices[1].homeName, 'Second');
  assert.equal(api.enabled, true);
});

test('invalid values block host updates and recover when corrected', async () => {
  for (const [field, value] of [['port', 0], ['port', 65536], ['port', 1.5], ['port', null],
    ['ipAddress', ''], ['ipAddress', '999.0.0.1'], ['ipAddress', '01.2.3.4'], ['zoneControlType', 'other']]) {
    const api = host();
    const draft = new Draft(fixture(), api);
    await draft.edit(field, value);
    assert.equal(api.enabled, false);
    assert.equal(api.calls.length, 0);
    await draft.edit(field, field === 'port' ? 10211 : field === 'ipAddress' ? '192.0.2.1' : 'fans');
    assert.equal(api.enabled, true);
  }
});

test('failed update fails closed without replay or automatic disk save', async () => {
  const api = host(async () => {
    throw new Error('Host unavailable');
  });
  const draft = new Draft(fixture(), api);
  await draft.edit('debug', true);
  await draft.edit('debug', false);
  assert.equal(api.calls.length, 1);
  assert.equal(api.enabled, false);
});

test('global edits leave controller logging unchanged and snapshots cannot mutate draft', async () => {
  const draft = new Draft(fixture(), host());
  await draft.edit('debug', true, true);
  const snapshot = draft.snapshot();
  snapshot[0].devices[0].things = [];
  assert.deepEqual(draft.block().devices, fixture()[0].devices);
});

test('unsupported structure and fields fail without reconstructing saved configuration', () => {
  assert.deepEqual(new Draft([], host()).snapshot(), []);
  assert.throws(() => new Draft([fixture()[0], fixture()[0]], host()));
  const draft = new Draft(fixture(), host());
  assert.throws(() => draft.edit('things', []));
  assert.throws(() => draft.select(9));
  assert.deepEqual(draft.snapshot(), fixture());
});

test('empty configuration remains absent until explicit first addition; no HVAC assumption', async () => {
  const api = host();
  const draft = new Draft([], api);
  assert.deepEqual(api.calls, []);
  assert.equal(api.enabled, false);
  await draft.addController();
  assert.equal(api.calls.length, 0);
  await draft.edit('ipAddress', '192.0.2.10');
  await draft.edit('port', 10211);
  assert.deepEqual(draft.snapshot(), [{ platform: 'AdvantageAir', name: 'Homebridge Advantage Air',
    devices: [{ homeName: 'Aircon', ipAddress: '192.0.2.10', port: 10211 }] }]);
  assert.equal(api.enabled, true);
});

test('add and remove preserve remaining full objects, order and stable UI keys', async () => {
  const draft = new Draft(fixture(), host());
  const firstKey = draft.keys[0];
  const secondKey = draft.keys[1];
  await draft.addController();
  await draft.edit('ipAddress', '192.0.2.3');
  const third = draft.block().devices[2];
  await draft.removeController(firstKey);
  assert.deepEqual(draft.block().devices, [fixture()[0].devices[1], third]);
  assert.equal(draft.keys[0], secondKey);
  assert.equal(draft.selected, 1);
  assert.deepEqual(draft.snapshot()[1], fixture()[1]);
  assert.throws(() => draft.removeController(firstKey));
});

test('removing final controller disables Save rather than violating minItems', async () => {
  const api = host();
  const draft = new Draft([fixture()[0]], api);
  await draft.removeController(draft.keys[1]);
  await draft.removeController(draft.keys[0]);
  assert.equal(api.enabled, false);
  assert.deepEqual(draft.block().devices, []);
  await draft.addController();
  await draft.edit('ipAddress', '192.0.2.4');
  assert.equal(api.enabled, true);
});

test('management while an update is pending serializes the newest complete snapshot', async () => {
  const releases = [];
  const api = host(config => new Promise(resolve => releases.push(() => resolve(config))));
  const draft = new Draft(fixture(), api);
  const pending = draft.edit('homeName', 'Changed');
  draft.addController();
  draft.edit('ipAddress', '192.0.2.8');
  draft.removeController(draft.keys[1]);
  releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  releases.shift()();
  await pending;
  assert.deepEqual(api.calls.at(-1), draft.snapshot());
  assert.equal(api.enabled, true);
  assert.deepEqual(draft.block().devices[0].things, fixture()[0].devices[0].things);
});

test('an edit at flush completion is delivered rather than left pending forever', async () => {
  let injected = false;
  class BoundaryDraft extends Draft {
    async flush() {
      await super.flush();
      if (!injected) {
        injected = true;
        this.edit('homeName', 'Boundary edit');
      }
    }
  }
  const api = host();
  const draft = new BoundaryDraft(fixture(), api);
  await draft.edit('homeName', 'First edit');
  await draft.pending;
  assert.equal(api.calls.at(-1)[0].devices[0].homeName, 'Boundary edit');
  assert.equal(api.calls.length, 2);
  assert.equal(api.enabled, true);
});
