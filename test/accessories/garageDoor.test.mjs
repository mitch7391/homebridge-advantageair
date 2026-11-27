import '../helpers/coordinatorClock.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, URL } from 'node:url';
import test from 'node:test';
import { GarageDoorManager } from '../../dist/accessories/garageDoorManager.js';
import { AirconCommandRejectedError } from '../../dist/api/advantageAirClient.js';
import { ControllerCoordinator } from '../../dist/api/controllerCoordinator.js';
import { AdvantageAirPlatform } from '../../dist/platform.js';
import { eligibleThing, garageDoorPolicy, planThing } from '../../dist/api/thingCommand.js';

const require = createRequire(import.meta.url);
const { HomebridgeAPI } = await import(new URL('./api.js', pathToFileURL(require.resolve('homebridge'))).href);
const fixture = JSON.parse(fs.readFileSync(new URL('../../dev/lab/fixtures/myplace-extras.json', import.meta.url), 'utf8'));
const identity = id => JSON.stringify(['AdvantageAir', fixture.system.mid, 'thing', id]);
const flush = async () => {
  for (let i = 0; i < 100; i++) {
    await Promise.resolve();
  }
};
async function setup(t, overrides) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const data = globalThis.structuredClone(fixture);
  const model = { failed: false, reject: false, apply: true };
  const writes = [];
  t.mock.method(globalThis, 'fetch', async url => {
    if (model.failed) {
      throw new Error('synthetic offline');
    }
    if (url.pathname === '/setThing') {
      const p = JSON.parse(url.searchParams.get('json')); writes.push(p);
      if (model.reject) {
        return { ok: true, status: 200, text: async () => '{"result":false}' };
      }
      if (model.apply) {
        data.myThings.things[p.id].value = p.value;
      }
    } else {
      assert.equal(url.pathname, '/getSystemData');
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  });
  const api = new HomebridgeAPI();
  const removed = [];
  t.mock.method(api, 'unregisterPlatformAccessories', (...args) => removed.push(args));
  const config = { platform: 'AdvantageAir', devices: [{ ipAddress: '192.0.2.1', things: overrides }] };
  const log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(k => [k, () => {}]));
  const platform = new AdvantageAirPlatform(log, config, api);
  t.after(() => api.emit('shutdown'));
  api.emit('didFinishLaunching'); await flush();
  const advance = async ms => {
    for (let n = 0; n < ms; n += 100) {
      t.mock.timers.tick(100); await flush();
    }
  };
  const accessory = id => platform.accessories.get(api.hap.uuid.generate(identity(id)));
  const char = (id, name) => accessory(id).getService(api.hap.Service.GarageDoorOpener).getCharacteristic(api.hap.Characteristic[name]);
  return { api, data, model, writes, config, platform, removed, advance, accessory, char };
}

