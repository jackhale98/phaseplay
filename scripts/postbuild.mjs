// Post-build: write Workers Assets `_headers` (security + caching) and sanity-check the output.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../apps/web/build/', import.meta.url));
const doc = [
  "  Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  '  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  '  Cross-Origin-Opener-Policy: same-origin',
].join('\n');
writeFileSync(
  join(out, '_headers'),
  `/*\n${doc}\n\n/_app/immutable/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/service-worker.js\n  Cache-Control: no-cache\n\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
);

for (const f of ['200.html', 'index.html', 'privacy.html', 'service-worker.js', 'manifest.webmanifest'])
  if (!existsSync(join(out, f))) throw new Error(`build is missing ${f}`);
const index = readFileSync(join(out, 'index.html'), 'utf8');
if (!index.includes('http-equiv="content-security-policy"')) throw new Error('index.html has no CSP meta tag');

// No test-only auth may reach a production bundle.
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const f of walk(out).filter((f) => f.endsWith('.js')))
  if (readFileSync(f, 'utf8').includes('/api/v1/test/login')) throw new Error(`test login route referenced in ${f}`);
console.log('postbuild ok');
