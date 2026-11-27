import { request as httpRequest } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { validateSystemData } from '../dist/api/systemData.js';
import { configureThings } from '../dist/discovery/configureThings.js';
import { canonical } from './public/discovery.mjs';

export const LIMITS = Object.freeze({ controllers: 32, records: 2048, bytes: 4 * 1024 * 1024, deadlineMs: 10000 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const proof = value => createHash('sha256').update(canonical(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
export class DiscoveryError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function savedEndpoint(device) {
  const ip = device?.ipAddress;
  const port = device?.port === undefined ? 2025 : device.port;
  if (typeof ip !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(ip)
    || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DiscoveryError('invalid-endpoint');
  }
  const octets = ip.split('.').map(Number);
  if (octets.some(part => part > 255) || octets[0] === 0 || octets[0] === 127 || octets[0] >= 224
    || (octets[0] === 169 && octets[1] === 254)) {
    throw new DiscoveryError('unsafe-endpoint');
  }
  return { host: ip, port };
}

/** The only network operation in this module. No redirects, DNS, writes or retries. */
export function readController(device, signal, { request = httpRequest, schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout } = {}) {
  const endpoint = savedEndpoint(device);
  return new Promise((resolve, reject) => {
    let finished = false;
    let req;
    let response;
    let timer;
    let abort;
    const chunks = [];
    let size = 0;
    const finish = (error, value) => {
      if (finished) {
        return;
      }
      finished = true;
      cancel(timer);
      signal?.removeEventListener('abort', abort);
      if (error) {
        response?.destroy();
        req?.destroy();
        chunks.length = 0;
        reject(error);
      } else {
        resolve(value);
      }
    };
    abort = () => finish(new DiscoveryError('cancelled'));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    timer = schedule(() => finish(new DiscoveryError('timeout')), LIMITS.deadlineMs);
    try {
      req = request({ ...endpoint, method: 'GET', path: '/getSystemData', agent: false,
        headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
        lookup: () => {
          throw new DiscoveryError('dns-forbidden');
        } }, res => {
        response = res;
        if (finished) {
          res.destroy();
          return;
        }
        if (res.statusCode !== 200) {
          finish(new DiscoveryError('http-error'));
          return;
        }
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
          finish(new DiscoveryError('unsupported-encoding'));
          return;
        }
        res.on('error', () => finish(new DiscoveryError('read-failed')));
        res.on('aborted', () => finish(new DiscoveryError('read-failed')));
        res.on('data', chunk => {
          if (finished) {
            return;
          }
          size += chunk.length;
          if (size > LIMITS.bytes) {
            finish(new DiscoveryError('response-too-large'));
          } else {
            chunks.push(chunk);
          }
        });
        res.on('end', () => {
          if (finished) {
            return;
          }
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            chunks.length = 0;
            finish(null, value);
          } catch {
            finish(new DiscoveryError('invalid-json'));
          }
        });
      });
      req.on('error', () => finish(new DiscoveryError('connection-failed')));
      req.end();
    } catch {
      finish(new DiscoveryError('connection-failed'));
    }
  });
}

function savedBlock(config) {
  if (!object(config) || !Array.isArray(config.platforms)) {
    throw new DiscoveryError('invalid-saved-configuration');
  }
  const blocks = config.platforms.filter(block => object(block) && block.platform === 'AdvantageAir');
  if (blocks.length !== 1 || !Array.isArray(blocks[0].devices)) {
    throw new DiscoveryError('invalid-saved-configuration');
  }
  if (blocks[0].devices.length > LIMITS.controllers) {
    throw new DiscoveryError('too-many-controllers');
  }
  return clone(blocks[0]);
}

function boundedInventory(data, overrides) {
  for (const collection of [data?.myThings?.things, data?.myLights?.lights, overrides]) {
    if (collection && typeof collection === 'object' && Object.keys(collection).length > LIMITS.records) {
      throw new DiscoveryError('inventory-too-large');
    }
  }
  const mid = data?.system?.mid;
  if (typeof mid === 'string' && mid.length > 256) {
    throw new DiscoveryError('invalid-controller-identity');
  }
  if (Array.isArray(overrides) && overrides.some(entry => typeof entry?.controllerId === 'string' && entry.controllerId.length > 256)) {
    throw new DiscoveryError('invalid-controller-identity');
  }
}

function dto(token, state, overrides, reason) {
  boundedInventory(state.data, overrides);
  const configured = configureThings(state, overrides);
  return { token, observedAt: state.lastSuccessAt ?? null, status: configured.discovery.status,
    ...(reason ? { reason } : {}), configurationStatus: configured.configurationStatus,
    counts: { invalid: configured.discovery.invalidRecords, duplicate: configured.discovery.duplicateRecords,
      unknown: configured.discovery.unknownRecords, invalidOverrides: configured.invalidOverrides },
    things: configured.things.map(thing => ({ controllerId: thing.controllerId, id: thing.id,
      name: thing.observation?.name ?? 'Configured Thing', capability: thing.observation?.capability ?? 'unknown',
      status: thing.status, qualification: thing.qualification, operational: thing.operational, physicalState: 'unknown' })) };
}

export class DiscoveryService {
  constructor(readSaved, { read = readController, token = randomUUID, now = Date.now } = {}) {
    this.readSaved = readSaved;
    this.read = read;
    this.token = token;
    this.now = now;
    this.entries = new Map();
    this.pending = new Map();
    this.queue = Promise.resolve();
    this.abort = new globalThis.AbortController();
    this.initialized = null;
    this.mids = new Map();
    this.completed = new Map();
  }

  session() {
    this.initialized ??= Promise.resolve().then(async () => {
      try {
        if (this.abort.signal.aborted) {
          throw new DiscoveryError('cancelled');
        }
        const saved = await this.readSaved();
        if (this.abort.signal.aborted) {
          throw new DiscoveryError('cancelled');
        }
        const block = savedBlock(saved);
        this.configurationProof = proof(block);
        const endpoints = block.devices.map(device => {
          try {
            return canonical(savedEndpoint(device));
          } catch {
            return null;
          }
        });
        const entries = [];
        block.devices.forEach((device, index) => {
          if (!endpoints[index] || endpoints.filter(value => value === endpoints[index]).length !== 1) {
            return;
          }
          const token = this.token();
          this.entries.set(token, device);
          entries.push({ token, proof: proof(device) });
        });
        return { status: 'ready', configurationProof: this.configurationProof, entries,
          responseDeadlineMs: LIMITS.controllers * LIMITS.deadlineMs + 5000 };
      } catch (error) {
        return { status: 'unavailable', reason: error instanceof DiscoveryError ? error.code : 'saved-configuration-unavailable', entries: [] };
      }
    });
    return this.initialized;
  }

  discover(token) {
    if (this.abort.signal.aborted) {
      return Promise.resolve({ token, status: 'unavailable', reason: 'cancelled', things: [] });
    }
    if (!this.entries.has(token)) {
      return Promise.resolve({ token: null, status: 'unavailable', reason: 'unauthorized', things: [] });
    }
    if (!this.pending.has(token)) {
      const task = this.queue.then(() => this.execute(token)).then(result => {
        this.completed.set(token, result);
        return result;
      });
      this.pending.set(token, task);
      this.queue = task.then(() => undefined, () => undefined);
    }
    return this.pending.get(token);
  }

  async execute(token) {
    const device = this.entries.get(token);
    const checkSaved = async () => {
      if (this.abort.signal.aborted) {
        throw new DiscoveryError('cancelled');
      }
      if (proof(savedBlock(await this.readSaved())) !== this.configurationProof) {
        throw new DiscoveryError('saved-configuration-changed');
      }
    };
    try {
      await checkSaved();
      boundedInventory(undefined, device.things);
      const data = validateSystemData(await this.read(device, this.abort.signal));
      await checkSaved();
      boundedInventory(data, device.things);
      const mid = typeof data.system.mid === 'string' ? data.system.mid.trim() : '';
      if (mid) {
        const previous = this.mids.get(mid) || [];
        this.mids.set(mid, [...previous, token]);
        if (previous.length) {
          const conflicts = [...previous, token];
          for (const other of previous) {
            const earlier = this.completed.get(other);
            Object.assign(earlier, dto(other, { lastAttemptFailed: true }, this.entries.get(other).things,
              'duplicate-controller-identity'), { conflicts });
          }
          return { ...dto(token, { lastAttemptFailed: true }, device.things, 'duplicate-controller-identity'), conflicts };
        }
      }
      return dto(token, { data, lastAttemptFailed: false, lastSuccessAt: this.now() }, device.things);
    } catch (error) {
      const reason = error instanceof DiscoveryError ? error.code : 'read-unavailable';
      try {
        return dto(token, { lastAttemptFailed: true }, device.things, reason);
      } catch {
        return { token, status: 'unavailable', reason, things: [], configurationStatus: 'invalid' };
      }
    }
  }

  close() {
    this.abort.abort();
  }
}
