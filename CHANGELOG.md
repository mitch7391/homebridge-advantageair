# Change Log

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/).

## 3.12.4 (Unreleased)

* Make the native v4 startup announcement and README introduction evergreen,
  directing users to current compatibility and migration guidance.
* Render the four startup messages in Bright Blue when terminal colour support
  is available, with unchanged plain-text content otherwise.
* Legacy plugin functionality is unchanged; native v4 remains a separate plugin
  and migration is optional and manual.

## 3.12.3 (2026-10-21)

* Add a once-per-Homebridge-process startup notice for the published standalone
  `homebridge-advantageair@4.0.0-beta.2` native v4 beta. Existing v3 configurations,
  accessories and controller behaviour are unchanged; migration is optional,
  not automatic.
* Update the README and announcement links to the renamed repository and
  published migration guidance.

## 3.12.2 (2026-07-22)

Clearly rusty at releases...

### Fixed

* Restored compatibility with current Homebridge Configuration UI versions.
* Restored the Check Configuration button that was no longer working.

### Changed
* Declared compatibility with Homebridge 2.x and dropped the beta tagging.
* Added Node.js 24 support while keeping 18 also.
* Updated lodash from 4.17.21 to 4.18.1.
* Updated package metadata for the 3.12.2 release.

## 3.12.1 (2026-07-22)

* Initial maintenance release containing the Homebridge 2.x compatibility and configuration UI fixes.
* Superseded by 3.12.2 to complete the changelog and package-lock version metadata.

## 3.12.0 (2025-01-12)

### Farewell

It is with a heavy heart that I have to archive this plugin for the time being after many years of supporting this community. After years of of IVF, becoming a father of twins early last year has changed my outlook on life, my priorities and of course how much free time I have! An archived plugin means that all users will still be able to use the plugin, but you will not be able to submit issues or requests, and it will no longer be updated. I am hoping to have all prepared that is required for Homebridge v2 so that is a smooth transition for existing users.

It would be remiss of me to not let users know that former contributer [Uswong](https://github.com/uswong), has created his own version of this plugin some time ago called [homebridge-myplace](https://github.com/uswong/homebridge-myplace) that no longer requires a seperate install of homebridge-cmd4 and has had some further improvements that have not be applied to this plugin. Please note that his plugin only has one configuration option, and if you use homebridge-cmd4 for accessories outside of this plugin, they may no longer work in homebridge alongside his plugin.

For the first time ever I will be adding a donate link to my page. This is just if anyone would like to shout me a coffee :) I have also added a link to my Reddit account if anyone does need to get hold of me for any reason. Lastly, I would like to thank you all for making this an amazing journey. I have met so many nice people along the way who have helped shape this plugin and been patient with me as I learned to get this going from little to no coding background to where it is now. I do hope to get back into this again one day! :D

## 3.11.0 (2024-01-10)

