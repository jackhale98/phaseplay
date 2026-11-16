// Bundle budgets (docs/design.md §Performance budgets): initial route JS ≤ 90 KB gzip,
// CSS ≤ 20 KB gzip, fonts ≤ 60 KB, any single lazy chunk (play editor) ≤ 120 KB gzip.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../apps/web/build/', import.meta.url));
const gz = (f) => gzipSync(readFileSync(f)).length;
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
let failed = false;
const check = (label, size, max) => {
  const ok = size <= max;
  if (!ok) failed = true;
  console.log(`${ok ? '✓' : '✗'} ${label}: ${kb(size)} (budget ${kb(max)})`);
};

// Initial route JS = scripts the landing page and the app shell fetch up front (modulepreload + entry).
for (const page of ['index.html', '200.html']) {
  const html = readFileSync(join(build, page), 'utf8');
  const files = new Set([...html.matchAll(/(?:href|import\()\s*=?\s*["']([^"']+\.js)["']/g)].map((m) => m[1]));
  const total = [...files].reduce((n, f) => n + gz(join(build, f.replace(/^\.?\//, '').replace(/^\//, ''))), 0);
  check(`initial JS (${page})`, total, 90 * 1024);
}
const all = walk(join(build, '_app'));
{
  const html = readFileSync(join(build, '200.html'), 'utf8');
  const css = [...html.matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1]);
  check('initial CSS (app shell)', css.reduce((n, f) => n + gz(join(build, f.replace(/^\.?\//, ''))), 0), 20 * 1024);
}
check('fonts', walk(join(build, 'fonts')).filter((f) => f.endsWith('.woff2')).reduce((n, f) => n + statSync(f).size, 0), 60 * 1024);
const biggest = all.filter((f) => f.endsWith('.js')).map((f) => [f, gz(f)]).sort((a, b) => b[1] - a[1])[0];
if (biggest) check(`largest lazy chunk (${biggest[0].split('/').pop()})`, biggest[1], 120 * 1024);
if (failed) process.exit(1);
