# Maintainer simulator lab (Windows 11)

**Developer/test tooling only.** This is not a plugin setting, production runtime
feature, installer or Windows service. Do not point it at a real controller or
production Homebridge storage. Node 24 and this checkout's installed dependencies
and compiled `dist` are required. No new dependencies are introduced.

The standalone build uses the `homebridge-advantageair` plugin allowlist.
Existing persistent lab installations must follow
[the offline cache/allowlist transition](native-package-transition.md) first.
Do not delete their storage or generate a new bridge identity just for this rename.

## Everyday commands

Open PowerShell in your Windows lab checkout. The following is an example
location; use the checkout containing the reviewed MyPlace-lights build:

```powershell
Set-Location (Join-Path $env:USERPROFILE "GitHub\homebridge-cmd4-AdvantageAir")
```

| Operation | Windows command | npm equivalent |
| --- | --- | --- |
| Start everything | `.\lab.cmd start` | `npm run lab:start` |
| Stop everything | `.\lab.cmd stop` | `npm run lab:stop` |
| Status | `.\lab.cmd status` | `npm run lab:status` |
| Start simulator | `.\lab.cmd simulator start` | `npm run simulator:start` |
| Stop simulator | `.\lab.cmd simulator stop` | `npm run simulator:stop` |
| Simulator status | `.\lab.cmd simulator status` | `npm run simulator:status` |
| Start Homebridge | `.\lab.cmd homebridge start` | `npm run lab:homebridge:start` |
| Stop Homebridge | `.\lab.cmd homebridge stop` | `npm run lab:homebridge:stop` |
| Homebridge status | `.\lab.cmd homebridge status` | `npm run lab:homebridge:status` |
| Follow Homebridge log | `.\lab.cmd logs` | `npm run lab:logs` |
| Follow Homebridge explicitly | `.\lab.cmd logs homebridge` | `npm run lab:logs:homebridge` |
| Follow simulator log | `.\lab.cmd logs simulator` | `npm run lab:logs:simulator` |

The Windows shortcut uses Node on PATH, or the existing bundled Node installation
on this laptop. It does not need npm or a running Codex session. The underlying
command is `node dev/lab/lab.mjs start` (and likewise stop/status).

Start-all starts the simulator first; stop-all stops Homebridge first. Repeating
start does not launch duplicates or reload the fixture. A running status confirms
the managed process, not that an iPhone has reached it. An individual simulator
stop leaves Homebridge running with unavailable simulated accessories.

After spawning a worker, the manager retries transient control/status timeouts
within one 30-second startup deadline. Authentication and process-identity errors
still fail immediately. If startup expires, inspect status and logs: a worker may
finish later. The manager does not kill that worker or another process on timeout.

## Components and data flow

Apple Home → isolated Homebridge/HAP → v4 accessory/coordinator → HTTP
`/setAircon` or `/setLight` → existing AirConServer simulator → `/getSystemData` → confirmation.

- `dev/lab/AirConServer.cjs`: copy of the existing v3 simulator, with v4 JSON
  parsing, local dependency resolution, loopback-only binding and an exported
  server-ready promise for safe lifecycle control. Original source
  blob: `14e04491e99e312899a2c2a9b48c86e9ca9d0083`. Its legacy style is excluded
  individually from ESLint; the new control scripts are linted normally.
- `dev/lab/fixtures/percentage.json`: default startup fixture, derived from the historical
  single-system fixture's existing type-zero z06. It starts **Percentage Test Zone
  On at 40%**. The worker loads it on every fresh default-profile simulator start.
- `dev/lab/fixtures/myzone.json`: explicitly selected MyZone scenario with Living
  and Bedroom reference zones plus the percentage zone. Select it using
  `dev/lab/myzone.ps1 -Action Reset`, as described below.
- `dev/lab/lab.mjs`, `worker.mjs`, `paths.mjs`: local start/stop/status controls.
- `dev/lab/diagnostics.mjs`: development-process-only HAP write, admission, payload
  and readback diagnostics. No plugin source or production logging changes.
- Plugin loaded from this checkout's `dist`, dependencies from `node_modules`.

