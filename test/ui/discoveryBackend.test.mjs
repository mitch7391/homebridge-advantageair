import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { fork } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiscoveryService, DiscoveryError, LIMITS, savedEndpoint, readController } from '../../homebridge-ui/discovery-service.mjs';
import { readSavedConfiguration } from '../../homebridge-ui/server.js';

const device = (ipAddress = '192.0.2.1', extra = {}) => ({ ipAddress, port: 2025, ...extra });
const config = devices => ({ platforms: [{ platform: 'AdvantageAir', name: 'Synthetic', devices }, { platform: 'Other', hidden: true }] });
const data = (mid = 'synthetic-mid', things = { t1: { id: 't1', name: '<script>synthetic</script>', channelDipState: 8, value: 100 } }) =>
  ({ system: { mid, hasAircons: false, hasLights: false }, aircons: {}, myThings: { things } });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => globalThis.setImmediate(resolve));

test('saved manifest authorizes opaque tokens only; initialization and reads are cached', async () => {
  const source = config([device()]);
  const before = globalThis.structuredClone(source);
  let calls = 0;
  const service = new DiscoveryService(async () => source, { read: async () => {
    calls++; return data();
  } });
  assert.equal(calls, 0);
  const [a, b] = await Promise.all([service.session(), service.session()]);
  assert.deepEqual(a, b);
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(a).includes('192.0.2.1'), false);
  assert.equal((await service.discover('192.0.2.1')).reason, 'unauthorized');
  const token = a.entries[0].token;
  const result = await Promise.all([service.discover(token), service.discover(token)]);
  assert.equal(calls, 1);
  assert.deepEqual(result[0], result[1]);
  assert.deepEqual(source, before);
  assert.equal(result[0].things[0].operational, false);
  assert.equal(result[0].things[0].physicalState, 'unknown');
});

test('one in-flight read; independent failure does not cancel unrelated controller', async () => {
  const gate = deferred();
  const calls = [];
  const service = new DiscoveryService(async () => config([device(), device('192.0.2.2')]), {
    read: async d => {
      calls.push(d.ipAddress); if (calls.length === 1) {
        await gate.promise; throw new Error('private details');
      } return data('second');
    },
  });
  const { entries } = await service.session();
  const requests = entries.map(e => service.discover(e.token));
  await tick();
  assert.deepEqual(calls, ['192.0.2.1']);
  gate.resolve();
  const results = await Promise.all(requests);
  assert.equal(results[0].status, 'unavailable');
  assert.equal(JSON.stringify(results).includes('private details'), false);
  assert.equal(results[1].status, 'present');
  assert.equal(calls.length, 2);
});

test('unsafe destinations rejected; routed numeric addresses and five-digit ports supported', () => {
  for (const address of ['127.0.0.1', '169.254.1.2', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    'localhost', '192.168.001.1', '192.0.2.999', 'http://192.0.2.1', '192.0.2.1/path', '192.0.2.1:80']) {
    assert.throws(() => savedEndpoint(device(address)), DiscoveryError);
  }
  for (const port of [0, 65536, '2025', 1.5, null, false]) {
    assert.throws(() => savedEndpoint(device('192.0.2.1', { port })), DiscoveryError);
  }
  assert.deepEqual(savedEndpoint({ ipAddress: '203.0.113.9', port: 10211 }), { host: '203.0.113.9', port: 10211 });
  assert.equal(savedEndpoint({ ipAddress: '10.0.0.1' }).port, 2025);
});

test('ambiguous endpoints excluded, including explicit versus omitted default port', async () => {
  const service = new DiscoveryService(async () => config([device(), { ipAddress: '192.0.2.1' }, device('192.0.2.2')]), {
    read: () => assert.fail('No reads before authorization'),
  });
  assert.equal((await service.session()).entries.length, 1);
});

test('missing, multiple, malformed and excessive saved configurations fail closed', async () => {
  for (const source of [{}, { platforms: [] }, { platforms: [config([]).platforms[0], config([]).platforms[0]] },
    config('bad'), config(Array.from({ length: LIMITS.controllers + 1 }, () => device()))]) {
    const service = new DiscoveryService(async () => source, { read: () => assert.fail('No requests') });
    assert.equal((await service.session()).status, 'unavailable');
  }
  assert.deepEqual((await new DiscoveryService(async () => config([])).session()).entries, []);
});

