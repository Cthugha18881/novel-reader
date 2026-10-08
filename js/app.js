// ==================== APP CONTROLLER & VIEWER ====================
let currentTheme = 'sepia';
let currentFontSize = 18;
let currentUrl = "";
let nextUrlCalculated = "";
let isPrefetching = false;
let lastPrefetchError = '';
let currentBookId = "default_novel";
let currentBookTitle = "Dusktale";
let currentAuthor = "";
let currentBookGenre = "xianxia";
let currentSourceLang = DEFAULT_SOURCE_LANG;
let isUserCustomTitle = false;

let bookIdForGenreEdit = null;
let termBeingEditedSrc = null;

let renderedWindowIndices = [];
let isAppendingNextChapter = false;
let chapterIntersectionObserver = null;
let renderRequestVersion = 0;
// จำนวนตอนสูงสุดที่อยู่บนหน้าพร้อมกัน (โหมดอ่านต่อเนื่อง) เกินนี้เอาตอนที่ไกลจากตำแหน่งอ่านออก
const MAX_RENDERED_CHAPTERS = 4;

let selectedWordBuffer = "";
let isSelectedChinese = false;
let selectedParagraphContext = { th: "", src: "", uniqueKey: "" };

// ตอนว่างสำหรับตอนที่ยังไม่ได้เปิดนิยาย (หน้าจอแสดงหน้าต้อนรับแทน ดู buildWelcomeHtml)
function createGuideChapters() {
  return [{
    id: "guide_chap_1",
    title: "ยินดีต้อนรับ",
    paragraphs: [],
    summary: ""
  }];
}

/** หน้าต้อนรับ: ขั้นตอนเริ่มต้น 2 ขั้น (ตั้งค่า AI → วางลิงก์/ไฟล์) + อ่านต่อเรื่องล่าสุดถ้ามี */
async function buildWelcomeHtml() {
  const hasKey = hasActiveApiKey() && !!getActiveLlmConfig().model;
  const hostedReady = typeof isHostedConfigured === 'function' && isHostedConfigured();
  const books = (await dbGetAllBooks().catch(() => [])).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const last = books[0];
  return `<section class="welcome" aria-labelledby="welcome-title">
    <img class="welcome-logo" src="icons/icon-192.png" alt="" width="72" height="72">
    <div class="welcome-brand">Dusk<span class="brand-title-accent">tale</span></div>
    <h1 class="welcome-title" id="welcome-title">อ่านนิยายจีน ญี่ปุ่น เกาหลี เป็นภาษาไทย</h1>
    <p class="welcome-lead">วางลิงก์ตอนนิยาย แล้ว AI แปลให้อ่านต่อเนื่อง ชื่อตัวละครและคำศัพท์ตรงกันทุกตอน ข้อมูลทั้งหมดเก็บในเครื่องนี้</p>
    ${last ? `<div class="welcome-continue"><b>อ่านต่อ: ${escapeHtml(last.title || '')}</b>
      <div class="welcome-actions">
        <button class="btn btn-primary" onclick="loadBookFromDB(${jsArg(last.bookId)})">อ่านต่อ${last.lastChapterTitle ? ` "${escapeHtml(String(last.lastChapterTitle).slice(0, 40))}"` : ''}</button>
        <button class="btn" onclick="openBookshelfModal()">เปิดชั้นหนังสือ (${books.length} เรื่อง)</button>
      </div></div>` : ''}
    <div class="welcome-steps">
      <div class="welcome-step${hasKey ? ' done' : ''}">
        <div class="welcome-num" aria-hidden="true">${hasKey ? '✓' : '1'}</div>
        <div>
          <h2>${hasKey ? 'ตั้งค่า AI แล้ว' : (hostedReady ? 'เข้าสู่ระบบ หรือใช้ API Key ของตัวเอง' : 'ตั้งค่า AI ที่ใช้แปล')}</h2>
          <p>${hasKey
            ? (getActiveProvider() === 'dusktale' ? 'ใช้บริการแปลของ Dusktale (ไม่ต้องใช้ API Key)' : `ใช้ ${escapeHtml(LLM_PROVIDERS[getActiveProvider()].label)} · ${escapeHtml(getActiveLlmConfig().model)}`)
            : (hostedReady ? 'เข้าสู่ระบบด้วยอีเมลแล้วแปลได้เลย ฟรีเดือนละประมาณ ' + Math.floor(HOSTED.freeTokens / HOSTED.tokensPerChapter) + ' ตอน หรือใช้ API Key ของ Gemini, Claude, OpenRouter ที่มีอยู่แล้ว' : 'เลือกผู้ให้บริการ (Gemini, Claude หรือ OpenAI-compatible เช่น OpenRouter) แล้ววาง API Key ของคุณ')}</p>
          <div class="welcome-actions">${hostedReady && !hasKey
            ? '<button class="btn btn-primary" onclick="openHostedSignIn()">เข้าสู่ระบบ — แปลได้เลยฟรี</button><button class="btn" onclick="openSettingsModal(\'ai\')">ใช้ API Key ของตัวเอง</button>'
            : `<button class="btn${hasKey ? '' : ' btn-primary'}" onclick="openSettingsModal()">${hasKey ? 'เปลี่ยนการตั้งค่า AI' : 'ตั้งค่า AI'}</button>`}</div>
        </div>
      </div>
      <div class="welcome-step">
        <div class="welcome-num" aria-hidden="true">2</div>
        <div>
          <h2>เพิ่มนิยายเรื่องแรก</h2>
          <p>วางลิงก์หน้าตอนจากเว็บนิยาย หรือนำเข้าไฟล์ .txt / .epub ระบบแปลตอนถัดไปให้ล่วงหน้าระหว่างอ่าน</p>
          <div class="welcome-actions">
            <button class="btn${hasKey ? ' btn-primary' : ''}" onclick="openImportModal()">วางลิงก์นิยาย</button>
            <button class="btn" onclick="openImportModal(); switchImportTab('text')">นำเข้าไฟล์หรือข้อความ</button>
          </div>
        </div>
      </div>
    </div>
    <p class="welcome-note">มีคำถามเรื่องการใช้งาน กดปุ่ม 💬 มุมขวาล่างเพื่อถามผู้ช่วย AI ได้ · ข้อมูลอยู่ในเบราว์เซอร์นี้เท่านั้น อย่าลืมสำรองข้อมูลที่ ตั้งค่า → 💾 ข้อมูล</p>
    <p class="legal-links"><a href="legal/privacy.html">นโยบายความเป็นส่วนตัว</a> · <a href="legal/terms.html">ข้อกำหนดการใช้งาน</a></p>
  </section>`;
}

let chapters = createGuideChapters();
let currentChapterIndex = 0;

function resetToGuideBook() {
  localStorage.removeItem('nov_last_book_id');
  currentBookId = 'default_novel';
  currentBookTitle = 'Dusktale';
  currentAuthor = '';
  currentBookGenre = 'xianxia';
  currentSourceLang = DEFAULT_SOURCE_LANG;
  isUserCustomTitle = false;
  currentUrl = '';
  nextUrlCalculated = '';
  chapters = createGuideChapters();
  currentChapterIndex = 0;
  renderVirtualWindow(0, true);
}

function toggleFullscreenMode() {
  const isCurrentlyFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.body.classList.contains('is-fullscreen');

  if (!isCurrentlyFullscreen) {
    const elem = document.documentElement;
    if (elem.requestFullscreen) elem.requestFullscreen().catch(() => {});
    else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    document.body.classList.add('is-fullscreen');
    document.getElementById('fullscreen-icon').innerText = '🗗';
    document.getElementById('fullscreen-btn').title = 'ออกจากโหมดเต็มจอ';
  } else {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    document.body.classList.remove('is-fullscreen');
    document.getElementById('fullscreen-icon').innerText = '⛶';
    document.getElementById('fullscreen-btn').title = 'โหมดอ่านเต็มจอ';
  }
}

function setupFullscreenListener() {
  document.addEventListener('fullscreenchange', () => {
    const isFS = !!document.fullscreenElement;
    if (isFS) {
      document.body.classList.add('is-fullscreen');
      document.getElementById('fullscreen-icon').innerText = '🗗';
      document.getElementById('fullscreen-btn').title = 'ออกจากโหมดเต็มจอ';
    } else {
      document.body.classList.remove('is-fullscreen');
      document.getElementById('fullscreen-icon').innerText = '⛶';
      document.getElementById('fullscreen-btn').title = 'โหมดอ่านเต็มจอ';
    }
  });
}

function cycleTheme() {
  const themes = ['sepia', 'light', 'dark'];
  currentTheme = themes[(themes.indexOf(currentTheme) + 1) % themes.length];
  const body = document.getElementById('app-body');
  ['theme-sepia', 'theme-light', 'theme-dark'].forEach(cls => body.classList.remove(cls));
  body.classList.add('theme-' + currentTheme);

  const themeText = currentTheme === 'sepia' ? 'ถนอมสายตา' : (currentTheme === 'light' ? 'สว่าง' : 'มืด');
  const mobileBtn = document.getElementById('mobile-theme-btn');
  const desktopBtn = document.getElementById('desktop-theme-btn');
  if (mobileBtn) mobileBtn.innerText = themeText;
  if (desktopBtn) desktopBtn.innerText = themeText;
  localStorage.setItem('nov_theme', currentTheme);
}

function adjustFontSize(delta) {
  currentFontSize = Math.min(28, Math.max(14, currentFontSize + delta));
  // เปลี่ยนขนาดแล้วเนื้อหายืด/หด: ตรึงย่อหน้าที่อ่านอยู่ไว้ที่เดิมบนจอ
  preserveScrollAnchor(() => {
    document.getElementById('reading-content').style.fontSize = currentFontSize + 'px';
  });
  localStorage.setItem('nov_font_size', currentFontSize);
}

const CHAPTER_TYPE_LABELS = {
  story: '📖 เนื้อเรื่อง',
  side_story: '✨ ตอนพิเศษ',
  author_note: '📢 ประกาศผู้เขียน',
  placeholder: '🛡️ ตอนกันก๊อป'
};

function buildPlaceholderNoticeHtml(chap) {
  const srcHtml = chap.paragraphs.map(p => `<p>${escapeHtml(p.src || '')}</p>`).join('');
  const locked = chap.placeholderReason === 'locked';
  const lockText = describeLockInfo(chap.lockInfo);
  const heading = locked ? lockText.heading : '🛡️ ตอนนี้ยังเป็นเนื้อหากันก๊อป (ข้อความหลอก)';
  const detail = locked
    ? `${escapeHtml(chap.lockInfo ? lockText.short : 'หน้าเว็บมีแค่ตัวอย่างสั้นๆ')} ระบบจึงไม่แปลข้อความตัวอย่าง (ประหยัดโควตา และไม่ให้ตัวอย่างไปปนบริบทของเรื่อง)
      <div style="margin-top: 6px;"><b>ทำไมซื้อแล้วก็ยังได้แค่ตัวอย่าง:</b> แอพนี้ดึงหน้าเว็บผ่าน r.jina.ai ซึ่งเปิดหน้าเว็บในฐานะผู้อ่านที่ไม่ได้ล็อกอิน จึงไม่เห็นตอนที่คุณซื้อหรือปลดล็อกไว้ในบัญชีของคุณ
      ถ้าคุณมีสิทธิ์อ่านตอนนี้ ให้คัดลอกเนื้อหาเต็มจากเว็บหรือแอพของเว็บมาวางด้วยปุ่มด้านล่าง</div>`
    : 'ผู้เขียนมักเปลี่ยนเป็นเนื้อหาจริงภายหลัง ระบบจึงยังไม่แปลเพื่อประหยัดโควตา และไม่ใช้ตอนนี้ต่อบริบทของเรื่อง';
  const hasSrc = chap.paragraphs.some(p => p.src);
  return `
    <div class="placeholder-notice">
      <div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(heading)}</div>
      <div style="font-size: 12px; opacity: 0.85; margin-bottom: 10px; line-height: 1.6;">${detail}</div>
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        ${locked ? `<button class="btn btn-primary" style="padding: 5px 12px; font-size: 12px;" onclick="openPasteChapterModal(${jsArg(chap.id)})">📋 วางเนื้อหาเต็มเอง</button>` : ''}
        ${chap.sourceUrl ? `<button class="btn${locked ? '' : ' btn-primary'}" style="padding: 5px 12px; font-size: 12px;" onclick="refetchChapterFromSource(${jsArg(chap.id)})">🔄 ดึงจากหน้าเว็บใหม่</button>` : ''}
        ${locked && hasSrc ? `<button class="btn" style="padding: 5px 12px; font-size: 12px;" onclick="translateLockedPreview(${jsArg(chap.id)})" title="แปลข้อความตัวอย่างที่ได้มา (เนื้อหาไม่ครบ)">แปลเฉพาะตัวอย่าง</button>` : ''}
        ${!locked && hasSrc ? `<button class="btn" style="padding: 5px 12px; font-size: 12px;" onclick="translatePlaceholderAnyway(${jsArg(chap.id)})" title="บางตอนเป็นคำอธิบายหรือประกาศสั้นๆ ของผู้เขียน แปลอ่านได้ (ใช้โควตา AI)">📝 แปลข้อความนี้</button>` : ''}
      </div>
      <details style="margin-top: 10px; font-size: 12px;"><summary style="cursor: pointer; opacity: 0.7;">ดูข้อความต้นฉบับที่ดึงมา</summary><div class="para-src" style="display: block;">${srcHtml}</div></details>
    </div>`;
}

