// ==================== INDEXEDDB ENGINE ====================
const DB_NAME = 'NovelTranslateDB_v12';
// v3: เพิ่ม store bookData (คู่มือเรื่อง/กฎแทนคำ/ตัวอย่างสำนวน ใช้ในขั้นถัดไป)
// v4: เพิ่ม store meta (ข้อมูลภายในของแอพ เช่นโฟลเดอร์สำรองอัตโนมัติ ไม่รวมในไฟล์สำรอง)
// v5: เพิ่ม store usage (สถิติ token ที่ใช้จริง แยกวัน/ผู้ให้บริการ/โมเดล/เรื่อง และค่าเฉลี่ยต่อตอน)
// v6: เพิ่ม store chapterVersions (คำแปลฉบับก่อนหน้าของแต่ละตอน ไว้เทียบ/กู้คืน แยกจาก chapters เพื่อให้โหลดตอนเร็วเหมือนเดิม)
// ฟิลด์ใหม่ใน record เดิมไม่ต้อง migrate เพราะทุกจุดอ่านผ่านค่า default ด้านล่าง
const DB_VERSION = 6;
let db = null;
let inMemoryGlossaryCache = [];

const DEFAULT_SOURCE_LANG = 'zh';

// ---------- ค่า default สำหรับข้อมูลรุ่นเก่า ----------
// chapter.chapterType: 'story' | 'side_story' | 'author_note' | 'placeholder'
// paragraph.kind: 'story' | 'author_note' | 'site_junk' (ไม่มี = story)
// paragraph.thDraft: ร่างแรกก่อนเกลา, paragraph.userEdited: ผู้ใช้แก้เอง
// chapter.translationMeta: { provider, model, verifyMode, promptVersion, translatedAt }
function normalizeChapter(chap) {
  if (!chap) return chap;
  if (!chap.chapterType) chap.chapterType = 'story';
  if (!Array.isArray(chap.paragraphs)) chap.paragraphs = [];
  return chap;
}

function getBookSourceLang(book) {
  return book?.sourceLang || DEFAULT_SOURCE_LANG;
}

function getTermLang(item) {
  return item?.lang || DEFAULT_SOURCE_LANG;
}

function cleanTermString(str) {
  if (!str) return "";
  return String(str)
    .trim()
    .replace(/^[\s【】\[\]「」“”‘’"']+|[\s【】\[\]「」“”‘’"']+$/g, '')
    .replace(/\s+/g, ' ');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function jsArg(value) {
  return escapeHtml(JSON.stringify(String(value ?? '')));
}

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('books')) {
        d.createObjectStore('books', { keyPath: 'bookId' });
      }
      if (!d.objectStoreNames.contains('chapters')) {
        const chapStore = d.createObjectStore('chapters', { keyPath: 'id' });
        chapStore.createIndex('bookId', 'bookId', { unique: false });
        chapStore.createIndex('bookId_order', ['bookId', 'order'], { unique: false });
      } else {
        const chapStore = e.target.transaction.objectStore('chapters');
        if (!chapStore.indexNames.contains('bookId_order')) {
          chapStore.createIndex('bookId_order', ['bookId', 'order'], { unique: false });
        }
      }
      if (!d.objectStoreNames.contains('glossaries')) {
        const glossStore = d.createObjectStore('glossaries', { keyPath: 'src' });
        glossStore.createIndex('category', 'category', { unique: false });
      }
      if (!d.objectStoreNames.contains('bookData')) {
        d.createObjectStore('bookData', { keyPath: 'bookId' });
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!d.objectStoreNames.contains('usage')) {
        const usageStore = d.createObjectStore('usage', { keyPath: 'id' });
        usageStore.createIndex('month', 'month', { unique: false });
      }
      if (!d.objectStoreNames.contains('chapterVersions')) {
        const verStore = d.createObjectStore('chapterVersions', { keyPath: 'id' });
        verStore.createIndex('chapId', 'chapId', { unique: false });
        verStore.createIndex('bookId', 'bookId', { unique: false });
      }
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      // แท็บที่เปิดแอพรุ่นใหม่กว่าต้องการอัปเกรดฐานข้อมูล: ปิดของแท็บนี้แล้วบอกผู้ใช้ให้รีโหลด
      db.onversionchange = () => {
        db.close();
        if (typeof onDatabaseVersionChange === 'function') onDatabaseVersionChange();
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('เปิดฐานข้อมูลไม่สำเร็จ'));
    req.onblocked = () => reject(new Error('ฐานข้อมูลถูกเปิดค้างในแท็บอื่น กรุณาปิดแท็บเดิมแล้วลองใหม่'));
  });
}

