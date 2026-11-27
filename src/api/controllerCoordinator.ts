import { eligibleThing, planThing, denyThingCommands, ThingCommandError } from './thingCommand.js';
import type { ThingCommandPolicy, ThingEndpoint } from './thingCommand.js';
import { observeLights, lightBrightness, LightCommandError } from './lightCommand.js';
import { nativeTimer, planTimer, timerDuration, timerMatches } from './timerCommand.js';
import type { TimerField } from './timerCommand.js';
import { activeMyZoneNumber, planMyZoneSelection, MyZoneCommandError } from './myZoneCommand.js';
import type { MyZoneProgress, MyZoneStep } from './myZoneCommand.js';
import { planFanSpeed, fanSetting } from './fanCommand.js';
import type { FanSpeed } from './fanCommand.js';
import { modeFanIsOn, planModeFan, ModeFanCommandError } from './modeFanCommand.js';
import type { FanMode, ModeFanPlan } from './modeFanCommand.js';
import type { ControllerPollState } from './controllerPoller.js';
import type { SystemData } from './systemData.js';
import { discoverDevices } from '../discovery/discoverDevices.js';
import { planZoneSwitch, ZoneCommandError } from './zoneCommand.js';
import { planZonePercentage, requirePercentageZone, zonePercentage } from './zonePercentage.js';
import { planThermostatMode, planThermostatTemperature, ThermostatCommandError } from './thermostatCommand.js';
import { temperatureConfirmation } from './thermostatPatch.js';
import type { ThermostatPatch } from './thermostatPatch.js';
import type { ThermostatMode } from '../accessories/legacyState.js';
import { fanSpeedPercentage, thermostatCurrentTemperature, thermostatTargetMode, thermostatTargetTemperature, zoneIsOpen } from '../accessories/legacyState.js';
import { ControllerBusyError, validateSystemData } from './systemData.js';
import { AirconCommandRejectedError, TransientControllerReadError } from './advantageAirClient.js';

export interface ControllerClient {
  requestThing?(id: string, value: ThingEndpoint, signal?: AbortSignal): Promise<unknown>;
  requestLight?(id: string, field: 'state' | 'value', value: boolean | number, signal?: AbortSignal): Promise<unknown>;
  requestTimer?(aircon: string, field: TimerField, minutes: number, signal?: AbortSignal): Promise<unknown>;
  requestMyZoneSelection?(aircon: string, zoneNumber: number, signal?: AbortSignal): Promise<unknown>;
  requestMyZoneTarget?(aircon: string, temperature: number, signal?: AbortSignal): Promise<unknown>;
  requestZonePercentage?(aircon: string, zone: string, value: number, signal?: AbortSignal): Promise<unknown>;
  requestModeFanPatch?(aircon: string, patch: Extract<ModeFanPlan, { kind: 'command' }>['patch'], signal?: AbortSignal): Promise<unknown>;
  requestFanSpeed?(aircon: string, fan: FanSpeed, signal?: AbortSignal): Promise<unknown>;
  requestThermostatPatch?(aircon: string, patch: ThermostatPatch, signal?: AbortSignal): Promise<unknown>;
  getSystemData(signal?: AbortSignal): Promise<SystemData>;
  getFreshSystemData(signal?: AbortSignal): Promise<SystemData>;
  requestZoneState(aircon: string, zone: string, state: 'open' | 'close', signal?: AbortSignal): Promise<unknown>;
}

export type ControllerUpdateReason = 'read' | 'failure' | 'state';

export type ControllerCommandConfirmation = {
  name: string;
  outcome: 'confirmed' | 'unchanged';
  superseded: boolean;
} & Exclude<Request, { kind: 'thing' }>;

type Request = { kind: 'thing'; on: boolean; raw: ThingEndpoint } | { kind: 'lightOn'; on: boolean }
  | { kind: 'lightBrightness'; brightness: number }
  | { kind: 'timer'; active: boolean; seconds: number; replace: boolean }
  | { kind: 'zone'; on: boolean; percentageOnly?: boolean }
  | { kind: 'percentage'; percentage: number }
  | { kind: 'mode'; mode: ThermostatMode }
  | { kind: 'modeFan'; mode: FanMode; on: boolean }
  | { kind: 'temperature'; temperature: number }
  | { kind: 'fan'; percentage: number }
  | { kind: 'myZone'; zoneIdentity: string; zoneName: string };

type ExecutionPlan = { validate?: () => void } & ({ kind: 'unchanged' } | {
  kind: 'command';
  send: (signal: AbortSignal) => Promise<unknown>;
  matches: (data: SystemData) => boolean;
});

type Intent = Request & {
  identity: string;
  key: string;
  generation: number;
  name: string;
  admittedAt: number;
  expires: number;
  selectedAt?: number;
  finished: boolean;
  timer: ReturnType<typeof setTimeout>;
};

/** One owner for polling, desired state and physical command execution. */
export class ControllerCoordinator {
  private state: ControllerPollState = { lastAttemptFailed: false };
  private started = false;
  private stopped = false;
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly operations = new Set<AbortController>();
  private generation = 0;
  private readonly queued = new Map<string, Intent>();
  private readonly desired = new Map<string, Intent>();
  private readonly faults = new Set<string>();
  private readonly lightCapabilities = new Map<string, 'relay' | 'dimmer'>();

  constructor(
    private readonly client: ControllerClient,
    private readonly onUpdate: (state: ControllerPollState, reason: ControllerUpdateReason) => void,
    private readonly warn: (message: string) => void,
    private readonly onConfirmation?: (event: ControllerCommandConfirmation) => void,
    private readonly onSending?: (name: string, target: string) => void,
    private readonly onMyZoneProgress?: (event: MyZoneProgress) => void,
    private readonly thingPolicy: ThingCommandPolicy = denyThingCommands,
  ) {}

