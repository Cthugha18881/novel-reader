// ==================== INDEXEDDB ENGINE ====================
const DB_NAME = 'NovelTranslateDB_v12';
const DB_VERSION = 2;
let db = null;
let inMemoryGlossaryCache = [];

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
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('อ่านตอนนิยายไม่สำเร็จ'));
  });
}

function dbDeleteBook(bookId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('ฐานข้อมูลยังไม่พร้อม'));
    const tx = db.transaction(['books', 'chapters'], 'readwrite');
    tx.objectStore('books').delete(bookId);
    const chapStore = tx.objectStore('chapters');
    const index = chapStore.index('bookId');
    const req = index.getAllKeys(bookId);
    req.onsuccess = () => { (req.result || []).forEach(k => chapStore.delete(k)); };
    tx.oncomplete = () => resolve();
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
