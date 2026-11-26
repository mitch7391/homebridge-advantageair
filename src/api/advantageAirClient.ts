import { thingPayload } from './thingCommand.js';
import type { ThingEndpoint } from './thingCommand.js';
import { lightPayload } from './lightCommand.js';
import { validateTimerWrite } from './timerCommand.js';
import type { TimerField } from './timerCommand.js';
import { myZoneTarget } from './myZoneCommand.js';
import type { FanSpeed } from './fanCommand.js';
import type { ModeFanPlan } from './modeFanCommand.js';
import { validateThermostatPatch } from './thermostatPatch.js';
import type { ThermostatPatch } from './thermostatPatch.js';
import { validateSystemData } from './systemData.js';
import type { SystemData } from './systemData.js';

export interface RequestDiagnostic {
  id: number;
  endpoint: '/getSystemData' | '/setAircon' | '/setLight' | '/setThing';
  event: 'send' | 'headers' | 'body' | 'error';
  elapsedMs: number;
  status?: number;
  json?: 'empty-object' | 'object' | 'array' | 'null' | 'boolean' | 'number' | 'string';
  rejected?: boolean;
  reason?: 'cancelled' | 'timeout' | 'connect' | 'http' | 'body' | 'json';
}

export interface AdvantageAirClientOptions {
  ipAddress: string;
  port?: number;
  timeoutMs?: number;
  onDiagnostic?: (event: RequestDiagnostic) => void;
}

export class AdvantageAirRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdvantageAirRequestError';
  }
}

export class AirconCommandRejectedError extends AdvantageAirRequestError {}

export class ZoneCommandRejectedError extends AirconCommandRejectedError {}

/** Only read transport failures with a known transient cause may be reconciled again. */
export class TransientControllerReadError extends AdvantageAirRequestError {}

function transientTransport(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = 'code' in error ? error.code : undefined;
  const cause = 'cause' in error ? error.cause : undefined;
  const causeCode = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  return [code, causeCode].some(value => typeof value === 'string' && [
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  ].includes(value));
}

export class AdvantageAirClient {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private inFlight?: Promise<SystemData>;
  private requestId = 0;
  private readonly onDiagnostic?: (event: RequestDiagnostic) => void;
  private requests: Promise<void> = Promise.resolve();

  constructor(options: AdvantageAirClientOptions) {
    const port = options.port ?? 2025;
    const timeoutMs = options.timeoutMs ?? 10000;
    const host = options.ipAddress.trim();
    const octets = host.split('.');

    if (
      octets.length !== 4
      || octets.some(octet =>
        !/^(0|[1-9]\d{0,2})$/.test(octet) || Number(octet) > 255,
      )
    ) {
      throw new Error('Controller address must be a valid IPv4 address.');
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Controller port must be an integer from 1 to 65535.');
    }

    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
      throw new Error('Request timeout must be from 1 to 120000 milliseconds.');
    }

