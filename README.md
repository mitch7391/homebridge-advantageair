<p align="center">
  <img src="https://raw.githubusercontent.com/mitch7391/homebridge-advantageair/v4-beta/assets/settings-header.png" alt="Homebridge and Advantage Air" width="640">
</p>

<h1 align="center">Homebridge Advantage Air</h1>

<p align="center">
  <strong>The original Homebridge integration for Advantage Air systems.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-advantageair"><img src="https://img.shields.io/npm/v/homebridge-advantageair/beta?label=npm%20beta" alt="npm beta version"></a>
  <img src="https://img.shields.io/badge/status-beta%20software-blue" alt="Beta software">
  <a href="https://www.paypal.com/donate/?business=FWN5P4BP7NJT4&no_recurring=1&item_name=Shout+me+a+coffee+%3A%29&currency_code=AUD"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Donate-orange" alt="Buy Me a Coffee"></a>
  <a href="https://github.com/mitch7391/homebridge-advantageair/discussions"><img src="https://img.shields.io/badge/GitHub-Discussions-blue?logo=github" alt="GitHub Discussions"></a>
</p>

Bring compatible Advantage Air air conditioning systems and the MyPlace ecosystem into Apple Home. Building on the original Cmd4-based integration, this plugin offers a native Homebridge implementation with automatic accessory discovery and simpler configuration.

*This is an independent community project and is not affiliated with or endorsed by Advantage Air.*

