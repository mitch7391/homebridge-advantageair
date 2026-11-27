import { configureThings } from '../discovery/configureThings.js';
import type { ConfiguredThing } from '../discovery/configureThings.js';
import type { ControllerPollState } from './controllerPoller.js';
import { validateSystemData } from './systemData.js';
import { ZoneCommandError } from './zoneCommand.js';

export class ThingCommandError extends ZoneCommandError {}
export type ThingEndpoint = 0 | 100;
/** Internal code injection only. No user configuration can supply qualification. */
export interface ThingCommandPolicy {
  overrides: () => unknown;
  garageDoors?: boolean;
  qualifies: (identity: string) => boolean;
  onConfirmation?: (event: { identity: string; on: boolean; outcome: 'confirmed' | 'unchanged'; superseded: boolean }) => void;
}
export const denyThingCommands: ThingCommandPolicy = Object.freeze({ overrides: () => undefined, qualifies: () => false });

export const garageDoorPolicy = (overrides: () => unknown): ThingCommandPolicy => ({
  overrides, garageDoors: true, qualifies: () => false,
});

export function thingPayload(id: string, value: ThingEndpoint): string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || (value !== 0 && value !== 100)) {
    throw new ThingCommandError('Invalid Thing endpoint command.');
  }
  return JSON.stringify({ id, value });
}

export function eligibleThing(state: ControllerPollState, identity: string,
  policy: ThingCommandPolicy = denyThingCommands, now = Date.now()): ConfiguredThing {
  if (!state.data || state.lastAttemptFailed || !Number.isFinite(state.lastSuccessAt)
    || state.lastSuccessAt! > now || now - state.lastSuccessAt! >= 90000) {
    throw new ThingCommandError('Fresh Thing data is unavailable.');
  }
  validateSystemData(state.data);
  const projection = configureThings(state, policy.overrides());
  const thing = projection.things.find(t => t.identity === identity);
  const supported = policy.garageDoors === true ? thing?.operational === true
    : thing?.status === 'automatic-candidate' && thing.observation?.capability === 'relay-capable'
      && policy.qualifies(identity) === true;
  if (projection.discovery.status !== 'present' || !thing || thing.value.status !== 'valid' || !supported) {
    throw new ThingCommandError('Thing is not eligible for this command.');
  }
  return thing;
}

export function planThing(state: ControllerPollState, identity: string, on: boolean,
  policy: ThingCommandPolicy = denyThingCommands, now = Date.now()) {
  if (typeof on !== 'boolean') {
    throw new ThingCommandError('Thing target must be boolean.');
  }
  const thing = eligibleThing(state, identity, policy, now);
  const inverted = thing.override?.invert === true;
  const raw: ThingEndpoint = on !== inverted ? 100 : 0;
  return { id: thing.id, raw, unchanged: thing.observation!.reported.value === raw,
    matches(current: ControllerPollState): boolean {
      const observed = eligibleThing(current, identity, policy);
      if ((observed.override?.invert === true) !== inverted) {
        throw new ThingCommandError('Thing inversion changed during the command.');
      }
      return observed.observation!.reported.value === raw;
    } };
}
