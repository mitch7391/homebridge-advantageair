import { updateAccessoryInformation } from './accessoryInformation.js';
import type { API, PlatformAccessory } from 'homebridge';

import type { ControllerPollState } from '../api/controllerPoller.js';
import type { ControllerCoordinator } from '../api/controllerCoordinator.js';
import { ZoneCommandError } from '../api/zoneCommand.js';
import { discoverDevices } from '../discovery/discoverDevices.js';
import { PLATFORM_NAME, PLUGIN_NAME } from '../settings.js';
import { ZoneSwitchAccessory } from './zoneSwitchAccessory.js';
import { DuplicateControllerError } from './zoneTemperatureManager.js';
import { cachedZoneControlType, type ZoneControlType } from './zoneLayout.js';

export class ZoneSwitchManager {
  private static readonly owners = new WeakMap<API, Map<string, ZoneSwitchManager>>();
  private readonly handlers = new Map<string, ZoneSwitchAccessory>();
  private state: ControllerPollState = { lastAttemptFailed: false };
  private stopped = false;

  constructor(
    private readonly api: API,
    private readonly accessories: Map<string, PlatformAccessory>,
    private readonly coordinator: Pick<ControllerCoordinator, 'readZone' | 'requestZone' | 'stop'>,
    private readonly warn: (message: string) => void,
    private readonly onCreated?: (name: string) => void,
    private readonly controlType: ZoneControlType = 'switch-light',
  ) {}

  static prepareCachedAccessory(api: API, accessory: PlatformAccessory): void {
    if (accessory.context.advantageAirZoneSwitch !== true) {
      return;
    }
    const unavailable = () => {
      throw new ZoneCommandError('Waiting for valid controller data.');
    };
    new ZoneSwitchAccessory(api, accessory, {
      getOn: unavailable,
      setOn: unavailable,
      warn: () => undefined,
    }, cachedZoneControlType(accessory)).update();
  }

  update(state: ControllerPollState): void {
    if (this.stopped) {
      return;
    }
    if (!state.data || state.lastAttemptFailed) {
      this.updateHandlers();
      return;
    }
    this.accept(state);
  }

  stop(): void {
    this.stopped = true;
    this.coordinator.stop();
    this.state = { lastAttemptFailed: true };
    this.updateHandlers();
  }

  private accept(state: ControllerPollState): void {
    try {
      const data = state.data;
      if (!data) {
        throw new ZoneCommandError('Controller data is unavailable.');
      }
      const devices = discoverDevices(data);
      if (devices.length > 0) {
        const id = (data.system.mid as string).trim();
        let owners = ZoneSwitchManager.owners.get(this.api);
        if (!owners) {
          owners = new Map();
          ZoneSwitchManager.owners.set(this.api, owners);
        }
        const owner = owners.get(id);
        if (owner && owner !== this) {
          throw new DuplicateControllerError();
        }
        owners.set(id, this);
      }
      this.state = structuredClone(state);
      for (const device of devices) {
        if (device.kind !== 'zone') {
          continue;
        }
        const zone = data.aircons[device.airconKey].zones[device.zoneKey];
        const uuid = this.api.hap.uuid.generate(JSON.stringify([device.identity, 'zone-switch']));
        const cached = this.accessories.get(uuid);
        if (this.handlers.has(device.identity)) {
          if (cached) {
            updateAccessoryInformation(this.api, cached, data.system.sysType, true);
          }
          continue;
        }
        const percentageId = this.api.hap.uuid.generate(JSON.stringify([device.identity, 'zone-percentage']));
        if (!cached && this.accessories.get(percentageId)?.context.advantageAirPercentageZone === true) {
          // Retain an existing layout rather than creating a second zone control.
          continue;
        }
        // Keep an existing switch usable when its temperature sensor disappears.
        // Only newly discovered sensor zones receive this legacy switch layout.
        if (cached?.context.advantageAirZoneSwitch !== true
          && (typeof zone.type !== 'number' || !Number.isInteger(zone.type) || zone.type <= 0)) {
          continue;
        }
        const accessory = cached ?? new this.api.platformAccessory(`${device.name} Zone`, uuid);
        const handler = new ZoneSwitchAccessory(this.api, accessory, {
          getOn: () => this.read(device.identity),
          setOn: on => this.coordinator.requestZone(device.identity, on),
          warn: this.warn,
        }, this.controlType);
        const metadataChanged = updateAccessoryInformation(this.api, accessory, data.system.sysType);
        const needsMarker = accessory.context.advantageAirZoneSwitch !== true;
        const layoutChanged = cachedZoneControlType(accessory) !== this.controlType;
        accessory.context.advantageAirZoneSwitch = true;
        accessory.context.advantageAirZoneControlType = this.controlType;
        if (cached && (needsMarker || metadataChanged || layoutChanged)) {
          this.api.updatePlatformAccessories([accessory]);
        }
        if (!cached) {
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.accessories.set(uuid, accessory);
        }
        this.handlers.set(device.identity, handler);
        if (!cached) {
          try {
            this.onCreated?.(accessory.displayName);
          } catch {
            // A logging failure must not interrupt accessory discovery.
          }
        }
      }
    } catch (error) {
      this.state = { lastAttemptFailed: true };
      throw error;
    } finally {
      this.updateHandlers();
    }
  }

  private read(identity: string): boolean {
    if (this.stopped || !this.state.data) {
      throw new ZoneCommandError('Fresh controller data is unavailable.');
    }
    return this.coordinator.readZone(identity);
  }

  private updateHandlers(): void {
    for (const handler of this.handlers.values()) {
      handler.update();
    }
  }
}
