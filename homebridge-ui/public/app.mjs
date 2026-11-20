/* global window, document */
import { Draft, validate } from './draft.mjs';
import { DiscoverySession } from './discovery.mjs';

const api = window.homebridge;
api.disableSaveButton();
const status = document.getElementById('status');

try {
  const [config, schema] = await Promise.all([api.getPluginConfig(), api.getPluginConfigSchema()]);
  const draft = new Draft(config, api, message => {
    status.textContent = message.startsWith('Controller ') ? 'Complete the required controller settings before saving.' : message;
  });
  const properties = schema.schema.properties;
  const touched = new Set();
  // Discovery has its own state; it never updates Draft or the native Save controls.
  let discovery;

  function field(container, key, definition, platform = false) {
    const device = platform ? draft.block() : draft.block().devices[draft.selected];
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';
    const label = document.createElement('label');
    const input = document.createElement(definition.enum ? 'select' : 'input');
    input.id = (platform ? 'platform-' : 'controller-') + key;
    input.className = definition.type === 'boolean' ? 'form-check-input' : definition.enum ? 'form-select' : 'form-control';
    label.className = definition.type === 'boolean' ? 'hb-uix-switch' : 'form-label';
    label.htmlFor = input.id;
    label.textContent = definition.title;
    const required = !platform && properties.devices.items.required.includes(key);
    // The schema layout also marks the defaulted zone selector as required in the form.
    if (required || (!platform && key === 'zoneControlType')) {
      label.append(' *');
    }
    if (required) {
      input.required = true;
      input.setAttribute('aria-required', 'true');
    }
    if (definition.enum) {
      for (const [index, value] of definition.enum.entries()) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = ['Switch / Light', 'Lights', 'Fans'][index];
        input.append(option);
      }
    } else {
      input.type = definition.type === 'boolean' ? 'checkbox' : definition.type === 'integer' ? 'number' : 'text';
    }
    const value = device[key] ?? definition.default;
    if (definition.type === 'boolean') {
      input.checked = value === true;
    } else {
      input.value = value ?? '';
    }
    if (definition.minimum !== undefined) {
      input.min = definition.minimum;
      input.max = definition.maximum;
      input.step = '1';
    }
    input.addEventListener('input', () => {
      const value = definition.type === 'boolean' ? input.checked
        : definition.type === 'integer' ? (input.value === '' ? null : Number(input.value)) : input.value;
      void draft.edit(key, value, platform);
      discovery.changed();
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      showError();
      if (key === 'homeName') {
        // Event runs after all render functions have been initialized.
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        renderTabs();
      }
    });
    const feedback = document.createElement('div');
    feedback.id = input.id + '-error';
    feedback.className = 'invalid-feedback';
    feedback.setAttribute('aria-live', 'polite');
    const touchKey = String(draft.keys[draft.selected]) + ':' + (platform ? 'platform-' : '') + key;
    function showError() {
      const value = definition.type === 'boolean' ? input.checked
        : definition.type === 'integer' ? (input.value === '' ? null : Number(input.value)) : input.value;
      const error = platform ? '' : validate({ name: '', devices: [{ ipAddress: '192.0.2.1', [key]: value }] });
      const visible = touched.has(touchKey) && Boolean(error);
      feedback.textContent = visible ? error.replace(/^Controller 1: /, '') : '';
      feedback.classList.toggle('d-block', visible);
      input.classList.toggle('is-invalid', visible);
      input.setAttribute('aria-invalid', String(visible));
    }
    input.addEventListener('blur', () => {
      touched.add(touchKey);
      showError();
    });
    const hint = document.createElement('small');
    hint.className = 'form-text';
    hint.id = input.id + '-help';
    input.setAttribute('aria-describedby', hint.id + ' ' + feedback.id);
    const description = definition.description || '';
    const warningStart = key === 'linkZoneTemperatures' ? description.indexOf('Changing either Zone setting') : -1;
    hint.textContent = warningStart < 0 ? description : description.slice(0, warningStart).trim();
    if (definition.type === 'boolean') {
      const text = document.createElement('span');
      text.textContent = label.textContent;
      // Homebridge 5.30.0's schema patch adds this decorative switch to checkbox labels.
      const graphic = document.createElement('span');
      graphic.className = 'hb-uix-slider hb-uix-round';
      graphic.setAttribute('aria-hidden', 'true');
      label.replaceChildren(input, text, graphic);
      wrapper.append(label, hint);
    } else {
      wrapper.append(label, input, hint);
    }
    if (warningStart >= 0) {
      const warning = document.createElement('small');
      warning.id = input.id + '-warning';
      warning.className = 'd-block mt-2';
      warning.textContent = description.slice(warningStart);
      input.setAttribute('aria-describedby', hint.id + ' ' + warning.id + ' ' + feedback.id);
      wrapper.append(warning);
    }
    wrapper.append(feedback);
    showError();
    container.append(wrapper);
  }

  function renderThings() {
    const result = discovery.view(draft.keys[draft.selected], draft.block().devices?.[draft.selected]);
    const summary = result.status === 'loading' ? 'Reading saved controller settings…'
      : result.status === 'present' && result.things.length === 0 ? 'No Things reported in this observation.'
        : 'Discovery: ' + result.status + (result.reason ? ' (' + result.reason.replaceAll('-', ' ') + ')' : '');
    document.getElementById('inventory-label').textContent = summary
      + (result.observedAt ? ' — observed ' + new Date(result.observedAt).toLocaleTimeString() : '');
    const list = document.getElementById('inventory');
    list.replaceChildren();
    for (const thing of result.things) {
      const item = document.createElement('li');
      item.textContent = thing.name + ' — ' + thing.capability + ' — ' + thing.status;
      list.append(item);
    }
  }

  function renderTabs() {
    const tabs = document.getElementById('tabs');
    tabs.replaceChildren();
    (draft.block().devices || []).forEach((device, index) => {
      const key = draft.keys[index];
      const item = document.createElement('li');
      item.className = 'controller-tab' + (index === draft.selected ? ' active' : '');
      item.setAttribute('role', 'presentation');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-link' + (index === draft.selected ? ' active' : '');
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(index === draft.selected));
      button.setAttribute('aria-controls', 'controller');
      button.tabIndex = index === draft.selected ? 0 : -1;
      button.textContent = device.homeName || 'Controller ' + (index + 1);
      button.addEventListener('click', () => {
        draft.select(index);

        // Event runs after all render functions have been initialized.
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        render();
      });
      button.addEventListener('keydown', event => {
        const count = draft.keys.length;
        const next = event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count
          : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1;
        if (next >= 0) {
          event.preventDefault();
          draft.select(next);
          // eslint-disable-next-line @typescript-eslint/no-use-before-define
          render();
          tabs.querySelector('[aria-selected="true"]').focus();
        }
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tab-close';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove controller ' + (index + 1) + ': ' + button.textContent);
      remove.title = 'Remove from draft. Save applies removal; Close discards it.';
      remove.addEventListener('click', event => {
        event.stopPropagation();
        void draft.removeController(key);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        render();
        (tabs.querySelector('[aria-selected="true"]') || tabs.lastElementChild.querySelector('button')).focus();
      });
      item.append(button, remove);
      tabs.append(item);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'nav-link';
    add.textContent = 'Add Controller';
    add.addEventListener('click', () => {
      void draft.addController();
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      render();
      document.getElementById('controller-ipAddress').focus();
    });
    const addItem = document.createElement('li');
    addItem.setAttribute('role', 'presentation');
    addItem.append(add);
    tabs.append(addItem);
  }

  function render() {
    renderTabs();
    const controller = document.getElementById('controller');
    controller.replaceChildren();
    const devices = draft.block().devices || [];
    const definitions = properties.devices.items.properties;
    const rows = [['homeName'], ['ipAddress', 'port'], ['zoneControlType'], ['linkZoneTemperatures'], ['debug']];
    for (const keys of devices.length ? rows : []) {
      const row = document.createElement('div');
      row.className = 'row gx-3';
      for (const key of keys) {
        const column = document.createElement('div');
        column.className = key === 'ipAddress' ? 'col-12 col-md-9' : key === 'port' ? 'col-12 col-md-3'
          : ['homeName', 'zoneControlType'].includes(key) ? 'col-12 col-md-8' : 'col-12';
        field(column, key, definitions[key]);
        row.append(column);
      }
      if (keys.length === 2 || ['homeName', 'zoneControlType'].includes(keys[0])) {
        // Keep connection help readable rather than wrapping it into the narrow port column.
        const help = document.createElement('div');
        help.className = 'col-12 mb-3';
        for (const hint of row.querySelectorAll('.form-text')) {
          help.append(hint);
        }
        row.append(help);
      }
      controller.append(row);
    }
    const platform = document.getElementById('platform');
    platform.replaceChildren();
    if (draft.blockIndex >= 0) {
      field(platform, 'debug', properties.debug, true);
    }
    renderThings();
  }

  document.getElementById('things').addEventListener('toggle', event => draft.toggleThings(event.target.open));
  discovery = new DiscoverySession(config, draft.keys, (path, body) => api.request(path, body), renderThings);
  render();
  window.addEventListener('pagehide', () => discovery.close(), { once: true });
  void discovery.start();
} catch {
  api.disableSaveButton();
  status.textContent = 'Configuration could not be loaded safely. Close without saving and review the existing platform configuration.';
}
