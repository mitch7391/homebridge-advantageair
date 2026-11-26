import '../helpers/coordinatorClock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ControllerCoordinator } from '../../dist/api/controllerCoordinator.js';
import { AirconCommandRejectedError } from '../../dist/api/advantageAirClient.js';
const identity = id => JSON.stringify(['AdvantageAir', 'mid', 'thing', id]);
async function flush() {
  for (let i = 0; i < 80; i++) {
    await Promise.resolve();
  }
}
async function setup(t, mode = '', mid = 'mid', initializeClock = true) {
  if (initializeClock) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  }
  const data = { system: { mid, hasLights: false }, aircons: {}, myThings: { things: {
    a: { id: 'a', channelDipState: 8, value: 0 }, b: { id: 'b', channelDipState: 8, value: 0 },
  } } };
  const writes = [], events = [], warnings = [], snapshots = [];
  const model = { mode, preflight: undefined, reads: 0 };
  const client = {
    getSystemData: async () => globalThis.structuredClone(data),
    getFreshSystemData: async () => {
      model.reads++;
      model.preflight?.(); return globalThis.structuredClone(data);
    },
    requestZoneState: async () => assert.fail('No HVAC writes'),
    requestLight: async (id, field, value) => {
      writes.push(['light', id, value]); data.myLights.lights[id].state = value ? 'on' : 'off';
    },
    requestFanSpeed: async (id, value) => {
      writes.push(['fan', id, value]); data.aircons[id].info.fan = value;
    },
    requestThing: async (id, value) => {
      writes.push([id, value]);
      if (model.mode === 'reject') {
        throw new AirconCommandRejectedError('rejected');
      }
      if (model.mode !== 'never') {
        data.myThings.things[id].value = value;
      }
      if (model.mode === 'ambiguous') {
        throw new Error('lost response');
      }
    },
  };
  const c = new ControllerCoordinator(client, state => {
    snapshots.push(state);
    model.updated?.(state);
  }, message => warnings.push(message), e => events.push(e),
  () => model.beforeSend?.(), undefined, mode === 'denied' ? undefined : {
    overrides: () => model.overrides, qualifies: key => model.qualified !== false && key !== model.revoked, onConfirmation: e => events.push(e),
  });
  t.after(() => c.stop()); c.start(); await flush();
  const advance = async ms => {
    for (let n = 0; n < ms; n += 1000) {
      t.mock.timers.tick(1000); await flush();
    }
  };
  return { c, data, model, writes, events, warnings, snapshots, advance };
}
for (const mode of ['', 'ambiguous']) {
  test('endpoint confirmation and single dispatch ' + mode, async t => {
    const f = await setup(t, mode);
    f.c.requestThing(identity('a'), true); await flush(); await f.advance(1000);
    assert.deepEqual(f.writes, [['a', 100]]);
    assert.equal(f.events[0].identity, identity('a')); assert.equal(f.events[0].outcome, 'confirmed');
  });
}
test('production constructor denies Thing writes', async t => {
  const f = await setup(t, 'denied');
  assert.throws(() => f.c.requestThing(identity('a'), true)); assert.equal(f.writes.length, 0);
});
test('queued opposite targets coalesce without crossing Thing identities', async t => {
  const f = await setup(t);
  f.c.requestThing(identity('a'), true); f.c.requestThing(identity('a'), false); f.c.requestThing(identity('b'), true);
  await flush(); await f.advance(2000);
  assert.deepEqual(f.writes, [['b', 100]]);
});
for (const change of ['mid', 'capability', 'missing']) {
  test('fresh preflight rejects ' + change, async t => {
    const f = await setup(t);
    f.model.preflight = () => {
      if (change === 'mid') {
        f.data.system.mid = 'new';
      }
      if (change === 'capability') {
        f.data.myThings.things.a.channelDipState = 3;
      }
      if (change === 'missing') {
        delete f.data.myThings.things.a;
      }
    };
    f.c.requestThing(identity('a'), true); await flush();
    assert.equal(f.writes.length, 0); assert.equal(f.events.length, 0); assert(f.warnings.length);
  });
  test('confirmation rejects ' + change, async t => {
    const f = await setup(t);
    f.c.requestThing(identity('a'), true); await flush();
    if (change === 'mid') {
      f.data.system.mid = 'new';
    }
    if (change === 'capability') {
      f.data.myThings.things.a.channelDipState = 3;
    }
    if (change === 'missing') {
      delete f.data.myThings.things.a;
    }
    await f.advance(1000); assert.equal(f.writes.length, 1); assert.equal(f.events.length, 0);
  });
}
test('acknowledgement alone times out and cancels unresolved queued commands', async t => {
  const f = await setup(t, 'never'); f.c.requestThing(identity('a'), true); await flush();
  f.c.requestThing(identity('b'), true); await f.advance(31000);
  assert.deepEqual(f.writes, [['a', 100]]); assert.equal(f.events.length, 0); assert(f.warnings.length >= 2);
});
test('explicit rejection is not retried', async t => {
  const f = await setup(t, 'reject'); f.c.requestThing(identity('a'), true); await flush();
  assert.equal(f.writes.length, 1); assert.equal(f.events.length, 0); assert(f.warnings.length);
});
test('shutdown cancels confirmation and later writes', async t => {
  const f = await setup(t); f.c.requestThing(identity('a'), true); await flush(); f.c.stop(); await f.advance(1000);
  assert.equal(f.events.length, 0); assert.throws(() => f.c.requestThing(identity('b'), true));
});


