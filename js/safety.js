// ==================== DATA SAFETY & SECURITY ====================
// API Key (เก็บถาวรหรือเฉพาะแท็บ), การตั้งค่าในไฟล์สำรอง, พื้นที่จัดเก็บถาวร, เตือน/สำรองอัตโนมัติ,
// ล็อกงานแปลระหว่างแท็บ และแจ้งแท็บอื่นเมื่อข้อมูลเปลี่ยน

// ---------- API Key ----------
// โหมด "ไม่จำ key": เก็บใน sessionStorage (หายเมื่อปิดแท็บ และแต่ละแท็บต้องใส่เอง)
const SECRET_NAME_PATTERN = /^nov_(llm_keys_[a-z0-9]+|jina_key|proxy_key)$/;
const SECRETS_SESSION_FLAG = 'nov_secrets_session_only';

function isSecretName(name) {
  return SECRET_NAME_PATTERN.test(name);
}

function isSessionOnlySecrets() {
  return localStorage.getItem(SECRETS_SESSION_FLAG) === 'true';
}

function secretStorage() {
  return isSessionOnlySecrets() ? sessionStorage : localStorage;
}

function getSecret(name) {
  try {
    return secretStorage().getItem(name);
  } catch (e) {
    return null;
  }
}

function setSecret(name, value) {
  const active = secretStorage();
  const other = active === localStorage ? sessionStorage : localStorage;
  try { other.removeItem(name); } catch (e) {}
  if (value === null || value === undefined || value === '') active.removeItem(name);
  else active.setItem(name, value);
}

function listSecretNames(storage) {
  const names = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && isSecretName(k)) names.push(k);
  }
  return names;
}

/** เปลี่ยนที่เก็บ key แล้วย้าย key ที่มีอยู่ตามไป (ไม่ทิ้ง key ไว้ในที่เก็บเดิม) */
function setSessionOnlySecrets(enabled) {
  if (enabled === isSessionOnlySecrets()) return;
  const from = enabled ? localStorage : sessionStorage;
  const to = enabled ? sessionStorage : localStorage;
  listSecretNames(from).forEach(name => {
    to.setItem(name, from.getItem(name));
    from.removeItem(name);
  });
  localStorage.setItem(SECRETS_SESSION_FLAG, enabled ? 'true' : 'false');
}

function clearAllSecrets() {
  [localStorage, sessionStorage].forEach(storage => listSecretNames(storage).forEach(name => storage.removeItem(name)));
}

function countStoredSecrets() {
  return listSecretNames(secretStorage()).filter(name => {
    const v = secretStorage().getItem(name) || '';
    return v && v !== '[]';
  }).length;
}

// ---------- การตั้งค่าในไฟล์สำรอง ----------
// ใช้รายชื่อที่กำหนดไว้เท่านั้น (ไม่ใช่ทุก key ที่ขึ้นต้นด้วย nov_) เพื่อไม่ให้ไฟล์สำรองจากคนอื่นแอบตั้งค่าอันตรายได้
// Base URL แยกออกมา: ถ้าเปลี่ยน API Key ของ OpenAI-compatible จะถูกส่งไปที่นั่น จึงต้องถามผู้ใช้ก่อนเสมอ
const BACKUP_BASEURL_SETTING = 'nov_llm_baseurl_openai';
// proxy สำรองก็เช่นกัน: ลิงก์ที่อ่านและ proxy key จะถูกส่งไปที่นั่น
const BACKUP_PROXIES_SETTING = 'nov_proxies';
const MAX_SETTING_LENGTH = 200000;

function getBackupSettingNames() {
  const names = [
    'nov_llm_provider', 'nov_llm_fallback_provider', 'nov_quality_mode', 'nov_retry_limit',
    'nov_enable_deep_ner', 'nov_enable_infinite', 'nov_enable_prefetch', 'nov_enable_auto_glossary',
    'nov_enable_bible_auto', 'nov_show_junk', 'nov_export_notes', 'nov_theme', 'nov_font_size',
    'nov_site_profiles', 'nov_site_profiles_removed', 'nov_ai_extract', 'nov_backup_remind_days',
    'nov_budget_unit', 'nov_budget_daily', 'nov_budget_monthly', 'nov_model_prices', 'nov_proxy_first',
    'nov_story_log', 'nov_assistant_role', 'nov_reading_prefs', 'nov_tts_rate',
    'nov_bgm_enabled', 'nov_bgm_volume', 'nov_bgm_silent', 'nov_version_keep', 'nov_benchmark_models', 'nov_llm_reasoning_openai',
    'nov_start_page', 'nov_home_sort'
  ];
  Object.keys(LLM_PROVIDERS).forEach(p => names.push(`nov_llm_model_${p}`, `nov_llm_aux_model_${p}`));
  return names;
}

