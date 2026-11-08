# MyPlace Things discovery foundation (unreleased)

This increment exposes `discoverThings(snapshot)` and `observeThings(pollState)`
from `src/discovery/discoverThings.ts`. It does not enable Things accessories.
The latter accepts the existing coordinator/poller snapshot and rejects failed
reads rather than presenting last-good data as fresh discovery. No manager is
registered and no automatic logging is added. A future consumer can invoke this
pure function from the existing snapshot update callback without another request.

## Evidence and conservative interpretation

- Native `validateSystemData` retains unknown fields including `myThings`.
- Legacy `ConfigCreator.sh` reads `myThings.things` IDs directly (around line 1788).
  The two historical MyPlace fixtures have string IDs and numeric DIP 3. They are
  reference material only; no private values were copied into new fixtures.
- Home Assistant's Advantage Air cover implementation maps numeric DIP 1/2 to
  blinds and 3/10 to garages:
  https://github.com/home-assistant/core/blob/dev/homeassistant/components/advantage_air/cover.py
  Inspected 7 November 2026. This is implementation evidence, not a firmware spec
  or physical qualification of every controller. In particular DIP 10 is backed
  by Home Assistant, not the inspected local hardware fixtures.
- The upstream Python client also reads `/getSystemData` and requires an aircons
  key: https://github.com/Bre77/advantage_air/blob/master/advantage_air/__init__.py

