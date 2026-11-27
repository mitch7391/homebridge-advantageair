import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';

export function compatibilityFixture(input, outputs) {
  const fixture = globalThis.structuredClone(input);
  assert.ok(fixture.aircons?.ac1?.info && Object.keys(fixture.aircons.ac1.zones).length > 0);
  const relay = Object.values(outputs).find(light => light.relay === true);
  const dimmer = Object.values(outputs).find(light => typeof light.value === 'number');
  assert.ok(relay && (relay.value === undefined || relay.value === null));
  assert.ok(dimmer && dimmer.relay !== true && Number.isInteger(dimmer.value) && dimmer.value >= 0 && dimmer.value <= 100);
  // This campaign deliberately covers HVAC and ordinary lighting, not Things.
  delete fixture.myThings;
  for (const key of ['hasThings', 'hasThingsBOG', 'hasThingsLight']) {
    fixture.system[key] = false;
  }
  fixture.myLights = { lights: {
    relay1: { ...relay, id: 'relay1', name: 'Relay Output', state: 'off' },
    dimmer1: { ...dimmer, id: 'dimmer1', name: 'Dimmer Output', state: 'off', value: 50 },
  } };
  fixture.system.hasLights = true;
  return fixture;
}
const text = value => Array.from(String(value ?? '').slice(0, 160), c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c).join('');
export function inventorySummary(data) {
  assert.ok(Array.isArray(data?.accessories), 'HAP response has no accessories array');
  const items = data.accessories.slice(0, 20).map(a => ({
    name: text(a.services?.find(s => s.type === '3E' || s.type?.toUpperCase().startsWith('0000003E-'))
      ?.characteristics?.find(c => c.type === '23' || c.type?.toUpperCase().startsWith('00000023-'))?.value),
    services: (a.services || []).slice(0, 16).map(s => text(s.type)),
  }));
  return 'HAP inventory expected=13 actual=' + data.accessories.length + ' ' + JSON.stringify(items);
}
export async function until(description, check, timeout = 30000, options = {}) {
  const { children = [], now = Date.now, sleep = wait, observation = () => 'predicate unsatisfied' } = options;
  const deadline = now() + timeout;
  let latest = 'no completed check';
  while (now() < deadline) {
    for (const child of children) {
      assert.ok(child.stopping || child.exitCode === null && child.signalCode === null, 'Child exited; see ' + child.log);
    }
    try {
      const result = await check();
      if (result) {
        return result;
      }
      latest = observation();
    } catch (error) {
      latest = text(error.name) + ': ' + text(error.message);
      if (error.cause) {
        latest += '; cause=' + text(error.cause.name) + '/' + text(error.cause.code) + ': ' + text(error.cause.message);
      }
    }
    await sleep(200);
  }
  throw new Error(description + ' timed out: ' + latest);
}
