import assert from 'node:assert/strict';
import test from 'node:test';
import { configureThings } from '../../dist/discovery/configureThings.js';
import { discoverThings } from '../../dist/discovery/discoverThings.js';
import { observeLights } from '../../dist/api/lightCommand.js';
import { discoverDevices } from '../../dist/discovery/discoverDevices.js';

const record = (id = 't1', dip = 3, value = 100) => ({ id, channelDipState: dip, value, name: 'Synthetic device' });
const snapshot = (things = { t1: record() }, mid = 'synthetic-controller') =>
  ({ system: { mid, noOfAircons: 0 }, aircons: {}, myThings: { things } });
const state = data => ({ data, lastAttemptFailed: false });
const config = (overrides = {}) => ({ controllerId: 'synthetic-controller', id: 't1', ...overrides });
const read = (data = snapshot(), entries) => configureThings(state(data), entries);
const byId = (result, id = 't1', mid = 'synthetic-controller') =>
  result.things.find(t => t.id === id && t.controllerId === mid);

test('omitted or empty overrides retain discovery and automatic candidates without operational exposure', () => {
  const data = snapshot({ t1: record('t1', 8) });
  const omitted = read(data);
  assert.equal(omitted.configurationStatus, 'default');
  assert.deepEqual(omitted.discovery, discoverThings(data));
  assert.equal(omitted.things[0].status, 'automatic-candidate');
  assert.equal(omitted.things[0].override, undefined);
  assert.deepEqual(read(data, []).things, omitted.things);
  assert.equal(read(data, []).configurationStatus, 'valid');
  assert.equal(omitted.things[0].qualification, 'unqualified');
  assert.equal(omitted.things[0].operational, false);
});

test('all supported DIP categories select automatic candidates or garage/gate decisions, never operational controls', () => {
  for (const dip of [1, 2, 3, 4, 5, 8, 10]) {
    const data = snapshot({ t1: record('t1', dip) });
    const decision = dip === 3 || dip === 10;
    const t = read(data).things[0];
    assert.equal(t.status, decision ? 'needs-type' : 'automatic-candidate');
    assert.equal(t.observation.physicalSubtype, 'undetermined');
    for (const type of ['garage-door', 'gate']) {
      const configured = read(data, [config({ type })]).things[0];
      assert.equal(configured.status, decision ? 'confirmed-candidate' : 'invalid-override');
      assert.equal(configured.value.status, decision ? 'valid' : 'unavailable');
      assert.equal(configured.qualification, 'unqualified');
      assert.equal(configured.operational, false);
    }
  }
});

test('unknown and malformed DIP values cannot gain capability from a name or confirmation', () => {
  for (const dip of [undefined, null, '1', '3', '4', '5', '8', '10', 99, -1, 1.5, {}, [], true, Infinity]) {
    const data = snapshot({ t1: { ...record(), channelDipState: dip, name: 'Garage Gate Blind Fan' } });
    assert.equal(read(data).things[0].status, 'unsupported');
    assert.equal(read(data, [config({ type: 'gate' })]).things[0].status, 'invalid-override');
    assert.equal(read(data).discovery.unknownRecords, 1);
  }
});

test('numeric endpoints and independent inversion preserve raw observations without asserting physical position', () => {
  for (const value of [0, 100]) {
    for (const invert of [false, true]) {
      const data = snapshot({ t1: record('t1', 3, value), t2: record('t2', 3, value) });
      const before = globalThis.structuredClone(data);
      const r = read(data, [config({ invert })]);
      assert.deepEqual(byId(r).value, { status: 'valid', reportedValue: value,
        logicalValue: invert ? 100 - value : value, physicalState: 'unknown' });
      assert.equal(byId(r, 't2').value.logicalValue, value);
      assert.equal(byId(r).observation.reported.value, value);
      assert.deepEqual(data, before);
    }
  }
});