// ---------- ตอนที่ต้องซื้อ: วางเนื้อหาเอง / แปลเฉพาะตัวอย่าง ----------
let pasteChapterId = null;

async function openPasteChapterModal(chapId) {
  const chapter = await findChapterAnywhere(chapId);
  if (!chapter) return appAlert('ไม่พบตอนนี้');
  pasteChapterId = chapId;
  document.getElementById('paste-chapter-title').innerText = chapter.title || '';
  document.getElementById('paste-chapter-text').value = '';
  openModal('paste-chapter-modal');
}

/** ใช้เนื้อหาที่ผู้ใช้วางเป็นต้นฉบับของตอนนี้ (คง id/ลำดับ/URL เดิม) แล้วแปล */
async function savePastedChapter() {
  const text = document.getElementById('paste-chapter-text').value;
  if (!text.trim()) return appAlert('กรุณาวางเนื้อหาของตอนนี้ก่อน');
  if (text.length > IMPORT_LIMITS.pasteChars) return appAlert('ข้อความยาวเกินไป');
  const chapter = await findChapterAnywhere(pasteChapterId);
  if (!chapter) return appAlert('ไม่พบตอนนี้');
  // คำแปลเดิม (เช่นแปลจากตัวอย่าง) เก็บไว้ในประวัติเวอร์ชันก่อนถูกแทน
  try {
    if (await saveChapterVersion(chapter, 'paste')) chapter.hasVersions = true;
  } catch (err) {
    console.warn('Save chapter version failed:', err);
  }
  chapter.paragraphs = splitSourceParagraphs(text).map(src => ({ th: '', src }));
  chapter.status = 'pending';
  chapter.chapterType = 'story';
  chapter.sourceNote = 'pasted';
  delete chapter.placeholderReason;
  delete chapter.lockInfo;
  delete chapter.pendingLockInfo;
  await dbSaveChapter(chapter);
  closeModal('paste-chapter-modal');
  if (currentBookId === chapter.bookId) await renderVirtualWindow(currentChapterIndex);
  await translatePendingChapterNow(chapter.id);
}

/** แปลข้อความตัวอย่างของตอนที่ต้องซื้อ และติดป้ายว่าเป็นแค่ตัวอย่าง */
async function translateLockedPreview(chapId) {
  const chapter = await findChapterAnywhere(chapId);
  if (!chapter) return appAlert('ไม่พบตอนนี้');
  if (!(await appConfirm('แปลเฉพาะข้อความตัวอย่างที่ได้มา เนื้อหาจะไม่ครบตอน (ใช้โควตา AI)', { title: 'แปลเฉพาะตัวอย่าง', confirmLabel: 'แปลตัวอย่าง' }))) return;
  if (isTaskRunning('retranslate')) return appAlert('กำลังแปลบทอื่นอยู่ กรุณารอให้เสร็จก่อน');
  const lockInfo = chapter.lockInfo || null;
  const books = await dbGetAllBooks();
  const ctx = makeBookContext(books.find(b => b.bookId === chapter.bookId) || getCurrentBookContext());
  const controller = beginTask('retranslate');
  showGlobalToast(`กำลังแปลตัวอย่างของ "${chapter.title}"...`);
  try {
    const rawText = chapter.paragraphs.map(p => p.src || '').filter(Boolean).join('\n\n');
    const bookChaps = await dbGetChaptersByBook(chapter.bookId);
    const result = await translateChapter(rawText, ctx, {
      signal: controller.signal, onStatus: showGlobalToast, rawChapTitle: chapter.title,
      prevChapter: findPrevStoryChapter(bookChaps, chapter.order ?? 0)
    });
    // ตัวอย่างไม่ครบตอน: ไม่ใช้สรุปของตอนนี้เป็นบริบทของตอนถัดไป
    result.summary = '';
    result.previewOnly = true;
    await applyTranslationToChapter(chapter, result, { updateTitle: false, reason: 'preview' });
    if (lockInfo) {
      chapter.lockInfo = lockInfo;
      await dbSaveChapter(chapter);
      if (currentBookId === chapter.bookId) await renderVirtualWindow(currentChapterIndex);
    }
  } catch (err) {
    if (!isAbortError(err)) appAlert(`แปลไม่สำเร็จ: ${err.message}`);
  } finally {
    endTask('retranslate', controller);
    hideGlobalToast();
  }
}

/** ตอนที่ระบบตรวจว่าเป็นกันก๊อป แต่ผู้ใช้อยากอ่าน (อาจเป็นคำอธิบาย/ประกาศสั้นๆ): แปลเป็นข้อความผู้เขียน ไม่ใช้เป็นบริบทของเรื่อง */
async function translatePlaceholderAnyway(chapId) {
  const chapter = await findChapterAnywhere(chapId);
  if (!chapter) return appAlert('ไม่พบตอนนี้');
  if (isTaskRunning('retranslate')) return appAlert('กำลังแปลบทอื่นอยู่ กรุณารอให้เสร็จก่อน');
  if (!(await appConfirm('แปลข้อความที่ดึงมาของตอนนี้ตามที่เป็น (ใช้โควตา AI)\nถ้าเป็นข้อความหลอกจริง คำแปลก็จะไม่ใช่เนื้อเรื่อง ภายหลังกด "ดึงจากหน้าเว็บใหม่" เพื่อเอาเนื้อหาจริงได้\nตอนนี้จะไม่ถูกใช้เป็นบริบทของตอนถัดไป', { title: 'แปลข้อความนี้', confirmLabel: 'แปล' }))) return;
  const books = await dbGetAllBooks();
  const ctx = makeBookContext(books.find(b => b.bookId === chapter.bookId) || getCurrentBookContext());
  const controller = beginTask('retranslate');
  showGlobalToast(`กำลังแปล "${chapter.title}"...`);
  try {
    const rawText = chapter.paragraphs.map(p => p.src || '').filter(Boolean).join('\n\n');
    const result = await translateChapter(rawText, ctx, { signal: controller.signal, onStatus: showGlobalToast, rawChapTitle: chapter.title, forceTranslate: true });
    if (result.chapterType === 'placeholder') result.chapterType = 'author_note';
    result.summary = '';
    await applyTranslationToChapter(chapter, result, { updateTitle: false, reason: 'translate' });
  } catch (err) {
    if (!isAbortError(err)) appAlert(`แปลไม่สำเร็จ: ${describeScrapeError(err)}`);
  } finally {
    endTask('retranslate', controller);
    hideGlobalToast();
  }
}

function buildPreviewOnlyBannerHtml(chap) {
  return `<div class="preview-only-banner">⚠️ แปลจากข้อความตัวอย่างเท่านั้น เนื้อหาไม่ครบตอน${chap.lockInfo ? ` — ${escapeHtml(describeLockInfo(chap.lockInfo).short)}` : ''}
    <button class="btn" style="padding: 2px 8px; font-size: 11px; margin-left: 6px;" onclick="openPasteChapterModal(${jsArg(chap.id)})">📋 วางเนื้อหาเต็ม</button></div>`;
}

function buildChapterBlockHtml(chap, chapIdx, activeTerms) {
  const chapterType = chap.chapterType || 'story';
  // ภาษาของต้นฉบับ: ให้โปรแกรมอ่านจอและฟอนต์เลือกถูกภาษา (หน้าเป็น lang="th") WCAG 3.1.2
  const srcLang = escapeHtml(normalizeLang(currentSourceLang || DEFAULT_SOURCE_LANG));
  const isNoteChapter = chapterType === 'author_note';
  let parasHtml = '';
  let junkCount = 0;

  if (chap.status === 'pending') {
    parasHtml = buildPendingNoticeHtml(chap);
  } else if (chapterType === 'placeholder') {
    parasHtml = buildPlaceholderNoticeHtml(chap);
  } else {
    if (chap.previewOnly) parasHtml += buildPreviewOnlyBannerHtml(chap);
    chap.paragraphs.forEach((p, pIdx) => {
      const kind = p.kind || 'story';
      if (kind === 'site_junk') {
        junkCount++;
        // ไม่ลบทิ้ง แค่ซ่อนไว้ เลขย่อหน้า (ใช้จำตำแหน่งอ่าน) จึงไม่เลื่อน
        parasHtml += `
      <div class="para-item para-junk" id="para-box-${chapIdx}-${pIdx}">
        <span class="para-kind-label">🌐 ข้อความจากหน้าเว็บ (ไม่ได้แปล)</span>
        <div class="para-src" style="display: block;" lang="${srcLang}">${escapeHtml(p.src || '')}</div>
      </div>`;
        return;
      }
      const highlightedTh = applyInlineTermHighlighting(p.th || "", activeTerms);
      const noteLabel = (kind === 'author_note' && !isNoteChapter)
        ? `<span class="para-kind-label">📝 ข้อความผู้เขียน <button class="para-kind-reset" onclick="markParagraphAsStory(event, ${chapIdx}, ${pIdx})" title="ไม่ใช่ข้อความผู้เขียน เปลี่ยนเป็นเนื้อเรื่อง">ไม่ใช่</button></span>`
        : '';
      const bookmark = typeof findBookmark === 'function' ? findBookmark(chap.id, pIdx) : null;
      const actions = `
          <div class="para-actions">
            ${p.src ? `<button class="para-action-btn" onclick="openEditParagraphModal(event, ${chapIdx}, ${pIdx})">✎ แก้คำแปล</button>` : ''}
            ${p.src && p.thDraft && p.thDraft !== p.th ? `<button class="para-action-btn" onclick="swapParagraphDraft(event, ${chapIdx}, ${pIdx})" title="สลับไปใช้คำแปลอีกฉบับ (ก่อนเกลา/ก่อนแก้)">↺ ใช้ฉบับ${p.userEdited ? 'ของ AI' : 'ก่อนเกลา'}</button>` : ''}
            <button class="para-action-btn" onclick="openBookmarkEditor(event, ${chapIdx}, ${pIdx})">${bookmark ? '🔖 แก้บุ๊กมาร์ก/โน้ต' : '🔖 บุ๊กมาร์ก/โน้ต'}</button>
            <button class="para-action-btn" onclick="readFromParagraph(event, ${chapIdx}, ${pIdx})" title="อ่านออกเสียงตั้งแต่ย่อหน้านี้">🔊 ฟังจากตรงนี้</button>
          </div>`;
      const ttsClass = typeof isTtsParagraph === 'function' && isTtsParagraph(chap.id, pIdx) ? ' para-tts-active' : '';
      parasHtml += `
      <div class="para-item${kind === 'author_note' ? ' para-note' : ''}${p.userEdited ? ' para-user-edited' : ''}${bookmark ? ' para-bookmarked' : ''}${ttsClass}" id="para-box-${chapIdx}-${pIdx}">
        ${bookmark ? bookmarkMarkHtml(bookmark, chapIdx, pIdx) : ''}
        ${noteLabel}
        <div class="para-th" tabindex="0" role="button" aria-expanded="false" aria-controls="src-${chapIdx}-${pIdx}" onclick="toggleParagraphSrc(event, '${chapIdx}-${pIdx}')" data-unique-key="${chapIdx}-${pIdx}" data-th="${escapeHtml(encodeURIComponent(p.th || ''))}" data-src="${escapeHtml(encodeURIComponent(p.src || ''))}">${highlightedTh}</div>
        <div class="para-src" id="src-${chapIdx}-${pIdx}"><span class="para-src-text"${p.src ? ` lang="${srcLang}"` : ''}>${escapeHtml(p.src || "ไม่มีข้อความต้นฉบับ")}</span>${actions}</div>
      </div>
    `;
    });
    if (junkCount > 0) {
      parasHtml += `<div class="junk-toggle-line">ซ่อนข้อความจากหน้าเว็บไว้ ${junkCount} ย่อหน้า · <a href="#" onclick="toggleShowJunk(event)">${document.body.classList.contains('show-junk') ? 'ซ่อน' : 'แสดง'}</a></div>`;
    }
  }

  const typeLabel = chapterType === 'placeholder' && chap.placeholderReason === 'locked' ? '🔒 ตอนที่ต้องซื้อ' : (CHAPTER_TYPE_LABELS[chapterType] || chapterType);
  const typeBadge = chapterType !== 'story' ? `<span class="chapter-type-badge type-${chapterType}">${typeLabel}</span>` : '';
  return `
      <div class="chapter-block chapter-type-${chapterType}" id="chapter-block-${chapIdx}" data-index="${chapIdx}" data-id="${escapeHtml(chap.id)}">
      <div class="chapter-block-divider">
        <span class="chapter-divider-pill">📖 ${escapeHtml(chap.title)}</span>
        ${chap.hasVersions ? `<button class="chapter-version-btn" onclick="openVersionHistory(${jsArg(chap.id)})" title="ดู/เทียบ/กู้คืนคำแปลฉบับก่อนหน้าของตอนนี้">🕘 ฉบับก่อน</button>` : ''}
      </div>
      ${typeBadge ? `<div style="text-align: center; margin: -10px 0 16px;">${typeBadge}</div>` : ''}
      <div class="chapter-body${isNoteChapter ? ' note-chapter-body' : ''}">${parasHtml}</div>
    </div>
  `;
}

