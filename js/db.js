// ==================== INDEXEDDB ENGINE ====================
const DB_NAME = 'NovelTranslateDB_v12';
const DB_VERSION = 1;
let db = null;
let inMemoryGlossaryCache = [];

function cleanTermString(str) {
  if (!str) return "";
  return str.replace(/[【】\[\]「」""''\s]+/g, ' ').trim();
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
      }
      if (!d.objectStoreNames.contains('glossaries')) {
        const glossStore = d.createObjectStore('glossaries', { keyPath: 'src' });
        glossStore.createIndex('category', 'category', { unique: false });
      }
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    req.onerror = (e) => reject(e);
  });
}

function dbSaveBook(book) {
  return new Promise((resolve) => {
    if (!db) return resolve();
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').put(book);
    tx.oncomplete = () => resolve();
  });
}

function dbSaveChapter(chapter) {
  return new Promise((resolve) => {
    if (!db) return resolve();
    const tx = db.transaction('chapters', 'readwrite');
    tx.objectStore('chapters').put(chapter);
    tx.oncomplete = () => resolve();
  });
}

function dbGetAllBooks() {
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    const tx = db.transaction('books', 'readonly');
    const req = tx.objectStore('books').getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}

function dbGetChaptersByBook(bookId) {
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    const tx = db.transaction('chapters', 'readonly');
    const index = tx.objectStore('chapters').index('bookId');
    const req = index.getAll(bookId);
    req.onsuccess = () => resolve(req.result || []);
  });
}

function dbDeleteBook(bookId) {
  return new Promise((resolve) => {
    if (!db) return resolve();
    const tx = db.transaction(['books', 'chapters'], 'readwrite');
    tx.objectStore('books').delete(bookId);
    const chapStore = tx.objectStore('chapters');
    const index = chapStore.index('bookId');
    const req = index.getAllKeys(bookId);
    req.onsuccess = () => { (req.result || []).forEach(k => chapStore.delete(k)); };
    tx.oncomplete = () => resolve();
  });
}

function dbDeleteMultipleChapters(chapIds) {
  return new Promise((resolve) => {
    if (!db || !chapIds || chapIds.length === 0) return resolve();
    const tx = db.transaction('chapters', 'readwrite');
    const chapStore = tx.objectStore('chapters');
    chapIds.forEach(id => chapStore.delete(id));
    tx.oncomplete = () => resolve();
  });
}

async function refreshInMemoryGlossaryCache() {
  if (!db) return;
  const tx = db.transaction('glossaries', 'readonly');
  const req = tx.objectStore('glossaries').getAll();
  return new Promise((resolve) => {
    req.onsuccess = () => {
      inMemoryGlossaryCache = req.result || [];
      resolve(inMemoryGlossaryCache);
    };
    req.onerror = () => resolve([]);
  });
}

async function dbSaveGlossaryItem(item) {
  item.src = cleanTermString(item.src);
  item.tgt = cleanTermString(item.tgt);
  if (!item.src || !item.tgt) return;

  const idx = inMemoryGlossaryCache.findIndex(x => x.src === item.src);
  if (idx !== -1) inMemoryGlossaryCache[idx] = item;
  else inMemoryGlossaryCache.push(item);

  return new Promise((resolve) => {
    if (!db) return resolve();
    const tx = db.transaction('glossaries', 'readwrite');
    tx.objectStore('glossaries').put(item);
    tx.oncomplete = () => resolve();
  });
}

async function dbGetAllGlossaryItems() {
  if (inMemoryGlossaryCache && inMemoryGlossaryCache.length > 0) {
    return inMemoryGlossaryCache;
  }
  return await refreshInMemoryGlossaryCache();
}

async function dbDeleteGlossaryItem(src) {
  inMemoryGlossaryCache = inMemoryGlossaryCache.filter(x => x.src !== src);
  return new Promise((resolve) => {
    if (!db) return resolve();
    const tx = db.transaction('glossaries', 'readwrite');
    tx.objectStore('glossaries').delete(src);
    tx.oncomplete = () => resolve();
  });
}

async function dbDeleteMultipleGlossaryItems(srcList) {
  const set = new Set(srcList);
  inMemoryGlossaryCache = inMemoryGlossaryCache.filter(x => !set.has(x.src));
  return new Promise((resolve) => {
    if (!db || !srcList || srcList.length === 0) return resolve();
    const tx = db.transaction('glossaries', 'readwrite');
    const store = tx.objectStore('glossaries');
    srcList.forEach(s => store.delete(s));
    tx.oncomplete = () => resolve();
  });
}

async function syncUpdatedTermAcrossChapters(src, oldTgt, newTgt) {
  const cleanOld = cleanTermString(oldTgt);
  const cleanNew = cleanTermString(newTgt);
  if (!cleanOld || !cleanNew || cleanOld === cleanNew) return;

  const targetBookChaps = await dbGetChaptersByBook(currentBookId);
  if (targetBookChaps.length === 0) return;

  const escapeOld = escapeRegExp(cleanOld);
  const regex = new RegExp(escapeOld, 'g');
  let changedChapCount = 0;

  for (const chap of targetBookChaps) {
    let isModified = false;
    if (Array.isArray(chap.paragraphs)) {
      chap.paragraphs.forEach(p => {
        if (p.th && p.th.includes(cleanOld)) {
          p.th = p.th.replace(regex, cleanNew);
          isModified = true;
        }
      });
    }

    if (isModified) {
      await dbSaveChapter(chap);
      changedChapCount++;

      const memChap = chapters.find(c => c.id === chap.id);
      if (memChap) {
        memChap.paragraphs = chap.paragraphs;
      }
    }
  }

  const activeHighlights = document.querySelectorAll(`.inline-term-highlight[data-src="${encodeURIComponent(src)}"]`);
  activeHighlights.forEach(el => {
    el.innerText = cleanNew;
    el.setAttribute('data-tgt', encodeURIComponent(cleanNew));
  });

  if (changedChapCount > 0) {
    console.log(`[TermSync] Replaced "${cleanOld}" ➔ "${cleanNew}" across ${changedChapCount} chapters.`);
  }
}
