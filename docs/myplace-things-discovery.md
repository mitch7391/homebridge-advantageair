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

Numeric 1/2 are `blind-capable`; numeric 3/10 are `garage-gate-capable`.
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

## Next review gate

Confirm supported hardware mappings and sanitised controller response shapes
before adding any Things accessory lifecycle. Increment 2 should first resolve
physical subtype/configuration and readback semantics. Movement, inversion and
writes require separate approval and hardware-specific evidence. This increment
has no hardware acceptance and does not prepare a new package version.

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
