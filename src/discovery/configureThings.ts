import { observeLights } from '../api/lightCommand.js';
import type { ControllerPollState } from '../api/controllerPoller.js';
import { observeThings, type ThingObservation, type ThingsDiscovery } from './discoverThings.js';

/** Sparse exceptions; identities are supplied by discovery, never by a manual form. */
export interface ThingOverride {
  readonly controllerId: string;
  readonly id: string;
  readonly disabled?: boolean;
  readonly invert?: boolean;
  readonly type?: 'garage-door' | 'gate';
}
export type ThingValue =
  | Readonly<{ status: 'valid'; reportedValue: 0 | 100; logicalValue: 0 | 100; physicalState: 'unknown' }>
  | Readonly<{ status: 'invalid' | 'unavailable'; physicalState: 'unknown' }>;
export interface ConfiguredThing {
  readonly controllerId: string;
  readonly id: string;
  readonly identity: string;
  readonly override?: ThingOverride;
  readonly observation?: ThingObservation;
  readonly status: 'automatic-candidate' | 'needs-type' | 'confirmed-candidate' | 'excluded'
    | 'unsupported' | 'unavailable' | 'invalid-override' | 'ambiguous-lighting';
  // Capability and a user decision are not operational qualification. No override can change these.
  readonly qualification: 'unqualified';
  readonly operational: false;
  readonly value: ThingValue;
}
export interface ConfiguredThings {
  readonly discovery: ThingsDiscovery;
  readonly configurationStatus: 'default' | 'valid' | 'invalid';
  readonly invalidOverrides: number;
  readonly things: readonly ConfiguredThing[];
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const identity = (controllerId: string, id: string) => JSON.stringify(['AdvantageAir', controllerId, 'thing', id]);
interface OverrideEntry { controllerId: string; id: string; override?: ThingOverride }

// An attributable error blocks that identity only. An unidentifiable entry could be an
// intended exclusion of any Thing, so all Things in this controller fail closed.
function parseOverrides(input: unknown) {
  const entries = new Map<string, OverrideEntry>();
  let invalidOverrides = 0;
  let unscopedInvalid = false;
  if (input === undefined) {
    return { entries, invalidOverrides, unscopedInvalid };
  }
  if (!Array.isArray(input)) {
    return { entries, invalidOverrides: 1, unscopedInvalid: true };
  }
  for (const entry of input) {
    if (!object(entry) || typeof entry.controllerId !== 'string' || !/^\S(?:.*\S)?$/.test(entry.controllerId)
      || !validId(entry.id)) {
      invalidOverrides++;
      unscopedInvalid = true;
      continue;
    }
    const key = identity(entry.controllerId, entry.id);
    const previous = entries.get(key);
    const valid = !previous && !Object.keys(entry).some(k => !['controllerId', 'id', 'type', 'invert', 'disabled'].includes(k))
      && (entry.type === undefined || entry.type === 'garage-door' || entry.type === 'gate')
      && (entry.invert === undefined || typeof entry.invert === 'boolean')
      && (entry.disabled === undefined || typeof entry.disabled === 'boolean');
    if (!valid) {
      invalidOverrides += previous?.override ? 2 : 1;
    }
    entries.set(key, { controllerId: entry.controllerId, id: entry.id,
      ...(valid ? { override: Object.freeze({ controllerId: entry.controllerId, id: entry.id,
        ...(entry.type === 'garage-door' || entry.type === 'gate' ? { type: entry.type } : {}),
        ...(typeof entry.invert === 'boolean' ? { invert: entry.invert } : {}),
        ...(typeof entry.disabled === 'boolean' ? { disabled: entry.disabled } : {}) }) } : {}) });
  }
  return { entries, invalidOverrides, unscopedInvalid };
}

const unknownValue = (status: 'invalid' | 'unavailable'): ThingValue => Object.freeze({ status, physicalState: 'unknown' });

// These are controller command-state endpoints, NOT physical open/closed/on/off.
function interpretValue(observation: ThingObservation, invert: boolean): ThingValue {
  if (observation.valueStatus === 'missing') {
    return unknownValue('unavailable');
  }
  const value = observation.reported.value;
  if (observation.valueStatus !== 'reported' || (value !== 0 && value !== 100)) {
    return unknownValue('invalid');
  }
  return Object.freeze({ status: 'valid', reportedValue: value,
    logicalValue: invert ? (value === 0 ? 100 : 0) : value, physicalState: 'unknown' });
}

// Do not use observeLights' accepted-only list: malformed light state can still
// belong to a retained light accessory. A collision is ambiguity, not proven equivalence.
function lightingEvidence(state: ControllerPollState) {
  const ids = new Set<string>();
  const lights = state.data?.myLights;
  // hasLights is reported in system metadata; absence is not proof of no lights.
  const hasLights = state.data?.system?.hasLights;
  let uncertain = lights === undefined && hasLights !== undefined && hasLights !== false;
  if (lights !== undefined) {
    if (!object(lights) || !object(lights.lights)) {
      uncertain = true;
    } else {
      // Reuse the existing record validator without logging IDs. Even a valid key
      // cannot establish complete identity evidence for a rejected record.
      uncertain = !object(state.data?.system) || observeLights(state.data!).length !== Object.keys(lights.lights).length
        || (hasLights === true && Object.keys(lights.lights).length === 0);
      for (const [key, raw] of Object.entries(lights.lights)) {
        if (validId(key)) {
          ids.add(key);
        }
        if (object(raw) && validId(raw.id)) {
          ids.add(raw.id);
        } else {
          uncertain = true;
        }
      }
    }
  }
  return { ids, uncertain };
}

/** Pure projection of current discovery plus sparse exceptions. No result authorises
 * commands, accessory registration or removal. Retains configured identities offline;
 * absent overrides do not mean absent hardware. No new polling or state storage.
 */
export function configureThings(state: ControllerPollState, input: unknown): ConfiguredThings {
  const discovery = observeThings(state);
  const parsed = parseOverrides(input);
  const lights = lightingEvidence(state);
  const records = new Map<string, { observation?: ThingObservation; entry?: OverrideEntry }>();
  for (const observation of discovery.things) {
    records.set(observation.identity, { observation });
  }
  for (const [key, entry] of parsed.entries) {
    records.set(key, { ...records.get(key), entry });
  }
  const things = [...records.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, { observation, entry }]) => {
    const override = entry?.override;
    const capability = observation?.capability;
    let status: ConfiguredThing['status'];
    if (parsed.unscopedInvalid || (entry && !override)) {
      status = 'invalid-override';
    } else if (override?.type && capability && capability !== 'garage-gate-capable') {
      status = 'invalid-override';
    } else if (override?.disabled === true) {
      status = 'excluded';
    } else if (!observation) {
      status = 'unavailable';
    } else if (capability === 'unknown') {
      status = 'unsupported';
    } else if (lights.ids.has(observation.id) || (lights.uncertain
      && ['on-off-light-capable', 'dimmable-light-capable', 'relay-capable'].includes(capability!))) {
      status = 'ambiguous-lighting';
    } else if (capability === 'garage-gate-capable') {
      status = override?.type ? 'confirmed-candidate' : 'needs-type';
    } else {
      status = 'automatic-candidate';
    }
    return Object.freeze({ identity: key, controllerId: observation?.controllerId ?? entry!.controllerId,
      id: observation?.id ?? entry!.id, ...(override ? { override } : {}), ...(observation ? { observation } : {}), status,
      qualification: 'unqualified' as const, operational: false as const,
      value: observation && ['automatic-candidate', 'needs-type', 'confirmed-candidate', 'excluded'].includes(status)
        ? interpretValue(observation, override?.invert ?? false) : unknownValue('unavailable') });
  });
  return Object.freeze({ discovery,
    configurationStatus: parsed.invalidOverrides || things.some(t => t.status === 'invalid-override') ? 'invalid'
      : input === undefined ? 'default' : 'valid', invalidOverrides: parsed.invalidOverrides, things: Object.freeze(things) });
}