test('DIP 3/10 automatically create independent native doors alongside lights with zero aircons', async t => {
  const c = await setup(t);
  assert.equal(c.platform.accessories.size, 6);
  for (const [id, open] of [['garage1', false], ['gate1', true]]) {
    assert(c.accessory(id));
    assert.equal(await c.char(id, 'CurrentDoorState').handleGetRequest(), open ? 0 : 1);
    assert.equal(await c.char(id, 'TargetDoorState').handleGetRequest(), open ? 0 : 1);
    assert.equal(await c.char(id, 'ObstructionDetected').handleGetRequest(), false);
  }
  assert.equal(c.config.devices[0].things, undefined);
});
for (const invert of [false, true]) {
  test('door commands and feedback invert exactly once: ' + invert, async t => {
    const c = await setup(t, [{ controllerId: fixture.system.mid, id: 'garage1', invert }]);
    const target = invert ? 1 : 0;
    await c.char('garage1', 'TargetDoorState').handleSetRequest(target);
    await c.advance(3000);
    assert.deepEqual(c.writes, [{ id: 'garage1', value: 100 }]);
    assert.equal(await c.char('garage1', 'CurrentDoorState').handleGetRequest(), target);
    assert.equal(c.data.myThings.things.gate1.value, 100);
  });
}
test('pending desired target never overwrites reported current; failed confirmation faults then recovers', async t => {
  const c = await setup(t); c.model.apply = false;
  await c.char('garage1', 'TargetDoorState').handleSetRequest(0);
  assert.equal(await c.char('garage1', 'CurrentDoorState').handleGetRequest(), 1);
  assert.equal(await c.char('garage1', 'TargetDoorState').handleGetRequest(), 0);
  await c.advance(31000);
  await assert.rejects(c.char('garage1', 'TargetDoorState').handleGetRequest());
  assert.equal(c.writes.length, 1);
  await c.advance(60000);
  assert.equal(await c.char('garage1', 'TargetDoorState').handleGetRequest(), 1);
});
test('rename, subtype and disable/re-enable preserve UUID; missing records retain unavailable accessory', async t => {
  const c = await setup(t); const original = c.accessory('garage1');
  c.data.myThings.things.garage1.name = 'Renamed';
  c.config.devices[0].things = [{ controllerId: fixture.system.mid, id: 'garage1', type: 'gate' }];
  await c.advance(31000);
  assert.equal(c.accessory('garage1'), original); assert.equal(original.displayName, 'Renamed');
  const record = c.data.myThings.things.garage1; delete c.data.myThings.things.garage1;
  await c.advance(31000); assert.equal(c.accessory('garage1'), original);
  await assert.rejects(c.char('garage1', 'CurrentDoorState').handleGetRequest());
  c.config.devices[0].things[0].disabled = true; await c.advance(31000);
  assert.equal(c.accessory('garage1'), undefined); assert.equal(c.removed.length, 1);
  c.data.myThings.things.garage1 = record; c.config.devices[0].things[0].disabled = false;
  await c.advance(31000); assert.equal(c.accessory('garage1').UUID, original.UUID);
});
test('external endpoint changes, offline recovery and shutdown update characteristics', async t => {
  const c = await setup(t); c.data.myThings.things.garage1.value = 100;
  await c.advance(31000); assert.equal(await c.char('garage1', 'CurrentDoorState').handleGetRequest(), 0);
  c.model.failed = true; await c.advance(31000);
  await assert.rejects(c.char('garage1', 'CurrentDoorState').handleGetRequest());
  c.model.failed = false; await c.advance(31000);
  assert.equal(await c.char('garage1', 'ObstructionDetected').handleGetRequest(), false);
  c.api.emit('shutdown'); await assert.rejects(c.char('garage1', 'CurrentDoorState').handleGetRequest());
});
test('production policy denies unsupported, partial, disabled, invalid and stale Things', () => {
  const state = () => ({ data: globalThis.structuredClone(fixture), lastAttemptFailed: false, lastSuccessAt: Date.now() });
  for (const dip of [3, 10]) {
    const s = state(); s.data.myThings.things.garage1.channelDipState = dip;
    assert.equal(planThing(s, identity('garage1'), true, garageDoorPolicy(() => undefined)).raw, 100);
  }
  for (const change of [s => {
    s.data.myThings.things.garage1.channelDipState = 8;
  },
  s => {
    s.data.myThings.things.garage1.channelDipState = 1;
  },
  s => {
    s.data.myThings.things.garage1.value = 50;
  },
  s => {
    s.data.myThings.things.bad = null;
  }, s => {
    s.lastAttemptFailed = true;
  },
  s => {
    s.lastSuccessAt -= 90000;
  }, s => {
    s.data.system.mid = 'replacement';
  }]) {
    const s = state(); change(s); assert.throws(() => eligibleThing(s, identity('garage1'), garageDoorPolicy(() => undefined)));
  }
  for (const override of [{ disabled: true }, { type: 'fan' }]) {
    assert.throws(() => eligibleThing(state(), identity('garage1'), garageDoorPolicy(() => [
      { controllerId: fixture.system.mid, id: 'garage1', ...override },
    ])));
  }
  assert.throws(() => eligibleThing(state(), identity('garage1')));
});


