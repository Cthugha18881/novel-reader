// ==================== ซิงก์หลายเครื่อง / สำรองบนคลาวด์ (Plus ขึ้นไป) ====================
// ซิงก์ชั้นหนังสือ (รวมตำแหน่งอ่าน) ตอนที่แปล คลังศัพท์ และข้อมูลเสริมของเรื่อง (คู่มือเรื่อง บุ๊กมาร์ก ปก)
// ไม่ซิงก์: ประวัติเวอร์ชันของตอน สถิติการใช้งาน ค่าตั้งของเครื่อง และ API Key
//
// วิธีรู้ว่าอะไรเปลี่ยน: เก็บลายนิ้วมือ (hash) ของทุกรายการตอนซิงก์ครั้งล่าสุด รอบถัดไปเทียบใหม่ทั้งหมด
// จึงไม่พลาดการแก้จากทางไหนก็ตาม (บันทึก ลบ ย้ายตอน นำเข้าไฟล์ ลบเรื่องแล้วถอดคำศัพท์)
// ลำดับ: ดึงของใหม่จากคลาวด์ก่อน -> ส่งของที่เปลี่ยนในเครื่องขึ้นไป
// ชนกัน (แก้รายการเดียวกันทั้งสองเครื่อง): ฉบับที่ใหม่กว่าชนะ ถ้าเป็นตอน ฉบับที่แพ้เก็บไว้ในประวัติเวอร์ชัน (ไม่หาย)

const SYNC_STORES = [
  { store: 'books', prefix: 'b', idOf: r => r?.bookId },
  { store: 'chapters', prefix: 'c', idOf: r => r?.id },
  { store: 'glossaries', prefix: 'g', idOf: r => r?.src },
  { store: 'bookData', prefix: 'd', idOf: r => r?.bookId }
];
const SYNC_STATE_KEY = 'sync_state';
const SYNC_ENABLED_KEY = 'nov_sync_enabled';
const SYNC_BATCH_CHARS = 2500000;   // ต่อคำขอ (เซิร์ฟเวอร์รับไม่เกิน 4MB)
const SYNC_BATCH_RECORDS = 200;
const SYNC_DEBOUNCE_MS = 30000;      // แก้แล้วรอให้นิ่งก่อนส่ง
const SYNC_INTERVAL_MS = 5 * 60000;  // ระหว่างเปิดแอพ ดึงของใหม่จากเครื่องอื่นทุก 5 นาที

// ---------- ฟังก์ชันล้วน (ทดสอบได้) ----------
function syncKeyOf(def, rec) {
  const id = def.idOf(rec);
  return typeof id === 'string' && id ? `${def.prefix}:${id}` : null;
}

function parseSyncKey(key) {
  const m = /^([bcgd]):(.+)$/.exec(String(key || ''));
  if (!m) return null;
  const def = SYNC_STORES.find(s => s.prefix === m[1]);
  return def ? { ...def, id: m[2] } : null;
}

function syncFingerprint(rec) {
  const s = JSON.stringify(rec);
  return `${s.length}.${hashString(s)}`;
}

/** เวลาที่แก้รายการล่าสุด (ใช้ตัดสินตอนชนกัน) 0 = ไม่รู้ */
function syncRecordTime(store, rec) {
  if (!rec) return 0;
  const t = store === 'chapters'
    ? Math.max(Number(rec.updatedAt) || 0, Number(rec.translationMeta?.translatedAt) || 0, Number(rec.editedAt) || 0)
    : Number(rec.updatedAt) || 0;
  return Number.isFinite(t) ? t : 0;
}

/**
 * รายการจากคลาวด์: ใช้ ('apply') หรือเก็บของในเครื่องไว้ ('keep')
 * base = ลายนิ้วมือตอนซิงก์ครั้งก่อน, local = ตอนนี้ (undefined = ไม่มีในเครื่อง)
 */
