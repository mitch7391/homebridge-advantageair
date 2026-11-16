# Increment 2B-0 initial proof

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
`config.schema.json` enables it with `customUi: true`; no server.js or new
dependency is needed. Only documented getPluginConfig, getPluginConfigSchema,
updatePluginConfig and Save-button enable/disable APIs are used.

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

Synthetic inventories follow session-only controller keys so removing a preceding
controller cannot retarget the remaining examples. These keys are not persisted
and are not hardware identity matching. Nothing assigns or changes controller MIDs or
Thing IDs, and no inventories are persisted. Real transport must use the existing
identity-bound discovery model in a separately approved increment.

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

Package metadata is unchanged and its existing files allowlist excludes the
prototype UI assets. Consequently this branch is intentionally NOT a deployable
npm package: do not package/install it with customUi enabled. A later approved
lab integration must include the UI assets explicitly without exposing a real
controller or changing production storage.