    this.endpoint = new URL(`http://${host}:${port}/getSystemData`);
    this.timeoutMs = timeoutMs;
    this.onDiagnostic = options.onDiagnostic;
  }

  async requestThing(id: string, value: ThingEndpoint, signal?: AbortSignal): Promise<unknown> {
    const payload = thingPayload(id, value);
    const endpoint = new URL('/setThing', this.endpoint);
    endpoint.searchParams.set('json', payload);
    this.inFlight = undefined;
    const response = await this.requestJson(endpoint, signal);
    if (response === false) {
      throw new AirconCommandRejectedError('Controller rejected the Thing command.');
    }
    return response;
  }

  async requestLight(id: string, field: 'state' | 'value', value: boolean | number, signal?: AbortSignal): Promise<unknown> {
    const endpoint = new URL('/setLight', this.endpoint);
    endpoint.searchParams.set('json', lightPayload(id, field, value));
    this.inFlight = undefined;
    const response = await this.requestJson(endpoint, signal);
    if (response === false) {
      throw new AirconCommandRejectedError('Controller rejected the light command.');
    }
    return response;
  }

  getSystemData(signal?: AbortSignal): Promise<SystemData> {
    if (signal) {
      return this.requestSystemData(signal);
    }
    if (!this.inFlight) {
      const request = this.requestSystemData().finally(() => {
        if (this.inFlight === request) {
          this.inFlight = undefined;
        }
      });
      this.inFlight = request;
    }

    return this.inFlight;
  }

  private async requestSystemData(signal?: AbortSignal): Promise<SystemData> {
    return validateSystemData(await this.requestJson(this.endpoint, signal));
  }

  getFreshSystemData(signal?: AbortSignal): Promise<SystemData> {
    this.inFlight = undefined;
    return this.getSystemData(signal);
  }

  /** Sends once. The returned response is not confirmation of the zone state. */
  async requestZoneState(
    airconKey: string,
    zoneKey: string,
    state: 'open' | 'close',
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (
      typeof airconKey !== 'string' || !/^ac\d+$/.test(airconKey)
      || typeof zoneKey !== 'string' || !/^z\d+$/.test(zoneKey)
      || (state !== 'open' && state !== 'close')
    ) {
      throw new AdvantageAirRequestError('Invalid zone command.');
    }

    const endpoint = new URL('/setAircon', this.endpoint);
    endpoint.searchParams.set('json', JSON.stringify({
      [airconKey]: { zones: { [zoneKey]: { state } } },
    }));

    // Reads requested after this write must not share an earlier read.
    this.inFlight = undefined;
    const response = await this.requestJson(endpoint, signal);
    if (response === false) {
      throw new ZoneCommandRejectedError('Controller rejected the zone command.');
    }
    return response;
  }

  /** One absolute thermostat write; readback is coordinated separately. */
  async requestThermostatPatch(airconKey: string, patch: ThermostatPatch, signal?: AbortSignal): Promise<unknown> {
    if (typeof airconKey !== 'string' || !/^ac\d+$/.test(airconKey)) {
      throw new AdvantageAirRequestError('Invalid air conditioner address.');
    }
    validateThermostatPatch(patch);
    const endpoint = new URL('/setAircon', this.endpoint);
    endpoint.searchParams.set('json', JSON.stringify({ [airconKey]: patch }));
    this.inFlight = undefined;
    const response = await this.requestJson(endpoint, signal);
    if (response === false) {
      throw new AirconCommandRejectedError('Controller rejected the thermostat command.');
    }
    return response;
  }

  async requestFanSpeed(airconKey: string, fan: FanSpeed, signal?: AbortSignal): Promise<unknown> {
    if (typeof airconKey !== 'string' || !/^ac\d+$/.test(airconKey)
      || !['low', 'medium', 'high', 'autoAA'].includes(fan)) {
      throw new AdvantageAirRequestError('Invalid fan speed command.');
    }
    const endpoint = new URL('/setAircon', this.endpoint);
    endpoint.searchParams.set('json', JSON.stringify({ [airconKey]: { info: { fan } } }));
    this.inFlight = undefined;
    const response = await this.requestJson(endpoint, signal);
    if (response === false) {
      throw new AirconCommandRejectedError('Controller rejected the fan command.');
    }
    return response;
  }

  /** Send one planned mode change; the coordinator owns safety checks and confirmation. */
  async requestModeFanPatch(
    airconKey: string,
    patch: Extract<ModeFanPlan, { kind: 'command' }>['patch'],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const info = patch?.info;
    if (typeof airconKey !== 'string' || !/^ac\d+$/.test(airconKey)
      || !patch || typeof patch !== 'object' || Array.isArray(patch)
      || Object.keys(patch).length !== 1 || !Object.hasOwn(patch, 'info')
      || !info || typeof info !== 'object' || Array.isArray(info)
      || !Object.hasOwn(info, 'state')
      || !(info.state === 'off' && Object.keys(info).length === 1
        || info.state === 'on' && Object.keys(info).length === 2 && Object.hasOwn(info, 'mode')
        && (info.mode === 'vent' || info.mode === 'dry'))) {
      throw new AdvantageAirRequestError('Invalid ventilation or dry command.');
    }
    const endpoint = new URL('/setAircon', this.endpoint);
    endpoint.searchParams.set('json', JSON.stringify({ [airconKey]: patch }));
    this.inFlight = undefined;
    const response = await this.requestJson(endpoint, signal);
    if (response === false) {
      throw new AirconCommandRejectedError('Controller rejected the ventilation or dry command.');
    }
    return response;
  }

  /** One value-only write; On/Off and confirmation belong to the coordinator. */
  async requestZonePercentage(airconKey: string, zoneKey: string, value: number, signal?: AbortSignal): Promise<unknown> {
    if (typeof airconKey !== 'string' || !/^ac\d+$/.test(airconKey)
      || typeof zoneKey !== 'string' || !/^z\d+$/.test(zoneKey)
      || typeof value !== 'number' || !Number.isInteger(value) || value < 5 || value > 100 || value % 5 !== 0) {
      throw new AdvantageAirRequestError('Invalid zone percentage command.');
    }
    const endpoint = new URL('/setAircon', this.endpoint);
    endpoint.searchParams.set('json', JSON.stringify({ [airconKey]: { zones: { [zoneKey]: { value } } } }));
    this.inFlight = undefined;
    const response = await this.requestJson(endpoint, signal);
    if (response === false) {
      throw new AirconCommandRejectedError('Controller rejected the zone percentage command.');
    }
    return response;
  }

  /** Select an existing installer-enabled MyZone; orchestration owns eligibility checks. */
  async requestMyZoneSelection(airconKey: string, zoneNumber: number, signal?: AbortSignal): Promise<unknown> {
    if (typeof zoneNumber !== 'number' || !Number.isSafeInteger(zoneNumber) || zoneNumber <= 0) {
      throw new AdvantageAirRequestError('Invalid MyZone number.');
    }
    return this.requestMyZoneInfo(airconKey, { myZone: zoneNumber }, signal);
  }

  /** Copy only the main target, preserving fractional values and all zone targets. */
  async requestMyZoneTarget(airconKey: string, temperature: number, signal?: AbortSignal): Promise<unknown> {
    return this.requestMyZoneInfo(airconKey, { setTemp: myZoneTarget(temperature) }, signal);
  }

  private async requestMyZoneInfo(
    airconKey: string,
    info: { myZone: number } | { setTemp: number },
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (typeof airconKey !== 'string' || !/^ac\d+$/.test(airconKey)) {
      throw new AdvantageAirRequestError('Invalid air conditioner address.');
    }
    const endpoint = new URL('/setAircon', this.endpoint);
    endpoint.searchParams.set('json', JSON.stringify({ [airconKey]: { info } }));
    this.inFlight = undefined;
    const response = await this.requestJson(endpoint, signal);
    if (response === false) {
      throw new AirconCommandRejectedError('Controller rejected the MyZone command.');
    }
    return response;
  }

  /** One countdown-only write; never changes AC power or schedules a local power command. */
  async requestTimer(airconKey: string, field: TimerField, minutes: number, signal?: AbortSignal): Promise<unknown> {
    if (typeof airconKey !== 'string' || !/^ac\d+$/.test(airconKey)) {
      throw new AdvantageAirRequestError('Invalid air conditioner address.');
    }
    validateTimerWrite(field, minutes);
    const endpoint = new URL('/setAircon', this.endpoint);
    endpoint.searchParams.set('json', JSON.stringify({ [airconKey]: { info: { [field]: minutes } } }));
    this.inFlight = undefined;
    const response = await this.requestJson(endpoint, signal);
    if (response === false) {
      throw new AirconCommandRejectedError('Controller rejected the timer command.');
    }
    return response;
  }

  private requestJson(endpoint: URL, signal?: AbortSignal): Promise<unknown> {
    const request = this.requests.then(() => {
      if (signal?.aborted) {
        throw new AdvantageAirRequestError('Controller request cancelled.');
      }
      return this.performRequest(endpoint, signal);
    });
    // A failed request must not prevent subsequent requests from running.
    this.requests = request.then(() => undefined, () => undefined);
    return request;
  }

  private async performRequest(endpoint: URL, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestSignal = signal
      ? AbortSignal.any([controller.signal, signal])
      : controller.signal;

    const id = ++this.requestId;
    const started = performance.now();
    let reason: RequestDiagnostic['reason'] = 'connect';
    const diagnostic = (event: RequestDiagnostic['event'], details: Partial<RequestDiagnostic> = {}) => {
      try {
        this.onDiagnostic?.({
          id, endpoint: endpoint.pathname === '/setThing' ? '/setThing'
            : endpoint.pathname === '/setLight' ? '/setLight' : endpoint.pathname === '/setAircon' ? '/setAircon' : '/getSystemData',
          event, elapsedMs: Math.round(performance.now() - started), ...details,
        });
      } catch {
        // Diagnostic observers cannot change request outcomes or queue progress.
      }
    };
    diagnostic('send');

    try {
      let response: Response;

      try {
        response = await fetch(endpoint, {
          signal: requestSignal,
          redirect: 'error',
          headers: {
            Accept: 'application/json',
          },
        });
      } catch (error) {
        if (signal?.aborted) {
          throw new AdvantageAirRequestError('Controller request cancelled.');
        }
        const RequestError = endpoint.pathname === '/getSystemData' && (controller.signal.aborted || transientTransport(error))
          ? TransientControllerReadError : AdvantageAirRequestError;
        throw new RequestError(
          controller.signal.aborted
            ? 'Controller request timed out.'
            : 'Could not connect to the controller.',
        );
      }

      diagnostic('headers', { status: response.status });
      if (!response.ok) {
        reason = 'http';
        await response.body?.cancel();
        const RequestError = endpoint.pathname === '/getSystemData' && [408, 502, 503, 504].includes(response.status)
          ? TransientControllerReadError : AdvantageAirRequestError;
        throw new RequestError(
          `Controller returned HTTP ${response.status}.`,
        );
      }

      reason = 'body';
      let body: string;

      try {
        body = await response.text();
      } catch (error) {
        if (signal?.aborted) {
          throw new AdvantageAirRequestError('Controller request cancelled.');
        }
        const RequestError = endpoint.pathname === '/getSystemData' && (controller.signal.aborted || transientTransport(error))
          ? TransientControllerReadError : AdvantageAirRequestError;
        throw new RequestError(
          controller.signal.aborted
            ? 'Controller request timed out.'
            : 'Could not read the controller response.',
        );
      }

      reason = 'json';
      let data: unknown;

      try {
        data = JSON.parse(body);
      } catch {
        throw new AdvantageAirRequestError(
          'Controller response was not valid JSON.',
        );
      }

      const json: RequestDiagnostic['json'] = data === null ? 'null'
        : Array.isArray(data) ? 'array'
          : typeof data === 'object' ? (Object.keys(data).length === 0 ? 'empty-object' : 'object')
            : typeof data as 'boolean' | 'number' | 'string';
      diagnostic('body', {
        json,
        ...(endpoint.pathname !== '/getSystemData' && data === false ? { rejected: true } : {}),
      });
      return data;
    } catch (error) {
      diagnostic('error', {
        reason: signal?.aborted ? 'cancelled' : controller.signal.aborted ? 'timeout' : reason,
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
