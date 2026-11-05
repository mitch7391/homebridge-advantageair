import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { assertBetaPackage } from './beta-policy.mjs';

const registry = 'https://registry.npmjs.org/';
const betaNumber = version => {
  assert.match(version, /^4\.0\.0-beta\.(0|[1-9]\d*)$/, 'Only the reviewed initial beta programme is supported.');
  return BigInt(version.split('.').at(-1));
};

/** Read-only gate; independent dist-tag writes are never protected by npm lifecycle hooks. */
export function assertLatestPromotion(manifest, document, legacy, env, phase) {
  assertBetaPackage(manifest);
  assert.ok(['before', 'after'].includes(phase));
  assert.equal(env.AA_BETA_RELEASE_PACKAGE, manifest.name);
  assert.equal(env.AA_BETA_RELEASE_VERSION, manifest.version);
  assert.equal(env.AA_BETA_LATEST_APPROVAL, manifest.version, 'Separate exact-version latest approval required.');
  assert.equal(env.npm_config_registry, registry);
  for (const key of ['npm_config_force', 'npm_config_ignore_scripts']) {
    assert.ok(env[key] === undefined || env[key] === 'false' || env[key] === false, 'Unsafe option refused.');
  }
  assert.match(env.AA_BETA_RELEASE_COMMIT ?? '', /^[0-9a-f]{40}$/);
  assert.match(env.AA_BETA_RELEASE_INTEGRITY ?? '', /^sha512-[A-Za-z0-9+/]{86}==$/);
  assert.equal(document.name, manifest.name);
  const published = document.versions?.[manifest.version];
  assert.ok(published, 'Exact version is not published.');
  assert.equal(published.name, manifest.name);
  assert.equal(published.version, manifest.version);
  assert.equal(published.private, false);
  assert.ok(Object.hasOwn(published, 'gitHead'),
    'Published gitHead is missing; source attribution is unverified. Stop: no approved archive-to-source fallback exists.');
  assert.equal(typeof published.gitHead, 'string', 'Published gitHead must be a commit SHA.');
  assert.match(published.gitHead, /^[0-9a-f]{40}$/, 'Published gitHead must be a full commit SHA.');
  assert.equal(published.gitHead, env.AA_BETA_RELEASE_COMMIT, 'Published gitHead differs from the approved source.');
  assert.equal(published.dist?.integrity, env.AA_BETA_RELEASE_INTEGRITY);
  assert.equal(published.dist?.tarball, `${registry}${manifest.name}/-/${manifest.name}-${manifest.version}.tgz`);
  assert.equal(document['dist-tags']?.beta, manifest.version, 'Verify beta before promoting latest.');
  assert.equal(legacy.name, 'homebridge-cmd4-advantageair');
  assert.deepEqual(legacy['dist-tags'], { latest: '3.12.4', beta: '3.6.0-beta.2' }, 'V3 registry state changed; stop for review.');
  const previous = env.AA_BETA_PREVIOUS_LATEST;
  assert.equal(typeof previous, 'string', 'Record previous latest, or none for first release.');
  if (previous !== 'none') {
    assert.ok(betaNumber(previous) < betaNumber(manifest.version), 'Refuse downgrade or repeated promotion.');
  }
  const expected = phase === 'after' ? manifest.version : previous === 'none' ? undefined : previous;
  assert.equal(document['dist-tags']?.latest, expected, 'Unexpected latest; stop without changing tags.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Use before or after; this script never changes registry state.');
  const phase = process.argv[2];
  assert.ok(['before', 'after'].includes(phase));
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assertBetaPackage(manifest);
  const read = async name => {
    const response = await globalThis.fetch(registry + name, { redirect: 'error', signal: globalThis.AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, 'Registry lookup failed; stop.');
    return response.json();
  };
  const [document, legacy] = await Promise.all([read(manifest.name), read('homebridge-cmd4-advantageair')]);
  assertLatestPromotion(manifest, document, legacy, process.env, phase);
  console.log(`PASS: ${phase} latest promotion verified for ${manifest.name}@${manifest.version}; v3 tags unchanged.`);
  console.log('READ ONLY: no publication or distribution-tag operation performed.');
}