Numeric 1/2 are `blind-capable`; numeric 3/10 are `garage-gate-capable`;
numeric 8 is `relay-capable`. DIP 8 is supported by Home Assistant's
[relay switch implementation](https://github.com/home-assistant/core/blob/dev/homeassistant/components/advantage_air/switch.py),
inspected 8 November 2026. It does not identify the connected load as a fan.
Everything else is `unknown`, including numeric strings: the inspected evidence
supports numbers, not string coercion. Physical subtype always remains
`undetermined`. Names never establish capability. No output means garage versus
gate, fractional positioning, direction, speed, obstruction detection or a
confirmed physical state. Relay fan classification is deliberately not inferred.

## Identity and malformed data

Identity is a controller-scoped tuple using `system.mid` and the Thing's string
ID, independent of its display name. No HomeKit UUID is generated. IDs must be
1–64 ASCII letters/digits/underscore/hyphen and match the collection key; this
conservative boundary mirrors native light IDs and may exclude undocumented IDs.
All occurrences of a repeated ID are quarantined, even if one has a mismatched
key. Other malformed entries are skipped individually. Duplicate names are fine.
Output is sorted by ID and detached/frozen; callers cannot mutate the snapshot.

Only bounded primitive values for `channelDipState`, `buttonType`, `dimPercent`
and `value` are retained as reported data, with no physical-state interpretation.
Malformed optional fields do not prevent discovery of an otherwise identified
Thing. Counts/status report invalid, duplicate and unknown records without
logging IDs or payloads. Missing controller identity gives unavailable discovery;
missing Things gives absent discovery, not confirmed removal of hardware.

## Existing architecture boundaries

The API client parses JSON then validates structure; the coordinator caches
cloned snapshots and sends updates to platform managers. Lighting still uses
`observeLights` and `LightManager` unchanged. The discovery helper imports types
only; it cannot call HTTP, timers, controller commands or Homebridge APIs.

Things-only data is usable through native validation when `system` and
`aircons: {}` exist and the controller does not report missing aircons. Omitting
`aircons` still fails native validation. This increment does not relax that safety
rule. Response-size limits, polling intervals, ownership checks and latency
behaviour also remain unchanged.

Historical dumps contain location fields and device identifiers. A separate
fixture-privacy review is recommended; this work neither reproduces raw values
nor cleans up historical files. New tests use small synthetic data, plus a
synthetic 5,000-record collection.

## Increment 2A: explicit configuration and reported endpoints

Optional `devices[].things` settings are available in the standard controller
form. They are preparation only: nothing is registered, controlled or moved.
The platform's existing managers and coordinator are unchanged. The pure
`configureThings(pollState, device.things)` helper in
`src/discovery/configureThings.ts` is not yet wired into platform callbacks.
It consumes the existing Increment 1 discovery model, with no additional reads,
timers, state cache, commands or dependencies.

Example inside one controller entry (synthetic identifiers):

```json
{
  "ipAddress": "192.0.2.1",
  "things": [
    { "controllerId": "synthetic-controller", "id": "t1", "type": "garage-door", "invert": false },
    { "controllerId": "synthetic-controller", "id": "t2", "type": "relay-switch" }
  ]
}
```

`controllerId` is the exact nonblank `system.mid` (no surrounding whitespace),
not an address or display name. `id` follows the discovery ID rules above.
Matching uses both, so renaming or an IP change cannot retarget a device, and a
replacement controller with the same Thing IDs does not silently match. Every
entry within one controller's array must have the same MID. Keep real MIDs and
controller data private; do not post full configuration or raw responses.

| User-selected `type` | Required reported capability | Interpretation limit |
| --- | --- | --- |
| `garage-door` / `gate` | Numeric DIP 3 or 10 | No physical end-position, movement or obstruction proof |
| `blind` | Numeric DIP 1 or 2 | No continuous position or travel calibration inferred |
| `relay-switch` | Numeric DIP 8 | No proof of connected load state |
| `relay-fan` | Numeric DIP 8 and an explicitly identified installed fan | No fan identification from DIP/name, speed or rotation feedback |

The user selects installed hardware; the reported `physicalSubtype` remains
`undetermined`. A compatible selection is not electrical/safety qualification or
permission to control it. Unknown hardware and capability/type mismatches remain
unsupported. Relay fan selection records user knowledge only; its wiring, relay
mode and safe operation still require hardware evidence before any exposure.

Omitting `things` selects nothing; an empty array also selects nothing. There is
no default physical type. `invert` is optional and defaults to false. Invalid
IDs, properties, types or inversion values, repeated IDs (even identical entries),
and mixed controller MIDs invalidate the entire controller's Things configuration.
Raw discovery remains available. Schema validation catches field errors; the pure
helper additionally rejects duplicates and conflicts. Nothing about invalid
Things settings changes the existing HVAC or lighting configuration.

For a matched compatible observation, only numeric `value: 0` and `value: 100`
produce a valid interpretation. The result carries `reportedValue`, `logicalValue`
and `physicalState: "unknown"`. Inversion swaps only logical 0/100; it never
changes raw data, identities or stored controller values. For example reported
100 becomes logical 0 with inversion. No HomeKit characteristic value is emitted.

Legacy `AdvAir.sh` used 100/open and 0/closed with a manual `flip` option, and
wrote these values through `/setThing`. That is evidence of command-state mapping,
not proof of door position sensors. Its fallback treating other values as an
endpoint is deliberately not reproduced. Missing values yield `unavailable`;
malformed values, strings, booleans, null and non-endpoint numbers yield `invalid`.
Discovery's `valueStatus` distinguishes an omitted value from a rejected
non-scalar value without retaining malformed payloads. `buttonType` and
`dimPercent` are retained but cannot establish movement, fan speed, obstruction,
position or an alternative endpoint.

Results retain configured entries as unavailable when their observations are
missing/quarantined. Partial discovery can still supply valid peers, while its
partial status is preserved. Failed coordinator reads reject last-good data.
The helper uses the existing freshness signal, not an invented age timeout;
future consumers must use current coordinator snapshots and fault readings on
shutdown/disconnection, not reuse an old successful result indefinitely.
No status authorises removal of previously recognised hardware. Configuration
and interpretation outputs are detached/frozen and are recalculated per snapshot.

## Next review gate

Increment 2B should first qualify sanitised hardware readbacks, relay modes,
physical feedback availability and a read-only lifecycle with stable identities,
faulting and non-removal tests. Separately decide safe HomeKit presentation where
only command-state feedback exists. Neither a compatible configuration nor a
numeric endpoint justifies an operational GarageDoorOpener or blind position.
Writes and movement require separate approval and hardware-specific evidence.
This foundation has no physical hardware acceptance or new package version.

## Inventory completeness contract

Controller identity is checked before absence: missing/invalid system.mid gives
`unavailable`, even without myThings. A valid identified controller without
myThings gives `absent`; an invalid collection shape gives `malformed`.

`present` means every inventory record was accepted, including an explicitly
empty collection. `partial` means at least one malformed or duplicate record was
quarantined; valid peers remain available. All-rejected collections are partial,
not complete empty inventories. Structurally valid unknown hardware remains a
complete discovery record. Failed reads always give unavailable with no Things.

Future consumers must not remove cached accessories based on partial, malformed,
absent or unavailable results. Even a complete snapshot is only inventory evidence,
not physical removal confirmation; lifecycle policy remains a separate increment.
