// 以图生图端到端测试：造一张渐变+色块图，拖进页面，看是否生成图纸
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

// 造一张 240x240 的测试 PNG（用 canvas 在页面里生成后存盘）
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1200);

// 生成测试图并直接喂给 file input
const dataUrl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 240; c.height = 240;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 240, 240);
  grad.addColorStop(0, '#ff8a3d');
  grad.addColorStop(0.5, '#7c5cff');
  grad.addColorStop(1, '#38e08b');
  g.fillStyle = grad; g.fillRect(0, 0, 240, 240);
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(120, 100, 46, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0b0d16'; g.beginPath(); g.arc(104, 92, 8, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(136, 92, 8, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#0b0d16'; g.lineWidth = 6; g.beginPath(); g.arc(120, 112, 20, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  return c.toDataURL('image/png');
});
writeFileSync(resolve('.shots', 'test-input.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));

await page.evaluate(() => [...document.querySelectorAll('.btn')].find((e) => e.textContent.includes('图片转图纸'))?.click());
await sleep(900);
const input = await page.$('.dialog input[type=file]');
await input.uploadFile(resolve('.shots', 'test-input.png'));
await sleep(2200);

const info = await page.evaluate(() => ({
  hasPreview: !!document.querySelector('.dialog .preview-box canvas'),
  w: document.querySelector('.dialog .preview-box canvas')?.width,
  h: document.querySelector('.dialog .preview-box canvas')?.height,
  labels: [...document.querySelectorAll('.dialog .field label, .dialog label')].slice(0, 12).map((e) => e.textContent.trim()),
}));
console.log('导入预览:', JSON.stringify(info));
await page.screenshot({ path: '.shots/review3/z-import-loaded.png' });

// 点「生成图纸」
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.dialog .btn.primary')].pop();
  b?.click();
});
await sleep(2000);
const after = await page.evaluate(() => ({
  title: document.querySelector('.doc-title-input')?.value,
  size: document.querySelector('.doc-size')?.textContent,
  beads: [...document.querySelectorAll('.tbar-chip')].find((e) => e.textContent.includes('颗'))?.textContent.trim(),
}));
console.log('生成后:', JSON.stringify(after));
await page.screenshot({ path: '.shots/review3/z-import-result.png' });
console.log('ERRORS:', errors.length ? [...new Set(errors)].join('|') : '(none)');
await browser.close();
