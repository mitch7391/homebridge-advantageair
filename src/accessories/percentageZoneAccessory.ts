import type { API, Characteristic, PlatformAccessory } from 'homebridge';
import { ZoneCommandError } from '../api/zoneCommand.js';
import { normalizeZonePercentage } from '../api/zonePercentage.js';
import { zoneControlService, type ZoneControlType } from './zoneLayout.js';

export interface PercentageZoneOptions {
  getOn: () => boolean;
  setOn: (on: boolean) => void;
  getPercentage: () => number;
  setPercentage: (value: number) => void;
  warn: (message: string) => void;
}

export class PercentageZoneAccessory {
  private readonly readings: Array<[Characteristic, () => boolean | number]>;

  constructor(private readonly api: API, accessory: PlatformAccessory, options: PercentageZoneOptions,
    type: ZoneControlType = 'switch-light') {
    const { Characteristic, Perms } = api.hap;
    const service = zoneControlService(api, accessory, type, true);
    const on = service.getCharacteristic(Characteristic.On);
    const percentageControl = service.getCharacteristic(type === 'fans' ? Characteristic.RotationSpeed : Characteristic.Brightness);
    const readOn = () => {
      const value = options.getOn();
      if (typeof value !== 'boolean') {
        throw this.unavailable();
      }
      return value;
    };
    const readPercentage = () => {
      const value = options.getPercentage();
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 5 || value > 100 || value % 5 !== 0) {
        throw this.unavailable();
      }
      return value;
    };
    this.readings = [[on, readOn], [percentageControl, readPercentage]];
    for (const [characteristic, read] of this.readings) {
      characteristic.setProps({ perms: [...new Set([...characteristic.props.perms, Perms.WRITE_RESPONSE])] })
        .onGet(() => {
          try {
            return read();
          } catch {
            throw this.unavailable();
          }
        });
    }
    const refuse = (error: unknown, target: string): never => {
      const reason = error instanceof ZoneCommandError ? error.message : 'The zone request could not be accepted.';
      try {
        options.warn(`Zone command refused for "${accessory.displayName}" (${target}): ${reason}`);
      } catch {
        // Logging must not change the HomeKit error response.
      }
      throw this.unavailable();
    };
    on.onSet(value => {
      if (typeof value !== 'boolean') {
        throw new api.hap.HapStatusError(api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
      }
      try {
        options.setOn(value);
        return readOn();
      } catch (error) {
        return refuse(error, value ? 'Open' : 'Closed');
      }
    });
    // Round here, rather than letting HAP step-round a small positive value to zero.
    percentageControl.setProps({ minValue: 0, maxValue: 100, minStep: 1 }).onSet(value => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
        throw new api.hap.HapStatusError(api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
      }
      try {
        if (value === 0) {
          const retained = readPercentage();
          options.setOn(false);
          return retained;
        }
        const percentage = normalizeZonePercentage(value);
        options.setPercentage(percentage);
        return percentage;
      } catch (error) {
        return refuse(error, value === 0 ? 'Closed' : `${value}%`);
      }
    });
  }

  update(): void {
    for (const [characteristic, read] of this.readings) {
      try {
        characteristic.updateValue(read());
      } catch {
        characteristic.updateValue(this.unavailable());
      }
    }
  }

  private unavailable(): Error {
    return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}
