/* global window, document */
import { Draft, validate, DraftStatusPresentation } from './draft.mjs';
import { DiscoverySession, ThingSelection, thingCards } from './discovery.mjs';

const api = window.homebridge;
api.disableSaveButton();
const status = document.getElementById('status');
const statusPresentation = new DraftStatusPresentation((message, progress) => {
  status.classList.toggle('draft-progress', progress);
  status.textContent = message;
});
window.addEventListener('pagehide', () => statusPresentation.close(), { once: true });

try {
  const [config, schema] = await Promise.all([api.getPluginConfig(), api.getPluginConfigSchema()]);
  const draft = new Draft(config, api, message => {
    statusPresentation.show(message.startsWith('Controller ') ? 'Complete the required controller settings before saving.' : message);
  });
  const properties = schema.schema.properties;
  const touched = new Set();
  // Discovery has its own state; it never updates Draft or the native Save controls.
  let discovery;
  const thingSelection = new ThingSelection();

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
    if (required || (!platform && ['zoneControlType', 'port'].includes(key))) {
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
    const focused = document.activeElement;
    const restoreFocus = document.getElementById('inventory').contains(focused) ? focused?.id : undefined;
    const result = discovery.view(draft.keys[draft.selected], draft.block().devices?.[draft.selected]);
    const summary = result.status === 'loading' ? 'Loading Things...'
      : result.status === 'present' ? (result.things.length ? '' : 'No Things found.')
        : result.status === 'partial' ? 'Some Things could not be identified. Saved settings are retained.'
          : result.status === 'absent' ? 'No Things reported. Saved settings are retained.'
            : 'Things are unavailable. Saved settings are retained.';
    const summaryLabel = document.getElementById('inventory-label');
    summaryLabel.textContent = summary;
    summaryLabel.hidden = !summary;
    const list = document.getElementById('inventory');
    list.replaceChildren();
    const controllerKey = draft.keys[draft.selected];
    const cards = thingCards(result, draft.block().devices?.[draft.selected]?.things);
    const selected = thingSelection.current(controllerKey, cards);
    const tabs = document.createElement('div');
    tabs.className = 'thing-tabs nav nav-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'MyPlace Things');
    const panel = document.createElement('section');
    panel.id = 'thing-card';
    panel.className = 'thing-card';
    panel.setAttribute('role', 'tabpanel');
    function selectThing(key) {
      thingSelection.choose(controllerKey, key);
      renderThings();
      const active = list.querySelector('[aria-selected="true"]');
      active?.focus({ preventScroll: true });
    }
    cards.forEach((thing, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.id = 'thing-tab-' + encodeURIComponent(thing.key);
      tab.className = 'nav-link' + (thing.key === selected ? ' active' : '');
      tab.textContent = thing.name + (cards.filter(t => t.name === thing.name).length > 1
        ? ' (' + thing.id + ', ' + thing.controllerId + ')' : '');
      tab.setAttribute('aria-label', thing.name + ' (Thing ' + thing.id + ', controller ' + thing.controllerId + ')');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(thing.key === selected));
      tab.setAttribute('aria-controls', panel.id);
      tab.tabIndex = thing.key === selected ? 0 : -1;
      tab.addEventListener('click', () => selectThing(thing.key));
      tab.addEventListener('keydown', event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % cards.length
          : event.key === 'ArrowLeft' ? (index + cards.length - 1) % cards.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : -1;
        if (next >= 0) {
          event.preventDefault();
          selectThing(cards[next].key);
        }
      });
      tabs.append(tab);
      if (thing.key !== selected) {
        return;
      }
      panel.setAttribute('aria-labelledby', tab.id);
      const heading = document.createElement('h3');
      heading.className = 'h5';
      heading.textContent = thing.name;
      const details = document.createElement('p');
      details.textContent = {
        'blind-capable': 'Blind', 'garage-gate-capable': 'Garage door or gate', 'relay-capable': 'Relay',
        'on-off-light-capable': 'Light', 'dimmable-light-capable': 'Dimmable light',
      }[thing.capability] || 'Device type unavailable';
      panel.append(heading, details);
      const problem = !thing.editable ? 'These settings cannot safely be edited. Existing settings are retained.'
        : thing.configurationStatus === 'incompatible type' ? 'The saved device type does not match this Thing.'
          : thing.discoveryStatus === 'unavailable' ? 'This Thing is unavailable. Saved settings are retained.' : '';
      if (problem) {
        const message = document.createElement('p');
        message.textContent = problem;
        panel.append(message);
      }
      const options = [
        ...((thing.capability === 'garage-gate-capable' || thing.override?.type) ? [['type', 'Garage/gate type']] : []),
        ['disabled', 'Disable Thing'],
        ['invert', 'Invert'],
      ];
      for (const [key, labelText] of options) {
        const label = document.createElement('label');
        label.className = 'd-block mb-2';
        const input = document.createElement(key === 'type' ? 'select' : 'input');
        input.id = 'thing-option-' + key;
        input.disabled = !thing.editable;
        if (key === 'type') {
          input.className = 'form-select';
          for (const [value, text] of [['', 'Garage door (default)'], ['garage-door', 'Garage door'], ['gate', 'Gate']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            input.append(option);
          }
          input.value = thing.override?.type || '';
        } else {
          input.type = 'checkbox';
          input.className = 'form-check-input';
          input.checked = thing.override?.[key] === true;
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'mb-3';
        label.htmlFor = input.id;
        if (key === 'type') {
          label.className = 'form-label';
          label.textContent = labelText;
          wrapper.append(label, input);
        } else {
          label.className = 'hb-uix-switch';
          const text = document.createElement('span');
          text.textContent = labelText;
          const graphic = document.createElement('span');
          graphic.className = 'hb-uix-slider hb-uix-round';
          graphic.setAttribute('aria-hidden', 'true');
          label.append(input, text, graphic);
          const hint = document.createElement('small');
          hint.className = 'form-text';
          hint.id = input.id + '-help';
          hint.textContent = key === 'disabled' ? 'Exclude this Thing from Apple Home.'
            : 'Reverse the reported on/off or open/closed states.';
          input.setAttribute('aria-describedby', hint.id);
          wrapper.append(label, hint);
        }
        input.addEventListener('change', () => {
          void draft.editThing(controllerKey, thing.controllerId, thing.id, key,
            key === 'type' ? input.value || undefined : input.checked);
          renderThings();
          document.getElementById(input.id)?.focus({ preventScroll: true });
        });
        panel.append(wrapper);
      }
    });
    const warnings = (result.things || []).filter(t => ['ambiguous-lighting', 'invalid-override', 'unsupported'].includes(t.status)).length;
    if (warnings || result.counts?.invalid || result.counts?.duplicate || result.counts?.unknown || result.counts?.invalidOverrides) {
      const warning = document.createElement('p');
      warning.className = 'small';
      warning.textContent = 'Discovery includes unsupported, ambiguous or invalid records. These are not operational; saved exceptions are retained.';
      list.append(warning);
    }
    list.append(tabs);
    if (cards.length) {
      list.append(panel);
    }
    if (restoreFocus) {
      (document.getElementById(restoreFocus) || tabs.querySelector('[aria-selected="true"]'))?.focus({ preventScroll: true });
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
  statusPresentation.show('Configuration could not be loaded safely. Close without saving and review the existing platform configuration.');
}
