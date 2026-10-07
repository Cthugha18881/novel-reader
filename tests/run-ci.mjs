// รันชุดทดสอบใน Chromium แบบไม่มีหน้าจอ (ใช้ใน GitHub Actions ก่อน deploy)
// 1) tests/index.html: unit test ทั้งหมดต้องผ่าน
// 2) index.html: เปิดแอพจริงแล้วต้องไม่มี JavaScript error และหน้าต้อนรับต้องขึ้น
// วิธีรันเอง: npm install --no-save playwright && npx playwright install chromium && node tests/run-ci.mjs
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon'
};

// เซิร์ฟเวอร์ไฟล์เล็กๆ (ไม่ต้องลงแพ็กเกจเพิ่ม) อ่านได้เฉพาะไฟล์ในโฟลเดอร์โปรเจกต์
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// CI: ใช้ Google Chrome ที่ติดตั้งมากับเครื่อง GitHub (PW_CHROME_CHANNEL=chrome) ไม่ต้องดาวน์โหลด Chromium ทุกรอบ
// ถ้าเปิดไม่ได้ ใช้ Chromium ของ Playwright แทน
const channel = process.env.PW_CHROME_CHANNEL || '';
let browser;
try {
  browser = await chromium.launch(channel ? { channel } : {});
} catch (err) {
  if (!channel) throw err;
  console.log(`เปิด ${channel} ไม่ได้ (${err.message.split('\n')[0]}) ใช้ Chromium ของ Playwright แทน`);
  browser = await chromium.launch();
}
let failed = false;

async function openPage(url) {
  // context ใหม่ทุกครั้ง: IndexedDB / localStorage ว่างเหมือนผู้ใช้ใหม่
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  // ห้ามออกอินเทอร์เน็ต (AI / r.jina.ai / ฟอนต์): ทดสอบต้องไม่พึ่งเครือข่าย
  await page.route(url => !url.href.startsWith(base), route => route.abort());
  await page.goto(base + url, { waitUntil: 'load' });
  return { page, context, errors };
}

// ---------- 1) unit tests ----------
{
  const { page, context, errors } = await openPage('/tests/index.html');
  await page.waitForFunction(() => Array.isArray(window.__testResults), null, { timeout: 60000 });
  const results = await page.evaluate(() => window.__testResults);
  const bad = results.filter(r => !r.ok);
  console.log(`unit tests: ${results.length - bad.length}/${results.length} passed`);
  bad.forEach(r => console.log(`  ✗ ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
  if (bad.length || !results.length) failed = true;
  const pageErrors = errors.filter(e => e.startsWith('pageerror'));
  if (pageErrors.length) { failed = true; pageErrors.forEach(e => console.log(`  ✗ ${e}`)); }
  await context.close();
}

// ---------- 2) app smoke test ----------
{
  const { page, context, errors } = await openPage('/index.html');
  try {
    await page.waitForSelector('.welcome', { timeout: 20000 });
    const title = await page.title();
    const ok = await page.evaluate(() => ({
      dialogs: typeof appConfirm === 'function',
      home: typeof openHome === 'function',
      brand: document.querySelector('.brand-title')?.textContent || ''
    }));
    console.log(`app smoke: title="${title}" brand="${ok.brand}"`);
    if (!ok.dialogs || !ok.home) { failed = true; console.log('  ✗ ฟังก์ชันหลักโหลดไม่ครบ'); }
    // เปิดหน้าต่างหลักทีละอัน ต้องไม่มี error
    await page.evaluate(async () => {
      openSettingsModal('ai');
      for (const tab of ['translate', 'reading', 'data', 'tools']) switchSettingsTab(tab);
      closeModal('settings-modal');
      await openGlossaryModal();
      closeModal('glossary-modal');
      await openHome();
      closeHome();
      openImportModal();
      closeModal('import-modal');
    });
  } catch (e) {
    failed = true;
    console.log(`  ✗ app smoke: ${e.message}`);
  }
  if (errors.length) { failed = true; errors.forEach(e => console.log(`  ✗ ${e}`)); }
  await context.close();
}

await browser.close();
server.close();
console.log(failed ? 'RESULT: FAILED' : 'RESULT: OK');
process.exit(failed ? 1 : 0);
