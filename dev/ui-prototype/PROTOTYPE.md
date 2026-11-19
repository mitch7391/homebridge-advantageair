# Custom configuration UI prototype (through Increment 2B-2B)

Isolated prototype only; do not publish or deploy this branch.

## View safely

From this worktree, run `node dev/ui-prototype/serve.mjs`, then open
<http://127.0.0.1:18582>. Stop with Ctrl+C. The server binds only to loopback,
serves a fixed file allowlist, and does not run Homebridge or write configuration.
An occupied port causes startup to fail; do not stop another process to free it.

The preview explicitly simulates the documented Homebridge API. Its Save and
Cancel buttons affect only in-memory synthetic configuration. Reloading the
outer page resets it. It is NOT a Homebridge UI acceptance environment.

The actual custom UI entry point is `homebridge-ui/public/index.html`.
`config.schema.json` enables it with `customUi: true`. Controller editing uses
documented getPluginConfig, getPluginConfigSchema, updatePluginConfig and
Save-button enable/disable APIs. Increment 2B-2B adds `homebridge.request`, a thin
`homebridge-ui/server.js` adapter, and exactly pinned
`@homebridge/plugin-ui-utils@2.2.7` for read-only discovery. The simulated preview
does not provide this backend and is not discovery acceptance evidence.

## Scope and preservation

Increment 2B-1 supports an absent platform and one existing AdvantageAir block.
Add Controller immediately creates and selects an unsaved draft controller with
port 2025 and no assumed air conditioner. Each tab's labelled close button removes
only that controller from the draft, without confirmation. Native Save applies
these changes; native Close discards unsaved additions and removals.
The last controller can be removed in the draft, but Save remains disabled until
a valid controller exists, preserving the schema's minimum-one rule.
Other returned configuration blocks are preserved verbatim.
The full JSON value is cloned. Only explicitly edited visible properties change.
Defaults are shown but not written on open. Hidden labels, sparse overrides,
future fields and absent optional properties survive. Invalid input blocks Save.
Host updates are serialized; returned stale snapshots never replace the draft.
An update failure blocks Save without retries. Cancel and reopen to recover.

Discovery display follows the existing session-only controller keys so removing
a preceding controller cannot retarget another controller's results. These keys
are not persisted and do not define hardware identity. Nothing assigns or changes
controller MIDs or Thing IDs, and no inventories are persisted.

## Increment 2B-2B automatic discovery

The form renders first. Opening initiates one asynchronous session manifest and
at most one controller read per eligible saved entry; tab selection and expansion
never repeat reads. Both failures and successes are cached for this UI session.
Discovery has no access to Draft mutations or Save-button controls. No controls,
accessories, writes, automatic retries or continuous polling are introduced.

The adapter reads the authoritative JSON at the utility's documented
`homebridgeConfigPath`. Exactly one AdvantageAir platform is required. A SHA-256
digest of the complete saved platform and each controller must match the initial
browser configuration before opaque server-generated tokens are associated with
stable draft keys. Digests prove configuration equality, not physical identity or
authentication; the authenticated Homebridge UI remains the trust boundary.
The HTTP-page fallback computes the same digest when Web Crypto is unavailable.
Duplicate saved endpoints are excluded. Tokens never accept destinations from
the browser. Full saved-platform equality is checked before queued reads and
again after each read. Saved changes invalidate results conservatively.

Only numeric, canonical IPv4 addresses and integer ports 1–65535 are accepted;
an omitted port means 2025, but null or string ports are invalid. Loopback,
link-local, multicast, unspecified/zero-network and reserved/broadcast ranges are
rejected. Routed public/VPN addresses remain possible. No DNS, redirects, proxy
route, credentials or write endpoint is provided: the transport is exclusively
`GET /getSystemData`. A saved address still cannot prove that the destination is
an Advantage Air controller; an administrator who saves an unrelated permitted
address can cause this one bounded GET. Responses must pass existing validation.

The pure service reuses compiled `validateSystemData()` and `configureThings()`;
the latter calls `observeThings()` / `discoverThings()`. It does not duplicate
classification, sparse overrides or lighting-ambiguity rules. Failed reads have
no last-good fallback. MID plus Thing ID remains hardware identity, replacement
controllers do not inherit overrides, and duplicate returned MIDs quarantine all
conflicting results. Earlier displayed results may be withdrawn when a later
controller establishes a conflict. All results remain unqualified, operational
false, with physical state unknown.

