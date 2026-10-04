// ==================== INDEXEDDB ENGINE ====================
const DB_NAME = 'NovelTranslateDB_v12';
// v3: เพิ่ม store bookData (คู่มือเรื่อง/กฎแทนคำ/ตัวอย่างสำนวน ใช้ในขั้นถัดไป)
// ฟิลด์ใหม่ใน record เดิมไม่ต้อง migrate เพราะทุกจุดอ่านผ่านค่า default ด้านล่าง
const DB_VERSION = 3;
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
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('เปิดฐานข้อมูลไม่สำเร็จ'));
    req.onblocked = () => reject(new Error('ฐานข้อมูลถูกเปิดค้างในแท็บอื่น กรุณาปิดแท็บเดิมแล้วลองใหม่'));
  });
}

function dbSaveBook(book) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').put(book);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('บันทึกหนังสือไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการบันทึกหนังสือ'));
  });
}

function dbSaveChapter(chapter) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('chapters', 'readwrite');
    tx.objectStore('chapters').put(chapter);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('บันทึกตอนนิยายไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการบันทึกตอนนิยาย'));
  });
}

function dbGetAllBooks() {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('books', 'readonly');
    const req = tx.objectStore('books').getAll();
    req.onsuccess = () => resolve(req.result || []);
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('บันทึกข้อมูลเสริมของนิยายไม่สำเร็จ'));
  });
}

function dbDeleteBook(bookId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction(['books', 'chapters', 'glossaries', 'bookData'], 'readwrite');
    tx.objectStore('books').delete(bookId);
    tx.objectStore('bookData').delete(bookId);
    const chapStore = tx.objectStore('chapters');
    const index = chapStore.index('bookId');
    const req = index.getAllKeys(bookId);
    req.onsuccess = () => { (req.result || []).forEach(k => chapStore.delete(k)); };

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
    const tx = db.transaction('chapters', 'readwrite');
    const chapStore = tx.objectStore('chapters');
    chapIds.forEach(id => chapStore.delete(id));
    tx.oncomplete = () => resolve();
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
    const tx = db.transaction(['books', 'chapters', 'glossaries'], 'readwrite');
    const chapStore = tx.objectStore('chapters');
    const idSet = new Set(chapIds);

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
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error('ย้ายตอนไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการย้ายตอน'));
  });
}

// ==================== BACKUP (EXPORT / IMPORT) ====================
const BACKUP_FORMAT = 'NovelTranslateBackup';
// v1 (แอพ v2.6): books, chapters, glossaries | v2 (แอพ v2.7+): เพิ่ม bookData
const BACKUP_VERSION = 2;
const BACKUP_REQUIRED_STORES = ['books', 'chapters', 'glossaries'];
const BACKUP_STORES = ['books', 'chapters', 'glossaries', 'bookData'];

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
  return !!data && data.format === BACKUP_FORMAT &&
    (!data.version || data.version <= BACKUP_VERSION) &&
    BACKUP_REQUIRED_STORES.every(name => Array.isArray(data[name]));
}

// แปลงไฟล์สำรองรุ่นเก่าให้เป็นรูปแบบปัจจุบัน (ไม่แก้ object ต้นฉบับ)
function upgradeBackup(data) {
  return {
    ...data,
    version: BACKUP_VERSION,
    books: data.books.filter(b => b && b.bookId),
    chapters: data.chapters.filter(c => c && c.id && c.bookId).map(c => normalizeChapter({ ...c })),
    glossaries: data.glossaries.filter(g => g && g.src),
    bookData: Array.isArray(data.bookData) ? data.bookData.filter(d => d && d.bookId) : []
  };
}

// รวมข้อมูลจากไฟล์เข้าฐานข้อมูลเดิม (key ซ้ำจะถูกเขียนทับ) ใน transaction เดียว ถ้าพังจะไม่มีอะไรถูกเขียน
function dbImportAll(rawData) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    if (!isValidBackup(rawData)) return reject(new Error('รูปแบบไฟล์สำรองไม่ถูกต้อง หรือมาจากแอพรุ่นที่ใหม่กว่า'));
    const data = upgradeBackup(rawData);
    const tx = db.transaction(BACKUP_STORES, 'readwrite');
    try {
      BACKUP_STORES.forEach(name => data[name].forEach(record => tx.objectStore(name).put(record)));
    } catch (err) {
      tx.abort();
      return reject(err);
    }
    tx.oncomplete = () => resolve(data);
    tx.onerror = () => reject(tx.error || new Error('นำเข้าข้อมูลไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการนำเข้าข้อมูล'));
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
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error('บันทึกคำศัพท์ไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการบันทึกคำศัพท์'));
  });
}

async function dbGetAllGlossaryItems() {
  if (inMemoryGlossaryCache && inMemoryGlossaryCache.length > 0) {
    return inMemoryGlossaryCache;
  }
  return await refreshInMemoryGlossaryCache();
}

async function dbDeleteGlossaryItem(src) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction('glossaries', 'readwrite');
    tx.objectStore('glossaries').delete(src);
    tx.oncomplete = () => {
      inMemoryGlossaryCache = inMemoryGlossaryCache.filter(x => x.src !== src);
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
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error('ลบคำศัพท์ไม่สำเร็จ'));
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการลบคำศัพท์'));
  });
}

async function syncUpdatedTermAcrossChapters(src, oldTgt, newTgt, bookIds = [currentBookId]) {
  const cleanOld = cleanTermString(oldTgt);
  const cleanNew = cleanTermString(newTgt);
  if (!cleanOld || !cleanNew || cleanOld === cleanNew) return;

  const replaceWholePhrase = (text) => {
    if (!text || !text.includes(cleanOld)) return text;
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
  };
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

      if (isModified) {
        await dbSaveChapter(chap);
        changedChapCount++;
        const memChap = chapters.find(c => c.id === chap.id);
        if (memChap) memChap.paragraphs = chap.paragraphs;
      }
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