Special thanks to the amazing [uswong](https://github.com/uswong) for executing these new features! Make sure to run the ConfigCreator again to update your config and take advantage of the new features!

### Notable Changes

* Accessory names can now handle a single quote `'`, for example `Mitch's Room`. You must also update `homebridge-cmd4` to `v7.0.2` to take advantage of this feature.
* For users with `myZone` taking advantage of the 'Fan' Zone Control setup, since iOS 17 the `SwingMode` characteristic we were using to be the `myZone` switch has disappeared from the accessory's Homekit primary page but hidden deep inside the accessory's Homekit settings. Now we are using the `RotationDirection` characteristic rather than `SwingMode` as a proxy for the `myZone` switch. `RotationDirection` characteristic will show as a round button switch on the Homekit accessory's primary page.

### Other Changes

* Performance Update: MyPlace `lights` and `things` will now use ID instead of Name as a parameter in `state_cmd_suffix` during the ConfigCreator process, requiring less parsing in `AdvAir.sh`.
* Dev: Added unit tests to for `lights` and `things` ID as a parameter in `state_cmd_suffix` and also added unit tests to test for `RotationDirection` characteristics.

### Bug Fixes

* Fixed: Broken url path to the homebridge logo on the `README`.


## 3.10.0 (2023-07-28)

Special thanks to the amazing [uswong](https://github.com/uswong) for executing these new features!

### Notable Changes

Some great Zone Control customisation options have come to the `ConfigCreator` based on how different people would like to use this plug-in! All you have to do is run the `ConfigCreator` to try them out or update your config! As always, take a copy of your existing config first just in case you would like to quickly revert back to what you already had.

* "Lightbulb/Switch" * accessory with standalone temperature sensor and myZone switch (legacy).
* "Lightbulb/Switch" * accessory with integrated temperature sensor but standalone myZone switch (new).
* "Lightbulb" only accessory with integrated temperature sensor but standalone myZone switch (new).
* "Fan" accessory with integrated temperature sensor and integrated myZone switch (new - recommended).

_*_ will use a Switch for temperature sensor zones and a Lightbulb for those without.

Read more about these options in Step 10 of the [README](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir#readme). If you have ideas for further config options, let us know!

### Other Changes

* Support for Fujitsu anywAIR systems, which seem to be a rebranded AdvantageAir System using port `10211`. As such, the PORT option has been added to the `ConfigCreator` and can be left as default for all AdvantageAir users and changed for anywAIR users.
* Added an optional performance enhancement by doing the necessary rounding in Cmd4 module.
* Dev: Dependency updates.
* Dev: Added unit tests for the additional characteristics `Active` and `SwingMode`.

### Bug Fixes

* Fixed: A vulnerability was found in `ConfigCreator.sh` for use in terminal. It would fail if an optional retries parameter was added in the `config.json`.
* Fixed: A bug was found in `AdvAir.sh` such that when the aircon system is offline, the plugin still registers it as online.


## 3.9.0 (2023-03-09)

Special thanks to the amazing [uswong](https://github.com/uswong) and [ztalbot2000](https://github.com/ztalbot2000) for adding these new features!

### Notable Changes

*  `myZone` - Will no longer blanket set the 'Target Temperature' from the Thermostat across all zones for myZone users. This functionality has been good for non-myZone users but should not be the case for myZone users; only the 'Target Temperature' of the zone defined as myZone is changed. This change will not affect non-myZone users.
*  `Fancy Timers` - New 'switch to mode timers' can be added from the `ConfigCreator` (needs to be run again to added to your config). These timers will add the functionality to change from one mode to the next after the timer is complete.
   * Cool: Switch to Cool mode once the timer is completed.
   * Heat: Switch to Heat mode once the timer is completed.
   * Vent (fan): Switch to Fan mode once the timer is completed.
* `No Response` - Previously if the Advantage Air device could not be reached, it would show the status as `Off`, but with homebridge-cmd4 `v7.0.0` (currently available via beta version `v7.0.0-beta2`) it will now display as `No Response`. This particularly usefull for users with the MyPlace smart extra modules which can go offline seperate of the main control unit.

### Other Changes

* Various under the hood quality of life and error handling improvements.

### Bug Fixes

* Yellow log warning 'requires Node.js version' fixed. `Node.js` dependancy updated.
* Red log error 'No plugin was found' fixed. If you still see this error, clear the area of your config that contains the following and run `ConfigCreator` again:

```json
        {
            "name": "cmd4AdvantageAir",
            "devices": [
                {
                    "name": "Aircon",
                    "ipAddress": "192.168.0.159"
                }
            ],
            "platform": "cmd4AdvantageAir"
        }
```


## 3.8.0 (2022-09-26)

Special thanks to the amazing [uswong](https://github.com/uswong) for executing these new features!

### Notable Changes

* Support added for `myZone`. For users that have access to `myZone`, this will expose a series of switch accessories that will allow the user to set which room is currently being used as `myZone` for temperature feedback to the Advantage Air controller. 
   * To add the `myZone` switches to you system, please run the ConfigCreator to add them to your config (Step 8 of the [README](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir#readme)).
   * More information on what `myZone` is can be found [here](https://www.manualslib.com/manual/1310157/Advantage-Air-Myair.html?page=17).

### Other Changes

* All defined `Constant Zones` are now used by `AdAvir.sh` when before it would only use the first defined `Constant Zone`.
* Better handling of systems that are a mix of zones with and without temperature sensors.


## 3.7.0 (2022-09-04)

Special thanks to the amazing [uswong](https://github.com/uswong) for executing this new feature! And happy birthday to my cat Pumpkin, the Red Menace!

### Notable Changes

* Much like how the new `ConfigCreator` can be run from the terminal for HOOBS users and Homebridge users without access to the web UI; the existing `CheckConfig` web UI button can now also be called from the terminal. Instructions can be found [here](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/wiki/Config-Creation#checkconfig).
* The `CheckConfig` script when called, will run through all the requirements of the plug-in installation steps and your config to make sure you are all set!

### Other Changes

* The `ConfigCreator` script will now prompt you to call the `CheckConfig` script in the very last steps.


## 3.6.0 (2022-08-28)

Special thanks to the amazing [uswong](https://github.com/uswong) for adding this new feature!

### Notable Changes

The new `ConfigCreator` can now be run from Homebridge UI! Once the Advantage Air device(s) is/are defined (note that only a maximum of 3 devices can be processed by `ConfigCreator`) and saved, click the `CONFIG CREATOR` button to auto-create the cmd4 configuration file required to run the `homebridge-cmd4-AdvantageAir` plugin. Make sure you check the checkbox if you want the fan to be setup as `FanSwitch` instead of a 'Fan' accessory before you click the `CONFIG CREATOR` button. 

This can be run by existing users if they want to update to the newest (and best!) config options available. You can always inspect or edit the configuration created in `homebridge-cmd4` (not `homebridge-cmd4-AdvantageAir`) JASON Config editor if you want after the fact; for example if you do not like the naming convention used. Once the configuration is created, you can then use the `CHECK CONFIGURATION` button to check whether the configuration meets all the requirements. 

<I><B> NOTE: </B> HOOBS users and users without access to Homebridge UI have to run the `ConfigCreator` from their terminal and follow the prompts. Instructions can be found [here](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/wiki/Config-Creation#configcreator). </I>

### Other Changes

* Addition of `FanSwitch` config option. For users who would rather have the Advantage Air fan as a `Switch` accessory instead of a `Fan` accessory. Fan speed will still be coupled and controlled with the `FanSwitch` accessory like it is with the `Thermostat`.
* Terminal mode of `ConfigCreator.sh` now has improved instructions in coloured form.

### Bug Fixes

* Dev: All lint errors resolved.
* Dev: Removed prepare script for husky


## 3.5.1 (2022-08-02)

Special thanks to the amazing [uswong](https://github.com/uswong) for adding this new feature!

### Bug Fixes

* Replaced use of command `tac` to `sort -nr` in new `ConfigCreator` (see `v3.5.0` below). Command `tac` is not available on macOS.


## 3.5.0 (2022-08-02)

Special thanks to the amazing [uswong](https://github.com/uswong) for adding this new feature!

### Notable Changes

* New `ConfigCreator` script to automatically craft your homebridge-cmd4-AdvantageAir config! This feature is particularly helpful for users with larger MyPlace systems containing Lights, Garage Doors, etc., who can have over 100 accessories; but new and existing users with smaller systems can still benefit from this feature!
   * You can choose to have the script generate a cmd4 config file for you to copy and paste into your existing `config.json` or opt to allow it to automaticaly add itself to your `config.json` to save you the effort of the copy/paste. This will not overwrite any other existing cmd4 accessories outside of this project.
   * Instructions on how to run this script can be found [here](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/wiki/Config-Creation#configcreator-instructions).

### Other Changes

* Dev: `timeout` increased for `Server.js` unit tests to be more suitable to dev testing on RPi.


## 3.4.0 (2022-06-10)

Special thanks to the amazing [uswong](https://github.com/uswong) and [ztalbot2000](https://github.com/ztalbot2000) for adding these new features!

### Notable Changes

* Support for Advantage Air systems with a second control tablet! This is for users who may have multiple aircons controlled by separate control tablets.
* Thermostat `Auto` mode is now used to set `dry` mode in Advantage Air control unit. This enable users to set the `dry` mode from Homekit.
* Performance: New function to update `myAirData.txt` cache file immediately after every `Set` command using `jq` so that the cache file always reflects the latest state of the system in real time.
* Minimized "write" events to the disk as per [issue #58](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/issues/58).

### Other Changes

* Created temporary sub-directory to store all temporary files required for the smooth running of `AdvAir.sh`.
* Dev: New `AirconServer` for better and more realistic unit testing.
* Dev: Real time count down capability is added to the `AirconServer` to make it behave more like a real aircon system.

### Bug Fixes

* Resolve issue where `AdvAir.sh` fails to write to `"/tmp"` which is denied in some Linux distros; as per [issue #58](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/issues/58). 
* Issue where `countDownToOn` timer is set and if the aircon is turned on manually instead, the `countDownToOn` remains on. It should be turned off because the aircon is now on.
* Minor bug fixes to new `AirconServer`.
* Dev: NPM Audit to fix issues with dependencies causing unit tests to fail.


## 3.3.0 (2022-03-25)

Special thanks to the amazing [uswong](https://github.com/uswong) and [ztalbot2000](https://github.com/ztalbot2000) for adding these new features! Another special thanks to John Wong and Kai Millar for all the beta testing that made this feature possible!

### Notable Changes

* MyPlace [Extras](https://www.advantageair.com.au/small-smarts-add-ons/) support!!!
  * Lights - both simple on/off and dimmable. Config examples can be found [here](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/wiki/Config-Creation#lightbulbs-1).
  * Garage Door Opener for Garage Doors and Gates. Config example can be found [here](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/wiki/Config-Creation#garage-door-and-gate).
* Support for Advantage Air systems with more than one air conditioners! You can add up to 5 aircons if they are all accessible from the one control tablet. Config examples can be found [here](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/wiki/Config-Creation#multiple-aircons)
* MyPlace users with the extras should set `"timeout"` in their config to `60000`.
* It is reccomended to change `"queueType"` from `"WoRm"` to `"WoRm2"` for better performance.

### Other Changes

* MyPlace smart eco-systems required large scale under the hood changes to manage the communication between Cmd4 and the Advantage Air Controllers. Greater detail can be found in this [Pull Request](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/pull/37).
* MyPlace Extras are now independent of the aircon system; for those who do not want to add the aircon system to HomeKit.
* Use of the `flip` constant in the `"state_cmd_suffix"` of your garage door or gate; incase the Advantage Air has installed it backwards!

### Bug Fixes

* Fix the close multiple zones bug that causes constant zone to open to 100%.
* Setting Thermostat to 'auto' from HomeKit will now default the Thermostat to the mode it was already on.
* Shellcheck cleared out over 60 syntax errors in the script that could have posed issues.
* Dev unit test fixes.


## 3.2.0 (2022-02-04)

Special thanks to the amazing [uswong](https://github.com/uswong) for adding these new features! Thank you to all who participated in the beta testing! 

### Notable Changes

* Zone closing check to ensure that at least one zone is open at all times as a secondary layer of protection for your ducting.
   * If you close all zones, it will open your Constant Zone damper to 100%.
* No longer require the use of `noSensors` in your `config.json`. The script determines if you have sensors or not.
* Temperature Sensor users no longer require to add zone (`z01`, `z02`, etc.) to `"state_cmd_suffix"` of Thermostat in your `config.json`. The script determines and sets it as your Constant Zone.
   * You can still set a zone if you prefer to choose a different zone to your Constant Zone. 
* Countdown timer added as a Lightbulb accessory; config can be found [here](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/wiki/Config-Creation#timer).
   * Depending on if your Advantage Air system is on or off will determine if the countdown is to turn the system on or off when it reaches 0.
   * New constant `timer` will need to be added to the `"state_cmd_suffix"` of this accessory.
   * The Advantage Air system will only allow 720 minutes (12 hours) for a timer and the Lightbulb has 0-100% to utilise. 
      * Therefore, setting 1% will equal 10 minutes, 6% will be equal to 1 hour.
      * Setting a value higher than 72% (720 minutes), will default back to 72% on the Lightbulb.

### Other Changes

* Shell Check Tool updated for new configurations. Always check you `config.json` with this after making changes!
* Dev dependancy `nanoid` security update to `v3.1.31`.


## 3.1.0 (2022-01-18)

Special thanks to the amazing [uswong](https://github.com/uswong) for adding the new fan speed feature and fixing the zone percentage bug! Thank you to all who participated in the beta testing! 

### Notable Changes

* Fan speed added to Fan accessory via charcteristic `rotationSpeed`. See new Fan config [here](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/wiki/Config-Creation#fan)!
   * Speeds: 1-33% (low), 34-67% (medium), 68-99% (high) and 100% ('auto' or 'ezfan').
* Fan speed added to Thermostat accessory via new `"linkedType"` config options; see new Thermostat config [here](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/wiki/Config-Creation#thermostat-with-fan-speed). You may need to delete the [Homebridge cache](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/issues/27#issuecomment-997779309) when updating this accessory.
   * Speeds: 1-33% (low), 34-67% (medium), 68-99% (high) and 100% ('auto' or 'ezfan'). 
* New [Wiki](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/wiki) page to help explain and create your `config.json`.
* <B>Homebridge Verified!!!</B>

### Other Changes

* Thermostat 'Fan Speed' `"linkedType"` is set to always appear on.
* If you do not opt into using fan speeds for the Fan and/or Thermostat; setting mode commands (`cool`/`heat`/`on`) will now default to the last known speed set in the Advantage Air app (low/medium/high/auto/'ezfan'). It used to always set to `auto` speed when changing modes.
* Removal of unused `statusFault` and redundant new code from `AdvAir.sh`.
* Streamlining and updates for the README. Moving of some information to the new Wiki.

### Bug Fixes

* Fix for Zone percentage (`brightness`) which would not send value to the controller if it was not rounded to 5%; value input now will round to the nearest 5%.
* Fix for users with 'ezfan' mode defaulting to 'high'; 'ezfan' mode now accepted as 100% speed.
* Dev Tests: Fix timeout issues with `server.js`.


## 3.0.3 (2021-12-29)

Welcome to our Homebridge UI integration!!! 

All the credit for this integration goes to the amazing John Talbot of [homebridge-cmd4](https://github.com/ztalbot2000/homebridge-cmd4); I seriously cannot thank him enough! While this is still not its own independent plug-in, this integration will mimic a 'full' plug-in for Homebridge UI. This includes prompts for updates to your scripts, no longer having to edit the script and a configuration check tool to make sure you are set up correctly. Please take a look at the [README](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/tree/master#readme) for more information.

### Other Changes

* Update `node` dependencies to run on all active LTS versions of `Node.js`; at the time of writing this is, `Node.js` v14 and v16. Preparation for `Homebridge Verified`.


## 3.0.2 (2021-12-23)

Welcome to our Homebridge UI integration!!! 

All the credit for this integration goes to the amazing John Talbot of [homebridge-cmd4](https://github.com/ztalbot2000/homebridge-cmd4); I seriously cannot thank him enough! While this is still not its own independent plug-in, this integration will mimic a 'full' plug-in for Homebridge UI. This includes prompts for updates to your scripts, no longer having to edit the script and a configuration check tool to make sure you are set up correctly. Please take a look at the [README](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/tree/master#readme) for more information.

### Bug Fixes

* Fix `Bug-Report` issue template not showing up.
* Fix broken links for NPM Badges on README.

### Other Changes

* Dev Tests: Combine `serverP1.js`, `serverP2.js` and `serverP3.js` into `server.js`.
* Update screenshots in README.


## 3.0.1 (2021-12-15)

Welcome to our Homebridge UI integration!!! 

All the credit for this integration goes to the amazing John Talbot of [homebridge-cmd4](https://github.com/ztalbot2000/homebridge-cmd4); I seriously cannot thank him enough! While this is still not its own independent plug-in, this integration will mimic a 'full' plug-in for Homebridge UI. This includes prompts for updates to your scripts, no longer having to edit the script and a configuration check tool to make sure you are set up correctly. Please take a look at the [README](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/tree/master#readme) for more information.

### Bug Fixes

* NPM packages will not allow packages to be published if they have upper case letters in the name.


## 3.0.0 (2021-12-15)

Welcome to our Homebridge UI integration!!! 

All the credit for this integration goes to the amazing John Talbot of [homebridge-cmd4](https://github.com/ztalbot2000/homebridge-cmd4); I seriously cannot thank him enough! While this is still not its own independent plug-in, this integration will mimic a 'full' plug-in for Homebridge UI. This includes prompts for updates to your scripts, no longer having to edit the script and a configuration check tool to make sure you are set up correctly. Please take a look at the [README](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/tree/master#readme) for more information.

### Breaking Changes

* Homebridge UI integration. While this change itself will not break your existing setup; the process of migrating over might while getting set up again if you make a mistake.
* IP address is removed from the `AdvAir.sh` script. It is now added as a constant in the `homebridge-cmd4` config and in `"state_cmd_suffix"` (see [Config_Samples](https://github.com/mitch7391/cmd4-AdvantageAir/tree/master/Config_Samples) directory). There is no longer a need for users to edit the script!

### Notable Changes

* [#9](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/issues/19): Add zone percentage control for users without temperature sensors. This is integrated as the Light Bulb acessory (see [Config_Samples](https://github.com/mitch7391/cmd4-AdvantageAir/tree/master/Config_Samples)).  

### Bug Fixes

* [#19](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/issues/19): Add `noSensors` variable to fix issue with Thermostat Get CurrentTemperature for users without temperature sensors.
* Side issue bug raised in [#9](https://github.com/mitch7391/homebridge-cmd4-AdvantageAir/issues/9): `noSensors` variable fixes issue with Thermostat Set CurrentTemperature for users without temperature sensors.

### Other Changes

* README updated: Update supported units, update screenshots, update and streamline installation instructions.
* Config samples updated: Update and streamline config samples. `noSensors` and `${IP}` added to `config.json`. Example added for users with some (but not all) zones using temperature sensors.
* Issue templates updated.
* PR template created.
* CHANGELOG created.
* Repo/Plug-in name changed from `cmd4-AdvantageAir` to `homebridge-cmd4-AdvantageAir`.
* Dev unit tests expanded and updated.


## 2.3.0 (2021-09-30)

### Notable Changes

* `config.json` changes to stop warnings in the upcoming homebridge-cmd4 v6.0.0 release.
* Characteristics now require the starting letter to be 'lower case' and not 'upper case'; this will pave the way for future work John Talbot puts in for cmd4 to have a `config-schema.json` in Homebridge UI.


## 2.2.0 (2021-09-15)

### Notable Changes

* Removed `stdbuf` dependency from scripts (could affect macOS user installs).
* Install instructions in `README` have been split into Raspbian and macOS installs; still no Windows install instructions.
* `IP Address` / `Port Number` at start of script has had the port number moved into the script commands; so users do not need to think they need to change the port number or figure it out themselves.


## 2.1.0 (2021-08-22)

### Notable Changes

* Addition of test scripts.


## 2.0.0 (2021-08-18)

### Breaking Changes

* New singular script `AdvAir.sh` to replace the need of two scripts `ezone.sh` and `zones.sh` ('Two Constant Zone' users will still have to use two scripts for now; sorry!).
* Better error handling and reporting; script will attempt 5 iterations to receive a valid reading from the control unit.
* Introduction and use of homebridge-cmd4's new `WoRm` (Write once Read many) queue designed by John Talbot to better handle interactions with Advantage Air control unit's limitations.

### Notable Changes

* Repo rename to `cmd4-AdvantageAir`; this is to more accurately capture the broader control units this API encompasses.
* Temperature Sensor Low Battery warning indications added.
* `config.json` improvements and clean-up.
* Documentation improvements in `README`.


## 1.2.0 (2021-02-08)

### Notable Changes

* New `config.json` examples added for the new polling methods of cmd4 v3.0.x.
* Updated `README`.

### Bug Fixes

* Fixed a couple of small bugs in shell scripts: use of `"true"` instead of `'1'` for `On` characteristic and double use of case `* )`.


## 1.1.0 (2021-01-22)

### Notable Changes

* Added shell scripts for users without Temperature Sensors.
* Issue templates added for `Bug Report`, `Feature Request` and `Support Request`.
* 'House Keeping' of directories for better navigation to shell scripts needed.
* Updated `README`.
