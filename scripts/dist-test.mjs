// 用生产构建预览（file:// 与相对路径）验证 GitHub Pages 场景
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars','--allow-file-access-from-files'] });
const p = await browser.newPage();
p.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errors.push('CONSOLE: ' + m.text()));
p.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url()));
await p.setViewport({ width: 1280, height: 860 });
await p.goto('file:///D:/code/Perler-beads/dist/index.html', { waitUntil: 'networkidle2' });
await sleep(2000);
const r = await p.evaluate(() => ({
  title: document.querySelector('.doc-title-input')?.value,
  beads: [...document.querySelectorAll('.tbar-chip')].find(e => /\d+ 颗/.test(e.textContent))?.textContent.trim(),
  canvases: document.querySelectorAll('canvas').length,
}));
console.log('file:// 构建产物:', JSON.stringify(r));
await p.screenshot({ path: '.shots/review3/z-dist-file.png' });
console.log('ERRORS:', errors.length ? [...new Set(errors)].join('|') : '(none)');
await browser.close();
