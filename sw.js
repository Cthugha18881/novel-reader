// Service worker: ทำให้เปิดแอพและอ่านตอนที่บันทึกไว้ได้แม้ออฟไลน์
// ไฟล์ของแอพใช้ network-first (ออนไลน์ได้เวอร์ชันล่าสุดเสมอ) ส่วนฟอนต์/ไลบรารีจาก CDN ใช้ cache-first
// คำขอไปยัง AI และ r.jina.ai จะไม่ถูกแตะต้องเลย
const CACHE_NAME = 'noveltranslate-v3.0.0';
const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/csp.js',
  'js/db.js',
  'js/safety.js',
  'js/llm.js',
  'js/lang.js',
  'js/api.js',
  'js/source.js',
  'js/cleanup.js',
  'js/glossary.js',
  'js/bible.js',
  'js/shelf.js',
  'js/export.js',
  'js/app.js',
  'vendor/jszip.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
];
const CACHEABLE_CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('noveltranslate-') && k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/tests/')) return;
    event.respondWith(networkFirst(request));
  } else if (CACHEABLE_CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});