function toggleShowJunk(e) {
  if (e) e.preventDefault();
  const show = !document.body.classList.contains('show-junk');
  document.body.classList.toggle('show-junk', show);
  localStorage.setItem('nov_show_junk', show ? 'true' : 'false');
  const chk = document.getElementById('show-junk-paras');
  if (chk) chk.checked = show;
  renderVirtualWindow(currentChapterIndex);
}

// ==================== EDIT TRANSLATION IN READER ====================
let paragraphBeingEdited = null;

function openEditParagraphModal(e, chapIdx, pIdx) {
  if (e) e.stopPropagation();
  const p = chapters[chapIdx]?.paragraphs[pIdx];
  if (!p) return;
  paragraphBeingEdited = { chapIdx, pIdx, chapId: chapters[chapIdx].id };
  document.getElementById('edit-para-src').innerText = p.src || '';
  document.getElementById('edit-para-th').value = p.th || '';
  const exampleChk = document.getElementById('edit-para-as-example');
  exampleChk.checked = (p.kind || 'story') === 'story';
  exampleChk.disabled = (p.kind || 'story') !== 'story';
  openModal('edit-para-modal');
  setTimeout(() => document.getElementById('edit-para-th').focus(), 150);
}

async function saveEditedParagraph() {
  if (!paragraphBeingEdited) return;
  const { chapIdx, pIdx, chapId } = paragraphBeingEdited;
  const chap = chapters[chapIdx];
  if (!chap || chap.id !== chapId) return closeModal('edit-para-modal');
  const p = chap.paragraphs[pIdx];
  const newTh = document.getElementById('edit-para-th').value.trim();
  if (!newTh) return appAlert('กรุณาใส่คำแปล');
  if (newTh !== p.th) {
    // เก็บคำแปลของ AI ไว้ครั้งแรก เพื่อสลับกลับได้
    if (!p.userEdited && !p.thDraft) p.thDraft = p.th;
    p.th = newTh;
    p.userEdited = true;
    // ผู้ใช้แก้แล้ว ไม่ต้องแสดงว่าตรวจความหมายไม่ผ่านอีก
    delete p.fidelityIssue;
    await dbSaveChapter(chap);
    if (document.getElementById('edit-para-as-example').checked && (p.kind || 'story') === 'story') {
      await addStyleExample(chap.bookId, p.src, newTh);
    }
  }
  closeModal('edit-para-modal');
  paragraphBeingEdited = null;
  renderVirtualWindow(currentChapterIndex);
}

/** สลับคำแปลปัจจุบันกับฉบับสำรอง (ฉบับก่อนเกลาของ AI หรือฉบับ AI ก่อนผู้ใช้แก้) */
async function swapParagraphDraft(e, chapIdx, pIdx) {
  if (e) e.stopPropagation();
  const chap = chapters[chapIdx];
  const p = chap?.paragraphs[pIdx];
  if (!p?.thDraft) return;
  [p.th, p.thDraft] = [p.thDraft, p.th];
  // ผู้ใช้เลือกฉบับเองแล้ว ถือว่าเป็นคำแปลที่ยืนยันแล้ว จะไม่ถูกทับตอนแปลใหม่
  p.userEdited = true;
  delete p.fidelityIssue;
  await dbSaveChapter(chap);
  renderVirtualWindow(currentChapterIndex);
}

// AI จัดย่อหน้าเนื้อเรื่องเป็นข้อความผู้เขียนผิด: ให้ผู้ใช้แก้กลับได้ทันที
async function markParagraphAsStory(e, chapIdx, pIdx) {
  if (e) e.stopPropagation();
  const chap = chapters[chapIdx];
  if (!chap?.paragraphs[pIdx]) return;
  delete chap.paragraphs[pIdx].kind;
  await dbSaveChapter(chap);
  renderVirtualWindow(currentChapterIndex);
}

async function setChapterType(bookId, chapId, type) {
  if (!CHAPTER_TYPES.includes(type)) return;
  const chap = chapters.find(c => c.id === chapId) || (await dbGetChaptersByBook(bookId)).find(c => c.id === chapId);
  if (!chap) return;
  chap.chapterType = type;
  await dbSaveChapter(chap);
  if (currentBookId === bookId) renderVirtualWindow(currentChapterIndex);
  refreshShelfViewOnly(bookId);
}

function updateInfiniteStatusBanner(htmlContent = '', isVisible = true) {
  const banner = document.getElementById('infinite-status-banner');
  if (!banner) return;
  if (!isVisible || !htmlContent) {
    banner.style.display = 'none';
    banner.innerHTML = '';
  } else {
    banner.style.display = 'block';
    banner.innerHTML = htmlContent;
  }
}

function scrollToParagraph(chapIdx, paraIdx) {
  const el = document.getElementById(`para-box-${chapIdx}-${paraIdx}`);
  if (!el) return false;
  const header = document.querySelector('header');
  const offset = document.body.classList.contains('is-fullscreen') ? 10 : (header?.offsetHeight || 0) + 10;
  window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - offset, behavior: 'auto' });
  return true;
}

// targetParaIdx: กลับไปย่อหน้าที่อ่านค้างไว้ (ใช้ตอนเปิดเรื่องเดิมต่อ)
async function renderVirtualWindow(targetIdx, scrollToTop = false, targetParaIdx = null) {
  const requestVersion = ++renderRequestVersion;
  const isInfinite = localStorage.getItem('nov_enable_infinite') !== 'false';
  const container = document.getElementById('reading-content');
  container.style.fontSize = currentFontSize + 'px';

  currentChapterIndex = Math.max(0, Math.min(targetIdx, chapters.length - 1));
  const curChap = chapters[currentChapterIndex];

  document.getElementById('display-book-title').innerText = currentBookTitle;
  document.getElementById('display-chap-title').innerText = curChap.title;
  document.body.classList.toggle('no-book', currentBookId === 'default_novel');

  // ยังไม่ได้เปิดนิยาย: หน้าต้อนรับบอกขั้นตอนเริ่มต้น (แทนหนังสือคู่มือ)
  if (currentBookId === 'default_novel') {
    container.innerHTML = await buildWelcomeHtml();
    if (requestVersion !== renderRequestVersion) return;
    renderedWindowIndices = [];
    document.getElementById('manual-chap-nav').style.display = 'none';
    updateInfiniteStatusBanner('', false);
    return;
  }

  const activeTerms = await getActiveGlossaryForCurrentBook();
  if (bookmarkCache.bookId !== currentBookId) await refreshBookmarkCache(currentBookId);
  if (requestVersion !== renderRequestVersion) return;

  if (!isInfinite) {
    if (chapterIntersectionObserver) {
      chapterIntersectionObserver.disconnect();
      chapterIntersectionObserver = null;
    }
    renderedWindowIndices = [currentChapterIndex];
    container.innerHTML = buildChapterBlockHtml(curChap, currentChapterIndex, activeTerms);
    document.getElementById('manual-chap-nav').style.display = 'flex';
    updateInfiniteStatusBanner('', false);
    if (!(targetParaIdx > 0 && scrollToParagraph(currentChapterIndex, targetParaIdx)) && scrollToTop) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    saveReadingPointer(currentChapterIndex);
    return;
  }

  document.getElementById('manual-chap-nav').style.display = 'none';

  const newIndices = [];
  if (currentChapterIndex > 0) newIndices.push(currentChapterIndex - 1);
  newIndices.push(currentChapterIndex);
  if (currentChapterIndex < chapters.length - 1) newIndices.push(currentChapterIndex + 1);

  renderedWindowIndices = newIndices;

  let combinedHtml = '';
  for (const idx of renderedWindowIndices) {
    combinedHtml += buildChapterBlockHtml(chapters[idx], idx, activeTerms);
  }

  container.innerHTML = combinedHtml;
  lastWindowRenderAt = Date.now();
  setupChapterIntersectionObserver();

  if (targetParaIdx > 0 && scrollToParagraph(currentChapterIndex, targetParaIdx)) {
    // อยู่ที่ย่อหน้าที่อ่านค้างแล้ว
  } else if (scrollToTop) {
    const targetEl = document.getElementById(`chapter-block-${currentChapterIndex}`);
    if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  saveReadingPointer(currentChapterIndex);
  checkAndRefreshBottomStatus();
  checkProactivePrefetch();
}

async function appendNextChapterToWindow() {
  const isInfinite = localStorage.getItem('nov_enable_infinite') !== 'false';
  if (!isInfinite) return;

  if (isAppendingNextChapter) return;
  const nextIdx = currentChapterIndex + 1;
  if (nextIdx >= chapters.length) return;

  const nextChap = chapters[nextIdx];
  if (document.getElementById(`chapter-block-${nextIdx}`) ||
      document.querySelector(`[data-id="${nextChap.id}"]`)) {
    return;
  }

  isAppendingNextChapter = true;
  try {
    const container = document.getElementById('reading-content');
    const activeTerms = await getActiveGlossaryForCurrentBook();
    if (nextChap !== chapters[nextIdx] || document.getElementById(`chapter-block-${nextIdx}`)) return;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = buildChapterBlockHtml(nextChap, nextIdx, activeTerms);
    if (tempDiv.firstElementChild) container.appendChild(tempDiv.firstElementChild);

    if (!renderedWindowIndices.includes(nextIdx)) renderedWindowIndices.push(nextIdx);
    renderedWindowIndices.sort((a, b) => a - b);
    // อ่านยาวแล้วไม่หน่วง: เอาตอนบนสุดออก แล้วเลื่อนชดเชยให้ย่อหน้าที่อ่านอยู่ไม่กระโดด
    if (renderedWindowIndices.length > MAX_RENDERED_CHAPTERS) {
      preserveScrollAnchor(() => {
        while (renderedWindowIndices.length > MAX_RENDERED_CHAPTERS && renderedWindowIndices[0] < currentChapterIndex) {
          const removeEl = document.getElementById(`chapter-block-${renderedWindowIndices.shift()}`);
          if (removeEl) removeEl.remove();
        }
      });
    }

    setupChapterIntersectionObserver();
  } finally {
    isAppendingNextChapter = false;
    checkAndRefreshBottomStatus();
    checkProactivePrefetch();
  }
}

/** เลื่อนขึ้นไปถึงตอนบนสุดที่แสดงอยู่: ใส่ตอนก่อนหน้าไว้ด้านบน (ตำแหน่งที่อ่านไม่กระโดด) และเอาตอนล่างสุดออกถ้าเกิน */
async function prependPreviousChapterToWindow() {
  if (localStorage.getItem('nov_enable_infinite') === 'false' || isAppendingNextChapter || !renderedWindowIndices.length) return;
  const prevIdx = Math.min(...renderedWindowIndices) - 1;
  if (prevIdx < 0 || document.getElementById(`chapter-block-${prevIdx}`)) return;
  isAppendingNextChapter = true;
  try {
    const activeTerms = await getActiveGlossaryForCurrentBook();
    const prevChap = chapters[prevIdx];
    const container = document.getElementById('reading-content');
    if (!prevChap || document.getElementById(`chapter-block-${prevIdx}`)) return;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = buildChapterBlockHtml(prevChap, prevIdx, activeTerms);
    const el = tempDiv.firstElementChild;
    if (!el) return;
    preserveScrollAnchor(() => container.insertBefore(el, container.firstChild));
    renderedWindowIndices.push(prevIdx);
    renderedWindowIndices.sort((a, b) => a - b);
    while (renderedWindowIndices.length > MAX_RENDERED_CHAPTERS && renderedWindowIndices[renderedWindowIndices.length - 1] > currentChapterIndex) {
      const removeEl = document.getElementById(`chapter-block-${renderedWindowIndices.pop()}`);
      if (removeEl) removeEl.remove();
    }
    setupChapterIntersectionObserver();
  } finally {
    isAppendingNextChapter = false;
  }
}

function setupChapterIntersectionObserver() {
  const isInfinite = localStorage.getItem('nov_enable_infinite') !== 'false';
  if (!isInfinite) return;

  if (chapterIntersectionObserver) chapterIntersectionObserver.disconnect();

  const options = {
    root: null,
    rootMargin: '-20% 0px -60% 0px',
    threshold: 0
  };

  chapterIntersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const idx = parseInt(entry.target.getAttribute('data-index'), 10);
        if (!isNaN(idx) && chapters[idx]) {
          currentChapterIndex = idx;
          document.getElementById('display-chap-title').innerText = chapters[idx].title;
          saveReadingPointer(idx);
          checkAndRefreshBottomStatus();
          checkProactivePrefetch();
        }
      }
    });
  }, options);

  document.querySelectorAll('.chapter-block').forEach(block => {
    chapterIntersectionObserver.observe(block);
  });
}