test('expired queued intentions never revive after recovery', async t => {
  const f = await setup(t);
  f.c.requestThing(identity('a'), true);
  t.mock.timers.tick(60001);
  await flush(); await f.advance(31000);
  assert.equal(f.writes.length, 0); assert.equal(f.events.length, 0);
});

test('Thing, HVAC and light intentions share ordered execution', async t => {
  const f = await setup(t);
  f.data.myLights = { lights: { l1: { id: 'l1', state: 'off', relay: true } } };
  f.data.aircons = { ac1: { info: { uid: 'unit', name: 'AC', fan: 'low', state: 'on', mode: 'cool', myZone: 0 }, zones: {} } };
  await f.advance(30000);
  f.c.requestThing(identity('a'), true);
  f.c.requestLight(JSON.stringify(['AdvantageAir', 'mid', 'light', 'l1']), 'state', true);
  f.c.requestFanSpeed(JSON.stringify(['AdvantageAir', 'mid', 'unit', 'aircon']), 75);
  await flush(); await f.advance(4000);
  assert.deepEqual(f.writes, [['a', 100], ['light', 'l1', true], ['fan', 'ac1', 'high']]);
});

for (const phase of ['preflight', 'confirmation']) {
  test('qualification revoked at ' + phase + ' fails closed', async t => {
    const f = await setup(t); f.c.requestThing(identity('a'), true);
    if (phase === 'confirmation') {
      await flush();
    }
    f.model.qualified = false; await flush(); await f.advance(1000);
    assert.equal(f.writes.length, phase === 'preflight' ? 0 : 1);
    assert.equal(f.events.length, 0);
  });
}

test('inversion change during confirmation cannot redefine the requested endpoint', async t => {
  const f = await setup(t); f.c.requestThing(identity('a'), true); await flush();
  f.model.overrides = [{ controllerId: 'mid', id: 'a', invert: true }];
  await f.advance(1000); assert.equal(f.events.length, 0); assert.equal(f.writes.length, 1);
});

test('same Thing ID on a different controller cannot be admitted', async t => {
  const f = await setup(t);
  assert.throws(() => f.c.requestThing(JSON.stringify(['AdvantageAir', 'other', 'thing', 'a']), true));
  assert.equal(f.writes.length, 0);
});


