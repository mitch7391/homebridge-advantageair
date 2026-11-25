// Independent of Draft and its Save queue. Fingerprints prove equality, not hardware identity.
export function canonical(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

// SHA-256 (FIPS 180-4): HTTP LAN settings pages may lack Web Crypto's secure context.
// This is a configuration equality digest, not an authentication credential.
export function sha256(input) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  bytes.set(input);
  bytes[input.length] = 128;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, Math.floor(input.length / 0x20000000));
  view.setUint32(bytes.length - 4, input.length * 8);
  const rotate = (x, n) => (x >>> n) | (x << (32 - n));
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 64; i++) {
      const x = words[i - 15], y = words[i - 2];
      words[i] = i < 16 ? view.getUint32(offset + i * 4)
        : words[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3))
          + words[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i]) | 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [a, b, c, d, e, f, g, h] = [(t1 + t2) | 0, a, b, c, (d + t1) | 0, e, f, g];
    }
    [a, b, c, d, e, f, g, h].forEach((word, i) => {
      hash[i] = (hash[i] + word) >>> 0;
    });
  }
  return hash.map(word => word.toString(16).padStart(8, '0')).join('');
}

export async function fingerprint(value) {
  const input = new globalThis.TextEncoder().encode(canonical(value));
  if (globalThis.crypto?.subtle) {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', input);
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return sha256(input);
}

const unavailable = reason => ({ status: 'unavailable', reason, things: [] });

export class DiscoverySession {
  constructor(config, keys, request, changed = () => {}, clock = {
    schedule: (callback, delay) => globalThis.setTimeout(callback, delay),
    cancel: timer => globalThis.clearTimeout(timer),
  }) {
    const blocks = config.filter(block => block.platform === 'AdvantageAir');
    this.initial = blocks.length === 1 ? JSON.parse(JSON.stringify(blocks[0])) : undefined;
    this.keys = [...keys];
    this.request = request;
    this.changed = changed;
    this.results = new Map();
    this.closed = false;
    this.started = null;
    this.reason = 'not-started';
    this.clock = clock;
    this.waits = new Set();
    this.conflicts = new Set();
    this.invalidated = false;
  }

  call(path, body, deadline) {
    return new Promise((resolve, reject) => {
      let timer;
      let stop;
      let finished = false;
      const finish = (error, value) => {
        if (finished) {
          return;
        }
        finished = true;
        this.clock.cancel(timer);
        this.waits.delete(stop);
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };
      stop = () => finish(new Error('Discovery unavailable'));
      this.waits.add(stop);
      timer = this.clock.schedule(stop, deadline);
      Promise.resolve().then(() => this.closed ? Promise.reject(new Error('Closed')) : this.request(path, body))
        .then(value => finish(null, value), stop);
    });
  }

  start() {
    // Install the promise before any asynchronous work or host call.
    this.started ??= Promise.resolve().then(() => this.initialize());
    return this.started;
  }

  async initialize() {
    if (this.closed || !this.initial) {
      return;
    }
    this.reason = 'loading';
    this.changed();
    try {
      const manifest = await this.call('/things/session', {}, 5000);
      if (this.closed) {
        return;
      }
      if (manifest.status !== 'ready' || manifest.configurationProof !== await fingerprint(this.initial)) {
        this.reason = manifest.reason || 'saved-configuration-unavailable';
        return;
      }
      const devices = this.initial.devices || [];
      const proofs = await Promise.all(devices.map(fingerprint));
      await Promise.all(devices.map(async (device, index) => {
        const entries = manifest.entries.filter(entry => entry.proof === proofs[index]);
        if (entries.length !== 1 || proofs.filter(proof => proof === proofs[index]).length !== 1 || this.closed) {
          return;
        }
        const key = this.keys[index];
        const entry = entries[0];
        this.results.set(key, { device, token: entry.token, result: { status: 'loading', things: [] } });
        this.changed();
        try {
          const result = await this.call('/things/read', { token: entry.token }, 325000);
          if (!this.closed) {
            if (result.token !== entry.token || !Array.isArray(result.things)) {
              throw new Error('Invalid response');
            }
            for (const token of result.conflicts || []) {
              this.conflicts.add(token);
            }
            this.invalidated ||= result.reason === 'saved-configuration-changed';
            this.results.set(key, { device, token: entry.token, result });
          }
        } catch {
          if (!this.closed) {
            this.results.set(key, { device, token: entry.token, result: unavailable('discovery-failed') });
          }
        }
        if (!this.closed) {
          this.changed();
        }
      }));
      this.reason = 'not-eligible';
    } catch {
      this.reason = 'discovery-unavailable';
    } finally {
      if (!this.closed) {
        this.changed();
      }
    }
  }

  view(key, device) {
    const entry = this.results.get(key);
    if (this.closed || !device || !this.keys.includes(key)) {
      return unavailable('no-saved-controller');
    }
    if (!entry) {
      return this.reason === 'loading' ? { status: 'loading', things: [] } : unavailable(this.reason);
    }
    if (this.invalidated || this.conflicts.has(entry.token)) {
      return unavailable(this.invalidated ? 'saved-configuration-changed' : 'duplicate-controller-identity');
    }
    // Rename/logging edits do not change hardware association. Connection edits invalidate display; override presentation is derived separately.
    if (device.ipAddress !== entry.device.ipAddress
      || (device.port === undefined ? 2025 : device.port) !== (entry.device.port === undefined ? 2025 : entry.device.port)) {
      return unavailable('unsaved-controller-changes');
    }
    return entry.result;
  }

  close() {
    this.closed = true;
    for (const stop of [...this.waits]) {
      stop();
    }
    this.results.clear();
  }
}


// UI-only projection: never changes discovery, configuration or operational qualification.
export const thingKey = thing => JSON.stringify([thing.controllerId, thing.id]);
const identifiable = thing => thing && typeof thing.controllerId === 'string' && /^\S(?:.*\S)?$/.test(thing.controllerId)
  && typeof thing.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(thing.id);

export class ThingSelection {
  constructor() {
    this.selected = new Map();
  }
  choose(controller, key) {
    this.selected.set(controller, key);
  }
  current(controller, things) {
    const previous = this.selected.get(controller);
    const key = things.some(thing => thing.key === previous) ? previous : things[0]?.key;
    if (key !== undefined) {
      this.selected.set(controller, key);
    }
    return key;
  }
}

export function thingCards(result, overrides) {
  const saved = Array.isArray(overrides) ? overrides : [];
  const records = new Map();
  for (const thing of [...(result.things || []), ...saved]) {
    if (identifiable(thing)) {
      records.set(thingKey(thing), thing);
    }
  }
  return [...records.keys()].sort().map(key => {
    const observations = (result.things || []).filter(t => identifiable(t) && thingKey(t) === key);
    const matches = saved.filter(t => identifiable(t) && thingKey(t) === key);
    const observation = observations.length === 1 ? observations[0] : undefined;
    const identity = records.get(key);
    const override = matches[0];
    const malformed = (overrides !== undefined && !Array.isArray(overrides)) || saved.some(t => !identifiable(t));
    const invalid = malformed || matches.length > 1 || observations.length > 1 || (override && (
      Object.keys(override).some(k => !['controllerId', 'id', 'type', 'disabled', 'invert'].includes(k))
      || ['disabled', 'invert'].some(k => k in override && typeof override[k] !== 'boolean')
      || ('type' in override && !['garage-door', 'gate'].includes(override.type))));
    const capability = observation?.capability || 'unknown';
    const blocked = invalid || ['invalid-override', 'ambiguous-lighting'].includes(observation?.status);
    const present = ['present', 'partial'].includes(result.status) && observation && capability !== 'unknown';
    const automaticTab = ['garage-gate-capable', 'blind-capable', 'relay-capable'].includes(capability)
      && !blocked && Boolean(present) && observation.status !== 'unsupported';
    if (!matches.length && !automaticTab) {
      return undefined;
    }
    return {
      key, controllerId: identity.controllerId, id: identity.id,
      name: observation?.name?.trim() || 'Thing ' + identity.id,
      capability, override, editable: !blocked && (Boolean(present) || matches.length === 1),
      discoveryStatus: observation ? result.status : 'unavailable',
      configurationStatus: invalid ? 'invalid overrides — preserved without editing'
        : override?.disabled ? 'excluded'
          : override?.type && capability !== 'unknown' && capability !== 'garage-gate-capable' ? 'incompatible type'
            : capability === 'garage-gate-capable' ? (override?.type || 'garage/gate decision required')
              : override ? 'draft overrides retained' : 'default — no override',
      // Saved backend safety verdict remains explicit; draft edits cannot qualify hardware.
      safetyStatus: observation?.status || 'unavailable',
      qualification: 'unqualified', operational: false,
    };
  }).filter(Boolean);
}
