import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import test from 'node:test';
import { AdvantageAirPlatform } from '../../dist/platform.js';
import { AdvantageAirClient } from '../../dist/api/advantageAirClient.js';

const require = createRequire(import.meta.url);
const { HomebridgeAPI } = await import(new URL('./api.js', pathToFileURL(require.resolve('homebridge'))).href);

test('all zone layout combinations use the existing simulator transport and MyZone protection', async t => {
  const argv = process.argv;
  const port = process.env.PORT;
  let server;
  t.mock.method(globalThis.console, 'log', () => {});
  try {
    process.env.PORT = '0';
    process.argv = [process.execPath, fileURLToPath(new URL('../../dev/lab/AirConServer.cjs', import.meta.url))];
    server = await require('../../dev/lab/AirConServer.cjs');
  } finally {
    process.argv = argv;
    if (port === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = port;
    }
  }
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  assert.equal(server.address().address, '127.0.0.1');
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const client = new AdvantageAirClient({ ipAddress: '127.0.0.1', port: address.port });
  const until = async predicate => {
    const end = Date.now() + 12000;
    while (!await predicate()) {
      assert.ok(Date.now() < end, 'Simulator operation timed out.');
      await wait(25);
    }
  };
  for (const type of ['switch-light', 'lights', 'fans']) {
    for (const linked of [false, true]) {
      await t.test(`${type}, linked=${linked}`, async () => {
        const reset = await globalThis.fetch(base + '/reInit');
        assert.equal(reset.status, 200);
        await reset.text();
        const load = new URL(base);
        load.searchParams.set('load', fileURLToPath(new URL('../../dev/lab/fixtures/myzone.json', import.meta.url)));
        const response = await globalThis.fetch(load);
        assert.equal(response.status, 200);
        await response.text();
        const api = new HomebridgeAPI();
        const messages = [];
        const log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, (...args) => messages.push(args.join(' '))]));
        const platform = new AdvantageAirPlatform(log, { platform: 'AdvantageAir', devices: [{
          ipAddress: '127.0.0.1', port: address.port, zoneControlType: type, linkZoneTemperatures: linked,
        }] }, api);
        const get = (zone, role) => platform.accessories.get(api.hap.uuid.generate(JSON.stringify([
          JSON.stringify(['AdvantageAir', 'aa-percentage-lab-controller', 'aa-percentage-lab-ac1', 'zone', zone]), role,
        ])));
        try {
          api.emit('didFinishLaunching');
          await until(() => get('z06', 'zone-percentage'));
          const { Service: S, Characteristic: C } = api.hap;
          const control = get('z06', 'zone-percentage').getService(type === 'fans' ? S.Fan : S.Lightbulb);
          await control.getCharacteristic(type === 'fans' ? C.RotationSpeed : C.Brightness).handleSetRequest(48);
          await until(async () => (await client.getFreshSystemData()).aircons.ac1.zones.z06.value === 50);
          const sensorKind = type === 'fans' ? S.Fan : type === 'lights' ? S.Lightbulb : S.Switch;
          await get('z02', 'zone-switch').getService(sensorKind).getCharacteristic(C.On).handleSetRequest(true);
          await until(async () => (await client.getFreshSystemData()).aircons.ac1.zones.z02.state === 'open');
          await assert.rejects(get('z01', 'zone-switch').getService(sensorKind).getCharacteristic(C.On).handleSetRequest(false));
          const data = await client.getFreshSystemData();
          assert.equal(data.aircons.ac1.info.myZone, 1);
          assert.equal(data.aircons.ac1.zones.z01.state, 'open');
          const temperature = (linked ? get('z01', 'zone-switch') : get('z01', 'temperature')).getService(S.TemperatureSensor);
          assert.equal(await temperature.getCharacteristic(C.CurrentTemperature).handleGetRequest(), 23);
          assert.equal(!!get('z01', 'temperature'), !linked);
          assert.equal(messages.some(line => line.includes('accessory update failed')), false);
        } finally {
          api.emit('shutdown');
        }
      });
    }
  }
});