test('cached restoration, partial inventory and MID isolation retain correct unavailable identities', async t => {
  const api = new HomebridgeAPI();
  const cache = new Map();
  const calls = [];
  t.mock.method(api, 'registerPlatformAccessories', (...args) => calls.push(args));
  t.mock.method(api, 'unregisterPlatformAccessories', () => assert.fail('No implicit removals'));
  t.mock.method(api, 'updatePlatformAccessories', () => {});
  let state = { data: globalThis.structuredClone(fixture), lastAttemptFailed: false, lastSuccessAt: Date.now() };
  let overrides;
  const readThing = id => eligibleThing(state, id, garageDoorPolicy(() => overrides)).value.logicalValue === 100;
  const first = new GarageDoorManager(api, cache, { readThing, requestThing: () => {} }, () => overrides);
  first.update(state);
  const id = api.hap.uuid.generate(identity('garage1'));
  const cached = cache.get(id);
  const service = cached.getService(api.hap.Service.GarageDoorOpener);
  const current = service.getCharacteristic(api.hap.Characteristic.CurrentDoorState);
  first.stop();
  GarageDoorManager.prepareCachedAccessory(api, cached);
  await assert.rejects(current.handleGetRequest());
  const restored = new GarageDoorManager(api, cache, { readThing, requestThing: () => {} }, () => overrides);
  restored.update(state);
  assert.equal(cache.get(id), cached); assert.equal(calls.length, 2);
  assert.equal(await current.handleGetRequest(), 1);
  state.data.myThings.things.bad = null; restored.update(state);
  assert.equal(cache.get(id), cached); await assert.rejects(current.handleGetRequest());
  delete state.data.myThings.things.bad;
  state.data.system.mid = 'replacement';
  overrides = [{ controllerId: fixture.system.mid, id: 'garage1', disabled: true }];
  restored.update(state);
  assert.equal(cache.get(id), cached); await assert.rejects(current.handleGetRequest());
  const replacement = api.hap.uuid.generate(JSON.stringify(['AdvantageAir', 'replacement', 'thing', 'garage1']));
  assert(cache.has(replacement)); assert.notEqual(replacement, id);
  assert.equal(calls.length, 4);
  restored.stop();
});
for (const mode of ['reject', 'ambiguous']) {
  test('production garage policy preserves single dispatch and failure semantics: ' + mode, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const data = globalThis.structuredClone(fixture);
    const writes = [];
    const warnings = [];
    const client = {
      getSystemData: async () => globalThis.structuredClone(data),
      getFreshSystemData: async () => globalThis.structuredClone(data),
      requestThing: async (id, value) => {
        writes.push([id, value]);
        if (mode === 'reject') {
          throw new AirconCommandRejectedError('Rejected');
        }
        data.myThings.things[id].value = value;
        throw new Error('Ambiguous response');
      },
    };
    const coordinator = new ControllerCoordinator(client, () => {}, m => warnings.push(m), undefined, undefined,
      undefined, garageDoorPolicy(() => undefined));
    t.after(() => coordinator.stop()); coordinator.start(); await flush();
    coordinator.requestThing(identity('garage1'), true); await flush();
    for (let i = 0; i < 3; i++) {
      t.mock.timers.tick(1000); await flush();
    }
    assert.deepEqual(writes, [['garage1', 100]]);
    if (mode === 'reject') {
      assert.throws(() => coordinator.readThing(identity('garage1'), true));
      assert(warnings.length);
    } else {
      assert.equal(coordinator.readThing(identity('garage1')), true);
      assert.equal(warnings.length, 0);
    }
  });
}
