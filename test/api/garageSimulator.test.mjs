import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import { AdvantageAirClient } from '../../dist/api/advantageAirClient.js';

const require = createRequire(import.meta.url);

test('Extras simulator independently controls garage, gate and lights, including external changes', async t => {
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
  const address = server.address();
  const base = 'http://127.0.0.1:' + address.port;
  const url = new URL(base);
  url.searchParams.set('load', fileURLToPath(new URL('../../dev/lab/fixtures/myplace-extras.json', import.meta.url)));
  const loaded = await globalThis.fetch(url); assert.equal(loaded.status, 200); await loaded.text();
  const client = new AdvantageAirClient({ ipAddress: '127.0.0.1', port: address.port });
  const before = await client.getFreshSystemData();
  assert.deepEqual(before.aircons, {});
  assert.equal(before.myThings.things.garage1.value, 0); assert.equal(before.myThings.things.gate1.value, 100);
  await client.requestThing('garage1', 100);
  const opened = await client.getFreshSystemData();
  assert.equal(opened.myThings.things.garage1.value, 100); assert.equal(opened.myThings.things.gate1.value, 100);
  assert.deepEqual(opened.myLights, before.myLights);
  const external = new URL(base + '/setThing');
  external.searchParams.set('json', JSON.stringify({ id: 'gate1', value: 0 }));
  const response = await globalThis.fetch(external); assert.equal(response.status, 200); await response.text();
  assert.equal((await client.getFreshSystemData()).myThings.things.gate1.value, 0);
  await client.requestLight('relay1', 'state', true);
  const after = await client.getFreshSystemData();
  assert.equal(after.myLights.lights.relay1.state, 'on');
  assert.deepEqual(after.myThings, { things: { ...opened.myThings.things, gate1: { ...opened.myThings.things.gate1, value: 0 } } });
});
