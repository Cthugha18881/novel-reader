// ==================== PWA: ติดตั้งแอพ + service worker (แยกจาก app.js) ====================
// โหลดหลัง app.js (ดู index.html) ทุกอย่างในไฟล์นี้ถูกเรียกหลังหน้าโหลดเสร็จ จึงใช้ตัวแปรของ app.js ได้ตามปกติ

// ==================== PWA ====================
let deferredInstallPrompt = null;

function setupPwa() {
  const isSecure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && isSecure) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker registration failed:', err));
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.getElementById('install-app-btn').style.display = 'inline-flex';
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.getElementById('install-app-btn').style.display = 'none';
  });
}

async function promptInstallApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  document.getElementById('install-app-btn').style.display = 'none';
}
