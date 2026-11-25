import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { ThingSelection, thingCards } from '../../homebridge-ui/public/discovery.mjs';
import { Draft, DraftStatusPresentation } from '../../homebridge-ui/public/draft.mjs';

const observation = id => ({ id, controllerId: 'mid', name: 'Same name', capability: 'garage-gate-capable', status: 'needs-type' });
const result = things => ({ status: 'present', things });
const fixture = () => [{ platform: 'AdvantageAir', name: 'Log', future: true, devices: [
  { ipAddress: '192.0.2.1', hidden: 7, things: [{ controllerId: 'mid', id: 'a', invert: true, disabled: true }] },
  { ipAddress: '192.0.2.2', things: [{ controllerId: 'other', id: 'a', type: 'gate' }] },
] }, { platform: 'Other', keep: true }];
const api = () => ({ enableSaveButton() {}, disableSaveButton() {}, async updatePluginConfig() {} });

test('named large inventories retain independent identity selection across rename and reorder', () => {
  const state = new ThingSelection();
  const source = Array.from({ length: 25 }, (_, i) => observation(String(i)));
  const cards = thingCards(result(source));
  assert.equal(cards.length, 25);
  assert.equal(new Set(cards.map(t => t.key)).size, 25);
  state.choose(1, cards[10].key);
  state.choose(2, cards[2].key);
  const changed = thingCards(result(source.reverse().map(t => ({ ...t, name: 'Renamed' }))));
  assert.equal(state.current(1, changed), cards[10].key);
  assert.equal(state.current(2, changed), cards[2].key);
  assert.equal(state.current(1, []), undefined);
  assert.equal(state.current(1, changed), cards[10].key);
  assert.equal(state.current(1, changed.filter(t => t.key !== cards[10].key)), changed[0].key);
});

test('failure and partial inventories retain saved identities without creating overrides', () => {
  const overrides = fixture()[0].devices[0].things;
  const before = globalThis.structuredClone(overrides);
  for (const status of ['loading', 'unavailable', 'partial', 'absent']) {
    const cards = thingCards({ status, things: [] }, overrides);
    assert.equal(cards[0].name, 'Thing a');
    assert.equal(cards[0].discoveryStatus, 'unavailable');
    assert.equal(cards[0].configurationStatus, 'excluded');
    assert.equal(cards[0].operational, false);
  }
  assert.deepEqual(overrides, before);
  assert.deepEqual(thingCards({ status: 'loading', things: [] }), []);
});

test('ambiguous, invalid and unknown hardware never becomes qualified', () => {
  for (const status of ['invalid-override', 'ambiguous-lighting']) {
    assert.equal(thingCards(result([{ ...observation('a'), status }])).length, 0);
    const [card] = thingCards(result([{ ...observation('a'), status }]), [{ controllerId: 'mid', id: 'a' }]);
    assert.equal(card.editable, false);
    assert.equal(card.operational, false);
  }
  assert.equal(thingCards(result([observation('a'), observation('a')])).length, 0);
  assert.equal(thingCards(result([{ ...observation('a'), capability: 'unknown' }])).length, 0);
});

test('draft status changes independently of the saved observation safety verdict', () => {
  const data = result([observation('a')]);
  const [card] = thingCards(data, [{ controllerId: 'mid', id: 'a', type: 'gate' }]);
  assert.equal(card.configurationStatus, 'gate');
  assert.equal(card.safetyStatus, 'needs-type');
  assert.equal(card.qualification, 'unqualified');
  assert.equal(data.things[0].status, 'needs-type');
});

test('keyed edits preserve complete objects, other controllers and sparse settings', async () => {
  const draft = new Draft(fixture(), api());
  await draft.editThing(0, 'mid', 'a', 'disabled', false);
  draft.select(1);
  await draft.editThing(0, 'mid', 'a', 'type', 'garage-door');
  const expected = fixture();
  expected[0].devices[0].things[0].disabled = false;
  expected[0].devices[0].things[0].type = 'garage-door';
  assert.deepEqual(draft.snapshot(), expected);
  await draft.editThing(0, 'replacement', 'a', 'invert', true);
  assert.equal(draft.snapshot()[0].devices[0].things.length, 2);
  const revision = draft.revision;
  await draft.editThing(1, 'other', 'new', 'disabled', false);
  assert.equal(draft.revision, revision);
  await draft.removeController(0);
  assert.throws(() => draft.editThing(0, 'mid', 'a', 'disabled', true));
});

