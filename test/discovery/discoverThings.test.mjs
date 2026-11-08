import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverThings, observeThings } from '../../dist/discovery/discoverThings.js';
import { validateSystemData } from '../../dist/api/systemData.js';
import { discoverDevices } from '../../dist/discovery/discoverDevices.js';
import { observeLights } from '../../dist/api/lightCommand.js';
const snapshot = things => ({ system: { mid: 'synthetic-controller', noOfAircons: 0 }, aircons: {}, myThings: { things } });
const record = (id, dip, name = 'Synthetic output') => ({ id, name, channelDipState: dip, value: 0 });

test('verified numeric DIP mappings describe capability, never physical subtype or position', () => {
  for (const [dip, expected] of [[1, 'blind-capable'], [2, 'blind-capable'], [3, 'garage-gate-capable'],
    [10, 'garage-gate-capable'], [8, 'relay-capable']]) {
    const r = discoverThings(snapshot({ t1: record('t1', dip) }));
    assert.equal(r.things[0].capability, expected);
    assert.equal(r.things[0].physicalSubtype, 'undetermined');
    assert.deepEqual(r.things[0].reported, { channelDipState: dip, value: 0 });
  }
});

test('unknown and malformed classification cannot gain capabilities from names', () => {
  for (const dip of [undefined, null, '3', '1', 0, 4, -1, 1.5, {}, [], true, Infinity]) {
    for (const name of ['Garage', 'Gate', 'Blind', 'Fan']) {
      const thing = discoverThings(snapshot({ t1: record('t1', dip, name) })).things[0];
      assert.equal(thing.capability, 'unknown');
      assert.equal(thing.physicalSubtype, 'undetermined');
    }
  }
});

test('identity survives renames, duplicate names and remains controller scoped', () => {
  const d = snapshot({ a: record('a', 3), b: record('b', 3) });
  const before = discoverThings(d).things;
  assert.notEqual(before[0].identity, before[1].identity);
  d.myThings.things.a.name = 'Renamed';
  assert.equal(discoverThings(d).things[0].identity, before[0].identity);
  d.system.mid = 'other-controller';
  assert.notEqual(discoverThings(d).things[0].identity, before[0].identity);
});

test('duplicate IDs are all quarantined independent of insertion order; valid peers survive', () => {
  const entries = [['a', record('a', 1)], ['alias', record('a', 3)], ['b', record('b', 10)]];
  const a = discoverThings(snapshot(Object.fromEntries(entries)));
  const b = discoverThings(snapshot(Object.fromEntries(entries.reverse())));
  assert.deepEqual(a, b);
  assert.equal(a.duplicateRecords, 2);
  assert.deepEqual(a.things.map(x => x.id), ['b']);
});

test('invalid IDs, mismatched keys and malformed records are isolated', () => {
  const d = snapshot({ good: record('good', 1), missing: {}, number: { id: 1 }, blank: { id: '' },
    mismatch: record('other', 3), bad: null, array: [], invalid: { id: 'a/b' } });
  const r = discoverThings(d);
  assert.equal(r.invalidRecords, 7);
  assert.deepEqual(r.things.map(x => x.id), ['good']);
});

test('absent, empty, malformed and unavailable snapshots have explicit outcomes', () => {
  assert.equal(discoverThings({}).status, 'unavailable');
  assert.equal(discoverThings({ system: { mid: 'controller' } }).status, 'absent');
  assert.equal(discoverThings(undefined).status, 'unavailable');
  for (const myThings of [null, [], true, {}, { things: [] }, { things: null }]) {
    assert.equal(discoverThings({ system: { mid: 'controller' }, myThings }).status, 'malformed');
  }
  assert.deepEqual(discoverThings(snapshot({})).things, []);
  for (const mid of [null, '', 42]) {
    const d = snapshot({ a: record('a', 3) });
    d.system.mid = mid;
    assert.equal(discoverThings(d).status, 'unavailable');
  }
});

