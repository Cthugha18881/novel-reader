// Service worker: ทำให้เปิดแอพและอ่านตอนที่บันทึกไว้ได้แม้ออฟไลน์
// ไฟล์ของแอพใช้ network-first (ออนไลน์ได้เวอร์ชันล่าสุดเสมอ) ส่วนฟอนต์/ไลบรารีจาก CDN ใช้ cache-first
// คำขอไปยัง AI และ r.jina.ai จะไม่ถูกแตะต้องเลย
const CACHE_NAME = 'noveltranslate-v3.23.1';
const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'legal/privacy.html',
  'legal/terms.html',
  'legal/theme.js',
  'js/hosted-config.js',
  'js/csp.js',
  'js/db.js',
  'js/safety.js',
  'js/dialogs.js',
  'js/llm.js',
  'js/hosted.js',
  'js/plans.js',
  'js/sync.js',
  'js/feedback.js',
  'js/usage.js',
  'js/lang.js',
  'js/api.js',
  'js/source.js',
  'js/cleanup.js',
  'js/glossary.js',
  'js/bible.js',
  'js/storylog.js',
  'js/shelf.js',
  'js/updates.js',
  'js/home.js',
  'js/assistant.js',
  'js/reader.js',
  'js/bgm.js',
  'js/quality.js',
  'js/glossary-io.js',
  'js/benchmark.js',
  'js/export.js',
  'js/app.js',
  'js/a11y.js',
  'js/import-ui.js',
  'js/settings-ui.js',
  'js/backup-ui.js',
  'js/usage-ui.js',
  'js/multitab.js',
  'js/menus.js',
  'js/pwa.js',
  'vendor/jszip.min.js',
  'icons/icon-64.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];
const CACHEABLE_CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  // cache: 'reload' = โหลดจากเซิร์ฟเวอร์จริง ไม่เอาไฟล์รุ่นเก่าจาก HTTP cache มาใส่ cache รุ่นใหม่
  event.waitUntil(caches.open(CACHE_NAME)
    .then(cache => cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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
    // cache: 'no-cache' = ถามเซิร์ฟเวอร์ทุกครั้งว่าไฟล์เปลี่ยนไหม (ถ้าไม่เปลี่ยนได้ 304 เร็ว)
    // ไม่งั้นเบราว์เซอร์อาจใช้ไฟล์เก่าจาก HTTP cache (GitHub Pages ให้เก็บ 10 นาที) ทำให้ไฟล์เก่า/ใหม่ปนกันหลังอัปเดต
    const response = request.mode === 'navigate'
      ? await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
      : await fetch(request, { cache: 'no-cache' });
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
  // เก็บเฉพาะคำตอบที่สำเร็จ ไม่เก็บแบบ opaque (Chrome คิดพื้นที่ของ opaque เกินจริงมาก และอาจเป็นหน้าที่ผิดพลาด)
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/tests/')) return;
    // ไฟล์เพลงประกอบ: เบราว์เซอร์ขอเป็นช่วง (Range/206) ซึ่งเก็บลง cache ไม่ได้ ให้เบราว์เซอร์จัดการเอง
    if (url.pathname.includes('/audio/')) return;
    event.respondWith(networkFirst(request));
  } else if (CACHEABLE_CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});
