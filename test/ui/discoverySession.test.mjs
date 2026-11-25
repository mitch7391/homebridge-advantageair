import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { DiscoverySession, fingerprint, sha256, canonical } from '../../homebridge-ui/public/discovery.mjs';
import { DiscoveryService } from '../../homebridge-ui/discovery-service.mjs';
import { Draft } from '../../homebridge-ui/public/draft.mjs';

const config = () => [{ platform: 'AdvantageAir', name: 'Hidden log name', future: { keep: 1 }, devices: [
  { ipAddress: '192.0.2.1', homeName: 'Same name', port: 10211, excludedLightIds: ['l1'],
    things: [{ controllerId: 'old', id: 't1', disabled: true, invert: true }], hidden: true },
  { ipAddress: '192.0.2.2', homeName: 'Same name', unknown: { preserved: true } },
] }, { platform: 'Other', opaque: 'untouched' }];
const tick = () => new Promise(resolve => globalThis.setImmediate(resolve));
const fixture = (mid = 'mid') => ({ system: { mid, hasLights: false }, aircons: {},
  myThings: { things: { t1: { id: 't1', name: '<b>Unsafe HTML</b>', channelDipState: 8, value: 100 } } } });
const host = () => ({ disableSaveButton() {}, enableSaveButton() {}, updatePluginConfig: async value => value });

async function manifest(initial) {
  return { status: 'ready', configurationProof: await fingerprint(initial[0]),
    entries: await Promise.all(initial[0].devices.map(async (d, i) => ({ token: 'opaque-' + i, proof: await fingerprint(d) }))) };
}

test('HTTP-page SHA-256 fallback matches Node for Unicode, padding boundaries and long inputs', async () => {
  for (const text of ['', 'abc', '雪🌡', ...[55, 56, 63, 64, 65, 1000, 10000].map(n => 'a'.repeat(n))]) {
    const expected = createHash('sha256').update(text).digest('hex');
    assert.equal(sha256(Buffer.from(text)), expected);
  }
  assert.equal(await fingerprint({ b: 2, a: [1, null] }), createHash('sha256').update(canonical({ a: [1, null], b: 2 })).digest('hex'));
});

test('opening initiates one authorized read per saved controller; view and repeated start never repeat', async () => {
  const initial = config(); const before = globalThis.structuredClone(initial); let reads = 0;
  const service = new DiscoveryService(async () => ({ platforms: initial }), { read: async d => {
    reads++; return fixture(d.ipAddress);
  } });
  const request = (path, body) => path === '/things/session' ? service.session() : service.discover(body.token);
  const session = new DiscoverySession(initial, [7, 9], request);
  assert.equal(reads, 0);
  const a = session.start(), b = session.start(); assert.equal(a, b); await a;
  for (let i = 0; i < 10; i++) {
    assert.equal(session.view(7, initial[0].devices[0]).status, 'present');
    assert.equal(session.view(9, initial[0].devices[1]).status, 'present');
  }
  await session.start(); assert.equal(reads, 2); assert.deepEqual(initial, before);
});

test('mismatched initial saved-config proof prevents all controller requests', async () => {
  const initial = config(); const authoritative = await manifest(initial); initial[0].devices[0].ipAddress = '192.0.2.99';
  let calls = 0;
  const session = new DiscoverySession(initial, [0, 1], async path => {
    calls++; assert.equal(path, '/things/session'); return authoritative;
  });
  await session.start(); assert.equal(calls, 1);
  assert.equal(session.view(0, initial[0].devices[0]).status, 'unavailable');
});

test('absent platform, ambiguous fingerprints and new unsaved controllers never receive tokens', async () => {
  const empty = new DiscoverySession([], [], () => assert.fail('No initial platform'));
  await empty.start();
  const initial = config(); const m = await manifest(initial); m.entries.push(m.entries[0]); let calls = 0;
  const session = new DiscoverySession(initial, [0, 1], async (path, body) => {
    if (path === '/things/session') {
      return m;
    }
    calls++; assert.equal(body.token, 'opaque-1'); return { token: body.token, status: 'absent', things: [] };
  });
  await session.start(); assert.equal(calls, 1);
  assert.equal(session.view(99, initial[0].devices[0]).reason, 'no-saved-controller');
});

