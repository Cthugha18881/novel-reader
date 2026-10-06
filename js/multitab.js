// ==================== หลายแท็บ: ข้อมูลเปลี่ยนจากแท็บอื่น / ฐานข้อมูลรุ่นใหม่ (แยกจาก app.js) ====================
// โหลดหลัง app.js (ดู index.html) ทุกอย่างในไฟล์นี้ถูกเรียกหลังหน้าโหลดเสร็จ จึงใช้ตัวแปรของ app.js ได้ตามปกติ

// ==================== MULTI-TAB ====================
function onDatabaseVersionChange() {
  dbOutdatedInThisTab = true;
  abortAllRunningProcesses();
  renderSafetyBanner();
}

/** ข้อมูลถูกแก้จากอีกแท็บ: รีเฟรชคลังศัพท์ ตอนใหม่ของเรื่องที่อ่านอยู่ และชั้นหนังสือ */
async function handleRemoteDataChanges(changes) {
  if (dbOutdatedInThisTab) return;
  if (changes.some(c => c.kind === 'replaced')) {
    remoteReplacedData = true;
    abortAllRunningProcesses();
    renderSafetyBanner();
    return;
  }
  try {
    if (changes.some(c => c.kind === 'glossary')) await refreshInMemoryGlossaryCache();
    if (changes.some(c => c.kind === 'chapters' && (!c.bookId || c.bookId === currentBookId))) await syncChaptersFromOtherTab();
    // บุ๊กมาร์กที่เพิ่ม/ลบจากอีกแท็บ
    if (changes.some(c => c.kind === 'bookData' && c.bookId === currentBookId)) {
      await refreshBookmarkCache(currentBookId);
      refreshBookmarkMarkers();
    }
    if (homeOpen) {
      const bookIds = [...new Set(changes.map(c => c.bookId).filter(Boolean))];
      bookIds.forEach(id => homeCoverCache.delete(id));
      if (changes.some(c => c.kind === 'books' && !c.bookId) || !bookIds.length) await refreshHome();
      else for (const id of bookIds) await refreshShelfViewOnly(id);
    }
  } catch (err) {
    console.warn('Sync from other tab failed:', err);
  }
}

// แทนเนื้อหาของ object ตอนเดิมด้วยข้อมูลใหม่ (ลบฟิลด์ที่ไม่มีแล้ว เช่น status: 'pending') โดยคง reference เดิมไว้
function replaceChapterContents(target, fresh) {
  Object.keys(target).forEach(k => { if (!(k in fresh)) delete target[k]; });
  Object.assign(target, fresh);
  return target;
}

async function syncChaptersFromOtherTab() {
  if (!currentBookId || currentBookId === 'default_novel') return;
  const bookId = currentBookId;
  const fresh = await dbGetChaptersByBook(bookId);
  if (currentBookId !== bookId) return;
  let needsRender = false;
  const byId = new Map(chapters.map(c => [c.id, c]));
  fresh.forEach(fc => {
    const mine = byId.get(fc.id);
    if (!mine) return;
    // ตอนที่อีกแท็บแปลเสร็จ (เช่นตอนที่รอแปล) ให้แสดงผลแปลล่าสุด
    const changed = (mine.status || '') !== (fc.status || '') ||
      (mine.translationMeta?.translatedAt || 0) !== (fc.translationMeta?.translatedAt || 0);
    if (changed) {
      replaceChapterContents(mine, fc);
      if (renderedWindowIndices.includes(chapters.indexOf(mine))) needsRender = true;
    }
  });
  // ตอนใหม่ที่ต่อท้ายจากอีกแท็บ (ไม่แทรกกลางเรื่อง เพื่อไม่ให้ตำแหน่งอ่านเลื่อน)
  const lastOrder = chapters.reduce((m, c) => Math.max(m, c.order || 0), 0);
  const appended = fresh.filter(fc => !byId.has(fc.id) && (fc.order || 0) > lastOrder).sort((a, b) => a.order - b.order);
  if (appended.length) {
    chapters.push(...appended);
    if (lastPrefetchError === OTHER_TAB_BUSY_MESSAGE) lastPrefetchError = '';
    nextUrlCalculated = chapters[chapters.length - 1].nextUrl || null;
    if (!needsRender) appendNextChapterToWindow();
    checkAndRefreshBottomStatus();
  }
  if (needsRender) await renderVirtualWindow(currentChapterIndex);
}

async function initSafetyOnStartup() {
  onRemoteDataChange(handleRemoteDataChanges);
  const books = await dbGetAllBooks();
  if (books.length) {
    // ผู้ใช้ที่อัปเดตจากรุ่นเก่า: นับข้อมูลที่มีอยู่เป็น "ยังไม่ได้สำรอง" แล้วเริ่มนับวันเตือนจากวันนี้
    if (!localStorage.getItem('nov_first_change_at') && !localStorage.getItem('nov_last_backup_at')) {
      const now = String(Date.now());
      localStorage.setItem('nov_first_change_at', now);
      localStorage.setItem('nov_data_changed_at', now);
    }
    requestPersistentStorage();
    await maybeRunAutoBackup();
  }
  renderSafetyBanner();
}

