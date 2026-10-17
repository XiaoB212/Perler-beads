// 多状态 × 多尺寸 截图复核
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

const OUT = resolve('.shots', 'review');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});

async function shoot(name, w, h, steps) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(name + ' PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' CONSOLE: ' + m.text()); });
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
  await sleep(1000);
  if (steps) await steps(page);
  await page.screenshot({ path: resolve(OUT, name + '.png') });
  await page.close();
}

const clickText = (sel, text) => (page) =>
  page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t));
    el?.click();
  }, sel, text);

await shoot('d1-home', 1440, 900);
await shoot('d2-usage', 1440, 900, async (p) => { await clickText('.side-tab', '用量')(p); await sleep(500); });
await shoot('d3-settings', 1440, 900, async (p) => { await clickText('.side-tab', '设置')(p); await sleep(500); });
await shoot('d4-export', 1440, 900, async (p) => { await clickText('.btn', '导出')(p); await sleep(900); });
await shoot('d5-colors', 1440, 900, async (p) => { await clickText('.rail-btn', '')(p); await p.evaluate(() => document.querySelectorAll('.rail-btn')[10]?.click()); await sleep(900); });
await shoot('d6-new', 1440, 900, async (p) => { await clickText('.btn', '新建')(p); await sleep(700); });
await shoot('d7-projects', 1440, 900, async (p) => { await clickText('.btn', '图纸')(p); await sleep(700); });
await shoot('d8-import', 1440, 900, async (p) => { await clickText('.btn', '图片转图纸')(p); await sleep(700); });

await shoot('m1-home', 390, 844);
await shoot('m2-sheet-colors', 390, 844, async (p) => { await p.evaluate(() => [...document.querySelectorAll('.mtool')].find(e => e.textContent.includes('颜色'))?.click()); await sleep(700); });
await shoot('m3-sheet-more', 390, 844, async (p) => { await p.evaluate(() => [...document.querySelectorAll('.mtool')].find(e => e.textContent.includes('更多'))?.click()); await sleep(700); });
await shoot('m4-export', 390, 844, async (p) => { await p.evaluate(() => [...document.querySelectorAll('.btn')].find(e => e.textContent.includes('导出'))?.click()); await sleep(900); });

await shoot('t1-home', 1024, 768);
await shoot('t2-home-land', 1180, 820);

console.log('=== ERRORS ===');
console.log(errors.length ? [...new Set(errors)].join('\n') : '(none)');
await browser.close();