// แจ้งว่าข้อมูลเปลี่ยน: ใช้เตือนสำรองข้อมูล และบอกแท็บอื่นให้รีเฟรช (ตัวรับอยู่ใน safety.js)
// kind: 'books' | 'chapters' | 'glossary' | 'bookData' | 'replaced'
function markDataChanged(kind, bookId = null) {
  if (typeof onLocalDataChanged === 'function') onLocalDataChanged(kind, bookId);
}

function dbGetMeta(key) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const req = db.transaction('meta', 'readonly').objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
    req.onerror = () => reject(req.error || new Error('อ่านข้อมูลภายในไม่สำเร็จ'));
  });
}

function dbSetMeta(key, value) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('meta', 'readwrite');
    if (value === undefined) tx.objectStore('meta').delete(key);
    else tx.objectStore('meta').put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('บันทึกข้อมูลภายในไม่สำเร็จ'));
  });
}

// ---------- สถิติการใช้งาน AI ----------
/** อ่าน-แก้-เขียนเรคคอร์ดเดียวใน transaction เดียว (กันสองคำขอพร้อมกันเขียนทับกัน) */
function dbUpdateUsage(id, updater) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('usage', 'readwrite');
    const store = tx.objectStore('usage');
    const req = store.get(id);
    req.onsuccess = () => store.put(updater(req.result));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('บันทึกสถิติการใช้งานไม่สำเร็จ'));
  });
}

function dbGetUsage(id) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const req = db.transaction('usage', 'readonly').objectStore('usage').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function dbGetUsageByMonth(month) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const req = db.transaction('usage', 'readonly').objectStore('usage').index('month').getAll(month);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAllUsage() {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const req = db.transaction('usage', 'readonly').objectStore('usage').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbClearUsage() {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('usage', 'readwrite');
    tx.objectStore('usage').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ภาษาต้นฉบับของแต่ละเรื่อง (ใช้กรองคำศัพท์แบบสากลให้ตรงภาษา โดยไม่ต้องอ่านฐานข้อมูลทุกครั้งที่แสดงผล)
const bookLangCache = new Map();

function getCachedBookLang(bookId) {
  return bookLangCache.get(bookId) || DEFAULT_SOURCE_LANG;
}

function dbSaveBook(book) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').put(book);
    tx.oncomplete = () => {
      if (book?.bookId) bookLangCache.set(book.bookId, getBookSourceLang(book));
      markDataChanged('books', book?.bookId);
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error('บันทึกหนังสือไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการบันทึกหนังสือ'));
  });
}

function dbSaveChapter(chapter) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('chapters', 'readwrite');
    tx.objectStore('chapters').put(chapter);
    tx.oncomplete = () => { markDataChanged('chapters', chapter?.bookId); resolve(); };
    tx.onerror = () => reject(tx.error || new Error('บันทึกตอนนิยายไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการบันทึกตอนนิยาย'));
  });
}

/** บันทึกหลายตอนใน transaction เดียว (ใช้ตอนนำเข้าไฟล์/สารบัญที่มีหลายร้อยตอน) */
function dbSaveChapters(list) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    if (!list?.length) return resolve();
    const tx = db.transaction('chapters', 'readwrite');
    const store = tx.objectStore('chapters');
    list.forEach(ch => store.put(ch));
    tx.oncomplete = () => { markDataChanged('chapters', list[0]?.bookId); resolve(); };
    tx.onerror = () => reject(tx.error || new Error('บันทึกตอนนิยายไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการบันทึกตอนนิยาย'));
  });
}

function dbGetAllBooks() {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('books', 'readonly');
    const req = tx.objectStore('books').getAll();
    req.onsuccess = () => {
      const books = req.result || [];
      books.forEach(b => bookLangCache.set(b.bookId, getBookSourceLang(b)));
      resolve(books);
    };
    req.onerror = () => reject(req.error || new Error('อ่านรายชื่อหนังสือไม่สำเร็จ'));
  });
}

function dbGetChaptersByBook(bookId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('chapters', 'readonly');
    const index = tx.objectStore('chapters').index('bookId_order');
    const req = index.getAll(IDBKeyRange.bound([bookId, 0], [bookId, Number.MAX_SAFE_INTEGER]));
    req.onsuccess = () => resolve((req.result || []).map(normalizeChapter));
    req.onerror = () => reject(req.error || new Error('อ่านตอนนิยายไม่สำเร็จ'));
  });
}

function dbGetBookData(bookId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const req = db.transaction('bookData', 'readonly').objectStore('bookData').get(bookId);
    req.onsuccess = () => resolve(req.result || { bookId });
    req.onerror = () => reject(req.error || new Error('อ่านข้อมูลเสริมของนิยายไม่สำเร็จ'));
  });
}