function decideSyncMerge({ baseFp, localFp, remoteDeleted, localTime = 0, remoteTime = 0, firstSync = false }) {
  const localChanged = localFp !== baseFp;
  if (!localChanged) return 'apply';
  // ในเครื่องลบไปแล้ว แต่อีกเครื่องแก้หลังจากนั้น: เอากลับมา (ไม่ให้ข้อมูลหาย)
  if (localFp === undefined) return 'apply';
  // แก้ในเครื่องแต่อีกเครื่องลบ: เก็บของในเครื่อง (แล้วส่งขึ้นไปใหม่)
  if (remoteDeleted) return 'keep';
  if (localTime && remoteTime) return remoteTime > localTime ? 'apply' : 'keep';
  // ไม่รู้เวลา: ซิงก์ครั้งแรกของเครื่องนี้ใช้ของบนคลาวด์ (เครื่องที่ใช้อยู่ก่อน) ไม่อย่างนั้นใช้ของในเครื่อง
  return firstSync ? 'apply' : 'keep';
}

/** แบ่งรายการเป็นชุดตามขนาด (ไม่เกินจำนวน/ตัวอักษรต่อคำขอ) */
function chunkSyncRecords(records, maxChars = SYNC_BATCH_CHARS, maxCount = SYNC_BATCH_RECORDS) {
  const out = [];
  let cur = [], chars = 0;
  for (const r of records) {
    const size = (r.data || '').length + r.key.length + 40;
    if (cur.length && (cur.length >= maxCount || chars + size > maxChars)) { out.push(cur); cur = []; chars = 0; }
    cur.push(r);
    chars += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

function formatSyncBytes(n) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`;
}

// ---------- บีบอัด (gzip ในเบราว์เซอร์ ข้อความไทยเล็กลงราว 70-80%) ----------
async function encodeSyncData(obj) {
  const text = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') return `j1:${text}`;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return `z1:${btoa(bin)}`;
}

async function decodeSyncData(str) {
  if (typeof str !== 'string') throw new Error('ข้อมูลซิงก์เสีย');
  if (str.startsWith('j1:')) return JSON.parse(str.slice(3));
  if (!str.startsWith('z1:')) throw new Error('รูปแบบข้อมูลซิงก์ไม่รู้จัก');
  if (typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์นี้แตกไฟล์ข้อมูลซิงก์ไม่ได้ กรุณาอัปเดตเบราว์เซอร์');
  const bin = atob(str.slice(3));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

// ---------- สถานะ ----------
// เปิด/ปิดซิงก์เป็นของแต่ละบัญชี (บัญชีอื่นในเครื่องเดียวกันไม่ได้เปิดตาม)
function syncEnabledKey() {
  return activeDbAccount ? `${SYNC_ENABLED_KEY}@${accountScopeKey(activeDbAccount)}` : SYNC_ENABLED_KEY;
}

function isCloudSyncEnabled() {
  try { return localStorage.getItem(syncEnabledKey()) === 'true'; } catch (e) { return false; }
}

function canUseCloudSync() {
  return typeof isHostedConfigured === 'function' && isHostedConfigured() &&
    typeof isHostedSignedIn === 'function' && isHostedSignedIn() &&
    typeof planAllows === 'function' && planAllows('cloudSync');
}

function isCloudSyncActive() {
  return isCloudSyncEnabled() && canUseCloudSync();
}

async function readSyncState() {
  const s = await dbGetMeta(SYNC_STATE_KEY).catch(() => null);
  return s && typeof s === 'object' && s.fps ? s : { cursor: 0, fps: {}, lastAt: 0, account: '', firstDone: false };
}

function syncAccountId() {
  const s = typeof readHostedSession === 'function' ? readHostedSession() : null;
  return String((typeof hostedMe !== 'undefined' && hostedMe?.email) || s?.email || '').toLowerCase();
}

// ---------- ข้อมูลแยกตามบัญชี ----------
// แต่ละบัญชีมีฐานข้อมูลในเครื่องของตัวเอง (db.js) ซิงก์ได้เฉพาะเมื่อบัญชีที่เข้าสู่ระบบตรงกับฐานข้อมูลที่เปิดอยู่
// นิยายที่อ่านตอนไม่ได้เข้าสู่ระบบอยู่ในฐานของโหมดไม่เข้าสู่ระบบ ย้ายเข้าบัญชีได้เมื่อผู้ใช้เลือกเอง
const GUEST_IMPORT_ASKED_META = 'guestImportAsked';

function isSyncAccountMatched() {
  return typeof sessionAccountId === 'function' && !!activeDbAccount && sessionAccountId() === activeDbAccount;
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return email || '';
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`;
}

async function localLibraryCount() {
  return (await dbGetAllBooks()).filter(b => b.bookId !== 'default_novel').length;
}

/**
 * เข้าสู่ระบบแล้วมีนิยายที่อ่านตอนไม่ได้เข้าสู่ระบบในเครื่องนี้: ถามครั้งเดียวต่อบัญชีว่าจะย้ายมาไว้ในบัญชีไหม
 * (นิยายโหมดไม่เข้าสู่ระบบใครใช้เครื่องนี้ก็เห็นอยู่แล้ว การย้ายจึงไม่ทำให้ข้อมูลของใครรั่ว)
 */
async function offerGuestLibraryImport() {
  if (!isAccountDbActive() || !isSyncAccountMatched()) return;
  if (await dbGetMeta(GUEST_IMPORT_ASKED_META).catch(() => null)) return;
  let guest;
  try {
    guest = await openNamedDB(DB_NAME);
    const books = await new Promise((resolve, reject) => {
      const req = guest.transaction('books', 'readonly').objectStore('books').getAll();
      req.onsuccess = () => resolve((req.result || []).filter(b => b.bookId !== 'default_novel'));
      req.onerror = () => reject(req.error);
    });
    if (!books.length) return;
    await dbSetMeta(GUEST_IMPORT_ASKED_META, Date.now());
    const choice = await appChoose(
      `ในเครื่องนี้มีนิยาย ${books.length} เรื่องที่อ่านตอนไม่ได้เข้าสู่ระบบ ย้ายมาไว้ในบัญชีนี้ไหม\n` +
      'ย้ายแล้วนิยายพวกนี้จะอยู่กับบัญชีนี้ (และซิงก์ได้ถ้าแพ็กเกจรองรับ) และไม่แสดงในโหมดไม่เข้าสู่ระบบอีก ถ้าเป็นนิยายของคนอื่นที่ใช้เครื่องนี้ ให้เลือก "ไม่ย้าย"',
      [{ label: `ย้าย ${books.length} เรื่องมาไว้ในบัญชีนี้`, value: 'move', variant: 'primary' }],
      { title: 'นิยายในโหมดไม่เข้าสู่ระบบ', cancelLabel: 'ไม่ย้าย' });
    if (choice !== 'move') return;
    // ไม่ทับข้อมูลที่บัญชีมีอยู่แล้ว และไม่ย้ายค่าภายใน (สถานะซิงก์/ตัวนับรายวัน) ของโหมดไม่เข้าสู่ระบบ
    await copyAllStores(guest, db, { clearSource: true, onlyMissing: true, skipStores: ['meta'] });
    bookLangCache.clear();
    await refreshInMemoryGlossaryCache();
    markDataChanged('replaced');
    if (typeof homeOpen !== 'undefined' && homeOpen && typeof refreshHome === 'function') await refreshHome();
    showGlobalToast(`ย้ายนิยาย ${books.length} เรื่องมาไว้ในบัญชีนี้แล้ว`);
    setTimeout(hideGlobalToast, 2500);
  } catch (err) {
    console.warn('Guest library import failed:', err);
  } finally {
    guest?.close();
  }
}

/** ลบนิยาย/ตอน/คลังศัพท์ของบัญชีที่เปิดอยู่ออกจากเครื่องนี้ (สำรองไฟล์ก่อนได้) */
async function clearLocalLibraryFromUi() {
  const pick = await appChoose(
    'ลบนิยาย ตอน คลังศัพท์ คู่มือเรื่อง บุ๊กมาร์ก และประวัติคำแปลของบัญชีนี้ออกจากเครื่องนี้\nข้อมูลที่ซิงก์ไว้บนคลาวด์ยังอยู่ (เข้าสู่ระบบอีกครั้งแล้วดึงกลับได้ถ้าแพ็กเกจรองรับซิงก์)\nลบแล้วกู้คืนในเครื่องนี้ไม่ได้ ถ้ายังไม่ได้สำรอง กด "สำรองไฟล์แล้วลบ"',
    [
      { label: '⬇️ สำรองไฟล์แล้วลบ', value: 'backup', variant: 'primary' },
      { label: 'ลบเลย', value: 'delete', variant: 'danger' }
    ],
    { title: 'ล้างข้อมูลในเครื่องนี้' });
  if (!pick) return false;
  if (pick === 'backup') {
    try {
      await downloadBackupFile();
    } catch (err) {
      appAlert(`สำรองไฟล์ไม่สำเร็จ จึงยังไม่ลบข้อมูล: ${err.message}`);
      return false;
    }
  }
  await dbClearLibrary();
  if (typeof resetToGuideBook === 'function') resetToGuideBook();
  if (typeof homeOpen !== 'undefined' && homeOpen && typeof refreshHome === 'function') await refreshHome();
  showGlobalToast('ลบข้อมูลในเครื่องนี้แล้ว');
  setTimeout(hideGlobalToast, 2000);
  return true;
}

async function syncApi(method, path, body) {
  const token = await getHostedAccessToken();
  const res = await fetch(`${HOSTED.apiBase}/sync/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.type = data.error?.type;
    throw err;
  }
  return data;
}

// ---------- อ่าน/เขียนฐานข้อมูลในเครื่อง ----------
function syncScanStore(storeName, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      fn(cursor.value);
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('อ่านข้อมูลในเครื่องไม่สำเร็จ'));
  });
}

function syncGetLocal(ops) {
  return new Promise((resolve, reject) => {
    const stores = [...new Set(ops.map(o => o.store))];
    const out = new Map();
    if (!stores.length) return resolve(out);
    const tx = db.transaction(stores, 'readonly');
    ops.forEach(o => {
      const req = tx.objectStore(o.store).get(o.id);
      req.onsuccess = () => { if (req.result !== undefined) out.set(o.key, req.result); };
    });
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error || new Error('อ่านข้อมูลในเครื่องไม่สำเร็จ'));
  });
}

function syncWriteLocal(ops) {
  return new Promise((resolve, reject) => {
    const stores = [...new Set(ops.map(o => o.store))];
    if (!stores.length) return resolve();
    const tx = db.transaction(stores, 'readwrite');
    ops.forEach(o => {
      const store = tx.objectStore(o.store);
      if (o.deleted) store.delete(o.id);
      else store.put(o.rec);
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('บันทึกข้อมูลจากคลาวด์ไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการบันทึกข้อมูลจากคลาวด์'));
  });
}

// ---------- ซิงก์ ----------
let cloudSyncRunning = null;
let cloudSyncApplying = false;
let cloudSyncTimer = null;
let cloudSyncLast = { at: 0, ok: null, message: '', pulled: 0, pushed: 0 };

/** เรียกจาก markDataChanged (db.js): แก้ข้อมูลแล้วรอให้นิ่งก่อนส่ง */
function scheduleCloudSync() {
  if (cloudSyncApplying || !isCloudSyncActive()) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => runCloudSync().catch(() => {}), SYNC_DEBOUNCE_MS);
}

/** ซิงก์ 1 รอบ (เรียกซ้อนกันได้ รอรอบที่ทำอยู่) pullOnly = ดาวน์โหลดอย่างเดียว (แพ็กเกจหมดอายุก็ทำได้) */
function runCloudSync(opts = {}) {
  if (cloudSyncRunning) return cloudSyncRunning;
  cloudSyncRunning = (async () => {
    try {
      // หลายแท็บ: ให้ซิงก์ทีละแท็บ
      if (navigator.locks?.request) return await navigator.locks.request('dusktale-cloud-sync', () => doCloudSync(opts));
      return await doCloudSync(opts);
    } finally {
      cloudSyncRunning = null;
    }
  })();
  return cloudSyncRunning;
}

async function doCloudSync({ pullOnly = false, onProgress = null } = {}) {
  const report = (msg) => { if (onProgress) onProgress(msg); };
  if (!db) throw new Error('ฐานข้อมูลยังไม่พร้อม');
  if (!isHostedSignedIn()) throw new Error('กรุณาเข้าสู่ระบบ Dusktale ก่อน');
  // ฐานข้อมูลที่เปิดอยู่ต้องเป็นของบัญชีที่เข้าสู่ระบบ (กันแท็บที่ยังเปิดข้อมูลของบัญชีเดิมส่งขึ้นบัญชีใหม่)
  if (!isSyncAccountMatched()) {
    if (typeof reloadIfAccountChanged === 'function') reloadIfAccountChanged();
    throw new Error('เปลี่ยนบัญชีแล้ว กำลังเปิดข้อมูลของบัญชีนี้ ซิงก์อีกครั้งหลังรีโหลด');
  }
  let state = await readSyncState();
  // เปลี่ยนบัญชี: เริ่มนับใหม่ (ไม่เอาลายนิ้วมือของบัญชีอื่นมาเทียบ)
  const account = syncAccountId();
  if (account && state.account && state.account !== account) state = { cursor: 0, fps: {}, lastAt: 0, account, firstDone: false };
  state.account = account || state.account;
  const firstSync = !state.firstDone;
  const touched = { stores: new Set(), bookIds: new Set(), chapIds: new Set(), deletedChapters: false };
  let pulled = 0, pushed = 0;

  // 1) ดึงของใหม่จากคลาวด์
  report('กำลังดึงข้อมูลจากคลาวด์...');
  for (let page = 0; page < 1000; page++) {
    const res = await syncApi('GET', `pull?since=${encodeURIComponent(state.cursor || 0)}&limit=100`);
    const records = Array.isArray(res.records) ? res.records : [];
    if (records.length) {
      const ops = [];
      for (const r of records) {
        const def = parseSyncKey(r.key);
        if (!def) continue;
        let rec = null;
        if (!r.deleted) {
          try {
            rec = BACKUP_SANITIZERS[def.store](await decodeSyncData(r.data));
          } catch (e) {
            console.warn('sync: skip bad record', r.key, e.message);
            continue;
          }
          if (!rec || def.idOf(rec) !== def.id) continue;
        }
        ops.push({ key: r.key, store: def.store, id: def.id, deleted: !!r.deleted, rec });
      }
      const locals = await syncGetLocal(ops);
      const writes = [];
      for (const op of ops) {
        const local = locals.get(op.key);
        const localFp = local === undefined ? undefined : syncFingerprint(local);
        // เหมือนในเครื่องอยู่แล้ว (เช่นของที่เครื่องนี้เพิ่งส่งขึ้นไปเอง): จำลายนิ้วมือ ไม่ต้องเขียนซ้ำ
        if (!op.deleted && localFp !== undefined && localFp === syncFingerprint(op.rec)) { state.fps[op.key] = localFp; continue; }
        const decision = decideSyncMerge({
          baseFp: state.fps[op.key], localFp, remoteDeleted: op.deleted,
          localTime: syncRecordTime(op.store, local), remoteTime: syncRecordTime(op.store, op.rec), firstSync
        });
        if (decision !== 'apply') continue;
        if (op.deleted && local === undefined) { delete state.fps[op.key]; continue; }
        // ตอนที่แก้ในเครื่องแต่แพ้: เก็บฉบับในเครื่องไว้ในประวัติเวอร์ชัน
        if (op.store === 'chapters' && local && localFp !== state.fps[op.key] && localFp !== syncFingerprint(op.rec || {})) {
          await dbAddChapterVersion({
            id: `ver_${local.id}_${Date.now()}_sync`, chapId: local.id, bookId: local.bookId, at: Date.now(), reason: 'sync',
            title: local.title, summary: local.summary || '', chapterType: local.chapterType, translationMeta: local.translationMeta,
            paragraphs: local.paragraphs || []
          }).catch(() => {});
        }
        writes.push(op);
      }
      if (writes.length) {
        cloudSyncApplying = true;
        try {
          await syncWriteLocal(writes);
          // แจ้งแท็บอื่นในเครื่องนี้ (ไม่ตั้งรอบซิงก์ใหม่ เพราะ cloudSyncApplying)
          const kinds = { books: 'books', chapters: 'chapters', glossaries: 'glossary', bookData: 'bookData' };
          [...new Set(writes.map(w => w.store))].forEach(s => markDataChanged(kinds[s]));
        } finally { cloudSyncApplying = false; }
        writes.forEach(op => {
          if (op.deleted) delete state.fps[op.key];
          else state.fps[op.key] = syncFingerprint(op.rec);
          touched.stores.add(op.store);
          const bookId = op.store === 'chapters' ? (op.rec?.bookId || locals.get(op.key)?.bookId) : (op.store === 'glossaries' ? null : op.id);
          if (bookId) touched.bookIds.add(bookId);
          if (op.store === 'chapters') { touched.chapIds.add(op.id); if (op.deleted) touched.deletedChapters = true; }
        });
        pulled += writes.length;
      }
    }
    state.cursor = Math.max(state.cursor || 0, Number(res.next) || 0);
    await dbSetMeta(SYNC_STATE_KEY, state);
    if (!res.more || !records.length) break;
    report(`กำลังดึงข้อมูลจากคลาวด์... (${pulled} รายการ)`);
  }
  if (pulled) await refreshAfterCloudPull(touched);

  // 2) ส่งของที่เปลี่ยนในเครื่องขึ้นไป
  let pushError = null;
  if (!pullOnly && planAllows('cloudSync')) {
    report('กำลังตรวจข้อมูลที่เปลี่ยนในเครื่อง...');
    const changed = [];
    const seen = new Set();
    for (const def of SYNC_STORES) {
      await syncScanStore(def.store, (rec) => {
        const key = syncKeyOf(def, rec);
        if (!key) return;
        seen.add(key);
        const fp = syncFingerprint(rec);
        if (state.fps[key] !== fp) changed.push({ key, fp, rec });
      });
    }
    const deletedKeys = Object.keys(state.fps).filter(k => !seen.has(k));
    const outgoing = [];
    for (const c of changed) outgoing.push({ key: c.key, fp: c.fp, data: await encodeSyncData(c.rec) });
    deletedKeys.forEach(key => outgoing.push({ key, deleted: true }));
    const batches = chunkSyncRecords(outgoing);
    for (let i = 0; i < batches.length; i++) {
      report(`กำลังส่งขึ้นคลาวด์... (${pushed}/${outgoing.length} รายการ)`);
      try {
        const res = await syncApi('POST', 'push', { records: batches[i].map(r => r.deleted ? { key: r.key, deleted: true } : { key: r.key, data: r.data }) });
        batches[i].forEach(r => { if (r.deleted) delete state.fps[r.key]; else state.fps[r.key] = r.fp; });
        pushed += batches[i].length;
        // seq ของที่เราเพิ่งส่ง ไม่ต้องดึงกลับมาอีก (ถ้าไม่มีเครื่องอื่นเขียนแทรก)
        if (Number(res.seq) && i === batches.length - 1) state.pushedSeq = Number(res.seq);
        await dbSetMeta(SYNC_STATE_KEY, state);
      } catch (err) {
        pushError = err;
        break;
      }
    }
  }
  state.firstDone = true;
  state.lastAt = Date.now();
  await dbSetMeta(SYNC_STATE_KEY, state);
  cloudSyncLast = {
    at: state.lastAt, ok: !pushError, pulled, pushed,
    message: pushError ? pushError.message : ''
  };
  if (typeof renderCloudSyncBox === 'function') renderCloudSyncBox();
  if (pushError) throw pushError;
  return cloudSyncLast;
}

/** ข้อมูลจากเครื่องอื่นเข้ามาแล้ว: อัปเดตหน้าจอโดยไม่เลื่อนตำแหน่งที่อ่านอยู่ */
async function refreshAfterCloudPull(touched) {
  try {
    await dbGetAllBooks();  // อัปเดตภาษาของแต่ละเรื่องใน cache
    if (touched.stores.has('glossaries')) {
      await refreshInMemoryGlossaryCache();
      if (document.getElementById('glossary-modal')?.classList.contains('active') && typeof renderGlossaryUI === 'function') await renderGlossaryUI();
    }
    const bookId = typeof currentBookId !== 'undefined' ? currentBookId : null;
    if (bookId && bookId !== 'default_novel' && touched.bookIds.has(bookId)) {
      if (touched.stores.has('bookData') && typeof refreshBookmarkCache === 'function') {
        await refreshBookmarkCache(bookId);
        if (typeof refreshBookmarkMarkers === 'function') refreshBookmarkMarkers();
      }
      if (touched.stores.has('chapters')) {
        const fresh = await dbGetChaptersByBook(bookId);
        if (touched.deletedChapters) {
          // มีตอนถูกลบจากเครื่องอื่น: โหลดเรื่องใหม่ที่ตอนเดิม
          const curId = chapters[currentChapterIndex]?.id;
          await loadBookFromDB(bookId, fresh.some(c => c.id === curId) ? curId : undefined);
        } else {
          const byId = new Map(fresh.map(c => [c.id, c]));
          let needsRender = false;
          chapters.forEach((mine, idx) => {
            if (!touched.chapIds.has(mine.id) || !byId.has(mine.id)) return;
            replaceChapterContents(mine, byId.get(mine.id));
            if (renderedWindowIndices.includes(idx)) needsRender = true;
          });
          const known = new Set(chapters.map(c => c.id));
          const lastOrder = chapters.reduce((m, c) => Math.max(m, c.order || 0), 0);
          const appended = fresh.filter(c => !known.has(c.id) && (c.order || 0) > lastOrder).sort((a, b) => a.order - b.order);
          if (appended.length) {
            chapters.push(...appended);
            nextUrlCalculated = chapters[chapters.length - 1].nextUrl || null;
            if (!needsRender && typeof appendNextChapterToWindow === 'function') appendNextChapterToWindow();
            if (typeof checkAndRefreshBottomStatus === 'function') checkAndRefreshBottomStatus();
          }
          if (needsRender) await renderVirtualWindow(currentChapterIndex);
        }
      }
    }
    if (typeof homeOpen !== 'undefined' && homeOpen && typeof refreshHome === 'function') await refreshHome();
  } catch (err) {
    console.warn('refresh after cloud sync failed:', err);
  }
}

// ---------- หน้าตั้งค่า → ข้อมูล: กล่องซิงก์ ----------
let cloudSyncStatus = null;

async function renderCloudSyncBox(refreshStatus = false) {
  const box = document.getElementById('cloud-sync-box');
  if (!box) return;
  if (typeof isHostedConfigured !== 'function' || !isHostedConfigured()) { box.hidden = true; return; }
  box.hidden = false;
  const head = '<div class="plan-head"><b>☁️ ซิงก์หลายเครื่อง + สำรองบนคลาวด์</b></div>';
  if (!isHostedSignedIn()) {
    box.innerHTML = `<div class="plan-card">${head}<div class="hint">อ่านต่อได้ทุกเครื่อง ชั้นหนังสือ ตอนที่แปล คลังศัพท์ คู่มือเรื่อง และบุ๊กมาร์กตรงกันทุกเครื่อง (แพ็กเกจ Plus ขึ้นไป) เข้าสู่ระบบก่อนเพื่อใช้งาน</div>
      <div><button class="btn btn-sm btn-primary" onclick="openHostedSignIn()">เข้าสู่ระบบ</button></div></div>`;
    return;
  }
  const allowed = planAllows('cloudSync');
  const enabled = isCloudSyncEnabled();
  if (refreshStatus || !cloudSyncStatus) {
    try { cloudSyncStatus = await syncApi('GET', 'status'); } catch (e) { cloudSyncStatus = cloudSyncStatus || null; }
  }
  const st = cloudSyncStatus;
  const usage = st && st.limit ? `ใช้พื้นที่ ${formatSyncBytes(st.used)} จาก ${formatSyncBytes(st.limit)} · ${st.count} รายการ` : (st && st.count ? `บนคลาวด์มี ${st.count} รายการ (${formatSyncBytes(st.used)})` : '');
  const last = cloudSyncLast.at ? `ซิงก์ล่าสุด ${new Date(cloudSyncLast.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}${cloudSyncLast.ok === false ? ` · ไม่สำเร็จ: ${cloudSyncLast.message}` : ` · รับ ${cloudSyncLast.pulled} ส่ง ${cloudSyncLast.pushed} รายการ`}` : '';
  if (!allowed) {
    const hasCloud = st && st.count > 0;
    box.innerHTML = `<div class="plan-card">${head}
      <div class="hint">${describePlanLimit('cloudSync')}${hasCloud ? ` · ${usage} ดาวน์โหลดลงเครื่องนี้ได้เสมอ` : ''}</div>
      <div class="plan-sub-actions"><button class="btn btn-sm btn-primary" onclick="openPlansModal()">ดูแพ็กเกจ</button>
        ${hasCloud ? '<button class="btn btn-sm" onclick="cloudSyncFromUi(true)">ดาวน์โหลดข้อมูลจากคลาวด์</button>' : ''}</div>
      <div id="cloud-sync-msg" class="hint" aria-live="polite">${escapeHtml(last)}</div></div>`;
    return;
  }
  box.innerHTML = `<div class="plan-card">${head}
    <label class="form-label" style="display: flex; gap: 8px; align-items: center; cursor: pointer;">
      <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleCloudSync(this.checked, this)"> ซิงก์อัตโนมัติในเครื่องนี้
    </label>
    <div class="hint">ซิงก์ชั้นหนังสือ ตำแหน่งอ่าน ตอนที่แปล คลังศัพท์ คู่มือเรื่อง บุ๊กมาร์ก และปก ไม่ซิงก์ API Key ค่าตั้งของเครื่อง และประวัติเวอร์ชัน · แก้ตอนเดียวกันจากสองเครื่อง ฉบับที่แพ้เก็บไว้ในประวัติเวอร์ชัน</div>
    ${usage ? `<div class="hint">${escapeHtml(usage)}</div>` : ''}
    <div class="plan-sub-actions"><button class="btn btn-sm" id="cloud-sync-now-btn" onclick="cloudSyncFromUi(false)">ซิงก์ตอนนี้</button></div>
    <div id="cloud-sync-msg" class="hint" aria-live="polite">${escapeHtml(last)}</div></div>`;
}

async function toggleCloudSync(on, chk) {
  if (on && !isCloudSyncEnabled()) {
    const ok = await appConfirm('ข้อมูลในเครื่องนี้ (ชั้นหนังสือ ตอนที่แปล คลังศัพท์ คู่มือเรื่อง บุ๊กมาร์ก) จะถูกบีบอัดแล้วเก็บบนคลาวด์ของ Dusktale เพื่อให้เครื่องอื่นที่เข้าสู่ระบบบัญชีเดียวกันดึงไปได้ ถ้าเครื่องอื่นซิงก์ไว้ก่อนแล้ว ข้อมูลจะรวมกัน\nไม่มีการส่ง API Key ดู "นโยบายความเป็นส่วนตัว" ข้อ 4.1', { title: 'เปิดซิงก์หลายเครื่อง', confirmLabel: 'เปิดซิงก์' });
    if (!ok) { if (chk) chk.checked = false; return; }
  }
  try { localStorage.setItem(syncEnabledKey(), on ? 'true' : 'false'); } catch (e) {}
  if (on) cloudSyncFromUi(false);
  else renderCloudSyncBox();
}

async function cloudSyncFromUi(pullOnly) {
  const btn = document.getElementById('cloud-sync-now-btn');
  const msg = document.getElementById('cloud-sync-msg');
  if (btn) btn.disabled = true;
  try {
    const r = await runCloudSync({ pullOnly, onProgress: (t) => { if (msg) msg.textContent = t; } });
    if (msg) msg.textContent = `ซิงก์เสร็จแล้ว · รับ ${r?.pulled || 0} ส่ง ${r?.pushed || 0} รายการ`;
    await renderCloudSyncBox(true);
  } catch (err) {
    if (msg) { msg.textContent = `ซิงก์ไม่สำเร็จ: ${err.message}`; msg.className = 'hint text-danger'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- ซิงก์อัตโนมัติ ----------
document.addEventListener('DOMContentLoaded', () => {
  // เปิดแอพ: ดึงของใหม่จากเครื่องอื่นแล้วส่งของเครื่องนี้
  setTimeout(() => { if (isCloudSyncActive()) runCloudSync().catch(err => console.warn('cloud sync:', err.message)); }, 5000);
  setInterval(() => {
    if (document.visibilityState === 'visible' && isCloudSyncActive()) runCloudSync().catch(() => {});
  }, SYNC_INTERVAL_MS);
  // กลับมาที่แท็บ (สลับจากเครื่อง/แอพอื่น): ดึงของใหม่ถ้าไม่ได้ซิงก์มาเกิน 1 นาที
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isCloudSyncActive() && Date.now() - (cloudSyncLast.at || 0) > 60000) runCloudSync().catch(() => {});
    // ออกจากแท็บ: ส่งที่ค้างอยู่เลย ไม่ต้องรอ 30 วินาที
    if (document.visibilityState === 'hidden' && cloudSyncTimer && isCloudSyncActive()) {
      clearTimeout(cloudSyncTimer);
      cloudSyncTimer = null;
      runCloudSync().catch(() => {});
    }
  });
});
