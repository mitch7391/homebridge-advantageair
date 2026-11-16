// Increment 2B-0 prototype. JSON configuration is cloned, never reconstructed.
const copy = value => JSON.parse(JSON.stringify(value));
const fields = ['homeName', 'ipAddress', 'port', 'zoneControlType', 'linkZoneTemperatures', 'debug'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validate(block) {
  if (!object(block) || !Array.isArray(block.devices) || !block.devices.length) {
    return 'Add at least one controller before saving.';
  }
  if (typeof block.name !== 'string') {
    return 'The platform log name must be present and contain text.';
  }
  for (const [index, device] of block.devices.entries()) {
    const prefix = `Controller ${index + 1}: `;
    if (!object(device)) {
      return prefix + 'invalid controller configuration.';
    }
    const ip = device.ipAddress;
    if (typeof ip !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(ip)
      || ip.split('.').some(part => Number(part) > 255)) {
      return prefix + 'enter a valid IPv4 address.';
    }
    if ('port' in device && (!Number.isInteger(device.port) || device.port < 1 || device.port > 65535)) {
      return prefix + 'port must be an integer from 1 to 65535.';
    }
    if ('homeName' in device && typeof device.homeName !== 'string') {
      return prefix + 'name must be text.';
    }
    if ('zoneControlType' in device && !['switch-light', 'lights', 'fans'].includes(device.zoneControlType)) {
      return prefix + 'select a supported zone control type.';
    }
    for (const key of ['debug', 'linkZoneTemperatures']) {
      if (key in device && typeof device[key] !== 'boolean') {
        return prefix + key + ' must be a boolean.';
      }
    }
  }
  return 'debug' in block && typeof block.debug !== 'boolean' ? 'Global debug must be a boolean.' : '';
}

export class Draft {
  constructor(config, api, onStatus = () => {}) {
    this.config = copy(config);
    this.api = api;
    this.onStatus = onStatus;
    const matches = this.config.flatMap((block, index) => block.platform === 'AdvantageAir' ? [index] : []);
    if (matches.length > 1) {
      throw new Error('Multiple Advantage Air platform blocks require separate review.');
    }
    this.blockIndex = matches[0] ?? -1;
    const devices = this.config[this.blockIndex]?.devices;
    if (devices !== undefined && !Array.isArray(devices)) {
      throw new Error('Malformed controller collection.');
    }
    this.keys = (devices || []).map((_, index) => index);
    this.nextKey = this.keys.length;
    this.selected = 0;
    this.expanded = false;
    this.revision = 0;
    this.sent = 0;
    this.pending = null;
    this.failed = false;
    this.status();
  }

  snapshot() {
    return copy(this.config);
  }

  block() {
    return this.snapshot()[this.blockIndex] || { devices: [] };
  }

  addController() {
    if (this.blockIndex === -1) {
      this.blockIndex = this.config.length;
      this.config.push({ platform: 'AdvantageAir', name: 'Homebridge Advantage Air', devices: [] });
    }
    const block = this.config[this.blockIndex];
    block.devices ??= [];
    block.devices.push({ homeName: 'Aircon', ipAddress: '', port: 2025 });
    this.keys.push(this.nextKey++);
    this.selected = block.devices.length - 1;
    return this.changed();
  }

  removeController(key) {
    const index = this.keys.indexOf(key);
    if (index < 0) {
      throw new Error('Controller no longer exists.');
    }
    const selectedKey = this.keys[this.selected];
    this.config[this.blockIndex].devices.splice(index, 1);
    this.keys.splice(index, 1);
    this.selected = Math.max(0, this.keys.includes(selectedKey) ? this.keys.indexOf(selectedKey) : Math.min(index, this.keys.length - 1));
    return this.changed();
  }

  select(index) {
    if (!Number.isInteger(index) || !this.block().devices?.[index]) {
      throw new Error('Unknown controller.');
    }
    this.selected = index;
  }

  toggleThings(open) {
    this.expanded = Boolean(open);
  }

  status() {
    const error = validate(this.config[this.blockIndex]);
    const ready = !error && !this.failed && this.sent === this.revision;
    this.api[ready ? 'enableSaveButton' : 'disableSaveButton']();
    this.onStatus(this.failed ? 'Draft update failed. Cancel and reopen; do not save.' : error || (ready ? '' : 'Updating draft…'));
    return !error;
  }

  edit(key, value, platform = false) {
    if (!(platform ? key === 'debug' : fields.includes(key))) {
      throw new Error('Field is outside the prototype scope.');
    }
    const block = this.config[this.blockIndex];
    const target = platform ? block : block.devices[this.selected];
    if (Object.hasOwn(target, key) && target[key] === value) {
      return this.pending || Promise.resolve();
    }
    target[key] = value;
    return this.changed();
  }

  changed() {
    this.revision++;
    return this.schedule();
  }

  schedule() {
    this.status(); // Disable host Save before any asynchronous draft update.
    if (!this.pending && !this.failed) {
      this.pending = this.flush().finally(() => {
        this.pending = null;
        this.status();
        // An edit can land between flush settling and this cleanup microtask.
        if (!this.failed && this.sent !== this.revision && validate(this.config[this.blockIndex]) === '') {
          this.schedule();
        }
      });
    }
    return this.pending;
  }

  async flush() {
    try {
      while (this.sent !== this.revision && validate(this.config[this.blockIndex]) === '') {
        const revision = this.revision;
        await this.api.updatePluginConfig(this.snapshot());
        // Ignore returned snapshots: they may predate newer local edits.
        this.sent = revision;
      }
    } catch {
      this.failed = true; // No automatic retries or saving an older host draft.
    }
  }
}
