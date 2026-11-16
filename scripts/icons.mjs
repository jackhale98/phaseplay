// Renders the PWA icons from static/icons/favicon.svg with the pre-installed Chromium.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../apps/web/static/icons/', import.meta.url));
const svg = readFileSync(dir + 'favicon.svg', 'utf8');
const maskable = svg.replace('rx="116"', 'rx="0"').replace('<path', '<g transform="translate(51 51) scale(0.8)"><path').replace('</svg>', '</g></svg>');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, src] of [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['maskable-512.png', 512, maskable],
  ['apple-touch-icon.png', 180, maskable],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${src}`);
  await page.screenshot({ path: dir + name, omitBackground: true });
}
await browser.close();
console.log('icons written');
