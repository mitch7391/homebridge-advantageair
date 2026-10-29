import { claimController } from '../discovery/controllerOwnership.js';
export { DuplicateControllerError } from '../discovery/controllerOwnership.js';
import { updateAccessoryInformation } from './accessoryInformation.js';
import type { API, PlatformAccessory } from 'homebridge';

import type { ControllerPollState } from '../api/controllerPoller.js';
import { discoverDevices } from '../discovery/discoverDevices.js';
import { PLATFORM_NAME, PLUGIN_NAME } from '../settings.js';
import {
  ZoneTemperatureAccessory,
} from './zoneTemperatureAccessory.js';
import { cachedZoneControlType, reconcileLinkedTemperature, zoneControlService } from './zoneLayout.js';

interface TemperatureBinding {
  handler: ZoneTemperatureAccessory;
  airconKey: string;
  zoneKey: string;
  present: boolean;
}

export class ZoneTemperatureManager {
  private state: ControllerPollState = {
    lastAttemptFailed: false,
  };

  private readonly bindings = new Map<string, TemperatureBinding>();

  static prepareCachedAccessory(api: API, accessory: PlatformAccessory): void {
    if (accessory.context.advantageAirTemperature !== true && accessory.context.advantageAirLinkedTemperature !== true) {
      return;
    }

    // Saved readings are not evidence that the controller is reachable.
    // Discovery will replace these handlers after a valid response.
    const handler = new ZoneTemperatureAccessory(api, accessory, {
      airconKey: '',
      zoneKey: '',
      getState: () => ({ lastAttemptFailed: false }),
    });

    handler.update();
  }

  constructor(
    private readonly api: API,
    private readonly accessories: Map<string, PlatformAccessory>,
    private readonly onCreated?: (name: string) => void,
    private readonly owner: object = {},
    private readonly linkTemperatures = false,
  ) {}

  update(state: ControllerPollState): void {
    this.state = state;

    if (state.lastAttemptFailed || !state.data) {
      this.updateHandlers();
      return;
    }

    // Discover the complete response before changing any existing bindings.
    // If identities cannot be verified, old addressing must not be reused.
    let devices: ReturnType<typeof discoverDevices>;

    try {
      devices = discoverDevices(state.data);

      if (devices.length > 0) {
        claimController(this.api, state.data, this.owner);
      }
    } catch (error) {
      for (const binding of this.bindings.values()) {
        binding.present = false;
      }

      this.updateHandlers();
      throw error;
    }

    for (const binding of this.bindings.values()) {
      binding.present = false;
    }

    try {
      for (const device of devices) {
        if (device.kind !== 'zone') {
          continue;
        }

        const zone = state.data.aircons[device.airconKey].zones[device.zoneKey];

        // Capability determines whether a sensor exists.
        // A temporary sensor error must not remove its accessory.
        if (
          typeof zone.type !== 'number'
          || !Number.isInteger(zone.type)
          || zone.type <= 0
        ) {
          continue;
        }

        const uuid = this.api.hap.uuid.generate(JSON.stringify([
          device.identity,
          'temperature',
        ]));

        const cachedAccessory = this.accessories.get(uuid);
        const controlId = this.api.hap.uuid.generate(JSON.stringify([device.identity, 'zone-switch']));
        const control = this.accessories.get(controlId);
        const ownedControl = control?.context.advantageAirZoneSwitch === true ? control : undefined;
        // Controls are reconciled first. Never remove a separate sensor until its linked host is available.
        if (this.linkTemperatures && !ownedControl) {
          continue;
        }
        const linkedChanged = this.linkTemperatures && reconcileLinkedTemperature(
          this.api, ownedControl!, zoneControlService(this.api, ownedControl!, cachedZoneControlType(ownedControl!), false),
        );
        const existingBinding = this.bindings.get(uuid);
        if (existingBinding) {
          const accessory = this.linkTemperatures ? ownedControl : cachedAccessory;
          if (accessory) {
            updateAccessoryInformation(this.api, accessory, state.data.system.sysType, true);
            if (linkedChanged) {
              this.api.updatePlatformAccessories([accessory]);
            }
          }
          existingBinding.airconKey = device.airconKey;
          existingBinding.zoneKey = device.zoneKey;
          existingBinding.present = true;
          continue;
        }
        const accessory = this.linkTemperatures
          ? ownedControl!
          : cachedAccessory ?? new this.api.platformAccessory(`${device.name} Temperature`, uuid);

        if (!this.linkTemperatures && ownedControl?.context.advantageAirLinkedTemperature === true) {
          const sensor = ownedControl.getService(this.api.hap.Service.TemperatureSensor);
          if (sensor) {
            for (const service of ownedControl.services) {
              service.removeLinkedService(sensor);
            }
            ownedControl.removeService(sensor);
          }
          delete ownedControl.context.advantageAirLinkedTemperature;
          this.api.updatePlatformAccessories([ownedControl]);
        }

        // This mutable address lets restored handlers follow addressing
        // changes without changing the accessory's stable UUID.
        const address = {
          airconKey: device.airconKey,
          zoneKey: device.zoneKey,
          present: true,
        };

        const handler = new ZoneTemperatureAccessory(this.api, accessory, {
          get airconKey() {
            return address.airconKey;
          },
          get zoneKey() {
            return address.zoneKey;
          },
          getState: () => address.present
            ? this.state
            : { ...this.state, data: undefined },
        });

        const metadataChanged = updateAccessoryInformation(this.api, accessory, state.data.system.sysType);
        const marker = this.linkTemperatures ? 'advantageAirLinkedTemperature' : 'advantageAirTemperature';
        const needsMarker = accessory.context[marker] !== true;
        accessory.context[marker] = true;

        if (this.linkTemperatures) {
          const service = zoneControlService(this.api, accessory, cachedZoneControlType(accessory), false);
          service.setPrimaryService(true);
          service.addLinkedService(accessory.getService(this.api.hap.Service.TemperatureSensor)!);
          this.api.updatePlatformAccessories([accessory]);
          if (cachedAccessory?.context.advantageAirTemperature === true) {
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cachedAccessory]);
            this.accessories.delete(uuid);
          }
        } else if (cachedAccessory && (needsMarker || metadataChanged)) {
          this.api.updatePlatformAccessories([accessory]);
        }

        if (!this.linkTemperatures && !cachedAccessory) {
          this.api.registerPlatformAccessories(
            PLUGIN_NAME,
            PLATFORM_NAME,
            [accessory],
          );

          this.accessories.set(uuid, accessory);
        }

        // Keep the address object itself so later updates reach the getters.
        const binding: TemperatureBinding = Object.assign(address, {
          handler,
        });

        this.bindings.set(uuid, binding);
        if (!this.linkTemperatures && !cachedAccessory) {
          try {
            this.onCreated?.(accessory.displayName);
          } catch {
            // A logging failure must not interrupt accessory discovery.
          }
        }
      }
    } finally {
      this.updateHandlers();
    }
  }

  private updateHandlers(): void {
    for (const binding of this.bindings.values()) {
      binding.handler.update();
    }
  }
}