function collectBackupSettings() {
  const settings = {};
  [...getBackupSettingNames(), BACKUP_BASEURL_SETTING, BACKUP_PROXIES_SETTING].forEach(name => {
    const v = localStorage.getItem(name);
    if (v !== null) settings[name] = v;
  });
  return settings;
}

/**
 * แยกการตั้งค่าจากไฟล์สำรองเป็น ส่วนที่ใช้ได้ทันที และ Base URL ที่ต้องถามก่อน
 * ค่าที่ไม่อยู่ในรายชื่อ ไม่ใช่ข้อความ หรือยาวผิดปกติ จะถูกข้าม
 */
function splitImportedSettings(settings) {
  const allowed = new Set(getBackupSettingNames());
  const safe = {};
  let baseUrl = null;
  let proxies = null;
  if (!settings || typeof settings !== 'object') return { safe, baseUrl, proxies };
  Object.entries(settings).forEach(([name, value]) => {
    if (typeof value !== 'string' || value.length > MAX_SETTING_LENGTH) return;
    if (name === BACKUP_BASEURL_SETTING) {
      if (/^https?:\/\//i.test(value.trim())) baseUrl = value.trim();
      return;
    }
    if (name === BACKUP_PROXIES_SETTING) {
      try {
        const list = JSON.parse(value);
        if (Array.isArray(list)) {
          const clean = list.filter(p => p && typeof p.url === 'string' && /^https?:\/\//i.test(p.url.trim()))
            .map(p => ({ name: String(p.name || '').slice(0, 60), url: p.url.trim() }));
          if (clean.length) proxies = clean;
        }
      } catch (e) {}
      return;
    }
    if (!allowed.has(name)) return;
    if (name === 'nov_site_profiles') {
      try { if (!Array.isArray(JSON.parse(value))) return; } catch (e) { return; }
    }
    safe[name] = value;
  });
  if (baseUrl && baseUrl.replace(/\/+$/, '') === getProviderBaseUrl('openai')) baseUrl = null;
  if (proxies && JSON.stringify(proxies) === JSON.stringify(getProxies().map(p => ({ name: String(p.name || ''), url: p.url.trim() })))) proxies = null;
  return { safe, baseUrl, proxies };
}

function applyImportedSettings(safe, { baseUrl = null, proxies = null } = {}) {
  Object.entries(safe).forEach(([name, value]) => localStorage.setItem(name, value));
  if (baseUrl) localStorage.setItem(BACKUP_BASEURL_SETTING, baseUrl);
  if (proxies) localStorage.setItem(BACKUP_PROXIES_SETTING, JSON.stringify(proxies));
}

// ---------- พื้นที่จัดเก็บถาวร ----------
function isIosDevice() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isInstalledApp() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

async function getStorageStatus() {
  const status = { supported: !!navigator.storage, persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) status.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      status.usage = est.usage ?? null;
      status.quota = est.quota ?? null;
    }
  } catch (e) {}
  status.iosNotInstalled = isIosDevice() && !isInstalledApp();
  return status;
}

/** ขอให้เบราว์เซอร์ไม่ลบข้อมูลแอพนี้เอง (Chrome ตัดสินใจเองโดยไม่ถาม, Firefox จะถามผู้ใช้) */
async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) {
    return false;
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return Math.round(n / 1e3) + ' KB';
  return n + ' B';
}

// ---------- เตือนสำรองข้อมูล ----------
const DEFAULT_BACKUP_REMIND_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function getBackupRemindDays() {
  const raw = localStorage.getItem('nov_backup_remind_days');
  if (raw === null) return DEFAULT_BACKUP_REMIND_DAYS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BACKUP_REMIND_DAYS;
}