test('intermediate, malformed and missing values never become false closed/off', () => {
  for (const value of [1, 50, 99, -1, 101, NaN, Infinity, null, '0', '100', true, {}, []]) {
    const t = read(snapshot({ t1: { ...record(), value } })).things[0];
    assert.equal(t.value.status, 'invalid');
    assert.equal(t.value.logicalValue, undefined);
    assert.equal(t.value.physicalState, 'unknown');
  }
  const raw = record();
  delete raw.value;
  assert.deepEqual(read(snapshot({ t1: raw })).things[0].value, { status: 'unavailable', physicalState: 'unknown' });
});

test('blind, light and relay capability never grants position, speed, electrical mode or obstruction feedback', () => {
  for (const dip of [1, 2, 4, 5, 8]) {
    const raw = { ...record('t1', dip), dimPercent: 50, buttonType: 1, obstruction: false, moving: true };
    const t = read(snapshot({ t1: raw })).things[0];
    assert.deepEqual(t.value, { status: 'valid', reportedValue: 100, logicalValue: 100, physicalState: 'unknown' });
    assert.equal(t.observation.reported.dimPercent, 50);
    assert.equal(t.operational, false);
    raw.value = 50;
    assert.equal(read(snapshot({ t1: raw })).things[0].value.status, 'invalid');
  }
  for (const type of ['relay-switch', 'relay-fan', 'relay-light', 'outlet', 'blind']) {
    assert.equal(read(snapshot({ t1: record('t1', 8) }), [config({ type })]).configurationStatus, 'invalid');
  }
});

test('invalid unidentifiable overrides fail closed without discarding useful discovery', () => {
  for (const entries of [null, {}, 't1', true, [null], [[]], [{ invert: false }], [config({ id: '' })],
    [config({ id: 'a/b' })], [config({ id: 'x'.repeat(65) })], [config({ controllerId: ' ' })],
    [config({ controllerId: ' synthetic-controller ' })], [config({ controllerId: 1 })]]) {
    const r = read(snapshot(), entries);
    assert.equal(r.configurationStatus, 'invalid');
    assert.equal(r.things[0].status, 'invalid-override');
    assert.equal(r.discovery.things.length, 1);
  }
});

test('attributable override errors quarantine only their identity; no operational bypass properties', () => {
  for (const changes of [{ invert: 'false' }, { invert: null }, { disabled: 1 }, { disabled: null },
    { type: 'fan' }, { name: 'Synthetic device' }, { operational: true }, { qualification: 'qualified' }]) {
    const r = read(snapshot({ t1: record(), t2: record('t2', 8) }), [config(changes)]);
    assert.equal(r.configurationStatus, 'invalid');
    assert.equal(byId(r).status, 'invalid-override');
    assert.equal(byId(r, 't2').status, 'automatic-candidate');
    assert.equal(byId(r).value.status, 'unavailable');
  }
});

test('identical and conflicting duplicates quarantine all occurrences of that identity in any order', () => {
  for (const second of [config(), config({ type: 'gate' }), config({ invert: true }), config({ type: 'unknown' })]) {
    for (const entries of [[config(), second], [second, config()], [config(), second, config()]]) {
      const r = read(snapshot({ t1: record(), t2: record('t2', 8) }), entries);
      assert.equal(r.configurationStatus, 'invalid');
      assert.equal(byId(r).status, 'invalid-override');
      assert.equal(byId(r, 't2').status, 'automatic-candidate');
      assert.equal(r.things.length, 2);
    }
  }
});

test('disable and re-enable retain type, inversion and identity without storing automatic defaults', () => {
  const entry = config({ type: 'gate', invert: true, disabled: true });
  const disabled = byId(read(snapshot(), [entry]));
  assert.equal(disabled.status, 'excluded');
  assert.deepEqual(disabled.override, entry);
  entry.disabled = false;
  const enabled = byId(read(snapshot(), [entry]));
  assert.equal(enabled.status, 'confirmed-candidate');
  assert.equal(enabled.identity, disabled.identity);
  assert.equal(enabled.override.type, 'gate');
  assert.equal(enabled.value.logicalValue, 0);
  assert.equal(enabled.operational, false);
  delete entry.disabled;
  assert.equal(byId(read(snapshot(), [entry])).status, 'confirmed-candidate');
  assert.deepEqual(byId(read(snapshot(), [config()])).override, config());
});

