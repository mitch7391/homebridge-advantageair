// Browser checks against the explicitly simulated host, not Homebridge acceptance.
import assert from 'node:assert/strict';
import process from 'node:process';
/* global window, document, structuredClone */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const root = new URL('../../', import.meta.url);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://prototype.invalid') {
      return route.abort();
    }
    const file = url.pathname === '/' ? 'dev/ui-prototype/preview.html' : url.pathname.slice(1);
    if (!['dev/ui-prototype/preview.html', 'config.schema.json', ...['index.html', 'app.mjs', 'draft.mjs', 'settings-header.png']
      .map(name => 'homebridge-ui/public/' + name)].includes(file)) {
      return route.abort();
    }
    await route.fulfill({ body: await readFile(new URL(file, root)),
      contentType: file.endsWith('.png') ? 'image/png' : file.endsWith('.mjs') ? 'text/javascript'
        : file.endsWith('.json') ? 'application/json' : 'text/html' });
  });
  await page.goto('http://prototype.invalid/');
  const ui = page.frameLocator('#ui');
  await ui.locator('#controller-ipAddress').waitFor();
  assert.equal(await ui.locator('#things').getAttribute('open'), null);
  const initial = await page.evaluate(() => window.prototypeApi.getPluginConfig());
  await ui.locator('#things summary').click();
  assert.match(await ui.locator('#inventory').innerText(), /Bedroom blind/);
  await ui.getByRole('tab', { name: 'Things Only', exact: true }).click();
  assert.match(await ui.locator('#inventory').innerText(), /Garden output/);
  assert.doesNotMatch(await ui.locator('#inventory').innerText(), /Bedroom blind/);
  assert.equal(await ui.locator('#controller-port').inputValue(), '10211');
  assert.deepEqual(await page.evaluate(() => window.prototypeApi.getPluginConfig()), initial);
  await ui.locator('#controller-homeName').fill('Updated Things');
  await ui.getByRole('tab', { name: 'Main Home', exact: true }).click();
  await ui.locator('#controller-port').fill('10211');
  await page.waitForFunction(() => !document.getElementById('save').disabled);
  const changed = await page.evaluate(() => window.prototypeApi.getPluginConfig());
  const expected = structuredClone(initial);
  expected[0].devices[1].homeName = 'Updated Things';
  expected[0].devices[0].port = 10211;
  assert.deepEqual(changed, expected);
  await page.locator('#save').click();
  await ui.locator('#controller-port').waitFor();
  assert.equal(await ui.locator('#controller-port').inputValue(), '10211');
  await ui.locator('#controller-ipAddress').fill('999.2.3.4');
  assert.equal(await page.locator('#save').isDisabled(), true);
  await page.locator('#cancel').click();
  await ui.locator('#controller-ipAddress').waitFor();
  assert.equal(await ui.locator('#controller-ipAddress').inputValue(), '192.0.2.1');
  assert.deepEqual(await page.evaluate(() => window.prototypeApi.getPluginConfig()), expected);
  await ui.locator('#things summary').click();
  if (process.env.SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  }
  assert.deepEqual(errors, []);
  process.stdout.write('PASS: browser layout, isolated inventories, untouched JSON, tab edits, port, simulated Save/reopen and Cancel.\n');
} finally {
  await browser.close();
}
