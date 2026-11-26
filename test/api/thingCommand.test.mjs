import test from 'node:test';
import assert from 'node:assert/strict';
import { planThing, thingPayload } from '../../dist/api/thingCommand.js';
const identity = JSON.stringify(['AdvantageAir', 'mid', 'thing', 't1']);
const state = () => ({ lastSuccessAt: 1000, lastAttemptFailed: false, data: {
  system: { mid: 'mid', hasLights: false }, aircons: {},
  myThings: { things: { t1: { id: 't1', channelDipState: 8, value: 0 } } },
} });
const policy = overrides => ({ overrides: () => overrides, qualifies: key => key === identity });

test('payload restricts exactly one ID and numeric endpoints', () => {
  assert.equal(thingPayload('t1', 100), '{"id":"t1","value":100}');
  for (const id of ['', '../x', 'x"', 'x y', null, 'x'.repeat(65)]) {
    assert.throws(() => thingPayload(id, 0));
  }
  for (const value of [false, '0', -1, 1, 50, 101, null, undefined, NaN]) {
    assert.throws(() => thingPayload('t1', value));
  }
});

test('default deny cannot be overridden by candidate classification or disabled false', () => {
  assert.throws(() => planThing(state(), identity, true, undefined, 1000));
  assert.throws(() => planThing(state(), identity, true, { ...policy([{ controllerId: 'mid', id: 't1', disabled: false }]), qualifies: () => false }, 1000));
});

for (const invert of [false, true]) {
  for (const on of [false, true]) {
    test('logical target inversion ' + invert + '/' + on, () => {
      const input = state(), before = globalThis.structuredClone(input);
      const plan = planThing(input, identity, on, policy([{ controllerId: 'mid', id: 't1', invert }]), 1000);
      assert.equal(plan.raw, on !== invert ? 100 : 0);
      assert.deepEqual(input, before);
    });
  }
}

for (const [name, mutate, overrides] of [
  ['missing snapshot', s => {
    delete s.data;
  }],
  ['stale', s => {
    s.lastSuccessAt = -90000;
  }],
  ['future timestamp', s => {
    s.lastSuccessAt = 2000;
  }],
  ['failed read', s => {
    s.lastAttemptFailed = true;
  }],
  ['missing MID', s => {
    delete s.data.system.mid;
  }],
  ['replacement MID', s => {
    s.data.system.mid = 'replacement';
  }],
  ['missing Thing', s => {
    s.data.myThings.things = {};
  }],
  ['duplicate', s => {
    s.data.myThings.things.other = { ...s.data.myThings.things.t1 };
  }],
  ['key mismatch', s => {
    s.data.myThings.things.t1.id = 'other';
  }],
  ['capability changed', s => {
    s.data.myThings.things.t1.channelDipState = 3;
  }],
  ['invalid endpoint', s => {
    s.data.myThings.things.t1.value = 50;
  }],
  ['lighting ambiguity', s => {
    s.data.system.hasLights = true;
  }],
  ['disabled', () => {}, [{ controllerId: 'mid', id: 't1', disabled: true }]],
  ['invalid override', () => {}, [{ controllerId: 'mid', id: 't1', type: 'gate' }]],
]) {
  test('reject ' + name, () => {
    const s = state(); mutate(s);
    assert.throws(() => planThing(s, identity, true, policy(overrides), 1000));
  });
}