test('rapid Thing edits use the existing serialized queue', async () => {
  let release;
  const sent = [];
  const host = api();
  host.updatePluginConfig = async snapshot => {
    sent.push(snapshot);
    if (sent.length === 1) {
      await new Promise(resolve => {
        release = resolve;
      });
    }
  };
  const draft = new Draft(fixture(), host);
  const first = draft.editThing(0, 'mid', 'a', 'disabled', false);
  const second = draft.editThing(0, 'mid', 'a', 'invert', false);
  release();
  await Promise.all([first, second]);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.at(-1), draft.snapshot());
});


test('large mixed inventory automatically shows garage, blind and relay tabs without saving defaults', () => {
  const lights = Array.from({ length: 120 }, (_, i) => ({
    ...observation('l' + i), capability: i % 2 ? 'dimmable-light-capable' : 'on-off-light-capable', status: 'automatic-candidate',
  }));
  const automatic = ['blind-capable', 'relay-capable', 'unknown'].map((capability, i) => ({
    ...observation('x' + i), capability, status: capability === 'unknown' ? 'unsupported' : 'automatic-candidate',
  }));
  const overrides = [{ controllerId: 'mid', id: 'l0', disabled: true }, { controllerId: 'old-mid', id: 'missing', invert: true }];
  const before = globalThis.structuredClone(overrides);
  const cards = thingCards(result([...lights, ...automatic, observation('door')]), overrides);
  assert.deepEqual(cards.map(t => t.id).sort(), ['door', 'l0', 'missing', 'x0', 'x1']);
  const defaults = thingCards(result([...lights, ...automatic, observation('door')]));
  assert.deepEqual(defaults.map(t => t.id).sort(), ['door', 'x0', 'x1']);
  assert(defaults.every(t => t.editable && t.override === undefined && t.operational === false));
  const ambiguous = { ...observation('relay'), capability: 'relay-capable', status: 'ambiguous-lighting' };
  assert.equal(thingCards(result([ambiguous])).length, 0);
  assert.equal(thingCards(result([ambiguous]), [{ controllerId: 'mid', id: 'relay', disabled: true }])[0].editable, false);
  assert.deepEqual(overrides, before);
  assert.equal(thingCards({ status: 'unavailable', things: [] }, overrides).length, 2);
});

test('clearing a newly created type-only exception restores sparsity but preserves existing entries', async () => {
  const initial = fixture();
  delete initial[0].devices[0].things;
  const draft = new Draft(initial, api());
  await draft.editThing(0, 'mid', 'a', 'type', 'gate');
  await draft.editThing(0, 'mid', 'a', 'type', undefined);
  assert.deepEqual(draft.snapshot(), initial);
  await draft.editThing(1, 'other', 'a', 'type', undefined);
  assert.deepEqual(draft.snapshot()[0].devices[1].things, [{ controllerId: 'other', id: 'a' }]);
  await draft.editThing(0, 'mid', 'b', 'type', 'gate');
  await draft.editThing(0, 'mid', 'b', 'invert', false);
  await draft.editThing(0, 'mid', 'b', 'type', undefined);
  assert.deepEqual(draft.snapshot()[0].devices[0].things, [{ controllerId: 'mid', id: 'b', invert: false }]);
});


test('Thing navigation wraps and focus restoration does not scroll unrelated fields', async () => {
  const html = await readFile(new URL('../../homebridge-ui/public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../homebridge-ui/public/app.mjs', import.meta.url), 'utf8');
  assert.match(html, /thing-tabs .*flex-wrap: wrap/);
  assert.match(html, /thing-tabs button .*white-space: normal; overflow-wrap: anywhere/);
  assert.doesNotMatch(html, /overflow-x: auto/);
  assert.doesNotMatch(app, /scrollIntoView/);
  assert.match(app, /contains\(focused\)/);
  assert.match(app, /preventScroll: true/);
});


