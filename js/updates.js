// ==================== CHECK FOR NEW CHAPTERS ====================
// เช็กว่าเรื่องที่อ่านอยู่มีตอนใหม่หรือยัง (กดเช็กเอง ไม่มีการเช็กเบื้องหลัง เพราะเว็บแอพทำแบบนั้นได้ไม่เสถียร)
// - เรื่องที่มีสารบัญ: ดึงสารบัญใหม่ แล้วนับตอนที่อยู่หลังตอนล่าสุดที่มีในชั้นหนังสือ
// - เรื่องที่ไม่มีสารบัญ: ลองดึงหน้า "ตอนถัดไป" ของตอนสุดท้าย ถ้ามีเนื้อหา = มีตอนใหม่อย่างน้อย 1 ตอน
// ไม่เรียก AI (ไม่ใช้ AI ช่วยแยกเนื้อหา) จึงไม่เสียโควตา AI ใช้แค่คำขอดึงหน้าเว็บ

const NEW_CHAPTER_STATE_KEY = 'nov_new_chapters';

function getNewChapterStates() {
  try {
    const s = JSON.parse(localStorage.getItem(NEW_CHAPTER_STATE_KEY) || '{}');
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch (e) {
    return {};
  }
}

function setNewChapterState(bookId, state) {
  const all = getNewChapterStates();
  if (state) all[bookId] = state;
  else delete all[bookId];
  localStorage.setItem(NEW_CHAPTER_STATE_KEY, JSON.stringify(all));
}

/**
 * @returns {{ mode: 'toc'|'next'|'none', count: number, atLeast?: boolean, fresh?: object[], page?: object, url?: string, reason?: string }}
 */
async function checkBookForNewChapters(bookId, signal = null) {
  const chaps = (await dbGetChaptersByBook(bookId)).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!chaps.length) return { mode: 'none', count: 0, reason: 'ยังไม่มีตอนในเรื่องนี้' };

  const toc = await getBookToc(bookId);
  if (toc?.url) {
    let entries = await fetchTocEntries(toc.url, { signal });
    if (toc.manualReverse) entries = entries.slice().reverse();
    if (entries.length < 3) throw new Error('ดึงสารบัญใหม่ไม่ได้ (หน้าสารบัญอาจเปลี่ยนไป)');
    const have = new Set(chaps.map(c => normalizeUrl(c.sourceUrl)).filter(Boolean));
    // ตอนใหม่ = ตอนที่อยู่หลังตอนสุดท้ายในสารบัญที่มีในชั้นหนังสือแล้ว (ตอนเก่าที่ข้ามไปไม่นับเป็นตอนใหม่)
    let lastHave = -1;
    entries.forEach((e, i) => { if (have.has(normalizeUrl(e.url))) lastHave = i; });
    const fresh = entries.slice(lastHave + 1);
    await saveBookToc(bookId, { ...toc, entries, fetchedAt: Date.now() });
    return { mode: 'toc', count: fresh.length, fresh };
  }

  const last = chaps[chaps.length - 1];
  // ตอนสุดท้ายตอนที่อ่าน เคยเป็นตอนล่าสุดของเว็บ จึงยังไม่มีลิงก์ตอนถัดไป:
  // ดึงหน้าของตอนนั้นอีกครั้ง ถ้าตอนนี้มีลิงก์ตอนถัดไปแล้ว (ไม่ใช่การเดาจากเลข) แปลว่ามีตอนใหม่
  if (!last.nextUrl && last.sourceUrl && !isPendingChapter(last)) {
    try {
      const again = await scrapePage(last.sourceUrl, signal, { bookId, allowAi: false });
      if (again.nextUrl && again.nextUrlSource !== 'guess') {
        last.nextUrl = again.nextUrl;
        await dbSaveChapter(last);
        const mem = chapters.find(c => c.id === last.id);
        if (mem) mem.nextUrl = again.nextUrl;
        if (mem && currentBookId === bookId && chapters[chapters.length - 1] === mem) nextUrlCalculated = again.nextUrl;
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
    }
  }
  // ตอนสุดท้ายเป็นตอนที่รอแปลแต่ยังไม่รู้ลิงก์ตอนถัดไป (เช่นมาจากไฟล์) จะรู้ต่อเมื่อแปลตอนนั้นแล้ว
  if (!last.nextUrl) {
    return { mode: 'none', count: 0, reason: isPendingChapter(last) ? 'ยังมีตอนที่รอแปลอยู่ (จะรู้ลิงก์ตอนถัดไปหลังแปล)' : 'ไม่มีลิงก์ตอนถัดไปของตอนล่าสุด (ลองตั้งสารบัญของเรื่องนี้)' };
  }
  try {
    const page = await scrapePage(last.nextUrl, signal, { bookId, allowAi: false });
    return { mode: 'next', count: 1, atLeast: true, page, url: last.nextUrl };
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (isMissingPageError(err) || /ไม่พบเนื้อหา/.test(err.message || '')) return { mode: 'next', count: 0 };
    throw err;
  }
}

/**
 * รหัสของตอนที่เพิ่มจากการเช็กตอนใหม่: คิดจากลิงก์ของตอน (ไม่ใช่เวลา)
 * สองเครื่องที่ซิงก์กันเจอตอนเดียวกัน จะได้รหัสเดียวกัน ซิงก์แล้วไม่เกิดตอนซ้ำ
 */
function newChapterIdFor(bookId, url) {
  return `${bookId}_u_${hashString(normalizeUrl(url) || url || '')}`;
}

/** เพิ่มตอนใหม่ที่เช็กเจอเป็น "ตอนที่รอแปล" (ยังไม่ใช้โควตา AI) */
async function queueNewChapters(bookId, result) {
  const chaps = await dbGetChaptersByBook(bookId);
  let order = chaps.reduce((m, c) => Math.max(m, c.order || 0), 0);
  const haveIds = new Set(chaps.map(c => c.id));
  let records = [];
  if (result.mode === 'toc') {
    const have = new Set(chaps.map(c => normalizeUrl(c.sourceUrl)).filter(Boolean));
    records = result.fresh.filter(en => !have.has(normalizeUrl(en.url)) && !haveIds.has(newChapterIdFor(bookId, en.url))).map((en) => ({
      id: newChapterIdFor(bookId, en.url),
      bookId,
      order: ++order,
      title: en.title || `ตอน ${order}`,
      chapterType: 'story',
      status: 'pending',
      paragraphs: [],
      summary: '',
      sourceUrl: en.url,
      nextUrl: null
    }));
  } else if (result.mode === 'next' && result.page) {
    if (chaps.some(c => sameSourceUrl(c.sourceUrl, result.url)) || haveIds.has(newChapterIdFor(bookId, result.url))) return 0;
    // เก็บต้นฉบับที่ดึงมาแล้วไว้เลย ตอนแปลจะไม่ต้องดึงหน้าเว็บซ้ำ
    records = [{
      id: newChapterIdFor(bookId, result.url),
      bookId,
      order: ++order,
      title: result.page.rawChapTitle || `ตอน ${order}`,
      chapterType: 'story',
      status: 'pending',
      paragraphs: splitSourceParagraphs(result.page.text).map(src => ({ th: '', src })),
      summary: '',
      sourceUrl: result.url,
      nextUrl: result.page.nextUrl || null,
      // ตอนที่ต้องซื้อ: ต้นฉบับที่เก็บไว้เป็นแค่ตัวอย่าง ตอนแปลจะบันทึกเป็นตอนที่ล็อกแทน
      ...(result.page.lockInfo ? { pendingLockInfo: result.page.lockInfo } : {})
    }];
  }
  if (!records.length) return 0;
  await dbSaveChapters(records);
  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  if (book) await dbSaveBook({ ...book, totalChapters: order, updatedAt: Date.now() });
  setNewChapterState(bookId, null);
  if (currentBookId === bookId) {
    const fresh = await dbGetChaptersByBook(bookId);
    records.forEach(r => { if (!chapters.some(c => c.id === r.id)) chapters.push(fresh.find(c => c.id === r.id) || r); });
    nextUrlCalculated = chapters[chapters.length - 1]?.nextUrl || null;
    checkAndRefreshBottomStatus();
  }
  return records.length;
}

function describeNewChapterResult(result) {
  if (result.mode === 'none') return result.reason || 'เช็กไม่ได้';
  if (!result.count) return 'ยังไม่มีตอนใหม่';
  return result.atLeast ? 'มีตอนใหม่ (อย่างน้อย 1 ตอน)' : `มีตอนใหม่ ${result.count} ตอน`;
}

// ---------- UI ----------
let newChapterChecking = false;

/** เช็กเรื่องเดียว แล้วถามว่าจะเพิ่มตอนใหม่เข้าคิวรอแปลเลยไหม */
async function checkNewChaptersForBook(bookId) {
  if (newChapterChecking) return appAlert('กำลังเช็กตอนใหม่อยู่ กรุณารอสักครู่');
  newChapterChecking = true;
  const controller = beginTask('checknew');
  showGlobalToast('กำลังเช็กตอนใหม่...');
  try {
    const result = await checkBookForNewChapters(bookId, controller.signal);
    hideGlobalToast();
    setNewChapterState(bookId, { count: result.count, atLeast: !!result.atLeast, mode: result.mode, checkedAt: Date.now(), note: result.mode === 'none' ? result.reason : '' });
    renderNewChapterBadge(bookId);
    if (result.count > 0) {
      if (await appConfirm(`${describeNewChapterResult(result)}\nเพิ่มเป็น "ตอนที่รอแปล" ได้เลย ยังไม่ใช้โควตา AI จนกว่าจะกดแปล`, { title: 'พบตอนใหม่', confirmLabel: 'เพิ่มเข้าคิว', cancelLabel: 'ไว้ทีหลัง' })) {
        const added = await queueNewChapters(bookId, result);
        renderNewChapterBadge(bookId);
        await refreshShelfViewOnly(bookId);
        appAlert(`เพิ่มตอนที่รอแปล ${added} ตอนแล้ว กด "⚡ แปลล่วงหน้า" เพื่อแปลต่อ${result.atLeast ? '\n(ตอนถัดจากนั้นจะหาต่อเองตอนแปล)' : ''}`);
      }
    } else {
      appAlert(describeNewChapterResult(result));
    }
  } catch (err) {
    hideGlobalToast();
    if (!isAbortError(err)) appAlert(`เช็กตอนใหม่ไม่สำเร็จ: ${describeScrapeError(err)}`);
  } finally {
    endTask('checknew', controller);
    newChapterChecking = false;
  }
}

/** เช็กทุกเรื่องทีละเรื่อง (เว้นช่วงเล็กน้อยไม่ให้โดนจำกัดจำนวนครั้ง) แล้วแสดงผลบนการ์ดของแต่ละเรื่อง */
async function checkNewChaptersForAllBooks() {
  if (newChapterChecking) return appAlert('กำลังเช็กตอนใหม่อยู่ กรุณารอสักครู่');
  const books = await dbGetAllBooks();
  if (!books.length) return;
  newChapterChecking = true;
  const controller = beginTask('checknew');
  const signal = controller.signal;
  let found = 0;
  let failed = 0;
  try {
    for (let i = 0; i < books.length; i++) {
      if (signal.aborted) break;
      const b = books[i];
      showGlobalToast(`เช็กตอนใหม่ ${i + 1}/${books.length}: ${b.title || b.bookId}`);
      try {
        const result = await checkBookForNewChapters(b.bookId, signal);
        setNewChapterState(b.bookId, { count: result.count, atLeast: !!result.atLeast, mode: result.mode, checkedAt: Date.now(), note: result.mode === 'none' ? result.reason : '' });
        if (result.count > 0) found++;
      } catch (err) {
        if (isAbortError(err)) break;
        failed++;
        setNewChapterState(b.bookId, { count: 0, mode: 'error', checkedAt: Date.now(), note: describeScrapeError(err) });
      }
      renderNewChapterBadge(b.bookId);
      if (i < books.length - 1) await sleepAbortable(1500, signal).catch(() => {});
    }
  } finally {
    endTask('checknew', controller);
    newChapterChecking = false;
    hideGlobalToast();
  }
  appAlert(`เช็กตอนใหม่เสร็จแล้ว: มีตอนใหม่ ${found} เรื่อง${failed ? ` · เช็กไม่ได้ ${failed} เรื่อง` : ''}\nเปิดเรื่องที่มีป้าย 🆕 บนปก แล้วกด "เพิ่มเข้าคิว" เพื่อเพิ่มเป็นตอนที่รอแปล`);
}

/** ปุ่ม "เพิ่มเข้าคิว" บนการ์ด: เช็กซ้ำอีกครั้ง (ได้ข้อมูลล่าสุด) แล้วเพิ่มเลย */
async function queueNewChaptersFromBadge(bookId) {
  if (newChapterChecking) return;
  newChapterChecking = true;
  const controller = beginTask('checknew');
  showGlobalToast('กำลังเพิ่มตอนใหม่เข้าคิว...');
  try {
    const result = await checkBookForNewChapters(bookId, controller.signal);
    const added = result.count ? await queueNewChapters(bookId, result) : 0;
    if (!added) setNewChapterState(bookId, { count: 0, mode: result.mode, checkedAt: Date.now() });
    renderNewChapterBadge(bookId);
    await refreshShelfViewOnly(bookId);
    hideGlobalToast();
    appAlert(added ? `เพิ่มตอนที่รอแปล ${added} ตอนแล้ว` : 'ไม่พบตอนใหม่แล้ว');
  } catch (err) {
    hideGlobalToast();
    if (!isAbortError(err)) appAlert(`เพิ่มตอนใหม่ไม่สำเร็จ: ${describeScrapeError(err)}`);
  } finally {
    endTask('checknew', controller);
    newChapterChecking = false;
  }
}

function newChapterBadgeHtml(bookId) {
  const s = getNewChapterStates()[bookId];
  if (!s) return '';
  const when = new Date(s.checkedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
  // ติดตามเรื่องอยู่: เช็กเจอแล้วเพิ่มเข้าคิวให้เอง
  if (s.queued > 0) {
    return `<span class="new-chap-badge">🆕 เพิ่ม ${s.queued} ตอนใหม่เข้าคิวรอแปลแล้ว</span>
      <button class="btn btn-primary btn-sm" onclick="chooseBatchCount(${jsArg(bookId)})">⚡ แปลเลย</button>
      <span class="text-muted" style="font-size: 11px;">เจอเมื่อ ${escapeHtml(when)}</span>`;
  }
  if (s.count > 0) {
    return `<span class="new-chap-badge">🆕 ${s.atLeast ? 'มีตอนใหม่' : `${s.count} ตอนใหม่`}</span>
      <button class="btn btn-primary btn-sm" onclick="queueNewChaptersFromBadge(${jsArg(bookId)})">เพิ่มเข้าคิว</button>
      <span class="text-muted" style="font-size: 11px;">เช็กเมื่อ ${escapeHtml(when)}</span>`;
  }
  const text = s.mode === 'error' ? `⚠️ เช็กไม่ได้: ${s.note || ''}` : (s.mode === 'none' ? s.note || 'เช็กไม่ได้' : 'ยังไม่มีตอนใหม่');
  return `<span class="text-muted" style="font-size: 11px;">${escapeHtml(text)} · เช็กเมื่อ ${escapeHtml(when)}</span>`;
}

function renderNewChapterBadge(bookId) {
  const el = document.getElementById(`newchap-${bookId}`);
  if (el) el.innerHTML = newChapterBadgeHtml(bookId);
  // ป้าย "ตอนใหม่" บนปกการ์ดในหน้าแรก
  else if (typeof refreshHomeBook === 'function') refreshHomeBook(bookId);
}

// ==================== ติดตามตอนใหม่อัตโนมัติ (Pro/Max) ====================
// เรื่องที่ติดตาม (book.follow = true ซิงก์ไปทุกเครื่อง): แอพเช็กตอนใหม่เองตอนเปิด และทุก 30 นาทีระหว่างเปิด
// เจอแล้วเพิ่มเป็น "ตอนที่รอแปล" อย่างเดียว ไม่ใช้โควตา AI จนกว่าผู้ใช้จะกดแปล
// ทำในเครื่องของผู้ใช้ (ดึงหน้าเว็บแบบเดียวกับกดเช็กเอง) ไม่ใช่เซิร์ฟเวอร์ของ Dusktale
const FOLLOW_CHECKED_KEY = 'nov_follow_checked';
const FOLLOW_INTERVAL_MS = 30 * 60000;

function isBookFollowed(book) {
  return book?.follow === true;
}

function getFollowLimit() {
  return typeof getEntitlements === 'function' ? getEntitlements().followBooks : null;
}

/** เปิด/ปิดการติดตาม (จำนวนเรื่องตามแพ็กเกจ เลิกติดตามได้เสมอ) */
async function setBookFollow(bookId, on) {
  const books = await dbGetAllBooks();
  const book = books.find(b => b.bookId === bookId);
  if (!book) return;
  if (on) {
    const limit = getFollowLimit();
    const followed = books.filter(b => isBookFollowed(b) && b.bookId !== bookId).length;
    if (limit !== null && followed >= limit) {
      if (typeof showPlanLimit === 'function') showPlanLimit('follow');
      return;
    }
  }
  await dbSaveBook({ ...book, follow: !!on, updatedAt: Date.now() });
  if (typeof refreshShelfViewOnly === 'function') await refreshShelfViewOnly(bookId);
  showGlobalToast(on ? `ติดตาม "${book.title || 'นิยาย'}" แล้ว แอพจะเช็กตอนใหม่ให้เองทุก 30 นาทีระหว่างเปิดแอพ` : 'เลิกติดตามแล้ว');
  setTimeout(hideGlobalToast, 2500);
  if (on) setTimeout(() => autoCheckFollowedBooks({ force: [bookId] }).catch(() => {}), 1500);
}

function readFollowChecked() {
  try {
    const v = JSON.parse(localStorage.getItem(FOLLOW_CHECKED_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}

/** เรื่องที่ถึงเวลาเช็ก: ติดตามอยู่ ไม่ได้กำลังแปลล่วงหน้า เช็กครั้งล่าสุดเกิน 30 นาที (เรียงตามที่อ่านล่าสุด ตัดตามสิทธิ์) */
function pickFollowedBooksDue(books, { limit, checked, now = Date.now(), busy = () => false, force = [] }) {
  const followed = books.filter(isBookFollowed).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const allowed = limit === null || limit === undefined ? followed : followed.slice(0, Math.max(0, limit));
  return allowed.filter(b => !busy(b.bookId) && (force.includes(b.bookId) || now - (Number(checked[b.bookId]) || 0) >= FOLLOW_INTERVAL_MS));
}

let followCheckRunning = false;

async function autoCheckFollowedBooks({ force = [] } = {}) {
  if (followCheckRunning || newChapterChecking) return;
  if (typeof db === 'undefined' || !db) return;
  const limit = getFollowLimit();
  if (limit === 0) return;
  const checked = readFollowChecked();
  const busy = (id) => { const s = typeof getBatchStatus === 'function' ? getBatchStatus(id) : null; return !!s && ['running', 'queued'].includes(s.kind); };
  const due = pickFollowedBooksDue(await dbGetAllBooks(), { limit, checked, busy, force });
  if (!due.length) return;
  followCheckRunning = true;
  const controller = beginTask('followcheck');
  let addedTotal = 0, booksWithNew = 0;
  try {
    for (let i = 0; i < due.length; i++) {
      if (controller.signal.aborted) break;
      const b = due[i];
      try {
        const result = await checkBookForNewChapters(b.bookId, controller.signal);
        const added = result.count > 0 ? await queueNewChapters(b.bookId, result) : 0;
        const prev = getNewChapterStates()[b.bookId];
        if (added) {
          addedTotal += added;
          booksWithNew++;
          // นับสะสมจนกว่าผู้ใช้จะเปิดอ่านเรื่องนั้น
          setNewChapterState(b.bookId, { count: 0, queued: (prev?.queued || 0) + added, mode: result.mode, checkedAt: Date.now() });
        } else if (!prev?.queued) {
          setNewChapterState(b.bookId, { count: 0, mode: result.mode, checkedAt: Date.now(), note: result.mode === 'none' ? result.reason : '' });
        }
      } catch (err) {
        if (isAbortError(err)) break;
        console.warn('follow check failed', b.bookId, err.message);
      }
      checked[b.bookId] = Date.now();
      try { localStorage.setItem(FOLLOW_CHECKED_KEY, JSON.stringify(checked)); } catch (e) {}
      renderNewChapterBadge(b.bookId);
      if (i < due.length - 1) await sleepAbortable(1500, controller.signal).catch(() => {});
    }
  } finally {
    endTask('followcheck', controller);
    followCheckRunning = false;
  }
  if (addedTotal) {
    showGlobalToast(`🆕 พบตอนใหม่ ${addedTotal} ตอน (${booksWithNew} เรื่องที่ติดตาม) เพิ่มเข้าคิวรอแปลแล้ว`);
    setTimeout(hideGlobalToast, 5000);
    if (typeof homeOpen !== 'undefined' && homeOpen && typeof refreshHome === 'function') refreshHome();
  }
}

/** เปิดอ่านเรื่องแล้ว: ล้างป้าย "เพิ่มตอนใหม่เข้าคิวแล้ว" */
function clearFollowQueuedBadge(bookId) {
  const s = getNewChapterStates()[bookId];
  if (s?.queued) {
    setNewChapterState(bookId, null);
    renderNewChapterBadge(bookId);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // เปิดแอพ: รอให้หน้าโหลดและซิงก์เสร็จก่อน แล้วค่อยเช็ก
  setTimeout(() => autoCheckFollowedBooks().catch(() => {}), 20000);
  setInterval(() => {
    if (document.visibilityState === 'visible') autoCheckFollowedBooks().catch(() => {});
  }, 5 * 60000);
});
