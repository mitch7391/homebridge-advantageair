import assert from 'node:assert/strict';
import test from 'node:test';
import { configureThings } from '../../dist/discovery/configureThings.js';
import { discoverThings } from '../../dist/discovery/discoverThings.js';

const record = (id = 't1', dip = 3, value = 100) => ({ id, channelDipState: dip, value, name: 'Synthetic device' });
const snapshot = (things = { t1: record() }, mid = 'synthetic-controller') =>
  ({ system: { mid, noOfAircons: 0 }, aircons: {}, myThings: { things } });
const state = data => ({ data, lastAttemptFailed: false });
const config = (overrides = {}) => ({ controllerId: 'synthetic-controller', id: 't1', type: 'garage-door', ...overrides });
const read = (data = snapshot(), entries = [config()]) => configureThings(state(data), entries);

test('omitted or empty configuration selects nothing, retaining discovery without automatic exposure', () => {
  const data = snapshot();
  const omitted = configureThings(state(data), undefined);
  assert.equal(omitted.configurationStatus, 'disabled');
  assert.deepEqual(omitted.things, []);
  assert.deepEqual(omitted.discovery, discoverThings(data));
  assert.equal(read(data, []).configurationStatus, 'valid');
  assert.deepEqual(read(data, []).things, []);
});

test('all known DIP classifications constrain explicit physical type; names never select it', () => {
  const supported = { 1: ['blind'], 2: ['blind'], 3: ['garage-door', 'gate'], 10: ['garage-door', 'gate'],
    8: ['relay-switch', 'relay-fan'] };
  for (const [dip, types] of Object.entries(supported)) {
    for (const type of ['garage-door', 'gate', 'blind', 'relay-switch', 'relay-fan']) {
      const thing = read(snapshot({ t1: record('t1', Number(dip)) }), [config({ type })]).things[0];
      assert.equal(thing.status, types.includes(type) ? 'compatible' : 'unsupported');
      assert.equal(thing.value.status, types.includes(type) ? 'valid' : 'unavailable');
      assert.equal(thing.observation.physicalSubtype, 'undetermined');
      assert.equal(thing.value.physicalState, 'unknown');
    }
  }
});

test('unknown and malformed DIP values cannot be enabled by an explicit type or misleading name', () => {
  for (const dip of [undefined, null, '1', '3', '8', '10', 4, 99, -1, 1.5, {}, [], true, Infinity]) {
    for (const type of ['garage-door', 'gate', 'blind', 'relay-switch', 'relay-fan']) {
      const raw = { ...record('t1', dip), channelDipState: dip, name: 'Garage Gate Blind Fan' };
      const r = read(snapshot({ t1: raw }), [config({ type })]);
      assert.equal(r.things[0].status, 'unsupported');
      assert.equal(r.things[0].value.status, 'unavailable');
      assert.equal(r.discovery.unknownRecords, 1);
    }
  }
});

test('numeric endpoints and per-device inversion preserve raw observations and never assert physical position', () => {
  for (const value of [0, 100]) {
    for (const invert of [false, true]) {
      const data = snapshot({ t1: record('t1', 3, value), t2: record('t2', 3, value) });
      const before = globalThis.structuredClone(data);
      const result = read(data, [config({ invert }), config({ id: 't2' })]);
      assert.deepEqual(result.things[0].value, { status: 'valid', reportedValue: value,
        logicalValue: invert ? 100 - value : value, physicalState: 'unknown' });
      assert.equal(result.things[1].value.logicalValue, value);
      assert.equal(result.things[0].observation.reported.value, value);
      assert.deepEqual(data, before);
    }
  }
});

test('intermediate, malformed and missing values are distinguished without coercion or false closed/off', () => {
  for (const value of [1, 50, 99, -1, 101, NaN, Infinity, null, '0', '100', true, {}, []]) {
    const raw = { ...record(), value };
    const result = read(snapshot({ t1: raw })).things[0];
    assert.equal(result.value.status, 'invalid');
    assert.equal(result.value.logicalValue, undefined);
    assert.equal(result.value.physicalState, 'unknown');
  }
  const raw = record();
  delete raw.value;
  assert.deepEqual(read(snapshot({ t1: raw })).things[0].value, { status: 'unavailable', physicalState: 'unknown' });
});

test('blind and fan configuration never grants continuous position, speed, movement or obstruction feedback', () => {
  for (const [dip, type] of [[1, 'blind'], [8, 'relay-fan']]) {
    const raw = { ...record('t1', dip, 100), dimPercent: 50, buttonType: 1, obstruction: false, moving: true };
    const r = read(snapshot({ t1: raw }), [config({ type })]).things[0];
    assert.deepEqual(r.value, { status: 'valid', reportedValue: 100, logicalValue: 100, physicalState: 'unknown' });
    assert.equal(r.observation.reported.dimPercent, 50);
    raw.value = 50;
    assert.equal(read(snapshot({ t1: raw }), [config({ type })]).things[0].value.status, 'invalid');
  }
});

