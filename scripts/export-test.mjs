// 导出冒烟测试：PNG / SVG / PDF / CSV / 工程 全部真实下载并检查字节
import puppeteer from 'puppeteer-core';
import { readdirSync, statSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DL = resolve('.shots', 'downloads');
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setViewport({ width: 1440, height: 900 });
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1200);

const FORMATS = ['PNG 图片', 'SVG 矢量', 'PDF 图纸', 'CSV 用量表', '工程文件'];
for (const f of FORMATS) {
  await page.evaluate(() => [...document.querySelectorAll('.btn')].find((e) => e.textContent.includes('导出'))?.click());
  await sleep(900);
  await page.evaluate((label) => {
    const b = [...document.querySelectorAll('.dialog button')].find((e) => e.textContent.includes(label));
    b?.click();
  }, f);
  await sleep(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.dialog .btn.primary')].pop();
    b?.click();
  });
  await sleep(2600);
}

await sleep(2500);
const files = readdirSync(DL).map((n) => ({ n, size: statSync(resolve(DL, n)).size }));
console.log(JSON.stringify(files, null, 1));

// 校验内容
for (const { n } of files) {
  const p = resolve(DL, n);
  if (n.endsWith('.svg')) {
    const s = readFileSync(p, 'utf8');
    console.log('SVG ok:', s.startsWith('<svg') || s.includes('<svg'), 'len', s.length);
  }
  if (n.endsWith('.json')) {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    console.log('JSON format:', j.format, 'v', j.version, 'size', j.width + 'x' + j.height, 'palette', j.palette?.length);
  }
  if (n.endsWith('.csv')) {
    const c = readFileSync(p, 'utf8');
    console.log('CSV head:', c.split('\n').slice(0, 2).join(' || '));
  }
  if (n.endsWith('.pdf')) {
    const b = readFileSync(p);
    console.log('PDF magic:', b.subarray(0, 5).toString());
  }
  if (n.endsWith('.png')) {
    const b = readFileSync(p);
    console.log('PNG magic:', b.subarray(1, 4).toString());
  }
}
console.log('ERRORS:', errors.length ? [...new Set(errors)].join('|') : '(none)');
await browser.close();
