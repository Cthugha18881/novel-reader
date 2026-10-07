// ==================== HOME: หน้าแรก / ชั้นหนังสือเต็มหน้า ====================
// หน้ารวม: การ์ดหนังสือพร้อมปก ความคืบหน้าที่อ่าน และแถบแปลล่วงหน้าของแต่ละเรื่อง
// หน้ารายละเอียด: ปก ข้อมูลเรื่อง ปุ่มหลัก และรายการตอนทั้งหมด
// หน้าแรกเป็นชั้นที่ลอยทับหน้าอ่าน (หน้าอ่านไม่ถูกซ่อน) ตำแหน่งที่อ่านค้างจึงไม่เลื่อนหาย
// ปุ่มย้อนกลับของมือถือ: ปิดหน้ารายละเอียด -> หน้ารวม -> กลับหน้าอ่าน
let homeOpen = false;
let homeBookId = null;
let homeHistoryDepth = 0;
let homeIgnorePop = false;
let homeRenderToken = 0;
let homeBooksCache = [];
const homeCoverCache = new Map();

const HOME_SORTS = { recent: 'อ่านล่าสุด', title: 'ชื่อเรื่อง ก-ฮ', chapters: 'ตอนมากสุด' };
const COVER_PALETTES = [
  ['#1e3a8a', '#3b82f6'], ['#7c2d12', '#f97316'], ['#14532d', '#22c55e'], ['#581c87', '#a855f7'],
  ['#831843', '#ec4899'], ['#134e4a', '#14b8a6'], ['#713f12', '#eab308'], ['#1f2937', '#64748b']
];

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}

function getStartPage() {
  return readPref('nov_start_page', 'home') === 'reading' ? 'reading' : 'home';
}

function setStartPage(value) {
  try { localStorage.setItem('nov_start_page', value === 'reading' ? 'reading' : 'home'); } catch (e) {}
}

