import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLatestPromotion } from '../../dev/beta-latest-policy.mjs';

function fixture(version = '4.0.0-beta.1', previous = 'none') {
  const name = 'homebridge-advantageair';
  const registry = 'https://registry.npmjs.org/';
  const integrity = 'sha512-' + 'A'.repeat(86) + '==';
  const commit = 'a'.repeat(40);
  return {
    manifest: { name, version, private: true, publishConfig: { tag: 'beta', registry } },
    document: {
      name, 'dist-tags': { beta: version, ...(previous === 'none' ? {} : { latest: previous }) },
      versions: { [version]: { name, version, private: false, gitHead: commit,
        dist: { integrity, tarball: `${registry}${name}/-/${name}-${version}.tgz` } } },
    },
    legacy: { name: 'homebridge-cmd4-advantageair', 'dist-tags': { latest: '3.12.4', beta: '3.6.0-beta.2' } },
    env: { AA_BETA_RELEASE_PACKAGE: name, AA_BETA_RELEASE_VERSION: version, AA_BETA_LATEST_APPROVAL: version,
      AA_BETA_RELEASE_COMMIT: commit, AA_BETA_RELEASE_INTEGRITY: integrity, AA_BETA_PREVIOUS_LATEST: previous,
      npm_config_registry: registry },
  };
}
const check = (f, phase = 'before') => assertLatestPromotion(f.manifest, f.document, f.legacy, f.env, phase);

test('first promotion requires published beta and separate approval, then verifies both tags', () => {
  const f = fixture();
  const before = globalThis.structuredClone(f);
  check(f);
  assert.deepEqual(f, before, 'Validation must not mutate registry snapshots or development private flag.');
  f.document['dist-tags'].latest = f.manifest.version;
  check(f, 'after');
  assert.throws(() => check(f));
});

test('later betas advance from the explicitly acknowledged old latest, never backwards', () => {
  check(fixture('4.0.0-beta.2', '4.0.0-beta.1'));
  check(fixture('4.0.0-beta.10', '4.0.0-beta.9'));
  for (const previous of ['4.0.0-beta.2', '4.0.0-beta.3', '4.0.0', '3.12.2', '']) {
    assert.throws(() => check(fixture('4.0.0-beta.2', previous)));
  }
  assert.throws(() => check(fixture('4.0.0', '4.0.0-beta.3')));
});

test('missing or incorrect acknowledgements, registry and bypass flags are refused', () => {
  for (const key of Object.keys(fixture().env)) {
    const missing = fixture();
    delete missing.env[key];
    assert.throws(() => check(missing), key);
    const wrong = fixture();
    wrong.env[key] = 'wrong';
    assert.throws(() => check(wrong), key);
  }
  for (const key of ['npm_config_force', 'npm_config_ignore_scripts']) {
    const f = fixture();
    f.env[key] = 'true';
    assert.throws(() => check(f));
  }
});

test('foreign packages, changed v3, missing version, metadata and tag races stop promotion', () => {
  const mutations = [
    f => {
      f.manifest.name = 'homebridge-cmd4-advantageair';
    },
    f => {
      f.document.name = 'other';
    },
    f => {
      f.legacy.name = 'other';
    },
    f => {
      f.legacy['dist-tags'].latest = '3.12.3';
    },
    f => {
      f.legacy['dist-tags'].beta = '4.0.0-beta.1';
    },
    f => {
      delete f.document.versions[f.manifest.version];
    },
    f => {
      f.document['dist-tags'].beta = '4.0.0-beta.2';
    },
    f => {
      f.document['dist-tags'].latest = '4.0.0-beta.2';
    },
    f => {
      f.document.versions[f.manifest.version].private = true;
    },
    f => {
      f.document.versions[f.manifest.version].gitHead = 'b'.repeat(40);
    },
    f => {
      f.document.versions[f.manifest.version].dist.integrity = 'sha512-' + 'B'.repeat(86) + '==';
    },
    f => {
      f.document.versions[f.manifest.version].dist.tarball = 'https://example.invalid/plugin.tgz';
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.throws(() => check(f));
  }
  assert.throws(() => check(fixture(), 'after'));
  assert.throws(() => check(fixture(), 'publish'));
});


test('matching full gitHead passes; absent, malformed or mismatched source attribution fails closed', () => {
  check(fixture());
  for (const value of [undefined, null, '', 'a'.repeat(39), 'A'.repeat(40), 'b'.repeat(40)]) {
    const f = fixture();
    f.document.versions[f.manifest.version].gitHead = value;
    assert.throws(() => check(f));
  }
  const f = fixture();
  delete f.document.versions[f.manifest.version].gitHead;
  // Unchecked assertions, even with matching registry integrity, are not source evidence.
  f.env.AA_BETA_SOURCE_VERIFIED = 'true';
  f.document.versions[f.manifest.version].sourceEvidence = {
    commit: f.env.AA_BETA_RELEASE_COMMIT, integrity: f.env.AA_BETA_RELEASE_INTEGRITY,
  };
  const before = globalThis.structuredClone(f);
  assert.throws(() => check(f), /source attribution is unverified/);
  assert.deepEqual(f, before);
});

test('current complete legacy snapshot passes; stale, extra and missing legacy tags fail', () => {
  check(fixture());
  for (const tags of [
    { latest: '3.12.2', beta: '3.6.0-beta.2' },
    { latest: '3.12.3', beta: '3.6.0-beta.2' },
    { latest: '3.12.4' },
    { latest: '3.12.4', beta: '3.6.0-beta.2', next: '3.12.4' },
  ]) {
    const f = fixture();
    f.legacy['dist-tags'] = tags;
    const before = globalThis.structuredClone(f);
    assert.throws(() => check(f));
    assert.deepEqual(f, before);
  }
});

test('exact published package identity and integrity remain mandatory', () => {
  for (const field of ['name', 'version']) {
    const f = fixture();
    f.document.versions[f.manifest.version][field] = 'wrong';
    assert.throws(() => check(f));
  }
  for (const value of [undefined, '', 'sha512-' + 'B'.repeat(86) + '==']) {
    const f = fixture();
    f.document.versions[f.manifest.version].dist.integrity = value;
    const before = globalThis.structuredClone(f);
    assert.throws(() => check(f));
    assert.deepEqual(f, before);
  }
});