test('overlapping Thing IDs on independent controllers never share overrides', () => {
  const a = byId(read(snapshot(), [config({ invert: true })]));
  const b = byId(read(snapshot(undefined, 'other'), [config({ controllerId: 'other' })]), 't1', 'other');
  assert.notEqual(a.identity, b.identity);
  assert.equal(a.value.logicalValue, 0);
  assert.equal(b.value.logicalValue, 100);
  const replacement = read(snapshot(undefined, 'other'), [config({ type: 'gate', invert: true })]);
  assert.equal(byId(replacement).status, 'unavailable');
  assert.equal(byId(replacement, 't1', 'other').status, 'needs-type');
  assert.equal(byId(replacement, 't1', 'other').override, undefined);
});

test('rename and controller IP changes preserve identity; replacement controller does not inherit exclusion', () => {
  const data = snapshot();
  data.system.ipAddress = '192.0.2.1';
  const entry = config({ disabled: true });
  const initial = byId(read(data, [entry]));
  data.system.ipAddress = '192.0.2.2';
  data.myThings.things.t1.name = 'Renamed';
  assert.equal(byId(read(data, [entry])).identity, initial.identity);
  data.system.mid = 'replacement-controller';
  const r = read(data, [entry]);
  assert.equal(byId(r).status, 'excluded');
  assert.equal(byId(r).value.status, 'unavailable');
  assert.equal(byId(r, 't1', 'replacement-controller').status, 'needs-type');
});

test('partial inventories preserve valid peers and retained overrides without removal instructions', () => {
  const data = snapshot({ t1: record(), broken: null, t2: record('t2'), alias: record('t2') });
  const r = read(data, [config({ type: 'gate' }), config({ id: 't2' })]);
  assert.equal(r.discovery.status, 'partial');
  assert.equal(r.discovery.duplicateRecords, 2);
  assert.equal(byId(r).status, 'confirmed-candidate');
  assert.equal(byId(r, 't2').status, 'unavailable');
  assert.equal(r.things.length, 2);
});

test('absent, malformed, empty and unidentified inventories retain settings without fabricated readings', () => {
  for (const data of [undefined, {}, { system: { mid: 'synthetic-controller' } },
    { ...snapshot(), myThings: null }, snapshot({}), snapshot({}, '')]) {
    for (const disabled of [false, true]) {
      const entry = config({ disabled, invert: true, type: 'gate' });
      const r = configureThings(state(data), [entry]);
      assert.equal(r.things.length, 1);
      assert.equal(r.things[0].status, disabled ? 'excluded' : 'unavailable');
      assert.deepEqual(r.things[0].override, entry);
      assert.deepEqual(r.things[0].value, { status: 'unavailable', physicalState: 'unknown' });
    }
  }
  assert.equal(read({ system: { mid: 'synthetic-controller' } }).discovery.status, 'absent');
  assert.equal(read(snapshot({})).discovery.status, 'present');
  assert.deepEqual(read(snapshot({})).things, []);
});

test('failed polling rejects last-good data; recovery requires a fresh matching snapshot', () => {
  const data = snapshot();
  const entries = [config()];
  const fresh = read(data, entries);
  const failed = configureThings({ data, lastAttemptFailed: true, lastSuccessAt: 1 }, entries);
  assert.equal(failed.discovery.status, 'unavailable');
  assert.equal(failed.things[0].value.status, 'unavailable');
  assert.equal(failed.things[0].observation, undefined);
  assert.deepEqual(read(data, entries), fresh);
});

test('capability changes do not reuse earlier confirmed interpretations', () => {
  const entries = [config({ type: 'gate' })];
  assert.equal(read(snapshot(), entries).things[0].status, 'confirmed-candidate');
  assert.equal(read(snapshot({ t1: record('t1', 8) }), entries).things[0].status, 'invalid-override');
  assert.equal(read(snapshot(), entries).things[0].status, 'confirmed-candidate');
});