The simulator keeps edits and the loaded fixture queue in memory. Every fresh
default-profile simulator start loads the percentage fixture; Homebridge-only restarts
leave the current scenario and its state alone. Start does not save live edits
back to fixture files. The load endpoint appends fixtures rather than replacing
them, so explicit scenario selection must reset the queue before loading and
verifying the chosen fixture. The MyZone helper performs that sequence without
changing the worker's default fixture path. The explicit `myplace-extras` startup
profile selects its own fixture as described below; it does not switch a running
simulator or replace the existing MyZone reset/load procedure.

## Persistent storage and ports

Choose a persistent runtime outside the repository using ignored
`dev/lab/local.json` (see `local.example.json`) or `AA_LAB_HOME`.
Preserve the runtime directory already used by an existing paired lab bridge;
do not move or regenerate its files. The runtime contains:

- `storage/config.json`: isolated Homebridge configuration.
- `storage/persist/`: existing Apple Home pairing and identifiers — preserve it.
- `storage/accessories/`: existing accessory cache — preserve it.
- `simulator.log`, `simulator-error.log`: appended simulator output/errors.
- `homebridge.log`, `homebridge-error.log`: appended managed Homebridge output/errors.
- `*-control.json`: private management token/PID records; not HomeKit pairing data.

`AA_LAB_HOME` can override the runtime directory. Without an override/local.json,
the default is `../advantage-air-lab`, outside the repository. The default profile requires
an existing isolated `storage/config.json` and preserves its bridge identity.
The explicit Extras profile creates a separate identity/storage once, as described
below. Keep the base runtime setting consistent across launch/stop commands.
Never commit runtime storage, pairing files, management tokens or local.json.

| Purpose | Address / port |
| --- | --- |
| Simulator | `127.0.0.1:52025` (laptop only) |
| Simulator management | `127.0.0.1:52026` (authenticated) |
| Homebridge management | `127.0.0.1:52027` (authenticated) |
| Isolated HomeKit bridge | Laptop LAN address configured in `storage/config.json`, port `51889` |
| HomeKit discovery | mDNS, UDP 5353, ciao advertiser |

The bridge name, username/PIN and network binding are in the preserved
runtime's `storage/config.json`. If already paired, **do not add it again**. Restarting uses the same identity and preserves room
assignments; accessories require their matching scenario to become responsive. Keep the
laptop awake and on the same LAN as the iPhone. If its IP changes, update only
the isolated config's `bridge.bind`; preserve username, PIN and storage. No
production configuration changes are needed for scenario selection.

## Inspect and troubleshoot

Run in the Windows PowerShell lab checkout:

```powershell
.\lab.cmd status
.\lab.cmd logs
# Ctrl+C stops log viewing, not the lab.
.\lab.cmd logs simulator
```

Log viewing prints the last 40 available lines and follows new lines. It also
works while a component is stopped if its log exists. Missing logs produce a
clear error. It does not start, stop or acquire management control of the lab.

HAP diagnostics use `[AA HOME TRIAL]`: `HAP_WRITE`, `DESIRED_ADMITTED`,
`HAP_ACCEPTED`, `SET_PAYLOAD`, `SIMULATOR_READ`. Existing plugin confirmation logs
complete the trace. The default percentage fixture has no usable temperature-reference
zone, so its simulated thermostat's current temperature is unavailable; that is unrelated
to percentage testing. The MyZone fixture adds temperature-reference zones. Interpret
accessory availability against the selected scenario, not the default fixture alone.

Stop-all is the safe shutdown command. Homebridge runs its own SIGINT teardown
inside its process; the simulator closes its own server instance. Neither command kills
a process by PID. A per-run secret and matching component/runtime identity are
required before shutdown. Unmanaged listeners or identity/authentication mismatch
produce an error and are left alone. Do not work around this by killing all Node
processes. Inspect the indicated logs instead. Start failures are reported; use
status and stop for any component that did start.

When stopped, Home will eventually mark test accessories unavailable. Start the
lab later without re-pairing; select MyZone explicitly if that is the scenario you
need, because a fresh default-profile simulator starts with percentage.json. Physical Advantage Air firmware
percentage retention is still not established by this simulated environment.

## Selecting the MyZone scenario

See [MyZone operator procedure](myzone-presentation.md) for the guarded scenario reset
and the separate Homebridge-only persistence test. `dev/lab/myzone.ps1 -Action Reset`
ensures the managed simulator is running before HTTP calls, clears the fixture queue
with `/reInit`, loads MyZone and verifies consecutive reads before starting Homebridge.
The simulator's load endpoint appends fixtures; loading MyZone after the worker's
default percentage fixture without resetting does not immediately replace it.

