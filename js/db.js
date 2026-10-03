// ============================================================================
// NOVELTRANSLATE AI - INDEXEDDB STORAGE (db.js)
// ============================================================================

const DB_NAME = "NovelTranslateDB";
const DB_VERSION = 2;
let dbInstance = null;

function dbInit() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;

      // 1. Books Store
      if (!db.objectStoreNames.contains("books")) {
        const bookStore = db.createObjectStore("books", { keyPath: "id" });
        bookStore.createIndex("title", "title", { unique: false });
      }

      // 2. Chapters Store
      if (!db.objectStoreNames.contains("chapters")) {
        const chapStore = db.createObjectStore("chapters", { keyPath: ["bookId", "order"] });
        chapStore.createIndex("bookId", "bookId", { unique: false });
      }

      // 3. Glossary Store
      if (!db.objectStoreNames.contains("glossaries")) {
        const glossStore = db.createObjectStore("glossaries", { keyPath: "src" });
        glossStore.createIndex("category", "category", { unique: false });
        glossStore.createIndex("scope", "scope", { unique: false });
      }
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => {
      console.error("IndexedDB error:", e.target.error);
      reject(e.target.error);
    };
  });
}

// ---------------- BOOK OPERATIONS ----------------

async function dbSaveBook(book) {
  const db = await dbInit();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("books", "readwrite");
    tx.objectStore("books").put(book);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function dbGetBook(id) {
  const db = await dbInit();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("books", "readonly");
    const req = tx.objectStore("books").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbFindBookByTitle(title) {
  const db = await dbInit();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("books", "readonly");
    const index = tx.objectStore("books").index("title");
    const req = index.get(title);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbGetAllBooks() {
  const db = await dbInit();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("books", "readonly");
    const req = tx.objectStore("books").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbDeleteBook(bookId) {
  const db = await dbInit();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["books", "chapters"], "readwrite");
    tx.objectStore("books").delete(bookId);

    const chapStore = tx.objectStore("chapters");
    const index = chapStore.index("bookId");
    const req = index.openCursor(IDBKeyRange.only(bookId));
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ---------------- CHAPTER OPERATIONS ----------------

async function dbSaveChapter(chapter) {
  const db = await dbInit();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("chapters", "readwrite");
    tx.objectStore("chapters").put(chapter);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function dbGetChaptersByBook(bookId) {
  const db = await dbInit();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("chapters", "readonly");
    const index = tx.objectStore("chapters").index("bookId");
    const req = index.getAll(IDBKeyRange.only(bookId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ---------------- GLOSSARY OPERATIONS ----------------

async function dbSaveGlossaryItem(item) {
  const db = await dbInit();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("glossaries", "readwrite");
    tx.objectStore("glossaries").put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function dbGetAllGlossary() {
  const db = await dbInit();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("glossaries", "readonly");
    const req = tx.objectStore("glossaries").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbDeleteGlossaryItem(src) {
  const db = await dbInit();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("glossaries", "readwrite");
    tx.objectStore("glossaries").delete(src);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}