test('cross-collection ID collisions and unreadable lighting inventory are ambiguous, never name deduplicated', () => {
  const data = snapshot({ t1: record('t1', 4), t2: record('t2', 5), t3: record('t3', 8) });
  data.myLights = { lights: { t1: { id: 't1', name: 'Different name', state: 'on', value: 50 },
    l2: { id: 'l2', name: 'Synthetic device', state: 'on', value: 100 } } };
  const r = read(data);
  assert.equal(byId(r).status, 'ambiguous-lighting');
  assert.equal(byId(r, 't2').status, 'automatic-candidate');
  assert.equal(byId(r, 't3').operational, false);
  // A malformed light may still have a cached accessory, so do not rely on accepted lights only.
  data.myLights.lights.t1.state = 'invalid';
  assert.equal(byId(read(data)).status, 'ambiguous-lighting');
  data.myLights.lights = { alias: { id: 't2' } };
  assert.equal(byId(read(data), 't2').status, 'ambiguous-lighting');
  for (const lights of [null, [], { lights: null }, { lights: [] }]) {
    data.myLights = lights;
    assert.ok(read(data).things.every(t => t.status === 'ambiguous-lighting'));
  }
});

test('large inventories and duplicate names do not create overrides or change HVAC and lighting discovery', () => {
  const data = snapshot(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => ['t' + i, record('t' + i, 8)])));
  data.aircons = { ac1: { info: { uid: 'synthetic-ac', name: 'AC' }, zones: { z01: { name: 'Zone' } } } };
  data.myLights = { lights: { l1: { id: 'l1', name: 'Synthetic device', state: 'on', value: 50 } } };
  const before = globalThis.structuredClone(data);
  const existing = [discoverDevices(data), observeLights(data)];
  const r = read(data);
  assert.equal(r.things.length, 1000);
  assert.equal(new Set(r.things.map(t => t.identity)).size, 1000);
  assert.ok(r.things.every(t => t.status === 'automatic-candidate' && !t.override && !t.operational));
  assert.deepEqual(read(data), r);
  assert.deepEqual(data, before);
  assert.deepEqual([discoverDevices(data), observeLights(data)], existing);
});

test('outputs are detached and frozen without mutating caller data or manufacturing saved defaults', () => {
  const entries = [config()];
  const data = snapshot();
  const before = globalThis.structuredClone({ entries, data });
  const r = read(data, entries);
  assert.deepEqual({ entries, data }, before);
  entries[0].invert = true;
  data.myThings.things.t1.value = 0;
  assert.equal(r.things[0].override.invert, undefined);
  assert.equal(r.things[0].value.logicalValue, 100);
  for (const target of [r, r.things, r.things[0], r.things[0].override, r.things[0].value]) {
    assert.equal(Object.isFrozen(target), true);
  }
});

test('incomplete light records cannot establish cross-collection identity confidence', () => {
  for (const raw of [null, [], {}, { id: 'l1' }, { id: 'other', state: 'on' },
    { id: 'l1', state: 'invalid' }, { id: 'l1', state: 'on', value: 101 },
    { id: 'l1', state: 'on', relay: true, value: 50 }]) {
    const data = snapshot({ t1: record('t1', 4), t2: record('t2', 5), t3: record('t3', 8) });
    data.myLights = { lights: { l1: raw } };
    assert.ok(read(data).things.every(t => t.status === 'ambiguous-lighting'));
  }
});

test('missing lighting follows reported system capability without penalising known no-light controllers', () => {
  for (const hasLights of [true, false, undefined, 'true', null]) {
    const data = snapshot({ t1: record('t1', 8) });
    data.system.hasLights = hasLights;
    assert.equal(read(data).things[0].status, hasLights === false || hasLights === undefined
      ? 'automatic-candidate' : 'ambiguous-lighting');
    data.myLights = { lights: {} };
    assert.equal(read(data).things[0].status, hasLights === true ? 'ambiguous-lighting' : 'automatic-candidate');
  }
  const data = snapshot({ t1: record('t1', 4) });
  data.system.hasLights = true;
  data.myLights = { lights: { l1: { id: 'l1', state: 'on', value: 50 } } };
  assert.equal(read(data).things[0].status, 'automatic-candidate');
  const before = globalThis.structuredClone(data);
  configureThings({ data, lastAttemptFailed: true }, [config()]);
  assert.deepEqual(data, before);
});
