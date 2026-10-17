// 第三轮复核：成本面板、拖拽、移动端空状态、三端布局
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

const OUT = resolve('.shots', 'review3');
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
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(name + ' CONSOLE: ' + m.text());
  });
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
  await sleep(1100);
  if (steps) await steps(page);
  await page.screenshot({ path: resolve(OUT, name + '.png') });
  await page.close();
}

const clickText = (sel, text) => (page) =>
  page.evaluate(
    (s, t) => {
      const el = [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t));
      el?.click();
    },
    sel,
    text,
  );

// 桌面
await shoot('d1-home', 1440, 900);
await shoot('d2-usage', 1440, 900, async (p) => {
  await clickText('.side-tab', '用量')(p);
  await sleep(400);
});
await shoot('d3-cost', 1440, 900, async (p) => {
  await clickText('.side-tab', '用量')(p);
  await sleep(300);
  await clickText('.segmented button', '成本')(p);
  await sleep(500);
});
await shoot('d4-cost-open', 1440, 900, async (p) => {
  await clickText('.side-tab', '用量')(p);
  await sleep(300);
  await clickText('.segmented button', '成本')(p);
  await sleep(400);
  await p.evaluate(() => document.querySelectorAll('.usage-row')[0]?.click());
  await sleep(400);
});
// 新建 → 空画布 → 空状态
await shoot('d5-empty', 1440, 900, async (p) => {
  await p.evaluate(() => {
    const el = [...document.querySelectorAll('.btn')].find((e) => e.textContent.includes('新建'));
    el?.click();
  });
  await sleep(700);
  await p.evaluate(() => {
    const el = [...document.querySelectorAll('.dialog .btn')].find((e) => /创建|新建/.test(e.textContent));
    el?.click();
  });
  await sleep(900);
});
await shoot('d6-colors', 1440, 900, async (p) => {
  await p.evaluate(() => {
    const el = [...document.querySelectorAll('.rail-btn')].find((e) => e.title === '色号管理');
    el?.click();
  });
  await sleep(900);
});
await shoot('d7-export', 1440, 900, async (p) => {
  await clickText('.btn', '导出')(p);
  await sleep(900);
});

// 移动端
await shoot('m1-home', 390, 844);
await shoot('m2-usage', 390, 844, async (p) => {
  await p.evaluate(() => [...document.querySelectorAll('.mtool')].find((e) => e.textContent.includes('更多'))?.click());
  await sleep(500);
  await clickText('.sheet .side-tab', '用量')(p);
  await sleep(500);
});
await shoot('m3-empty', 390, 844, async (p) => {
  await p.evaluate(() => [...document.querySelectorAll('.mtool')].find((e) => e.textContent.includes('更多'))?.click());
  await sleep(500);
  await p.evaluate(() => [...document.querySelectorAll('.sheet-actions .btn')].find((e) => e.textContent.includes('新建'))?.click());
  await sleep(700);
  await p.evaluate(() => {
    const el = [...document.querySelectorAll('.dialog .btn')].find((e) => /创建|新建/.test(e.textContent));
    el?.click();
  });
  await sleep(900);
});

// 平板
await shoot('t1-home', 1024, 768);
await shoot('t2-portrait', 820, 1180);

console.log('=== ERRORS ===');
console.log(errors.length ? [...new Set(errors)].join('\n') : '(none)');
await browser.close();
