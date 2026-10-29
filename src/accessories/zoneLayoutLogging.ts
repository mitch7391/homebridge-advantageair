import type { API, PlatformAccessory } from 'homebridge';
import type { SystemData } from '../api/systemData.js';
import { discoverDevices } from '../discovery/discoverDevices.js';

interface ZonePresentation {
  control: string;
  temperature?: string;
  linked: boolean;
  separate: boolean;
}

/** Read actual services, not requested settings. Only inspect this validated controller's zones. */
export function captureZoneLayouts(api: API, accessories: Map<string, PlatformAccessory>, data: SystemData): Map<string, ZonePresentation> {
  const result = new Map<string, ZonePresentation>();
  const { Switch, Lightbulb, Fan, TemperatureSensor } = api.hap.Service;
  for (const device of discoverDevices(data)) {
    if (device.kind !== 'zone') {
      continue;
    }
    const id = (role: string) => api.hap.uuid.generate(JSON.stringify([device.identity, role]));
    const separate = accessories.get(id('temperature'))?.context.advantageAirTemperature === true;
    for (const [role, marker] of [['zone-switch', 'advantageAirZoneSwitch'], ['zone-percentage', 'advantageAirPercentageZone']]) {
      const accessory = accessories.get(id(role));
      if (accessory?.context[marker] !== true) {
        continue;
      }
      const control = accessory.getService(Switch) ?? accessory.getService(Lightbulb) ?? accessory.getService(Fan);
      if (!control) {
        continue;
      }
      const sensor = accessory.getService(TemperatureSensor);
      result.set(accessory.UUID, {
        control: control.UUID === Switch.UUID ? 'Switches' : control.UUID === Lightbulb.UUID ? 'Lights' : 'Fans',
        // Subtype is HAP's persisted service identity key; IIDs may be allocated later.
        temperature: sensor ? sensor.subtype ?? '' : undefined,
        linked: !!sensor && accessory.context.advantageAirLinkedTemperature === true && control.linkedServices.includes(sensor),
        separate,
      });
    }
  }
  return result;
}

/** Ephemeral before/after comparison: no logging-only cache or persistent state. */
export function reportZoneLayoutChanges(
  before: Map<string, ZonePresentation>, after: Map<string, ZonePresentation>,
  info: (message: string) => void, warn: (message: string) => void,
): void {
  const layouts = new Map<string, number>();
  let linked = 0;
  let unlinked = 0;
  let repaired = 0;
  let identitiesChanged = false;
  for (const [uuid, old] of before) {
    const current = after.get(uuid);
    if (!current) {
      continue;
    }
    if (old.control !== current.control) {
      const transition = `${old.control} → ${current.control}`;
      layouts.set(transition, (layouts.get(transition) ?? 0) + 1);
      identitiesChanged = true;
    }
    if (!old.linked && current.linked && !current.separate) {
      linked++;
      identitiesChanged ||= old.separate;
    }
    if (old.linked && !current.linked && current.temperature === undefined && current.separate) {
      unlinked++;
      identitiesChanged = true;
    }
    if (old.temperature !== undefined && current.temperature !== undefined
      && old.temperature !== current.temperature && current.linked) {
      repaired++;
      identitiesChanged = true;
    }
  }
  // Logger failures must never interrupt polling or accessory reconciliation.
  try {
    const zones = (count: number) => `${count} ${count === 1 ? 'zone' : 'zones'}`;
    const controls = (count: number) => `${count} zone ${count === 1 ? 'control' : 'controls'}`;
    if (layouts.size) {
      info(`Zone control layout changed: ${[...layouts].map(([change, count]) => `${change} (${zones(count)})`).join('; ')}.`);
    }
    if (linked) {
      info(`Zone temperatures linked to ${controls(linked)}.`);
    }
    if (unlinked) {
      info(`Zone temperatures unlinked from ${controls(unlinked)}; separate temperature accessories restored.`);
    }
    if (repaired) {
      info(`Reconciled linked temperature services for ${zones(repaired)} to maintain the selected HomeKit control presentation.`);
    }
    if (identitiesChanged) {
      warn('HomeKit service identities changed. Affected Apple Home scenes and automations may need to be recreated.');
    }
  } catch {
    // No controller addresses, IDs, service subtypes or payloads are logged.
  }
}