> [!IMPORTANT]
> **Beta software:** Native v4 is prerelease software, and broader hardware compatibility is still being confirmed. Install only a version announced by the maintainer. [Read the beta testing and backup guidance](https://github.com/mitch7391/homebridge-advantageair/blob/master/docs/beta1-testing.md) before getting started.
>
> Share successful installations and problems in the [Beta Testing & Feedback](https://github.com/mitch7391/homebridge-advantageair/discussions/categories/beta-testing-feedback).

## Supported Control Units

### Air Conditioning

e-zone · MyAir · MyAir4 · MyAir5  
MyPlace · zone10e · Fujitsu anywAIR

*These systems were supported by the original v3 plugin. Native v4 compatibility is being reconfirmed, with **e-zone** as the primary physically tested system. **zone10** and **MyAir3** were not known to work with v3 and remain unconfirmed. Share your results in [GitHub Discussions](https://github.com/mitch7391/homebridge-advantageair/discussions).*

### MyPlace Extras

Automatically discovers individual MyPlace lights:

- **Relay lights:** On/Off control.
- **Dimmer lights:** On/Off and Brightness control (0-100%).

**Not currently supported in this version:** Garage doors, gates, blinds, windows, motion sensors and other MyPlace Things, plus plugin-managed light groups or scenes. Compatible lights can still be used in Apple Home scenes.

## How It Looks

### Air Conditioning

*Native thermostat with linked fan-speed control.*

<p align="center">
  <img src="https://raw.githubusercontent.com/mitch7391/homebridge-advantageair/master/assets/aircon-thermostat-control-interface.png" alt="Advantage Air thermostat with linked fan-speed control in Apple Home" width="340">
</p>

### Zone Control

*With temperature sensors and without temperature sensors.*

<p align="left">
  <img src="https://raw.githubusercontent.com/mitch7391/homebridge-advantageair/master/assets/zone-with-sensors.png" alt="Zone control with temperature sensors" height="610">
  <img src="https://raw.githubusercontent.com/mitch7391/homebridge-advantageair/master/assets/zone-without-sensors.png" alt="Sensorless percentage-based zone control" height="610">
  <img src="https://raw.githubusercontent.com/mitch7391/homebridge-advantageair/master/assets/zone-percentage-control.png" alt="Adjustable percentage zone in Apple Home" height="610">
</p>

#### Optional Zone Layouts

*In development for an upcoming beta; not included in published Beta 2.*

Choose how zones appear in Apple Home using **Zone Control Type** in each controller's Homebridge plugin settings:

| Layout | Zones with temperature sensors | Sensorless percentage zones |
| --- | --- | --- |
| Switch / Light (default) | Switch: On/Off | Lightbulb: On/Off and Brightness |
| Lights | Lightbulb: On/Off | Lightbulb: On/Off and Brightness |
| Fans | Fan: On/Off | Fan: On/Off and Rotation Speed |

For zones without temperature sensors, the **Brightness** or **Rotation Speed** slider adjusts how far the zone damper opens (0-100%). These Apple Home controls represent damper position rather than actual light brightness or air conditioner fan speed.

Enable **Link Zone Temperatures** to show readings from supported zone temperature sensors within their corresponding controls instead of separate temperature accessories. This works independently of the chosen layout and is off by default. Sensorless zones do not gain temperature sensors, and sensor-equipped controls do not gain damper-opening sliders.

Save settings and restart the Advantage Air child bridge (or Homebridge if not using a child bridge). Existing configurations keep **Switch / Light** with separate temperatures; no layout change is required.

> [!WARNING]
> Back up Homebridge before changing zone control types or temperature linking. Affected scene and automation actions can be removed; scenes containing only affected zones may be deleted. You may need to recreate them. Zone accessory identities are retained without removing or re-pairing accessories. Room assignments were retained in e-zone hardware testing, and a scene and automation survived an unchanged restart. See the [layout and migration guidance](docs/v3-migration.md#zone-layout-options-development-not-included-in-published-beta-2) and [hardware evidence and limitations](docs/beta1-testing.md#zone-layout-hardware-acceptance--26-october-2026).

### Additional Controls

*Grouped MyZone selection and the native countdown timer.*

<p align="left">
  <img src="https://raw.githubusercontent.com/mitch7391/homebridge-advantageair/master/assets/aircon-myzone-overview.png" alt="Grouped MyZone selection switches in Apple Home" height="610">
  <img src="https://raw.githubusercontent.com/mitch7391/homebridge-advantageair/master/assets/aircon-timer-control.png" alt="Native air conditioning timer with adjustable duration" height="610">
</p>

### MyPlace Lighting

*Individual relay lights (On/Off) and dimmer lights (Brightness).*

<p align="left">
  <img src="https://raw.githubusercontent.com/mitch7391/homebridge-advantageair/master/assets/myplace-lights-overview.png" alt="MyPlace lighting accessories in Apple Home" height="610">
  <img src="https://raw.githubusercontent.com/mitch7391/homebridge-advantageair/master/assets/myplace-lights-controls.png" alt="MyPlace dimmer and relay light controls" height="610">
</p>

## Installation

Getting started with Homebridge Advantage Air:

1. **Install the plugin:** Search for `homebridge-advantageair` in the Homebridge UI and install the announced beta version.
2. **Configure your controller:** Enter your Advantage Air controller's IP address and choose a name for your system.

3. **Set up a Child Bridge (optional):** Use Homebridge's built-in Child Bridge feature to run Advantage Air independently of your other plugins.

4. **Save and restart:** Restart Homebridge or the Child Bridge as prompted to discover your supported accessories.
5. **Add to Apple Home:** Pair a new Child Bridge using the QR code provided by Homebridge, if needed, then arrange your discovered accessories in Apple Home.

**Upgrading from v3?** Migration is optional. Native v4 is a **separate plugin** and does not automatically migrate existing HomeKit accessories, rooms or automations. Do not replace or uninstall your Cmd4 setup without reading the [v3 Migration Guide](https://github.com/mitch7391/homebridge-advantageair/blob/master/docs/v3-migration.md).

**Compatibility:** Native v4 requires a supported Node.js 22 or 24 release and Homebridge 1.8.x or 2.x. Check the [beta testing guide](https://github.com/mitch7391/homebridge-advantageair/blob/master/docs/beta1-testing.md) for exact versions, backups and known limitations.

## Further Notes

For additional configuration information, troubleshooting and compatibility details, please visit the [Wiki](https://github.com/mitch7391/homebridge-advantageair/wiki) and [Documentation](https://github.com/mitch7391/homebridge-advantageair/tree/master/docs).

**Useful Guides:**

- [Getting Started & Beta Testing](https://github.com/mitch7391/homebridge-advantageair/blob/master/docs/beta1-testing.md)
- [Migrating from v3](https://github.com/mitch7391/homebridge-advantageair/blob/master/docs/v3-migration.md)
- [Diagnostics & Troubleshooting](https://github.com/mitch7391/homebridge-advantageair/blob/master/docs/diagnostics.md)

> [!NOTE]
> This is a community-driven beta. Some historically supported controller configurations and physical MyPlace devices still need real-world confirmation. Keep your original controller app available and follow the manufacturer's normal operating safeguards.

## How You Can Help

This project has grown over the years thanks to the support, feedback and contributions of the Homebridge community. Whether you're a long-time user or just getting started, there are plenty of ways to get involved!

- **Join the Discussion:** Visit [GitHub Discussions](https://github.com/mitch7391/homebridge-advantageair/discussions) to ask questions, share your setup, exchange ideas and help other users.
- **Report Bugs:** Found something that isn't working? Open a [GitHub Issue](https://github.com/mitch7391/homebridge-advantageair/issues) with the details so we can investigate.
- **Test Compatibility:** Help confirm support for different Advantage Air controllers, firmware versions and MyPlace accessories. Successful test results are just as valuable as bug reports!
- **Suggest Improvements:** Have an idea for a new feature or improvement? We'd love to hear it in Discussions.
- **Contribute Code:** Developers are welcome to contribute fixes and improvements through Pull Requests.
- **Show Your Support:** If you enjoy the plugin, consider giving the repository a ⭐ on GitHub, or [shouting me a coffee](https://www.paypal.com/donate/?business=FWN5P4BP7NJT4&no_recurring=1&item_name=Shout+me+a+coffee+%3A%29&currency_code=AUD)!

This is a community-driven project maintained in spare time. Contributions and helping fellow users are always appreciated, but response times may vary. Donations are entirely optional and don't provide priority support.

## Special Thanks

This project wouldn't be where it is today without the kindness, knowledge and contributions of some wonderful people along the way.

- **[John Talbot](https://github.com/ztalbot2000):** For his incredible dedication to [homebridge-cmd4](https://github.com/ztalbot2000/homebridge-cmd4), and the countless improvements, guidance and contributions that helped bring the original Advantage Air integration to life. His generosity with his time and expertise, and above all, his friendship, have been invaluable throughout this journey.

- **[Ung Sing Wong](https://github.com/uswong):** For his extensive programming knowledge and contributions to the original plugin, helping implement many of the features and improvements I'd envisioned, and for carrying the torch over the past two years through his own MyPlace integration.

- **[TimofeyK](https://github.com/TimofeyK):** For his patience, encouragement and willingness to help someone with very little programming experience take those first steps. Without that early support, this project may never have gotten off the ground.

- **My wonderful wife, Sarah:** For her endless patience and understanding as this little project grew into something of an obsession over the years. And, of course, for continuing to be misunderstood by Siri for my amusement!

- **My little Toads:** For always keeping me on my toes, and for giving me two very good reasons to find a better balance between the projects I love and the people I love even more.

A heartfelt thank you also goes to everyone who has tested, contributed, shared feedback or simply enjoyed using the plugin over the years. Your support has made this project a genuinely rewarding experience.

For a look back at the original Cmd4-based implementation and its history, see the [v3 README](https://github.com/mitch7391/homebridge-advantageair/blob/master/README-v3.md).

## Licence

This project is distributed under the [MIT Licence](https://github.com/mitch7391/homebridge-advantageair/blob/master/LICENSE).
