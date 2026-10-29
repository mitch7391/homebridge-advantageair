import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { zoneControlService } from '../../dist/accessories/zoneLayout.js';
import { ZoneTemperatureManager } from '../../dist/accessories/zoneTemperatureManager.js';
import { ZoneSwitchManager } from '../../dist/accessories/zoneSwitchManager.js';

const require = createRequire(import.meta.url);
const hap = require('@homebridge/hap-nodejs');
const { IdentifierCache } = require('@homebridge/hap-nodejs/dist/lib/model/IdentifierCache.js');
const { Service: S, Characteristic: C } = hap;
const types = ['switch-light', 'lights', 'fans'];
const kind = type => type === 'fans' ? S.Fan : type === 'lights' ? S.Lightbulb : S.Switch;
const clone = value => JSON.parse(JSON.stringify(value));
const identity = mid => JSON.stringify(['AdvantageAir', mid, 'unit', 'zone', 'z01']);
const controlUUID = mid => hap.uuid.generate(JSON.stringify([identity(mid), 'zone-switch']));
function state(mid = 'controller') {
  return { lastAttemptFailed: false, lastSuccessAt: Date.now(), data: {
    system: { mid }, aircons: { ac1: { info: { uid: 'unit', name: 'Aircon' },
      zones: { z01: { number: 1, name: 'Living', type: 1, error: 0, measuredTemp: 22, state: 'open', value: 80 } },
    } },
  } };
}
function wrap(accessory, context) {
  return { UUID: accessory.UUID, displayName: accessory.displayName, context,
    get services() {
      return accessory.services;
    },
    getService: (...args) => accessory.getService(...args),
    addService: (...args) => accessory.addService(...args),
    removeService: service => accessory.removeService(service),
  };
}
function fixture(type, temperatureFirst = false, mid = 'controller') {
  const accessory = new hap.Accessory('Living Zone', controlUUID(mid));
  const control = new (kind(type))('Living Zone');
  const temperature = new S.TemperatureSensor('Living Temperature');
  temperature.getCharacteristic(C.StatusFault);
  for (const service of temperatureFirst ? [temperature, control] : [control, temperature]) {
    accessory.addService(service);
  }
  control.setPrimaryService(true); control.addLinkedService(temperature);
  const platform = wrap(accessory, { advantageAirZoneSwitch: true, advantageAirLinkedTemperature: true, advantageAirZoneControlType: type });
  return { accessory, platform, temperature };
}
function manager(fixtures) {
  const saved = [];
  const api = { hap, updatePlatformAccessories: items => saved.push(...items.map(a => clone(a.context))) };
  const accessories = new Map(fixtures.map(f => [f.platform.UUID, f.platform]));
  const instance = new ZoneTemperatureManager(api, accessories, undefined, {}, true);
  return { api, instance, saved };
}
function allocate(fixtures, cache) {
  // Existing test seam: invoke HAP's actual allocation/expiry implementation.
  // No IID fields are assigned by the test, and no bridge is published.
  const bridge = new hap.Bridge('Identifier Test', hap.uuid.generate('temperature-identity-bridge'));
  for (const f of fixtures) {
    bridge.addBridgedAccessory(f.accessory);
  }
  cache.startTrackingUsage(); bridge._assignIDs(cache); cache.stopTrackingUsageAndExpireUnused();
  const results = fixtures.map(f => ({ uuid: f.accessory.UUID, aid: f.accessory.aid,
    services: f.accessory.services.map(s => ({ uuid: s.UUID, iid: s.iid, subtype: s.subtype,
      primary: !!s.isPrimaryService, linked: s.linkedServices.map(l => l.iid), chars: s.characteristics.map(c => [c.UUID, c.iid]) })),
  }));
  for (const f of fixtures) {
    bridge.removeBridgedAccessory(f.accessory);
  }
  return results;
}
function assertOrdered(f, type) {
  const control = f.accessory.getService(kind(type));
  const temp = f.accessory.getService(S.TemperatureSensor);
  assert.deepEqual(f.accessory.services.map(s => s.UUID), [S.AccessoryInformation.UUID, control.UUID, temp.UUID]);
  assert.deepEqual(f.accessory.services.filter(s => s.isPrimaryService), [control]);
  assert.deepEqual(control.linkedServices, [temp]); assert.deepEqual(temp.linkedServices, []);
  assert.ok(control.iid < temp.iid);
}
function change(m, f, type) {
  zoneControlService(m.api, f.platform, type, false);
  f.platform.context.advantageAirZoneControlType = type;
}
function restore(f) {
  const accessory = hap.Accessory.deserialize(clone(hap.Accessory.serialize(f.accessory)));
  return { accessory, platform: wrap(accessory, clone(f.platform.context)), temperature: accessory.getService(S.TemperatureSensor) };
}
function disklessPersistence(t) {
  const memory = new Map();
  t.mock.method(hap.HAPStorage, 'storage', () => ({
    getItem: key => memory.has(key) ? clone(memory.get(key)) : undefined,
    setItemSync: (key, value) => memory.set(key, clone(value)),
  }));
}