  start(): void {
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const operation of this.operations) {
      operation.abort();
    }
    for (const intent of this.desired.values()) {
      clearTimeout(intent.timer);
    }
    this.desired.clear();
    this.queued.clear();
  }

  readThing(identity: string, target = false): boolean {
    this.available();
    const thing = eligibleThing(this.state, identity, this.thingPolicy);
    const key = this.key(identity, 'thing');
    if (this.faults.has(key)) {
      throw new ThingCommandError('Thing command could not be confirmed.');
    }
    const pending = this.desired.get(key);
    if (target && pending?.kind === 'thing') {
      // Revalidate the accepted interpretation even while displaying a pending target.
      if (planThing(this.state, identity, pending.on, this.thingPolicy).raw !== pending.raw) {
        throw new ThingCommandError('Thing configuration changed.');
      }
      return pending.on;
    }
    return thing.value.status === 'valid' && thing.value.logicalValue === 100;
  }

  requestThing(identity: string, on: boolean): void {
    this.available();
    if (!this.client.requestThing) {
      throw new ThingCommandError('Thing transport unavailable.');
    }
    const plan = planThing(this.state, identity, on, this.thingPolicy);
    this.admit(identity, 'Thing ' + plan.id, { kind: 'thing', on, raw: plan.raw });
  }

  private light(data: SystemData, identity: string) {
    const light = observeLights(data).find(item => item.identity === identity);
    if (!light) {
      throw new LightCommandError('Light data is missing or invalid.');
    }
    const capability = this.lightCapabilities.get(identity);
    if (capability && light.capability !== 'unknown' && light.capability !== capability) {
      throw new LightCommandError('Light capability conflicts with its established capability.');
    }
    return light;
  }

  readLight(identity: string, field: 'state' | 'value'): boolean | number {
    this.available();
    // Validate this light on every read: healthy AC reads cannot freshen a missing entry.
    const light = this.light(this.state.data!, identity);
    if (field === 'value' && light.capability !== 'dimmer') {
      throw new LightCommandError('Fresh dimmer data is unavailable.');
    }
    const key = this.key(identity, field === 'state' ? 'lightOn' : 'lightBrightness');
    if (this.faults.has(key)) {
      throw new LightCommandError('The light command could not be confirmed.');
    }
    const pending = this.desired.get(key);
    return pending?.kind === 'lightOn' ? pending.on : pending?.kind === 'lightBrightness' ? pending.brightness
      : field === 'state' ? light.on : light.brightness!;
  }

  requestLight(identity: string, field: 'state' | 'value', value: boolean | number): void {
    this.available();
    const light = this.light(this.state.data!, identity);
    if (!this.client.requestLight) {
      throw new LightCommandError('Light transport unavailable.');
    }
    if (field === 'state' && typeof value === 'boolean') {
      this.admit(identity, light.name, { kind: 'lightOn', on: value });
    } else if (field === 'value' && light.capability === 'dimmer') {
      this.admit(identity, light.name, { kind: 'lightBrightness', brightness: lightBrightness(value) });
    } else {
      throw new LightCommandError('Invalid light request or capability.');
    }
  }

  readZone(identity: string): boolean {
    this.available();
    const key = this.key(identity, 'zone');
    const pending = this.desired.get(key);
    if (pending?.kind === 'zone') {
      return pending.on;
    }
    if (this.faults.has(key)) {
      throw new ZoneCommandError('The zone command could not be confirmed.');
    }
    const zone = this.locate(this.state.data!, identity);
    return zoneIsOpen(this.state.data!.aircons[zone.airconKey].zones[zone.zoneKey]);
  }

  /** Acknowledges local admission, not controller execution or confirmation. */
  requestZone(identity: string, on: boolean): void {
    this.available();
    const zone = this.locate(this.state.data!, identity);
    planZoneSwitch(this.state.data!.aircons[zone.airconKey], zone.zoneKey, on);
    this.admit(identity, `${zone.name} Zone`, { kind: 'zone', on });
  }

  readPercentageZoneState(identity: string): boolean {
    this.available();
    const zone = this.locate(this.state.data!, identity);
    requirePercentageZone(this.state.data!.aircons[zone.airconKey].zones[zone.zoneKey]);
    return this.readZone(identity);
  }

  requestPercentageZoneState(identity: string, on: boolean): void {
    this.available();
    const zone = this.locate(this.state.data!, identity);
    const aircon = this.state.data!.aircons[zone.airconKey];
    requirePercentageZone(aircon.zones[zone.zoneKey]);
    planZoneSwitch(aircon, zone.zoneKey, on);
    this.admit(identity, `${zone.name} Zone`, { kind: 'zone', on, percentageOnly: true });
  }

  readZonePercentage(identity: string): number {
    this.available();
    const zone = this.locate(this.state.data!, identity);
    const value = this.state.data!.aircons[zone.airconKey].zones[zone.zoneKey];
    requirePercentageZone(value);
    const key = this.key(identity, 'percentage');
    const pending = this.desired.get(key);
    if (pending?.kind === 'percentage') {
      return pending.percentage;
    }
    if (this.faults.has(key)) {
      throw new ZoneCommandError('The zone percentage command could not be confirmed.');
    }
    return zonePercentage(value);
  }

  requestZonePercentage(identity: string, percentage: number): void {
    this.available();
    const zone = this.locate(this.state.data!, identity);
    const plan = planZonePercentage(this.state.data!.aircons[zone.airconKey], zone.zoneKey, percentage);
    if (!this.client.requestZonePercentage) {
      throw new ZoneCommandError('Zone percentage transport is unavailable.');
    }
    this.admit(identity, `${zone.name} Zone`, { kind: 'percentage', percentage: plan.percentage });
  }

  /** Legacy projection of observed power/mode, not measured compressor activity. */
  readThermostatCurrentMode(identity: string): ThermostatMode {
    this.available();
    return thermostatTargetMode(this.aircon(this.state.data!, identity).data);
  }

  readThermostatCurrentTemperature(identity: string): number {
    this.available();
    return thermostatCurrentTemperature(this.aircon(this.state.data!, identity).data);
  }

  readFanSpeed(identity: string): number {
    this.available();
    const key = this.key(identity, 'fan');
    const pending = this.desired.get(key);
    if (pending?.kind === 'fan') {
      return pending.percentage;
    }
    if (this.faults.has(key)) {
      throw new ThermostatCommandError('The fan command could not be confirmed.');
    }
    return fanSpeedPercentage(this.aircon(this.state.data!, identity).data);
  }

  requestFanSpeed(identity: string, percentage: number): void {
    this.available();
    const aircon = this.aircon(this.state.data!, identity);
    const plan = planFanSpeed(aircon.data, percentage);
    if (!this.client.requestFanSpeed) {
      throw new ThermostatCommandError('Fan transport is unavailable.');
    }
    this.admit(identity, aircon.device.name, { kind: 'fan', percentage: plan.percentage });
  }

  readThermostatMode(identity: string): ThermostatMode {
    this.available();
    const key = this.key(identity, 'mode');
    const pending = this.desired.get(key);
    if (pending?.kind === 'mode') {
      return pending.mode;
    }
    if (pending?.kind === 'modeFan') {
      const plan = planModeFan(this.aircon(this.state.data!, identity).data, pending.mode, pending.on);
      if (pending.on || plan.kind === 'command') {
        return 'off';
      }
    }
    this.checkThermostatFault(key);
    return thermostatTargetMode(this.aircon(this.state.data!, identity).data);
  }

  readModeFan(identity: string, mode: FanMode): boolean {
    this.available();
    const aircon = this.aircon(this.state.data!, identity).data;
    // Validate the requested mode even when another mode has a pending intent.
    planModeFan(aircon, mode, true);
    const key = this.key(identity, 'mode');
    const pending = this.desired.get(key);
    if (pending?.kind === 'mode') {
      return false;
    }
    if (pending?.kind === 'modeFan') {
      if (pending.on) {
        return pending.mode === mode;
      }
      if (planModeFan(aircon, pending.mode, false).kind === 'command') {
        return false;
      }
    }
    if (this.faults.has(key)) {
      throw new ModeFanCommandError('The mode command could not be confirmed.');
    }
    return modeFanIsOn(aircon, mode);
  }

  requestModeFan(identity: string, mode: FanMode, on: boolean): void {
    this.available();
    const aircon = this.aircon(this.state.data!, identity);
    planModeFan(aircon.data, mode, on);
    if (!this.client.requestModeFanPatch) {
      throw new ModeFanCommandError('Ventilation and dry transport is unavailable.');
    }
    const pending = this.desired.get(this.key(identity, 'mode'));
    if (!on && pending && (pending.kind === 'mode' || pending.kind === 'modeFan' && pending.mode !== mode)) {
      // An inactive mode's Off must not replace a different pending selection.
      try {
        this.onConfirmation?.({ kind: 'modeFan', mode, on, name: aircon.device.name, outcome: 'unchanged', superseded: false });
      } catch {
        // A logging callback must not interrupt other accepted requests.
      }
      return;
    }
    this.admit(identity, aircon.device.name, { kind: 'modeFan', mode, on });
  }

  readThermostatTemperature(identity: string): number {
    this.available();
    const key = this.key(identity, 'temperature');
    const pending = this.desired.get(key);
    if (pending?.kind === 'temperature') {
      return pending.temperature;
    }
    this.checkThermostatFault(key);
    return thermostatTargetTemperature(this.aircon(this.state.data!, identity).data);
  }

  requestThermostatMode(identity: string, mode: ThermostatMode): void {
    this.available();
    const aircon = this.aircon(this.state.data!, identity);
    planThermostatMode(aircon.data, mode);
    this.requireThermostatTransport();
    this.admit(identity, aircon.device.name, { kind: 'mode', mode });
  }

  requestThermostatTemperature(identity: string, temperature: number): void {
    this.available();
    const aircon = this.aircon(this.state.data!, identity);
    planThermostatTemperature(aircon.data, temperature);
    this.requireThermostatTransport();
    this.admit(identity, aircon.device.name, { kind: 'temperature', temperature });
  }

  /** Pending selection is projected; after failure the actual observed selection remains readable. */
  readMyZoneSelection(identity: string): string {
    this.available();
    const aircon = this.aircon(this.state.data!, identity);
    const number = activeMyZoneNumber(aircon.data);
    const pending = this.desired.get(this.key(identity, 'myZone'));
    if (pending?.kind === 'myZone') {
      return pending.zoneIdentity;
    }
    const zone = discoverDevices(this.state.data!).find(device =>
      device.kind === 'zone' && device.airconKey === aircon.device.airconKey
      && aircon.data.zones[device.zoneKey].number === number,
    );
    if (!zone) {
      throw new MyZoneCommandError('The selected MyZone identity is unavailable.');
    }
    return zone.identity;
  }

  requestMyZoneSelection(identity: string, zoneIdentity: string): void {
    this.available();
    const aircon = this.aircon(this.state.data!, identity);
    const zone = this.locate(this.state.data!, zoneIdentity);
    if (zone.airconKey !== aircon.device.airconKey) {
      throw new MyZoneCommandError('The requested MyZone belongs to another air conditioner.');
    }
    planMyZoneSelection(aircon.data, zone.zoneKey);
    if (!this.client.requestMyZoneSelection || !this.client.requestMyZoneTarget) {
      throw new MyZoneCommandError('MyZone transport is unavailable.');
    }
    this.admit(identity, aircon.device.name, {
      kind: 'myZone', zoneIdentity, zoneName: zone.name,
    });
  }

  readTimer(identity: string): { active: boolean; inUse: boolean; remaining: number } {
    this.available();
    const observed = nativeTimer(this.aircon(this.state.data!, identity).data);
    const key = this.key(identity, 'timer');
    const pending = this.desired.get(key);
    if (!pending && this.faults.has(key)) {
      throw new ZoneCommandError('The timer command could not be confirmed.');
    }
    return {
      active: pending?.kind === 'timer' ? pending.active : observed.remaining > 0,
      inUse: observed.remaining > 0,
      remaining: observed.remaining,
    };
  }

  requestTimer(identity: string, active: boolean, seconds: number, replace = false): void {
    this.available();
    const aircon = this.aircon(this.state.data!, identity);
    const duration = timerDuration(seconds);
    planTimer(aircon.data, active, duration, replace);
    if (!this.client.requestTimer) {
      throw new ZoneCommandError('Timer transport is unavailable.');
    }
    this.admit(identity, aircon.device.name, { kind: 'timer', active, seconds: duration, replace });
  }

  private checkThermostatFault(key: string): void {
    if (this.faults.has(key)) {
      throw new ThermostatCommandError('The thermostat command could not be confirmed.');
    }
  }

  private requireThermostatTransport(): void {
    if (!this.client.requestThermostatPatch) {
      throw new ThermostatCommandError('Thermostat transport is unavailable.');
    }
  }

  private key(identity: string, kind: Request['kind']): string {
    return JSON.stringify([identity, kind === 'modeFan' ? 'mode' : kind]);
  }

  private admit(identity: string, name: string, request: Request): void {
    const key = this.key(identity, request.kind);
    const previous = this.desired.get(key);
    if (previous && ((request.kind === 'thing' && previous.kind === 'thing' && request.on === previous.on && request.raw === previous.raw)
      || (request.kind === 'lightOn' && previous.kind === 'lightOn' && request.on === previous.on)
      || (request.kind === 'lightBrightness' && previous.kind === 'lightBrightness' && request.brightness === previous.brightness)
      || (request.kind === 'zone' && previous.kind === 'zone' && request.on === previous.on
      && request.percentageOnly === previous.percentageOnly)
      || (request.kind === 'timer' && previous.kind === 'timer' && request.active === previous.active
        && request.seconds === previous.seconds && request.replace === previous.replace)
      || (request.kind === 'percentage' && previous.kind === 'percentage' && request.percentage === previous.percentage)
      || (request.kind === 'mode' && previous.kind === 'mode' && request.mode === previous.mode)
      || (request.kind === 'modeFan' && previous.kind === 'modeFan' && request.mode === previous.mode && request.on === previous.on)
      || (request.kind === 'fan' && previous.kind === 'fan' && request.percentage === previous.percentage)
      || (request.kind === 'myZone' && previous.kind === 'myZone' && request.zoneIdentity === previous.zoneIdentity)
      || (request.kind === 'temperature' && previous.kind === 'temperature' && request.temperature === previous.temperature))) {
      return;
    }
    if (!this.desired.has(key) && this.desired.size >= 64) {
      throw new ZoneCommandError('Too many pending controller requests. Try again after they finish.');
    }
    if (previous) {
      clearTimeout(previous.timer);
    }
    const admittedAt = performance.now();
    const intent: Intent = {
      ...request, identity, key, name, generation: ++this.generation,
      admittedAt, expires: admittedAt + 60000,
      finished: false,
      timer: setTimeout(() => this.expire(intent), 60000),
    };
    this.desired.set(key, intent);
    // Map replacement preserves queue position, giving other rooms a turn.
    this.queued.set(key, intent);
    this.faults.delete(key);
    this.emit();
    clearTimeout(this.timer);
    // Defer execution until the HAP setter has accepted the desired value.
    queueMicrotask(() => void this.run());
  }

  private available(): void {
    const at = this.state.lastSuccessAt;
    if (!this.started || this.stopped || !this.state.data || at === undefined
      || Date.now() < at || Date.now() - at >= 90000) {
      throw new ZoneCommandError('Fresh controller data is unavailable.');
    }
  }

  private locate(data: SystemData, identity: string) {
    const zone = discoverDevices(data).find(item => item.kind === 'zone' && item.identity === identity);
    if (!zone || zone.kind !== 'zone') {
      throw new ZoneCommandError('The requested zone identity is unavailable.');
    }
    // Sensor availability does not determine whether a zone can open or close.
    return zone;
  }

  private aircon(data: SystemData, identity: string) {
    const device = discoverDevices(data).find(item => item.kind === 'aircon' && item.identity === identity);
    if (!device || device.kind !== 'aircon') {
      throw new ThermostatCommandError('The requested air conditioner identity is unavailable.');
    }
    return { device, data: data.aircons[device.airconKey] };
  }

  private plan(data: SystemData, intent: Intent): ExecutionPlan {
    if (intent.kind === 'thing') {
      const fresh = (snapshot: SystemData): ControllerPollState => ({ data: snapshot, lastAttemptFailed: false, lastSuccessAt: Date.now() });
      const plan = planThing(fresh(data), intent.identity, intent.on, this.thingPolicy);
      const validate = () => {
        const current = planThing(fresh(data), intent.identity, intent.on, this.thingPolicy);
        if (current.raw !== intent.raw) {
          throw new ThingCommandError('Thing configuration changed the accepted endpoint.');
        }
      };
      validate();
      return plan.unchanged ? { kind: 'unchanged', validate } : {
        kind: 'command', validate,
        send: signal => this.client.requestThing!(plan.id, intent.raw, signal),
        matches: current => plan.matches(fresh(current)),
      };
    }
    if (intent.kind === 'lightOn' || intent.kind === 'lightBrightness') {
      const light = this.light(data, intent.identity);
      const field = intent.kind === 'lightOn' ? 'state' : 'value';
      const value = intent.kind === 'lightOn' ? intent.on : intent.brightness;
      if (field === 'value' && light.capability !== 'dimmer') {
        throw new LightCommandError('Dimmer capability unavailable before dispatch.');
      }
      if ((field === 'state' ? light.on : light.brightness) === value) {
        return { kind: 'unchanged' };
      }
      return { kind: 'command',
        send: signal => this.client.requestLight!(light.id, field, value, signal),
        matches: current => {
          const observed = observeLights(current).find(item => item.identity === intent.identity);
          return observed !== undefined && (field === 'state' ? observed.on : observed.brightness) === value
            && (observed.capability === 'unknown' || observed.capability === light.capability);
        } };
    }
    if (intent.kind === 'myZone') {
      throw new MyZoneCommandError('MyZone selection requires ordered execution.');
    }
    if (intent.kind === 'zone') {
      const zone = this.locate(data, intent.identity);
      if (intent.percentageOnly) {
        requirePercentageZone(data.aircons[zone.airconKey].zones[zone.zoneKey]);
      }
      const plan = planZoneSwitch(data.aircons[zone.airconKey], zone.zoneKey, intent.on);
      if (plan.kind === 'unchanged') {
        return plan;
      }
      return {
        kind: 'command',
        send: signal => this.client.requestZoneState(zone.airconKey, zone.zoneKey, plan.requestedState, signal),
        matches: current => {
          const address = this.locate(current, intent.identity);
          if (intent.percentageOnly) {
            requirePercentageZone(current.aircons[address.airconKey].zones[address.zoneKey]);
          }
          return zoneIsOpen(current.aircons[address.airconKey].zones[address.zoneKey]) === intent.on;
        },
      };
    }
    if (intent.kind === 'percentage') {
      const zone = this.locate(data, intent.identity);
      const plan = planZonePercentage(data.aircons[zone.airconKey], zone.zoneKey, intent.percentage);
      if (plan.unchanged) {
        return { kind: 'unchanged' };
      }
      return {
        kind: 'command',
        send: signal => this.client.requestZonePercentage!(zone.airconKey, zone.zoneKey, plan.percentage, signal),
        matches: current => {
          const address = this.locate(current, intent.identity);
          return zonePercentage(current.aircons[address.airconKey].zones[address.zoneKey]) === plan.percentage;
        },
      };
    }
    const aircon = this.aircon(data, intent.identity);
    if (intent.kind === 'timer') {
      const plan = planTimer(aircon.data, intent.active, intent.seconds, intent.replace);
      if (plan.kind === 'unchanged') {
        return plan;
      }
      return {
        kind: 'command',
        send: signal => this.client.requestTimer!(aircon.device.airconKey, plan.field, plan.minutes, signal),
        matches: current => timerMatches(this.aircon(current, intent.identity).data, plan.field, plan.minutes),
      };
    }
    if (intent.kind === 'modeFan') {
      const plan = planModeFan(aircon.data, intent.mode, intent.on);
      if (plan.kind === 'unchanged') {
        return plan;
      }
      return {
        kind: 'command',
        send: signal => this.client.requestModeFanPatch!(aircon.device.airconKey, plan.patch, signal),
        matches: current => {
          const info = this.aircon(current, intent.identity).data.info;
          return intent.on ? info.state === 'on' && info.mode === intent.mode : info.state === 'off';
        },
      };
    }
    if (intent.kind === 'fan') {
      const plan = planFanSpeed(aircon.data, intent.percentage);
      if (plan.unchanged) {
        return { kind: 'unchanged' };
      }
      return {
        kind: 'command',
        send: signal => this.client.requestFanSpeed!(aircon.device.airconKey, plan.fan, signal),
        matches: current => fanSpeedPercentage(this.aircon(current, intent.identity).data) === plan.percentage,
      };
    }
    if (intent.kind === 'mode') {
      const plan = planThermostatMode(aircon.data, intent.mode);
      if (plan.kind === 'unchanged') {
        return plan;
      }
      return {
        kind: 'command',
        send: signal => this.client.requestThermostatPatch!(aircon.device.airconKey, plan.patch, signal),
        matches: current => {
          const info = this.aircon(current, intent.identity).data.info;
          return intent.mode === 'off' ? info.state === 'off' : info.state === 'on' && info.mode === intent.mode;
        },
      };
    }
    const plan = planThermostatTemperature(aircon.data, intent.temperature);
    if (plan.kind === 'unchanged') {
      return plan;
    }
    const matches = temperatureConfirmation(aircon.data, plan.patch);
    return {
      kind: 'command',
      send: signal => this.client.requestThermostatPatch!(aircon.device.airconKey, plan.patch, signal),
      matches: current => matches(this.aircon(current, intent.identity).data),
    };
  }

  private emit(reason: ControllerUpdateReason = 'state'): void {
    if (!this.stopped) {
      try {
        this.onUpdate(structuredClone(this.state), reason);
      } catch {
        // An observer must not break scheduling or strand accepted requests.
      }
    }
  }

  private observe(data: SystemData): void {
    if (this.stopped) {
      return;
    }
    for (const light of observeLights(data)) {
      if (light.capability !== 'unknown' && !this.lightCapabilities.has(light.identity)) {
        this.lightCapabilities.set(light.identity, light.capability);
      }
    }
    this.state = {
      data: structuredClone(data), lastAttemptAt: Date.now(),
      lastSuccessAt: Date.now(), lastAttemptFailed: false,
    };
    this.faults.clear();
    this.emit('read');
  }

  private expire(intent: Intent): void {
    if (this.queued.get(intent.key) !== intent || this.desired.get(intent.key) !== intent || this.stopped) {
      return;
    }
    const remaining = intent.expires - performance.now();
    if (remaining > 0) {
      intent.timer = setTimeout(() => this.expire(intent), remaining);
      return;
    }
    this.queued.delete(intent.key);
    this.fail(intent, 'The accepted controller request expired before dispatch.');
  }

  private finish(intent: Intent): void {
    intent.finished = true;
    if (this.desired.get(intent.key) === intent) {
      clearTimeout(intent.timer);
      this.desired.delete(intent.key);
    }
    this.emit();
  }

  private confirm(intent: Intent, outcome: ControllerCommandConfirmation['outcome']): void {
    if (this.stopped || intent.finished) {
      return;
    }
    const superseded = this.desired.get(intent.key) !== intent;
    this.finish(intent);
    try {
      if (intent.kind === 'thing') {
        this.thingPolicy.onConfirmation?.({ identity: intent.identity, on: intent.on, outcome, superseded });
        return;
      }
      const request: Exclude<Request, { kind: 'thing' }> = intent.kind === 'lightOn' ? { kind: 'lightOn', on: intent.on }
        : intent.kind === 'lightBrightness' ? { kind: 'lightBrightness', brightness: intent.brightness }
          : intent.kind === 'timer'
            ? { kind: 'timer', active: intent.active, seconds: intent.seconds, replace: intent.replace }
            : intent.kind === 'zone' ? { kind: 'zone', on: intent.on }
              : intent.kind === 'percentage' ? { kind: 'percentage', percentage: intent.percentage }
                : intent.kind === 'modeFan' ? { kind: 'modeFan', mode: intent.mode, on: intent.on }
                  : intent.kind === 'mode' ? { kind: 'mode', mode: intent.mode }
                    : intent.kind === 'fan' ? { kind: 'fan', percentage: intent.percentage }
                      : intent.kind === 'myZone'
                        ? { kind: 'myZone', zoneIdentity: intent.zoneIdentity, zoneName: intent.zoneName }
                        : { kind: 'temperature', temperature: intent.temperature };
      this.onConfirmation?.({ ...request, name: intent.name, outcome, superseded });
    } catch {
      // Logging must not turn a confirmed command into a failure.
    }
  }

  private describe(intent: Intent): string {
    return intent.kind === 'thing' ? 'controller-reported endpoint ' + (intent.on ? 'On' : 'Off')
      : intent.kind === 'lightOn' ? (intent.on ? 'On' : 'Off')
        : intent.kind === 'lightBrightness' ? 'brightness ' + intent.brightness + '%'
          : intent.kind === 'timer' ? (intent.active ? 'timer ' + intent.seconds / 60 + ' minutes' : 'timer cancelled')
            : intent.kind === 'zone' ? (intent.on ? 'Open' : 'Closed')
              : intent.kind === 'percentage' ? 'zone percentage ' + intent.percentage + '%'
                : intent.kind === 'modeFan' ? (intent.mode === 'vent' ? 'Ventilation' : 'Dry Mode') + (intent.on ? ' On' : ' Off')
                  : intent.kind === 'fan' ? 'fan speed ' + (intent.percentage === 100 ? 'Auto Mode' : fanSetting(intent.percentage).fan)
                    : intent.kind === 'myZone' ? 'MyZone ' + intent.zoneName
                      : intent.kind === 'mode' ? 'mode ' + intent.mode : 'target temperature ' + intent.temperature + ' °C';
  }

  private fail(intent: Intent, reason: string): void {
    if (this.stopped || intent.finished) {
      return;
    }
    if (this.desired.get(intent.key) === intent) {
      this.faults.add(intent.key);
    }
    this.finish(intent);
    try {
      const control = intent.kind === 'thing' ? 'Thing' : intent.kind === 'lightOn' || intent.kind === 'lightBrightness' ? 'Light'
        : intent.kind === 'timer' ? 'Timer' : intent.kind === 'zone' || intent.kind === 'percentage' ? 'Zone'
          : intent.kind === 'myZone' ? 'MyZone'
            : intent.kind === 'fan' || intent.kind === 'modeFan' ? 'Fan' : 'Thermostat';
      this.warn(`${control} command failed for "${intent.name}" (${this.describe(intent)}): ${reason}`);
    } catch {
      // A logging callback must not interrupt cleanup or queued work.
    }
  }

  private async run(): Promise<void> {
    if (this.running || this.stopped || !this.started) {
      return;
    }
    this.running = true;
    try {
      if (this.queued.size === 0) {
        await this.poll();
      }
      while (!this.stopped && this.queued.size > 0) {
        const intent = this.queued.values().next().value!;
        if (this.desired.get(intent.key) !== intent || intent.finished) {
          this.queued.delete(intent.key);
          continue;
        }
        const selectedAt = performance.now();
        if (selectedAt >= intent.expires) {
          this.expire(intent);
          continue;
        }
        this.queued.delete(intent.key);
        if (this.desired.get(intent.key) === intent && !intent.finished) {
          intent.selectedAt = selectedAt;
          clearTimeout(intent.timer);
          await this.execute(intent);
        }
      }
    } finally {
      this.running = false;
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.run(), 30000);
      }
    }
  }

  private async poll(): Promise<void> {
    try {
      await this.bounded(performance.now() + 10000, async (signal, check) => {
        const data = await this.readWhenReady(() => this.client.getSystemData(signal), signal);
        check();
        if (data) {
          this.observe(data);
        }
      });
    } catch {
      if (!this.stopped) {
        this.state = { ...this.state, lastAttemptAt: Date.now(), lastAttemptFailed: true };
        this.emit('failure');
      }
    }
  }

  /** Ordered MyZone steps share a finite operation budget; confirmed progress is never rolled back. */
  private async executeMyZone(intent: Extract<Intent, { kind: 'myZone' }>): Promise<void> {
    let sent = false;
    let unresolved = false;
    let number: number | undefined;
    let step: MyZoneStep = 'open';
    const completed: MyZoneStep[] = [];
    const deadline = Math.min(intent.selectedAt! + 60000, intent.admittedAt + 120000);
    const progress = (outcome: MyZoneProgress['outcome'], reason?: string) => {
      if (this.stopped || intent.finished) {
        return;
      }
      try {
        this.onMyZoneProgress?.({ name: intent.name, zoneName: intent.zoneName, step, outcome, reason });
      } catch {
        // Progress observers cannot affect physical execution.
      }
    };
    try {
      await this.bounded(deadline, async (operationSignal, live) => {
        const snapshot = (data: SystemData) => {
          live();
          this.observe(data);
          live();
          const aircon = this.aircon(data, intent.identity);
          const zone = this.locate(data, intent.zoneIdentity);
          if (zone.airconKey !== aircon.device.airconKey) {
            throw new MyZoneCommandError('The requested zone no longer belongs to this air conditioner.');
          }
          const plan = planMyZoneSelection(aircon.data, zone.zoneKey);
          if (sent && number !== plan.zoneNumber) {
            throw new MyZoneCommandError('The requested zone number changed after dispatch.');
          }
          return { aircon, zone, plan };
        };
        for (step of ['open', 'select', 'target'] as const) {
          live();
          const preflightDeadline = Math.min(performance.now() + 10000, deadline);
          const before = await this.bounded(preflightDeadline, async (signal, check) => {
            const data = await this.readWhenReady(() => this.client.getFreshSystemData(signal), signal,
              () => sent || (!intent.finished && this.desired.get(intent.key) === intent));
            check();
            return data ? snapshot(data) : undefined;
          }, operationSignal, 'MyZone preflight');
          live();
          if (!before || (!sent && this.desired.get(intent.key) !== intent)) {
            this.finish(intent);
            return;
          }
          if (step !== 'open' && !before.plan.open) {
            throw new MyZoneCommandError('The requested zone is no longer open; it will not be reopened automatically.');
          }
          if (step === 'target' && !before.plan.selected) {
            throw new MyZoneCommandError('The reference zone changed before target synchronization.');
          }
          const needed = step === 'open' ? !before.plan.open
            : step === 'select' ? !before.plan.selected : !before.plan.targetMatches;
          if (!needed) {
            progress('unchanged');
            continue;
          }
          const target = before.plan.temperature;
          number = before.plan.zoneNumber;
          try {
            this.onSending?.(intent.name, this.describe(intent) + ': ' + step);
          } catch {
            // Logging must not prevent dispatch.
          }
          live();
          if (!sent && this.desired.get(intent.key) !== intent) {
            this.finish(intent);
            return;
          }
          const attemptedAt = performance.now();
          if (attemptedAt >= preflightDeadline || deadline - attemptedAt < 30000) {
            throw new MyZoneCommandError('Insufficient time remains to validate and reserve full confirmation for the next step.');
          }
          await this.bounded(attemptedAt + 30000, async (signal, check) => {
            check();
            // A replacement can arrive between phase creation and this callback.
            if (!sent && this.desired.get(intent.key) !== intent) {
              this.finish(intent);
              return;
            }
            if (performance.now() >= preflightDeadline || deadline - performance.now() < 30000) {
              throw new MyZoneCommandError('Insufficient time remains to validate and reserve full confirmation for the next step.');
            }
            sent = true;
            unresolved = true;
            try {
              if (step === 'open') {
                await this.client.requestZoneState(before.zone.airconKey, before.zone.zoneKey, 'open', signal);
              } else if (step === 'select') {
                await this.client.requestMyZoneSelection!(before.aircon.device.airconKey, number!, signal);
              } else {
                await this.client.requestMyZoneTarget!(before.aircon.device.airconKey, target, signal);
              }
            } catch (error) {
              if (error instanceof AirconCommandRejectedError) {
                unresolved = false;
                throw new MyZoneCommandError('Controller explicitly rejected this step.');
              }
              // Delivery is ambiguous. This step is never resent.
            }
            check();
            while (true) {
              await this.wait(signal);
              const data = await this.readConfirmation(signal);
              check();
              const after = snapshot(data);
              if (step === 'target' && after.plan.temperature !== target) {
                throw new MyZoneCommandError('The selected zone target changed during target synchronization.');
              }
              const matches = step === 'open' ? after.plan.open
                : step === 'select' ? after.plan.open && after.plan.selected
                  : after.plan.open && after.plan.selected && after.aircon.data.info.setTemp === target;
              check();
              if (matches) {
                unresolved = false;
                completed.push(step);
                progress('confirmed');
                return;
              }
            }
          }, operationSignal, 'MyZone confirmation');
          if (intent.finished) {
            return;
          }
        }
        live();
        this.confirm(intent, sent ? 'confirmed' : 'unchanged');
      }, undefined, 'MyZone operation');
    } catch (error) {
      if (this.stopped) {
        return;
      }
      if (!sent && this.desired.get(intent.key) !== intent) {
        this.finish(intent);
        return;
      }
      const reason = error instanceof ZoneCommandError || error instanceof ThermostatCommandError
        ? error.message : 'The controller operation could not be completed.';
      progress('failed', reason);
      const partial = completed.length > 0 ? ' Earlier confirmed steps: ' + completed.join(', ') + '.' : '';
      this.fail(intent, step + ' step failed: ' + reason + partial + ' Observed state retained; no rollback attempted.');
      if (unresolved) {
        this.cancelUnresolved();
      }
    }
  }

  private async execute(intent: Intent): Promise<void> {
    if (intent.kind === 'myZone') {
      await this.executeMyZone(intent);
      return;
    }
    let sent = false;
    let unresolved = false;
    const deadline = intent.admittedAt + 100000;
    try {
      await this.bounded(deadline, async (operationSignal, live) => {
        const preflightDeadline = intent.selectedAt! + 10000;
        const plan = await this.bounded(preflightDeadline, async (signal, check) => {
          const data = await this.readWhenReady(() => this.client.getFreshSystemData(signal), signal,
            () => !intent.finished && this.desired.get(intent.key) === intent);
          check();
          if (!data) {
            return;
          }
          this.observe(data);
          return this.plan(data, intent);
        }, operationSignal, 'Preflight');
        live();
        if (!plan || this.desired.get(intent.key) !== intent) {
          this.finish(intent);
          return;
        }
        plan.validate?.();
        live();
        if (plan.kind === 'unchanged') {
          this.confirm(intent, 'unchanged');
          return;
        }
        try {
          this.onSending?.(intent.name, this.describe(intent));
        } catch {
          // Logging must not interrupt physical commands.
        }
        live();
        if (this.desired.get(intent.key) !== intent) {
          this.finish(intent);
          return;
        }
        const attemptedAt = performance.now();
        if (attemptedAt >= preflightDeadline || deadline - attemptedAt < 30000) {
          throw new ZoneCommandError('Preflight expired before the physical write.');
        }
        await this.bounded(attemptedAt + 30000, async (signal, check) => {
          check();
          if (this.desired.get(intent.key) !== intent) {
            this.finish(intent);
            return;
          }
          if (performance.now() >= preflightDeadline || deadline - performance.now() < 30000) {
            throw new ZoneCommandError('Preflight expired before the physical write.');
          }
          plan.validate?.();
          check();
          sent = true;
          unresolved = true;
          try {
            await plan.send(signal);
          } catch (error) {
            if (error instanceof AirconCommandRejectedError) {
              unresolved = false;
              throw new ZoneCommandError('Controller rejected the command.');
            }
            // Delivery is ambiguous. Reconcile by reading; never resend.
          }
          check();
          while (true) {
            await this.wait(signal);
            const current = await this.readConfirmation(signal);
            check();
            if (intent.kind === 'thing') {
              validateSystemData(current);
              this.observe(current);
              check();
            }
            const matches = plan.matches(current);
            if (intent.kind !== 'thing') {
              this.observe(current);
            }
            check();
            if (matches) {
              unresolved = false;
              this.confirm(intent, 'confirmed');
              return;
            }
          }
        }, operationSignal, 'Confirmation');
      }, undefined, 'Controller operation');
    } catch (error) {
      if (this.stopped) {
        return;
      }
      if (!sent && this.desired.get(intent.key) !== intent) {
        this.finish(intent);
        return;
      }
      this.fail(intent, error instanceof ZoneCommandError || error instanceof ThermostatCommandError || error instanceof ModeFanCommandError
        ? error.message : 'The controller did not confirm the requested state.');
      if (unresolved) {
        this.cancelUnresolved();
      }
    }
  }

  private cancelUnresolved(): void {
    for (const queued of this.queued.values()) {
      this.fail(queued, 'Cancelled because a preceding controller command could not be confirmed.');
    }
    this.queued.clear();
  }

  /** Only typed transient read errors are retried; the enclosing phase deadline is never renewed. */
  private async readConfirmation(signal: AbortSignal): Promise<SystemData> {
    while (true) {
      signal.throwIfAborted();
      try {
        return await this.client.getFreshSystemData(signal);
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ControllerBusyError) {
          await this.wait(signal);
        } else if (error instanceof TransientControllerReadError) {
          await this.wait(signal, 2000);
        } else {
          throw new ZoneCommandError('Controller data could not be read while confirming the command.');
        }
      }
    }
  }
  /** Retry only known busy reads under the caller's existing budget; never retry a write. */
  private async readWhenReady(
    read: () => Promise<SystemData>,
    signal: AbortSignal,
    isCurrent: () => boolean = () => true,
  ): Promise<SystemData | undefined> {
    while (true) {
      signal.throwIfAborted();
      if (!isCurrent()) {
        return;
      }
      try {
        const data = await read();
        signal.throwIfAborted();
        return data;
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof ControllerBusyError)) {
          throw error;
        }
      }
      if (!isCurrent()) {
        return;
      }
      await this.wait(signal);
    }
  }

  private async bounded<T>(
    deadline: number,
    work: (signal: AbortSignal, check: () => void) => Promise<T>,
    parent?: AbortSignal,
    phase = 'Controller operation',
  ): Promise<T> {
    const controller = new AbortController();
    this.operations.add(controller);
    const timeout = () => new ZoneCommandError(`${phase} expired before completion.`);
    const check = () => {
      if (this.stopped || controller.signal.aborted || parent?.aborted || performance.now() >= deadline) {
        controller.abort();
        throw timeout();
      }
    };
    const parentAbort = () => controller.abort();
    parent?.addEventListener('abort', parentAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - performance.now()));
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(timeout());
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      // The microtask ensures cancellation is observed even if a synchronous observer stops us.
      return await Promise.race([Promise.resolve().then(async () => {
        check();
        const result = await work(controller.signal, check);
        check();
        return result;
      }), cancelled]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort);
      parent?.removeEventListener('abort', parentAbort);
      controller.abort();
      this.operations.delete(controller);
    }
  }

  private wait(signal: AbortSignal, ms = 1000): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let abort = () => {};
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, ms);
      abort = () => {
        clearTimeout(timer);
        reject(new ZoneCommandError('The controller operation expired before confirmation.'));
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}
