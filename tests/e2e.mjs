// End-to-end smoke test (flat-screen mode) using Playwright + Chromium.
//   node tests/e2e.mjs [--shots dir] [--full]
// 1. loads the page and checks for JS errors
// 2. navigates the 3D menu with real pointer clicks (library -> offline tab -> song -> play)
// 3. plays the built-in song with ?autoplay=1 and checks hits / results screen
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import server from '../tools/serve.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = await import('playwright')); }

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const full = args.includes('--full');
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
if (!server.listening) await new Promise((r) => server.once('listening', r));
const port = server.address().port;
const base = `http://localhost:${port}/`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
let failures = 0;
function check(cond, msg) { console.log((cond ? '  ok  ' : '  FAIL ') + msg); if (!cond) failures++; }

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { page, errors };
}

// Project a panel-pixel coordinate to a screen coordinate.
async function panelToScreen(page, u, v) {
  return page.evaluate(([u, v]) => {
    const app = window.__bt;
    const p = app.panel;
    const THREE_V = p.hit.point.constructor;
    const local = new THREE_V((u / p.pxW - 0.5) * p.worldW, (0.5 - v / p.pxH) * p.worldH, 0);
    p.mesh.updateMatrixWorld();
    local.applyMatrix4(p.mesh.matrixWorld);
    local.project(app.camera);
    return { x: (local.x + 1) / 2 * innerWidth, y: (1 - local.y) / 2 * innerHeight };
  }, [u, v]);
}

async function clickPanel(page, u, v) {
  const s = await panelToScreen(page, u, v);
  await page.mouse.move(s.x, s.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

try {
  // ---------- 1+2: menu navigation ----------
  {
    const { page, errors } = await newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bt && document.body.classList.contains('ready'), null, { timeout: 20000 });
    await page.waitForTimeout(800);
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '01-overlay.png') });
    await page.click('#btn-flat');
    await page.waitForTimeout(600);
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '02-main-menu.png') });
    check(await page.evaluate(() => window.__bt.menu.screen === 'main'), 'main menu shown');
    await clickPanel(page, 640, 215); // JOGAR
    check(await page.evaluate(() => window.__bt.menu.screen === 'library'), 'library opened via pointer click');
    // wait for BeatSaver results (network may be unavailable: tolerate)
    await page.waitForFunction(() => { const l = window.__bt.menu.lib; return !l.loading; }, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const lib = await page.evaluate(() => ({ n: window.__bt.menu.lib.items.length, err: window.__bt.menu.lib.error }));
    console.log('       BeatSaver items:', lib.n, lib.err ? 'error: ' + lib.err : '');
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '03-library.png') });
    // offline tab is the 5th tab
    const tabX = 640 - (5 * 212 - 12) / 2 + 4 * 212 + 100;
    await clickPanel(page, tabX, 140);
    check(await page.evaluate(() => window.__bt.menu.lib.tab === 'offline'), 'offline tab selected');
    await clickPanel(page, 640, 238); // first row
    check(await page.evaluate(() => window.__bt.menu.screen === 'detail'), 'detail opened');
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '04-detail.png') });
    await clickPanel(page, 1280 - 230, 725); // JOGAR
    await page.waitForFunction(() => ['countdown', 'playing'].includes(window.__bt.state), null, { timeout: 20000 });
    check(true, 'song started from menu');
    await page.waitForTimeout(6000);
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '05-gameplay.png') });
    // pause with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check(await page.evaluate(() => window.__bt.state === 'paused'), 'Esc pauses');
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '06-pause.png') });
    check(errors.length === 0, 'no JS errors (' + errors.join(' | ') + ')');
    await page.close();
  }

  // ---------- 3: full autoplay run ----------
  if (full) {
    const { page, errors } = await newPage();
    await page.goto(base + '?demo=Normal&autoplay=1', { waitUntil: 'load' });
    const t0 = Date.now();
    if (shotsDir) {
      for (const [at, name] of [[24, '08-drop'], [47, '09-walls']]) {
        await page.waitForFunction((t) => window.__bt && window.__bt.state === 'playing' && window.__bt.game.songTime > t, at, { timeout: 120000, polling: 50 });
        await page.screenshot({ path: path.join(shotsDir, name + '.png') });
      }
    }
    await page.waitForFunction(() => window.__bt && window.__bt.state === 'results', null, { timeout: 180000, polling: 1000 });
    console.log('       played in', ((Date.now() - t0) / 1000).toFixed(1), 's');
    const r = await page.evaluate(() => window.__bt.lastResult);
    console.log('       result:', JSON.stringify(r));
    const log = await page.evaluate(() => window.__bt.game.hitLog || []);
    const avg = (k) => (log.reduce((a, h) => a + (typeof h[k] === 'boolean' ? +h[k] : h[k]), 0) / Math.max(1, log.length)).toFixed(2);
    console.log('       avg pts', avg('pts'), 'speed', avg('speed'), 'center', avg('center'), 'dirOk', avg('dirOk'));
    check(!r.failed, 'song completed');
    check(r.hits / r.totalNotes > 0.85, 'autoplay hit rate ' + (r.hits / r.totalNotes * 100).toFixed(1) + '%');
    check(r.score > 0, 'score > 0');
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '07-results.png') });
    check(errors.length === 0, 'no JS errors (' + errors.join(' | ') + ')');
    await page.close();
  }
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? failures + ' failure(s)' : 'all e2e checks passed');
process.exit(failures ? 1 : 0);
