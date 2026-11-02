import assert from 'node:assert/strict';
import { assertBetaPackage } from '../../dev/beta-policy.mjs';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, URL } from 'node:url';
import test from 'node:test';
import register from '../../dist/index.js';
import { AdvantageAirPlatform } from '../../dist/platform.js';
import { PLATFORM_NAME, PLUGIN_NAME } from '../../dist/settings.js';
import { migrateNativeCache, transformNativeCache, checksum } from '../../dev/migrate-native-cache.mjs';

const require = createRequire(import.meta.url);
const entry = pathToFileURL(require.resolve('homebridge'));
const { HomebridgeAPI } = await import(new URL('./api.js', entry).href);
const { PluginManager } = await import(new URL('./pluginManager.js', entry).href);
const { PlatformAccessory } = await import(new URL('./platformAccessory.js', entry).href);
const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root)));

test('standalone registration and schema retain the native platform under the new package only', () => {
  const calls = [];
  register({ registerPlatform: (...args) => calls.push(args) });
  assert.deepEqual(calls, [[PLUGIN_NAME, PLATFORM_NAME, AdvantageAirPlatform]]);
  assert.equal(PLUGIN_NAME, 'homebridge-advantageair');
  assert.equal(PLATFORM_NAME, 'AdvantageAir');
  assert.equal(pkg.name, PLUGIN_NAME);
  assert.equal(JSON.parse(fs.readFileSync(new URL('config.schema.json', root))).pluginAlias, PLATFORM_NAME);
  assertBetaPackage(pkg); // Supports the separately reviewed publication state too.
  assert.equal(pkg.version, '4.0.0-beta.3');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.files.includes('AdvAir.sh'), false);
  const lock = JSON.parse(fs.readFileSync(new URL('package-lock.json', root)));
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
});

test('Homebridge resolves v3 and native configuration independently without ambiguous aliases', async () => {
  const api = new HomebridgeAPI();
  const manager = new PluginManager(api);
  const makePlugin = (name, initialize) => ({
    initialize, getPluginIdentifier: () => name, platforms: new Map(),
    registerPlatform(alias, constructor) {
      this.platforms.set(alias, constructor);
    },
  });
  // Matches v3's retained two-argument registration; packaged campaign installs actual v3.
  const v3 = makePlugin('homebridge-cmd4-advantageair', () => api.registerPlatform('cmd4AdvantageAir', class {}));
  const native = makePlugin(PLUGIN_NAME, () => register(api));
  await manager.initializePlugin(v3, v3.getPluginIdentifier());
  await manager.initializePlugin(native, PLUGIN_NAME);
  assert.equal(manager.getPluginForPlatform('cmd4AdvantageAir'), v3);
  assert.equal(manager.getPluginForPlatform('AdvantageAir'), native);
  assert.deepEqual([...native.platforms.keys()], ['AdvantageAir']);
});

function serialized(api, name, role, plugin = 'homebridge-cmd4-advantageair', platform = 'AdvantageAir') {
  const accessory = new api.platformAccessory(name, api.hap.uuid.generate(JSON.stringify(['AdvantageAir', 'controller', 'unit', role])));
  accessory.addService(api.hap.Service.Switch, name, 'unchanged-subtype');
  accessory.context = { identity: 'retained', duration: 45, dimmable: true };
  accessory._associatedPlugin = plugin;
  accessory._associatedPlatform = platform;
  return PlatformAccessory.serialize(accessory);
}

test('cache transition changes only native plugin association, preserving serialized HomeKit state and other owners', () => {
  const api = new HomebridgeAPI();
  const before = [serialized(api, 'Aircon', 'thermostat'), serialized(api, 'Old Cmd4', 'legacy', 'homebridge-cmd4', 'Cmd4'),
    serialized(api, 'Old helper', 'helper', 'homebridge-cmd4-advantageair', 'cmd4AdvantageAir')];
  const frozen = JSON.stringify(before);
  const result = transformNativeCache(before);
  assert.equal(result.uuids.length, 1);
  assert.equal(JSON.stringify(before), frozen);
  const expected = globalThis.structuredClone(before);
  expected[0].plugin = PLUGIN_NAME;
  assert.deepEqual(result.cache, expected);
  const restored = PlatformAccessory.deserialize(result.cache[0]);
  assert.equal(restored.UUID, before[0].UUID);
  assert.equal(restored._associatedPlugin, PLUGIN_NAME);
  assert.equal(restored.getServiceById(api.hap.Service.Switch, 'unchanged-subtype').subtype, 'unchanged-subtype');
  assert.deepEqual(restored.context, before[0].context);
  assert.throws(() => transformNativeCache(result.cache), /nothing to migrate/);
  assert.throws(() => transformNativeCache([before[0], before[0]]), /Duplicate/);
  assert.throws(() => transformNativeCache({}), /array/);
});

test('offline helper refuses stale hashes/counts/live attestation and preserves an exact backup', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-cache-transition-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'cachedAccessories.0E2218050001');
  const before = Buffer.from(JSON.stringify([serialized(new HomebridgeAPI(), 'Aircon', 'thermostat')]));
  fs.writeFileSync(file, before);
  const options = { apply: true, stopped: true, expectedHash: checksum(before), expectedCount: 1 };
  assert.equal(migrateNativeCache(file).sha256, checksum(before));
  for (const change of [{ stopped: false }, { expectedHash: '0'.repeat(64) }, { expectedCount: 2 }]) {
    assert.throws(() => migrateNativeCache(file, { ...options, ...change }));
    assert.deepEqual(fs.readFileSync(file), before);
  }
  const result = migrateNativeCache(file, options);
  assert.deepEqual(fs.readFileSync(result.backup), before);
  assert.equal(JSON.parse(fs.readFileSync(file))[0].plugin, PLUGIN_NAME);
  assert.equal(checksum(fs.readFileSync(file)), result.migratedSha256);
});

test('historical script is retained unchanged as repository reference, not native runtime payload', () => {
  const bytes = fs.readFileSync(new URL('AdvAir.sh', root));
  assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    'c8b6e7d12530dd3d4bb27b71bfa3d063139fcf53');
  assert.equal(fs.existsSync(new URL('src/legacyCompatibility.ts', root)), false);
});
