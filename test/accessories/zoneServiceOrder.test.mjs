import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { zoneControlService } from '../../dist/accessories/zoneLayout.js';
import { ZoneTemperatureAccessory } from '../../dist/accessories/zoneTemperatureAccessory.js';

const require = createRequire(import.meta.url);
const hap = require('@homebridge/hap-nodejs');
const { IdentifierCache } = require('@homebridge/hap-nodejs/dist/lib/model/IdentifierCache.js');
const api = { hap };
const { Service: S, Characteristic: C } = hap;
const types = ['switch-light', 'lights', 'fans'];
const constructor = type => type === 'fans' ? S.Fan : type === 'lights' ? S.Lightbulb : S.Switch;

// Use real HAP services with the same public delegation as Homebridge's PlatformAccessory.
// Nothing is published, paired or written to HAP storage by this fixture.
function wrap(accessory) {
  return {
    UUID: accessory.UUID, displayName: accessory.displayName,
    context: { advantageAirZoneSwitch: true, advantageAirLinkedTemperature: true },
    get services() {
      return accessory.services;
    },
    getService: (...args) => accessory.getService(...args),
    addService: (...args) => accessory.addService(...args),
    removeService: service => accessory.removeService(service),
  };
}

function fixture(type, temperatureFirst = false) {
  const accessory = new hap.Accessory('Living Zone', hap.uuid.generate('zone-order-regression'));
  const control = new (constructor(type))('Living Zone');
  const temperature = new S.TemperatureSensor('Living Temperature');
  temperature.getCharacteristic(C.StatusFault);
  for (const service of temperatureFirst ? [temperature, control] : [control, temperature]) {
    accessory.addService(service);
  }
  control.setPrimaryService(true);
  control.addLinkedService(temperature);
  return { accessory, control, temperature, platform: wrap(accessory) };
}

function assertTopology(accessory, type) {
  const control = accessory.getService(constructor(type));
  const temperature = accessory.getService(S.TemperatureSensor);
  assert.deepEqual(accessory.services.map(s => s.UUID), [S.AccessoryInformation.UUID, control.UUID, temperature.UUID]);
  assert.deepEqual(accessory.services.filter(s => s.isPrimaryService), [control]);
  assert.deepEqual(control.linkedServices, [temperature]);
  assert.deepEqual(temperature.linkedServices, []);
}

// Exercise HAP's actual identifier assignment/expiry routines rather than inventing IDs.
// Calling the routine in a test does not change private fields or publish a bridge.
function identifiers(accessory, cache) {
  const bridge = new hap.Bridge('Test Bridge', hap.uuid.generate('zone-order-test-bridge'));
  bridge.addBridgedAccessory(accessory);
  cache.startTrackingUsage();
  bridge._assignIDs(cache);
  cache.stopTrackingUsageAndExpireUnused();
  const temperature = accessory.getService(S.TemperatureSensor);
  const result = { uuid: accessory.UUID, aid: accessory.aid, temperature: temperature.iid,
    characteristics: temperature.characteristics.map(c => [c.UUID, c.iid]) };
  bridge.removeBridgedAccessory(accessory);
  return result;
}

for (const from of types) {
  for (const to of types.filter(type => type !== from)) {
    test(`same sensor object and real HAP IDs survive ${from} -> ${to} and repeated cache restoration`, async () => {
      const f = fixture(from);
      const cache = new IdentifierCache('AA:00:00:00:00:01');
      const before = identifiers(f.accessory, cache);
      const characteristics = [...f.temperature.characteristics];
      const control = zoneControlService(api, f.platform, to, false);
      assertTopology(f.accessory, to);
      assert.equal(f.accessory.getService(S.TemperatureSensor), f.temperature);
      assert.deepEqual(f.temperature.characteristics, characteristics);
      assert.deepEqual(f.control.linkedServices, [], 'removed control must not retain a sensor link');
      assert.deepEqual(identifiers(f.accessory, cache), before);
      const wire = (await f.accessory.toHAP(undefined, false))[0];
      assert.deepEqual(wire.services.map(s => s.iid), f.accessory.services.map(s => s.iid));
      assert.equal(wire.services[1].primary, true);
      assert.deepEqual(wire.services[1].linked, [before.temperature]);
      assert.equal(wire.services[2].primary, undefined);
      assert.equal(wire.services[1].iid, control.iid);
      let restored = f.accessory;
      for (let restart = 0; restart < 3; restart++) {
        restored = hap.Accessory.deserialize(hap.Accessory.serialize(restored));
        const events = [];
        restored.on('service-configurationChange', event => events.push(event));
        // A bridge makes HAP emit configuration events rather than queue advertisement timers.
        const bridge = new hap.Bridge('Restore Bridge', hap.uuid.generate('restore-bridge'));
        bridge.addBridgedAccessory(restored);
        const services = [...restored.services];
        zoneControlService(api, wrap(restored), to, false);
        assert.deepEqual(restored.services, services);
        assert.deepEqual(events, [], 'correct restored topology must not be mutated');
        bridge.removeBridgedAccessory(restored);
        assertTopology(restored, to);
        assert.deepEqual(identifiers(restored, cache), before);
      }
    });
  }
}

