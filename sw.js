// Offline support for the deck.
// - Pages: network first (with a timeout), cached copy when offline or on slow Wi-Fi.
// - Media (audio/video): served from cache when present, including byte-range requests.
// - Everything else same-origin, plus Google Fonts: cache first, refreshed in the background.
// The full deck (videos included) is cached by index.html when opened with ?offline.
const CACHE = 'sedifrale-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'et_douloureux.ogg'];
const PAGE_TIMEOUT = 4000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !fonts) return;
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) e.respondWith(networkFirst(req));
  else if (/\.(mp4|ogg|mp3|webm)$/i.test(url.pathname)) e.respondWith(media(req));
  else e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
  net.catch(() => {}); // a late network failure after a cached answer is expected offline
  try {
    return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), PAGE_TIMEOUT))]);
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || net;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; });
  if (hit) { net.catch(() => {}); return hit; }
  return net;
}

// Media elements ask for byte ranges; answer them from the cached full file so playback and seeking work offline
async function media(req) {
  const hit = await caches.match(req.url);
  if (!hit) return fetch(req);
  const range = req.headers.get('range');
  if (!range) return hit;
  const blob = await hit.blob(), size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return hit;
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': hit.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}