function dbSaveBookData(data) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    if (!data?.bookId) return reject(new Error('ไม่พบรหัสนิยาย'));
    const tx = db.transaction('bookData', 'readwrite');
    tx.objectStore('bookData').put(data);
    tx.oncomplete = () => { markDataChanged('bookData', data.bookId); resolve(); };
    tx.onerror = () => reject(tx.error || new Error('บันทึกข้อมูลเสริมของนิยายไม่สำเร็จ'));
  });
}

// ---------- ประวัติเวอร์ชันของตอน ----------
// rec: { id, chapId, bookId, at, reason, title, summary, chapterType, translationMeta, paragraphs[] }
/** เพิ่มฉบับเก่าของตอน แล้วตัดฉบับที่เก่าที่สุดให้เหลือไม่เกิน keep ฉบับ (ใน transaction เดียว) */
function dbAddChapterVersion(rec, keep = 3) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('chapterVersions', 'readwrite');
    const store = tx.objectStore('chapterVersions');
    store.put(rec);
    const req = store.index('chapId').getAll(rec.chapId);
    req.onsuccess = () => {
      const list = (req.result || []).sort((a, b) => (b.at || 0) - (a.at || 0));
      list.slice(Math.max(1, keep)).forEach(v => store.delete(v.id));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('บันทึกประวัติเวอร์ชันไม่สำเร็จ'));
  });
}

/** ฉบับก่อนหน้าของตอน เรียงจากใหม่ไปเก่า */
function dbGetChapterVersions(chapId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const req = db.transaction('chapterVersions', 'readonly').objectStore('chapterVersions').index('chapId').getAll(chapId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => (b.at || 0) - (a.at || 0)));
    req.onerror = () => reject(req.error || new Error('อ่านประวัติเวอร์ชันไม่สำเร็จ'));
  });
}

function dbDeleteChapterVersion(id) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('chapterVersions', 'readwrite');
    tx.objectStore('chapterVersions').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('ลบประวัติเวอร์ชันไม่สำเร็จ'));
  });
}

/** จำนวนฉบับก่อนหน้าของแต่ละตอนในเรื่อง Map(chapId -> จำนวน) */
function dbCountChapterVersionsByBook(bookId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const req = db.transaction('chapterVersions', 'readonly').objectStore('chapterVersions').index('bookId').getAll(bookId);
    req.onsuccess = () => {
      const counts = new Map();
      (req.result || []).forEach(v => counts.set(v.chapId, (counts.get(v.chapId) || 0) + 1));
      resolve(counts);
    };
    req.onerror = () => reject(req.error || new Error('อ่านประวัติเวอร์ชันไม่สำเร็จ'));
  });
}

function dbDeleteBook(bookId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction(['books', 'chapters', 'glossaries', 'bookData', 'chapterVersions'], 'readwrite');
    tx.objectStore('books').delete(bookId);
    tx.objectStore('bookData').delete(bookId);
    const chapStore = tx.objectStore('chapters');
    const index = chapStore.index('bookId');
    const req = index.getAllKeys(bookId);
    req.onsuccess = () => { (req.result || []).forEach(k => chapStore.delete(k)); };
    const verStore = tx.objectStore('chapterVersions');
    const verReq = verStore.index('bookId').getAllKeys(bookId);
    verReq.onsuccess = () => { (verReq.result || []).forEach(k => verStore.delete(k)); };

    // ถอด bookId ออกจากคำศัพท์ที่เคยผูกไว้ ไม่ให้เหลือแท็ก "ไม่ทราบชื่อเรื่อง"
    const glossStore = tx.objectStore('glossaries');
    glossStore.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      const item = cursor.value;
      const hasBook = Array.isArray(item.books) && item.books.includes(bookId);
      const hasOverride = item.overrides && Object.prototype.hasOwnProperty.call(item.overrides, bookId);
      if (hasBook || hasOverride) {
        if (hasBook) item.books = item.books.filter(b => b !== bookId);
        if (hasOverride) delete item.overrides[bookId];
        cursor.update(item);
      }
      cursor.continue();
    };

    tx.oncomplete = () => {
      inMemoryGlossaryCache.forEach(item => {
        if (Array.isArray(item.books)) item.books = item.books.filter(b => b !== bookId);
        if (item.overrides) delete item.overrides[bookId];
      });
      markDataChanged('books', bookId);
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error('ลบหนังสือไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการลบหนังสือ'));
  });
}

