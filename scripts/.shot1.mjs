import { chromium, devices } from '@playwright/test';
const [out, path, w] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext(
  w ? { viewport: { width: +w, height: 900 } } : { ...devices['Pixel 7'] },
);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.request.post('http://localhost:8787/api/v1/test/login', {
  data: {
    userId: process.env.UID ?? 'b0000000-0000-7000-8000-000000000002',
    displayName: 'Sam Carter',
  },
  headers: { origin: 'http://localhost:8787' },
});
await page.goto('http://localhost:8787' + path);
await page.waitForTimeout(1500);
await page.screenshot({ path: out, fullPage: true });
console.log('errors', errors.slice(0, 5));
await browser.close();