test('Thing presentation uses native switches, concise labels and one development notice', async () => {
  const app = await readFile(new URL('../../homebridge-ui/public/app.mjs', import.meta.url), 'utf8');
  const html = await readFile(new URL('../../homebridge-ui/public/index.html', import.meta.url), 'utf8');
  assert.match(app, /'Disable Thing'/);
  assert.match(app, /'Invert'/);
  assert.match(app, /label.className = 'hb-uix-switch'/);
  assert.match(app, /Exclude this Thing from Apple Home/);
  assert(app.includes('Reverse the reported on/off or open/closed states'));
  assert.match(app, /'zoneControlType', 'port'/);
  assert.doesNotMatch(app, /Saved observation safety:|Physical state unknown|toLocaleTimeString|—/);
  assert.equal(html.split('MyPlace Things control is not yet enabled in this development version.').length, 2);
  assert.match(html, /thing-tabs .nav-link { color: #fff/);
});


test('status presentation suppresses fast progress and rejects stale callbacks after warnings, failure and close', () => {
  const callbacks = [];
  const renders = [];
  const cancelled = [];
  const presenter = new DraftStatusPresentation((...args) => renders.push(args), {
    schedule(callback, delay) {
      assert.equal(delay, 300);
      callbacks.push(callback);
      return callbacks.length;
    },
    cancel(id) {
      cancelled.push(id);
    },
  });
  presenter.show('Updating draft…');
  presenter.show('Updating draft…');
  assert.equal(callbacks.length, 1);
  presenter.show('');
  callbacks[0]();
  assert(renders.every(([, progress]) => !progress));
  presenter.show('Updating draft…');
  callbacks[1]();
  assert.deepEqual(renders.at(-1), ['Updating draft...', true]);
  presenter.show('Controller 1: invalid address');
  callbacks[1]();
  assert.deepEqual(renders.at(-1), ['Controller 1: invalid address', false]);
  presenter.show('Updating draft…');
  presenter.show('Draft update failed. Cancel and reopen; do not save.');
  callbacks[2]();
  assert.match(renders.at(-1)[0], /Draft update failed/);
  presenter.show('Updating draft…');
  presenter.close();
  const count = renders.length;
  callbacks[3]();
  presenter.show('Updating draft…');
  assert.equal(renders.length, count);
  assert.equal(cancelled.length, 4);
});

test('presentation delay leaves rapid configuration dispatch and native Save safeguards immediate', async () => {
  const callbacks = [];
  const visible = [];
  const presenter = new DraftStatusPresentation((...args) => visible.push(args), {
    schedule(callback, delay) {
      assert.equal(delay, 300);
      callbacks.push(callback);
      return callbacks.length;
    }, cancel() {},
  });
  const host = api();
  let enabled = false;
  let release;
  const sent = [];
  host.enableSaveButton = () => {
    enabled = true;
  };
  host.disableSaveButton = () => {
    enabled = false;
  };
  host.updatePluginConfig = async snapshot => {
    sent.push(snapshot);
    if (sent.length === 1) {
      await new Promise(resolve => {
        release = resolve;
      });
    }
  };
  const draft = new Draft(fixture(), host, message => presenter.show(message));
  assert.equal(enabled, true);
  const first = draft.edit('debug', true);
  assert.equal(enabled, false);
  assert.equal(sent.length, 1);
  const second = draft.editThing(0, 'mid', 'a', 'disabled', false);
  assert.equal(callbacks.length, 1);
  assert(visible.every(([, progress]) => !progress));
  release();
  await Promise.all([first, second]);
  assert.equal(enabled, true);
  assert.equal(sent.length, 2);
  callbacks[0]();
  assert.deepEqual(visible.at(-1), ['', false]);
});
