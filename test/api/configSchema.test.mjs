import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import test from 'node:test';

import { AdvantageAirClient } from '../../dist/api/advantageAirClient.js';
import { PLATFORM_NAME } from '../../dist/settings.js';
import { zoneLayout } from '../../dist/accessories/zoneLayout.js';

const config = JSON.parse(fs.readFileSync(new URL('../../config.schema.json', import.meta.url), 'utf8'));
const properties = config.schema.properties;
const controller = properties.devices.items;
const controllerFields = config.layout[1].items[0].items;

test('zone layouts are independent per-controller choices with Beta 2 defaults', () => {
  const type = controller.properties.zoneControlType;
  const link = controller.properties.linkZoneTemperatures;
  assert.deepEqual(type.enum, ['switch-light', 'lights', 'fans']);
  assert.equal(type.default, 'switch-light');
  assert.equal(type.title, 'Zone Control Type');
  assert.equal(link.type, 'boolean');
  assert.equal(link.default, false);
  assert.equal(link.title, 'Link Zone Temperatures');
  assert.equal(controller.required.includes('zoneControlType'), false);
  assert.equal(controller.required.includes('linkZoneTemperatures'), false);
  assert.match(type.description, /damper-opening/);
  assert.match(link.description, /supported temperature sensors/);
});

test('form-only selection requirement excludes None without invalidating omitted legacy settings', () => {
  const select = controllerFields.find(item => item.key === 'devices[].zoneControlType');
  // ng-formworks select passes options.required to buildTitleMap, which otherwise adds null/None.
  assert.deepEqual(select.options, { required: true });
  assert.deepEqual(select.titleMap.map(item => item.value), controller.properties.zoneControlType.enum);
  assert.deepEqual(select.titleMap.map(item => item.name), ['Switch / Light', 'Lights', 'Fans']);
  const require = createRequire(import.meta.url);
  const Ajv = require('ajv');
  const validate = new Ajv().compile(config.schema);
  const configFor = device => ({ name: 'Advantage Air', devices: [{ ipAddress: '192.0.2.1', ...device }] });
  const omitted = configFor({});
  assert.equal(validate(omitted), true);
  assert.equal(Object.hasOwn(omitted.devices[0], 'zoneControlType'), false);
  assert.deepEqual(zoneLayout(omitted.devices[0]), { type: 'switch-light', linkTemperatures: false });
  for (const type of ['switch-light', 'lights', 'fans']) {
    for (const linked of [true, false]) {
      const device = { zoneControlType: type, linkZoneTemperatures: linked };
      assert.equal(validate(configFor(device)), true);
      assert.deepEqual(zoneLayout(device), { type, linkTemperatures: linked });
    }
  }
  for (const type of [null, '', 'None', 'thermostat']) {
    assert.equal(validate(configFor({ zoneControlType: type })), false);
    assert.throws(() => zoneLayout({ zoneControlType: type }));
  }
});

test('zone warning stays in the linking description and the single controller section', () => {
  const tabs = config.layout[1];
  assert.equal(tabs.items.length, 1);
  assert.equal(tabs.items[0].type, 'section');
  assert.equal(controllerFields.some(item => item.type === 'help'), false);
  const warning = 'Changing either Zone setting may remove affected Apple Home scenes or automation actions.';
  assert.equal(controller.properties.linkZoneTemperatures.description,
    'For zones with supported temperature sensors, show readings within the corresponding zone controls ' +
    'instead of separate temperature accessories. Off by default; independent of Zone Control Type. ' + warning);
  assert.equal(JSON.stringify(config).split(warning).length - 1, 1);
  assert.equal(controllerFields[controllerFields.indexOf('devices[].linkZoneTemperatures') + 1], 'devices[].debug');
  assert.match(controller.properties.zoneControlType.description, /Save and restart the child bridge/);
});

test('native schema exposes controller setup without legacy or Homebridge-owned bridge settings', () => {
  assert.equal(config.pluginAlias, PLATFORM_NAME);
  assert.equal(config.pluginType, 'platform');
  assert.equal(config.singular, true);
  assert.equal(config.strictValidation, false);
  assert.equal(config.customUi, undefined);
  assert.deepEqual(Object.keys(properties).sort(), ['debug', 'devices', 'name']);
  assert.deepEqual(Object.keys(controller.properties).sort(), [
    'debug', 'excludedLightIds', 'homeName', 'ipAddress', 'linkZoneTemperatures', 'name', 'port', 'zoneControlType',
  ]);
  assert.deepEqual(controller.required, ['ipAddress']);
  assert.equal(properties.devices.minItems, 1);
});