function dbDeleteMultipleChapters(chapIds) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    if (!chapIds || chapIds.length === 0) return resolve();
    const tx = db.transaction(['chapters', 'chapterVersions'], 'readwrite');
    const chapStore = tx.objectStore('chapters');
    chapIds.forEach(id => chapStore.delete(id));
    // ลบฉบับเก่าของตอนที่ลบด้วย
    const verStore = tx.objectStore('chapterVersions');
    chapIds.forEach(id => {
      const r = verStore.index('chapId').getAllKeys(id);
      r.onsuccess = () => (r.result || []).forEach(k => verStore.delete(k));
    });
    tx.oncomplete = () => { markDataChanged('chapters'); resolve(); };
    tx.onerror = () => reject(tx.error || new Error('ลบตอนนิยายไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการลบตอนนิยาย'));
  });
}

/**
 * ย้ายตอนไปอยู่อีกเรื่อง (ใช้แยกนิยายที่เคยถูกรวมผิดเรื่อง) ทำใน transaction เดียว
 * ตอนที่ย้ายจะต่อท้ายลำดับของเรื่องปลายทาง โดยคงลำดับเดิมระหว่างกัน
 * คำศัพท์ที่ผูกกับเรื่องต้นทางจะถูกผูกกับเรื่องปลายทางด้วย (รวมคำแปลเฉพาะเรื่อง)
 */
function dbMoveChapters(chapIds, fromBookId, toBook) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    if (!chapIds?.length || !toBook?.bookId) return resolve();
    const toBookId = toBook.bookId;
    const tx = db.transaction(['books', 'chapters', 'glossaries', 'chapterVersions'], 'readwrite');
    const chapStore = tx.objectStore('chapters');
    const idSet = new Set(chapIds);
    // ฉบับเก่าของตอนที่ย้าย ย้ายตามไปเรื่องใหม่ด้วย (ลบเรื่องเดิมแล้วจะไม่หาย)
    const verStore = tx.objectStore('chapterVersions');
    chapIds.forEach(id => {
      const r = verStore.index('chapId').getAll(id);
      r.onsuccess = () => (r.result || []).forEach(v => { v.bookId = toBookId; verStore.put(v); });
    });

    const targetReq = chapStore.index('bookId').getAll(toBookId);
    targetReq.onsuccess = () => {
      let nextOrder = (targetReq.result || []).reduce((max, c) => Math.max(max, c.order || 0), 0);
      const srcReq = chapStore.index('bookId').getAll(fromBookId);
      srcReq.onsuccess = () => {
        const moving = (srcReq.result || []).filter(c => idSet.has(c.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
        moving.forEach(c => {
          c.bookId = toBookId;
          c.order = ++nextOrder;
          chapStore.put(c);
        });
        const last = moving[moving.length - 1];
        const first = moving[0];
        tx.objectStore('books').put({
          ...toBook,
          lastChapterId: toBook.lastChapterId || first?.id,
          lastChapterTitle: toBook.lastChapterTitle || first?.title,
          lastChapterIndex: toBook.lastChapterIndex || 0,
          totalChapters: nextOrder,
          lastUrl: last?.sourceUrl || toBook.lastUrl || '',
          updatedAt: Date.now()
        });
      };
    };

    tx.objectStore('glossaries').openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      const item = cursor.value;
      let changed = false;
      if (Array.isArray(item.books) && item.books.includes(fromBookId) && !item.books.includes(toBookId)) {
        item.books.push(toBookId);
        changed = true;
      }
      if (item.overrides && item.overrides[fromBookId] && !item.overrides[toBookId]) {
        item.overrides[toBookId] = item.overrides[fromBookId];
        changed = true;
      }
      if (changed) cursor.update(item);
      cursor.continue();
    };

    tx.oncomplete = async () => {
      await refreshInMemoryGlossaryCache();
      markDataChanged('chapters', toBookId);
      markDataChanged('glossary');
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error('ย้ายตอนไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการย้ายตอน'));
  });
}

// ==================== BACKUP (EXPORT / IMPORT) ====================
const BACKUP_FORMAT = 'NovelTranslateBackup';
// v1 (แอพ v2.6): books, chapters, glossaries | v2 (แอพ v2.7+): เพิ่ม bookData
// v3 (แอพ v3.0+): เพิ่ม settings (การตั้งค่าที่ไม่ใช่ API Key, ใส่โดย safety.js) และ usage (สถิติการใช้ AI, ไม่บังคับ)
const BACKUP_VERSION = 3;
const BACKUP_REQUIRED_STORES = ['books', 'chapters', 'glossaries'];
// chapterVersions (แอพ v3.7+): ไฟล์สำรองรุ่นเก่าไม่มี ถือว่าว่าง
const BACKUP_STORES = ['books', 'chapters', 'glossaries', 'bookData', 'usage', 'chapterVersions'];