test('out-of-order completions follow stable keys while tabs are removed and connection settings edited', async () => {
  const initial = config(); const draft = new Draft(initial, host()); const m = await manifest(initial);
  const completions = new Map(); const sent = [];
  const session = new DiscoverySession(initial, draft.keys, (path, body) => {
    if (path === '/things/session') {
      return Promise.resolve(m);
    }
    sent.push(body); return new Promise(resolve => completions.set(body.token, resolve));
  });
  const done = session.start();
  while (completions.size < 2) {
    await tick();
  }
  const removed = draft.keys[0], survivor = draft.keys[1];
  await draft.removeController(removed);
  completions.get('opaque-1')({ token: 'opaque-1', status: 'present', things: [{ name: 'Second' }] }); await tick();
  assert.equal(session.view(survivor, draft.block().devices[0]).things[0].name, 'Second');
  await draft.edit('ipAddress', '192.0.2.88');
  assert.equal(session.view(survivor, draft.block().devices[0]).reason, 'unsaved-controller-changes');
  completions.get('opaque-0')({ token: 'opaque-0', status: 'present', things: [{ name: 'First' }] }); await done;
  assert.equal(session.view(removed, undefined).status, 'unavailable');
  await draft.addController(); assert.equal(session.view(draft.keys.at(-1), draft.block().devices.at(-1)).status, 'unavailable');
  assert.deepEqual(sent, [{ token: 'opaque-0' }, { token: 'opaque-1' }]);
  assert.deepEqual(initial, config());
});

test('port edits suppress results; sparse override and display edits retain observations', async () => {
  const initial = config(); const m = await manifest(initial);
  const session = new DiscoverySession(initial, [0, 1], async (path, body) => path === '/things/session' ? m
    : { token: body.token, status: 'present', things: [] });
  await session.start();
  const device = initial[0].devices[0];
  assert.equal(session.view(0, { ...device, port: 2025 }).reason, 'unsaved-controller-changes');
  assert.equal(session.view(0, { ...device, port: null }).reason, 'unsaved-controller-changes');
  assert.equal(session.view(0, { ...device, things: [] }).status, 'present');
  assert.equal(session.view(0, { ...device, homeName: 'Renamed', debug: true }).status, 'present');
});

test('offline failures cached; neither opening nor failure changes the Draft queue or full configuration', async () => {
  const initial = config(); let writes = 0; let reads = 0;
  const draft = new Draft(initial, { ...host(), updatePluginConfig: () => {
    writes++;
  } });
  const m = await manifest(initial);
  const session = new DiscoverySession(initial, draft.keys, async path => {
    if (path === '/things/session') {
      return m;
    }
    reads++; throw new Error('Private network error');
  });
  await session.start(); await session.start();
  assert.equal(reads, 2); assert.equal(writes, 0);
  assert.equal(session.view(0, draft.block().devices[0]).reason, 'discovery-failed');
  assert.deepEqual(draft.snapshot(), initial);
});

test('duplicate MID conflict quarantines both results regardless of arrival order', async () => {
  const initial = config(); const m = await manifest(initial);
  const session = new DiscoverySession(initial, [0, 1], async (path, body) => path === '/things/session' ? m
    : body.token === 'opaque-1' ? { token: body.token, status: 'unavailable', things: [], conflicts: ['opaque-0', 'opaque-1'] }
      : { token: body.token, status: 'present', things: [] });
  await session.start();
  for (const i of [0, 1]) {
    assert.equal(session.view(i, initial[0].devices[i]).reason, 'duplicate-controller-identity');
  }
});

test('authoritative configuration change suppresses all earlier session results', async () => {
  const initial = config(); const m = await manifest(initial);
  const session = new DiscoverySession(initial, [0, 1], async (path, body) => path === '/things/session' ? m
    : { token: body.token, status: 'present', things: [], ...(body.token === 'opaque-1' ? { reason: 'saved-configuration-changed' } : {}) });
  await session.start();
  assert.equal(session.view(0, initial[0].devices[0]).reason, 'saved-configuration-changed');
});

test('closure settles pending UI waits and ignores late responses; reopening is a fresh session', async () => {
  const initial = config(); let resolve; let changes = 0;
  const session = new DiscoverySession(initial, [0, 1], () => new Promise(done => {
    resolve = done;
  }), () => changes++);
  const done = session.start(); await tick(); session.close(); await done;
  resolve(await manifest(initial)); await tick();
  assert.equal(changes, 1); assert.equal(session.results.size, 0);
  const next = new DiscoverySession(initial, [0, 1], async (path, body) => path === '/things/session' ? manifest(initial)
    : { token: body.token, status: 'absent', things: [] });
  await next.start(); assert.equal(next.view(1, initial[0].devices[1]).status, 'absent');
});

test('a nonresponsive UI helper has a bounded wait and no automatic retry', async () => {
  let expire; let calls = 0;
  const session = new DiscoverySession(config(), [0, 1], () => {
    calls++; return new Promise(() => {});
  }, () => {}, {
    schedule: (fn, ms) => {
      assert.equal(ms, 5000); expire = fn; return 1;
    }, cancel: () => {},
  });
  const done = session.start(); await tick(); expire(); await done; await session.start();
  assert.equal(calls, 1); assert.equal(session.reason, 'discovery-unavailable');
});

