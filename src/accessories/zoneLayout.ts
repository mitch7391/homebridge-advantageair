import { randomUUID } from 'node:crypto';
import type { API, PlatformAccessory, Service } from 'homebridge';

// These describe this process's unallocated transitions, not persisted HomeKit identities.
const replacedControls = new WeakMap<Service, Service>();
const pendingTemperatures = new WeakMap<Service, { control: Service; subtype: string; previousIID: number | null }>();

export type ZoneControlType = 'switch-light' | 'lights' | 'fans';

/** Omitted settings preserve the Beta 2 layout. Reject typos rather than rearranging Home. */
export function zoneLayout(device: Record<string, unknown>): { type: ZoneControlType; linkTemperatures: boolean } {
  const type = device.zoneControlType === undefined ? 'switch-light' : device.zoneControlType;
  if (type !== 'switch-light' && type !== 'lights' && type !== 'fans') {
    throw new Error('Zone Control Type must be switch-light, lights or fans.');
  }
  if (device.linkZoneTemperatures !== undefined && typeof device.linkZoneTemperatures !== 'boolean') {
    throw new Error('Link temperatures to zone controls must be true or false.');
  }
  return { type, linkTemperatures: device.linkZoneTemperatures === true };
}

/** Cache restoration uses the saved presentation until controller identity is verified. */
export function cachedZoneControlType(accessory: PlatformAccessory): ZoneControlType {
  const type = accessory.context.advantageAirZoneControlType;
  return type === 'lights' || type === 'fans' ? type : 'switch-light';
}

/** Only call for this plugin's zone-control accessories, never thermostat/mode fans or lights. */
export function zoneControlService(api: API, accessory: PlatformAccessory, type: ZoneControlType, percentage: boolean): Service {
  const { Switch, Lightbulb, Fan, TemperatureSensor } = api.hap.Service;
  const wanted = type === 'fans' ? Fan : percentage || type === 'lights' ? Lightbulb : Switch;
  const existing = accessory.getService(wanted);
  const selected = existing ?? new wanted(accessory.displayName);
  const temperature = !percentage && accessory.context.advantageAirLinkedTemperature === true
    ? accessory.getService(TemperatureSensor) : undefined;
  if (temperature && !existing) {
    replacedControls.set(temperature, selected);
  }
  const detachTemperature = temperature !== undefined
    && (!existing || accessory.services.indexOf(temperature) < accessory.services.indexOf(existing));

  // HAP appends added services. Retain the SAME sensor/characteristics, but put the
  // control first, including when repairing an already cached temperature-first layout.
  // Complete this synchronously before callers can persist or publish the final state.
  if (detachTemperature) {
    accessory.removeService(temperature);
  }
  try {
    for (const kind of [Switch, Lightbulb, Fan]) {
      const old = accessory.getService(kind);
      if (kind !== wanted && old) {
        if (temperature?.linkedServices.includes(old)) {
          temperature.removeLinkedService(old);
        }
        accessory.removeService(old);
      }
    }
    if (!existing) {
      accessory.addService(selected);
    }
  } finally {
    if (detachTemperature) {
      accessory.addService(temperature);
    }
  }
  if (temperature) {
    if (temperature.isPrimaryService) {
      temperature.setPrimaryService(false);
    }
    if (!selected.isPrimaryService) {
      selected.setPrimaryService(true);
    }
    if (!selected.linkedServices.includes(temperature)) {
      selected.addLinkedService(temperature);
    }
  }
  return selected;
}

/** Only invoke after controller identity/capability validation, when linking is requested. */
export function reconcileLinkedTemperature(api: API, accessory: PlatformAccessory, control: Service): boolean {
  const { TemperatureSensor } = api.hap.Service;
  let temperature = accessory.getService(TemperatureSensor);
  let changed = false;
  if (!temperature) {
    // A newly linked sensor must not accidentally reuse an older, unexpired cache key.
    temperature = accessory.addService(TemperatureSensor, accessory.displayName, `aa-linked-temperature-${randomUUID()}`);
    changed = true;
  } else {
    const pending = pendingTemperatures.get(temperature);
    const awaitingAllocation = pending?.control === control
      && pending.subtype === temperature.subtype && pending.previousIID === temperature.iid;
    if (!awaitingAllocation) {
      pendingTemperatures.delete(temperature);
      const wrongOrder = typeof control.iid === 'number' && control.iid > 0
        && typeof temperature.iid === 'number' && temperature.iid > 0 && temperature.iid < control.iid;
      if (replacedControls.get(temperature) === control || wrongOrder) {
        const subtype = `aa-linked-temperature-${randomUUID()}`;
        const previousIID = temperature.iid;
        // subtype is a public HAP identity property. Keep the same characteristic
        // objects/handlers; HAP alone assigns the new IIDs on its next allocation.
        accessory.removeService(temperature);
        temperature.subtype = subtype;
        accessory.addService(temperature);
        pendingTemperatures.set(temperature, { control, subtype, previousIID });
        replacedControls.delete(temperature);
        changed = true;
      }
    }
  }
  if (temperature.isPrimaryService) {
    temperature.setPrimaryService(false);
    changed = true;
  }
  if (!control.isPrimaryService) {
    control.setPrimaryService(true);
    changed = true;
  }
  if (!control.linkedServices.includes(temperature)) {
    control.addLinkedService(temperature);
    changed = true;
  }
  return changed;
}