function checkProactivePrefetch() {
  if (currentBookId === 'default_novel') return;
  const isPrefetchEnabled = localStorage.getItem('nov_enable_prefetch') !== 'false';
  if (!isPrefetchEnabled || isPrefetching) return;

  if (currentChapterIndex >= chapters.length - 1) {
    triggerReadingPrefetchIfEnabled(false);
  }
}

function checkAndRefreshBottomStatus() {
  const isInfinite = localStorage.getItem('nov_enable_infinite') !== 'false';
  if (!isInfinite || currentBookId === 'default_novel') {
    updateInfiniteStatusBanner('', false);
    return;
  }

  if (currentChapterIndex < chapters.length - 1) {
    updateInfiniteStatusBanner('', false);
    return;
  }

  const lastChap = chapters[chapters.length - 1];
  const targetUrl = lastChap.nextUrl;

  if (isPrefetching) {
    updateInfiniteStatusBanner(`
      <div style="font-size: 13px; font-weight: 500; color: var(--accent-text);">
        <span class="spinner-icon"></span> กำลังดึงและแปลตอนถัดไปให้อัตโนมัติ...
      </div>
      <div class="hint">
        เมื่อแปลเสร็จ เนื้อหาจะต่อท้ายสายตาของคุณทันที
      </div>
    `, true);
  } else if (targetUrl && lastPrefetchError === OTHER_TAB_BUSY_MESSAGE) {
    updateInfiniteStatusBanner(`
      <div style="font-size: 13px; font-weight: 500; color: var(--accent-text);">
        <span class="spinner-icon"></span> ${escapeHtml(OTHER_TAB_BUSY_MESSAGE)}
      </div>
      <button class="btn btn-sm" style="margin-top: 8px;" onclick="triggerManualFetchNext()">ลองแปลในแท็บนี้อีกครั้ง</button>
    `, true);
  } else if (targetUrl) {
    const errorHtml = lastPrefetchError ? `
      <div style="font-size: 11px; color: var(--danger); margin-bottom: 8px;">
        ⚠️ แปลล่วงหน้าไม่สำเร็จ: ${escapeHtml(lastPrefetchError)}
      </div>` : '';
    updateInfiniteStatusBanner(`
      <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">
        อ่านจบ "${escapeHtml(lastChap.title)}" แล้ว
      </div>
      ${errorHtml}
      <button class="btn btn-primary" style="padding: 6px 14px;" onclick="triggerManualFetchNext()">
        ${lastPrefetchError ? '🔁 ลองแปลตอนถัดไปอีกครั้ง' : '⚡ แปลตอนถัดไปทันที'}
      </button>
    `, true);
  } else {
    updateInfiniteStatusBanner(`
      <div style="font-size: 13px; font-weight: 600; color: var(--danger); margin-bottom: 6px;">
        ⚠️ ไม่พบลิงก์ของตอนถัดไป
      </div>
      <div style="font-size: 11px; opacity: 0.75; margin-bottom: 10px;">
        ตอนนี้อาจเป็นตอนล่าสุดของเว็บ (กด 🔔 เช็กตอนใหม่ ที่ชั้นหนังสือภายหลัง) หรือเลข URL กระโดดข้าม ถ้ารู้ลิงก์ตอนถัดไป วางเพื่อแปลต่อได้เลย
      </div>
      <button class="btn btn-primary btn-sm" onclick="promptFixNextUrlFromBottom()">
        🔗 วาง URL ตอนถัดไป
      </button>
    `, true);
  }
}

function triggerManualFetchNext() { triggerReadingPrefetchIfEnabled(true); }

async function promptFixNextUrlFromBottom() {
  const lastChap = chapters[chapters.length - 1];
  const input = await appPrompt(`ตอนถัดไปของ "${lastChap.title}"`, '', { title: 'วาง URL ตอนถัดไป', confirmLabel: 'แปลตอนนี้', placeholder: 'https://...' });
  if (input && input.trim()) {
    const cleanUrl = input.trim();
    lastChap.nextUrl = cleanUrl;
    dbSaveChapter(lastChap);
    nextUrlCalculated = cleanUrl;
    lastPrefetchError = '';
    triggerReadingPrefetchIfEnabled(true);
  }
}

// ย่อหน้าแรกที่ยังมองเห็นอยู่ใต้ header
function findTopVisibleParagraph() {
  const header = document.querySelector('header');
  const topLine = (document.body.classList.contains('is-fullscreen') ? 0 : (header?.offsetHeight || 0)) + 10;
  for (const el of document.querySelectorAll('#reading-content .para-item')) {
    if (el.getBoundingClientRect().bottom > topLine) {
      const m = el.id.match(/^para-box-(\d+)-(\d+)$/);
      if (m) return { chapIdx: parseInt(m[1], 10), paraIdx: parseInt(m[2], 10) };
      break;
    }
  }
  return null;
}

let readingPositionTimer = null;
let lastSavedPosition = '';
let lastScrollY = 0;
let lastWindowRenderAt = 0;

function setupScrollMonitor() {
  window.addEventListener('scroll', () => {
    // บันทึกตำแหน่งย่อหน้าหลังหยุดเลื่อน (debounce) เพื่อไม่ให้เขียนฐานข้อมูลถี่เกินไป
    clearTimeout(readingPositionTimer);
    readingPositionTimer = setTimeout(() => {
      const pos = findTopVisibleParagraph();
      if (!pos || !chapters[pos.chapIdx]) return;
      // เพลงประกอบตอนอ่านเงียบๆ: ตามย่อหน้าที่เห็นบนจอ (ถ้ากำลังฟังเสียงอ่าน เพลงตามเสียงอ่านแทน)
      if (isBgmSilentReading() && !tts.active) bgmOnParagraph(chapters[pos.chapIdx], pos.paraIdx);
      const key =`${currentBookId}:${chapters[pos.chapIdx].id}:${pos.paraIdx}`;
      if (key === lastSavedPosition) return;
      lastSavedPosition = key;
      saveReadingPointer(pos.chapIdx, pos.paraIdx);
    }, 700);

    const isInfinite = localStorage.getItem('nov_enable_infinite') !== 'false';
    const scrollingUp = window.scrollY < lastScrollY;
    lastScrollY = window.scrollY;
    if (!isInfinite) return;

    // เลื่อนขึ้นใกล้ตอนบนสุดที่แสดงอยู่: เติมตอนก่อนหน้า (เว้นช่วงหลังสร้างหน้าใหม่ ที่ยังเลื่อนไปตำแหน่งอ่านอยู่)
    if (scrollingUp && Date.now() - lastWindowRenderAt > 1500 && renderedWindowIndices.length && Math.min(...renderedWindowIndices) > 0) {
      const firstEl = document.getElementById(`chapter-block-${Math.min(...renderedWindowIndices)}`);
      if (firstEl && firstEl.getBoundingClientRect().top > -900) prependPreviousChapterToWindow();
    }

    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 1200) {
      if (currentChapterIndex < chapters.length - 1) appendNextChapterToWindow();
      else checkProactivePrefetch();
    }
  }, { passive: true });
}

async function saveReadingPointer(idx, paraIdx = null) {
  if (currentBookId === "default_novel" || !chapters[idx]) return;
  const targetChap = chapters[idx];

  const books = await dbGetAllBooks();
  const curBook = books.find(b => b.bookId === currentBookId);
  // ไม่ระบุย่อหน้า: คงตำแหน่งเดิมถ้ายังเป็นบทเดิม ไม่งั้นเริ่มที่ต้นบท
  const lastParaIndex = paraIdx !== null
    ? paraIdx
    : (curBook?.lastChapterId === targetChap.id ? (curBook.lastParaIndex || 0) : 0);

  await dbSaveBook({
    ...(curBook || {}),
    bookId: currentBookId,
    title: currentBookTitle,
    author: currentAuthor,
    genre: currentBookGenre,
    isUserCustomTitle: isUserCustomTitle,
    lastChapterId: targetChap.id,
    lastChapterIndex: idx,
    lastChapterTitle: targetChap.title,
    lastParaIndex,
    totalChapters: chapters.length,
    lastUrl: targetChap.sourceUrl || currentUrl,
    updatedAt: Date.now()
  });
  localStorage.setItem('nov_last_book_id', currentBookId);
}

async function promptEditBookTitle() {
  const newTitle = await appPrompt('ชื่อที่ตั้งเองจะถูกล็อกไว้ ระบบจะไม่เปลี่ยนตามเว็บต้นฉบับ', currentBookTitle, { title: 'แก้ชื่อเรื่อง' });
  if (newTitle !== null && newTitle.trim()) {
    currentBookTitle = newTitle.trim();
    isUserCustomTitle = true;
    document.getElementById('display-book-title').innerText = currentBookTitle;
    saveReadingPointer(currentChapterIndex);
  }
}

async function promptEditChapterTitle() {
  const chap = chapters[currentChapterIndex];
  const newTitle = await appPrompt('', chap.title, { title: 'แก้ชื่อตอน' });
  if (newTitle !== null && newTitle.trim()) {
    chap.title = newTitle.trim();
    document.getElementById('display-chap-title').innerText = chap.title;
    await dbSaveChapter(chap);
    saveReadingPointer(currentChapterIndex);
  }
}

function toggleParagraphSrc(e, uniqueKey) {
  if (e && e.target && e.target.closest('.inline-term-highlight')) return;
  const selection = window.getSelection();
  if (selection && selection.toString().trim().length > 0) return;

  const srcEl = document.getElementById(`src-${uniqueKey}`);
  if (srcEl) {
    const open = srcEl.style.display !== 'block';
    srcEl.style.display = open ? 'block' : 'none';
    document.querySelector(`.para-th[data-unique-key="${uniqueKey}"]`)?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

/** ย่อหน้าใช้คีย์บอร์ดได้ (WCAG 2.1.1): Tab ไปที่ย่อหน้า แล้ว Enter / Space เปิดต้นฉบับและปุ่มของย่อหน้า (แก้คำแปล บุ๊กมาร์ก ฟังจากตรงนี้) */
function setupParagraphKeyboard() {
  document.getElementById('reading-content')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const para = e.target.closest?.('.para-th');
    if (!para || e.target !== para) return;
    e.preventDefault();
    toggleParagraphSrc(e, para.dataset.uniqueKey);
  });
}