function coverPalette(bookId) {
  let h = 0;
  for (const ch of String(bookId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_PALETTES[h % COVER_PALETTES.length];
}

/** ปก: รูปที่ผู้ใช้ตั้ง หรือปกสีที่สร้างจากชื่อเรื่อง (สีคงที่ต่อเรื่อง) */
function homeCoverHtml(book, cover) {
  if (cover) return `<img class="cover-img" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async">`;
  const [a, b] = coverPalette(book.bookId);
  return `<div class="cover-gen" style="background: linear-gradient(160deg, ${a}, ${b});">
    <span class="cover-gen-genre">${escapeHtml(getGenreThaiName(book.genre))}</span>
    <span class="cover-gen-title">${escapeHtml(book.title || 'นิยายเรื่องใหม่')}</span>
  </div>`;
}

async function getBookCover(bookId) {
  if (homeCoverCache.has(bookId)) return homeCoverCache.get(bookId);
  let cover = null;
  try {
    const data = await dbGetBookData(bookId);
    cover = isSafeCoverDataUrl(data.cover) ? data.cover : null;
  } catch (e) {}
  homeCoverCache.set(bookId, cover);
  return cover;
}

// ---------- เปิด/ปิด ----------
async function openHome({ bookId = null, fromPop = false } = {}) {
  if (typeof closeActionMenu === 'function') closeActionMenu({ restoreFocus: false });
  const view = document.getElementById('home-view');
  if (!view) return;
  const wasOpen = homeOpen;
  homeOpen = true;
  homeBookId = bookId || null;
  const header = document.querySelector('header');
  if (header) document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  document.body.classList.add('home-open');
  view.hidden = false;
  if (!fromPop) {
    const state = { nt: 'home', book: homeBookId };
    if (!wasOpen || homeBookId) { history.pushState(state, ''); homeHistoryDepth++; }
    else history.replaceState(state, '');
  }
  document.querySelectorAll('[data-home-toggle]').forEach(b => b.classList.add('active'));
  await renderHome();
  view.scrollTop = 0;
}

function closeHome({ fromPop = false } = {}) {
  if (!homeOpen) return;
  homeOpen = false;
  homeBookId = null;
  document.body.classList.remove('home-open');
  document.getElementById('home-view').hidden = true;
  document.querySelectorAll('[data-home-toggle]').forEach(b => b.classList.remove('active'));
  if (fromPop) {
    homeHistoryDepth = 0;
  } else if (homeHistoryDepth > 0) {
    const n = homeHistoryDepth;
    homeHistoryDepth = 0;
    homeIgnorePop = true;
    history.go(-n);
  } else {
    history.replaceState(null, '');
  }
}

function toggleHome() {
  if (homeOpen && !homeBookId) {
    closeHome();
  } else {
    openHome();
  }
}

/** ปุ่ม "← ชั้นหนังสือ" ในหน้ารายละเอียด */
function homeBack() {
  if (homeHistoryDepth >= 2) {
    history.back();
  } else {
    history.replaceState({ nt: 'home', book: null }, '');
    homeBookId = null;
    renderHome();
  }
}

function setupHome() {
  // ตำแหน่งอ่านดูแลโดยแอพเอง ไม่ให้เบราว์เซอร์เลื่อนหน้าอ่านเองตอนกดย้อนกลับ
  try { history.scrollRestoration = 'manual'; } catch (e) {}
  window.addEventListener('popstate', (e) => {
    if (homeIgnorePop) { homeIgnorePop = false; return; }
    const st = e.state;
    if (st?.nt === 'home') {
      homeHistoryDepth = Math.max(0, homeHistoryDepth - 1);
      openHome({ bookId: st.book || null, fromPop: true });
    } else if (homeOpen) {
      closeHome({ fromPop: true });
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !homeOpen || e.defaultPrevented) return;
    if (document.querySelector('.modal-overlay.active') || document.getElementById('action-menu')) return;
    if (document.getElementById('assistant-panel')?.classList.contains('open')) return;
    if (homeBookId) homeBack();
    else closeHome();
  });
}

/** เปิดแอพ: แสดงหน้าแรกเป็นหน้าเริ่มต้น (ถ้ามีหนังสือและไม่ได้ตั้งให้เปิดหน้าอ่าน) */
async function maybeOpenHomeOnStartup() {
  if (getStartPage() !== 'home') return;
  const books = await dbGetAllBooks();
  if (!books.length) return;
  history.replaceState({ nt: 'home', book: null }, '');
  await openHome({ fromPop: true });
}

// ---------- วาด ----------
async function renderHome() {
  if (!homeOpen) return;
  const grid = document.getElementById('home-grid-view');
  const detail = document.getElementById('home-detail-view');
  if (homeBookId) {
    grid.hidden = true;
    detail.hidden = false;
    await renderHomeDetail(homeBookId);
  } else {
    detail.hidden = true;
    detail.innerHTML = '';
    grid.hidden = false;
    await renderHomeGrid();
  }
}

/** วาดใหม่เฉพาะตอนที่หน้าแรกเปิดอยู่ */
async function refreshHome() {
  if (homeOpen) await renderHome();
}

/** ข้อมูลเรื่องเดียวเปลี่ยน (แปลเสร็จ 1 ตอน แก้แนวเรื่อง ฯลฯ) */
async function refreshHomeBook(bookId) {
  if (!homeOpen) return;
  if (homeBookId === bookId) return renderHomeDetail(bookId);
  if (homeBookId) return;
  const card = document.querySelector(`.home-card[data-book="${CSS.escape(bookId)}"]`);
  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  if (!card || !book) return renderHomeGrid();
  const entry = { b: book, count: await dbCountChaptersByBook(bookId), cover: await getBookCover(bookId) };
  homeBooksCache = homeBooksCache.map(x => x.b.bookId === bookId ? entry : x);
  card.outerHTML = homeCardHtml(entry);
}

async function renderHomeGrid() {
  const token = ++homeRenderToken;
  const books = await dbGetAllBooks();
  const entries = await Promise.all(books.map(async b => ({ b, count: await dbCountChaptersByBook(b.bookId).catch(() => 0), cover: await getBookCover(b.bookId) })));
  if (token !== homeRenderToken) return;
  homeBooksCache = entries;
  const sortEl = document.getElementById('home-sort');
  if (sortEl) sortEl.value = readPref('nov_home_sort', 'recent');
  renderHomeHero();
  renderHomeCards();
}

function renderHomeHero() {
  const hero = document.getElementById('home-hero');
  if (!hero) return;
  const query = (document.getElementById('home-search')?.value || '').trim();
  const recent = [...homeBooksCache].sort((x, y) => (y.b.updatedAt || 0) - (x.b.updatedAt || 0));
  const last = recent.find(x => x.b.bookId === currentBookId) || recent[0];
  if (!last || query) { hero.innerHTML = ''; return; }
  const id = jsArg(last.b.bookId);
  hero.innerHTML = `<div class="home-hero">
    <button class="home-hero-cover" onclick="continueReadingBook(${id})" tabindex="-1" aria-hidden="true">${homeCoverHtml(last.b, last.cover)}</button>
    <div class="home-hero-info">
      <div class="home-hero-label">อ่านต่อ</div>
      <div class="home-hero-title">${escapeHtml(last.b.title || 'นิยายเรื่องใหม่')}</div>
      <div class="home-hero-chap">${escapeHtml(last.b.lastChapterTitle || 'ยังไม่ได้เริ่มอ่าน')}</div>
      <button class="btn btn-primary home-hero-btn" onclick="continueReadingBook(${id})">▶ อ่านต่อ</button>
    </div>
  </div>`;
}

function setHomeSort(value) {
  try { localStorage.setItem('nov_home_sort', HOME_SORTS[value] ? value : 'recent'); } catch (e) {}
  renderHomeCards();
}

function sortHomeEntries(list, mode) {
  const out = [...list];
  if (mode === 'title') out.sort((x, y) => String(x.b.title || '').localeCompare(String(y.b.title || ''), 'th', { numeric: true }));
  else if (mode === 'chapters') out.sort((x, y) => y.count - x.count);
  else out.sort((x, y) => (y.b.updatedAt || 0) - (x.b.updatedAt || 0));
  return out;
}

function renderHomeCards() {
  const grid = document.getElementById('home-grid');
  if (!grid) return;
  const query = (document.getElementById('home-search')?.value || '').trim().toLowerCase();
  renderHomeHero();
  if (!homeBooksCache.length) {
    grid.innerHTML = `<div class="home-empty">
      <div class="home-empty-icon" aria-hidden="true">📚</div>
      <b>ยังไม่มีนิยายบนชั้น</b>
      <p>วางลิงก์ตอนแรกของนิยายที่อยากอ่าน หรือนำเข้าไฟล์ .txt / .epub ระบบจะแปลให้ทีละตอน</p>
      <div class="home-empty-actions">
        <button class="btn btn-primary" onclick="openImportModal()">+ วางลิงก์ / นำเข้าไฟล์</button>
        ${hasActiveApiKey() ? '' : '<button class="btn" onclick="openSettingsModal(\'ai\')">ตั้งค่า AI ก่อน</button>'}
      </div>
    </div>`;
    return;
  }
  const list = sortHomeEntries(homeBooksCache, readPref('nov_home_sort', 'recent'))
    .filter(x => !query || String(x.b.title || '').toLowerCase().includes(query) || String(x.b.author || '').toLowerCase().includes(query));
  grid.innerHTML = list.length
    ? list.map(homeCardHtml).join('')
    : `<div class="home-empty"><b>ไม่พบเรื่องที่ตรงกับ "${escapeHtml(query)}"</b></div>`;
}

function homeCardHtml({ b, count, cover }) {
  const id = jsArg(b.bookId);
  const read = count ? Math.min(count, (b.lastChapterIndex || 0) + 1) : 0;
  const pct = count ? Math.round(100 * read / count) : 0;
  const ns = typeof getNewChapterStates === 'function' ? getNewChapterStates()[b.bookId] : null;
  const status = getBatchStatus(b.bookId);
  const batching = status && ['running', 'queued'].includes(status.kind);
  const badges = [
    b.bookId === currentBookId ? '<span class="cover-badge reading">กำลังอ่าน</span>' : '',
    ns?.queued > 0 ? `<span class="cover-badge new">🆕 ${ns.queued} ตอนใหม่</span>` :
      (ns?.count > 0 ? `<span class="cover-badge new">🆕 ${ns.atLeast ? 'ตอนใหม่' : `${ns.count} ตอนใหม่`}</span>` : ''),
    typeof isBookFollowed === 'function' && isBookFollowed(b) ? '<span class="cover-badge follow" title="ติดตามตอนใหม่อยู่">🔔</span>' : ''
  ].join('');
  return `<article class="home-card${batching ? ' is-batching' : ''}" data-book="${escapeHtml(b.bookId)}">
    <button class="home-cover" onclick="openHome({ bookId: ${id} })" aria-label="${escapeHtml(b.title || 'นิยาย')}: ดูรายละเอียดและตอนทั้งหมด">
      ${homeCoverHtml(b, cover)}<span class="cover-badges">${badges}</span>
    </button>
    <div class="home-card-body">
      <button class="home-card-title" onclick="openHome({ bookId: ${id} })">${escapeHtml(b.title || 'นิยายเรื่องใหม่')}</button>
      <div class="home-card-meta">${escapeHtml(getGenreThaiName(b.genre))} · ${count} ตอน</div>
      <div class="home-read-bar" title="อ่านแล้ว ${read}/${count} ตอน"><span style="width: ${pct}%"></span></div>
      <div class="home-card-last">${b.lastChapterTitle ? `อ่านถึง ${escapeHtml(b.lastChapterTitle)}` : 'ยังไม่ได้อ่าน'}</div>
      <div class="home-card-batch" data-batch-for="${escapeHtml(b.bookId)}" data-compact="1">${batchProgressHtml(b.bookId, { compact: true })}</div>
      <div class="home-card-actions">
        <button class="btn btn-primary" onclick="continueReadingBook(${id})">▶ อ่านต่อ</button>
        <button class="btn" onclick="chooseBatchCount(${id})" title="แปลล่วงหน้าหลายตอน (ใช้โควตา AI)" aria-label="แปลล่วงหน้า">⚡</button>
        <button class="btn" onclick="openHomeBookMenu(this, ${id})" title="เมนูของเรื่องนี้" aria-label="เมนูของเรื่องนี้">⋯</button>
      </div>
    </div>
  </article>`;
}

async function renderHomeDetail(bookId) {
  const token = ++homeRenderToken;
  const root = document.getElementById('home-detail-view');
  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  if (!book) { homeBookId = null; return renderHome(); }
  const chaps = await dbGetChaptersByBook(bookId);
  const cover = await getBookCover(bookId);
  if (token !== homeRenderToken) return;
  const sortMode = bookSortModes[bookId] || 'time_desc';
  const sorted = [...chaps];
  applySortToChapters(sorted, sortMode);
  const pending = chaps.filter(isPendingChapter).length;
  // ตอนใหม่ที่เพิ่มเข้าคิวถูกแปลไปแล้ว (จากที่ไหนก็ตาม): ป้ายต้องตรงกับที่ยังรอแปลจริง
  if (typeof syncFollowBadgeWithPending === 'function') await syncFollowBadgeWithPending(bookId, pending);
  const id = jsArg(bookId);
  const keepScroll = document.getElementById('home-view').scrollTop;
  const prevListScroll = document.getElementById(`shelf-chaps-${bookId}`)?.scrollTop || 0;
  const selected = new Set([...document.querySelectorAll('.chap-chk:checked')].filter(c => c.dataset.bookId === bookId).map(c => c.value));

  root.innerHTML = `<div class="home-detail">
    <button class="btn home-back" onclick="homeBack()">← ชั้นหนังสือ</button>
    <div class="home-detail-head">
      <div class="home-detail-cover">
        <div class="home-detail-cover-img">${homeCoverHtml(book, cover)}</div>
        <button class="btn cover-change-btn" onclick="pickBookCover(${id})">🖼 ${cover ? 'เปลี่ยนปก' : 'ใส่ภาพปก'}</button>
      </div>
      <div class="home-detail-info">
        <h1 class="home-detail-title">${escapeHtml(book.title || 'นิยายเรื่องใหม่')}</h1>
        ${book.author ? `<div class="home-detail-author">${escapeHtml(book.author)}</div>` : ''}
        <button class="gloss-chip home-genre-chip" onclick="openGenrePickerModal(event, ${id})" title="เปลี่ยนแนวเรื่องและภาษาต้นฉบับ">🏷️ ${escapeHtml(getGenreThaiName(book.genre))} · ${escapeHtml(getLangName(getBookSourceLang(book)))} ✎</button>
        <div class="home-detail-stats" id="shelf-meta-${escapeHtml(bookId)}">
          ${book.lastChapterTitle ? `อ่านถึง <b>${escapeHtml(book.lastChapterTitle)}</b><br>` : ''}มี ${chaps.length} ตอนในเครื่อง${pending ? ` · รอแปล ${pending} ตอน` : ''}
        </div>
        <div class="home-detail-actions">
          <button class="btn btn-primary" onclick="continueReadingBook(${id})">▶ อ่านต่อ</button>
          <button class="btn" onclick="chooseBatchCount(${id})">⚡ แปลล่วงหน้า</button>
          <button class="btn" onclick="checkNewChaptersForBook(${id})" title="เช็กว่าเว็บต้นฉบับมีตอนใหม่หรือยัง (ไม่ใช้โควตา AI)">🔎 เช็กตอนใหม่</button>
          <button class="btn${isBookFollowed(book) ? ' btn-primary' : ''}" onclick="setBookFollow(${id}, ${!isBookFollowed(book)})" aria-pressed="${isBookFollowed(book)}" title="เช็กตอนใหม่ให้เองทุก 30 นาทีระหว่างเปิดแอพ เจอแล้วเพิ่มเข้าคิวรอแปล (ไม่ใช้โควตา AI)">${isBookFollowed(book) ? '🔔 ติดตามอยู่' : '🔔 ติดตามตอนใหม่'}</button>
          <button class="btn" onclick="openHomeBookMenu(this, ${id})" title="เมนูอื่นๆ ของเรื่องนี้" aria-label="เมนูอื่นๆ ของเรื่องนี้">⋯</button>
        </div>
        <div class="home-newchap" id="newchap-${escapeHtml(bookId)}">${newChapterBadgeHtml(bookId)}</div>
      </div>
    </div>
    <div class="home-detail-batch" data-batch-for="${escapeHtml(bookId)}" aria-live="polite">${batchProgressHtml(bookId)}</div>
    <section class="home-chap-section" aria-label="ตอนทั้งหมด">
      <div class="home-chap-toolbar">
        <h2>ตอนทั้งหมด <span>(${chaps.length})</span></h2>
        <select class="form-input" onchange="setShelfSort(${id}, this.value)" aria-label="เรียงตอน">
          ${Object.entries(SHELF_SORT_LABELS).map(([k, l]) => `<option value="${k}"${k === sortMode ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="btn" onclick="toggleSelectAllChaps(${id})">เลือกทั้งหมด</button>
      </div>
      <div class="shelf-select-bar" id="shelf-select-bar-${escapeHtml(bookId)}" hidden>
        <span id="shelf-select-count-${escapeHtml(bookId)}">เลือกไว้ 0 ตอน</span>
        <button class="btn" onclick="openMoveChaptersModal(${id})" title="ย้ายตอนที่เลือกไปเรื่องอื่น หรือแยกเป็นเรื่องใหม่">↪ ย้ายไปเรื่องอื่น</button>
        <button class="btn btn-danger" onclick="deleteSelectedChapters(${id})">🗑️ ลบที่เลือก</button>
      </div>
      <div class="home-chap-list" id="shelf-chaps-${escapeHtml(bookId)}">${renderChaptersHtml(bookId, sorted, book.lastChapterId)}</div>
    </section>
  </div>`;
  // วาดใหม่ระหว่างแปลล่วงหน้า: คงตำแหน่งเลื่อนและตอนที่ติ๊กไว้
  document.querySelectorAll('.chap-chk').forEach(c => { if (c.dataset.bookId === bookId && selected.has(c.value)) c.checked = true; });
  updateSelectedDeleteBtn(bookId);
  document.getElementById('home-view').scrollTop = keepScroll;
  const list = document.getElementById(`shelf-chaps-${bookId}`);
  if (list) list.scrollTop = prevListScroll;
}

// ---------- คำสั่ง ----------
async function continueReadingBook(bookId) {
  if (typeof clearFollowQueuedBadge === 'function') clearFollowQueuedBadge(bookId);
  if (currentBookId !== bookId) await loadBookFromDB(bookId);
  closeHome();
}

function openHomeBookMenu(anchor, bookId) {
  const entry = homeBooksCache.find(x => x.b.bookId === bookId);
  const status = getBatchStatus(bookId);
  const running = status && ['running', 'queued'].includes(status.kind);
  const hasCover = !!homeCoverCache.get(bookId);
  const fakeEvent = { stopPropagation() {} };
  openActionMenu(anchor, [
    { icon: '📚', label: 'รายละเอียดและตอนทั้งหมด', hidden: homeBookId === bookId, onSelect: () => openHome({ bookId }) },
    running
      ? { icon: '⏹', label: status.kind === 'running' ? 'หยุดแปลล่วงหน้า' : 'ยกเลิกคิวแปล', onSelect: () => cancelBatchTranslate(bookId) }
      : { icon: '⚡', label: 'แปลล่วงหน้า…', hint: 'ใช้โควตา AI · บอกค่าใช้จ่ายก่อนเริ่ม', onSelect: () => chooseBatchCount(bookId) },
    { icon: '🔎', label: 'เช็กตอนใหม่', hint: 'ไม่ใช้โควตา AI', onSelect: () => checkNewChaptersForBook(bookId) },
    isBookFollowed(entry?.b)
      ? { icon: '🔕', label: 'เลิกติดตามตอนใหม่', onSelect: () => setBookFollow(bookId, false) }
      : { icon: '🔔', label: 'ติดตามตอนใหม่อัตโนมัติ', hint: 'เช็กให้เองระหว่างเปิดแอพ · Pro ขึ้นไป', onSelect: () => setBookFollow(bookId, true) },
    { icon: '🖼', label: hasCover ? 'เปลี่ยนภาพปก' : 'ใส่ภาพปก', onSelect: () => pickBookCover(bookId) },
    { icon: '🧹', label: 'ใช้ปกสีอัตโนมัติ', hint: 'ลบภาพปกที่ใส่ไว้', hidden: !hasCover, onSelect: () => removeBookCover(bookId) },
    { icon: '✎', label: 'แก้ชื่อเรื่อง', onSelect: () => renameBook(bookId) },
    { icon: '🏷️', label: 'แนวเรื่อง / ภาษาต้นฉบับ', onSelect: () => openGenrePickerModal(fakeEvent, bookId) },
    { icon: '📑', label: 'สารบัญ', hint: 'หาตอนถัดไปแม่นขึ้น เรียงตอน เติมตอนที่ขาด', onSelect: () => openTocModal(fakeEvent, bookId) },
    { icon: '🔗', label: 'แก้ URL ตอนถัดไป', onSelect: () => fixBookNextUrl(bookId) },
    { icon: '📋', label: 'รายงานคุณภาพ', hint: 'ไม่ใช้โควตา AI', onSelect: () => openQualityReport(bookId) },
    { icon: '📄', label: 'ส่งออกทั้งเรื่องเป็น TXT', onSelect: () => exportBookTxt(bookId) },
    { icon: '📘', label: 'ส่งออกทั้งเรื่องเป็น EPUB', onSelect: () => exportBookEpub(bookId) },
    { icon: '🗑️', label: 'ลบทั้งเรื่อง', danger: true, onSelect: () => removeBookFromShelf(fakeEvent, bookId) }
  ], { title: entry?.b.title || 'นิยาย' });
}

function openHomeMenu(anchor) {
  openActionMenu(anchor, [
    { icon: '🔔', label: 'เช็กตอนใหม่ทุกเรื่อง', hint: 'ไม่ใช้โควตา AI', onSelect: checkNewChaptersForAllBooks },
    { icon: '⬇️', label: 'สำรองข้อมูลทั้งหมด', hint: 'ไฟล์ .json ไม่รวม API Key', onSelect: exportBackup },
    { icon: '⬆️', label: 'นำเข้าไฟล์สำรอง', onSelect: triggerBackupImport },
    { icon: '📊', label: 'การใช้งาน AI', hint: 'token ที่ใช้ เพดานค่าใช้จ่าย', onSelect: openUsageModal }
  ], { title: 'ชั้นหนังสือ' });
}

async function renameBook(bookId) {
  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  if (!book) return;
  const title = await appPrompt('ชื่อที่ตั้งเองจะถูกล็อกไว้ ระบบจะไม่เปลี่ยนตามเว็บต้นฉบับ', book.title || '', { title: 'แก้ชื่อเรื่อง' });
  if (title === null || !title.trim()) return;
  if (currentBookId === bookId) {
    currentBookTitle = title.trim();
    isUserCustomTitle = true;
    document.getElementById('display-book-title').innerText = currentBookTitle;
    await saveReadingPointer(currentChapterIndex);
  } else {
    await dbSaveBook({ ...book, title: title.trim(), isUserCustomTitle: true });
  }
  await refreshShelfViewOnly(bookId);
}

// ---------- ภาพปก ----------
const COVER_W = 360;
const COVER_H = 540;

/** ย่อ/ครอปรูปเป็นสัดส่วนปก 2:3 แล้วบีบเป็น JPEG ขนาดไม่เกิน ~350KB */
function resizeImageToCover(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('ไฟล์นี้ไม่ใช่รูปภาพ'));
    if (file.size > 25 * 1024 * 1024) return reject(new Error('รูปใหญ่เกิน 25MB'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = COVER_W;
      canvas.height = COVER_H;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(COVER_W / img.naturalWidth, COVER_H / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, COVER_W, COVER_H);
      ctx.drawImage(img, (COVER_W - w) / 2, (COVER_H - h) / 2, w, h);
      let quality = 0.85;
      let out = canvas.toDataURL('image/jpeg', quality);
      while (out.length > 350000 && quality > 0.4) {
        quality -= 0.15;
        out = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้')); };
    img.src = url;
  });
}

async function saveBookCover(bookId, cover) {
  const data = await dbGetBookData(bookId);
  if (cover) data.cover = cover; else delete data.cover;
  await dbSaveBookData({ ...data, bookId });
  homeCoverCache.set(bookId, cover || null);
  await refreshShelfViewOnly(bookId);
}

function pickBookCover(bookId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/gif';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await saveBookCover(bookId, await resizeImageToCover(file));
    } catch (err) {
      appAlert(`ใช้รูปนี้เป็นปกไม่ได้: ${err.message}`);
    }
  });
  input.click();
}

async function removeBookCover(bookId) {
  await saveBookCover(bookId, null);
}