test('saved changes during a read reject it and prevent queued dispatch', async () => {
  const source = config([device(), device('192.0.2.2')]);
  const gate = deferred();
  let calls = 0;
  const service = new DiscoveryService(async () => source, { read: async () => {
    calls++; await gate.promise; return data();
  } });
  const { entries } = await service.session();
  const requests = entries.map(e => service.discover(e.token));
  await tick();
  source.platforms[0].devices[1].ipAddress = '192.0.2.99';
  gate.resolve();
  for (const result of await Promise.all(requests)) {
    assert.equal(result.reason, 'saved-configuration-changed');
    assert.equal(result.observedAt, null);
  }
  assert.equal(calls, 1);
});

test('closure aborts active transport and prevents queued work', async () => {
  let calls = 0;
  const service = new DiscoveryService(async () => config([device(), device('192.0.2.2')]), { read: (d, signal) => {
    calls++;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DiscoveryError('cancelled'))));
  } });
  const { entries } = await service.session();
  const requests = entries.map(e => service.discover(e.token));
  await tick();
  service.close();
  assert.equal((await Promise.all(requests)).every(r => r.reason === 'cancelled'), true);
  assert.equal(calls, 1);
});

test('closed backend never presents a cached success as a fresh session result', async () => {
  let calls = 0;
  const service = new DiscoveryService(async () => config([device()]), { read: async () => {
    calls++;
    return data();
  } });
  const { entries } = await service.session();
  assert.equal((await service.discover(entries[0].token)).status, 'present');
  service.close();
  assert.equal((await service.discover(entries[0].token)).reason, 'cancelled');
  assert.equal(calls, 1);
});

test('upper controller and inventory bounds accept complete results without truncation', async () => {
  const devices = Array.from({ length: LIMITS.controllers }, (_, i) => device('192.0.2.' + (i + 1)));
  const inventory = Object.fromEntries(Array.from({ length: LIMITS.records }, (_, i) =>
    ['t' + i, { id: 't' + i, name: 'Same display name', channelDipState: 8, value: 100 }]));
  let calls = 0;
  const service = new DiscoveryService(async () => config(devices), { read: async () => {
    calls++;
    return data('mid-' + calls, inventory);
  } });
  const { entries } = await service.session();
  assert.equal(entries.length, LIMITS.controllers);
  const results = await Promise.all(entries.map(entry => service.discover(entry.token)));
  assert.equal(calls, LIMITS.controllers);
  assert.equal(results.every(result => result.status === 'present' && result.things.length === LIMITS.records), true);
});

test('fresh unavailable, absent, malformed, empty and partial inventories stay distinct', async () => {
  const missing = data(); delete missing.myThings;
  const invalidMid = data(''); delete invalidMid.myThings;
  const cases = [[missing, 'absent'], [invalidMid, 'unavailable'], [data('m', {}), 'present'],
    [{ ...data(), myThings: null }, 'malformed'], [data('m', { t1: { id: 't1', channelDipState: 8 }, bad: null }), 'partial']];
  for (const [snapshot, status] of cases) {
    const service = new DiscoveryService(async () => config([device()]), { read: async () => snapshot });
    const { entries } = await service.session();
    assert.equal((await service.discover(entries[0].token)).status, status);
  }
});

test('sparse overrides survive failure and MID replacement without transferring identity', async () => {
  const things = [{ controllerId: 'old', id: 't1', type: 'gate', invert: true, disabled: true }];
  for (const failure of [false, true]) {
    const service = new DiscoveryService(async () => config([device('192.0.2.1', { things })]), {
      read: async () => {
        if (failure) {
          throw new Error('offline');
        } return data('replacement');
      },
    });
    const { entries } = await service.session();
    const result = await service.discover(entries[0].token);
    assert.equal(result.things.find(t => t.controllerId === 'old').status, 'excluded');
    if (!failure) {
      assert.equal(result.things.find(t => t.controllerId === 'replacement').status, 'automatic-candidate');
    }
    assert.equal(things[0].invert, true);
  }
});