function setupSelectionMonitor() {
  const checkSelection = () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";

    if (text && text.length >= 1 && text.length <= 40) {
      selectedWordBuffer = text;
      // \u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E29\u0E32\u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A (\u0E08\u0E35\u0E19/\u0E0D\u0E35\u0E48\u0E1B\u0E38\u0E48\u0E19/\u0E40\u0E01\u0E32\u0E2B\u0E25\u0E35 \u0E2B\u0E23\u0E37\u0E2D\u0E20\u0E32\u0E29\u0E32\u0E25\u0E30\u0E15\u0E34\u0E19\u0E43\u0E19\u0E40\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E17\u0E35\u0E48\u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E29\u0E32\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29)
      isSelectedChinese = looksLikeSourceText(text) ||
        (['en', 'other'].includes(currentSourceLang) && /[A-Za-z]/.test(text) && !/[\u0E00-\u0E7F]/.test(text));

      const tag = document.getElementById('sel-tag-label');
      const preview = document.getElementById('sel-preview-text');
      const pairBtn = document.getElementById('reverse-pair-btn');

      tag.innerText = isSelectedChinese ? "คำต้นฉบับที่เลือก:" : "คำไทยที่เลือก:";
      preview.innerText = text;

      let paraThEl = sel.anchorNode;
      while (paraThEl && !paraThEl.classList?.contains('para-th')) {
        paraThEl = paraThEl.parentElement;
      }
      if (paraThEl) {
        selectedParagraphContext.th = decodeURIComponent(paraThEl.getAttribute('data-th') || "");
        selectedParagraphContext.src = decodeURIComponent(paraThEl.getAttribute('data-src') || "");
        selectedParagraphContext.uniqueKey = paraThEl.getAttribute('data-unique-key') || "";
      }

      pairBtn.style.display = isSelectedChinese ? 'none' : 'inline-flex';
      document.getElementById('selection-bar').style.display = 'flex';
    }
  };

  document.addEventListener('mouseup', () => setTimeout(checkSelection, 50));
  document.addEventListener('touchend', () => setTimeout(checkSelection, 100));
}

function dismissSelectionBar() {
  document.getElementById('selection-bar').style.display = 'none';
  if (window.getSelection) window.getSelection().removeAllRanges();
}

function showGlobalToast(message) {
  const toast = document.getElementById('global-action-toast');
  const label = document.getElementById('global-toast-msg');
  if (!toast || !label) return;
  label.textContent = message;
  toast.style.display = 'flex';
}

function hideGlobalToast() {
  const toast = document.getElementById('global-action-toast');
  if (toast) toast.style.display = 'none';
}

function handleImportCancel() {
  abortTask('import');
  closeModal('import-modal');
}

/** กล่องสถานะ: สีตามธีม (info / warn / error) แทนการใส่สีตรงๆ ที่อ่านไม่ออกในธีมมืด */
function setStatusTone(el, tone) {
  if (!el) return;
  el.classList.remove('status-info', 'status-warn', 'status-error');
  el.classList.add(`status-${tone}`);
  el.style.background = '';
  el.style.color = '';
}

function cancelNextChapterFetch() {
  abortTask('next');
}

async function addFromSelectionBar() {
  const selected = selectedWordBuffer.trim();
  if (!selected) return appAlert('กรุณาเลือกข้อความก่อน');
  await openGlossaryModal();
  toggleGlossaryAddForm(true);
  if (isSelectedChinese) {
    document.getElementById('gloss-src').value = selected;
    document.getElementById('gloss-tgt').focus();
  } else {
    document.getElementById('gloss-tgt').value = selected;
    document.getElementById('gloss-src').focus();
  }
}

async function retranslateCurrentActiveChapter() {
  const chap = chapters[currentChapterIndex];
  if (!chap) return appAlert('ไม่พบบทที่กำลังอ่าน');
  await retranslateSpecificChapterDirect(chap.id);
}

async function retranslateSpecificChapterDirect(chapId) {
  let chapter = chapters.find(ch => ch.id === chapId);
  if (!chapter) {
    const books = await dbGetAllBooks();
    for (const book of books) {
      const found = (await dbGetChaptersByBook(book.bookId)).find(ch => ch.id === chapId);
      if (found) { chapter = found; break; }
    }
  }
  if (!chapter || !Array.isArray(chapter.paragraphs)) return appAlert('ไม่พบบทนี้ในฐานข้อมูล');
  if (chapter.status === 'pending') return translatePendingChapterNow(chapId);
  // ตอนกันก๊อป: เนื้อหาจริงอาจถูกเปลี่ยนที่หน้าเว็บแล้ว ต้องดึงใหม่ ไม่ใช่แปลข้อความหลอกเดิม
  if (chapter.chapterType === 'placeholder' && chapter.sourceUrl) return refetchChapterFromSource(chapId);
  const rawText = chapter.paragraphs.map(p => p.src || '').filter(Boolean).join('\n\n');
  if (!rawText) return appAlert('บทนี้ไม่มีข้อความต้นฉบับ จึงแปลใหม่ไม่ได้');

  if (isTaskRunning('retranslate')) return appAlert('กำลังแปลบทอื่นใหม่อยู่ กรุณารอให้เสร็จก่อน');

  // ถามก่อนเสมอ (ใช้โควตา AI) ย่อหน้าที่ผู้ใช้แก้เองจะไม่ถูกเขียนทับ ถ้าผู้ใช้ไม่เลือกให้ทับ
  const editedCount = chapter.paragraphs.filter(p => p.userEdited).length;
  const costNote = 'ใช้โควตา AI ประมาณเท่าแปล 1 ตอน คำแปลเดิมเก็บไว้ในประวัติ (🕘) กู้คืนได้';
  let keepEdits = false;
  if (editedCount > 0) {
    const choice = await appChoose(`ตอนนี้มี ${editedCount} ย่อหน้าที่คุณแก้คำแปลเอง\n${costNote}`, [
      { label: 'แปลใหม่ทั้งหมด (ทับที่แก้)', value: 'all' },
      { label: 'เก็บที่แก้ไว้ แปลที่เหลือ', value: 'keep', variant: 'primary' }
    ], { title: `แปล "${chapter.title}" ใหม่` });
    if (!choice) return;
    keepEdits = choice === 'keep';
  } else if (!(await appConfirm(costNote, { title: `แปล "${chapter.title}" ใหม่`, confirmLabel: 'แปลใหม่' }))) {
    return;
  }

  const books = await dbGetAllBooks();
  const bookId = chapter.bookId || currentBookId;
  const ctx = makeBookContext(books.find(item => item.bookId === bookId) || getCurrentBookContext());
  const controller = beginTask('retranslate');
  showGlobalToast(`กำลังแปล "${chapter.title}" ใหม่...`);
  try {
    // ใช้ summary ของตอนเนื้อเรื่องก่อนหน้าเป็นบริบท (ไม่ใช่ของบทตัวเอง และข้ามประกาศผู้เขียน)
    const bookChaps = await dbGetChaptersByBook(bookId);
    const result = await translateChapter(rawText, ctx, {
      signal: controller.signal,
      onStatus: showGlobalToast,
      rawChapTitle: chapter.title,
      prevChapter: findPrevStoryChapter(bookChaps, chapter.order ?? 0)
    });
    if (keepEdits) result.paragraphs = mergeUserEdits(chapter.paragraphs, result.paragraphs);
    // แปลใหม่จากข้อความตัวอย่างเดิม: ยังเป็นแค่ตัวอย่าง คงป้ายและข้อมูลการล็อกไว้
    const keptLock = chapter.previewOnly ? chapter.lockInfo : null;
    if (chapter.previewOnly) { result.previewOnly = true; result.summary = ''; }
    await applyTranslationToChapter(chapter, result, { updateTitle: false });
    if (keptLock) { chapter.lockInfo = keptLock; await dbSaveChapter(chapter); }
    appAlert(`แปล "${chapter.title}" ใหม่และบันทึกแล้ว${keepEdits ? ` (เก็บย่อหน้าที่แก้เองไว้ ${editedCount} ย่อหน้า)` : ''}`);
  } catch (err) {
    if (!isAbortError(err)) appAlert(`แปลบทใหม่ไม่สำเร็จ: ${err.message}`);
  } finally {
    endTask('retranslate', controller);
    hideGlobalToast();
  }
}

/**
 * ใส่ย่อหน้าที่ผู้ใช้แก้เองกลับเข้าไปในผลแปลใหม่ จับคู่ด้วยข้อความต้นฉบับ (ไม่ใช่ตำแหน่ง)
 * เพื่อให้ถูกต้องแม้จำนวนย่อหน้าจะเปลี่ยน
 */
function mergeUserEdits(oldParas, newParas) {
  const edited = oldParas.filter(p => p.userEdited && p.src);
  if (!edited.length) return newParas;
  const used = new Set();
  const result = newParas.slice();
  for (const old of edited) {
    const idx = result.findIndex((p, i) => !used.has(i) && p.src === old.src);
    if (idx === -1) continue;
    used.add(idx);
    result[idx] = { ...result[idx], th: old.th, userEdited: true, thDraft: result[idx].th };
  }
  return result;
}

// บันทึกผลแปลทับตอนเดิม (คง id/ลำดับ/URL ไว้) แล้วอัปเดตหน้าจอที่เกี่ยวข้อง
// reason: เหตุที่คำแปลเดิมถูกแทน (เก็บไว้ในประวัติเวอร์ชัน) ดู VERSION_REASON_LABELS ใน quality.js
async function applyTranslationToChapter(chapter, result, { updateTitle = false, nextUrl = undefined, reason = 'retranslate' } = {}) {
  // เก็บคำแปลเดิมไว้ก่อนแทน (เทียบ/กู้คืนได้) เก็บไม่สำเร็จก็ยังแปลต่อได้
  try {
    if (await saveChapterVersion(chapter, reason)) chapter.hasVersions = true;
  } catch (err) {
    console.warn('Save chapter version failed:', err);
  }
  chapter.paragraphs = result.paragraphs;
  chapter.summary = result.summary || '';
  chapter.chapterType = result.chapterType || 'story';
  if (result.placeholderReason) chapter.placeholderReason = result.placeholderReason;
  else delete chapter.placeholderReason;
  if (result.lockInfo) chapter.lockInfo = result.lockInfo;
  else delete chapter.lockInfo;
  delete chapter.pendingLockInfo;
  delete chapter.blockInfo;
  // บันทึกเหตุการณ์: ได้ใหม่ใช้ใหม่ / ตอนที่ไม่มีเนื้อเรื่องแล้วลบ / ไม่ได้ใหม่ (ทำพลาด) คงของเดิม ระบบรู้เองว่าเก่าจากต้นฉบับที่เปลี่ยน
  if (result.storyLog) chapter.storyLog = result.storyLog;
  else if (chapter.chapterType === 'placeholder') delete chapter.storyLog;
  if (result.previewOnly) chapter.previewOnly = true;
  else delete chapter.previewOnly;
  delete chapter.status;
  chapter.translationMeta = result.translationMeta;
  if (updateTitle && result.chapterTitle) chapter.title = result.chapterTitle;
  if (nextUrl) chapter.nextUrl = nextUrl;
  await dbSaveChapter(chapter);

  const activeCopy = chapters.find(item => item.id === chapter.id);
  if (activeCopy && activeCopy !== chapter) Object.assign(activeCopy, chapter);
  if (currentBookId === chapter.bookId) {
    if (nextUrl && chapters[chapters.length - 1]?.id === chapter.id) nextUrlCalculated = nextUrl;
    await renderVirtualWindow(currentChapterIndex);
  }
  await refreshShelfViewOnly(chapter.bookId);
}

// ==================== PENDING CHAPTERS (ตอนที่รอแปล) ====================
/**
 * แปลตอนที่รอแปล: มาจากการวางข้อความ/ไฟล์ (มีต้นฉบับแล้ว) หรือจากสารบัญ (มีแค่ URL ต้องดึงก่อน)
 * ใช้ร่วมกันทั้งปุ่ม "แปลตอนนี้" และการแปลล่วงหน้าหลายตอน
 */
async function translatePendingChapterCore(chapter, ctx, { signal = null, onStatus = null } = {}) {
  return withLock(lockNames.chapter(chapter.id), async () => {
    // อีกแท็บอาจแปลตอนนี้เสร็จไปแล้ว: ใช้ผลนั้นแทนการแปลซ้ำ
    const fresh = (await dbGetChaptersByBook(chapter.bookId)).find(c => c.id === chapter.id);
    if (fresh && !isPendingChapter(fresh)) {
      replaceChapterContents(chapter, fresh);
      const activeCopy = chapters.find(item => item.id === chapter.id);
      if (activeCopy && activeCopy !== chapter) replaceChapterContents(activeCopy, { ...fresh });
      if (currentBookId === chapter.bookId) await renderVirtualWindow(currentChapterIndex);
      return null;
    }
    return translatePendingChapterUnlocked(chapter, ctx, { signal, onStatus });
  }, { ifAvailable: true, busyMessage: 'อีกแท็บกำลังแปลตอนนี้อยู่ เมื่อเสร็จแล้วผลแปลจะแสดงที่นี่เอง' });
}