function dbExportAll() {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction(BACKUP_STORES, 'readonly');
    const result = { format: BACKUP_FORMAT, version: BACKUP_VERSION, dbVersion: DB_VERSION, exportedAt: new Date().toISOString() };
    BACKUP_STORES.forEach(name => {
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => { result[name] = req.result || []; };
    });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('อ่านข้อมูลเพื่อสำรองไม่สำเร็จ'));
  });
}

function isValidBackup(data) {
  return !!data && typeof data === 'object' && data.format === BACKUP_FORMAT &&
    (!data.version || (Number.isFinite(data.version) && data.version <= BACKUP_VERSION)) &&
    BACKUP_REQUIRED_STORES.every(name => Array.isArray(data[name]));
}

// ---------- ตรวจไฟล์สำรองก่อนนำเข้า ----------
// ไฟล์สำรองอาจมาจากคนอื่น: ตรวจชนิดของฟิลด์ที่แอพใช้ ตัดเรคคอร์ดที่ใช้ไม่ได้ และตัด key อันตราย (__proto__ ฯลฯ)
// ฟิลด์อื่นที่ไม่รู้จักเก็บไว้ตามเดิม เพื่อให้ข้อมูลจากแอพรุ่นใหม่กว่าเล็กน้อยไม่หายระหว่างสำรอง/นำเข้า
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ID_LENGTH = 500;

