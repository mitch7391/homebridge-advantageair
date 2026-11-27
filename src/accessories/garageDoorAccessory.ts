import type { API, PlatformAccessory, Characteristic } from 'homebridge';

export class GarageDoorAccessory {
  private readonly readings: Array<[Characteristic, () => number | boolean]> = [];
  constructor(private readonly api: API, accessory: PlatformAccessory,
    options: { read: (target: boolean) => boolean; write: (open: boolean) => void }) {
    const { Service, Characteristic, Perms } = api.hap;
    const service = accessory.getService(Service.GarageDoorOpener)
      ?? accessory.addService(Service.GarageDoorOpener, accessory.displayName);
    for (const target of [false, true]) {
      const type = target ? Characteristic.TargetDoorState : Characteristic.CurrentDoorState;
      const characteristic = service.getCharacteristic(type);
      const read = () => options.read(target) ? type.OPEN : type.CLOSED;
      this.readings.push([characteristic, read]);
      characteristic.onGet(() => this.read(read));
      if (target) {
        characteristic.setProps({ perms: [...new Set([...characteristic.props.perms, Perms.WRITE_RESPONSE])] });
        characteristic.onSet(value => {
          if (value !== type.OPEN && value !== type.CLOSED) {
            throw new api.hap.HapStatusError(api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
          }
          try {
            options.write(value === type.OPEN);
            return read();
          } catch {
            throw this.unavailable();
          }
        });
      }
    }
    // Compatibility convention, not independent obstruction sensing.
    const obstruction = service.getCharacteristic(Characteristic.ObstructionDetected);
    const readObstruction = () => {
      options.read(false); return false;
    };
    obstruction.onGet(() => this.read(readObstruction));
    this.readings.push([obstruction, readObstruction]);
  }
  private unavailable(): Error {
    return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
  private read(reader: () => number | boolean): number | boolean {
    try {
      return reader();
    } catch {
      throw this.unavailable();
    }
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
}
