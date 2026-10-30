import type { API, CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { ZoneCommandError } from '../api/zoneCommand.js';
import { zoneControlService, type ZoneControlType } from './zoneLayout.js';

export interface ZoneSwitchOptions {
  getOn: () => boolean;
  /** Synchronous admission. Execution and confirmation happen later. */
  setOn: (on: boolean) => void;
  warn: (message: string) => void;
}

/** Sensor-equipped zone On/Off control; presentation never adds a writable opening percentage. */
export class ZoneSwitchAccessory {
  private readonly service: Service;

  constructor(
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
    private readonly options: ZoneSwitchOptions,
    type: ZoneControlType = 'switch-light',
  ) {
    const { Characteristic } = api.hap;
    this.service = zoneControlService(api, accessory, type, false);
    this.service.getCharacteristic(Characteristic.On)
      .onGet(() => {
        try {
          return this.options.getOn();
        } catch {
          throw this.unavailable();
        }
      })
      .onSet(value => this.set(value));
  }

  update(): void {
    try {
      this.service.updateCharacteristic(this.api.hap.Characteristic.On, this.options.getOn());
    } catch {
      this.service.updateCharacteristic(this.api.hap.Characteristic.On, this.unavailable());
    }
  }

  private set(value: CharacteristicValue): void {
    if (typeof value !== 'boolean') {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
    }
    try {
      this.options.setOn(value);
    } catch (error) {
      const reason = error instanceof ZoneCommandError ? error.message : 'The zone request could not be accepted.';
      this.options.warn(`Zone command refused for "${this.accessory.displayName}" (${value ? 'Open' : 'Closed'}): ${reason}`);
      throw this.unavailable();
    }
  }

  private unavailable(): Error {
    return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}