test('duplicate controller MIDs quarantine both cached results and report conflicting tokens', async () => {
  const service = new DiscoveryService(async () => config([device(), device('192.0.2.2'), device('192.0.2.3')]), { read: async () => data() });
  const { entries } = await service.session();
  const first = await service.discover(entries[0].token);
  assert.equal(first.status, 'present');
  const second = await service.discover(entries[1].token);
  assert.equal(first.status, 'unavailable');
  assert.deepEqual(second.conflicts, entries.slice(0, 2).map(e => e.token));
  const third = await service.discover(entries[2].token);
  assert.equal(third.conflicts.length, 3);
  assert.equal((await service.discover(entries[0].token)).status, 'unavailable');
});

test('bounded DTO omits raw values, secrets and endpoint; excessively large inventory is explicit', async () => {
  const snapshot = data(); snapshot.secret = 'SENSITIVE'; snapshot.system.ip = '192.0.2.1';
  const service = new DiscoveryService(async () => config([device()]), { read: async () => snapshot });
  const { entries } = await service.session();
  const result = await service.discover(entries[0].token);
  assert.deepEqual(Object.keys(result.things[0]).sort(), ['capability', 'controllerId', 'id', 'name', 'operational',
    'physicalState', 'qualification', 'status'].sort());
  assert.doesNotMatch(JSON.stringify(result), /SENSITIVE|192\.0\.2\.1|reportedValue|dimPercent/);
  const large = data('m', Object.fromEntries(Array.from({ length: LIMITS.records + 1 }, (_, i) => ['t' + i, { id: 't' + i }])));
  const oversized = new DiscoveryService(async () => config([device()]), { read: async () => large });
  const manifest = await oversized.session();
  const rejected = await oversized.discover(manifest.entries[0].token);
  assert.equal(rejected.reason, 'inventory-too-large');
  assert.equal(rejected.status, 'unavailable');
});

function network() {
  const req = new EventEmitter(); req.end = () => {}; req.destroy = () => {
    req.destroyed = true;
  };
  const res = new EventEmitter(); res.statusCode = 200; res.headers = {}; res.destroy = () => {
    res.destroyed = true;
  };
  let headers;
  let timeout;
  let options;
  let delay;
  let requests = 0;
  return { req, res, get options() {
    return options;
  }, get delay() {
    return delay;
  }, get requests() {
    return requests;
  },
  headers: () => headers(res), timeout: () => timeout(),
  deps: { request: (opts, callback) => {
    requests++; options = opts; headers = callback; return req;
  },
  schedule: (callback, ms) => {
    timeout = callback; delay = ms; return 1;
  }, cancel: () => {} } };
}

test('transport sends only fixed GET once with no credentials, redirects or DNS', async () => {
  const net = network();
  const read = readController(device(), undefined, net.deps);
  assert.equal(net.options.method, 'GET');
  assert.equal(net.options.path, '/getSystemData');
  assert.equal(net.options.host, '192.0.2.1');
  assert.throws(() => net.options.lookup(), /dns-forbidden/);
  assert.equal(net.delay, 10000);
  net.headers(); net.res.emit('data', Buffer.from(JSON.stringify(data()))); net.res.emit('end');
  assert.deepEqual(await read, data());
  assert.equal(net.requests, 1);
});

test('total deadline expires before headers or during streamed body without renewal', async () => {
  for (const body of [false, true]) {
    const net = network(); const read = readController(device(), undefined, net.deps);
    if (body) {
      net.headers(); net.res.emit('data', Buffer.from('{'));
    }
    net.timeout();
    await assert.rejects(read, /timeout/);
    assert.equal(net.req.destroyed, true);
    assert.equal(net.requests, 1);
  }
});

test('response byte ceiling enforced while streaming; no automatic retry', async () => {
  const net = network(); const read = readController(device(), undefined, net.deps); net.headers();
  net.res.emit('data', Buffer.alloc(LIMITS.bytes));
  net.res.emit('data', Buffer.from('x'));
  await assert.rejects(read, /response-too-large/);
  assert.equal(net.res.destroyed, true);
  assert.equal(net.requests, 1);
});