test('UI renders names as text and initializes discovery only after the form renders', async () => {
  const app = await readFile(new URL('../../homebridge-ui/public/app.mjs', import.meta.url), 'utf8');
  assert.match(app, /heading.textContent = thing.name/);
  assert.doesNotMatch(app, /innerHTML|inventories =/);
  assert.ok(app.lastIndexOf('render();') < app.indexOf('void discovery.start()'));
  const ui = await readFile(new URL('../../homebridge-ui/public/discovery.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /updatePluginConfig|savePluginConfig|enableSaveButton|disableSaveButton/);
});

test('loading notifications precede deferred responses, stay keyed and occur only once per start', async t => {
  const initial = config();
  const before = globalThis.structuredClone(initial);
  const draft = new Draft(initial, host());
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const manifestPending = deferred(), requested = deferred(), queued = deferred(), secondDisplayed = deferred();
  const reads = new Map();
  const events = [];
  let sessionCalls = 0;
  const session = new DiscoverySession(initial, draft.keys, (path, body) => {
    if (path === '/things/session') {
      sessionCalls++;
      requested.resolve();
      return manifestPending.promise;
    }
    const pending = deferred();
    reads.set(body.token, pending);
    if (reads.size === 2) {
      queued.resolve();
    }
    return pending.promise;
  }, () => {
    events.push({ entries: session.results.size,
      states: draft.keys.map((key, i) => session.view(key, draft.block().devices[i]).status) });
    if (session.view(draft.keys[1], draft.block().devices[1]).status === 'present') {
      secondDisplayed.resolve();
    }
  });
  t.after(() => session.close());
  const done = session.start();
  assert.equal(session.start(), done);
  await requested.promise;
  assert.deepEqual(events, [{ entries: 0, states: ['loading', 'loading'] }]);
  manifestPending.resolve(await manifest(initial));
  await queued.promise;
  assert.deepEqual(events.map(event => event.entries), [0, 1, 2]);
  assert.ok(events.every(event => event.states.every(state => state === 'loading')));
  assert.equal(session.start(), done);
  assert.equal(sessionCalls, 1);
  assert.equal(reads.size, 2);
  reads.get('opaque-1').resolve({ token: 'opaque-1', status: 'present', things: [{ name: 'Second' }] });
  await secondDisplayed.promise;
  assert.equal(session.view(draft.keys[1], draft.block().devices[1]).things[0].name, 'Second');
  session.close();
  const countAtClose = events.length;
  reads.get('opaque-0').resolve({ token: 'opaque-0', status: 'present', things: [{ name: 'First' }] });
  await done;
  await session.start();
  assert.equal(events.length, countAtClose);
  assert.deepEqual(initial, before);
  assert.deepEqual(draft.snapshot(), before);
});

test('default browser timers retain global receiver during initialization and pending closure', async t => {
  const initial = config(), before = globalThis.structuredClone(initial);
  let scheduled = 0, cancelled = 0, calls = 0, changes = 0, resolvePending;
  const active = new Set();
  function schedule(callback, delay) {
    assert.equal(this, globalThis, 'setTimeout receiver');
    assert.ok([5000, 325000].includes(delay));
    const timer = ++scheduled;
    active.add(timer);
    return timer;
  }
  function cancel(timer) {
    assert.equal(this, globalThis, 'clearTimeout receiver');
    assert.ok(active.delete(timer));
    cancelled++;
  }
  // Reproduce both original Firefox failures with receiver-sensitive mocks.
  const originalClock = { schedule, cancel };
  assert.throws(() => originalClock.schedule(() => {}, 5000), /setTimeout receiver/);
  assert.throws(() => originalClock.cancel(1), /clearTimeout receiver/);
  t.mock.method(globalThis, 'setTimeout', schedule);
  t.mock.method(globalThis, 'clearTimeout', cancel);
  const m = await manifest(initial);
  const session = new DiscoverySession(initial, [0, 1], async (path, body) => {
    calls++;
    return path === '/things/session' ? m : { token: body.token, status: 'absent', things: [] };
  });
  await session.start(); await session.start();
  assert.equal(calls, 3);
  assert.equal(session.view(0, initial[0].devices[0]).status, 'absent');
  const pending = new DiscoverySession(initial, [0, 1], () => new Promise(resolve => {
    resolvePending = resolve;
  }), () => changes++);
  const done = pending.start(); await tick();
  assert.equal(typeof resolvePending, 'function');
  assert.doesNotThrow(() => pending.close());
  const atClose = changes;
  resolvePending(m); await done; await tick();
  assert.equal(changes, atClose);
  assert.equal(active.size, 0);
  assert.equal(scheduled, 4); assert.equal(cancelled, 4);
  assert.deepEqual(initial, before);
});