async function translatePendingChapterUnlocked(chapter, ctx, { signal = null, onStatus = null } = {}) {
  let rawText = chapter.paragraphs.map(p => p.src || '').filter(Boolean).join('\n\n');
  let rawChapTitle = chapter.title;
  let nextUrl;
  // ต้นฉบับที่เก็บไว้ตอนเช็กตอนใหม่ อาจเป็นแค่ตัวอย่างของตอนที่ต้องซื้อ
  let lockInfo = chapter.pendingLockInfo || null;
  if (!rawText && chapter.sourceUrl) {
    if (onStatus) onStatus(`กำลังดึงเนื้อหา "${chapter.title}"...`);
    const scraped = await scrapePage(chapter.sourceUrl, signal, { bookId: chapter.bookId });
    rawText = scraped.text;
    rawChapTitle = scraped.rawChapTitle || rawChapTitle;
    if (scraped.nextUrlSource !== 'guess') nextUrl = scraped.nextUrl;
    if (scraped.author) ctx.author = scraped.author;
    lockInfo = scraped.lockInfo || null;
  }
  if (!rawText) throw new Error('ตอนนี้ไม่มีเนื้อหาต้นฉบับ');
  const bookChaps = await dbGetChaptersByBook(chapter.bookId);
  const result = await translateChapter(rawText, ctx, {
    signal, onStatus, rawChapTitle, lockInfo,
    prevChapter: findPrevStoryChapter(bookChaps, chapter.order ?? 0)
  });
  await applyTranslationToChapter(chapter, result, { updateTitle: true, nextUrl, reason: 'translate' });
  return result;
}

async function findChapterAnywhere(chapId) {
  let chapter = chapters.find(ch => ch.id === chapId);
  if (chapter) return chapter;
  for (const book of await dbGetAllBooks()) {
    chapter = (await dbGetChaptersByBook(book.bookId)).find(ch => ch.id === chapId);
    if (chapter) return chapter;
  }
  return null;
}

async function translatePendingChapterNow(chapId) {
  const chapter = await findChapterAnywhere(chapId);
  if (!chapter) return appAlert('ไม่พบตอนนี้');
  if (isTaskRunning('retranslate')) return appAlert('กำลังแปลบทอื่นอยู่ กรุณารอให้เสร็จก่อน');
  const books = await dbGetAllBooks();
  const ctx = makeBookContext(books.find(b => b.bookId === chapter.bookId) || getCurrentBookContext());
  const controller = beginTask('retranslate');
  showGlobalToast(`กำลังแปล "${chapter.title}"...`);
  try {
    await translatePendingChapterCore(chapter, ctx, { signal: controller.signal, onStatus: showGlobalToast });
  } catch (err) {
    if (err?.kind === 'blocked') await markChapterBlockedAndRefresh(chapter, err);
    if (err instanceof LockBusyError) appAlert(err.message);
    else if (!isAbortError(err)) appAlert(`แปลไม่สำเร็จ: ${describeScrapeError(err)}`, err?.kind === 'blocked' ? { title: 'ถูกบล็อกโดยผู้ให้บริการ AI' } : undefined);
  } finally {
    endTask('retranslate', controller);
    hideGlobalToast();
  }
}

async function markChapterBlockedAndRefresh(chapter, err) {
  try {
    await markPendingChapterBlocked(chapter, err);
    chapter.blockInfo = chapterBlockInfo(err);
    refreshShelfViewOnly(chapter.bookId);
    if (currentBookId === chapter.bookId) await renderVirtualWindow(currentChapterIndex);
  } catch (e) {
    console.warn('Mark blocked failed:', e);
  }
}

/** ผู้ให้บริการอื่นที่ตั้งคีย์และโมเดลไว้แล้ว (ใช้แปลตอนที่ผู้ให้บริการหลักบล็อก) */
function listAlternateProviders(exclude) {
  return Object.keys(LLM_PROVIDERS).filter(p => {
    if (p === exclude) return false;
    try {
      const cfg = getActiveLlmConfig('main', p);
      return cfg.keys.length > 0 && !!cfg.mainModel;
    } catch (e) {
      return false;
    }
  });
}

/** แปลตอนที่ถูกบล็อกด้วยผู้ให้บริการอื่นเฉพาะครั้งนี้ ไม่เปลี่ยนการตั้งค่าหลัก */
async function translateChapterWithOtherProvider(chapId) {
  const chapter = await findChapterAnywhere(chapId);
  if (!chapter) return appAlert('ไม่พบตอนนี้');
  if (isTaskRunning('retranslate')) return appAlert('กำลังแปลบทอื่นอยู่ กรุณารอให้เสร็จก่อน');
  const blockedBy = chapter.blockInfo?.provider || getActiveProvider();
  const options = listAlternateProviders(blockedBy);
  if (!options.length) {
    return appAlert(`ยังไม่มีผู้ให้บริการอื่นที่ตั้งค่าไว้\nใส่ API Key ของผู้ให้บริการอื่น (เช่น OpenRouter หรือ Claude) ใน ตั้งค่า → 🤖 AI แล้วกลับมากดปุ่มนี้อีกครั้ง`, { title: 'แปลด้วยผู้ให้บริการอื่น' });
  }
  const provider = options.length === 1 ? options[0] : await appChoose('เลือกผู้ให้บริการที่จะใช้แปลตอนนี้ (เฉพาะครั้งนี้ ไม่เปลี่ยนการตั้งค่าหลัก)',
    options.map((p, k) => ({ label: `${LLM_PROVIDERS[p].label} · ${getActiveLlmConfig('main', p).mainModel}`, value: p, variant: k === 0 ? 'primary' : undefined })),
    { title: 'แปลด้วยผู้ให้บริการอื่น' });
  if (!provider) return;
  const model = getActiveLlmConfig('main', provider).mainModel;
  const books = await dbGetAllBooks();
  const ctx = makeBookContext(books.find(b => b.bookId === chapter.bookId) || getCurrentBookContext());
  const controller = beginTask('retranslate');
  setModelOverride(controller.signal, { provider, model });
  showGlobalToast(`กำลังแปล "${chapter.title}" ด้วย ${LLM_PROVIDERS[provider].label}...`);
  try {
    await translatePendingChapterCore(chapter, ctx, { signal: controller.signal, onStatus: showGlobalToast });
    refreshShelfViewOnly(chapter.bookId);
  } catch (err) {
    if (err?.kind === 'blocked') await markChapterBlockedAndRefresh(chapter, err);
    if (err instanceof LockBusyError) appAlert(err.message);
    else if (!isAbortError(err)) appAlert(`แปลไม่สำเร็จ: ${describeScrapeError(err)}`, err?.kind === 'blocked' ? { title: 'ถูกบล็อกโดยผู้ให้บริการ AI' } : undefined);
  } finally {
    endTask('retranslate', controller);
    hideGlobalToast();
  }
}

function buildPendingNoticeHtml(chap) {
  const srcCount = chap.paragraphs.filter(p => p.src).length;
  const preview = chap.paragraphs.slice(0, 30).map(p => `<p>${escapeHtml(p.src || '')}</p>`).join('');
  if (chap.blockInfo) {
    return `
    <div class="placeholder-notice">
      <div style="font-weight: 600; margin-bottom: 4px;">🚫 ผู้ให้บริการ AI ไม่ยอมแปลตอนนี้</div>
      <div style="font-size: 12px; opacity: 0.85; margin-bottom: 10px; white-space: pre-line;">${escapeHtml(describeProviderBlock(chap.blockInfo.provider, chap.blockInfo.code))}</div>
      <button class="btn btn-primary" style="padding: 5px 12px; font-size: 12px;" onclick="translateChapterWithOtherProvider(${jsArg(chap.id)})">🔀 แปลด้วยผู้ให้บริการอื่น</button>
      <button class="btn" style="padding: 5px 12px; font-size: 12px;" onclick="translatePendingChapterNow(${jsArg(chap.id)})">🔄 ลองอีกครั้ง</button>
      ${srcCount ? `<details style="margin-top: 10px; font-size: 12px;"><summary style="cursor: pointer; opacity: 0.7;">ดูต้นฉบับ</summary><div class="para-src" style="display: block;">${preview}</div></details>` : ''}
    </div>`;
  }
  return `
    <div class="placeholder-notice">
      <div style="font-weight: 600; margin-bottom: 4px;">⏳ ตอนนี้ยังไม่ได้แปล</div>
      <div style="font-size: 12px; opacity: 0.8; margin-bottom: 10px;">${srcCount ? `มีต้นฉบับ ${srcCount} ย่อหน้ารอแปล` : 'จะดึงเนื้อหาจากหน้าเว็บตอนเริ่มแปล'} — แปลทีละหลายตอนได้ที่ชั้นหนังสือ (⚡ เริ่มแปลล่วงหน้า)</div>
      <button class="btn btn-primary" style="padding: 5px 12px; font-size: 12px;" onclick="translatePendingChapterNow(${jsArg(chap.id)})">⚡ แปลตอนนี้เลย</button>
      ${srcCount ? `<details style="margin-top: 10px; font-size: 12px;"><summary style="cursor: pointer; opacity: 0.7;">ดูต้นฉบับ</summary><div class="para-src" style="display: block;">${preview}</div></details>` : ''}
    </div>`;
}

/** ดึงเนื้อหาจากหน้าเว็บต้นฉบับใหม่แล้วแปล (ใช้กับตอนกันก๊อปที่ผู้เขียนเปลี่ยนเป็นเนื้อหาจริงแล้ว) */
async function refetchChapterFromSource(chapId) {
  let chapter = chapters.find(ch => ch.id === chapId);
  if (!chapter) {
    for (const book of await dbGetAllBooks()) {
      chapter = (await dbGetChaptersByBook(book.bookId)).find(ch => ch.id === chapId);
      if (chapter) break;
    }
  }
  if (!chapter?.sourceUrl) return appAlert('ตอนนี้ไม่มี URL ต้นฉบับ จึงดึงเนื้อหาใหม่ไม่ได้');
  if (isTaskRunning('retranslate')) return appAlert('กำลังแปลบทอื่นใหม่อยู่ กรุณารอให้เสร็จก่อน');

  const books = await dbGetAllBooks();
  const ctx = makeBookContext(books.find(b => b.bookId === chapter.bookId) || getCurrentBookContext());
  const controller = beginTask('retranslate');
  showGlobalToast('กำลังดึงเนื้อหาจากหน้าเว็บต้นฉบับใหม่...');
  try {
    const scraped = await scrapePage(chapter.sourceUrl, controller.signal, { bookId: chapter.bookId });
    if (scraped.lockInfo) {
      appAlert(`หน้าเว็บยังให้อ่านได้แค่ตัวอย่าง (${describeLockInfo(scraped.lockInfo).short})`);
      return;
    }
    if (classifyChapterByRules(scraped.rawChapTitle, scraped.text).type === 'placeholder') {
      appAlert('หน้าเว็บยังเป็นเนื้อหากันก๊อปอยู่ ผู้เขียนอาจยังไม่ได้อัปเดตเนื้อหาจริง ลองใหม่ภายหลังนะครับ');
      return;
    }
    const bookChaps = await dbGetChaptersByBook(chapter.bookId);
    const result = await translateChapter(scraped.text, ctx, {
      signal: controller.signal,
      onStatus: showGlobalToast,
      rawChapTitle: scraped.rawChapTitle,
      rawBookTitle: scraped.rawBookTitle,
      prevChapter: findPrevStoryChapter(bookChaps, chapter.order ?? 0)
    });
    await applyTranslationToChapter(chapter, result, { updateTitle: true, nextUrl: scraped.nextUrlSource === 'link' ? scraped.nextUrl : undefined, reason: 'refetch' });
    appAlert(`ดึงและแปล "${chapter.title}" เรียบร้อยแล้ว`);
  } catch (err) {
    if (!isAbortError(err)) appAlert(`ดึงเนื้อหาใหม่ไม่สำเร็จ: ${describeScrapeError(err)}`);
  } finally {
    endTask('retranslate', controller);
    hideGlobalToast();
  }
}