test('reported scalars are copied without inferred state, input mutation or secret fields', () => {
  const d = snapshot({ a: { ...record('a', 3), name: {}, value: 'reported', buttonType: 2, dimPercent: 50, secret: 'synthetic' } });
  const before = globalThis.structuredClone(d);
  const r = discoverThings(d);
  assert.deepEqual(d, before);
  assert.deepEqual(r.things[0].reported, { channelDipState: 3, buttonType: 2, dimPercent: 50, value: 'reported' });
  assert.equal(r.things[0].name, undefined);
  assert.equal(r.things[0].secret, undefined);
  assert.throws(() => {
    r.things[0].reported.value = 100;
  });
});

test('existing validated snapshots support Things-only with empty aircons but not omitted aircons', () => {
  const d = snapshot({ a: record('a', 3) });
  assert.equal(discoverThings(validateSystemData(d)).things.length, 1);
  delete d.aircons;
  assert.throws(() => validateSystemData(d));
});

test('snapshot adapter avoids stale last-good data; large collections are deterministic', () => {
  const d = snapshot(Object.fromEntries(Array.from({ length: 5000 }, (_, i) => ['t' + i, record('t' + i, i % 11)])));
  assert.equal(observeThings({ data: d, lastAttemptFailed: false }).things.length, 5000);
  assert.deepEqual(discoverThings(d), discoverThings(d));
  assert.equal(observeThings({ data: d, lastAttemptFailed: true }).status, 'unavailable');
});

test('pure snapshot discovery leaves existing aircon and lighting discovery unchanged', () => {
  const d = snapshot({ a: record('a', 3) });
  d.aircons = { ac1: { info: { uid: 'synthetic-ac', name: 'AC' }, zones: { z01: { name: 'Zone' } } } };
  d.myLights = { lights: { l1: { id: 'l1', name: 'Light', state: 'on', value: 50 } } };
  const before = [discoverDevices(d), observeLights(d)];
  assert.equal(discoverThings(validateSystemData(d)).things.length, 1);
  assert.deepEqual([discoverDevices(d), observeLights(d)], before);
  delete d.myThings;
  assert.equal(discoverThings(d).status, 'absent');
  assert.deepEqual([discoverDevices(d), observeLights(d)], before);
});

test('complete empty, valid unknown, mixed and all-rejected inventories are distinct', () => {
  const empty = discoverThings(snapshot({}));
  assert.equal(empty.status, 'present');
  assert.equal(empty.things.length, 0);
  const unknown = discoverThings(snapshot({ a: record('a', 99) }));
  assert.equal(unknown.status, 'present');
  assert.equal(unknown.unknownRecords, 1);
  const mixed = discoverThings(snapshot({ a: record('a', 3), broken: null }));
  assert.equal(mixed.status, 'partial');
  assert.equal(mixed.things.length, 1);
  const invalid = discoverThings(snapshot({ broken: null }));
  assert.equal(invalid.status, 'partial');
  assert.equal(invalid.things.length, 0);
  const duplicate = discoverThings(snapshot({ a: record('a', 3), alias: record('a', 3) }));
  assert.equal(duplicate.status, 'partial');
  assert.equal(duplicate.duplicateRecords, 2);
  assert.equal(duplicate.things.length, 0);
  assert.deepEqual(mixed, discoverThings(snapshot({ broken: null, a: record('a', 3) })));
  assert.throws(() => {
    mixed.status = 'present';
  });
  assert.throws(() => {
    mixed.things.push(unknown.things[0]);
  });
});

test('unidentified snapshots never report absence and failed reads never reuse inventory', () => {
  for (const system of [undefined, null, [], {}, { mid: '' }, { mid: '  ' }, { mid: 1 }]) {
    assert.equal(discoverThings({ system }).status, 'unavailable');
    assert.equal(discoverThings({ system, myThings: { things: {} } }).status, 'unavailable');
  }
  const data = snapshot({ a: record('a', 3) });
  const failed = observeThings({ data, lastAttemptFailed: true });
  assert.equal(failed.status, 'unavailable');
  assert.deepEqual(failed.things, []);
});
