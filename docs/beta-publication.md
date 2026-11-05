# Maintainer public-beta publication and tag gates

## Beta 1 publication record

homebridge-advantageair@4.0.0-beta.1 was published on 19 October 2026 from
95c41ca771cb159cde0d2decee23f6f1d5df1018, with private:false explicitly approved
for that release. Published integrity and all 129 packaged files were verified.
The rehearsal passed on Node 24.21.0 / npm 11.19.0 with policy, lint, clean build
and package checks. Homebridge search was verified to discover the standalone package.

Both beta and latest identified Beta 1 after initial npm publication with
--tag=beta. No separate latest-promotion command was executed. Do not repeat
publication or promotion for this version; a published version cannot be reused.
See the [GitHub prerelease](https://github.com/mitch7391/homebridge-advantageair/releases/tag/v4.0.0-beta.1).

The development master retains private:true intentionally. No test, CI job,
package check or policy validator publishes or changes registry tags. The
procedures below are for separately reviewed future versions, not Beta 1 replay.

## Beta 2 and Beta 3 publication records

Beta 2 was published on 21 October 2026. Beta 3 is now the current published
native release, homebridge-advantageair@4.0.0-beta.3. Its recorded, approved
release-source commit is f477b9fbb83ec71e50daae3bcb5064b3c9b4f289. This record
is not independent proof that the published archive was built from that commit;
this investigation did not establish independently verified published-package
provenance. Do not republish either version.
For these subsequent releases, publication to beta and any promotion to latest
are separate operations: qualify the exact source, rehearse, obtain publication
approval, inspect the published artifact, then obtain separate latest approval.
Read the live tags before acting; this record does not assert a promotion date
or invent evidence of a particular tag operation.

Beta 3 registry metadata omitted gitHead. The omission does not establish a
source mismatch, but prevents the existing promotion gate from attributing the
archive to the approved commit. The exact publication environment that caused the
omission has not been established; see the reproduced worktree limitation below.

## Two separately approved registry operations

For future versions publish homebridge-advantageair with beta. Verify its contents
and registry metadata, then obtain separate approval before assigning latest to
that exact version if a tag change is needed. Beta 1 showed that initial package
publication can also assign latest; verify actual outcomes rather than assuming
latest stayed absent. Latest means default installation, not stable quality.
Keep the public beta warning, prerelease version and GitHub Prerelease label.

Never modify homebridge-cmd4-advantageair. Its recorded tags are latest=3.12.4
and beta=3.6.0-beta.2. An intervening v3 release requires review of this snapshot,
not blindly restoring or changing its tags.

## Safeguards and limits

publishConfig still pins beta and the public registry. Initial publication must
pass dev/beta-policy.mjs: exact standalone name, 4.0.0-beta.N version, explicit
private:false, package/version acknowledgements and explicit beta/registry options.
Initial --tag latest remains prohibited. Force/ignore-scripts are refused when
the guard executes. prepublishOnly runs the guard, lint and actual package checks;
prepack cleans and rebuilds dist.

Only copied child environments for the checker's internal pack and offline
consumer installation override inherited dry-run. These local files must exist
for validation. The parent publication dry-run, process.env and hooks are unchanged.
No checker subprocess invokes publication or distribution-tag commands.

dev/beta-latest-policy.mjs is a read-only before/after gate. It requires exact
package/version acknowledgements, separate latest approval, the reviewed source
SHA and published sha512 integrity, an explicit previous latest (or none), matching
published metadata and beta tag, and unchanged v3 tags. It refuses downgrades,
repeated promotion and stable versions. It performs pinned-registry GET requests
only and never executes npm dist-tag.

Lifecycle hooks cannot protect independent npm dist-tag writes, raw-archive
publication or --ignore-scripts. These controls prevent accidents, not deliberate
bypass. Review the literal tag command separately. Registry reads/writes are not
atomic: coordinate with other maintainers, check immediately before each write
and verify afterward. Never automatically repair a tag or retry an ambiguous write.
Do not use --dry-run with dist-tag as if it made the operation harmless.

## Source checkout and missing gitHead

The npm 11.17.0 implementation used for Beta 3 reads .git/HEAD directly.
A linked Git worktree has a .git pointer file instead of a directory; offline
reproduction with that npm version omitted gitHead for linked worktrees but
produced the correct SHA for ordinary checkouts, including detached HEAD.
Exported directories and prebuilt archives without gitHead also omitted it.
This is a reproduced limitation, not proof of the exact Beta 3 publication cause:
the retained records do not establish the real publication command or checkout.

Use a clean standalone clone with its own .git directory for future publication,
pinned to the independently approved commit. Do not publish from a linked
worktree, source export or prebuilt tarball under this procedure. Use the same
reviewed Node/npm installation for preflight, rehearsal and publication.

Run the read-only preflight from the release checkout before rehearsal and again
immediately before publication, substituting the approved full SHA and the
absolute bin/npm-cli.js path of the trusted installed npm (not npm.cmd):

```text
node dev/beta-source-preflight.mjs . <approved-40-character-sha> <installed-npm-cli.js>
```

Quote paths containing spaces. On a standard Windows Node installation the last
argument is commonly "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js";
verify the actual installation rather than assuming this path. On Linux, resolve
the npm launcher to the installed npm CLI file. This check reads the canonical
origin, checkout root, clean Git status and HEAD, rejects linked worktrees and
pre-existing package.json gitHead, and uses that npm installation's fix/prepare
metadata APIs without saving, running hooks or accessing the registry. It checks
that generated gitHead equals the approved SHA and rechecks Git state afterward.
Missing npm internals or incorrect metadata fail closed: stop for tooling review.
This uses npm internals, so qualify it again when changing npm versions.

Release validation must run npm test (npm.cmd test on Windows) with the same
reviewed npm installation. This supplies npm_execpath to the real-npm integration
test, which must pass for ordinary and detached checkouts with unchanged index
bytes. Missing npm_execpath is a failure, not a skipped test. Do not substitute a
mock-only run or omit this test from required release validation.

The preflight does not establish remote branch freshness or fetch approval from
GitHub: independently verify the approved source and CI. Prevent concurrent edits
between checking and publishing. Ignored build files are not covered by clean Git
status; the clean build and package-content checks remain mandatory.

The latest-promotion gate still requires a full matching gitHead, exact registry
SHA512 integrity and all existing approval/tag checks. Missing metadata remains
a blocker; no fallback or environment assertion bypass is implemented. Do not
republish Beta 3 or inject a gitHead merely to satisfy the gate.

A matching gitHead alone is not source proof: npm can retain a supplied field and
does not prove the packed contents correspond to a clean source tree. Continue
recording the exact reviewed commit, build toolchain, candidate archive SHA512 and
complete file inventory. After publication independently obtain the official
registry archive without running its scripts, verify its bytes against
registry dist.integrity, and compare every member and file with the reviewed
candidate. Reject unsafe/duplicate paths and unexpected files. Where exact
archive bytes are expected, also compare the independently recorded integrity;
otherwise investigate every difference, not just the registry-reported hash.

Account explicitly for npm-generated metadata: validate gitHead when present and
review normalised repository metadata; never ignore arbitrary package.json fields.
The local package checker requires byte-exact packed content against the local
build; it does not itself authenticate published source attribution. Neither
preflight nor artifact verification authorises publication or latest promotion;
these remain two separately approved operations.

## Future release sequence

1. Prepare a separately reviewed, unused version on v4-beta, including the lock
   root and version-pinned tests/docs. Keep private:true during ordinary development;
   release enablement to private:false requires explicit approval. Preserve beta
   publishConfig, the guards and the recorded hardware qualification boundaries.
2. Use the standalone clone and source preflight above. Qualify the exact clean
   source with applicable green CI and package evidence.
   Read both packages' complete tag maps and check availability, account access
   and supported authentication/2FA privately. Never put tokens or OTPs in Git.
   Assess production and development advisories separately; do not blindly run
   npm audit fix or repeat unchanged hardware campaigns.
3. Prepare a version-specific runbook and obtain rehearsal approval. Supply
   AA_BETA_RELEASE_PACKAGE and AA_BETA_RELEASE_VERSION for that exact candidate.
   With npm 11 also supply npm_config_tag=beta and
   npm_config_registry=https://registry.npmjs.org/ to the lifecycle environment,
   in addition to explicit --tag=beta and --registry=https://registry.npmjs.org/.
   Retain --ignore-scripts=false and --force=false. Use --dry-run only for the
   separately approved rehearsal; it does not prove publication permissions.
4. Recheck source, account and registry before separately approved publication.
   Verify the beta tag, actual latest outcome and unchanged legacy tags afterward.
   Download and check registry dist.integrity and the reviewed archive contents,
   accounting explicitly for npm-generated metadata as described above. Missing
   gitHead must stop the current promotion gate. Do not automatically repair a tag.
5. If latest needs promotion, obtain separate approval and use the existing
   read-only beta-latest-policy before/after gates with the exact source SHA,
   verified published integrity and actual previous latest. Review the literal
   version-specific tag command separately. Do not replay Beta 1 commands.
6. On an ambiguous publication failure, first establish that the previous process
   has stopped and inspect the exact version, archive and complete registry tags
   before considering any retry. A client error does not prove publication failed.
   Never retry a version that already exists or automatically resend a tag write.
   Do not use --dry-run with dist-tag as if it made a write harmless.
7. Confirm Homebridge discovery/update behaviour for the announced version.
   Git tags, GitHub prerelease creation and announcements require separate
   approval and must identify the exact published source.

## Subsequent betas and eventual stable release

For the next separately approved beta review a coherent version update, including lock root and any
version-pinned tooling/docs. Publish beta, inspect, then separately approve latest.
Supply the actual old latest rather than none. The gate requires increasing beta
numbers. Until promotion, default installs remain on the previous reviewed beta;
record this short interval explicitly so latest is not forgotten. No automatic
promotion or tag synchronisation belongs in CI.

Normal Homebridge updates should offer a higher latest prerelease; exactly pinned
installations may need explicit selection. Do not modify v3 or downgrade tags to
influence native updates. On a bad beta, stop promotion and warn testers; separately
approve a correction/deprecation. Automatic unpublishing is not rollback and a
published version cannot be reused. Emergency rollback of latest is intentionally
outside this forward-only gate and requires a separate incident procedure.

Stable 4.0.0 needs a separately reviewed policy/documentation transition: current
beta guards deliberately reject it. Decide then what beta should track; do not
bypass guards or silently retain permanent dual-tag synchronisation.

## Homebridge UI expectations

Current UI source uses exact-name registry lookup, all-version/tag lookup for
alternate selection, and /latest for normal installation/update metadata. Both
tags should make these paths resolve the approved prerelease and later higher
betas. Search indexing and UI-version-specific behaviour still require actual
post-publication checks for future versions. Beta 1 exact-package search was
verified; this does not establish every UI update path or the maintainer's pending
live native-development migration.

References: [npm lifecycle](https://docs.npmjs.com/cli/v11/using-npm/scripts/),
[npm dist-tag](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/),
[Homebridge UI registry handling](https://github.com/homebridge/homebridge-config-ui-x/blob/latest/src/modules/plugins/plugins.service.ts).