function isPlainRecord(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function stripDangerousKeys(value, depth = 0) {
  if (depth > 24) return undefined;
  if (Array.isArray(value)) return value.map(v => stripDangerousKeys(v, depth + 1)).filter(v => v !== undefined);
  if (isPlainRecord(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      const cleaned = stripDangerousKeys(v, depth + 1);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  return value;
}

function isValidId(x) {
  return typeof x === 'string' && x.length > 0 && x.length <= MAX_ID_LENGTH;
}

function asText(x) {
  return typeof x === 'string' ? x : (x == null ? '' : String(x));
}

function asHttpUrl(x) {
  return typeof x === 'string' && /^https?:\/\//i.test(x.trim()) ? x.trim() : '';
}

function sanitizeBookRecord(raw) {
  const b = stripDangerousKeys(raw);
  if (!isPlainRecord(b) || !isValidId(b.bookId)) return null;
  b.title = asText(b.title);
  if ('author' in b) b.author = asText(b.author);
  if ('genre' in b) b.genre = asText(b.genre);
  if ('sourceLang' in b) b.sourceLang = typeof normalizeLang === 'function' ? normalizeLang(b.sourceLang) : asText(b.sourceLang);
  ['lastChapterIndex', 'lastParaIndex', 'totalChapters', 'updatedAt'].forEach(k => {
    if (k in b && !Number.isFinite(b[k])) delete b[k];
  });
  if ('lastChapterId' in b && !isValidId(b.lastChapterId)) delete b.lastChapterId;
  if ('lastUrl' in b) b.lastUrl = asHttpUrl(b.lastUrl);
  return b;
}

function sanitizeChapterRecord(raw) {
  const c = stripDangerousKeys(raw);
  if (!isPlainRecord(c) || !isValidId(c.id) || !isValidId(c.bookId)) return null;
  // ลำดับต้องเป็นตัวเลข >= 0 ไม่อย่างนั้นตอนจะไม่อยู่ใน index และหายจากหน้าอ่าน
  c.order = Number.isFinite(c.order) ? Math.max(0, c.order) : 0;
  c.title = asText(c.title);
  c.paragraphs = (Array.isArray(c.paragraphs) ? c.paragraphs : [])
    .filter(isPlainRecord)
    .map(p => {
      p.src = asText(p.src);
      p.th = asText(p.th);
      if ('thDraft' in p && typeof p.thDraft !== 'string') delete p.thDraft;
      return p;
    });
  if ('summary' in c) c.summary = asText(c.summary);
  if ('sourceUrl' in c) c.sourceUrl = asHttpUrl(c.sourceUrl);
  if ('nextUrl' in c) c.nextUrl = asHttpUrl(c.nextUrl) || null;
  return normalizeChapter(c);
}

function sanitizeGlossaryRecord(raw) {
  const g = stripDangerousKeys(raw);
  if (!isPlainRecord(g)) return null;
  g.src = cleanTermString(asText(g.src));
  g.tgt = cleanTermString(asText(g.tgt));
  if (!g.src || g.src.length > 200 || !g.tgt) return null;
  if ('books' in g) g.books = Array.isArray(g.books) ? g.books.filter(isValidId) : [];
  if ('overrides' in g) {
    const overrides = {};
    if (isPlainRecord(g.overrides)) {
      Object.entries(g.overrides).forEach(([bookId, tgt]) => {
        if (isValidId(bookId) && typeof tgt === 'string' && tgt.trim()) overrides[bookId] = tgt;
      });
    }
    g.overrides = overrides;
  }
  if ('category' in g) g.category = asText(g.category);
  return g;
}

function sanitizeBookDataRecord(raw) {
  const d = stripDangerousKeys(raw);
  if (!isPlainRecord(d) || !isValidId(d.bookId)) return null;
  ['replaceRules', 'styleExamples'].forEach(k => {
    if (k in d && !Array.isArray(d[k])) delete d[k];
  });
  if ('bible' in d && !isPlainRecord(d.bible)) delete d.bible;
  if (isPlainRecord(d.bible) && 'characters' in d.bible && !Array.isArray(d.bible.characters)) d.bible.characters = [];
  if ('toc' in d && !isPlainRecord(d.toc)) delete d.toc;
  // บุ๊กมาร์ก/โน้ต: เก็บเฉพาะรายการที่รูปแบบถูก (ตอน + เลขย่อหน้า) ตัดข้อความที่ยาวเกิน
  if ('bookmarks' in d) {
    d.bookmarks = Array.isArray(d.bookmarks)
      ? d.bookmarks.filter(b => isPlainRecord(b) && isValidId(b.chapId) && Number.isInteger(b.paraIdx) && b.paraIdx >= 0).slice(-1000).map(b => ({
        ...b,
        id: isValidId(b.id) ? b.id : `bm_${b.chapId}_${b.paraIdx}`,
        note: asText(b.note).slice(0, 2000),
        excerpt: asText(b.excerpt).slice(0, 200),
        chapTitle: asText(b.chapTitle).slice(0, 300),
        srcStart: asText(b.srcStart).slice(0, 60),
        thStart: asText(b.thStart).slice(0, 60)
      }))
      : [];
  }
  return d;
}

function sanitizeUsageRecord(raw) {
  const u = stripDangerousKeys(raw);
  if (!isPlainRecord(u) || !isValidId(u.id)) return null;
  for (const k of ['calls', 'input', 'output', 'cacheRead', 'cacheWrite', 'chapters']) {
    if (k in u && !(Number.isFinite(u[k]) && u[k] >= 0)) return null;
  }
  if ('month' in u && !/^\d{4}-\d{2}$/.test(asText(u.month))) return null;
  return u;
}

function sanitizeChapterVersionRecord(raw) {
  const v = stripDangerousKeys(raw);
  if (!isPlainRecord(v) || !isValidId(v.id) || !isValidId(v.chapId) || !isValidId(v.bookId)) return null;
  v.at = Number.isFinite(v.at) ? v.at : 0;
  v.title = asText(v.title);
  v.reason = asText(v.reason).slice(0, 40);
  if ('summary' in v) v.summary = asText(v.summary);
  v.paragraphs = (Array.isArray(v.paragraphs) ? v.paragraphs : []).filter(isPlainRecord).map(p => {
    p.src = asText(p.src);
    p.th = asText(p.th);
    return p;
  });
  return v;
}

const BACKUP_SANITIZERS = {
  books: sanitizeBookRecord,
  chapters: sanitizeChapterRecord,
  glossaries: sanitizeGlossaryRecord,
  bookData: sanitizeBookDataRecord,
  usage: sanitizeUsageRecord,
  chapterVersions: sanitizeChapterVersionRecord
};

// แปลงไฟล์สำรองรุ่นเก่าให้เป็นรูปแบบปัจจุบัน และตรวจทุกเรคคอร์ด (ไม่แก้ object ต้นฉบับ)
// คืน dropped = จำนวนเรคคอร์ดที่ถูกตัดทิ้งเพราะข้อมูลเสีย แยกตาม store
function upgradeBackup(data) {
  const out = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: asText(data.exportedAt), dropped: {} };
  BACKUP_STORES.forEach(name => {
    const list = Array.isArray(data[name]) ? data[name] : [];
    const clean = [];
    list.forEach(rec => {
      const r = BACKUP_SANITIZERS[name](rec);
      if (r) clean.push(r);
    });
    out[name] = clean;
    out.dropped[name] = list.length - clean.length;
  });
  out.settings = isPlainRecord(data.settings) ? stripDangerousKeys(data.settings) : null;
  return out;
}

/**
 * นำเข้าไฟล์สำรองใน transaction เดียว ถ้าพังจะไม่มีอะไรถูกเขียน
 * mode 'merge' = รวมกับของเดิม (key ซ้ำ ข้อมูลในไฟล์ทับของเดิม)
 * mode 'replace' = ล้างนิยาย/ตอน/คลังศัพท์/ข้อมูลเสริมเดิมทั้งหมดก่อน แล้วใส่ข้อมูลจากไฟล์
 */
function dbImportAll(rawData, { mode = 'merge' } = {}) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    if (!isValidBackup(rawData)) return reject(new Error('รูปแบบไฟล์สำรองไม่ถูกต้อง หรือมาจากแอพรุ่นที่ใหม่กว่า'));
    const data = upgradeBackup(rawData);
    const tx = db.transaction(BACKUP_STORES, 'readwrite');
    try {
      if (mode === 'replace') BACKUP_STORES.forEach(name => tx.objectStore(name).clear());
      BACKUP_STORES.forEach(name => data[name].forEach(record => tx.objectStore(name).put(record)));
    } catch (err) {
      tx.abort();
      return reject(err);
    }
    tx.oncomplete = () => {
      if (mode === 'replace') bookLangCache.clear();
      data.books.forEach(b => bookLangCache.set(b.bookId, getBookSourceLang(b)));
      markDataChanged(mode === 'replace' ? 'replaced' : 'books');
      resolve(data);
    };
    tx.onerror = () => reject(tx.error || new Error('นำเข้าข้อมูลไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการนำเข้าข้อมูล'));
  });
}

