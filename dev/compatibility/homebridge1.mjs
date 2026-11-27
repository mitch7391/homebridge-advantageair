import { compatibilityFixture, inventorySummary, until as pollUntil } from './discovery-check.mjs';
import assert from 'node:assert/strict';
import { assertBetaPackage } from '../beta-policy.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import process from 'node:process';
import console from 'node:console';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { migrateNativeCache, checksum } from '../migrate-native-cache.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { fetch, AbortSignal } = globalThis;
const homebridgeVersion = process.argv[3] ?? '1.8.5';
assert.ok(['1.8.5', '2.4.0'].includes(homebridgeVersion), 'Use an established compatibility version.');
assert.ok(['22', '24'].includes(process.versions.node.split('.')[0]));
if (homebridgeVersion === '1.8.5') {
  assert.equal(process.versions.node.split('.')[0], '22', 'Use Node 22 for Homebridge 1.8.5.');
  assert.equal(process.platform, 'linux', 'Run Homebridge 1.8.5 in Linux/Codespaces.');
}
assert.ok(process.env.npm_execpath, 'Run npm run check:homebridge1 -- /absolute/package.tgz');
const focused = process.argv[4] === '--standalone';
assert.ok(process.argv.length === 3 || process.argv.length === 4 || process.argv.length === 5 && focused,
  'Supply a validated tarball, optional Homebridge version and optional --standalone.');
const archive = path.resolve(process.argv[2]);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-homebridge1-'));
const storage = path.join(home, 'storage');
fs.mkdirSync(storage);
// Windows child.kill(SIGTERM) terminates without invoking Homebridge teardown.
// Use IPC only in this disposable harness to invoke its real signal handler.
const shutdownHook = path.join(home, 'shutdown-hook.mjs');
if (process.platform === 'win32') {
  fs.writeFileSync(shutdownHook, `import process from 'node:process';
process.on('message', message => {
  if (message === 'graceful-homebridge-shutdown') {
    if (!process.listenerCount('SIGTERM')) throw new Error('Homebridge shutdown handler missing');
    process.emit('SIGTERM');
  }
});
`);
}
const name = 'homebridge-advantageair';
const legacyName = 'homebridge-cmd4-advantageair';
const legacyVersion = '3.12.2';
const pin = '031-45-154'; // Disposable, unpaired, loopback-only test bridge.
const report = { node: process.version, homebridge: homebridgeVersion, archive,
  archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), checks: [], status: 'running' };
const children = [];
let hb;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const run = (command, args, cwd = home) => execFileSync(command, args, { cwd, stdio: 'inherit' });
const capture = (command, args, target) => {
  const fd = fs.openSync(target, 'w');
  try {
    execFileSync(command, args, { cwd: home, stdio: ['ignore', fd, 'inherit'] });
  } finally {
    fs.closeSync(fd);
  }
};
const mark = message => {
  report.checks.push(message); console.log('PASS:', message);
};
const until = (description, check, timeout = 30000, options = {}) =>
  pollUntil(description, check, timeout, { ...options, children });
const freePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
};
const launch = (args, log, env = process.env) => {
  const fd = fs.openSync(log, 'a');
  const child = spawn(process.execPath, args, { cwd: home, env, stdio: ['ignore', fd, fd, 'ipc'] });
  fs.closeSync(fd);
  child.log = log;
  child.on('error', error => {
    report.processError = error.message;
  });
  children.push(child);
  return child;
};
const stop = async child => {
  child.stopping = true;
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === 'win32' && child.homebridge) {
    child.send('graceful-homebridge-shutdown');
  } else {
    child.kill('SIGTERM');
  }
  for (let i = 0; i < 100 && child.exitCode === null && child.signalCode === null; i++) {
    await wait(100);
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    throw new Error(`Graceful shutdown timed out; see ${child.log}`);
  }
  assert.ok(child.exitCode === 0 || child.exitCode === 143 || !child.homebridge && child.signalCode === 'SIGTERM',
    `Unclean exit ${child.exitCode}/${child.signalCode}; see ${child.log}`);
};