for (const initial of [0, 100]) {
  test('accepted raw target survives queued inversion change, including unchanged path ' + initial, async t => {
    const f = await setup(t);
    f.data.myThings.things.a.value = initial;
    f.c.requestThing(identity('a'), true);
    f.model.overrides = [{ controllerId: 'mid', id: 'a', invert: true }];
    await flush();
    assert.equal(f.writes.length, 0);
    assert.equal(f.events.length, 0);
    assert(f.warnings.some(w => w.includes('accepted endpoint')));
  });
}

test('explicit replacement under changed inversion does not coalesce with incompatible target', async t => {
  const f = await setup(t);
  f.c.requestThing(identity('a'), true);
  f.model.overrides = [{ controllerId: 'mid', id: 'a', invert: true }];
  f.c.requestThing(identity('a'), true);
  f.data.myThings.things.a.value = 100;
  await flush(); await f.advance(1000);
  assert.deepEqual(f.writes, [['a', 0]]);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].outcome, 'confirmed');
});

for (const change of ['qualification', 'inversion']) {
  test('final local rejection is not ambiguous delivery: ' + change, async t => {
    const f = await setup(t);
    f.model.beforeSend = () => {
      if (change === 'qualification') {
        f.model.revoked = identity('a');
      } else {
        f.model.overrides = [{ controllerId: 'mid', id: 'a', invert: true }];
      }
    };
    f.c.requestThing(identity('a'), true);
    f.c.requestThing(identity('b'), true);
    await flush();
    assert.deepEqual(f.writes, [['b', 100]]);
    assert.equal(f.model.reads, 2, 'only two preflight reads; no local-failure reconciliation');
    assert.equal(f.events.length, 0);
    assert.equal(f.warnings.length, 1);
    assert(!f.warnings[0].includes('Controller rejected'));
    await f.advance(1000);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].identity, identity('b'));
  });
}

for (const invalid of ['missing', 'capability']) {
  test('confirmation publishes valid controller snapshot despite invalid Thing: ' + invalid, async t => {
    const f = await setup(t);
    f.c.requestThing(identity('a'), true); await flush();
    if (invalid === 'missing') {
      delete f.data.myThings.things.a;
    } else {
      f.data.myThings.things.a.channelDipState = 3;
    }
    await f.advance(1000);
    assert.deepEqual(f.snapshots.at(-1).data, f.data);
    assert.equal(f.snapshots.at(-1).lastAttemptFailed, false);
    assert.equal(f.events.length, 0);
    assert.equal(f.warnings.length, 1);
  });
}

test('in-flight opposite target confirms supersession then final raw endpoint', async t => {
  const f = await setup(t);
  f.c.requestThing(identity('a'), true); await flush();
  f.c.requestThing(identity('a'), false);
  await f.advance(2000);
  assert.deepEqual(f.writes, [['a', 100], ['a', 0]]);
  assert.deepEqual(f.events.map(e => e.superseded), [true, false]);
  assert.equal(f.data.myThings.things.a.value, 0);
});

test('independent coordinators isolate identical Thing IDs on different MIDs', async t => {
  const first = await setup(t);
  const second = await setup(t, '', 'other', false);
  first.c.requestThing(identity('a'), true);
  second.c.requestThing(JSON.stringify(['AdvantageAir', 'other', 'thing', 'a']), true);
  await flush(); await first.advance(1000);
  assert.deepEqual(first.writes, [['a', 100]]);
  assert.deepEqual(second.writes, [['a', 100]]);
  assert.notEqual(first.events[0].identity, second.events[0].identity);
});

test('shutdown from observation callback cannot confirm a Thing', async t => {
  const f = await setup(t);
  f.c.requestThing(identity('a'), true); await flush();
  f.model.updated = () => f.c.stop();
  await f.advance(1000);
  assert.equal(f.events.length, 0);
});
