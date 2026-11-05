import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { checkReleaseCheckout, prepareNpmMetadata } from '../../dev/beta-source-preflight.mjs';

const npmCli = process.env.npm_execpath;
const manifest = { name: 'homebridge-advantageair', version: '4.0.0-beta.3', private: false,
  publishConfig: { tag: 'beta', registry: 'https://registry.npmjs.org/' },
  scripts: { prepublishOnly: 'exit 99', prepare: 'exit 99' } };
function fixture(t, packageData = manifest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-source-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('remote', 'add', 'origin', 'https://github.com/mitch7391/homebridge-advantageair.git');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageData));
  git('add', 'package.json');
  // Synthetic history exists only in this disposable fixture, never in the project.
  git('-c', 'user.name=Offline Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  return { root, git, commit: git('rev-parse', 'HEAD') };
}
const metadata = commit => async () => ({ metadata: { ...manifest, gitHead: commit }, npmVersion: 'fixture' });

test('ordinary checkout and detached HEAD pass without mutation or lifecycle execution', async t => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.root, 'package.json'));
  for (const detached of [false, true]) {
    if (detached) {
      f.git('checkout', '--detach', f.commit);
    }
    const index = fs.readFileSync(path.join(f.root, '.git/index'));
    const result = await checkReleaseCheckout(f.root, f.commit, npmCli, { prepare: metadata(f.commit) });
    assert.equal(result.gitHead, f.commit);
    assert.deepEqual(fs.readFileSync(path.join(f.root, '.git/index')), index, 'Preflight must not refresh the index.');
    assert.equal(f.git('status', '--porcelain'), '');
    assert.deepEqual(fs.readFileSync(path.join(f.root, 'package.json')), before);
  }
});

test('real installed npm generates gitHead for ordinary and detached checkouts', async t => {
  assert.ok(npmCli, 'Real npm verification is mandatory: run npm test (npm.cmd test on Windows) to supply npm_execpath.');
  const f = fixture(t);
  for (const detached of [false, true]) {
    if (detached) {
      f.git('checkout', '--detach', f.commit);
    }
    const index = fs.readFileSync(path.join(f.root, '.git/index'));
    assert.equal((await checkReleaseCheckout(f.root, f.commit, npmCli)).gitHead, f.commit);
    assert.deepEqual(fs.readFileSync(path.join(f.root, '.git/index')), index, 'Real npm preflight must preserve the index.');
    assert.equal(f.git('status', '--porcelain'), '');
  }
});

test('linked worktree is refused before npm metadata preparation', async t => {
  const f = fixture(t);
  const linked = path.join(f.root, 'linked');
  f.git('worktree', 'add', '--detach', linked, f.commit);
  await assert.rejects(checkReleaseCheckout(linked, f.commit, npmCli, {
    prepare: () => assert.fail('Must reject before preparing metadata'),
  }), /standalone clone/);
});

test('missing, incorrect or malformed approved commit fails', async t => {
  const f = fixture(t);
  for (const commit of [undefined, '', 'abc', 'A'.repeat(40), '0'.repeat(40)]) {
    await assert.rejects(checkReleaseCheckout(f.root, commit, npmCli, { prepare: metadata(f.commit) }));
  }
});

test('missing, incorrect or null npm gitHead fails closed', async t => {
  const f = fixture(t);
  for (const commit of [undefined, null, '', '0'.repeat(40)]) {
    await assert.rejects(checkReleaseCheckout(f.root, f.commit, npmCli, { prepare: metadata(commit) }), /npm prepared gitHead/);
  }
});

test('dirty checkout, untracked files and foreign origin are rejected', async t => {
  const f = fixture(t);
  const file = path.join(f.root, 'package.json');
  const original = fs.readFileSync(file);
  fs.appendFileSync(file, '\n');
  await assert.rejects(checkReleaseCheckout(f.root, f.commit, npmCli), /must be clean/);
  fs.writeFileSync(file, original);
  const extra = path.join(f.root, 'extra');
  fs.writeFileSync(extra, 'untracked');
  await assert.rejects(checkReleaseCheckout(f.root, f.commit, npmCli), /must be clean/);
  fs.unlinkSync(extra);
  f.git('remote', 'set-url', 'origin', 'https://example.invalid/other.git');
  await assert.rejects(checkReleaseCheckout(f.root, f.commit, npmCli), /Unexpected origin/);
});

test('metadata errors propagate and altered package identity is refused', async t => {
  const f = fixture(t);
  await assert.rejects(checkReleaseCheckout(f.root, f.commit, npmCli, { prepare: async () => {
    throw new Error('npm API unavailable');
  } }), /npm API unavailable/);
  for (const field of ['name', 'version', 'private']) {
    await assert.rejects(checkReleaseCheckout(f.root, f.commit, npmCli, { prepare: async () => ({
      metadata: { ...manifest, gitHead: f.commit, [field]: 'wrong' },
    }) }));
  }
  await assert.rejects(prepareNpmMetadata(f.root, path.join(f.root, 'missing-npm-cli.js')));
});

test('a supplied gitHead cannot substitute for npm generation', async t => {
  const f = fixture(t, { ...manifest, gitHead: 'a'.repeat(40) });
  await assert.rejects(checkReleaseCheckout(f.root, f.commit, npmCli), /Do not supply gitHead/);
});

test('staged changes and nested package roots are refused', async t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, 'package.json'), '\n');
  f.git('add', 'package.json');
  await assert.rejects(checkReleaseCheckout(f.root, f.commit, npmCli), /must be clean/);
  const nested = path.join(f.root, 'nested');
  fs.mkdirSync(nested);
  await assert.rejects(checkReleaseCheckout(nested, f.commit, npmCli));
});

test('an edit during asynchronous metadata preparation fails the final check', async t => {
  const f = fixture(t);
  await assert.rejects(checkReleaseCheckout(f.root, f.commit, npmCli, { prepare: async () => {
    fs.appendFileSync(path.join(f.root, 'package.json'), '\n');
    return metadata(f.commit)();
  } }), /Manifest changed/);
});
