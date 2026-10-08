// Service worker: เธ—เธณเนเธซเนเน€เธเธดเธ”เนเธญเธเนเธฅเธฐเธญเนเธฒเธเธ•เธญเธเธ—เธตเนเธเธฑเธเธ—เธถเธเนเธงเนเนเธ”เนเนเธกเนเธญเธญเธเนเธฅเธเน
// เนเธเธฅเนเธเธญเธเนเธญเธเนเธเน network-first (เธญเธญเธเนเธฅเธเนเนเธ”เนเน€เธงเธญเธฃเนเธเธฑเธเธฅเนเธฒเธชเธธเธ”เน€เธชเธกเธญ) เธชเนเธงเธเธเธญเธเธ•เน/เนเธฅเธเธฃเธฒเธฃเธตเธเธฒเธ CDN เนเธเน cache-first
// เธเธณเธเธญเนเธเธขเธฑเธ AI เนเธฅเธฐ r.jina.ai เธเธฐเนเธกเนเธ–เธนเธเนเธ•เธฐเธ•เนเธญเธเน€เธฅเธข
const CACHE_NAME = 'noveltranslate-v3.22.1';
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
  // cache: 'reload' = เนเธซเธฅเธ”เธเธฒเธเน€เธเธดเธฃเนเธเน€เธงเธญเธฃเนเธเธฃเธดเธ เนเธกเนเน€เธญเธฒเนเธเธฅเนเธฃเธธเนเธเน€เธเนเธฒเธเธฒเธ HTTP cache เธกเธฒเนเธชเน cache เธฃเธธเนเธเนเธซเธกเน
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
    // cache: 'no-cache' = เธ–เธฒเธกเน€เธเธดเธฃเนเธเน€เธงเธญเธฃเนเธ—เธธเธเธเธฃเธฑเนเธเธงเนเธฒเนเธเธฅเนเน€เธเธฅเธตเนเธขเธเนเธซเธก (เธ–เนเธฒเนเธกเนเน€เธเธฅเธตเนเธขเธเนเธ”เน 304 เน€เธฃเนเธง)
    // เนเธกเนเธเธฑเนเธเน€เธเธฃเธฒเธงเนเน€เธเธญเธฃเนเธญเธฒเธเนเธเนเนเธเธฅเนเน€เธเนเธฒเธเธฒเธ HTTP cache (GitHub Pages เนเธซเนเน€เธเนเธ 10 เธเธฒเธ—เธต) เธ—เธณเนเธซเนเนเธเธฅเนเน€เธเนเธฒ/เนเธซเธกเนเธเธเธเธฑเธเธซเธฅเธฑเธเธญเธฑเธเน€เธ”เธ•
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
  // เน€เธเนเธเน€เธเธเธฒเธฐเธเธณเธ•เธญเธเธ—เธตเนเธชเธณเน€เธฃเนเธ เนเธกเนเน€เธเนเธเนเธเธ opaque (Chrome เธเธดเธ”เธเธทเนเธเธ—เธตเนเธเธญเธ opaque เน€เธเธดเธเธเธฃเธดเธเธกเธฒเธ เนเธฅเธฐเธญเธฒเธเน€เธเนเธเธซเธเนเธฒเธ—เธตเนเธเธดเธ”เธเธฅเธฒเธ”)
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/tests/')) return;
    // เนเธเธฅเนเน€เธเธฅเธเธเธฃเธฐเธเธญเธ: เน€เธเธฃเธฒเธงเนเน€เธเธญเธฃเนเธเธญเน€เธเนเธเธเนเธงเธ (Range/206) เธเธถเนเธเน€เธเนเธเธฅเธ cache เนเธกเนเนเธ”เน เนเธซเนเน€เธเธฃเธฒเธงเนเน€เธเธญเธฃเนเธเธฑเธ”เธเธฒเธฃเน€เธญเธ
    if (url.pathname.includes('/audio/')) return;
    event.respondWith(networkFirst(request));
  } else if (CACHEABLE_CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});