for (const from of types) {
  for (const to of types.filter(type => type !== from)) {
    test(`linked ${from} -> ${to}: new temperature IDs once, same objects and stable persisted restarts`, async t => {
      disklessPersistence(t);
      let f = fixture(from), untouched = fixture('switch-light', false, 'other');
      let cache = new IdentifierCache('AA:01:00:00:00:01');
      const before = allocate([f, untouched], cache);
      const m = manager([f]); m.instance.update(state()); m.saved.length = 0;
      const objects = [...f.temperature.characteristics], context = clone(f.platform.context);
      change(m, f, to);
      // Replacing a control alone is not authorised to migrate a sensor before validation.
      assert.equal(f.temperature.subtype, undefined);
      m.instance.update(state());
      const subtype = f.temperature.subtype; assert.match(subtype, /^aa-linked-temperature-/);
      assert.equal(f.accessory.getService(S.TemperatureSensor), f.temperature);
      assert.deepEqual(f.temperature.characteristics, objects);
      for (let i = 0; i < 5; i++) {
        m.instance.update(state());
      }
      assert.equal(f.temperature.subtype, subtype); assert.equal(m.saved.length, 1);
      const after = allocate([f, untouched], cache); assertOrdered(f, to);
      assert.equal(after[0].uuid, before[0].uuid); assert.equal(after[0].aid, before[0].aid);
      assert.notEqual(after[0].services[2].iid, before[0].services[2].iid);
      assert.ok(after[0].services[2].chars.every(([, iid]) => !before[0].services[2].chars.some(([, old]) => iid === old)));
      assert.deepEqual(after[1], before[1]);
      assert.deepEqual(f.platform.context, { ...context, advantageAirZoneControlType: to });
      const serialized = clone(hap.Accessory.serialize(f.accessory));
      m.instance.update(state()); assert.deepEqual(clone(hap.Accessory.serialize(f.accessory)), serialized);
      assert.equal(m.saved.length, 1);
      for (let i = 0; i < 3; i++) {
        cache.save(); cache = IdentifierCache.load(cache.username);
        f = restore(f); untouched = restore(untouched);
        const next = manager([f]);
        ZoneTemperatureManager.prepareCachedAccessory(next.api, f.platform);
        ZoneSwitchManager.prepareCachedAccessory(next.api, f.platform);
        await assert.rejects(f.temperature.getCharacteristic(C.CurrentTemperature).handleGetRequest());
        assert.deepEqual(allocate([f, untouched], cache), after);
        next.instance.update(state());
        assert.equal(await f.temperature.getCharacteristic(C.CurrentTemperature).handleGetRequest(), 22);
        assert.equal(f.temperature.subtype, subtype); assertOrdered(f, to);
        assert.deepEqual(allocate([f, untouched], cache), after);
      }
    });
  }
}

for (const type of types) {
  test(`already affected ${type} is repaired once, only after identity/capability validation`, () => {
    const f = fixture(type, true), m = manager([f]), cache = new IdentifierCache('AA:01:00:00:00:02');
    const before = allocate([f], cache)[0];
    ZoneTemperatureManager.prepareCachedAccessory(m.api, f.platform);
    ZoneSwitchManager.prepareCachedAccessory(m.api, f.platform);
    assert.equal(f.temperature.subtype, undefined);
    m.instance.update({ lastAttemptFailed: true }); assert.equal(f.temperature.subtype, undefined);
    const invalid = state(); delete invalid.data.system.mid;
    assert.throws(() => m.instance.update(invalid)); assert.equal(f.temperature.subtype, undefined);
    const missing = state(); delete missing.data.aircons.ac1.zones.z01.type;
    m.instance.update(missing); assert.equal(f.temperature.subtype, undefined);
    m.instance.update(state()); const subtype = f.temperature.subtype;
    for (let i = 0; i < 5; i++) {
      m.instance.update(state());
    }
    assert.equal(f.temperature.subtype, subtype);
    allocate([f], cache); assertOrdered(f, type);
    assert.equal(f.accessory.getService(kind(type)).iid, before.services[2].iid);
    const after = allocate([f], cache); m.saved.length = 0;
    for (let i = 0; i < 5; i++) {
      m.instance.update(state());
    }
    assert.deepEqual(allocate([f], cache), after); assert.equal(m.saved.length, 0);
  });
}

test('unallocated cached services defer repair until normal allocation; existing binding does not hide repair', () => {
  let f = fixture('fans', true); const cache = new IdentifierCache('AA:01:00:00:00:03');
  allocate([f], cache); f = restore(f);
  const m = manager([f]); m.instance.update(state());
  assert.equal(f.temperature.subtype, undefined, 'null IIDs are not evidence of wrong order');
  allocate([f], cache); m.instance.update(state());
  assert.match(f.temperature.subtype, /^aa-linked-temperature-/);
  allocate([f], cache); assertOrdered(f, 'fans');
});