test('schema address and port defaults match the existing native client contract', () => {
  const port = controller.properties.port;
  assert.equal(port.default, 2025);
  assert.equal(port.minimum, 1);
  assert.equal(port.maximum, 65535);
  assert.equal(port.type, 'integer');
  assert.equal(controller.properties.ipAddress.format, 'ipv4');
  assert.doesNotThrow(() => new AdvantageAirClient({ ipAddress: '192.0.2.1' }));
  for (const value of [port.minimum, port.default, port.maximum]) {
    assert.doesNotThrow(() => new AdvantageAirClient({ ipAddress: '192.0.2.1', port: value }));
  }
  for (const value of [0, 65536, 2025.5]) {
    assert.throws(() => new AdvantageAirClient({ ipAddress: '192.0.2.1', port: value }));
  }
});

test('optional controller label and debug help reflect native runtime behaviour', () => {
  assert.equal(controller.properties.name.default, undefined);
  assert.equal(controller.properties.debug.default, false);
  assert.match(controller.properties.name.description, /Controller 1/);
  assert.match(controller.properties.name.description, /does not rename/);
  assert.match(controller.properties.debug.description, /No Homebridge Debug Mode required/);
});


test('standard layout hides retained labels, uses controller tabs and a numeric port, then global debug', () => {
  assert.match(config.headerDisplay, /v4-beta\/assets\/settings-header.png/);
  assert.match(config.headerDisplay, /Advantage Air Device Settings/);
  assert.deepEqual(config.layout[0], { key: 'name', type: 'hidden', htmlClass: 'd-none' });
  const tabs = config.layout[1];
  assert.equal(tabs.type, 'tabarray');
  assert.equal(tabs.key, 'devices');
  assert.deepEqual(controllerFields, [
    { key: 'devices[].name', type: 'hidden', htmlClass: 'd-none' }, 'devices[].homeName', 'devices[].ipAddress',
    { key: 'devices[].port', type: 'number' },
    { key: 'devices[].zoneControlType', type: 'select', options: { required: true }, titleMap: [
      { value: 'switch-light', name: 'Switch / Light' }, { value: 'lights', name: 'Lights' }, { value: 'fans', name: 'Fans' },
    ] },
    'devices[].linkZoneTemperatures', 'devices[].debug',
  ]);
  assert.equal(tabs.title, '{{ value.homeName || \'Controller\' }}');
  assert.deepEqual(config.layout[2], { type: 'fieldset', notitle: true,
    htmlClass: 'mt-4 border-top pt-3', items: ['debug'] });
  assert.match(properties.debug.description, /No Homebridge Debug Mode required/);
  assert.equal(controller.properties.homeName.default, 'Aircon');
  assert.equal(properties.devices.maxItems, undefined);
  assert.equal(properties.debug.default, false);
  assert.equal(controller.properties.name.default, undefined, 'Do not fill in an absent legacy controller label.');
  assert.equal(properties.name.default, 'Homebridge Advantage Air');
  assert.doesNotThrow(() => new AdvantageAirClient({ ipAddress: '192.0.2.1', port: 10211 }));
});

// Homebridge UI uses this explicit layout; '*' would regenerate schema controls.
// Form values are schema-derived independently of layout (ng-formworks), so keep
// the optional array schema intact rather than converting it to a hidden input.
test('JSON-only light exclusions stay in the schema without any generated form controls', () => {
  const keys = [];
  const visit = items => {
    for (const item of items) {
      if (typeof item === 'string') {
        keys.push(item);
      } else {
        if (item.key) {
          keys.push(item.key);
        }
        if (item.items) {
          visit(item.items);
        }
      }
    }
  };
  visit(config.layout);
  assert.equal(keys.some(key => key.includes('excludedLightIds') || key.includes('*')), false);
  assert.deepEqual(controller.properties.excludedLightIds, {
    title: 'Excluded MyPlace light IDs (optional)',
    description: 'Leave empty to discover all light outputs. Use controller light IDs, not names.',
    type: 'array',
    uniqueItems: true,
    items: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
  });
  assert.equal(controller.required.includes('excludedLightIds'), false);
  assert.equal(controller.properties.excludedLightIds.default, undefined);
});
