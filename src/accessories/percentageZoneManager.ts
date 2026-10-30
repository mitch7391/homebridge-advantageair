import { updateAccessoryInformation } from './accessoryInformation.js';
import type { API, PlatformAccessory } from 'homebridge';
import type { ControllerPollState } from '../api/controllerPoller.js';
import type { ControllerCoordinator } from '../api/controllerCoordinator.js';
import { ZoneCommandError } from '../api/zoneCommand.js';
import { discoverDevices } from '../discovery/discoverDevices.js';
import { PLATFORM_NAME, PLUGIN_NAME } from '../settings.js';
import { PercentageZoneAccessory } from './percentageZoneAccessory.js';
import { cachedZoneControlType, type ZoneControlType } from './zoneLayout.js';

export class PercentageZoneManager {
  private readonly handlers = new Map<string, PercentageZoneAccessory>();
  private present = new Set<string>();
  private stopped = false;

  constructor(
    private readonly api: API,
    private readonly accessories: Map<string, PlatformAccessory>,
    private readonly coordinator: Pick<ControllerCoordinator,
      'readPercentageZoneState' | 'requestPercentageZoneState' | 'readZonePercentage' | 'requestZonePercentage'>,
    private readonly warn: (message: string) => void,
    private readonly onCreated: (name: string) => void,
    private readonly controlType: ZoneControlType = 'switch-light',
  ) {}

  static prepareCachedAccessory(api: API, accessory: PlatformAccessory): void {
    if (accessory.context.advantageAirPercentageZone !== true) {
      return;
    }
    const unavailable = () => {
      throw new ZoneCommandError('Waiting for valid controller data.');
    };
    new PercentageZoneAccessory(api, accessory, {
      getOn: unavailable, setOn: unavailable, getPercentage: unavailable, setPercentage: unavailable, warn: () => undefined,
    }, cachedZoneControlType(accessory)).update();
  }

  update(state: ControllerPollState): void {
    if (this.stopped) {
      return;
    }
    try {
      if (!state.data || state.lastAttemptFailed) {
        return;
      }
      const devices = discoverDevices(state.data);
      this.present.clear();
      for (const device of devices) {
        if (device.kind !== 'zone' || state.data.aircons[device.airconKey].zones[device.zoneKey].type !== 0) {
          continue;
        }
        const switchId = this.api.hap.uuid.generate(JSON.stringify([device.identity, 'zone-switch']));
        // A sensor dropout must not add a Lightbulb alongside an existing Switch.
        if (this.accessories.get(switchId)?.context.advantageAirZoneSwitch === true) {
          continue;
        }
        this.present.add(device.identity);
        this.attach(device.identity, device.name, state.data.system.sysType);
      }
    } catch (error) {
      this.present.clear();
      throw error;
    } finally {
      this.updateHandlers();
    }
  }

  stop(): void {
    this.stopped = true;
    this.present.clear();
    this.updateHandlers();
  }

  private attach(identity: string, name: string, sysType: unknown): void {
    const uuid = this.api.hap.uuid.generate(JSON.stringify([identity, 'zone-percentage']));
    if (this.handlers.has(identity)) {
      const accessory = this.accessories.get(uuid);
      if (accessory) {
        updateAccessoryInformation(this.api, accessory, sysType, true);
      }
      return;
    }
    const cached = this.accessories.get(uuid);
    const accessory = cached ?? new this.api.platformAccessory(`${name} Zone`, uuid);
    const use = <T>(operation: () => T): T => {
      if (this.stopped || !this.present.has(identity)) {
        throw new ZoneCommandError('The percentage-controlled zone is unavailable.');
      }
      return operation();
    };
    const handler = new PercentageZoneAccessory(this.api, accessory, {
      getOn: () => use(() => this.coordinator.readPercentageZoneState(identity)),
      setOn: on => use(() => this.coordinator.requestPercentageZoneState(identity, on)),
      getPercentage: () => use(() => this.coordinator.readZonePercentage(identity)),
      setPercentage: value => use(() => this.coordinator.requestZonePercentage(identity, value)),
      warn: this.warn,
    }, this.controlType);
    const metadataChanged = updateAccessoryInformation(this.api, accessory, sysType);
    const needsMarker = accessory.context.advantageAirPercentageZone !== true;
    const layoutChanged = cachedZoneControlType(accessory) !== this.controlType;
    accessory.context.advantageAirPercentageZone = true;
    accessory.context.advantageAirZoneControlType = this.controlType;
    if (cached && (needsMarker || metadataChanged || layoutChanged)) {
      this.api.updatePlatformAccessories([accessory]);
    }
    if (!cached) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }
    this.handlers.set(identity, handler);
    if (!cached) {
      try {
        this.onCreated(accessory.displayName);
      } catch {
        // A logging failure must not interrupt discovery.
      }
    }
  }

  private updateHandlers(): void {
    for (const handler of this.handlers.values()) {
      handler.update();
    }
  }
}
