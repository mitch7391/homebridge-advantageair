import type { ControllerPollState } from '../api/controllerPoller.js';
import type { JsonObject } from '../api/systemData.js';

export type ThingCapability = 'blind-capable' | 'garage-gate-capable' | 'on-off-light-capable'
  | 'dimmable-light-capable' | 'relay-capable' | 'unknown';
type Scalar = string | number | boolean | null;
export interface ThingObservation {
  readonly controllerId: string;
  readonly id: string;
  readonly identity: string;
  readonly name?: string;
  readonly capability: ThingCapability;
  readonly physicalSubtype: 'undetermined';
  readonly valueStatus: 'reported' | 'missing' | 'invalid';
  // Reported scalars only; no interpretation as position, motion or confirmed state.
  readonly reported: Readonly<Partial<Record<'channelDipState' | 'buttonType' | 'dimPercent' | 'value', Scalar>>>;
}
export interface ThingsDiscovery {
  readonly status: 'unavailable' | 'absent' | 'malformed' | 'present' | 'partial';
  readonly things: readonly ThingObservation[];
  readonly invalidRecords: number;
  readonly duplicateRecords: number;
  readonly unknownRecords: number;
}
const object = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
const scalar = (v: unknown): v is Scalar => v === null || typeof v === 'boolean'
  || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 128);
const capability = (dip: unknown): ThingCapability => dip === 1 || dip === 2 ? 'blind-capable'
  : dip === 3 || dip === 10 ? 'garage-gate-capable' : dip === 4 ? 'on-off-light-capable'
    : dip === 5 ? 'dimmable-light-capable' : dip === 8 ? 'relay-capable' : 'unknown';
const result = (status: ThingsDiscovery['status'], things: ThingObservation[] = [], invalidRecords = 0,
  duplicateRecords = 0): ThingsDiscovery => Object.freeze({ status, things: Object.freeze(things), invalidRecords,
  duplicateRecords, unknownRecords: things.filter(thing => thing.capability === 'unknown').length });

/** Pure consumer of an existing snapshot. Never polls, writes, logs or registers accessories. */
export function discoverThings(data: unknown): ThingsDiscovery {
  if (!object(data)) {
    return result('unavailable');
  }
  const mid = object(data.system) ? data.system.mid : undefined;
  if (typeof mid !== 'string' || !mid.trim()) {
    return result('unavailable');
  }
  if (data.myThings === undefined) {
    return result('absent');
  }
  if (!object(data.myThings) || !object(data.myThings.things)) {
    return result('malformed');
  }
  const entries = Object.entries(data.myThings.things);
  const counts = new Map<string, number>();
  for (const [, raw] of entries) {
    if (object(raw) && id(raw.id)) {
      counts.set(raw.id, (counts.get(raw.id) ?? 0) + 1);
    }
  }
  const things: ThingObservation[] = [];
  let invalid = 0;
  let duplicates = 0;
  for (const [key, raw] of entries) {
    // Quarantine every occurrence of a duplicate ID, regardless of collection order.
    if (object(raw) && id(raw.id) && counts.get(raw.id)! > 1) {
      duplicates++;
      continue;
    }
    if (!object(raw) || !id(raw.id) || raw.id !== key) {
      invalid++;
      continue;
    }
    const reported: Partial<Record<'channelDipState' | 'buttonType' | 'dimPercent' | 'value', Scalar>> = {};
    for (const field of ['channelDipState', 'buttonType', 'dimPercent', 'value'] as const) {
      if (scalar(raw[field])) {
        reported[field] = raw[field];
      }
    }
    const name = typeof raw.name === 'string' && raw.name.trim() && raw.name.length <= 256 ? raw.name.trim() : undefined;
    things.push(Object.freeze({ controllerId: mid.trim(), id: raw.id,
      identity: JSON.stringify(['AdvantageAir', mid.trim(), 'thing', raw.id]),
      ...(name ? { name } : {}), capability: capability(raw.channelDipState), physicalSubtype: 'undetermined',
      valueStatus: raw.value === undefined ? 'missing' : scalar(raw.value) ? 'reported' : 'invalid',
      reported: Object.freeze(reported) }));
  }
  things.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return result(invalid || duplicates ? 'partial' : 'present', things, invalid, duplicates);
}

/** Last-good data after a failed read must not be mistaken for fresh discovery. */
export function observeThings(state: ControllerPollState): ThingsDiscovery {
  return state.lastAttemptFailed ? result('unavailable') : discoverThings(state.data);
}
