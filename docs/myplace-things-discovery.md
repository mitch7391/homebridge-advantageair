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
numeric 4 is `on-off-light-capable`; numeric 5 is `dimmable-light-capable`;
numeric 8 is `relay-capable`. DIP 4/5 are supported by Home Assistant's
[Things light implementation](https://github.com/home-assistant/core/blob/dev/homeassistant/components/advantage_air/light.py),
inspected 9 November 2026. These categories do not qualify native control. DIP 8 is supported by Home Assistant's
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

## Increment 2A revision: discovery with sparse exceptions

Automatic discovery, future automatic exposure for **separately qualified**
hardware, and configuration only where necessary. This increment is read-only:
no Things accessories, controller commands, timers, polling loops or runtime
manager changes. Existing HVAC and LightManager behaviour remains unchanged.
The pure `configureThings(pollState, device.things)` helper consumes Increment 1
observations. It is not yet wired into platform callbacks or a custom UI.

Every result explicitly has `qualification: "unqualified"` and
`operational: false`. Neither a DIP classification, endpoint value nor user
confirmation can change these fields. An automatic candidate needs no user
configuration, but is **not** qualified to operate. Future operational exposure
requires a separate, evidence-backed qualification and accessory increment.

| Numeric DIP | Capability | Intended future policy after qualification |
| --- | --- | --- |
| 1, 2 | Blind-capable | Automatic; no continuous position inferred |
| 3, 10 | Garage/gate-capable | Require garage-door versus gate confirmation and separate safety qualification |
| 4 | On/Off light-capable | Automatic, subject to lighting identity resolution |
| 5 | Dimmable light-capable | Automatic, subject to dimming and lighting identity qualification |
| 8 | General relay-capable | Automatic Switch only after maintained-output behaviour is verified |
| Other/malformed | Unknown | Diagnostics only; no automatic exposure |

DIP 8 does not distinguish momentary from maintained operation or identify the
connected appliance. No relay type selection, Fan, Light or Outlet presentation
is provided. Device names never establish capability, wiring or identity.

### Internal override contract

Optional `devices[].things` is a sparse array of identity-bound exceptions,
not a saved inventory. The defective manual Things array editor has been removed
from the standard form; schema validation remains. Users are not asked to enter
MIDs or IDs. The subsequent discovery interface must obtain these automatically.
The example below documents the internal format, not a manual setup requirement:

```json
{
  "ipAddress": "192.0.2.1",
  "things": [
    { "controllerId": "synthetic-controller", "id": "t1", "type": "gate", "invert": true, "disabled": true },
    { "controllerId": "synthetic-controller", "id": "t2", "disabled": true }
  ]
}
```

Only `controllerId` and `id` are required within an override. Optional fields:

- `disabled: true`: explicit exclusion. Preserve the entire entry while disabled.
  False or omission restores default candidate eligibility, not qualification.
- `invert: true`: swap logical endpoints only. False or omission leaves them as
  reported. Toggling disabled must not discard inversion or type confirmation.
- `type: "garage-door" | "gate"`: physical-type confirmation, valid only for a
  reported garage/gate capability. There is no type/default requirement for
  blinds, lights or ordinary relays.

Omitting `things` or using an empty array leaves discovery active with no
exceptions. Discovery never writes defaults or candidate rows into saved config.
The schema adds no default values to override fields. Existing HVAC settings and
optional light exclusions are retained independently. The unmerged earlier
2A types `blind`, `relay-switch` and `relay-fan` are no longer accepted;
existing experimental entries are flagged, not silently converted or deleted.

Matching uses the exact controller MID and Thing ID tuple, never names or IPs.
An override for an old MID is retained as unavailable (or excluded) alongside
new-controller candidates. The same Thing ID on a replacement controller does
not inherit its settings. Mixed MIDs can therefore remain saved during a
replacement; no automatic reassignment occurs. Keep real identifiers private.

Malformed values or duplicate overrides with identifiable MID/ID quarantine
that identity only. All duplicate occurrences are rejected, including identical
ones. An unidentifiable override might have been an exclusion of any device, so
all Things in that configured controller fail closed until corrected. This does
not affect HVAC, lighting, or separately configured controllers. Unsupported
properties and attempts to supply qualification/operational flags are rejected.
`invalidOverrides` counts structurally invalid/duplicate input entries;
capability conflicts additionally produce `configurationStatus: "invalid"`.

### Result and freshness contract

Results join current discovery with saved exceptions, preserving offline
exceptions without pretending there is a current observation:

| Status | Meaning |
| --- | --- |
| automatic-candidate | Known capability with no required user decision; still unqualified |
| needs-type | Garage/gate capability awaiting physical-type confirmation |
| confirmed-candidate | Compatible garage/gate confirmation; still unqualified |
| excluded | Explicitly disabled; settings retained, current reading only if available |
| unsupported | Unknown capability |
| unavailable | Saved identity without a current valid observation |
| invalid-override | Invalid, duplicate or capability-conflicting override |
| ambiguous-lighting | Possible collision or inadequate lighting identity evidence |

`configurationStatus` is default, valid or invalid. The discovery status remains
separate: absent, present (including empty), partial, malformed or unavailable.
No result authorises removal of previously recognised hardware. The helper is
stateless: a later lifecycle/UI consumer must retain previously recognised
inventory separately, rather than infer deletion when unsaved candidates are
absent from a result. Partial discovery keeps useful peers; saved exceptions
remain even when their records are quarantined.

Failed coordinator reads reject last-good observations. The existing freshness
signal is used, without an invented age timeout. Future consumers must use current
coordinator snapshots and invalidate readings on shutdown/disconnection, never
reuse an old successful projection indefinitely. Results are detached and frozen.

Only numeric reported `value: 0` and `value: 100` have endpoint interpretation.
The result contains `reportedValue`, `logicalValue` and
`physicalState: "unknown"`. Inversion changes logical 0/100, not the observation,
identity, configuration or controller. It establishes no physical position,
electrical output state, movement, obstruction, fan speed or blind travel.
Missing values are unavailable; malformed and non-endpoint values are invalid.
`dimPercent` is retained as reported evidence, not interpreted as physical
position or a qualified dimming control in this increment.

Legacy `AdvAir.sh` sent 0/100 through /setThing and used manual inversion. This
is evidence of command-state mapping only. Its fallback treating other values
as endpoints is not reproduced. No HomeKit characteristic values are emitted.

### Lighting overlap

`myLights.lights` and `myThings.things` are separate controller collections.
Home Assistant handles both; its implementation does not establish a universal
cross-collection physical identity mapping. The inspected historical fixtures
also do not establish such a mapping. Existing LightManager remains unchanged.

The projection flags a Thing whose ID equals a light collection key or declared
light ID as ambiguous, even if that light's state is malformed. This is a possible
collision, **not** proof of equivalence or permission to merge identities. An
unreadable lighting collection or any record rejected by the existing light
validator also blocks automatic light/relay candidates, even with a valid
collection key. Missing lighting data is uncertain when system.hasLights is
true (or present but invalid); true with an empty collection is contradictory.
An explicit false with no collection is not ambiguous. Omitted capability
metadata retains candidate-only behaviour, not proof of physical separation.
Names are never used for deduplication. Different IDs do not prove different
physical equipment either; all candidates remain unqualified. Future automatic
exposure must establish reliable collection semantics or cross-references first,
and keep unresolved overlaps unexposed. This increment cannot create duplicates
because it registers no accessories at all.

## Next review gate: hybrid discovery interface

Keep Advantage Air Device Settings as the standard HVAC form. A later MyPlace
Things interface belongs underneath it, with decisions and saved exceptions
rather than editable tabs for the entire inventory. Use an on-demand selector
for advanced overrides; obtain technical identities from discovery, not users.
Keep saved exceptions discoverable offline. Disabling/re-enabling must update
only the disabled flag and preserve other overrides. Do not silently save every
discovered device or remove entries on failed/partial reads.

That independently reviewed increment should define a bounded, sanitised,
read-only bridge from existing coordinator snapshots to the UI, with explicit
freshness and controller-replacement handling, and test save/reload preservation.
No custom UI or snapshot transport is implemented here. Qualification of relay
mode, light identity/dimming, blind behaviour and garage/gate safety is separate;
writes and operational accessories require further approval and hardware evidence.
This foundation has no new package version or physical hardware qualification.

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
