import type { ControllerPollState } from '../api/controllerPoller.js';
import { observeThings, type ThingCapability, type ThingObservation, type ThingsDiscovery } from './discoverThings.js';

export type ThingType = 'garage-door' | 'gate' | 'blind' | 'relay-switch' | 'relay-fan';
export interface ThingConfiguration {
  readonly controllerId: string;
  readonly id: string;
  readonly type: ThingType;
  readonly invert: boolean;
}
export type ThingValue =
  | Readonly<{ status: 'valid'; reportedValue: 0 | 100; logicalValue: 0 | 100; physicalState: 'unknown' }>
  | Readonly<{ status: 'invalid' | 'unavailable'; physicalState: 'unknown' }>;
export interface ConfiguredThing {
  readonly configuration: ThingConfiguration;
  readonly observation?: ThingObservation;
  readonly status: 'compatible' | 'unsupported' | 'unavailable';
  readonly value: ThingValue;
}
export interface ConfiguredThings {
  readonly discovery: ThingsDiscovery;
  readonly configurationStatus: 'disabled' | 'valid' | 'invalid';
  readonly things: readonly ConfiguredThing[];
}

const requiredCapability: Readonly<Record<ThingType, ThingCapability>> = Object.freeze({
  'garage-door': 'garage-gate-capable', gate: 'garage-gate-capable', blind: 'blind-capable',
  'relay-switch': 'relay-capable', 'relay-fan': 'relay-capable',
});
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Fail the controller's entire Things configuration closed on ambiguous settings.
// This never rejects or changes the controller's independent HVAC/light settings.
function parseConfiguration(input: unknown): readonly ThingConfiguration[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const ids = new Set<string>();
  const configurations: ThingConfiguration[] = [];
  let controllerId: string | undefined;
  for (const entry of input) {
    if (!object(entry) || Object.keys(entry).some(key => !['controllerId', 'id', 'type', 'invert'].includes(key))
      || typeof entry.controllerId !== 'string' || !entry.controllerId.trim()
      || entry.controllerId !== entry.controllerId.trim()
      || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id)
      || typeof entry.type !== 'string' || !Object.hasOwn(requiredCapability, entry.type)
      || (entry.invert !== undefined && typeof entry.invert !== 'boolean')
      || ids.has(entry.id) || (controllerId !== undefined && controllerId !== entry.controllerId)) {
      return undefined;
    }
    controllerId = entry.controllerId;
    ids.add(entry.id);
    configurations.push(Object.freeze({ controllerId, id: entry.id, type: entry.type as ThingType, invert: entry.invert ?? false }));
  }
  return Object.freeze(configurations);
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

/** Read-only foundation: consume the existing coordinator snapshot and devices[].things.
 * No config means no selected devices. No result authorises a write or accessory removal.
 * Failed reads reject last-good observations through the Increment 1 freshness adapter.
 */
export function configureThings(state: ControllerPollState, input: unknown): ConfiguredThings {
  const discovery = observeThings(state);
  const configuration = input === undefined ? [] : parseConfiguration(input);
  const configurationStatus = input === undefined ? 'disabled' : configuration ? 'valid' : 'invalid';
  const observations = new Map(discovery.things.map(thing => [thing.identity, thing]));
  const things = (configuration ?? []).map((entry): ConfiguredThing => {
    const identity = JSON.stringify(['AdvantageAir', entry.controllerId, 'thing', entry.id]);
    const observation = observations.get(identity);
    const status = !observation ? 'unavailable'
      : observation.capability === requiredCapability[entry.type] ? 'compatible' : 'unsupported';
    return Object.freeze({ configuration: entry, ...(observation ? { observation } : {}), status,
      value: status === 'compatible' ? interpretValue(observation!, entry.invert) : unknownValue('unavailable') });
  });
  return Object.freeze({ discovery, configurationStatus, things: Object.freeze(things) });
}
