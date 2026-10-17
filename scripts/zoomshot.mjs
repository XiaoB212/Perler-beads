// 局部放大截图：检查导出预览与以图生图对话框的渲染
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

const OUT = resolve('.shots', 'review3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});

const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1200);

// 1) 画布本体放大
const stage = await page.$('.stage-wrap');
if (stage) await stage.screenshot({ path: resolve(OUT, 'z-stage.png') });

// 2) 导出预览放大
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.btn')].find((e) => e.textContent.includes('导出'));
  el?.click();
});
await sleep(1300);
const prev = await page.$('.preview-box');
if (prev) {
  await prev.screenshot({ path: resolve(OUT, 'z-export-preview.png') });
  console.log('preview ok');
} else {
  console.log('no .preview-box');
}

// 3) 以图生图对话框（无图时的初始态）
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.dialog .btn, .dialog button')].find((e) => /取消/.test(e.textContent));
  el?.click();
});
await sleep(400);
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.btn')].find((e) => e.textContent.includes('图片转图纸'));
  el?.click();
});
await sleep(900);
const dlg = await page.$('.dialog');
if (dlg) await dlg.screenshot({ path: resolve(OUT, 'z-import-empty.png') });

await browser.close();
console.log('done');