for (const type of types) {
  test(`repair a cached temperature-first ${type} without replacing either service`, () => {
    const f = fixture(type, true);
    const cache = new IdentifierCache('AA:00:00:00:00:02');
    const before = identifiers(f.accessory, cache);
    const control = zoneControlService(api, f.platform, type, false);
    assert.equal(control, f.control);
    assert.equal(f.accessory.getService(S.TemperatureSensor), f.temperature);
    assertTopology(f.accessory, type);
    assert.deepEqual(identifiers(f.accessory, cache), before);
  });
}

test('correct order with missing links or incorrect primary flags is repaired without service replacement', () => {
  const f = fixture('lights');
  f.control.removeLinkedService(f.temperature);
  f.temperature.setPrimaryService(true);
  const services = [...f.accessory.services];
  zoneControlService(api, f.platform, 'lights', false);
  assertTopology(f.accessory, 'lights');
  assert.deepEqual(f.accessory.services, services);
});

test('sensor reconciliation is not applied to unmarked or percentage-control accessories', () => {
  for (const percentage of [false, true]) {
    const f = fixture('lights', true);
    if (!percentage) {
      delete f.platform.context.advantageAirLinkedTemperature;
    }
    const before = hap.Accessory.serialize(f.accessory);
    zoneControlService(api, f.platform, 'lights', percentage);
    assert.deepEqual(hap.Accessory.serialize(f.accessory), before);
  }
});

test('reattachment retains temperature handlers, values, fault reporting and accessory notifications', async () => {
  const f = fixture('switch-light');
  const bridge = new hap.Bridge('Notification Bridge', hap.uuid.generate('notification-bridge'));
  bridge.addBridgedAccessory(f.accessory);
  const state = { lastSuccessAt: Date.now(), lastAttemptFailed: false,
    data: { aircons: { ac1: { zones: { z01: { type: 1, error: 0, measuredTemp: 22 } } } } } };
  const handler = new ZoneTemperatureAccessory(api, f.platform, { airconKey: 'ac1', zoneKey: 'z01', getState: () => state });
  handler.update();
  const temperature = f.temperature.getCharacteristic(C.CurrentTemperature);
  const fault = f.temperature.getCharacteristic(C.StatusFault);
  const values = [temperature.value, fault.value];
  const notifications = [];
  f.accessory.on('service-characteristic-change', event => notifications.push(event));
  zoneControlService(api, f.platform, 'lights', false);
  assert.deepEqual([temperature.value, fault.value], values);
  assert.equal(await temperature.handleGetRequest(), 22);
  state.data.aircons.ac1.zones.z01.measuredTemp = 23;
  handler.update();
  assert.equal(await temperature.handleGetRequest(), 23);
  assert.equal(notifications.filter(e => e.characteristic === temperature && e.newValue === 23).length, 1);
  state.data.aircons.ac1.zones.z01.error = 3;
  handler.update();
  assert.equal(await fault.handleGetRequest(), C.StatusFault.GENERAL_FAULT);
  await assert.rejects(temperature.handleGetRequest());
  zoneControlService(api, f.platform, 'fans', false);
  await assert.rejects(temperature.handleGetRequest());
  assert.equal(await fault.handleGetRequest(), C.StatusFault.GENERAL_FAULT);
  state.data.aircons.ac1.zones.z01.error = 0;
  handler.update();
  assert.equal(await temperature.handleGetRequest(), 23);
  assert.equal(await fault.handleGetRequest(), C.StatusFault.NO_FAULT);
  state.lastSuccessAt -= 90000;
  handler.update();
  await assert.rejects(temperature.handleGetRequest());
});