function dbCountAll() {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction(BACKUP_STORES, 'readonly');
    const result = {};
    BACKUP_STORES.forEach(name => {
      const req = tx.objectStore(name).count();
      req.onsuccess = () => { result[name] = req.result || 0; };
    });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('นับข้อมูลไม่สำเร็จ'));
  });
}

async function refreshInMemoryGlossaryCache() {
  if (!db) return;
  const tx = db.transaction('glossaries', 'readonly');
  const req = tx.objectStore('glossaries').getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      inMemoryGlossaryCache = req.result || [];
      resolve(inMemoryGlossaryCache);
    };
    req.onerror = () => reject(req.error || new Error('อ่านคลังคำศัพท์ไม่สำเร็จ'));
    tx.onerror = () => reject(tx.error || new Error('อ่านคลังคำศัพท์ไม่สำเร็จ'));
  });
}

async function dbSaveGlossaryItem(item) {
  item.src = cleanTermString(item.src);
  item.tgt = cleanTermString(item.tgt);
  if (!item.src || !item.tgt) return;

  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('glossaries', 'readwrite');
    tx.objectStore('glossaries').put(item);
    tx.oncomplete = () => {
      const idx = inMemoryGlossaryCache.findIndex(x => x.src === item.src);
      if (idx !== -1) inMemoryGlossaryCache[idx] = item;
      else inMemoryGlossaryCache.push(item);
      markDataChanged('glossary');
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error('บันทึกคำศัพท์ไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการบันทึกคำศัพท์'));
  });
}

// คืนสำเนาของรายการ (ตัวคำศัพท์ยังเป็น object เดิม) ผู้เรียกที่ push/sort รายการเองจะได้ไม่ไปแก้แคช
// (เคยทำให้คำที่ AI เพิ่มใหม่ซ้ำ 2 ครั้งในแคช เพราะ dbSaveGlossaryItem ใส่ให้แล้ว ผู้เรียกยัง push เองอีก)
async function dbGetAllGlossaryItems() {
  if (inMemoryGlossaryCache && inMemoryGlossaryCache.length > 0) {
    return inMemoryGlossaryCache.slice();
  }
  return (await refreshInMemoryGlossaryCache()).slice();
}

async function dbDeleteGlossaryItem(src) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('glossaries', 'readwrite');
    tx.objectStore('glossaries').delete(src);
    tx.oncomplete = () => {
      inMemoryGlossaryCache = inMemoryGlossaryCache.filter(x => x.src !== src);
      markDataChanged('glossary');
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error('ลบคำศัพท์ไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการลบคำศัพท์'));
  });
}

async function dbDeleteMultipleGlossaryItems(srcList) {
  const set = new Set(srcList);
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    if (!srcList || srcList.length === 0) return resolve();
    const tx = db.transaction('glossaries', 'readwrite');
    const store = tx.objectStore('glossaries');
    srcList.forEach(s => store.delete(s));
    tx.oncomplete = () => {
      inMemoryGlossaryCache = inMemoryGlossaryCache.filter(x => !set.has(x.src));
      markDataChanged('glossary');
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error('ลบคำศัพท์ไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการลบคำศัพท์'));
  });
}