`-Action RestartHomebridge` preserves simulator memory and fails if the simulator is
missing or its PID changes. A full lab restart reloads the default percentage fixture
and cannot establish persistence of the prior simulated state. Keep all pairing data.

Homebridge warnings use stderr and are in `homebridge-error.log`; `lab.cmd logs`
currently follows `homebridge.log` (stdout) only. Check both when diagnosing a refusal.

The linked MyZone procedure invokes `.ps1` files through `powershell.exe -NoProfile
-ExecutionPolicy Bypass -File ...` and checks the exit code. This permits the script
for that process without changing permanent machine/user policy. Enforced Group Policy
can still prevent execution; stop if blocked rather than changing policy globally.

## MyPlace Extras-only profile

Run in the **Windows terminal, from the lab checkout** (with its existing compiled
MyPlace-lights build and dependencies):

```powershell
.\lab.cmd stop --profile percentage
if ($LASTEXITCODE -ne 0) { throw 'Stop failed; inspect the output.' }
.\lab.cmd start --profile myplace-extras
```

This uses the same simulator, historical `/setLight` endpoint, normal polling,
and managed Homebridge workers. The fixture has `aircons: {}`, two relay lights
(Porch Light, Utility Light), and two dimmers (Living Light, Bedroom Light).
It also contains Garage Door (DIP 3, initially Closed) and Driveway Gate (DIP 10, initially Open), with independent IDs garage1 and gate1. No type overrides are required. It is a synthetic standalone topology assembled
from the existing sanitised light patterns, not a real standalone capture.

The profile creates `myplace-extras/storage` beneath the existing lab runtime
on first start. It copies only the lab bridge's network settings/PIN into a new
configuration with a new bridge username; it never copies AC accessories or
pairing data. Pair **MyPlace Extras Lab** once in Apple Home, using the PIN in
`myplace-extras/storage/config.json` beneath the base runtime. Subsequent starts preserve that profile's identity.
The original AC lab storage and any real Homebridge installation remain unchanged.
Existing AC test accessories from the original bridge may still appear in Home
as unavailable while that bridge is stopped; this profile exposes lights and garage/gate accessories.

Use the same profile on management commands. Run in the **Windows terminal**:

```powershell
.\lab.cmd status --profile myplace-extras
.\lab.cmd logs --profile myplace-extras
.\lab.cmd stop --profile myplace-extras
```

The profiles share the established lab ports and cannot run simultaneously.
Stop the active profile before starting another. A Homebridge-only restart
preserves simulator state; a fresh simulator start reloads the selected fixture.
Without `--profile`, the existing percentage/MyZone workflow is unchanged.


## Garage/gate acceptance (not yet physically beta validated)

Use the existing myplace-extras profile and ownership checks above. Do not start it
alongside another profile: ports are shared. Preserve its existing storage and pairing.
The fixture has no air conditioners. Confirm four lights plus two GarageDoorOpener
accessories, then exercise Open/Close and compare simulator logs for one /setThing
request per accepted command. Current state must follow readback, not movement timing.

For an external simulated change, after verifying ownership of the loopback simulator,
use PowerShell: Invoke-WebRequest -UseBasicParsing -Uri
'http://127.0.0.1:52025/setThing?json=%7B%22id%22%3A%22garage1%22%2C%22value%22%3A100%7D'.
Use value 0 for Closed; use gate1 to change only the gate. Never substitute a real IP.

In isolated saved devices[0].things, an optional entry is
{ "controllerId": "lab-myplace-extras", "id": "garage1", "invert": true }.
Use type "gate" or disabled true as separate scenarios; preserve unrelated fields.
Save/restart only the managed lab Homebridge. Verify inversion, disable/re-enable,
stable UUIDs, rename, rapid opposing targets, external operation and outage/recovery.
Homebridge-only restart must preserve simulator state and cached identities.
Do not infer obstruction or intermediate movement from this simulator.

For mixed HVAC coverage, load a disposable composition of the existing myzone.json
fixture and the Extras myLights/myThings collections through the same fixture loader,
after the documented queue reset. Keep the chosen system MID stable and scoped overrides
consistent. Do not replace the established fixtures or paired storage during acceptance.
No simulator process was launched for implementation. Functional commissioning is separate.
