/**
 * Precaches the app shell and static assets so Phaseplay opens instantly and works offline.
 * API responses are never cached here (the data layer owns them in IndexedDB), with one
 * exception: playbook images a user has opened (immutable, versioned URLs) go in a small LRU
 * runtime cache so a picture play opens at the field without signal. A new version waits until
 * the user taps "Refresh", so it never reloads mid-match.
 */
import { immutable, assets, prerendered as pre } from '$app/manifest';
import { version } from '$app/env';
import { self as sw } from '$app/service-worker';
import type { PushPayload } from '@phaseplay/shared';

const build = immutable.map((x) => x.path);
const files = assets.map((x) => x.path as string);
const prerendered = pre.map((x) => x.path as string);
const CACHE = `pp-${version}`;
const SHELL = '/200';
/** Runtime caches for uploaded images (kept across app versions; cleared on sign-out). */
const MEDIA_CACHES = { full: 'pp-media', thumb: 'pp-media-thumbs' } as const;
const MEDIA_MAX_ENTRIES = 150;
const MEDIA_PATH = /^\/api\/v1\/teams\/[^/]+\/media\/[^/]+$/;
const PRECACHE = [
  ...new Set([
    ...build,
    // Landing-page screenshots are for visitors, not the installed app: don't precache them.
    ...files.filter(
      (f) =>
        !/\.(txt|md)$/.test(f) && !f.startsWith('/icons/maskable') && !f.startsWith('/landing/'),
    ),
    ...prerendered,
    SHELL,
  ]),
];

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set<string>([CACHE, MEDIA_CACHES.full, MEDIA_CACHES.thumb]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
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
  if (MEDIA_PATH.test(url.pathname)) {
    event.respondWith(mediaFetch(req, url));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cal/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        const pre = prerendered.includes(url.pathname)
          ? await cache.match(url.pathname)
          : undefined;
        const hit = pre ?? (await cache.match(SHELL));
        if (hit) return hit;
        return fetch(req);
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (
        res.ok &&
        !url.pathname.startsWith('/landing/') &&
        (url.pathname.startsWith('/_app/') || files.includes(url.pathname))
      )
        void cache.put(req, res.clone());
      return res;
    })(),
  );
});

/**
 * Cache-first for images (their URLs never change content). A hit is re-put so it moves to the
 * end of the cache's key order, which makes trimming the oldest keys an LRU.
 */
async function mediaFetch(req: Request, url: URL): Promise<Response> {
  const cache = await caches.open(
    url.searchParams.get('s') === 'thumb' ? MEDIA_CACHES.thumb : MEDIA_CACHES.full,
  );
  const hit = await cache.match(req);
  if (hit) {
    const copy = hit.clone();
    void cache
      .delete(req)
      .then(() => cache.put(req, copy))
      .catch(() => {});
    return hit;
  }
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MEDIA_MAX_ENTRIES)))
      await cache.delete(k);
  }
  return res;
}

// Web Push (docs/architecture.md §Push).
type Push = Partial<PushPayload>;

sw.addEventListener('push', (event) => {
  let p: Push;
  try {
    p = (event.data?.json() ?? {}) as Push;
  } catch {
    p = { body: event.data?.text() };
  }
  const url = typeof p.url === 'string' && p.url.startsWith('/') ? p.url : '/home';
  event.waitUntil(
    sw.registration.showNotification(p.title || 'Phaseplay', {
      body: p.body ?? '',
      tag: p.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      data: { url },
    }),
  );
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data as { url?: string } | null)?.url ?? '/home';
  const target = new URL(path, sw.location.origin);
  if (target.origin !== sw.location.origin) return;
  event.waitUntil(
    (async () => {
      const wins = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => new URL(w.url).origin === target.origin);
      if (win) {
        // Focus the open app and take it to the page, rather than opening a second window.
        await win.focus();
        if (win.url === target.href) return;
        // navigate() only works for windows this worker controls; otherwise open the page.
        const moved = await win.navigate(target.href).catch(() => null);
        if (moved) return;
      }
      await sw.clients.openWindow(target.href);
    })(),
  );
});
