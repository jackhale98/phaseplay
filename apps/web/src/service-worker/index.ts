/**
 * Precaches the app shell and static assets so Phaseplay opens instantly and works offline.
 * API responses are never cached here (the data layer owns them in IndexedDB). A new version
 * waits until the user taps "Refresh", so it never reloads mid-match.
 */
import { immutable, assets, prerendered as pre } from '$app/manifest';
import { version } from '$app/env';
import { self as sw } from '$app/service-worker';

const build = immutable.map((x) => x.path);
const files = assets.map((x) => x.path as string);
const prerendered = pre.map((x) => x.path as string);
const CACHE = `pp-${version}`;
const SHELL = '/200';
const PRECACHE = [...new Set([...build, ...files.filter((f) => !/\.(txt|md)$/.test(f) && !f.startsWith('/icons/maskable')), ...prerendered, SHELL])];

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cal/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        const pre = prerendered.includes(url.pathname) ? await cache.match(url.pathname) : undefined;
        const hit = pre ?? (await cache.match(SHELL));
        if (hit) return hit;
        return fetch(req);
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && (url.pathname.startsWith('/_app/') || files.includes(url.pathname)))
        void cache.put(req, res.clone());
      return res;
    })(),
  );
});
