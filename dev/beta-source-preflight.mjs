import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertBetaPackage } from './beta-policy.mjs';

// Use the trusted installed npm selected for publication, never a downloaded package.
export async function prepareNpmMetadata(root, npmCli) {
  const cli = fs.realpathSync(npmCli);
  assert.equal(path.basename(cli), 'npm-cli.js', 'Supply the installed npm bin/npm-cli.js, not npm.cmd.');
  const npmRoot = path.dirname(path.dirname(cli));
  const npmPackage = JSON.parse(fs.readFileSync(path.join(npmRoot, 'package.json'), 'utf8'));
  assert.equal(npmPackage.name, 'npm');
  const require = createRequire(cli);
  const PackageJson = require(path.join(npmRoot, 'node_modules/@npmcli/package-json'));
  // Mirrors npm directory publication: fix and prepare only; never save or run hooks.
  const pkg = await PackageJson.fix(root);
  const { content } = await pkg.prepare();
  return { metadata: content, npmVersion: npmPackage.version };
}

export async function checkReleaseCheckout(root, commit, npmCli, { prepare = prepareNpmMetadata } = {}) {
  assert.match(commit ?? '', /^[0-9a-f]{40}$/, 'Require the independently approved full commit SHA.');
  root = fs.realpathSync(root);
  const dotGit = path.join(root, '.git');
  assert.ok(fs.lstatSync(dotGit).isDirectory(), 'Publication requires a standalone clone with a .git directory; linked worktrees are refused.');
  // Do not let shell Git overrides redirect inspection away from the supplied checkout.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { env, encoding: 'utf8' }).trim();
  const inspect = () => {
    assert.equal(fs.realpathSync(git('rev-parse', '--show-toplevel')), root);
    assert.equal(fs.realpathSync(git('rev-parse', '--absolute-git-dir')), fs.realpathSync(dotGit));
    assert.equal(fs.realpathSync(path.resolve(root, git('rev-parse', '--git-common-dir'))), fs.realpathSync(dotGit));
    assert.ok(['https://github.com/mitch7391/homebridge-advantageair.git',
      'git@github.com:mitch7391/homebridge-advantageair.git'].includes(git('remote', 'get-url', 'origin')), 'Unexpected origin.');
    assert.equal(git('rev-parse', 'HEAD'), commit, 'Checkout differs from the approved commit.');
    assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '', 'Release checkout must be clean.');
  };
  inspect();
  const filename = path.join(root, 'package.json');
  const before = fs.readFileSync(filename);
  const manifest = JSON.parse(before);
  assertBetaPackage(manifest);
  assert.equal(manifest.private, false, 'Publication remains disabled.');
  assert.ok(!Object.hasOwn(manifest, 'gitHead'), 'Do not supply gitHead in package.json; verify npm generates it.');
  const { metadata, npmVersion } = await prepare(root, npmCli);
  assertBetaPackage(metadata);
  assert.equal(metadata.name, manifest.name);
  assert.equal(metadata.version, manifest.version);
  assert.equal(metadata.private, false);
  assert.equal(metadata.gitHead, commit, 'npm prepared gitHead is missing or incorrect; stop before publication.');
  assert.deepEqual(fs.readFileSync(filename), before, 'Manifest changed during preflight.');
  inspect();
  return { commit, package: manifest.name, version: manifest.version, npmVersion, gitHead: metadata.gitHead };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 5, 'Usage: node dev/beta-source-preflight.mjs <checkout> <approved-sha> <installed-npm-cli.js>');
  console.log(await checkReleaseCheckout(...process.argv.slice(2)));
  console.log('PASS: read-only source/metadata preflight; no hooks, publication or registry operations performed.');
}