async function findChineseForSelection() {
  const { th, src } = selectedParagraphContext;
  if (!selectedWordBuffer || !th || !src) return appAlert('ไม่พบย่อหน้าต้นฉบับที่สัมพันธ์กับข้อความที่เลือก');
  if (!hasActiveApiKey()) return appAlert("กรุณาใส่ API Key ในเมนู 'ตั้งค่า' ก่อนใช้งาน");
  const button = document.getElementById('reverse-pair-btn');
  const oldLabel = button.innerText;
  button.disabled = true;
  button.innerText = 'กำลังค้นหา...';
  try {
    // คำแปลที่ถูกเกลาสำนวนอาจย้ายความหมายไปใกล้ย่อหน้าข้างเคียง จึงส่งต้นฉบับย่อหน้าก่อน/หลังไปด้วย
    const [chapIdx, pIdx] = (selectedParagraphContext.uniqueKey || '').split('-').map(Number);
    const neighbours = [pIdx - 1, pIdx + 1]
      .map(i => ({ i, src: chapters[chapIdx]?.paragraphs[i]?.src || '' }))
      .filter(n => n.src && (chapters[chapIdx].paragraphs[n.i].kind || 'story') !== 'site_junk');
    const prompt = `จับคู่คำแปลไทยที่ผู้ใช้อ่านเลือกกับข้อความในต้นฉบับภาษา${getLangName(currentSourceLang)} โดยคืนเฉพาะคำหรือวลีต้นฉบับที่ตรงกันและปรากฏต่อเนื่องในต้นฉบับ ห้ามเดาคำที่ไม่มีอยู่
ค้นในต้นฉบับย่อหน้าหลักก่อน ถ้าไม่พบจึงค้นในย่อหน้าข้างเคียง
ข้อความที่เลือก: ${JSON.stringify(selectedWordBuffer)}
ย่อหน้าไทย: ${JSON.stringify(th)}
ต้นฉบับย่อหน้าหลัก: ${JSON.stringify(src)}
${neighbours.length ? `ต้นฉบับย่อหน้าข้างเคียง: ${JSON.stringify(neighbours.map(n => n.src))}` : ''}
ตอบ JSON เท่านั้น: {"src":"วลีต้นฉบับที่พบ"}`;
    const answer = await callLLMJson(prompt, { maxRetries: 3, schema: SCHEMAS.findSource, role: 'aux' });
    const candidate = (typeof answer?.src === 'string' ? answer.src : '').trim();
    const foundIn = candidate && src.includes(candidate)
      ? pIdx
      : neighbours.find(n => candidate && n.src.includes(candidate))?.i;
    if (foundIn === undefined) throw new Error('ไม่พบวลีที่ตรงกับต้นฉบับ');

    const srcEl = document.getElementById(`src-${chapIdx}-${foundIn}`);
    if (srcEl) {
      srcEl.style.display = 'block';
      srcEl.querySelectorAll('mark.selection-term-mark').forEach(mark => mark.replaceWith(document.createTextNode(mark.textContent)));
      const walker = document.createTreeWalker(srcEl, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const at = node.nodeValue.indexOf(candidate);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + candidate.length);
        const mark = document.createElement('mark');
        mark.className = 'selection-term-mark';
        range.surroundContents(mark);
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
    await openGlossaryModal();
    toggleGlossaryAddForm(true);
    document.getElementById('gloss-src').value = candidate;
    document.getElementById('gloss-tgt').value = selectedWordBuffer;
    document.getElementById('gloss-cat').focus();
  } catch (err) {
    appAlert(`ค้นหาคำต้นฉบับไม่สำเร็จ: ${err.message}`);
  } finally {
    button.disabled = false;
    button.innerText = oldLabel;
  }
}

function abortAllRunningProcesses() {
  abortAllTasks();
  isPrefetching = false;
  document.getElementById('prefetch-badge').style.display = 'none';
  checkAndRefreshBottomStatus();
}

// งานที่ผูกกับเรื่องที่กำลังเปิดอ่าน (ไม่รวม batch ซึ่งแยก context ของตัวเองได้แล้ว)
function abortReaderTasks() {
  abortTask('prefetch');
  abortTask('next');
  isPrefetching = false;
  document.getElementById('prefetch-badge').style.display = 'none';
}

async function deleteSelectedChapters(bookId) {
  const chks = Array.from(document.querySelectorAll('.chap-chk:checked')).filter(c => c.dataset.bookId === bookId);
  const count = chks.length;
  if (count === 0) return;

  if (!(await appConfirm(`ตอนที่เลือก ${count} ตอนจะถูกลบออกจากเครื่องนี้ ย้อนกลับไม่ได้ (ยกเว้นมีไฟล์สำรอง)`, { title: 'ลบตอน', confirmLabel: `ลบ ${count} ตอน`, danger: true }))) return;

  abortAllRunningProcesses();

  const idsToDelete = Array.from(chks).map(c => c.value);
  await dbDeleteMultipleChapters(idsToDelete);
  await repairBookPointer(bookId);

  if (currentBookId === bookId) await loadBookFromDB(bookId);
  else refreshShelfViewOnly(bookId);
}

// หลังลบ/ย้ายตอน: ตรวจให้ตำแหน่งอ่านและจำนวนตอนของเรื่องยังชี้ไปที่ตอนที่มีอยู่จริง
async function repairBookPointer(bookId) {
  const remainingChaps = (await dbGetChaptersByBook(bookId)).sort((x, y) => x.order - y.order);
  const targetBook = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  if (!targetBook) return;

  if (remainingChaps.length > 0) {
    const stillThere = remainingChaps.some(c => c.id === targetBook.lastChapterId);
    const safeActiveChap = remainingChaps.find(c => c.id === targetBook.lastChapterId) || remainingChaps[0];
    const latestChap = remainingChaps[remainingChaps.length - 1];
    await dbSaveBook({
      ...targetBook,
      totalChapters: remainingChaps.length,
      lastChapterId: safeActiveChap.id,
      lastChapterTitle: safeActiveChap.title,
      lastChapterIndex: remainingChaps.indexOf(safeActiveChap),
      lastParaIndex: stillThere ? (targetBook.lastParaIndex || 0) : 0,
      lastUrl: latestChap.sourceUrl
    });
  } else {
    await dbSaveBook({
      ...targetBook,
      totalChapters: 0,
      lastChapterId: '',
      lastChapterTitle: "ไม่มีตอน",
      lastChapterIndex: 0,
      lastParaIndex: 0,
      lastUrl: ''
    });
  }
}

// ==================== MOVE CHAPTERS (แยกนิยายที่ถูกรวมผิดเรื่อง) ====================
let moveChaptersFromBookId = null;

async function openMoveChaptersModal(bookId) {
  const ids = Array.from(document.querySelectorAll('.chap-chk:checked')).filter(c => c.dataset.bookId === bookId).map(c => c.value);
  if (ids.length === 0) return;
  moveChaptersFromBookId = bookId;
  const books = await dbGetAllBooks();
  const fromBook = books.find(b => b.bookId === bookId);
  const chaps = await dbGetChaptersByBook(bookId);
  const firstMoved = chaps.filter(c => ids.includes(c.id)).sort((a, b) => a.order - b.order)[0];

  document.getElementById('move-chapters-count').innerText = `${ids.length} ตอน จาก "${fromBook?.title || bookId}"`;
  const select = document.getElementById('move-chapters-target');
  select.innerHTML = `<option value="new">➕ สร้างเป็นเรื่องใหม่</option>` +
    books.filter(b => b.bookId !== bookId).map(b => `<option value="${escapeHtml(b.bookId)}">📚 ${escapeHtml(b.title || b.bookId)}</option>`).join('');
  document.getElementById('move-chapters-new-title').value = firstMoved ? `${fromBook?.title || 'นิยาย'} (แยกจาก ${firstMoved.title})` : '';
  onMoveTargetChange();
  openModal('move-chapters-modal');
}

function onMoveTargetChange() {
  const isNew = document.getElementById('move-chapters-target').value === 'new';
  document.getElementById('move-chapters-new-group').style.display = isNew ? 'block' : 'none';
}

async function confirmMoveChapters() {
  const fromBookId = moveChaptersFromBookId;
  if (!fromBookId) return;
  const ids = Array.from(document.querySelectorAll('.chap-chk:checked')).filter(c => c.dataset.bookId === fromBookId).map(c => c.value);
  if (ids.length === 0) return closeModal('move-chapters-modal');

  const books = await dbGetAllBooks();
  const fromBook = books.find(b => b.bookId === fromBookId);
  const choice = document.getElementById('move-chapters-target').value;
  let toBook;
  if (choice === 'new') {
    const title = document.getElementById('move-chapters-new-title').value.trim();
    if (!title) return appAlert('กรุณาตั้งชื่อเรื่องใหม่');
    const firstMoved = (await dbGetChaptersByBook(fromBookId)).filter(c => ids.includes(c.id)).sort((a, b) => a.order - b.order)[0];
    const key = firstMoved?.sourceUrl ? deriveBookKey(firstMoved.sourceUrl) : { reliable: false };
    toBook = {
      bookId: 'book_' + hashString(`${title}|${Date.now()}`),
      title,
      isUserCustomTitle: true,
      author: '',
      genre: fromBook?.genre || 'xianxia',
      sourceLang: getBookSourceLang(fromBook),
      sourceKey: key.reliable ? key.key : undefined,
      lastChapterIndex: 0,
      lastParaIndex: 0
    };
  } else {
    toBook = books.find(b => b.bookId === choice);
    if (!toBook) return appAlert('ไม่พบเรื่องปลายทาง');
  }

  try {
    abortAllRunningProcesses();
    await dbMoveChapters(ids, fromBookId, toBook);
    await repairBookPointer(fromBookId);
    await repairBookPointer(toBook.bookId);
    closeModal('move-chapters-modal');
    if (currentBookId === fromBookId || currentBookId === toBook.bookId) await loadBookFromDB(currentBookId);
    await refreshHome();
    appAlert(`ย้าย ${ids.length} ตอนไปที่ "${toBook.title}" เรียบร้อยแล้ว`);
  } catch (err) {
    appAlert(`ย้ายตอนไม่สำเร็จ: ${err.message}`);
  }
}

// paraIdx: เปิดแล้วไปที่ย่อหน้านั้นเลย (ใช้กับผลค้นหา/บุ๊กมาร์ก)
async function loadBookFromDB(bookId, specifyChapIdOrIdx = null, { paraIdx = null } = {}) {
  if (currentBookId !== bookId) {
    abortReaderTasks();
    if (tts.active) stopTts();
  }
  const books = await dbGetAllBooks();
  const targetBook = books.find(b => b.bookId === bookId);
  if (!targetBook) {
    resetToGuideBook();
    return;
  }

  currentBookId = bookId;
  currentBookTitle = targetBook.title || 'นิยายเรื่องใหม่';
  currentAuthor = targetBook.author || '';
  currentBookGenre = targetBook.genre || 'xianxia';
  currentSourceLang = getBookSourceLang(targetBook);
  isUserCustomTitle = targetBook.isUserCustomTitle || false;
  lastPrefetchError = '';

  const loadedChaps = await dbGetChaptersByBook(bookId);
  if (loadedChaps.length > 0) {
    loadedChaps.sort((a, b) => a.order - b.order);
    chapters = loadedChaps;

    if (typeof specifyChapIdOrIdx === 'string') {
      const foundIdx = chapters.findIndex(c => c.id === specifyChapIdOrIdx);
      currentChapterIndex = (foundIdx !== -1) ? foundIdx : 0;
    } else if (typeof specifyChapIdOrIdx === 'number') {
      currentChapterIndex = Math.min(specifyChapIdOrIdx, chapters.length - 1);
    } else if (targetBook.lastChapterId) {
      const foundIdx = chapters.findIndex(c => c.id === targetBook.lastChapterId);
      currentChapterIndex = (foundIdx !== -1) ? foundIdx : Math.min(targetBook.lastChapterIndex || 0, chapters.length - 1);
    } else {
      currentChapterIndex = Math.min(targetBook.lastChapterIndex || 0, chapters.length - 1);
    }

    const currentActiveChap = chapters[currentChapterIndex];
    const latestChap = chapters[chapters.length - 1];

    currentUrl = currentActiveChap.sourceUrl || targetBook.lastUrl || "";
    nextUrlCalculated = latestChap.nextUrl;

    // เปิดเรื่องเดิมต่อโดยไม่ระบุบท: กลับไปย่อหน้าที่อ่านค้างไว้
    const resumePara = paraIdx !== null ? paraIdx : ((specifyChapIdOrIdx === null && currentActiveChap.id === targetBook.lastChapterId)
      ? (targetBook.lastParaIndex || 0) : null);
    lastSavedPosition = '';
    await refreshBookmarkCache(bookId);
    await renderVirtualWindow(currentChapterIndex, true, resumePara);
    refreshShelfViewOnly(bookId);
  } else {
    chapters = [{
      id: "empty_chap",
      title: "ไม่มีตอนในเครื่อง",
      paragraphs: [{ th: "นิยายเรื่องนี้ยังไม่มีตอนที่บันทึกไว้ หรือถูกลบออกไปทั้งหมดแล้ว", src: "暂无内容" }],
      summary: ""
    }];
    currentChapterIndex = 0;
    currentUrl = '';
    nextUrlCalculated = null;
    renderVirtualWindow(0, true);
    refreshShelfViewOnly(bookId);
  }
}

async function removeBookFromShelf(e, bookId) {
  e.stopPropagation();
  if (!(await appConfirm('นิยายเรื่องนี้และทุกตอนที่เก็บไว้จะถูกลบออกจากเครื่องนี้ ย้อนกลับไม่ได้ (ยกเว้นมีไฟล์สำรอง)', { title: 'ลบทั้งเรื่อง', confirmLabel: 'ลบทั้งเรื่อง', danger: true }))) return;
  abortAllRunningProcesses();
  await dbDeleteBook(bookId);
  if (currentBookId === bookId) {
    const remainingBooks = await dbGetAllBooks();
    if (remainingBooks.length) await loadBookFromDB(remainingBooks[0].bookId);
    else resetToGuideBook();
  }
  homeCoverCache.delete(bookId);
  await refreshHome();
}

async function triggerReadingPrefetchIfEnabled(isManualClick = false) {
  const isPrefetchEnabled = localStorage.getItem('nov_enable_prefetch') !== 'false';
  if (!isPrefetchEnabled && !isManualClick) return;

  const lastChap = chapters[chapters.length - 1];
  const targetUrl = lastChap ? lastChap.nextUrl : null;

  if (!targetUrl) {
    checkAndRefreshBottomStatus();
    return;
  }

  if (isPrefetching || isTaskRunning('next')) return;
  // หลังล้มเหลว ไม่ยิงซ้ำอัตโนมัติทุกครั้งที่เลื่อนจอ จนกว่าผู้ใช้จะกดเอง
  if (lastPrefetchError && !isManualClick) return;

  isPrefetching = true;
  lastPrefetchError = '';
  const controller = beginTask('prefetch');
  const signal = controller.signal;
  // ผู้ใช้กดปุ่มเอง: ถ้าเกินเพดานให้ถามก่อน ไม่หยุดเงียบๆ แบบงานเบื้องหลัง
  if (isManualClick) tagTask(signal, { manual: true });
  const ctx = getCurrentBookContext();
  const requestBookId = ctx.bookId;
  checkAndRefreshBottomStatus();
  let releaseAppend = null;

  try {
    // ถ้าอีกแท็บกำลังเพิ่มตอนถัดไปของเรื่องนี้อยู่ ไม่แปลซ้ำ (ตอนนั้นจะถูกส่งมาต่อท้ายเองเมื่อเสร็จ)
    releaseAppend = await acquireLock(lockNames.append(requestBookId), { ifAvailable: true });
    if (!releaseAppend) {
      if (currentBookId === requestBookId) lastPrefetchError = OTHER_TAB_BUSY_MESSAGE;
      return;
    }
    const bookChaps = await dbGetChaptersByBook(requestBookId);
    if (bookChaps.some(c => sameSourceUrl(c.sourceUrl, targetUrl))) {
      document.getElementById('prefetch-badge').style.display = 'inline-block';
      return;
    }

    updateInfiniteStatusBanner(`
      <div style="font-size: 13px; font-weight: 500; color: var(--accent-text);">
        <span class="spinner-icon"></span> กำลังดึงเนื้อหาตอนถัดไปจากเว็บต้นฉบับ...
      </div>
    `, true);

    const { text, nextUrl, rawChapTitle, rawBookTitle, author, lockInfo } = await scrapePage(targetUrl, signal, { bookId: requestBookId });
    const dup = findDuplicateSourceChapter(bookChaps, text);
    if (dup) throw duplicateChapterError(dup);
    if (author) {
      ctx.author = author;
      if (currentBookId === requestBookId) currentAuthor = author;
    }

    updateInfiniteStatusBanner(`
      <div style="font-size: 13px; font-weight: 500; color: var(--accent-text);">
        <span class="spinner-icon"></span> กำลังวิเคราะห์ชื่อเฉพาะและแปล "${escapeHtml(rawChapTitle)}" ผ่าน AI...
      </div>
    `, true);

    const result = await translateChapter(text, ctx, {
      signal,
      rawChapTitle,
      rawBookTitle,
      lockInfo,
      prevChapter: findPrevStoryChapter(chapters),
      onStatus: (msg) => {
        if (currentBookId !== requestBookId) return;
        updateInfiniteStatusBanner(`
          <div style="font-size: 13px; font-weight: 500; color: var(--warning);">
            <span class="spinner-icon"></span> ${escapeHtml(msg)}
          </div>
        `, true);
      }
    });

    const currentAll = await dbGetChaptersByBook(requestBookId);
    if (currentAll.some(c => sameSourceUrl(c.sourceUrl, targetUrl))) {
      if (currentBookId === requestBookId) document.getElementById('prefetch-badge').style.display = 'inline-block';
      return;
    }

    const maxOrder = currentAll.reduce((max, c) => Math.max(max, c.order || 0), 0);
    const newChap = buildChapterRecord({
      bookId: requestBookId,
      order: maxOrder + 1,
      title: result.chapterTitle || rawChapTitle || `ตอนที่ ${maxOrder + 1}`,
      result,
      sourceUrl: targetUrl,
      nextUrl
    });

    await dbSaveChapter(newChap);

    const curBook = (await dbGetAllBooks()).find(b => b.bookId === requestBookId);
    let resolvedTitle = ctx.title;
    if (curBook) {
      resolvedTitle = curBook.isUserCustomTitle ? curBook.title : (result.bookTitle || curBook.title);
      await dbSaveBook({
        ...curBook,
        title: resolvedTitle,
        author: ctx.author,
        totalChapters: maxOrder + 1,
        lastUrl: targetUrl,
        updatedAt: Date.now()
      });
    }

    if (currentBookId === requestBookId) {
      if (!chapters.some(c => c.id === newChap.id)) chapters.push(newChap);
      nextUrlCalculated = nextUrl;
      if (!isUserCustomTitle) currentBookTitle = resolvedTitle;
      document.getElementById('prefetch-badge').style.display = 'inline-block';
      const isInfinite = localStorage.getItem('nov_enable_infinite') !== 'false';
      if (isInfinite) appendNextChapterToWindow();
    }
  } catch (e) {
    if (isAbortError(e)) return;
    console.warn("Reading prefetch failed:", e);
    if (isMissingPageError(e)) {
      lastChap.nextUrl = null;
      await dbSaveChapter(lastChap);
      if (currentBookId === requestBookId) nextUrlCalculated = null;
    } else if (currentBookId === requestBookId) {
      lastPrefetchError = e.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    }
  } finally {
    if (releaseAppend) releaseAppend();
    endTask('prefetch', controller);
    if (!isTaskRunning('prefetch')) isPrefetching = false;
    checkAndRefreshBottomStatus();
  }
}

// ดึงและแปลตอนจาก URL แล้วบันทึกต่อท้ายเรื่อง (ถ้ามีงานอื่นบันทึกตอนนี้ไประหว่างแปล ใช้ของเดิม)
async function translateAndSaveNextChapter(ctx, chapterUrl, signal, onStatus) {
  const { text, nextUrl, rawChapTitle, rawBookTitle, author, lockInfo } = await scrapePage(chapterUrl, signal, { bookId: ctx.bookId });
  if (author) ctx.author = author;

  const result = await translateChapter(text, ctx, {
    signal,
    rawChapTitle,
    rawBookTitle,
    lockInfo,
    prevChapter: findPrevStoryChapter(chapters),
    onStatus
  });

  const currentAll = await dbGetChaptersByBook(ctx.bookId);
  const existing = currentAll.find(c => sameSourceUrl(c.sourceUrl, chapterUrl));
  if (existing) return existing;
  const maxOrder = currentAll.reduce((max, c) => Math.max(max, c.order || 0), 0);
  const newChap = buildChapterRecord({
    bookId: ctx.bookId,
    order: maxOrder + 1,
    title: result.chapterTitle || rawChapTitle || `ตอนที่ ${maxOrder + 1}`,
    result,
    sourceUrl: chapterUrl,
    nextUrl
  });
  await dbSaveChapter(newChap);
  return newChap;
}

async function handleNextChapterClick() {
  if (currentChapterIndex < chapters.length - 1) {
    currentChapterIndex++;
    document.getElementById('prefetch-badge').style.display = 'none';
    renderVirtualWindow(currentChapterIndex, true);
    checkProactivePrefetch();
    return;
  }

  if (!nextUrlCalculated) {
    openImportModal();
    return;
  }
  if (isPrefetching || isTaskRunning('next')) return;

  const controller = beginTask('next');
  const signal = controller.signal;
  const ctx = getCurrentBookContext();
  const chapterUrl = nextUrlCalculated;
  const btnText = document.getElementById('next-btn-text');
  const nextBtn = document.getElementById('next-chap-btn');
  const cancelBtn = document.getElementById('cancel-retry-btn');

  btnText.innerText = "กำลังแปลตอนถัดไป...";
  nextBtn.disabled = true;
  cancelBtn.style.display = 'inline-flex';
  let releaseAppend = null;

  try {
    // รอถ้าอีกแท็บกำลังเพิ่มตอนของเรื่องนี้ แล้วเช็กก่อนว่าอีกแท็บแปลตอนนี้ไปแล้วหรือยัง
    releaseAppend = await acquireLock(lockNames.append(ctx.bookId), { ifAvailable: true });
    if (!releaseAppend) {
      btnText.innerText = "รออีกแท็บแปลตอนนี้...";
      releaseAppend = await acquireLock(lockNames.append(ctx.bookId), { signal });
    }
    btnText.innerText = "กำลังแปลตอนถัดไป...";
    const newChap = (await dbGetChaptersByBook(ctx.bookId)).find(c => sameSourceUrl(c.sourceUrl, chapterUrl)) ||
      await translateAndSaveNextChapter(ctx, chapterUrl, signal, (msg) => { btnText.innerText = msg.substring(0, 30) + "..."; });

    if (currentBookId !== ctx.bookId) return;
    if (!chapters.some(c => c.id === newChap.id)) chapters.push(newChap);
    currentUrl = chapterUrl;
    currentAuthor = ctx.author;
    nextUrlCalculated = newChap.nextUrl;
    currentChapterIndex = chapters.findIndex(c => c.id === newChap.id);
    renderVirtualWindow(currentChapterIndex, true);
    checkProactivePrefetch();
  } catch (err) {
    if (isAbortError(err)) return;
    if (isMissingPageError(err)) {
      openImportModal(chapterUrl, "ไม่พบหน้าตอนถัดไป (กรุณาวาง URL ที่ถูกต้อง)");
    } else {
      appAlert(`แปลตอนถัดไปไม่สำเร็จ: ${err.message}`);
    }
  } finally {
    if (releaseAppend) releaseAppend();
    endTask('next', controller);
    btnText.innerText = "ตอนถัดไป →";
    nextBtn.disabled = false;
    cancelBtn.style.display = 'none';
  }
}

function prevChapter() {
  if (currentChapterIndex > 0) {
    currentChapterIndex--;
    renderVirtualWindow(currentChapterIndex, true);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  setupPwa();
  try {
    await initDB();
    await refreshInMemoryGlossaryCache();
  } catch (err) {
    console.error('Database initialization failed:', err);
    const readingContent = document.getElementById('reading-content');
    if (readingContent) readingContent.textContent = `เปิดฐานข้อมูลไม่สำเร็จ: ${err.message}`;
    return;
  }
  loadSettings();
  setupModalKeyboard();
  setupAccessibleNames();
  setupReader();
  setupSelectionMonitor();
  setupScrollMonitor();
  setupFullscreenListener();
  setupPopoverDelegation();
  setupParagraphKeyboard();
  setupHome();

  const lastBookId = localStorage.getItem('nov_last_book_id');
  if (lastBookId) {
    await loadBookFromDB(lastBookId);
  } else {
    renderVirtualWindow(0, true);
  }
  await maybeOpenHomeOnStartup();
  initSafetyOnStartup();
});
