import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compatibilityFixture, inventorySummary, until } from '../../dev/compatibility/discovery-check.mjs';
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
test('real inherited Things are removed without changing fixture inputs or HVAC and light contract', () => {
  const paths = ['dev/lab/fixtures/myzone.json', 'dev/lab/fixtures/lights-large.json'];
  const bytes = paths.map(p => fs.readFileSync(p));
  const input = read(paths[0]); const outputs = read(paths[1]).myLights.lights;
  const before = JSON.stringify([input, outputs]);
  assert.equal(Object.keys(input.myThings.things).length, 2);
  const result = compatibilityFixture(input, outputs);
  assert.equal(result.myThings, undefined);
  assert.equal(result.system.hasThings, false);
  assert.equal(result.system.hasThingsBOG, false);
  assert.equal(result.system.hasThingsLight, false);
  assert.deepEqual(result.aircons, input.aircons);
  assert.equal(result.aircons.ac1.info.myZone, 1);
  assert.deepEqual(Object.keys(result.aircons.ac1.zones).sort(), ['z01', 'z02', 'z06']);
  assert.equal(result.myLights.lights.relay1.relay, true);
  assert.equal(result.myLights.lights.relay1.state, 'off');
  assert.equal(result.myLights.lights.dimmer1.value, 50);
  assert.equal(result.myLights.lights.dimmer1.state, 'off');
  assert.deepEqual(Object.keys(result.myLights.lights).sort(), ['dimmer1', 'relay1']);
  assert.equal(JSON.stringify([input, outputs]), before);
  paths.forEach((p, i) => assert.deepEqual(fs.readFileSync(p), bytes[i]));
});
const inventory = n => ({ accessories: Array.from({ length: n }, () => ({
  services: [{ type: '3E', characteristics: [{ type: '23', value: 'Synthetic' }] }],
})) });
const failure = () => Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }) });
async function campaign(sequence) {
  let now = 0, index = 0, observed = 'no enumeration';
  return until('Discovery', async () => {
    const value = sequence[Math.min(index++, sequence.length - 1)];
    if (value instanceof Error) {
      throw value;
    }
    observed = inventorySummary(value);
    return value.accessories.length === 13 && value.accessories;
  }, 600, { now: () => now, sleep: async ms => {
    now += ms;
  }, observation: () => observed });
}
test('initial fetch exception cannot mask subsequent count mismatch', async () => {
  await assert.rejects(campaign([failure(), inventory(15)]), e => /expected=13 actual=15/.test(e.message) && !/fetch failed/.test(e.message));
});
test('persistent transport failure retains cause', async () => {
  await assert.rejects(campaign([failure()]), /Error: fetch failed; cause=Error[/]ECONNREFUSED: connect refused/);
});
test('successful enumeration with wrong count gives bounded names and service types', async () => {
  await assert.rejects(campaign([inventory(15)]), /expected=13 actual=15.*Synthetic.*3E/);
  assert(inventorySummary(inventory(5000)).length < 2000);
});
test('successful discovery returns original inventory unchanged', async () => {
  const data = inventory(13); assert.equal(await campaign([data]), data.accessories);
});
test('a later exception supersedes an earlier successful mismatch', async () => {
  await assert.rejects(campaign([inventory(15), failure()]), e => /ECONNREFUSED/.test(e.message) && !/actual=15/.test(e.message));
});
test('HTTP and parsing errors remain distinct; child exit propagates immediately', async () => {
  await assert.rejects(campaign([new Error('GET loopback: HTTP 500')]), /HTTP 500/);
  await assert.rejects(campaign([new SyntaxError('Invalid JSON')]), /SyntaxError: Invalid JSON/);
  await assert.rejects(until('Discovery', () => assert.fail('Must not check'), 600,
    { children: [{ exitCode: 1, signalCode: null, log: 'synthetic.log' }] }), /Child exited/);
});
