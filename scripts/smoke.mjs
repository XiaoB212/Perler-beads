// 用本机 Chrome 做 UI 冒烟测试：截图各面板 + 收集控制台错误
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('.shots');
mkdirSync(OUT, { recursive: true });

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.APP_URL || 'http://127.0.0.1:5173/';

const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1'],
});

async function shot(page, name) {
  await page.screenshot({ path: resolve(OUT, name + '.png') });
  console.log('shot:', name);
}

async function clickText(page, text) {
  const ok = await page.evaluate((t) => {
    const els = [...document.querySelectorAll('button, a, .swatch, .tbar-chip, .side-tab')];
    const el = els.find((e) => (e.textContent || '').trim().includes(t) && e.offsetParent !== null);
    if (!el) return false;
    el.click();
    return true;
  }, text);
  if (!ok) console.log('!! not found:', text);
  await sleep(400);
  return ok;
}

const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.setViewport({ width: 1440, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle2' });
await sleep(900);
await shot(page, 'p01-home');

// 打开图片转图纸
await clickText(page, '图片转图纸');
await sleep(700);
await shot(page, 'p02-import');
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.dialog-close, .overlay')][0];
  if (b) b.click();
});
await sleep(400);

// 导出
await clickText(page, '导出');
await sleep(700);
await shot(page, 'p03-export');
await page.evaluate(() => document.querySelector('.overlay')?.click());
await sleep(400);

// 色号管理
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.rail-btn')].find((e) => e.title === '色号管理');
  el?.click();
});
await sleep(600);
await shot(page, 'p04-colors');
await page.evaluate(() => document.querySelector('.overlay')?.click());
await sleep(400);

// 我的图纸
await clickText(page, '图纸');
await sleep(600);
await shot(page, 'p05-projects');
await page.evaluate(() => document.querySelector('.overlay')?.click());
await sleep(400);

// 新建
await clickText(page, '新建');
await sleep(600);
await shot(page, 'p06-new');
await page.evaluate(() => document.querySelector('.overlay')?.click());
await sleep(400);

// 用量面板
await clickText(page, '用量');
await sleep(500);
await shot(page, 'p07-usage');

// 设置面板
await clickText(page, '设置');
await sleep(500);
await shot(page, 'p08-settings');

// 画布上画几笔
await clickText(page, '颜色');
await sleep(300);
await page.evaluate(() => {
  const s = [...document.querySelectorAll('.swatch')];
  s[12]?.click();
});
await sleep(300);
const box = await page.evaluate(() => {
  const c = document.querySelector('.stage-canvas');
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(box.x + box.w / 2 - 60, box.y + box.h / 2);
await page.mouse.down();
for (let i = 0; i < 12; i++) {
  await page.mouse.move(box.x + box.w / 2 - 60 + i * 9, box.y + box.h / 2 + Math.sin(i / 2) * 26);
  await sleep(16);
}
await page.mouse.up();
await sleep(500);
await shot(page, 'p09-drawn');

// 进度模式
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.rail-btn')].find((e) => e.title?.includes('进度模式'));
  el?.click();
});
await sleep(300);
await page.mouse.move(box.x + box.w / 2 - 40, box.y + box.h / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.w / 2 + 40, box.y + box.h / 2);
await page.mouse.up();
await sleep(400);
await shot(page, 'p10-progress');

// 撤销
await page.keyboard.down('Control');
await page.keyboard.press('KeyZ');
await page.keyboard.up('Control');
await sleep(300);

// 移动端
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(800);
await shot(page, 'p11-mobile');
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.mtool')].find((e) => (e.textContent || '').includes('颜色'));
  el?.click();
});
await sleep(600);
await shot(page, 'p12-mobile-sheet');

// 平板
await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
await sleep(800);
await shot(page, 'p13-tablet');

console.log('\n=== ERRORS ===');
console.log(errors.length ? errors.join('\n') : '(none)');

await browser.close();