test('configuration requires exact identifiers and explicit valid type, never name matching or inferred defaults', () => {
  const invalid = [null, {}, 't1', true, [null], [[]]];
  for (const changes of [{ id: '' }, { id: 1 }, { id: 'a/b' }, { id: ' t1' }, { id: 'x'.repeat(65) },
    { controllerId: '' }, { controllerId: '  ' }, { controllerId: ' synthetic-controller ' }, { controllerId: 1 },
    { controllerId: undefined }, { type: undefined }, { type: 'fan' }, { type: 'toString' }, { invert: 'false' },
    { invert: 1 }, { invert: null }, { name: 'Synthetic device' }]) {
    invalid.push([config(changes)]);
  }
  for (const entries of invalid) {
    const r = read(snapshot(), entries);
    assert.equal(r.configurationStatus, 'invalid', JSON.stringify(entries));
    assert.deepEqual(r.things, []);
    assert.equal(r.discovery.things.length, 1, 'Useful raw discovery is not discarded by invalid configuration.');
  }
});

test('identical and conflicting duplicate IDs invalidate all Things settings independent of order', () => {
  for (const second of [config(), config({ type: 'gate' }), config({ invert: true }), config({ type: 'unknown' })]) {
    for (const entries of [[config(), second], [second, config()]]) {
      const r = read(snapshot(), entries);
      assert.equal(r.configurationStatus, 'invalid');
      assert.deepEqual(r.things, []);
    }
  }
  assert.equal(read(snapshot(), [config(), config({ id: 't2', controllerId: 'other' })]).configurationStatus, 'invalid');
});

test('matching requires controller MID and Thing ID; overlapping IDs on different controllers are independent', () => {
  const a = read(snapshot(), [config({ invert: true })]);
  const b = read(snapshot(undefined, 'other'), [config({ controllerId: 'other' })]);
  assert.notEqual(a.things[0].observation.identity, b.things[0].observation.identity);
  assert.equal(a.things[0].value.logicalValue, 0);
  assert.equal(b.things[0].value.logicalValue, 100);
  assert.equal(read(snapshot(undefined, 'other')).things[0].status, 'unavailable');
  assert.equal(read(snapshot(), [config({ id: 'unknown' })]).things[0].status, 'unavailable');
});

test('renaming a device or changing controller IP preserves matching but MID replacement does not', () => {
  const data = snapshot();
  data.system.ipAddress = '192.0.2.1';
  const initial = read(data).things[0];
  data.system.ipAddress = '192.0.2.2';
  data.myThings.things.t1.name = 'Renamed';
  const changed = read(data).things[0];
  assert.equal(changed.observation.identity, initial.observation.identity);
  assert.deepEqual(changed.value, initial.value);
  data.system.mid = 'replacement-controller';
  assert.equal(read(data).things[0].status, 'unavailable');
});

test('partial inventories preserve valid peers while duplicate IDs remain quarantined and never removed', () => {
  const data = snapshot({ t1: record(), broken: null, t2: record('t2'), alias: record('t2') });
  const result = read(data, [config(), config({ id: 't2' })]);
  assert.equal(result.discovery.status, 'partial');
  assert.equal(result.discovery.duplicateRecords, 2);
  assert.equal(result.things[0].status, 'compatible');
  assert.equal(result.things[1].status, 'unavailable');
  assert.equal(result.things.length, 2, 'Configured entries are retained, not removal instructions.');
});

test('absent, malformed, empty and unidentified inventories retain unavailable configured devices', () => {
  for (const data of [undefined, {}, { system: { mid: 'synthetic-controller' } },
    { ...snapshot(), myThings: null }, snapshot({}), snapshot({}, '')]) {
    const result = read(data);
    // Explicit undefined bypasses the test helper default.
    const checked = data === undefined ? configureThings(state(undefined), [config()]) : result;
    assert.equal(checked.things.length, 1);
    assert.equal(checked.things[0].status, 'unavailable');
    assert.deepEqual(checked.things[0].value, { status: 'unavailable', physicalState: 'unknown' });
  }
});

test('failed polling never reuses last-good state, and recovery needs a fresh matching observation', () => {
  const data = snapshot();
  const entries = [config()];
  const fresh = configureThings(state(data), entries);
  const failed = configureThings({ data, lastAttemptFailed: true, lastSuccessAt: 1 }, entries);
  assert.equal(failed.discovery.status, 'unavailable');
  assert.equal(failed.things[0].value.status, 'unavailable');
  assert.equal(failed.things[0].observation, undefined);
  assert.deepEqual(configureThings(state(data), entries), fresh);
  assert.equal(configureThings(state(snapshot({}, 'other')), entries).things[0].value.status, 'unavailable');
});

test('capability changes and config conflicts do not reuse earlier compatible interpretations', () => {
  assert.equal(read().things[0].status, 'compatible');
  assert.equal(read(snapshot({ t1: record('t1', 8) })).things[0].status, 'unsupported');
  assert.equal(read(snapshot(), [config({ type: 'blind' })]).things[0].status, 'unsupported');
  assert.equal(read().things[0].status, 'compatible');
});

test('configuration, observations and results are detached and frozen without mutating caller data', () => {
  const entries = [config()];
  const data = snapshot();
  const before = globalThis.structuredClone({ entries, data });
  const result = read(data, entries);
  assert.deepEqual({ entries, data }, before);
  entries[0].invert = true;
  data.myThings.things.t1.value = 0;
  assert.equal(result.things[0].configuration.invert, false);
  assert.equal(result.things[0].value.logicalValue, 100);
  for (const target of [result, result.things, result.things[0], result.things[0].configuration, result.things[0].value]) {
    assert.equal(Object.isFrozen(target), true);
  }
});
