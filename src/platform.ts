import { claimController } from './discovery/controllerOwnership.js';
import { lightId } from './api/lightCommand.js';
import { LightManager } from './accessories/lightManager.js';
import { detailedDebug, HomeNames } from './discovery/homeNames.js';
import { TimerValveManager } from './accessories/timerValveManager.js';
import { fanSetting } from './api/fanCommand.js';
import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { AdvantageAirClient } from './api/advantageAirClient.js';
import { ControllerCoordinator } from './api/controllerCoordinator.js';
import type { ControllerPollState } from './api/controllerPoller.js';
import { ZoneSwitchManager } from './accessories/zoneSwitchManager.js';
import { ThermostatManager } from './accessories/thermostatManager.js';
import { ModeFanManager } from './accessories/modeFanManager.js';
import { MyZoneManager } from './accessories/myZoneManager.js';
import { PercentageZoneManager } from './accessories/percentageZoneManager.js';
import { DuplicateControllerError, ZoneTemperatureManager } from './accessories/zoneTemperatureManager.js';
import { zoneLayout } from './accessories/zoneLayout.js';
import { captureZoneLayouts, reportZoneLayoutChanges } from './accessories/zoneLayoutLogging.js';

interface ConfiguredController {
  refreshAccessories: () => void;
  name: string;
  debug: boolean;
  poller: ControllerCoordinator;
  switchManager: ZoneSwitchManager;
  thermostatManager: ThermostatManager;
  modeFanManager: ModeFanManager;
  myZoneManager: MyZoneManager;
  percentageManager: PercentageZoneManager;
  timerManager: TimerValveManager;
  lightManager: LightManager;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class AdvantageAirPlatform implements DynamicPlatformPlugin {
  public readonly accessories = new Map<string, PlatformAccessory>();

  private readonly controllers: ConfiguredController[] = [];
  private readonly homeNames: HomeNames;
  private launched = false;
  private stopped = false;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.homeNames = new HomeNames(message => this.log.warn(message));
    this.configureControllers(this.config.devices);

    this.api.on('didFinishLaunching', () => {
      if (this.launched || this.stopped) {
        return;
      }

      this.launched = true;

      for (const controller of this.controllers) {
        this.log.info('Starting controller polling:', controller.name);
        controller.poller.start();
      }
    });

    this.api.on('shutdown', () => {
      this.stopped = true;

      for (const controller of this.controllers) {
        controller.poller.stop();
        controller.switchManager.stop();
        controller.thermostatManager.stop();
        controller.modeFanManager.stop();
        controller.myZoneManager.stop();
        controller.percentageManager.stop();
        controller.timerManager.stop();
        controller.lightManager.stop();
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
    ZoneTemperatureManager.prepareCachedAccessory(this.api, accessory);
    ZoneSwitchManager.prepareCachedAccessory(this.api, accessory);
    ThermostatManager.prepareCachedAccessory(this.api, accessory);
    ModeFanManager.prepareCachedAccessory(this.api, accessory);
    MyZoneManager.prepareCachedAccessory(this.api, accessory);
    PercentageZoneManager.prepareCachedAccessory(this.api, accessory);
    TimerValveManager.prepareCachedAccessory(this.api, accessory);
    LightManager.prepareCachedAccessory(this.api, accessory);
  }

  private configureControllers(devices: unknown): void {
    if (!Array.isArray(devices) || devices.length === 0) {
      this.log.warn('No controllers configured. Add a controller in plugin settings.');
      return;
    }

    const endpoints = new Set<string>();

    for (const [index, device] of devices.entries()) {
      try {
        if (!isObject(device)) {
          throw new Error('Controller settings must be an object.');
        }

        if (typeof device.ipAddress !== 'string') {
          throw new Error('An IPv4 address is required.');
        }

        if (device.port !== undefined && typeof device.port !== 'number') {
          throw new Error('Port must be a number.');
        }

        if (device.name !== undefined && typeof device.name !== 'string') {
          throw new Error('Controller name must be text.');
        }

        if (device.homeName !== undefined && typeof device.homeName !== 'string') {
          throw new Error('Home Name must be text.');
        }

        if (device.debug !== undefined && typeof device.debug !== 'boolean') {
          throw new Error('Debug must be true or false.');
        }
        const layout = zoneLayout(device);

        const ipAddress = device.ipAddress.trim();
        const port = device.port ?? 2025;
        const name = typeof device.name === 'string' && device.name.trim()
          ? device.name.trim()
          : `Controller ${index + 1}`;

        const debug = detailedDebug(this.config.debug, device.debug);
        // Selected controller diagnostics must be visible without Homebridge's -D.
        // Keep the gate here; normal status/warnings/errors use their existing paths.
        const diagnostic = (...message: string[]) => {
          if (debug) {
            this.log.info('[Debug]', ...message);
          }
        };
        const client = new AdvantageAirClient({
          ipAddress, port,
          onDiagnostic: debug
            ? event => diagnostic(name, 'AA timing:', JSON.stringify(event))
            : undefined,
        });
        const endpoint = `${ipAddress}:${port}`;

        if (endpoints.has(endpoint)) {
          throw new Error('This controller address and port are already configured.');
        }

        endpoints.add(endpoint);

        const excluded = device.excludedLightIds ?? [];
        if (!Array.isArray(excluded)) {
          throw new Error('Excluded light IDs must be an array.');
        }
        const exclusions = new Set(excluded.map(lightId));
        const owner = {};
        let previouslyFailed = false;
        let receivedData = false;
        let accessoryUpdateFailed = false;

        const temperatureManager = new ZoneTemperatureManager(
          this.api,
          this.accessories,
          accessoryName => this.log.info(name, 'Created accessory:', accessoryName),
          owner,
          layout.linkTemperatures,
        );

        const updateManagers: Array<(state: ControllerPollState) => void> = [
          state => temperatureManager.update(state),
        ];
        let latestState: ControllerPollState = { lastAttemptFailed: false };
        const refreshAccessories = (coordinator: ControllerCoordinator) => {
          let updateFailed = false;
          let previousLayouts: ReturnType<typeof captureZoneLayouts> | undefined;
          if (latestState.data && !latestState.lastAttemptFailed) {
            try {
              claimController(this.api, latestState.data, owner);
              previousLayouts = captureZoneLayouts(this.api, this.accessories, latestState.data);
            } catch (error) {
              if (error instanceof DuplicateControllerError) {
                coordinator.stop();
                this.log.error('Duplicate controller identity:', name, 'Polling stopped for this entry.');
                return;
              }
              // Let each manager fault retained accessories when identity data is invalid.

            }
          }
          for (const update of updateManagers) {
            try {
              update(latestState);
            } catch (error) {
              if (error instanceof DuplicateControllerError) {
                coordinator.stop();
                this.log.error('Duplicate controller identity:', name, 'Polling stopped for this entry.');
                return;
              }
              updateFailed = true;
            }
          }
          if (previousLayouts && !updateFailed && latestState.data) {
            reportZoneLayoutChanges(previousLayouts, captureZoneLayouts(this.api, this.accessories, latestState.data),
              message => this.log.info(`Controller ${index + 1}:`, message),
              message => this.log.warn(`Controller ${index + 1}:`, message));
          }
          if (updateFailed && !accessoryUpdateFailed) {
            this.log.error(
              'Controller accessory update failed:',
              name,
              'Existing accessories have been retained.',
            );
          }
          accessoryUpdateFailed = updateFailed;
        };
        const poller = new ControllerCoordinator(client, (state, reason) => {
          latestState = state;
          const namesChanged = state.data && !state.lastAttemptFailed
            ? this.homeNames.update(index, state.data) : false;
          refreshAccessories(poller);
          if (namesChanged) {
            // All names have been validated before any manager sees a new name.
            // Refresh earlier responders without another controller read or write.
            for (const controller of this.controllers) {
              if (controller.poller !== poller) {
                controller.refreshAccessories();
              }
            }
          }
          if (reason === 'state') {
            return;
          }

          if (state.lastAttemptFailed) {
            if (!previouslyFailed) {
              this.log.warn(
                'Controller read failed:',
                name,
                state.data
                  ? 'Retaining previously received data; it may be stale.'
                  : 'Waiting for the first valid response.',
              );
            }

            previouslyFailed = true;
            return;
          }

          if (!state.data) {
            return;
          }

          if (previouslyFailed) {
            this.log.info('Controller communication recovered:', name);
          } else if (!receivedData) {
            this.log.info('Received first valid controller response:', name);
          }

          previouslyFailed = false;
          receivedData = true;

          if (debug) {
            const aircons = Object.values(state.data.aircons);
            const zoneCount = aircons.reduce(
              (total, aircon) => total + Object.keys(aircon.zones).length,
              0,
            );

            diagnostic(
              'Controller read:',
              name,
              `${aircons.length} air conditioner(s), ${zoneCount} zone(s).`,
            );
          }
        }, message => this.log.warn(name, message), (event) => {
          const state = event.kind === 'lightOn' ? (event.on ? 'On' : 'Off')
            : event.kind === 'lightBrightness' ? 'brightness ' + event.brightness + '%'
              : event.kind === 'timer' ? (event.active ? 'timer ' + event.seconds / 60 + ' minutes' : 'timer cancelled')
                : event.kind === 'zone' ? (event.on ? 'Open' : 'Closed')
                  : event.kind === 'percentage' ? 'zone percentage ' + event.percentage + '%'
                    : event.kind === 'modeFan' ? (event.mode === 'vent' ? 'Ventilation' : 'Dry Mode') + (event.on ? ' On' : ' Off')
                      : event.kind === 'fan' ? 'fan speed ' + (event.percentage === 100 ? 'Auto Mode' : fanSetting(event.percentage).fan)
                        : event.kind === 'mode' ? event.mode
                          : event.kind === 'myZone' ? 'MyZone ' + event.zoneName : String(event.temperature) + ' °C';
          if (event.superseded || event.outcome === 'unchanged') {
            if (debug) {
              diagnostic(name, event.name,
                event.superseded ? 'Earlier command confirmed:' : 'Already in requested state:', state);
            }
          } else if (debug) {
            diagnostic(name, event.name, 'Controller confirmed:', state);
          }
        }, (accessoryName, target) => this.log.info(name, accessoryName, 'Sending:', target), (event) => {
          if (debug) {
            diagnostic(name, event.name, 'MyZone', event.zoneName,
              event.step + ' step:', event.outcome, event.reason ?? '');
          }
        });

        const switchManager = new ZoneSwitchManager(
          this.api,
          this.accessories,
          poller,
          message => this.log.warn(name, message),
          accessoryName => this.log.info(name, 'Created accessory:', accessoryName),
          layout.type,
        );
        updateManagers.unshift(state => switchManager.update(state));

        const thermostatManager = new ThermostatManager(
          this.api,
          this.accessories,
          poller,
          message => this.log.warn(name, message),
          accessoryName => this.log.info(name, 'Created accessory:', accessoryName),
          this.homeNames.resolve,
        );
        updateManagers.push(state => thermostatManager.update(state));

        const modeFanManager = new ModeFanManager(this.api, this.accessories, poller,
          message => this.log.warn(name, message),
          accessoryName => this.log.info(name, 'Created accessory:', accessoryName), this.homeNames.resolve);
        updateManagers.push(state => modeFanManager.update(state));

        const percentageManager = new PercentageZoneManager(this.api, this.accessories, poller,
          message => this.log.warn(name, message),
          accessoryName => this.log.info(name, 'Created accessory:', accessoryName), layout.type);
        updateManagers.push(state => percentageManager.update(state));

        const myZoneManager = new MyZoneManager(this.api, this.accessories, poller,
          message => this.log.warn(name, message),
          accessoryName => this.log.info(name, 'Created accessory:', accessoryName), this.homeNames.resolve);
        updateManagers.push(state => myZoneManager.update(state));

        const timerManager = new TimerValveManager(this.api, this.accessories, poller,
          message => this.log.warn(name, message),
          accessoryName => this.log.info(name, 'Created accessory:', accessoryName), this.homeNames.resolve);
        updateManagers.push(state => timerManager.update(state));

        this.homeNames.configure(index, name, device.homeName);
        const lightManager = new LightManager(this.api, this.accessories, poller, exclusions,
          message => this.log.warn(name, message));
        updateManagers.push(state => lightManager.update(state));

        this.controllers.push({
          refreshAccessories: () => refreshAccessories(poller), name, debug, poller,
          switchManager, thermostatManager, modeFanManager, percentageManager, myZoneManager, timerManager, lightManager,
        });
      } catch (error) {
        const reason = error instanceof Error
          ? error.message
          : 'Invalid controller settings.';

        this.log.error(`Controller entry ${index + 1} skipped: ${reason}`);
      }
    }
  }
}