test('correct unchanged layouts do not migrate services, metadata or cache on polling and sensor faults', () => {
  const f = fixture('fans'), m = manager([f]), cache = new IdentifierCache('AA:01:00:00:00:04');
  allocate([f], cache); m.instance.update(state());
  const ids = allocate([f], cache), context = clone(f.platform.context), services = [...f.accessory.services];
  m.saved.length = 0;
  for (const s of [state(), { lastAttemptFailed: true }, state()]) {
    m.instance.update(s);
  }
  const fault = state(); fault.data.aircons.ac1.zones.z01.error = 3; m.instance.update(fault);
  assert.equal(f.temperature.subtype, undefined); assert.deepEqual(allocate([f], cache), ids);
  assert.deepEqual(f.platform.context, context); assert.deepEqual(f.accessory.services, services); assert.equal(m.saved.length, 0);
});

test('retained handler survives migration, fault/dropout/staleness/recovery and forwards each update once', async () => {
  const f = fixture('switch-light'), m = manager([f]), cache = new IdentifierCache('AA:01:00:00:00:05');
  allocate([f], cache); m.instance.update(state());
  const temp = f.temperature.getCharacteristic(C.CurrentTemperature), fault = f.temperature.getCharacteristic(C.StatusFault);
  const faultState = state(); faultState.data.aircons.ac1.zones.z01.error = 3;
  m.instance.update(faultState); change(m, f, 'fans'); m.instance.update(faultState);
  assert.equal(f.temperature.getCharacteristic(C.CurrentTemperature), temp);
  await assert.rejects(temp.handleGetRequest()); assert.equal(await fault.handleGetRequest(), 1);
  allocate([f], cache); const subtype = f.temperature.subtype;
  const bridge = new hap.Bridge('Event Bridge', hap.uuid.generate('temperature-events')); bridge.addBridgedAccessory(f.accessory);
  const events = []; f.accessory.on('service-characteristic-change', event => events.push(event));
  m.instance.update(state());
  const next = state(); next.data.aircons.ac1.zones.z01.measuredTemp = 23; m.instance.update(next);
  assert.equal(await temp.handleGetRequest(), 23);
  assert.equal(events.filter(e => e.characteristic === temp && e.newValue === 23).length, 1);
  const missing = state(); delete missing.data.aircons.ac1.zones.z01.type; m.instance.update(missing);
  await assert.rejects(temp.handleGetRequest());
  const stale = state(); stale.lastSuccessAt -= 90001; m.instance.update(stale); await assert.rejects(temp.handleGetRequest());
  m.instance.update({ lastAttemptFailed: true }); await assert.rejects(temp.handleGetRequest());
  m.instance.update(state()); assert.equal(await temp.handleGetRequest(), 22); assert.equal(await fault.handleGetRequest(), 0);
  assert.equal(f.temperature.subtype, subtype); bridge.removeBridgedAccessory(f.accessory);
});

test('successive layout changes before allocation choose a new generation only for each actual change', () => {
  const f = fixture('switch-light'), m = manager([f]), cache = new IdentifierCache('AA:01:00:00:00:06');
  allocate([f], cache); m.instance.update(state()); const subtypes = new Set();
  for (const type of ['fans', 'lights', 'switch-light', 'fans']) {
    change(m, f, type); m.instance.update(state()); const subtype = f.temperature.subtype;
    assert.ok(!subtypes.has(subtype)); subtypes.add(subtype);
    m.instance.update(state()); assert.equal(f.temperature.subtype, subtype);
  }
  allocate([f], cache); assertOrdered(f, 'fans');
});

test('saved subtype survives restart before identifier allocation without a second migration', () => {
  let f = fixture('switch-light'); const m = manager([f]), cache = new IdentifierCache('AA:01:00:00:00:07');
  allocate([f], cache); m.instance.update(state()); change(m, f, 'fans'); m.instance.update(state());
  const subtype = f.temperature.subtype; f = restore(f);
  allocate([f], cache); const next = manager([f]); next.instance.update(state());
  assert.equal(f.temperature.subtype, subtype); assertOrdered(f, 'fans');
});

test('interruption after control persistence but before sensor migration repairs on recovery', () => {
  let f = fixture('switch-light'); const m = manager([f]), cache = new IdentifierCache('AA:01:00:00:00:08');
  allocate([f], cache); m.instance.update(state()); change(m, f, 'fans'); f = restore(f);
  allocate([f], cache); const next = manager([f]); next.instance.update(state());
  allocate([f], cache); assertOrdered(f, 'fans');
  const subtype = f.temperature.subtype; next.instance.update(state()); assert.equal(f.temperature.subtype, subtype);
});