function readTimestamp(name) {
  const n = parseInt(localStorage.getItem(name) || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function markBackupDone() {
  localStorage.setItem('nov_last_backup_at', String(Date.now()));
  localStorage.removeItem('nov_backup_snooze_until');
}

function snoozeBackupReminder(days = 1) {
  localStorage.setItem('nov_backup_snooze_until', String(Date.now() + days * DAY_MS));
}

/**
 * ควรเตือนให้สำรองหรือไม่: มีข้อมูลที่เปลี่ยนหลังสำรองครั้งล่าสุด และไม่ได้สำรองนานเกินกำหนด
 * ถ้ายังไม่เคยสำรองเลย นับจากครั้งแรกที่ข้อมูลเปลี่ยน
 */
function getBackupReminderState(now = Date.now()) {
  const days = getBackupRemindDays();
  const lastBackup = readTimestamp('nov_last_backup_at');
  const changedAt = readTimestamp('nov_data_changed_at');
  const firstChangeAt = readTimestamp('nov_first_change_at');
  const snoozeUntil = readTimestamp('nov_backup_snooze_until');
  const hasUnsaved = changedAt > lastBackup;
  const since = lastBackup || firstChangeAt || changedAt;
  const overdue = days > 0 && hasUnsaved && since > 0 && now - since >= days * DAY_MS;
  return {
    days, lastBackup, changedAt, hasUnsaved,
    daysSinceBackup: lastBackup ? Math.floor((now - lastBackup) / DAY_MS) : null,
    shouldRemind: overdue && now >= snoozeUntil
  };
}

// ---------- ไฟล์สำรอง ----------
async function buildBackupPayload() {
  const data = await dbExportAll();
  data.settings = collectBackupSettings();
  return data;
}

function backupFileStamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// downloadBlob อยู่ใน export.js
async function downloadBackupFile(prefix = 'dusktale-backup') {
  const data = await buildBackupPayload();
  downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${prefix}-${backupFileStamp()}.json`);
  markBackupDone();
  return data;
}

// ---------- สำรองอัตโนมัติลงโฟลเดอร์ (File System Access API: Chrome/Edge บนคอม) ----------
const AUTO_BACKUP_META_KEY = 'autoBackupDir';
const AUTO_BACKUP_PREFIX = 'noveltranslate-auto-';
const AUTO_BACKUP_KEEP = 5;
const AUTO_BACKUP_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

function isAutoBackupSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

async function getAutoBackupDir() {
  try {
    return (await dbGetMeta(AUTO_BACKUP_META_KEY)) || null;
  } catch (e) {
    return null;
  }
}

async function chooseAutoBackupFolder() {
  if (!isAutoBackupSupported()) throw new Error('เบราว์เซอร์นี้ไม่รองรับการสำรองลงโฟลเดอร์ (ใช้ได้กับ Chrome / Edge บนคอมพิวเตอร์)');
  const handle = await window.showDirectoryPicker({ id: 'noveltranslate-backup', mode: 'readwrite' });
  await dbSetMeta(AUTO_BACKUP_META_KEY, handle);
  return handle;
}

async function disableAutoBackup() {
  await dbSetMeta(AUTO_BACKUP_META_KEY, undefined);
}

/** สิทธิ์เขียนโฟลเดอร์: หลังปิดเบราว์เซอร์มักต้องขอใหม่ และขอได้เฉพาะตอนผู้ใช้กดปุ่ม (interactive) */
async function ensureFolderPermission(handle, interactive) {
  const opts = { mode: 'readwrite' };
  if (await handle.queryPermission(opts) === 'granted') return true;
  if (!interactive) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

/**
 * เขียนไฟล์สำรองลงโฟลเดอร์ที่เลือกไว้ แล้วลบไฟล์สำรองอัตโนมัติเก่า (เฉพาะไฟล์ที่แอพสร้างเอง) ให้เหลือ 5 ไฟล์ล่าสุด
 * คืนค่า 'done' | 'no-folder' | 'needs-permission'
 */
async function runAutoBackup({ interactive = false } = {}) {
  const handle = await getAutoBackupDir();
  if (!handle) return 'no-folder';
  if (!(await ensureFolderPermission(handle, interactive))) return 'needs-permission';
  const data = await buildBackupPayload();
  const fileName = `${AUTO_BACKUP_PREFIX}${backupFileStamp()}.json`;
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  await writable.close();

  const autoFiles = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === 'file' && name.startsWith(AUTO_BACKUP_PREFIX) && name.endsWith('.json')) autoFiles.push(name);
  }
  autoFiles.sort().reverse().slice(AUTO_BACKUP_KEEP).forEach(name => handle.removeEntry(name).catch(() => {}));

  markBackupDone();
  localStorage.setItem('nov_last_auto_backup_at', String(Date.now()));
  return 'done';
}

/** สำรองอัตโนมัติแบบเงียบ เมื่อมีข้อมูลเปลี่ยนและห่างจากครั้งก่อนพอสมควร (ไม่ถามสิทธิ์ ไม่ขัดจังหวะผู้ใช้) */
async function maybeRunAutoBackup() {
  try {
    const state = getBackupReminderState();
    if (!state.hasUnsaved) return 'up-to-date';
    if (Date.now() - readTimestamp('nov_last_auto_backup_at') < AUTO_BACKUP_MIN_INTERVAL_MS) return 'too-soon';
    return await runAutoBackup({ interactive: false });
  } catch (e) {
    console.warn('Auto backup failed:', e);
    return 'error';
  }
}

// ---------- จำกัดขนาดไฟล์ที่นำเข้า ----------
const IMPORT_LIMITS = {
  txtBytes: 50e6,
  epubBytes: 100e6,
  epubUncompressedBytes: 400e6,
  epubEntries: 10000,
  pasteChars: 30 * 1000 * 1000,
  chapters: 5000
};

function checkImportFileSize(file) {
  const isEpub = /\.epub$/i.test(file.name);
  const limit = isEpub ? IMPORT_LIMITS.epubBytes : IMPORT_LIMITS.txtBytes;
  if (file.size > limit) {
    throw new Error(`ไฟล์ใหญ่เกินไป (${formatBytes(file.size)}) รองรับไฟล์ ${isEpub ? '.epub' : '.txt'} ไม่เกิน ${formatBytes(limit)} ลองแบ่งไฟล์เป็นหลายส่วน`);
  }
}

function checkImportChapterCount(count) {
  if (count > IMPORT_LIMITS.chapters) {
    throw new Error(`พบ ${count.toLocaleString()} ตอน มากเกินกว่าที่นำเข้าได้ในครั้งเดียว (ไม่เกิน ${IMPORT_LIMITS.chapters.toLocaleString()} ตอน) ลองแบ่งไฟล์เป็นหลายส่วน`);
  }
}

// ---------- ล็อกงานแปลระหว่างแท็บ ----------
// ใช้ Web Locks API ถ้าเบราว์เซอร์ไม่รองรับ จะทำงานแบบเดิม (ไม่มีล็อก)
class LockBusyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LockBusyError';
  }
}

/**
 * ขอล็อกชื่อ name แล้วคืนฟังก์ชันปล่อยล็อก
 * ifAvailable: ถ้ามีแท็บอื่นถืออยู่ คืน null ทันที (ไม่รอ) | ไม่งั้นรอจนได้ (ยกเลิกได้ด้วย signal)
 */
function acquireLock(name, { ifAvailable = false, signal = null } = {}) {
  if (!navigator.locks?.request) return Promise.resolve(() => {});
  return new Promise((resolve, reject) => {
    const options = ifAvailable ? { ifAvailable: true } : (signal ? { signal } : {});
    navigator.locks.request(name, options, lock => {
      if (!lock) {
        resolve(null);
        return undefined;
      }
      return new Promise(release => resolve(release));
    }).catch(err => {
      if (err?.name === 'AbortError') reject(new LLMError('ผู้ใช้สั่งหยุดการทำงาน', 'abort'));
      else reject(err);
    });
  });
}

/** รันงานภายใต้ล็อก ถ้า ifAvailable แล้วล็อกไม่ว่าง จะโยน LockBusyError */
async function withLock(name, fn, { ifAvailable = false, signal = null, busyMessage = 'งานนี้กำลังทำอยู่ในอีกแท็บ' } = {}) {
  const release = await acquireLock(name, { ifAvailable, signal });
  if (!release) throw new LockBusyError(busyMessage);
  try {
    return await fn();
  } finally {
    release();
  }
}

const OTHER_TAB_BUSY_MESSAGE = 'อีกแท็บกำลังแปลตอนถัดไปของเรื่องนี้อยู่ เมื่อเสร็จแล้วตอนนั้นจะมาต่อท้ายที่นี่เอง';

const lockNames = {
  // เพิ่มตอนถัดไปต่อท้ายเรื่อง (ตอนถัดไป / แปลล่วงหน้า / prefetch)
  append: bookId => `nt-append-${bookId}`,
  // การแปลล่วงหน้าหลายตอนของเรื่องนี้
  batch: bookId => `nt-batch-${bookId}`,
  // แปลตอนใดตอนหนึ่ง (ตอนที่รอแปล)
  chapter: chapId => `nt-chapter-${chapId}`
};

// ---------- แจ้งแท็บอื่นเมื่อข้อมูลเปลี่ยน ----------
const TAB_ID = Math.random().toString(36).slice(2);
let dataChannel = null;
const pendingBroadcast = new Map();
let broadcastTimer = null;
let remoteChangeHandler = null;

try {
  if (typeof BroadcastChannel === 'function') {
    dataChannel = new BroadcastChannel('noveltranslate-data');
    dataChannel.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.from === TAB_ID || !Array.isArray(msg.changes)) return;
      if (remoteChangeHandler) remoteChangeHandler(msg.changes);
    };
  }
} catch (e) {
  dataChannel = null;
}

function onRemoteDataChange(handler) {
  remoteChangeHandler = handler;
}

/** เรียกจาก db.js ทุกครั้งที่บันทึกข้อมูลสำเร็จ */
function onLocalDataChanged(kind, bookId) {
  const now = Date.now();
  localStorage.setItem('nov_data_changed_at', String(now));
  if (!localStorage.getItem('nov_first_change_at')) localStorage.setItem('nov_first_change_at', String(now));
  if (!dataChannel) return;
  const key = `${kind}|${bookId || ''}`;
  pendingBroadcast.set(key, { kind, bookId: bookId || null });
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    const changes = [...pendingBroadcast.values()];
    pendingBroadcast.clear();
    try { dataChannel.postMessage({ from: TAB_ID, changes }); } catch (e) {}
  }, 400);
}