The allowlisted DTO contains token, observation time, discovery/configuration
status, diagnostic counts, bounded names, capability, configured status and
identity fields. It excludes raw readings, unrelated settings, addresses and
payloads. Names use `textContent`. Errors use fixed codes, not raw exception text.
The utility logs route names; this implementation does not log identifiers or
destinations. Unsaved connection/override edits suppress the matching display,
new controllers receive no token, and removal cannot retarget delayed results.
Closing drops browser results; IPC disconnect/SIGTERM aborts backend work.

### Explicit resource ceilings

- One in-flight controller request per backend session, no retry.
- 10 seconds total HTTP deadline, including body consumption.
- 4 MiB streamed response ceiling before JSON parsing; saved config also has a
  4 MiB ceiling. Repository single/multiple-system fixtures are 11,052 / 40,795
  bytes in this checkout; the existing 1,000-Thing test shape is about 79 KB.
  This provides headroom for combined HVAC, lighting and Things without retaining
  unbounded raw payloads. Compressed bodies are rejected.
- 2,048 records per Things inventory, lights inventory or saved override array.
  This is over twice the existing 1,000-record regression inventory. Observed and
  retained override identities can produce up to 4,096 DTO rows. Oversize inputs
  return an explicit unavailable error; no silent truncation.
- 32 saved controllers maximum. This is an engineering safety ceiling, not a
  claimed controller specification: it bounds serial waiting to 320 seconds and
  per-session retained data while allowing substantially more than the tested
  two-controller UI. UI manifest waiting is capped at 5 seconds and queued read
  waiting at 325 seconds. Excess controller count fails before network activity.
- Existing discovery bounds names to 256 characters and Thing IDs to 64; this
  boundary additionally rejects controller MIDs above 256 characters.

These are prototype limits requiring maintainer/hardware qualification, not
claims of installation-wide capacity. Multiple settings windows and the running
plugin's normal polling can overlap: serialization is **per backend session**.
There is no claim that read-only HTTP eliminates controller load. Session results
are timestamped observations, not continuously current state. Saved changes after
the final read are not watched; reopen settings to obtain another observation.

### Synthetic validation

After `npm run build`, run `node --test test/ui/*.test.mjs test/discovery/*.test.mjs`.
The new tests inject transport and clocks; no controller address is contacted.
An isolated IPC adapter test uses the actual pinned utility, a synthetic saved
configuration with an ineligible loopback address, and no network request.
It disconnects only its own newly created child process. Node 22/24 tests do not
establish real Homebridge/HOOBS compatibility.

## Validation and remaining gate

Run `node --test test/ui/prototype.test.mjs` for pure preservation tests.
`browser-check.mjs` uses an externally supplied existing Playwright installation
(`PLAYWRIGHT_PATH`) and Chrome executable (`CHROME_PATH`), intercepts all network
requests, and exercises the simulated host. It can save a screenshot using
`SCREENSHOT_PATH`. No dependency installation is required by the prototype.

The isolated refinement lab exercised Homebridge 2.4.0 / UI 5.30.0 on Node 24.19.0:
native Save/Close, direct addition and removal, invalid/empty draft blocking,
rapid edits, and complete persisted JSON comparisons passed. Light/dark themes
were checked at 1200px and 390px widths. Evidence is retained separately in
lab-beta4-2b1-refinement-20261115. Maintainer visual approval and broader version
compatibility remain separate gates. The simulated preview alone is not
sufficient to establish parent/iframe message ordering.

Only the approved utility production dependency was added to package metadata;
the files allowlist is unchanged and still excludes the prototype UI assets.
The package checks permit exactly that dependency/version and retain all other
inventory, offline-consumer and release-policy checks. The root lockfile funding
entry mirrors existing package.json funding; it introduces no new funding data.
Consequently this branch is intentionally NOT a deployable
npm package: do not package/install it with customUi enabled. A later approved
lab integration must include the UI assets explicitly without exposing a real
controller or changing production storage.

Packaging, actual Homebridge 1.8.x/2.x custom-backend lifecycle, saved-config versus
host-injected fields, and Save/Close with pending discovery remain separate lab
qualification gates. HOOBS compatibility is unverified until the separate
hardware test; no HOOBS adapter is implemented. The service/DTO are independent
of Homebridge utility APIs, which are confined to server.js. Existing schema,
HVAC and lighting runtime remain untouched.