/** แทนคำแบบทั้งคำ (ใช้ตัวตัดคำภาษาไทย) เพื่อไม่ให้แทนตรงที่เป็นส่วนหนึ่งของคำอื่น */
function replaceWholeThaiPhrase(text, cleanOld, cleanNew) {
  if (!text || !cleanOld || !text.includes(cleanOld)) return text;
  let boundaries = null;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    boundaries = new Set([0, text.length]);
    for (const part of segmenter.segment(text)) {
      boundaries.add(part.index);
      boundaries.add(part.index + part.segment.length);
    }
  }
  let result = '';
  let cursor = 0;
  let at = text.indexOf(cleanOld, cursor);
  while (at !== -1) {
    const end = at + cleanOld.length;
    const leftBoundary = boundaries
      ? boundaries.has(at)
      : (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1]));
    const rightBoundary = boundaries
      ? boundaries.has(end)
      : (end === text.length || !/[\p{L}\p{N}]/u.test(text[end]));
    result += text.slice(cursor, at);
    if (leftBoundary && rightBoundary) {
      result += cleanNew;
      cursor = end;
    } else {
      result += text[at];
      cursor = at + 1;
    }
    at = text.indexOf(cleanOld, cursor);
  }
  return result + text.slice(cursor);
}

/**
 * เปลี่ยนชื่อไทยของคำศัพท์ในทุกที่ที่เก็บเป็นภาษาไทย: เนื้อเรื่อง, สรุปรายตอน, บันทึกเหตุการณ์ และสรุปช่วงเรื่องของผู้ช่วย
 * (บันทึกเหตุการณ์ใช้ชื่อต้นฉบับเป็นตัวอ้างอิง จึงแก้แค่ข้อความอธิบาย)
 */
async function syncUpdatedTermAcrossChapters(src, oldTgt, newTgt, bookIds = [currentBookId]) {
  const cleanOld = cleanTermString(oldTgt);
  const cleanNew = cleanTermString(newTgt);
  if (!cleanOld || !cleanNew || cleanOld === cleanNew) return;
  const replaceWholePhrase = (text) => replaceWholeThaiPhrase(text, cleanOld, cleanNew);

  let changedChapCount = 0;
  for (const bookId of [...new Set((bookIds || []).filter(Boolean))]) {
    const targetBookChaps = await dbGetChaptersByBook(bookId);
    for (const chap of targetBookChaps) {
      let isModified = false;
      if (Array.isArray(chap.paragraphs)) {
        chap.paragraphs.forEach(p => {
          if (p.th && p.th.includes(cleanOld)) {
            const updatedText = replaceWholePhrase(p.th);
            if (updatedText === p.th) return;
            p.th = updatedText;
            isModified = true;
          }
        });
      }
      const newSummary = replaceWholePhrase(chap.summary || '');
      if (newSummary !== (chap.summary || '')) {
        chap.summary = newSummary;
        isModified = true;
      }
      if (chap.storyLog && typeof renameInStoryLog === 'function' && renameInStoryLog(chap.storyLog, replaceWholePhrase)) isModified = true;

      if (isModified) {
        await dbSaveChapter(chap);
        changedChapCount++;
        const memChap = chapters.find(c => c.id === chap.id);
        if (memChap) {
          memChap.paragraphs = chap.paragraphs;
          memChap.summary = chap.summary;
          if (chap.storyLog) memChap.storyLog = chap.storyLog;
        }
      }
    }
    // สรุปช่วงเรื่องที่ผู้ช่วยเก็บไว้: แทนชื่อเลย ไม่ต้องสร้างใหม่ (ประหยัด token)
    const data = await dbGetBookData(bookId);
    if (data.assistantArcs && typeof data.assistantArcs === 'object') {
      let arcChanged = false;
      Object.values(data.assistantArcs).forEach(arc => {
        const next = replaceWholePhrase(arc?.text || '');
        if (arc && next !== arc.text) { arc.text = next; arcChanged = true; }
      });
      if (arcChanged) await dbSaveBookData(data);
    }
  }
  document.querySelectorAll('.inline-term-highlight').forEach(el => {
    if (el.getAttribute('data-src') !== encodeURIComponent(src)) return;
    el.innerText = cleanNew;
    el.setAttribute('data-tgt', encodeURIComponent(cleanNew));
  });

  if (changedChapCount > 0) {
    console.log(`[TermSync] Replaced "${cleanOld}" ➔ "${cleanNew}" across ${changedChapCount} chapters.`);
  }
}
