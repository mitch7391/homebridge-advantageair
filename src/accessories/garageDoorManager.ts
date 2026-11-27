import type { API, PlatformAccessory } from 'homebridge';
import type { ControllerPollState } from '../api/controllerPoller.js';
import type { ControllerCoordinator } from '../api/controllerCoordinator.js';
import { eligibleThing, garageDoorPolicy, ThingCommandError } from '../api/thingCommand.js';
import { configureThings } from '../discovery/configureThings.js';
import { PLATFORM_NAME, PLUGIN_NAME } from '../settings.js';
import { GarageDoorAccessory } from './garageDoorAccessory.js';
import { updateAccessoryName } from './accessoryName.js';
import { updateAccessoryInformation } from './accessoryInformation.js';

export class GarageDoorManager {
  private readonly handlers = new Map<string, GarageDoorAccessory>();
  private readonly present = new Set<string>();
  private stopped = false;
  constructor(private readonly api: API, private readonly accessories: Map<string, PlatformAccessory>,
    private readonly coordinator: Pick<ControllerCoordinator, 'readThing' | 'requestThing'>,
    private readonly overrides: () => unknown) {}

  static prepareCachedAccessory(api: API, accessory: PlatformAccessory): void {
    if (accessory.context.advantageAirGarage !== true) {
      return;
    }
    const unavailable = () => {
      throw new ThingCommandError('Waiting for Thing data.');
    };
    new GarageDoorAccessory(api, accessory, { read: unavailable, write: unavailable }).update();
  }
  update(state: ControllerPollState): void {
    if (this.stopped) {
      return;
    }
    this.present.clear();
    const projection = configureThings(state, this.overrides());
    const policy = garageDoorPolicy(this.overrides);
    for (const thing of projection.things) {
      const uuid = this.api.hap.uuid.generate(thing.identity);
      const cached = this.accessories.get(uuid);
      if (thing.status === 'excluded' && !state.lastAttemptFailed
        && typeof state.data?.system.mid === 'string' && state.data.system.mid.trim() === thing.controllerId) {
        if (cached?.context.advantageAirGarage === true) {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cached]);
          this.accessories.delete(uuid);
          this.handlers.delete(thing.identity);
        }
        continue;
      }
      try {
        eligibleThing(state, thing.identity, policy);
      } catch {
        continue;
      }
      const name = thing.observation?.name ?? 'Thing ' + thing.id;
      const accessory = cached ?? new this.api.platformAccessory(name, uuid);
      this.present.add(thing.identity);
      let changed = updateAccessoryInformation(this.api, accessory, state.data!.system.sysType);
      if (accessory.context.advantageAirGarage !== true) {
        accessory.context.advantageAirGarage = true;
        changed = true;
      }
      if (!this.handlers.has(thing.identity)) {
        const use = () => {
          if (this.stopped || !this.present.has(thing.identity)) {
            throw new ThingCommandError('Thing unavailable.');
          }
        };
        this.handlers.set(thing.identity, new GarageDoorAccessory(this.api, accessory, {
          read: target => {
            use(); return this.coordinator.readThing(thing.identity, target);
          },
          write: open => {
            use(); this.coordinator.requestThing(thing.identity, open);
          },
        }));
      }
      changed = updateAccessoryName(this.api, accessory, name,
        [[accessory.getService(this.api.hap.Service.GarageDoorOpener), name]]) || changed;
      if (!cached) {
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
      } else if (changed) {
        this.api.updatePlatformAccessories([accessory]);
      }
    }
    for (const handler of this.handlers.values()) {
      handler.update();
    }
  }
  stop(): void {
    this.stopped = true;
    this.present.clear();
    for (const handler of this.handlers.values()) {
      handler.update();
    }
  }
}