try {
  // Inspect only the supplied tarball; no linking to the repository plugin/dev Homebridge.
  const membersFile = path.join(home, 'archive-members.txt');
  capture('tar', ['-tzf', archive], membersFile);
  const members = fs.readFileSync(membersFile, 'utf8').trim().split(/\r?\n/);
  // Derive the exact inventory from the clean build/explicit allowlist, not a guessed count.
  const sourcePackage = read(path.join(root, 'package.json'));
  const runtimeFiles = fs.readdirSync(path.join(root, 'dist'), { recursive: true })
    .filter(file => /\.(?:js|ts|map)$/.test(file)).map(file => 'dist/' + file.split(path.sep).join('/'));
  const uiFiles = [
    'homebridge-ui/server.js', 'homebridge-ui/discovery-service.mjs',
    'homebridge-ui/public/index.html', 'homebridge-ui/public/app.mjs',
    'homebridge-ui/public/draft.mjs', 'homebridge-ui/public/discovery.mjs',
    'homebridge-ui/public/settings-header.png',
  ];
  const expected = ['package.json', 'README.md', ...sourcePackage.files.filter(file => !file.includes('*')),
    ...runtimeFiles, ...uiFiles];
  assert.deepEqual([...members].sort(), expected.map(file => 'package/' + file).sort(), 'Unexpected standalone package inventory.');
  assert.equal(new Set(members).size, members.length);
  assert.ok(!members.some(member => /AdvAir\.sh|legacyCompatibility/.test(member)), 'No legacy backend/handler in native tarball.');
  assert.ok(members.every(file => file.startsWith('package/') && !file.split('/').includes('..')));
  run('tar', ['-xzf', archive, '-C', home]);
  const pkg = read(path.join(home, 'package/package.json'));
  assert.equal(pkg.name, name);
  assert.equal(pkg.version, read(path.join(root, 'package.json')).version);
  assertBetaPackage(pkg);
  report.plugin = pkg.version;
  fs.writeFileSync(path.join(home, 'package.json'), '{"name":"aa-hb1-consumer","private":true}\n');
  run(process.execPath, [process.env.npm_execpath, 'install', '--save-exact', '--omit=dev', '--no-audit', '--no-fund',
    '--package-lock=false', `homebridge@${homebridgeVersion}`, `${legacyName}@${legacyVersion}`, archive]);
  assert.equal(read(path.join(home, 'node_modules', legacyName, 'package.json')).version, legacyVersion);
  assert.ok(fs.existsSync(path.join(home, 'node_modules', legacyName, 'AdvAir.sh')));
  report.legacyPlugin = legacyVersion;
  const installed = path.join(home, 'node_modules', name);
  assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
  assert.equal(read(path.join(home, 'node_modules/homebridge/package.json')).version, homebridgeVersion);
  for (const member of members) {
    assert.deepEqual(fs.readFileSync(path.join(home, member)), fs.readFileSync(path.join(installed, member.slice(8))), member);
  }
  mark(`Homebridge ${homebridgeVersion} installed with the actual tarball; all ${members.length} installed plugin files match.`);
  const simPort = await freePort();
  let hapPort = await freePort();
  while (hapPort === simPort) {
    hapPort = await freePort();
  }
  const sim = `http://127.0.0.1:${simPort}`;
  const request = async (url, options = {}) => {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(3000) });
    assert.ok(response.ok, `${options.method ?? 'GET'} ${url}: HTTP ${response.status}`);
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      // JSON parser messages can quote response bodies; retain only the failure category.
      throw new SyntaxError('Invalid JSON response');
    }
  };
  launch([path.join(root, 'dev/lab/AirConServer.cjs')], path.join(home, 'simulator.log'), { ...process.env, PORT: String(simPort) });
  await until('Simulator startup', async () => (await fetch(sim + '/reInit')).ok);
  const load = new URL(sim + '/');
  const fixture = compatibilityFixture(read(path.join(root, 'dev/lab/fixtures/myzone.json')),
    read(path.join(root, 'dev/lab/fixtures/lights-large.json')).myLights.lights);
  const fixtureFile = path.join(home, 'ac-lights-fixture.json');
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture));
  load.searchParams.set('load', fixtureFile);
  assert.ok((await fetch(load)).ok);
  const state = async () => (await request(sim + '/getSystemData')).aircons.ac1;
  const loaded = await request(sim + '/getSystemData');
  assert.equal(loaded.myThings, undefined);
  assert.deepEqual(loaded.aircons, fixture.aircons);
  assert.deepEqual(loaded.myLights, fixture.myLights);
  assert.equal((await state()).info.myZone, 1);
  const config = { bridge: { name: 'AA HB1 compatibility', username: '0E:22:18:05:00:01', port: hapPort,
    pin, bind: ['127.0.0.1'], advertiser: 'ciao' }, plugins: [legacyName, name], accessories: [], platforms: [
    { platform: 'cmd4AdvantageAir', name: 'Legacy compatibility' },
    { platform: 'AdvantageAir', name: 'Native compatibility', debug: true,
      devices: [{ name: 'Simulator', homeName: 'Aircon', ipAddress: '127.0.0.1', port: simPort, debug: false }] },
  ] };
  fs.writeFileSync(path.join(storage, 'config.json'), JSON.stringify(config, null, 2));
  const schema = read(path.join(installed, 'config.schema.json'));
  assert.equal(schema.pluginAlias, 'AdvantageAir');
  assert.ok(schema.schema.properties.devices.items.properties.homeName);
  const hap = (suffix, options = {}) => request(`http://127.0.0.1:${hapPort}${suffix}`, {
    ...options, headers: { Authorization: pin, 'Content-Type': 'application/hap+json' },
  });
  const start = async label => {
    const hook = process.platform === 'win32' ? ['--import', pathToFileURL(shutdownHook).href] : [];
    hb = launch([...hook, path.join(home, 'node_modules/homebridge/bin/homebridge'), '-U', storage,
      '-P', path.join(home, 'node_modules'), '--strict-plugin-resolution', '-I', '-Q'], path.join(home, `${label}.log`));
    hb.homebridge = true;
    let inventory = 'no successful HAP enumeration';
    return until('Homebridge discovery', async () => {
      const data = await hap('/accessories');
      inventory = inventorySummary(data);
      return data.accessories.length === 13 && data.accessories;
    }, 30000, { observation: () => inventory });
  };
  const short = type => type.replace(/-0000-1000-8000-0026BB765291$/i, '').replace(/^0+/, '').toUpperCase();
  const characteristic = (service, type) => service.characteristics.find(c => short(c.type) === type);
  const select = (accessories, accessoryName, serviceType, serviceName) => {
    const matching = accessories.filter(a => a.services.some(s => short(s.type) === '3E' && characteristic(s, '23')?.value === accessoryName));
    assert.equal(matching.length, 1, `Accessory ${accessoryName}`);
    const a = matching[0];
    const services = a.services.filter(s => short(s.type) === serviceType && (!serviceName || characteristic(s, '23')?.value === serviceName));
    assert.equal(services.length, 1, `Service ${accessoryName}/${serviceName ?? serviceType}`);
    return { aid: a.aid, service: services[0] };
  };
  const get = async (control, type) => {
    const c = characteristic(control.service, type);
    assert.ok(c, `Missing characteristic ${type}`);
    const data = await hap(`/characteristics?id=${control.aid}.${c.iid}`);
    assert.equal(data.characteristics[0].status ?? 0, 0);
    return data.characteristics[0].value;
  };
  const put = async (control, type, value) => {
    const c = characteristic(control.service, type);
    assert.ok(c, `Missing characteristic ${type}`);
    const result = await hap('/characteristics', { method: 'PUT', body: JSON.stringify({ characteristics: [{ aid: control.aid, iid: c.iid, value }] }) });
    assert.ok(!result || result.characteristics.every(item => (item.status ?? 0) === 0), 'HAP write refused');
  };
  const first = await start('first-start');
  const thermostat = select(first, 'Aircon', '4A');
  const speed = select(first, 'Aircon', '40');
  const zone = select(first, 'Bedroom Reference Zone', '49');
  const sensor = select(first, 'Living Reference Temperature', '8A');
  const percentage = select(first, 'Percentage Test Zone', '43');
  const vent = select(first, 'Aircon Fan', '40');
  const dry = select(first, 'Aircon Dry Mode', '40');
  const timer = select(first, 'Aircon Timer', 'D0');
  const myzone = select(first, 'Aircon MyZone', '49', 'Bedroom Reference MyZone');
  assert.ok(thermostat.service.linked?.includes(speed.service.iid), 'FanSpeed must remain linked to the thermostat.');
  mark('Actual Homebridge startup: 12 native accessories; independently installed v3 owns cmd4AdvantageAir, v4 owns AdvantageAir.');
  assert.ok(Number.isFinite(await get(thermostat, '11')));
  assert.ok(Number.isFinite(await get(sensor, '11')));
  if (!focused) {
    await put(thermostat, '33', 1);
    await until('Thermostat heat', async () => {
      const s = await state(); return s.info.state === 'on' && s.info.mode === 'heat';
    });
    await put(thermostat, '35', 25);
    await until('Target temperature', async () => (await state()).info.setTemp === 25);
    mark('Thermostat current temperature, Heat and target temperature; temperature sensor read.');
    await put(speed, '29', 75);
    await until('Linked FanSpeed', async () => (await state()).info.fan === 'high');
    await put(zone, '25', true);
    await until('Temperature-zone switch', async () => (await state()).zones.z02.state === 'open');
    assert.ok([true, 1].includes(await get(zone, '25')), 'Expected HAP On=true or 1');
    await put(percentage, '8', 60);
    await until('Percentage brightness', async () => (await state()).zones.z06.value === 60);
    assert.equal(await get(percentage, '8'), 60);
    await put(percentage, '25', false);
    await until('Percentage Off', async () => (await state()).zones.z06.state === 'close');
    mark('Linked FanSpeed, zone Switch and percentage Lightbulb controls.');
    for (const [control, mode] of [[vent, 'vent'], [dry, 'dry']]) {
      await put(control, '25', true);
      await until(mode, async () => {
        const s = await state(); return s.info.mode === mode && s.info.state === 'on';
      });
      assert.ok([true, 1].includes(await get(control, '25')), 'Expected HAP On=true or 1');
      assert.ok(Number.isFinite(await get(control, '29')));
    }
    mark('Ventilation and Dry mode fans.');
    await put(timer, 'D3', 2700);
    assert.equal(await get(timer, 'D3'), 2700);
    await put(timer, 'B0', 1);
    await until('Timer activation', async () => (await state()).info.countDownToOff > 0);
    await put(timer, 'B0', 0);
    await until('Timer cancellation', async () => (await state()).info.countDownToOff === 0);
    await put(myzone, '25', true);
    await until('MyZone selection', async () => (await state()).info.myZone === 7);
    assert.ok([true, 1].includes(await get(myzone, '25')), 'Expected HAP On=true or 1');
    mark('Timer duration/activation/cancellation and fixture MyZone selection.');
    const relayControl = select(first, 'Relay Output', '43');
    const dimmerControl = select(first, 'Dimmer Output', '43');
    assert.equal(characteristic(relayControl.service, '8'), undefined);
    const lightState = async id => (await request(sim + '/getSystemData')).myLights.lights[id];
    await put(relayControl, '25', true);
    await until('Relay On', async () => (await lightState('relay1')).state === 'on');
    await put(relayControl, '25', false);
    await until('Relay Off', async () => (await lightState('relay1')).state === 'off');
    await put(dimmerControl, '8', 80);
    await until('Dimmer brightness while Off', async () => {
      const light = await lightState('dimmer1'); return light.value === 80 && light.state === 'off';
    });
    await put(dimmerControl, '25', true);
    await until('Dimmer On retains brightness', async () => {
      const light = await lightState('dimmer1'); return light.state === 'on' && light.value === 80;
    });
    await until('Dimmer On confirmation before an independent external edit', () =>
      fs.readFileSync(hb.log, 'utf8').includes('Dimmer Output Controller confirmed: On'));
    mark('Packaged relay On/Off and dimmer Brightness/On via real Homebridge HAP and historical simulator endpoint.');
    // Model a tablet/app write through the same historical controller endpoint.
    for (const payload of ['{id:"dimmer1",value:35}', '{id:"dimmer1",state:off}']) {
      const external = new URL(sim + '/setLight');
      external.searchParams.set('json', payload);
      await request(external);
    }
    await until('External dimmer state reaches HomeKit on normal polling', async () =>
      (await get(dimmerControl, '8')) === 35 && [false, 0].includes(await get(dimmerControl, '25')), 45000);
    mark('External simulator light changes reach HomeKit through the normal shared poll.');
  } else {
    await put(timer, 'D3', 2700);
    assert.equal(await get(timer, 'D3'), 2700);
    mark('Focused standalone campaign: startup/read/cache checks; established functional campaign not repeated.');
  }
  const topology = accessories => accessories.map(a => ({ aid: a.aid, services: a.services.map(s => ({ iid: s.iid, type: s.type,
    linked: s.linked ?? [], characteristics: s.characteristics.map(c => ({ iid: c.iid, type: c.type })) })) })).sort((a, b) => a.aid - b.aid);
  await stop(hb);
  const cacheFile = path.join(storage, 'accessories/cachedAccessories');
  const beforeCache = read(cacheFile);
  assert.equal(beforeCache.length, 12);
  const identity = cache => cache.map(a => ({ uuid: a.UUID, services: a.services.map(s => ({ uuid: s.UUID, subtype: s.subtype })) }))
    .sort((a, b) => a.uuid.localeCompare(b.uuid));
  assert.equal(new Set(beforeCache.map(a => a.UUID)).size, 12);
  const restored = await start('cached-restart');
  assert.deepEqual(topology(restored), topology(first));
  const restoredTimer = select(restored, 'Aircon Timer', 'D0');
  await until('Restored controls ready', async () => (await get(restoredTimer, 'D3')) === 2700);
  assert.ok(Number.isFinite(await get(select(restored, 'Aircon', '4A'), '11')));
  assert.equal(await get(select(restored, 'Dimmer Output', '43'), '8'), focused ? 50 : 35);
  assert.ok([false, 0].includes(await get(select(restored, 'Dimmer Output', '43'), '25')));
  await stop(hb);
  assert.deepEqual(identity(read(cacheFile)), identity(beforeCache));
  // Reproduce old development ownership, then apply the exact offline helper.
  // Only disposable cache metadata changes; no plugin runtime migration hooks.
  const oldCache = read(cacheFile).map(accessory => ({ ...accessory, plugin: legacyName }));
  fs.writeFileSync(cacheFile, JSON.stringify(oldCache));
  const migration = migrateNativeCache(cacheFile, {
    apply: true, stopped: true, expectedCount: 12, expectedHash: checksum(fs.readFileSync(cacheFile)),
  });
  assert.deepEqual(read(migration.backup), oldCache);
  const transitioned = await start('ownership-transition');
  assert.deepEqual(topology(transitioned), topology(first));
  await until('Transitioned Timer ready', async () => (await get(select(transitioned, 'Aircon Timer', 'D0'), 'D3')) === 2700);
  await stop(hb);
  assert.deepEqual(identity(read(cacheFile)), identity(beforeCache));
  assert.ok(read(cacheFile).every(accessory => accessory.plugin === name && accessory.platform === 'AdvantageAir'));
  assert.deepEqual(read(path.join(storage, 'config.json')), config);
  mark('Offline ownership transition preserved all 12 cached identities, HAP AIDs/IIDs and Timer duration with v3 installed.');
  for (const label of ['first-start', 'cached-restart', 'ownership-transition']) {
    const log = fs.readFileSync(path.join(home, `${label}.log`), 'utf8');
    assert.ok(log.includes(legacyName + '.cmd4AdvantageAir'));
    assert.ok(log.includes(name + '.AdvantageAir'));
    assert.ok(!log.includes(name + '.cmd4AdvantageAir'));
    assert.doesNotMatch(log, /registered multiple times|Removing orphaned accessory|Failed to find plugin to handle accessory/);
    assert.match(log, /Registering platform.*AdvantageAir/);
    assert.doesNotMatch(log, /TypeError|ReferenceError|Cannot find module|ERR_MODULE_NOT_FOUND/);
  }
  report.accessoryIdentity = identity(beforeCache);
  mark('Clean shutdown/restart: same 12 UUIDs, service subtypes, HAP AIDs/IIDs and retained 45-minute Timer duration.');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack;
  throw error;
} finally {
  for (const child of children.reverse()) {
    try {
      await stop(child);
    } catch (error) {
      report.status = 'failed';
      report.cleanupError = error.message;
      process.exitCode = 1;
    }
  }
  fs.writeFileSync(path.join(home, 'evidence.json'), JSON.stringify(report, null, 2));
  console.log(`Compatibility evidence (${report.status}): ${home}`);
}