test('redirects, compression, invalid JSON and transport errors fail without another request', async () => {
  for (const kind of ['redirect', 'encoding', 'json', 'connection', 'body']) {
    const net = network(); const read = readController(device(), undefined, net.deps);
    if (kind === 'redirect') {
      net.res.statusCode = 302; net.res.headers.location = 'http://127.0.0.1';
    }
    if (kind === 'encoding') {
      net.res.headers['content-encoding'] = 'gzip';
    }
    if (kind === 'connection') {
      net.req.emit('error', new Error('secret'));
    } else {
      net.headers();
    }
    if (kind === 'json') {
      net.res.emit('data', Buffer.from('bad')); net.res.emit('end');
    }
    if (kind === 'body') {
      net.res.emit('error', new Error('secret'));
    }
    await assert.rejects(read, error => error instanceof DiscoveryError && !error.message.includes('secret'));
    assert.equal(net.requests, 1);
  }
});

test('transport cancellation destroys active request and prevents pre-aborted dispatch', async () => {
  const abort = new globalThis.AbortController(); const net = network();
  const active = readController(device(), abort.signal, net.deps); abort.abort();
  await assert.rejects(active, /cancelled/);
  await assert.rejects(readController(device(), abort.signal, net.deps), /cancelled/);
  assert.equal(net.requests, 1);
});

test('documented saved-config path reader is read-only and bounded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aa-discovery-config-'));
  try {
    const path = join(dir, 'config.json'); const source = config([device()]);
    await writeFile(path, JSON.stringify(source));
    assert.deepEqual(await readSavedConfiguration(path), source);
    await writeFile(path, Buffer.alloc(LIMITS.bytes + 1, 32));
    await assert.rejects(readSavedConfiguration(path), /saved-configuration-too-large/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('pinned utility IPC adapter reads only saved configuration and rejects destination payloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aa-discovery-ipc-'));
  let child;
  try {
    const path = join(dir, 'config.json');
    // Unsafe saved destination deliberately guarantees that no controller request can be authorized.
    const bytes = Buffer.from(JSON.stringify(config([device('127.0.0.1')])));
    await writeFile(path, bytes);
    child = fork(fileURLToPath(new URL('../../homebridge-ui/server.js', import.meta.url)), [], {
      env: { ...process.env, HOMEBRIDGE_CONFIG_PATH: path }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const message = () => new Promise((resolve, reject) => {
      let timer;
      let receive;
      let failed;
      const finish = (error, value) => {
        globalThis.clearTimeout(timer);
        child.removeListener('message', receive);
        child.removeListener('error', failed);
        child.removeListener('exit', failed);
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };
      receive = value => finish(null, value);
      failed = () => finish(new Error('Synthetic UI backend exited or failed'));
      child.once('message', receive);
      child.once('error', failed);
      child.once('exit', failed);
      timer = globalThis.setTimeout(() => finish(new Error('Synthetic IPC deadline')), 10000);
    });
    assert.equal((await message()).action, 'ready');
    let id = 0;
    const request = async (path, body) => {
      const pending = message();
      const requestId = ++id;
      child.send({ action: 'request', requestId, path, body });
      const response = await pending;
      assert.equal(response.payload.requestId, requestId);
      assert.equal(response.payload.success, true);
      return response.payload.data;
    };
    assert.deepEqual((await request('/things/session', {})).entries, []);
    for (const body of [[], 'bad', { ipAddress: '192.0.2.1', port: 2025 }]) {
      assert.equal((await request('/things/session', body)).reason, 'invalid-request');
    }
    assert.equal((await request('/things/read', { token: 'unknown', url: 'http://192.0.2.1' })).reason, 'invalid-request');
    assert.equal((await request('/things/read', { token: 'unknown' })).reason, 'unauthorized');
    assert.deepEqual(await readFile(path), bytes);
  } finally {
    // Disconnect only the process created by this test; the utility owns its shutdown.
    if (child?.connected) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.disconnect();
      await exited;
    }
    await rm(dir, { recursive: true });
  }
});

test('closing during saved configuration read prevents session authorization', async () => {
  const saved = deferred(), entered = deferred();
  let reads = 0, tokens = 0;
  const service = new DiscoveryService(() => {
    entered.resolve();
    return saved.promise;
  }, { read: async () => {
    reads++; return data();
  }, token: () => {
    tokens++; return 'test-token';
  } });
  const pending = service.session();
  await entered.promise;
  service.close();
  saved.resolve(config([device()]));
  assert.deepEqual(await pending, { status: 'unavailable', reason: 'cancelled', entries: [] });
  assert.equal(service.entries.size, 0);
  assert.equal(tokens, 0);
  assert.equal((await service.discover('test-token')).reason, 'cancelled');
  assert.equal(reads, 0);
});
