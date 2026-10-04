// ==================== APP CONTROLLER & VIEWER ====================
let currentTheme = 'sepia';
let currentFontSize = 18;
let currentUrl = "";
let nextUrlCalculated = "";
let isPrefetching = false;
let lastPrefetchError = '';
let currentBookId = "default_novel";
let currentBookTitle = "NovelTranslate";
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

let selectedWordBuffer = "";
let isSelectedChinese = false;
let selectedParagraphContext = { th: "", src: "", uniqueKey: "" };

function createGuideChapters() {
  return [{
    id: "guide_chap_1",
    title: "คู่มือเริ่มต้น v3.1.2",
    paragraphs: [
      { th: "ยินดีต้อนรับสู่ NovelTranslate AI v3.1.2", src: "欢迎来到 NovelTranslate" },
      { th: "ระบบได้ทำการแยกโครงสร้างโค้ดเป็น Modular Architecture เรียบร้อยแล้ว", src: "已完全重构为模块化架构" }
    ],
    summary: "ผู้ใช้เริ่มต้นใช้งาน NovelTranslate AI v3.1.2"
  }];
}

let chapters = createGuideChapters();
let currentChapterIndex = 0;

function resetToGuideBook() {
  localStorage.removeItem('nov_last_book_id');
  currentBookId = 'default_novel';
  currentBookTitle = 'NovelTranslate';
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
  document.getElementById('reading-content').style.fontSize = currentFontSize + 'px';
  localStorage.setItem('nov_font_size', currentFontSize);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('active');
    if (!document.querySelector('.modal-overlay.active')) {
      document.body.classList.remove('modal-open');
    }
  }
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
  const heading = locked ? '🔒 ตอนนี้ต้องซื้อหรือเข้าสู่ระบบที่เว็บต้นทางก่อนจึงจะอ่านได้' : '🛡️ ตอนนี้ยังเป็นเนื้อหากันก๊อป (ข้อความหลอก)';
  const detail = locked
    ? 'หน้าเว็บมีแค่ตัวอย่างสั้นๆ ระบบจึงไม่แปลข้อความตัวอย่าง ถ้าคุณมีสิทธิ์อ่านตอนนี้ ให้คัดลอกเนื้อหามาวางที่ "วางข้อความ/ไฟล์" แทน'
    : 'ผู้เขียนมักเปลี่ยนเป็นเนื้อหาจริงภายหลัง ระบบจึงยังไม่แปลเพื่อประหยัดโควตา และไม่ใช้ตอนนี้ต่อบริบทของเรื่อง';
  return `
    <div class="placeholder-notice">
      <div style="font-weight: 600; margin-bottom: 4px;">${heading}</div>
      <div style="font-size: 12px; opacity: 0.8; margin-bottom: 10px;">${detail}</div>
      ${chap.sourceUrl ? `<button class="btn btn-primary" style="padding: 5px 12px; font-size: 12px;" onclick="refetchChapterFromSource(${jsArg(chap.id)})">🔄 ดึงเนื้อหาจริงจากหน้าเว็บใหม่</button>` : ''}
      <details style="margin-top: 10px; font-size: 12px;"><summary style="cursor: pointer; opacity: 0.7;">ดูข้อความต้นฉบับที่ดึงมา</summary><div class="para-src" style="display: block;">${srcHtml}</div></details>
    </div>`;
}

function buildChapterBlockHtml(chap, chapIdx, activeTerms) {
  const chapterType = chap.chapterType || 'story';
  const isNoteChapter = chapterType === 'author_note';
  let parasHtml = '';
  let junkCount = 0;

  if (chap.status === 'pending') {
    parasHtml = buildPendingNoticeHtml(chap);
  } else if (chapterType === 'placeholder') {
    parasHtml = buildPlaceholderNoticeHtml(chap);
  } else {
    chap.paragraphs.forEach((p, pIdx) => {
      const kind = p.kind || 'story';
      if (kind === 'site_junk') {
        junkCount++;
        // ไม่ลบทิ้ง แค่ซ่อนไว้ เลขย่อหน้า (ใช้จำตำแหน่งอ่าน) จึงไม่เลื่อน
        parasHtml += `
      <div class="para-item para-junk" id="para-box-${chapIdx}-${pIdx}">
        <span class="para-kind-label">🌐 ข้อความจากหน้าเว็บ (ไม่ได้แปล)</span>
        <div class="para-src" style="display: block;">${escapeHtml(p.src || '')}</div>
      </div>`;
        return;
      }
      const highlightedTh = applyInlineTermHighlighting(p.th || "", activeTerms);
      const noteLabel = (kind === 'author_note' && !isNoteChapter)
        ? `<span class="para-kind-label">📝 ข้อความผู้เขียน <button class="para-kind-reset" onclick="markParagraphAsStory(event, ${chapIdx}, ${pIdx})" title="ไม่ใช่ข้อความผู้เขียน เปลี่ยนเป็นเนื้อเรื่อง">ไม่ใช่</button></span>`
        : '';
      const actions = `
          <div class="para-actions">
            <button class="para-action-btn" onclick="openEditParagraphModal(event, ${chapIdx}, ${pIdx})">✎ แก้คำแปล</button>
            ${p.thDraft && p.thDraft !== p.th ? `<button class="para-action-btn" onclick="swapParagraphDraft(event, ${chapIdx}, ${pIdx})" title="สลับไปใช้คำแปลอีกฉบับ (ก่อนเกลา/ก่อนแก้)">↺ ใช้ฉบับ${p.userEdited ? 'ของ AI' : 'ก่อนเกลา'}</button>` : ''}
          </div>`;
      parasHtml += `
      <div class="para-item${kind === 'author_note' ? ' para-note' : ''}${p.userEdited ? ' para-user-edited' : ''}" id="para-box-${chapIdx}-${pIdx}">
        ${noteLabel}
        <div class="para-th" onclick="toggleParagraphSrc(event, '${chapIdx}-${pIdx}')" data-unique-key="${chapIdx}-${pIdx}" data-th="${escapeHtml(encodeURIComponent(p.th || ''))}" data-src="${escapeHtml(encodeURIComponent(p.src || ''))}">${highlightedTh}</div>
        <div class="para-src" id="src-${chapIdx}-${pIdx}"><span class="para-src-text">${escapeHtml(p.src || "ไม่มีข้อความต้นฉบับ")}</span>${p.src ? actions : ''}</div>
      </div>
    `;
    });
    if (junkCount > 0) {
      parasHtml += `<div class="junk-toggle-line">ซ่อนข้อความจากหน้าเว็บไว้ ${junkCount} ย่อหน้า · <a href="#" onclick="toggleShowJunk(event)">${document.body.classList.contains('show-junk') ? 'ซ่อน' : 'แสดง'}</a></div>`;
    }
  }

  const typeBadge = chapterType !== 'story' ? `<span class="chapter-type-badge type-${chapterType}">${CHAPTER_TYPE_LABELS[chapterType] || chapterType}</span>` : '';
  return `
      <div class="chapter-block chapter-type-${chapterType}" id="chapter-block-${chapIdx}" data-index="${chapIdx}" data-id="${escapeHtml(chap.id)}">
      <div class="chapter-block-divider">
        <span class="chapter-divider-pill">📖 ${escapeHtml(chap.title)}</span>
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
  if (!newTh) return alert('กรุณาใส่คำแปล');
  if (newTh !== p.th) {
    // เก็บคำแปลของ AI ไว้ครั้งแรก เพื่อสลับกลับได้
    if (!p.userEdited && !p.thDraft) p.thDraft = p.th;
    p.th = newTh;
    p.userEdited = true;
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

  const activeTerms = await getActiveGlossaryForCurrentBook();
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
    if (renderedWindowIndices.length > 3) {
      const removeIdx = renderedWindowIndices.shift();
      const removeEl = document.getElementById(`chapter-block-${removeIdx}`);
      if (removeEl) removeEl.remove();
    }

    setupChapterIntersectionObserver();
  } finally {
    isAppendingNextChapter = false;
    checkAndRefreshBottomStatus();
    checkProactivePrefetch();
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
  const isPrefetchEnabled = localStorage.getItem('nov_enable_prefetch') !== 'false';
  if (!isPrefetchEnabled || isPrefetching) return;

  if (currentChapterIndex >= chapters.length - 1) {
    triggerReadingPrefetchIfEnabled(false);
  }
}

function checkAndRefreshBottomStatus() {
  const isInfinite = localStorage.getItem('nov_enable_infinite') !== 'false';
  if (!isInfinite) {
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
      <div style="font-size: 13px; font-weight: 500; color: #2563eb;">
        <span class="spinner-icon"></span> กำลังดึงและแปลตอนถัดไปให้อัตโนมัติ...
      </div>
      <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">
        เมื่อแปลเสร็จ เนื้อหาจะต่อท้ายสายตาของคุณทันที
      </div>
    `, true);
  } else if (targetUrl && lastPrefetchError === OTHER_TAB_BUSY_MESSAGE) {
    updateInfiniteStatusBanner(`
      <div style="font-size: 13px; font-weight: 500; color: #2563eb;">
        <span class="spinner-icon"></span> ${escapeHtml(OTHER_TAB_BUSY_MESSAGE)}
      </div>
      <button class="btn" style="padding: 4px 10px; font-size: 11px; margin-top: 8px;" onclick="triggerManualFetchNext()">ลองแปลในแท็บนี้อีกครั้ง</button>
    `, true);
  } else if (targetUrl) {
    const errorHtml = lastPrefetchError ? `
      <div style="font-size: 11px; color: #dc2626; margin-bottom: 8px;">
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
      <div style="font-size: 13px; font-weight: 600; color: #dc2626; margin-bottom: 6px;">
        ⚠️ ไม่พบ URL ของตอนถัดไป (เลข URL อาจกระโดดข้าม)
      </div>
      <div style="font-size: 11px; opacity: 0.75; margin-bottom: 10px;">
        กรุณาก๊อปปี้ URL ตอนถัดไปจากหน้าเว็บจริงมาวางเพื่อแปลต่อ
      </div>
      <button class="btn btn-primary" style="padding: 5px 12px; font-size: 12px;" onclick="promptFixNextUrlFromBottom()">
        🔗 วาง URL ตอนถัดไป
      </button>
    `, true);
  }
}

function triggerManualFetchNext() { triggerReadingPrefetchIfEnabled(true); }

function promptFixNextUrlFromBottom() {
  const lastChap = chapters[chapters.length - 1];
  const input = prompt(`กรุณาวาง URL ของตอนถัดไปสำหรับ "${lastChap.title}":`, "");
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

function setupScrollMonitor() {
  window.addEventListener('scroll', () => {
    // บันทึกตำแหน่งย่อหน้าหลังหยุดเลื่อน (debounce) เพื่อไม่ให้เขียนฐานข้อมูลถี่เกินไป
    clearTimeout(readingPositionTimer);
    readingPositionTimer = setTimeout(() => {
      const pos = findTopVisibleParagraph();
      if (!pos || !chapters[pos.chapIdx]) return;
      const key = `${currentBookId}:${chapters[pos.chapIdx].id}:${pos.paraIdx}`;
      if (key === lastSavedPosition) return;
      lastSavedPosition = key;
      saveReadingPointer(pos.chapIdx, pos.paraIdx);
    }, 700);

    const isInfinite = localStorage.getItem('nov_enable_infinite') !== 'false';
    if (!isInfinite) return;

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
  const newTitle = prompt("แก้ไขชื่อนิยายเรื่องนี้ (ชื่อที่ตั้งใหม่จะถูกล็อกไว้ถาวร):", currentBookTitle);
  if (newTitle !== null && newTitle.trim()) {
    currentBookTitle = newTitle.trim();
    isUserCustomTitle = true;
    document.getElementById('display-book-title').innerText = currentBookTitle;
    saveReadingPointer(currentChapterIndex);
  }
}

async function promptEditChapterTitle() {
  const chap = chapters[currentChapterIndex];
  const newTitle = prompt("แก้ไขชื่อตอนปัจจุบัน:", chap.title);
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
    srcEl.style.display = (srcEl.style.display === 'block') ? 'none' : 'block';
  }
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

function cancelNextChapterFetch() {
  abortTask('next');
}

async function addFromSelectionBar() {
  const selected = selectedWordBuffer.trim();
  if (!selected) return alert('กรุณาเลือกข้อความก่อน');
  await openGlossaryModal();
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
  if (!chap) return alert('ไม่พบบทที่กำลังอ่าน');
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
  if (!chapter || !Array.isArray(chapter.paragraphs)) return alert('ไม่พบบทนี้ในฐานข้อมูล');
  if (chapter.status === 'pending') return translatePendingChapterNow(chapId);
  // ตอนกันก๊อป: เนื้อหาจริงอาจถูกเปลี่ยนที่หน้าเว็บแล้ว ต้องดึงใหม่ ไม่ใช่แปลข้อความหลอกเดิม
  if (chapter.chapterType === 'placeholder' && chapter.sourceUrl) return refetchChapterFromSource(chapId);
  const rawText = chapter.paragraphs.map(p => p.src || '').filter(Boolean).join('\n\n');
  if (!rawText) return alert('บทนี้ไม่มีข้อความต้นฉบับ จึงแปลใหม่ไม่ได้');

  if (isTaskRunning('retranslate')) return alert('กำลังแปลบทอื่นใหม่อยู่ กรุณารอให้เสร็จก่อน');

  // ย่อหน้าที่ผู้ใช้แก้เองจะไม่ถูกเขียนทับ ถ้าผู้ใช้ไม่ยืนยัน
  const editedCount = chapter.paragraphs.filter(p => p.userEdited).length;
  const keepEdits = editedCount > 0
    ? confirm(`ตอนนี้มี ${editedCount} ย่อหน้าที่คุณแก้คำแปลเอง\n\nกด OK = เก็บย่อหน้าที่แก้ไว้ (แปลใหม่เฉพาะย่อหน้าอื่น)\nกด Cancel = แปลใหม่ทั้งหมด (ทับที่แก้ไว้)`)
    : false;

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
    await applyTranslationToChapter(chapter, result, { updateTitle: false });
    alert(`แปล "${chapter.title}" ใหม่และบันทึกแล้ว${keepEdits ? ` (เก็บย่อหน้าที่แก้เองไว้ ${editedCount} ย่อหน้า)` : ''}`);
  } catch (err) {
    if (!isAbortError(err)) alert(`แปลบทใหม่ไม่สำเร็จ: ${err.message}`);
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
async function applyTranslationToChapter(chapter, result, { updateTitle = false, nextUrl = undefined } = {}) {
  chapter.paragraphs = result.paragraphs;
  chapter.summary = result.summary || '';
  chapter.chapterType = result.chapterType || 'story';
  if (result.placeholderReason) chapter.placeholderReason = result.placeholderReason;
  else delete chapter.placeholderReason;
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
  if (!rawText && chapter.sourceUrl) {
    if (onStatus) onStatus(`กำลังดึงเนื้อหา "${chapter.title}"...`);
    const scraped = await scrapePage(chapter.sourceUrl, signal, { bookId: chapter.bookId });
    rawText = scraped.text;
    rawChapTitle = scraped.rawChapTitle || rawChapTitle;
    if (scraped.nextUrlSource !== 'guess') nextUrl = scraped.nextUrl;
    if (scraped.author) ctx.author = scraped.author;
  }
  if (!rawText) throw new Error('ตอนนี้ไม่มีเนื้อหาต้นฉบับ');
  const bookChaps = await dbGetChaptersByBook(chapter.bookId);
  const result = await translateChapter(rawText, ctx, {
    signal, onStatus, rawChapTitle,
    prevChapter: findPrevStoryChapter(bookChaps, chapter.order ?? 0)
  });
  await applyTranslationToChapter(chapter, result, { updateTitle: true, nextUrl });
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
  if (!chapter) return alert('ไม่พบตอนนี้');
  if (isTaskRunning('retranslate')) return alert('กำลังแปลบทอื่นอยู่ กรุณารอให้เสร็จก่อน');
  const books = await dbGetAllBooks();
  const ctx = makeBookContext(books.find(b => b.bookId === chapter.bookId) || getCurrentBookContext());
  const controller = beginTask('retranslate');
  showGlobalToast(`กำลังแปล "${chapter.title}"...`);
  try {
    await translatePendingChapterCore(chapter, ctx, { signal: controller.signal, onStatus: showGlobalToast });
  } catch (err) {
    if (err instanceof LockBusyError) alert(err.message);
    else if (!isAbortError(err)) alert(`แปลไม่สำเร็จ: ${describeScrapeError(err)}`);
  } finally {
    endTask('retranslate', controller);
    hideGlobalToast();
  }
}

function buildPendingNoticeHtml(chap) {
  const srcCount = chap.paragraphs.filter(p => p.src).length;
  const preview = chap.paragraphs.slice(0, 30).map(p => `<p>${escapeHtml(p.src || '')}</p>`).join('');
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
  if (!chapter?.sourceUrl) return alert('ตอนนี้ไม่มี URL ต้นฉบับ จึงดึงเนื้อหาใหม่ไม่ได้');
  if (isTaskRunning('retranslate')) return alert('กำลังแปลบทอื่นใหม่อยู่ กรุณารอให้เสร็จก่อน');

  const books = await dbGetAllBooks();
  const ctx = makeBookContext(books.find(b => b.bookId === chapter.bookId) || getCurrentBookContext());
  const controller = beginTask('retranslate');
  showGlobalToast('กำลังดึงเนื้อหาจากหน้าเว็บต้นฉบับใหม่...');
  try {
    const scraped = await scrapePage(chapter.sourceUrl, controller.signal, { bookId: chapter.bookId });
    if (classifyChapterByRules(scraped.rawChapTitle, scraped.text).type === 'placeholder') {
      alert('หน้าเว็บยังเป็นเนื้อหากันก๊อปอยู่ ผู้เขียนอาจยังไม่ได้อัปเดตเนื้อหาจริง ลองใหม่ภายหลังนะครับ');
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
    await applyTranslationToChapter(chapter, result, { updateTitle: true, nextUrl: scraped.nextUrlSource === 'link' ? scraped.nextUrl : undefined });
    alert(`ดึงและแปล "${chapter.title}" เรียบร้อยแล้ว`);
  } catch (err) {
    if (!isAbortError(err)) alert(`ดึงเนื้อหาใหม่ไม่สำเร็จ: ${describeScrapeError(err)}`);
  } finally {
    endTask('retranslate', controller);
    hideGlobalToast();
  }
}

async function findChineseForSelection() {
  const { th, src } = selectedParagraphContext;
  if (!selectedWordBuffer || !th || !src) return alert('ไม่พบย่อหน้าต้นฉบับที่สัมพันธ์กับข้อความที่เลือก');
  if (!hasActiveApiKey()) return alert("กรุณาใส่ API Key ในเมนู 'ตั้งค่า' ก่อนใช้งาน");
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
    document.getElementById('gloss-src').value = candidate;
    document.getElementById('gloss-tgt').value = selectedWordBuffer;
    document.getElementById('gloss-cat').focus();
  } catch (err) {
    alert(`ค้นหาคำต้นฉบับไม่สำเร็จ: ${err.message}`);
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

  if (!confirm(`คุณต้องการลบตอนที่เลือกจำนวน ${count} ตอน ออกจากเครื่องใช่หรือไม่?`)) return;

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
    if (!title) return alert('กรุณาตั้งชื่อเรื่องใหม่');
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
    if (!toBook) return alert('ไม่พบเรื่องปลายทาง');
  }

  try {
    abortAllRunningProcesses();
    await dbMoveChapters(ids, fromBookId, toBook);
    await repairBookPointer(fromBookId);
    await repairBookPointer(toBook.bookId);
    closeModal('move-chapters-modal');
    if (currentBookId === fromBookId || currentBookId === toBook.bookId) await loadBookFromDB(currentBookId);
    await openBookshelfModal();
    alert(`ย้าย ${ids.length} ตอนไปที่ "${toBook.title}" เรียบร้อยแล้ว`);
  } catch (err) {
    alert(`ย้ายตอนไม่สำเร็จ: ${err.message}`);
  }
}

async function loadBookFromDB(bookId, specifyChapIdOrIdx = null) {
  if (currentBookId !== bookId) abortReaderTasks();
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
    const resumePara = (specifyChapIdOrIdx === null && currentActiveChap.id === targetBook.lastChapterId)
      ? (targetBook.lastParaIndex || 0) : null;
    lastSavedPosition = '';
    renderVirtualWindow(currentChapterIndex, true, resumePara);
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
  if (!confirm("ต้องการลบนิยายเรื่องนี้และตอนที่เก็บไว้ทั้งหมดในเครื่องใช่หรือไม่?")) return;
  abortAllRunningProcesses();
  await dbDeleteBook(bookId);
  if (currentBookId === bookId) {
    const remainingBooks = await dbGetAllBooks();
    if (remainingBooks.length) await loadBookFromDB(remainingBooks[0].bookId);
    else resetToGuideBook();
  }
  openBookshelfModal();
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
      <div style="font-size: 13px; font-weight: 500; color: #2563eb;">
        <span class="spinner-icon"></span> กำลังดึงเนื้อหาตอนถัดไปจากเว็บต้นฉบับ...
      </div>
    `, true);

    const { text, nextUrl, rawChapTitle, rawBookTitle, author } = await scrapePage(targetUrl, signal, { bookId: requestBookId });
    if (author) {
      ctx.author = author;
      if (currentBookId === requestBookId) currentAuthor = author;
    }

    updateInfiniteStatusBanner(`
      <div style="font-size: 13px; font-weight: 500; color: #2563eb;">
        <span class="spinner-icon"></span> กำลังวิเคราะห์ชื่อเฉพาะและแปล "${escapeHtml(rawChapTitle)}" ผ่าน AI...
      </div>
    `, true);

    const result = await translateChapter(text, ctx, {
      signal,
      rawChapTitle,
      rawBookTitle,
      prevChapter: findPrevStoryChapter(chapters),
      onStatus: (msg) => {
        if (currentBookId !== requestBookId) return;
        updateInfiniteStatusBanner(`
          <div style="font-size: 13px; font-weight: 500; color: #b45309;">
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
  const { text, nextUrl, rawChapTitle, rawBookTitle, author } = await scrapePage(chapterUrl, signal, { bookId: ctx.bookId });
  if (author) ctx.author = author;

  const result = await translateChapter(text, ctx, {
    signal,
    rawChapTitle,
    rawBookTitle,
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
      alert(`แปลตอนถัดไปไม่สำเร็จ: ${err.message}`);
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

async function refreshImportTargetOptions(preferBookId = 'auto') {
  const select = document.getElementById('import-target-book');
  if (!select) return;
  const books = (await dbGetAllBooks()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  select.innerHTML = `
    <option value="auto">อัตโนมัติ (ตรวจจาก URL ว่าเป็นเรื่องไหน)</option>
    <option value="new">➕ สร้างเป็นเรื่องใหม่เสมอ</option>
    ${books.map(b => `<option value="${escapeHtml(b.bookId)}">📚 ต่อท้ายเรื่อง: ${escapeHtml(b.title || b.bookId)}</option>`).join('')}
  `;
  select.value = books.some(b => b.bookId === preferBookId) ? preferBookId : 'auto';
  updateImportTargetHint();
}

async function updateImportTargetHint() {
  const hint = document.getElementById('import-target-hint');
  const select = document.getElementById('import-target-book');
  const url = document.getElementById('import-url').value.trim();
  if (!hint || !select) return;
  const genreSelect = document.getElementById('import-novel-genre');
  if (select.value !== 'auto') {
    hint.innerText = '';
    genreSelect.disabled = select.value !== 'new';
    return;
  }
  if (importMode === 'text') {
    hint.innerText = 'จะสร้างเป็นเรื่องใหม่ (เลือกเรื่องจากรายการ ถ้าต้องการต่อท้ายเรื่องที่มีอยู่)';
    genreSelect.disabled = false;
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    hint.innerText = '';
    genreSelect.disabled = false;
    return;
  }
  const match = findExistingBookForUrl(url, await dbGetAllBooks());
  const { reliable } = deriveBookKey(url);
  hint.innerText = match
    ? `จะต่อท้ายเรื่อง "${match.title}" ที่มีอยู่แล้ว`
    : (reliable ? 'จะสร้างเป็นเรื่องใหม่' : '⚠️ แยกชื่อเรื่องจาก URL นี้ไม่ได้ จะสร้างเป็นเรื่องใหม่ ถ้าเป็นตอนของเรื่องที่มีอยู่ ให้เลือกเรื่องจากรายการ');
  genreSelect.disabled = !!match;
}

function openImportModal(prefillUrl = '', title = 'วาง URL หน้านิยาย', preferBookId = 'auto') {
  const modalTitle = document.getElementById('import-modal-title');
  if (modalTitle) modalTitle.innerText = title;
  document.getElementById('import-url').value = prefillUrl;
  const status = document.getElementById('import-status');
  if (status && !isTaskRunning('import')) status.style.display = 'none';
  if (prefillUrl) switchImportTab('url');
  refreshImportTargetOptions(preferBookId);
  openModal('import-modal');
}

// ==================== IMPORT FROM TEXT / FILE ====================
let importMode = 'url';
let importTextParsed = null;

function switchImportTab(mode) {
  importMode = mode;
  document.querySelectorAll('.import-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('import-panel-url').style.display = mode === 'url' ? 'block' : 'none';
  document.getElementById('import-panel-text').style.display = mode === 'text' ? 'block' : 'none';
  document.getElementById('start-btn-text').innerText = mode === 'url' ? 'เริ่มแปลตอนนี้' : 'นำเข้าเป็นตอนที่รอแปล';
  updateImportTargetHint();
}

async function handleImportFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const status = document.getElementById('import-text-preview');
  status.innerHTML = '<span class="spinner-icon"></span> กำลังอ่านไฟล์...';
  try {
    checkImportFileSize(file);
    const buffer = await file.arrayBuffer();
    const baseName = file.name.replace(/\.[^.]+$/, '');
    if (/\.epub$/i.test(file.name)) {
      const epub = await parseEpubFile(buffer);
      importTextParsed = { bookTitle: epub.bookTitle || baseName, chapters: epub.chapters };
      document.getElementById('import-text-area').value = '';
    } else {
      const text = decodeTextBuffer(buffer);
      document.getElementById('import-text-area').value = text;
      importTextParsed = { bookTitle: baseName, chapters: splitTextIntoChapters(text) };
    }
    checkImportChapterCount(importTextParsed.chapters.length);
    if (!document.getElementById('import-text-title').value.trim()) document.getElementById('import-text-title').value = importTextParsed.bookTitle;
    renderImportTextPreview();
  } catch (err) {
    importTextParsed = null;
    status.innerHTML = `<span style="color:#dc2626;">อ่านไฟล์ไม่สำเร็จ: ${escapeHtml(err.message)}</span>`;
  }
}

function previewImportText() {
  const text = document.getElementById('import-text-area').value;
  if (!text.trim()) {
    importTextParsed = null;
    document.getElementById('import-text-preview').innerHTML = '';
    return;
  }
  if (text.length > IMPORT_LIMITS.pasteChars) {
    importTextParsed = null;
    document.getElementById('import-text-preview').innerHTML = `<span style="color:#dc2626;">ข้อความยาวเกินไป (${text.length.toLocaleString()} ตัวอักษร) วางได้ไม่เกิน ${IMPORT_LIMITS.pasteChars.toLocaleString()} ตัวอักษร ลองแบ่งเป็นหลายครั้ง</span>`;
    return;
  }
  importTextParsed = { bookTitle: document.getElementById('import-text-title').value.trim(), chapters: splitTextIntoChapters(text) };
  renderImportTextPreview();
}

function renderImportTextPreview() {
  const box = document.getElementById('import-text-preview');
  const list = importTextParsed?.chapters || [];
  if (!list.length) {
    box.innerHTML = '<span style="color:#dc2626;">ไม่พบเนื้อหาในข้อความ/ไฟล์นี้</span>';
    return;
  }
  const total = list.reduce((n, ch) => n + ch.paragraphs.join('').length, 0);
  const sample = list.length <= 6 ? list : [...list.slice(0, 3), null, ...list.slice(-2)];
  const lang = detectSourceLang(list.slice(0, 3).map(ch => ch.paragraphs.join('\n')).join('\n'));
  box.innerHTML = `
    <div>พบ <b>${list.length}</b> ตอน · ${total.toLocaleString()} ตัวอักษร${lang ? ` · ภาษาที่ตรวจพบ: <b>${escapeHtml(getLangName(lang))}</b>` : ''}</div>
    <ol style="padding-left:20px; margin-top:4px;">${sample.map((ch, i) => ch
      ? `<li value="${list.indexOf(ch) + 1}">${escapeHtml(ch.title)} <span style="opacity:0.6;">(${ch.paragraphs.join('').length.toLocaleString()} ตัวอักษร)</span></li>`
      : '<li style="list-style:none; opacity:0.6;">…</li>').join('')}</ol>`;
}

/** นำเข้าข้อความ/ไฟล์เป็น "ตอนที่รอแปล" (ยังไม่ใช้โควตา AI จนกว่าจะสั่งแปล) */
async function importTextChapters() {
  if (!importTextParsed) previewImportText();
  const list = importTextParsed?.chapters || [];
  if (!list.length) return alert('กรุณาวางข้อความหรือเลือกไฟล์ก่อน');
  try { checkImportChapterCount(list.length); } catch (err) { return alert(err.message); }

  const books = await dbGetAllBooks();
  const choice = document.getElementById('import-target-book')?.value || 'auto';
  const existingBook = (choice !== 'auto' && choice !== 'new') ? books.find(b => b.bookId === choice) : null;
  const userTitle = document.getElementById('import-text-title').value.trim();
  const bookId = existingBook?.bookId || 'book_' + hashString(`${userTitle}|text|${Date.now()}`);
  const chosenLang = document.getElementById('import-source-lang')?.value || 'auto';
  const sourceLang = existingBook ? getBookSourceLang(existingBook)
    : (chosenLang !== 'auto' ? chosenLang : (detectSourceLang(list.slice(0, 3).map(ch => ch.paragraphs.join('\n')).join('\n')) || DEFAULT_SOURCE_LANG));

  const existingChaps = existingBook ? await dbGetChaptersByBook(bookId) : [];
  let order = existingChaps.reduce((m, c) => Math.max(m, c.order || 0), 0);
  const now = Date.now();
  const records = list.map((ch, k) => ({
    id: `${bookId}_chap_${now}_f${k}`,
    bookId,
    order: ++order,
    title: ch.title,
    chapterType: 'story',
    status: 'pending',
    paragraphs: ch.paragraphs.map(src => ({ th: '', src })),
    summary: '',
    sourceUrl: '',
    nextUrl: null
  }));

  if (!existingBook) {
    await dbSaveBook({
      bookId,
      title: userTitle || importTextParsed.bookTitle || 'นิยายจากไฟล์',
      isUserCustomTitle: !!userTitle,
      author: '',
      genre: document.getElementById('import-novel-genre').value,
      sourceLang: normalizeLang(sourceLang),
      lastChapterId: records[0].id,
      lastChapterIndex: 0,
      lastChapterTitle: records[0].title,
      lastParaIndex: 0,
      totalChapters: records.length,
      lastUrl: '',
      updatedAt: Date.now()
    });
  }
  await dbSaveChapters(records);
  await loadBookFromDB(bookId, records[0].id);
  closeModal('import-modal');
  importTextParsed = null;
  document.getElementById('import-text-area').value = '';
  document.getElementById('import-text-title').value = '';
  document.getElementById('import-text-preview').innerHTML = '';

  if (document.getElementById('import-text-translate-first').checked) {
    await translatePendingChapterNow(records[0].id);
  } else {
    alert(`นำเข้า ${records.length} ตอนแล้ว (ยังไม่แปล)\nกด "⚡ แปลตอนนี้เลย" ในหน้าอ่าน หรือ "⚡ เริ่มแปลล่วงหน้า" ที่ชั้นหนังสือเพื่อแปลทีละหลายตอน`);
  }
}

function handleImportStart() {
  return importMode === 'text' ? importTextChapters() : startTranslateFirst();
}

// เลือกเรื่องปลายทางของลิงก์ที่วาง ตามตัวเลือกในหน้าวางลิงก์
function resolveImportTarget(url, choice, books) {
  if (choice === 'new') {
    return { bookId: 'book_' + hashString(`${normalizeUrl(url)}|${Date.now()}`), existingBook: null };
  }
  if (choice && choice !== 'auto') {
    return { bookId: choice, existingBook: books.find(b => b.bookId === choice) || null };
  }
  const match = findExistingBookForUrl(url, books);
  if (match) return { bookId: match.bookId, existingBook: match };
  return { bookId: extractBookIdFromUrl(url), existingBook: null };
}

async function startTranslateFirst() {
  const url = document.getElementById('import-url').value.trim();
  const chosenGenre = document.getElementById('import-novel-genre').value;
  if (!url) return alert("กรุณาใส่ URL หน้านิยาย");
  if (isTaskRunning('import')) return;

  const status = document.getElementById('import-status');
  const startBtn = document.getElementById('start-btn');
  const btnText = document.getElementById('start-btn-text');

  status.style.display = 'block';
  status.style.background = '#eff6ff';
  status.style.color = '#1e40af';
  status.innerText = "กำลังสแกนหาเนื้อหา...";
  startBtn.disabled = true;
  btnText.innerText = "กำลังทำงาน...";

  const controller = beginTask('import');
  const signal = controller.signal;
  try {
    const books = await dbGetAllBooks();
    const choice = document.getElementById('import-target-book')?.value || 'auto';
    const { bookId: targetBookId, existingBook } = resolveImportTarget(url, choice, books);
    const existingChaps = await dbGetChaptersByBook(targetBookId);

    // ตอนนี้เคยแปลไว้แล้ว: เปิดอ่านเลยโดยไม่ต้องเรียก AI
    const duplicateChapter = existingChaps.find(ch => sameSourceUrl(ch.sourceUrl, url));
    if (duplicateChapter && existingBook) {
      await loadBookFromDB(targetBookId, duplicateChapter.id);
      closeModal('import-modal');
      return;
    }

    const { text, nextUrl, rawChapTitle, rawBookTitle, author } = await scrapePage(url, signal, { bookId: targetBookId });
    // ภาษาต้นฉบับ: เรื่องเดิมใช้ค่าที่บันทึกไว้, เรื่องใหม่ใช้ที่ผู้ใช้เลือกหรือตรวจจากเนื้อหา
    const chosenLang = document.getElementById('import-source-lang')?.value || 'auto';
    const sourceLang = existingBook?.sourceLang
      || (chosenLang !== 'auto' ? chosenLang : (detectSourceLang(text) || DEFAULT_SOURCE_LANG));
    const ctx = makeBookContext({
      bookId: targetBookId,
      title: existingBook?.title || rawBookTitle || 'นิยายเรื่องใหม่',
      author: author || existingBook?.author || '',
      genre: existingBook?.genre || chosenGenre,
      sourceLang
    });
    // ให้ตัวกรองคำศัพท์รู้ภาษาของเรื่องใหม่ตั้งแต่ตอนแรก
    if (!existingBook) bookLangCache.set(targetBookId, normalizeLang(sourceLang));

    status.innerText = `พบ "${rawChapTitle}" กำลังวิเคราะห์ชื่อเฉพาะและแปลผ่าน AI...`;

    const prevChap = findPrevStoryChapter(existingChaps);
    const result = await translateChapter(text, ctx, {
      signal,
      rawChapTitle,
      rawBookTitle,
      prevChapter: prevChap,
      onStatus: (msg) => {
        status.style.background = '#fffbeb';
        status.style.color = '#b45309';
        status.innerText = msg;
      }
    });

    // อ่านข้อมูลล่าสุดอีกรอบ เผื่องานอื่นเขียนเรื่องเดียวกันระหว่างรอแปล
    const latestChaps = await dbGetChaptersByBook(targetBookId);
    const latestBook = (await dbGetAllBooks()).find(b => b.bookId === targetBookId);
    const maxOrder = latestChaps.reduce((max, c) => Math.max(max, c.order || 0), 0);
    const isCustom = !!latestBook?.isUserCustomTitle;
    const finalBookTitle = isCustom ? latestBook.title : (result.bookTitle || ctx.title);

    const newChapter = buildChapterRecord({
      bookId: targetBookId,
      order: maxOrder + 1,
      title: result.chapterTitle || rawChapTitle || `ตอนที่ ${maxOrder + 1}`,
      result,
      sourceUrl: url,
      nextUrl
    });
    await dbSaveChapter(newChapter);

    const derivedKey = deriveBookKey(url);
    await dbSaveBook({
      ...(latestBook || {}),
      bookId: targetBookId,
      title: finalBookTitle,
      author: ctx.author,
      genre: ctx.genre,
      sourceLang: ctx.sourceLang,
      // จำตัวตนของเรื่องจาก URL ไว้ให้ลิงก์ตอนอื่นของเรื่องเดียวกันหาเจอ
      sourceKey: latestBook?.sourceKey || (derivedKey.reliable ? derivedKey.key : undefined),
      isUserCustomTitle: isCustom,
      lastChapterId: newChapter.id,
      lastChapterIndex: latestChaps.length,
      lastChapterTitle: newChapter.title,
      totalChapters: maxOrder + 1,
      lastUrl: url,
      updatedAt: Date.now()
    });
    localStorage.setItem('nov_last_book_id', targetBookId);

    await loadBookFromDB(targetBookId, newChapter.id);
    closeModal('import-modal');
  } catch (err) {
    status.style.background = '#fef2f2';
    status.style.color = '#991b1b';
    if (isAbortError(err)) status.innerText = "ยกเลิกการแปลแล้ว";
    // แยก "หน้าเว็บไม่มีอยู่" ออกจาก "ดึงหน้าได้แต่หาเนื้อหาไม่เจอ" เพื่อให้ผู้ใช้รู้ว่าต้องแก้ตรงไหน
    else if (err.message === '404') status.innerText = 'ข้อผิดพลาด: ไม่พบหน้านิยาย (404 Not Found)';
    else if (err.message.includes('ไม่พบเนื้อหา')) status.innerText = 'ข้อผิดพลาด: ดึงหน้าเว็บได้แต่หาเนื้อหานิยายไม่เจอ ลองตั้งค่าโปรไฟล์ของเว็บนี้ที่ ตั้งค่า → 🌐 ตั้งค่าเว็บต้นฉบับ หรือคัดลอกเนื้อหามาวางที่แท็บ "วางข้อความ / ไฟล์"';
    else status.innerText = "ข้อผิดพลาด: " + err.message;
  } finally {
    endTask('import', controller);
    startBtn.disabled = false;
    btnText.innerText = "เริ่มแปลตอนนี้";
  }
}

// ==================== SETTINGS ====================
// ฟอร์มตั้งค่าเก็บร่างของแต่ละ provider ไว้ สลับไปมาได้โดยค่าที่พิมพ์ไม่หาย
let settingsFormProvider = 'gemini';
let settingsDrafts = {};

function readProviderDraftFromStorage(provider) {
  return {
    keys: getProviderKeys(provider).join('\n'),
    model: getProviderModel(provider),
    auxModel: getProviderAuxModel(provider),
    baseUrl: getProviderBaseUrl(provider)
  };
}

function stashSettingsForm() {
  settingsDrafts[settingsFormProvider] = {
    keys: document.getElementById('llm-keys-area').value,
    model: document.getElementById('llm-model-input').value.trim(),
    auxModel: document.getElementById('llm-aux-model-input').value.trim(),
    baseUrl: document.getElementById('llm-baseurl-input').value.trim()
  };
}

function getCachedModels(provider) {
  try {
    const cached = JSON.parse(localStorage.getItem(`nov_cached_models_${provider}`) || '[]');
    return Array.isArray(cached) ? cached : [];
  } catch (e) {
    return [];
  }
}

function populateModelSuggestions(provider, modelsList = null) {
  const list = document.getElementById('llm-model-list');
  const models = [...new Set([...(modelsList || getCachedModels(provider)), ...LLM_PROVIDERS[provider].suggestedModels])];
  list.innerHTML = '';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    list.appendChild(opt);
  });
}

function showSettingsForProvider(provider) {
  settingsFormProvider = provider;
  const meta = LLM_PROVIDERS[provider];
  const draft = settingsDrafts[provider] || readProviderDraftFromStorage(provider);

  document.getElementById('llm-keys-label').innerText = `${meta.label} API Keys (คลังคีย์หมุนเวียน)`;
  const keysArea = document.getElementById('llm-keys-area');
  keysArea.value = draft.keys;
  keysArea.placeholder = `วาง API Key (1 คีย์ต่อ 1 บรรทัด)\n${meta.keyHint}\n${meta.keyHint}`;
  const modelInput = document.getElementById('llm-model-input');
  modelInput.value = draft.model;
  document.getElementById('llm-aux-model-input').value = draft.auxModel || '';
  modelInput.placeholder = meta.defaultModel || 'ชื่อโมเดล เช่น ที่ได้จากปุ่มตรวจเช็กโมเดล';
  document.getElementById('llm-baseurl-input').value = draft.baseUrl || meta.defaultBaseUrl || '';
  document.getElementById('llm-baseurl-group').style.display = provider === 'openai' ? 'block' : 'none';
  document.getElementById('fetch-status-text').style.display = 'none';
  populateModelSuggestions(provider);
}

function onProviderSelectChange() {
  stashSettingsForm();
  showSettingsForProvider(document.getElementById('llm-provider-select').value);
}

function openSettingsModal() {
  settingsDrafts = {};
  const provider = getActiveProvider();
  document.getElementById('llm-provider-select').value = provider;
  showSettingsForProvider(provider);
  openModal('settings-modal');
  renderSafetySettings();
}

async function fetchLiveModels() {
  const provider = document.getElementById('llm-provider-select').value;
  const firstKey = document.getElementById('llm-keys-area').value.split('\n').map(k => k.trim()).find(k => k.length > 5);
  const baseUrl = document.getElementById('llm-baseurl-input').value.trim();
  const statusText = document.getElementById('fetch-status-text');
  const fetchBtn = document.getElementById('fetch-models-btn');

  if (!firstKey) return alert("กรุณากรอก API Key ก่อนกดตรวจเช็กโมเดล");
  if (provider === 'openai' && baseUrl && !isConnectAllowedByCsp(baseUrl)) {
    statusText.style.display = 'block';
    statusText.style.color = '#b45309';
    statusText.innerText = 'Base URL ใหม่นี้ยังไม่ได้รับอนุญาตในหน้านี้ (ระบบความปลอดภัยจำกัดปลายทางที่ส่งข้อมูลได้) กด "บันทึกการตั้งค่า" แล้วรีโหลดหน้าก่อน จึงจะตรวจเช็กได้';
    return;
  }

  fetchBtn.disabled = true;
  fetchBtn.innerText = "กำลังตรวจเช็ก...";
  statusText.style.display = "block";
  statusText.style.color = "#2563eb";
  statusText.innerText = `กำลังเชื่อมต่อไปยัง ${LLM_PROVIDERS[provider].label}...`;

  try {
    const availableModels = await listProviderModels(provider, firstKey, baseUrl);
    if (availableModels.length === 0) throw new Error("ไม่พบโมเดลที่พร้อมใช้งานในบัญชีนี้");

    localStorage.setItem(`nov_cached_models_${provider}`, JSON.stringify(availableModels));
    populateModelSuggestions(provider, availableModels);
    const modelInput = document.getElementById('llm-model-input');
    if (!modelInput.value.trim()) modelInput.value = availableModels[0];

    statusText.style.color = "#16a34a";
    statusText.innerText = `✓ คีย์ใช้งานได้ ตรวจพบโมเดล ${availableModels.length} รุ่น (เลือกได้จากช่องโมเดลด้านล่าง)`;
  } catch (err) {
    statusText.style.color = "#dc2626";
    statusText.innerText = "เกิดข้อผิดพลาด: " + err.message;
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.innerText = "ตรวจเช็กโมเดล";
  }
}

function saveSettings() {
  stashSettingsForm();
  // ต้องเปลี่ยนที่เก็บ key ก่อนบันทึก key ใหม่
  setSessionOnlySecrets(document.getElementById('secrets-session-only').checked);
  localStorage.setItem('nov_backup_remind_days', document.getElementById('backup-remind-days').value);
  Object.entries(settingsDrafts).forEach(([provider, draft]) => {
    const parsedKeys = draft.keys.split('\n').map(k => k.trim()).filter(k => k.length > 5);
    setSecret(`nov_llm_keys_${provider}`, parsedKeys.length ? JSON.stringify(parsedKeys) : '');
    localStorage.setItem(`nov_llm_model_${provider}`, draft.model);
    localStorage.setItem(`nov_llm_aux_model_${provider}`, draft.auxModel || '');
    if (provider === 'openai') localStorage.setItem(`nov_llm_baseurl_${provider}`, draft.baseUrl);
    keyIndexByProvider[provider] = 0;
  });
  const activeProvider = document.getElementById('llm-provider-select').value;
  localStorage.setItem('nov_llm_provider', activeProvider);

  localStorage.setItem('nov_retry_limit', document.getElementById('retry-limit').value || "10");
  localStorage.setItem('nov_enable_deep_ner', document.getElementById('enable-deep-ner-scan').checked ? 'true' : 'false');
  localStorage.setItem('nov_quality_mode', document.getElementById('quality-mode-select').value);
  localStorage.setItem('nov_llm_fallback_provider', document.getElementById('llm-fallback-provider').value);
  localStorage.setItem('nov_enable_infinite', document.getElementById('enable-infinite-scroll').checked ? 'true' : 'false');
  localStorage.setItem('nov_enable_prefetch', document.getElementById('enable-live-prefetch').checked ? 'true' : 'false');
  localStorage.setItem('nov_enable_auto_glossary', document.getElementById('enable-auto-glossary').checked ? 'true' : 'false');
  const showJunk = document.getElementById('show-junk-paras').checked;
  localStorage.setItem('nov_show_junk', showJunk ? 'true' : 'false');
  document.body.classList.toggle('show-junk', showJunk);
  localStorage.setItem('nov_export_notes', document.getElementById('export-include-notes').checked ? 'true' : 'false');

  lastPrefetchError = '';
  closeModal('settings-modal');
  renderVirtualWindow(currentChapterIndex, true);

  renderSafetyBanner();
  const cfg = getActiveLlmConfig();
  const warning = cfg.model ? '' : '\n⚠️ ยังไม่ได้เลือกโมเดล กรุณากด "ตรวจเช็กโมเดล" แล้วเลือกโมเดลก่อนใช้งาน';
  const openaiBase = getProviderBaseUrl('openai');
  const needsReload = openaiBase && !isConnectAllowedByCsp(openaiBase);
  alert(`บันทึกการตั้งค่าเรียบร้อยแล้ว\nใช้งาน ${LLM_PROVIDERS[cfg.provider].label} (${cfg.model || 'ยังไม่เลือกโมเดล'}) — คลัง API Key ${cfg.keys.length} ตัว${warning}`);
  if (needsReload && confirm(`Base URL ใหม่ (${openaiBase}) จะใช้ได้หลังรีโหลดหน้า (ระบบความปลอดภัยอนุญาตปลายทางตอนเปิดหน้าเท่านั้น)\n\nรีโหลดตอนนี้เลยหรือไม่?`)) {
    location.reload();
  }
}

function loadSettings() {
  migrateLegacyLlmSettings();

  if (localStorage.getItem('nov_theme')) {
    const storedTheme = localStorage.getItem('nov_theme');
    currentTheme = ['sepia', 'light', 'dark'].includes(storedTheme) ? storedTheme : 'sepia';
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

  if (localStorage.getItem('nov_font_size')) {
    const storedSize = parseInt(localStorage.getItem('nov_font_size'), 10);
    currentFontSize = Number.isFinite(storedSize) ? Math.min(28, Math.max(14, storedSize)) : 18;
  }

  if (localStorage.getItem('nov_retry_limit')) document.getElementById('retry-limit').value = localStorage.getItem('nov_retry_limit');

  const deepNerChk = document.getElementById('enable-deep-ner-scan');
  if (deepNerChk) deepNerChk.checked = (localStorage.getItem('nov_enable_deep_ner') === 'true');

  const qualitySelect = document.getElementById('quality-mode-select');
  if (qualitySelect) qualitySelect.value = getQualityMode();
  const fallbackSelect = document.getElementById('llm-fallback-provider');
  if (fallbackSelect) fallbackSelect.value = getFallbackProvider();

  const prefetchChk = document.getElementById('enable-live-prefetch');
  if (prefetchChk) prefetchChk.checked = (localStorage.getItem('nov_enable_prefetch') !== 'false');

  const infiniteChk = document.getElementById('enable-infinite-scroll');
  if (infiniteChk) infiniteChk.checked = (localStorage.getItem('nov_enable_infinite') !== 'false');

  const autoGlossChk = document.getElementById('enable-auto-glossary');
  if (autoGlossChk) autoGlossChk.checked = (localStorage.getItem('nov_enable_auto_glossary') !== 'false');

  const showJunk = localStorage.getItem('nov_show_junk') === 'true';
  document.body.classList.toggle('show-junk', showJunk);
  const showJunkChk = document.getElementById('show-junk-paras');
  if (showJunkChk) showJunkChk.checked = showJunk;
  const exportNotesChk = document.getElementById('export-include-notes');
  if (exportNotesChk) exportNotesChk.checked = localStorage.getItem('nov_export_notes') === 'true';
}

// ==================== BACKUP ====================
async function exportBackup() {
  try {
    await downloadBackupFile();
    renderSafetyBanner();
    renderBookshelfBackupNote();
  } catch (err) {
    alert(`สำรองข้อมูลไม่สำเร็จ: ${err.message}`);
  }
}

function triggerBackupImport() {
  document.getElementById('backup-file-input').click();
}

let pendingBackupImport = null;

async function handleBackupFileSelected(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (e) {
    return alert('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูล JSON ที่ถูกต้อง');
  }
  if (!isValidBackup(raw)) return alert('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของ NovelTranslate หรือมาจากแอพรุ่นที่ใหม่กว่า');

  const data = upgradeBackup(raw);
  pendingBackupImport = { raw, data, settings: splitImportedSettings(data.settings), fileName: file.name };
  renderBackupImportModal(await dbCountAll());
  openModal('backup-import-modal');
}

function renderBackupImportModal(current) {
  const { data, settings, fileName } = pendingBackupImport;
  const dropped = Object.values(data.dropped).reduce((a, b) => a + b, 0);
  const exportedAt = data.exportedAt && !isNaN(new Date(data.exportedAt)) ? new Date(data.exportedAt).toLocaleString('th-TH') : '';
  const row = (label, name) => `<tr><td>${label}</td><td>${(current[name] || 0).toLocaleString()}</td><td>${data[name].length.toLocaleString()}</td></tr>`;
  document.getElementById('backup-import-summary').innerHTML = `
    <div style="margin-bottom: 6px;">ไฟล์: <b>${escapeHtml(fileName)}</b>${exportedAt ? ` · สำรองเมื่อ ${escapeHtml(exportedAt)}` : ''}</div>
    <table class="backup-compare-table">
      <thead><tr><th></th><th>ในเครื่องนี้</th><th>ในไฟล์</th></tr></thead>
      <tbody>${row('นิยาย (เรื่อง)', 'books')}${row('ตอน', 'chapters')}${row('คำศัพท์', 'glossaries')}${row('คู่มือเรื่อง / สารบัญ', 'bookData')}${row('สถิติการใช้ AI', 'usage')}</tbody>
    </table>
    ${dropped ? `<div style="color: #b45309; margin-top: 6px;">⚠️ จะข้ามข้อมูลที่เสียหรือรูปแบบไม่ถูกต้อง ${dropped.toLocaleString()} รายการ</div>` : ''}`;

  const settingsCount = Object.keys(settings.safe).length;
  document.getElementById('backup-import-settings-row').style.display = settingsCount ? 'flex' : 'none';
  document.getElementById('backup-import-settings').checked = settingsCount > 0;
  document.getElementById('backup-import-settings-count').innerText = settingsCount;
  document.getElementById('backup-import-baseurl-row').style.display = settings.baseUrl ? 'flex' : 'none';
  document.getElementById('backup-import-baseurl').checked = false;
  document.getElementById('backup-import-baseurl-value').innerText = settings.baseUrl || '';
  document.querySelector('input[name="backup-import-mode"][value="merge"]').checked = true;
  document.getElementById('backup-import-safety').checked = true;
  onBackupImportModeChange();
}

function getBackupImportMode() {
  return document.querySelector('input[name="backup-import-mode"]:checked')?.value === 'replace' ? 'replace' : 'merge';
}

function onBackupImportModeChange() {
  document.getElementById('backup-import-replace-box').style.display = getBackupImportMode() === 'replace' ? 'block' : 'none';
}

async function confirmBackupImport() {
  if (!pendingBackupImport) return;
  const mode = getBackupImportMode();
  if (mode === 'replace' && !confirm('นิยาย ตอน คลังศัพท์ และคู่มือเรื่องทั้งหมดในเครื่องนี้จะถูกลบ แล้วแทนด้วยข้อมูลจากไฟล์\n\nยืนยันหรือไม่?')) return;

  const btn = document.getElementById('backup-import-confirm-btn');
  btn.disabled = true;
  try {
    abortAllRunningProcesses();
    if (mode === 'replace' && document.getElementById('backup-import-safety').checked) {
      await downloadBackupFile('noveltranslate-before-replace');
    }
    const { raw, settings } = pendingBackupImport;
    await dbImportAll(raw, { mode });

    const applySettings = document.getElementById('backup-import-settings').checked;
    const applyBaseUrl = !!settings.baseUrl && document.getElementById('backup-import-baseurl').checked;
    applyImportedSettings(applySettings ? settings.safe : {}, { baseUrl: applyBaseUrl ? settings.baseUrl : null });
    if (applySettings) loadSettings();

    await refreshInMemoryGlossaryCache();
    pendingBackupImport = null;
    closeModal('backup-import-modal');

    const books = await dbGetAllBooks();
    const lastId = localStorage.getItem('nov_last_book_id');
    const targetBookId = books.some(b => b.bookId === lastId) ? lastId : books[0]?.bookId;
    if (targetBookId) await loadBookFromDB(targetBookId);
    else resetToGuideBook();
    await openBookshelfModal();

    const needsReload = applyBaseUrl && !isConnectAllowedByCsp(settings.baseUrl);
    alert(`✓ นำเข้าข้อมูลสำรองเรียบร้อยแล้ว (${mode === 'replace' ? 'แทนที่ทั้งหมด' : 'รวมกับของเดิม'})` +
      (needsReload ? '\n\nBase URL ใหม่จะใช้ได้หลังรีโหลดหน้า' : ''));
  } catch (err) {
    alert(`นำเข้าข้อมูลไม่สำเร็จ (ข้อมูลเดิมไม่ถูกแก้ไข): ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

function cancelBackupImport() {
  pendingBackupImport = null;
  closeModal('backup-import-modal');
}

// ==================== DATA SAFETY UI ====================
let dbOutdatedInThisTab = false;
let remoteReplacedData = false;

function formatAgo(ts) {
  if (!ts) return 'ยังไม่เคย';
  const days = Math.floor((Date.now() - ts) / DAY_MS);
  if (days >= 1) return `${days} วันที่แล้ว`;
  const hours = Math.floor((Date.now() - ts) / 3600000);
  return hours >= 1 ? `${hours} ชั่วโมงที่แล้ว` : 'เมื่อสักครู่';
}

/** แถบแจ้งเตือนด้านบนหน้าอ่าน: ฐานข้อมูลถูกอัปเกรดจากแท็บอื่น > ข้อมูลถูกแทนที่จากแท็บอื่น > เตือนสำรองข้อมูล */
async function renderSafetyBanner() {
  const banner = document.getElementById('safety-banner');
  if (!banner) return;
  let html = '';
  if (dbOutdatedInThisTab) {
    html = `<span>⚠️ มีแท็บอื่นเปิดแอพรุ่นใหม่กว่า แท็บนี้หยุดบันทึกข้อมูลแล้ว</span>
      <button class="btn btn-primary" onclick="location.reload()">รีโหลดหน้า</button>`;
  } else if (remoteReplacedData) {
    html = `<span>⚠️ ข้อมูลทั้งหมดถูกแทนที่จากไฟล์สำรองในอีกแท็บ</span>
      <button class="btn btn-primary" onclick="location.reload()">รีโหลดหน้า</button>`;
  } else if (budgetBannerText) {
    html = `<span>📊 ${escapeHtml(budgetBannerText)}</span>
      <button class="btn btn-primary" onclick="openUsageModal()">ดูการใช้งาน</button>
      <button class="btn" onclick="dismissBudgetBanner()">ปิด</button>`;
  } else {
    const state = getBackupReminderState();
    if (state.shouldRemind && (await dbGetAllBooks()).length) {
      const hasFolder = !!(await getAutoBackupDir());
      const ios = isIosDevice() && !isInstalledApp() ? ' · บน iPhone/iPad ข้อมูลอาจถูกลบถ้าไม่ได้เปิดแอพ 7 วัน แนะนำให้ "เพิ่มลงหน้าจอโฮม"' : '';
      html = `<span>💾 ${state.lastBackup ? `ไม่ได้สำรองข้อมูลมา ${state.daysSinceBackup} วัน` : 'ยังไม่เคยสำรองข้อมูล'} และมีข้อมูลใหม่ที่ยังไม่ได้สำรอง${ios}</span>
        <button class="btn btn-primary" onclick="backupNowFromBanner()">${hasFolder ? '💾 สำรองลงโฟลเดอร์' : '⬇️ สำรองตอนนี้'}</button>
        <button class="btn" onclick="snoozeBackupReminder(1); renderSafetyBanner();">เตือนพรุ่งนี้</button>`;
    }
  }
  banner.innerHTML = html;
  banner.style.display = html ? 'flex' : 'none';
}

async function backupNowFromBanner() {
  try {
    if (await getAutoBackupDir()) {
      const result = await runAutoBackup({ interactive: true });
      if (result !== 'done') await downloadBackupFile();
    } else {
      await downloadBackupFile();
    }
    showGlobalToast('✓ สำรองข้อมูลแล้ว');
    setTimeout(hideGlobalToast, 1800);
  } catch (err) {
    alert(`สำรองข้อมูลไม่สำเร็จ: ${err.message}`);
  }
  renderSafetyBanner();
  renderBookshelfBackupNote();
}

function renderBookshelfBackupNote() {
  const el = document.getElementById('bookshelf-backup-note');
  if (!el) return;
  const state = getBackupReminderState();
  el.innerText = `สำรองครั้งล่าสุด: ${formatAgo(state.lastBackup)}${state.hasUnsaved ? ' · มีข้อมูลใหม่ที่ยังไม่ได้สำรอง' : ''}`;
  el.style.color = state.shouldRemind ? '#b45309' : '';
}

/** ส่วน "ข้อมูลและความปลอดภัย" ในหน้าตั้งค่า */
async function renderSafetySettings() {
  const st = await getStorageStatus();
  const statusEl = document.getElementById('storage-status');
  const persistBtn = document.getElementById('persist-storage-btn');
  const lines = [];
  if (st.persisted === true) lines.push('✅ พื้นที่จัดเก็บแบบถาวร (เบราว์เซอร์จะไม่ลบข้อมูลเองเมื่อพื้นที่ใกล้เต็ม)');
  else if (st.persisted === false) lines.push('⚠️ พื้นที่จัดเก็บยังไม่ถาวร เบราว์เซอร์อาจลบข้อมูลเองเมื่อพื้นที่เครื่องใกล้เต็ม');
  else lines.push('เบราว์เซอร์นี้ไม่บอกสถานะพื้นที่จัดเก็บ');
  if (st.usage !== null) lines.push(`ใช้พื้นที่ไป ${formatBytes(st.usage)}${st.quota ? ` จากที่ใช้ได้ประมาณ ${formatBytes(st.quota)}` : ''}`);
  if (st.iosNotInstalled) lines.push('⚠️ บน iPhone/iPad ถ้าไม่ได้ "เพิ่มลงหน้าจอโฮม" Safari อาจลบข้อมูลเมื่อไม่ได้เปิดแอพ 7 วัน');
  lines.push(`สำรองครั้งล่าสุด: ${formatAgo(readTimestamp('nov_last_backup_at'))}`);
  statusEl.innerHTML = lines.map(l => `<div>${escapeHtml(l)}</div>`).join('');
  persistBtn.style.display = st.persisted === false ? 'inline-flex' : 'none';

  document.getElementById('backup-remind-days').value = String(getBackupRemindDays());
  document.getElementById('secrets-session-only').checked = isSessionOnlySecrets();
  await renderAutoBackupSettings();
}

async function renderAutoBackupSettings() {
  const statusEl = document.getElementById('auto-backup-status');
  const actionsEl = document.getElementById('auto-backup-actions');
  if (!isAutoBackupSupported()) {
    statusEl.innerText = 'เบราว์เซอร์นี้ไม่รองรับ (ใช้ได้กับ Chrome / Edge บนคอมพิวเตอร์) ใช้ปุ่ม "สำรองข้อมูลทั้งหมด" ที่ชั้นหนังสือแทน และระบบจะเตือนเมื่อถึงเวลาสำรอง';
    actionsEl.innerHTML = '';
    return;
  }
  const dir = await getAutoBackupDir();
  if (!dir) {
    statusEl.innerText = 'ยังไม่ได้เลือกโฟลเดอร์ เมื่อเลือกแล้ว ระบบจะบันทึกไฟล์สำรองลงโฟลเดอร์นั้นเองเมื่อมีข้อมูลใหม่ (เก็บไว้ 5 ไฟล์ล่าสุด)';
    actionsEl.innerHTML = `<button class="btn btn-secondary" onclick="setupAutoBackupFolder()">📁 เลือกโฟลเดอร์สำรอง</button>`;
    return;
  }
  statusEl.innerText = `โฟลเดอร์: ${dir.name} · สำรองอัตโนมัติครั้งล่าสุด: ${formatAgo(readTimestamp('nov_last_auto_backup_at'))} (เก็บไว้ 5 ไฟล์ล่าสุด หลังเปิดเบราว์เซอร์ใหม่อาจต้องกดอนุญาตอีกครั้ง)`;
  actionsEl.innerHTML = `
    <button class="btn btn-secondary" onclick="runAutoBackupFromSettings()">💾 สำรองตอนนี้</button>
    <button class="btn" onclick="setupAutoBackupFolder()">เปลี่ยนโฟลเดอร์</button>
    <button class="btn btn-danger" onclick="stopAutoBackup()">เลิกใช้</button>`;
}

async function setupAutoBackupFolder() {
  try {
    await chooseAutoBackupFolder();
    const result = await runAutoBackup({ interactive: true });
    if (result === 'done') alert('✓ ตั้งค่าโฟลเดอร์และสำรองข้อมูลครั้งแรกเรียบร้อย');
  } catch (err) {
    if (err?.name !== 'AbortError') alert(`ตั้งค่าโฟลเดอร์สำรองไม่สำเร็จ: ${err.message}`);
  }
  await renderAutoBackupSettings();
  renderSafetyBanner();
}

async function runAutoBackupFromSettings() {
  try {
    const result = await runAutoBackup({ interactive: true });
    if (result === 'needs-permission') alert('ยังไม่ได้รับอนุญาตให้เขียนโฟลเดอร์ กรุณากดอนุญาตเมื่อเบราว์เซอร์ถาม');
    else if (result === 'done') alert('✓ สำรองข้อมูลลงโฟลเดอร์แล้ว');
  } catch (err) {
    alert(`สำรองไม่สำเร็จ: ${err.message}`);
  }
  await renderAutoBackupSettings();
  renderSafetyBanner();
}

async function stopAutoBackup() {
  await disableAutoBackup();
  await renderAutoBackupSettings();
}

async function requestPersistFromSettings() {
  const ok = await requestPersistentStorage();
  if (!ok) alert('เบราว์เซอร์ยังไม่อนุญาตพื้นที่ถาวร (Chrome จะอนุญาตเองเมื่อใช้งานบ่อยหรือติดตั้งเป็นแอพ) แนะนำให้สำรองข้อมูลเป็นระยะ');
  await renderSafetySettings();
}

function clearAllApiKeys() {
  if (!confirm('ลบ API Key ของผู้ให้บริการ AI ทุกเจ้าและ Jina Key ออกจากเบราว์เซอร์นี้?\n(นิยายและการตั้งค่าอื่นยังอยู่ครบ)')) return;
  clearAllSecrets();
  settingsDrafts = {};
  showSettingsForProvider(document.getElementById('llm-provider-select').value);
  alert('ลบ API Key ทั้งหมดแล้ว');
}

// ==================== AI USAGE DASHBOARD ====================
let budgetBannerText = '';

/** hook จาก usage.js: เกินเพดานแล้วแต่ผู้ใช้กดแปลเอง */
function askBudgetOverride(message) {
  return confirm(message);
}

/** hook จาก usage.js: ใช้ไปแล้ว 80% ของเพดาน */
function notifyBudgetWarning(message) {
  budgetBannerText = message;
  renderSafetyBanner();
}

function dismissBudgetBanner() {
  budgetBannerText = '';
  renderSafetyBanner();
}

function usageCardHtml(label, t, unitPrices) {
  const cachePct = t.input ? Math.round(t.cacheRead / t.input * 100) : 0;
  const costText = t.cost > 0 || !t.unpricedTokens ? `~$${t.cost.toFixed(t.cost < 1 ? 3 : 2)}` : '—';
  return `<div class="usage-card">
    <div class="usage-card-label">${label}</div>
    <div class="usage-card-main">${formatTokenCount(t.tokens)} <span>token</span></div>
    <div class="usage-card-sub">ส่ง ${formatTokenCount(t.input)} · รับ ${formatTokenCount(t.output)} · ${t.calls.toLocaleString()} ครั้ง</div>
    <div class="usage-card-sub">อ่านจาก cache ${cachePct}% · ค่าใช้จ่าย ${costText}${t.unpricedTokens && unitPrices ? ' (บางโมเดลยังไม่กรอกราคา)' : ''}</div>
  </div>`;
}

function groupUsage(records, keyFn) {
  const groups = new Map();
  records.forEach(r => {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  return [...groups.entries()].map(([key, list]) => ({ key, total: sumUsage(list) })).sort((a, b) => b.total.tokens - a.total.tokens);
}

async function openUsageModal() {
  openModal('usage-modal');
  await renderUsageDashboard();
}

async function renderUsageDashboard() {
  const totals = await getUsageTotals();
  const budget = getBudgetSettings();
  const state = evaluateBudget(totals, budget);
  const prices = getModelPrices();

  document.getElementById('usage-summary').innerHTML =
    usageCardHtml('วันนี้', totals.day, true) + usageCardHtml('เดือนนี้', totals.month, true);

  const statusEl = document.getElementById('usage-budget-status');
  if (!budget.daily && !budget.monthly) {
    statusEl.innerHTML = '<span style="opacity: 0.7;">ยังไม่ได้ตั้งเพดาน</span>';
  } else {
    const w = state.worst;
    const color = state.level === 'over' ? '#dc2626' : (state.level === 'warn' ? '#b45309' : '#16a34a');
    statusEl.innerHTML = `<span style="color: ${color}; font-weight: 600;">${state.level === 'over' ? '⛔ เกินเพดานแล้ว' : (state.level === 'warn' ? '⚠️ ใกล้ถึงเพดาน' : '✓ ยังไม่ถึงเพดาน')}</span>
      — ${escapeHtml(w.period)}ใช้ไป ${escapeHtml(formatBudgetAmount(w.used, state.unit))} จาก ${escapeHtml(formatBudgetAmount(w.limit, state.unit))} (${Math.round(w.ratio * 100)}%)
      ${state.unpricedWarning ? '<div style="color: #b45309;">บางโมเดลยังไม่กรอกราคา ยอดเงินจึงต่ำกว่าความจริง (กรอกราคาด้านล่าง หรือเปลี่ยนหน่วยเพดานเป็น token)</div>' : ''}`;
  }
  document.getElementById('budget-unit').value = budget.unit;
  document.getElementById('budget-daily').value = budget.daily || '';
  document.getElementById('budget-monthly').value = budget.monthly || '';
  updateBudgetUnitHint();

  const tableRows = (groups, labelFn) => groups.length
    ? groups.map(g => `<tr><td>${labelFn(g.key)}</td><td>${formatTokenCount(g.total.input)}</td><td>${formatTokenCount(g.total.output)}</td><td>${g.total.input ? Math.round(g.total.cacheRead / g.total.input * 100) : 0}%</td><td>${g.total.unpricedTokens ? '—' : '$' + g.total.cost.toFixed(g.total.cost < 1 ? 3 : 2)}</td></tr>`).join('')
    : '<tr><td colspan="5" style="opacity: 0.6; text-align: center;">ยังไม่มีการใช้งานในเดือนนี้</td></tr>';
  const head = '<thead><tr><th></th><th>ส่ง</th><th>รับ</th><th>cache</th><th>เงิน</th></tr></thead>';

  const byModel = groupUsage(totals.records, r => `${r.provider}|${r.model}`);
  document.getElementById('usage-by-model').innerHTML = `<table class="backup-compare-table">${head}<tbody>${tableRows(byModel, k => {
    const [provider, model] = k.split('|');
    return `${escapeHtml(model)} <span style="opacity: 0.55;">(${escapeHtml(LLM_PROVIDERS[provider]?.label || provider)})</span>`;
  })}</tbody></table>`;

  const books = await dbGetAllBooks();
  const titleOf = id => id ? (books.find(b => b.bookId === id)?.title || 'เรื่องที่ลบไปแล้ว') : 'งานทั่วไป (ไม่ผูกกับเรื่อง)';
  const byBook = groupUsage(totals.records, r => r.bookId || '').slice(0, 10);
  document.getElementById('usage-by-book').innerHTML = `<table class="backup-compare-table">${head}<tbody>${tableRows(byBook, k => escapeHtml(titleOf(k)))}</tbody></table>`;

  // 14 วันล่าสุด
  const all = await dbGetAllUsage();
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(localDayKey(new Date(Date.now() - i * DAY_MS)));
  const perDay = days.map(d => sumUsage(all.filter(r => r.day === d)).tokens);
  const max = Math.max(1, ...perDay);
  document.getElementById('usage-days').innerHTML = days.map((d, i) => `
    <div class="usage-day" title="${d}: ${formatTokenCount(perDay[i])} token">
      <div class="usage-day-bar" style="height: ${Math.round(perDay[i] / max * 100)}%;"></div>
      <div class="usage-day-label">${Number(d.slice(8))}</div>
    </div>`).join('');

  // ราคาของโมเดลที่ใช้เดือนนี้ + โมเดลที่ตั้งไว้ตอนนี้
  const models = new Map();
  byModel.forEach(g => { const [provider, model] = g.key.split('|'); models.set(model, provider); });
  Object.keys(LLM_PROVIDERS).forEach(p => {
    [getProviderModel(p), getProviderAuxModel(p)].filter(Boolean).forEach(m => { if (!models.has(m) && getProviderKeys(p).length) models.set(m, p); });
  });
  Object.keys(prices).forEach(m => { if (!models.has(m)) models.set(m, ''); });
  const priceVal = v => Number.isFinite(v) ? v : '';
  document.getElementById('usage-prices').innerHTML = [...models.entries()].map(([model, provider]) => {
    const p = prices[model] || {};
    return `<div class="usage-price-row" data-model="${escapeHtml(model)}">
      <div class="usage-price-model">${escapeHtml(model)}${provider ? ` <span style="opacity: 0.55;">(${escapeHtml(LLM_PROVIDERS[provider]?.label || provider)})</span>` : ''}</div>
      <input type="number" min="0" step="0.01" class="form-input" data-field="in" placeholder="input" value="${priceVal(p.in)}">
      <input type="number" min="0" step="0.01" class="form-input" data-field="out" placeholder="output" value="${priceVal(p.out)}">
      <input type="number" min="0" step="0.001" class="form-input" data-field="cached" placeholder="cache" value="${priceVal(p.cached)}">
    </div>`;
  }).join('') || '<div style="opacity: 0.6;">ยังไม่มีโมเดลที่ใช้งาน</div>';

  // คำขอที่ผู้ให้บริการอาจคิดเงินแต่แอพไม่ได้ยอดกลับมา (ถูกยกเลิกกลางทาง / เชื่อมต่อหลุด)
  const reqs = await getRequestLog();
  const noUsage = reqs.filter(r => !r.usage);
  const aborted = noUsage.filter(r => r.kind === 'abort').length;
  const netFail = noUsage.filter(r => ['network', 'server', 'truncated', 'empty'].includes(r.kind)).length;
  document.getElementById('request-log-summary').innerText = reqs.length
    ? `คำขอล่าสุด ${reqs.length} ครั้ง: ได้ยอด token กลับมา ${reqs.length - noUsage.length} ครั้ง · ไม่ได้ยอดกลับมา ${noUsage.length} ครั้ง (ถูกยกเลิกกลางทาง ${aborted}, เชื่อมต่อหลุด/เซิร์ฟเวอร์ผิดพลาด ${netFail}) — คำขอที่ไม่ได้ยอดกลับมา ผู้ให้บริการอาจยังคิดค่า token ขาเข้าอยู่`
    : 'ยังไม่มีบันทึกคำขอ';

  try { renderGeminiOverheadResult(JSON.parse(localStorage.getItem('nov_gemini_overhead_test') || 'null')); } catch (e) {}

  const log = await getDiagnosticLog();
  document.getElementById('diag-log-count').innerText = log.length;
  document.getElementById('diag-log-recent').innerHTML = log.slice(-8).reverse().map(e =>
    `<div class="diag-entry"><b>${escapeHtml(new Date(e.at).toLocaleString('th-TH'))}</b> · ${escapeHtml(e.source)}/${escapeHtml(e.kind)}${e.model ? ` · ${escapeHtml(e.model)}` : ''}${e.task ? ` · ${escapeHtml(e.task)}` : ''}<div>${escapeHtml(e.message)}</div></div>`
  ).join('') || '<div style="opacity: 0.6;">ยังไม่มีข้อผิดพลาด</div>';
}

function updateBudgetUnitHint() {
  const unit = document.getElementById('budget-unit').value;
  document.getElementById('budget-unit-hint').innerText = unit === 'usd'
    ? 'หน่วยเป็นดอลลาร์สหรัฐ (คิดจากราคาที่กรอกด้านล่าง) เช่น 1 = $1'
    : 'หน่วยเป็นจำนวน token (ส่ง + รับ) เช่น 2000000 = 2M token';
}

async function saveBudgetSettings() {
  const read = id => {
    const n = parseFloat(document.getElementById(id).value);
    return Number.isFinite(n) && n > 0 ? String(n) : '';
  };
  localStorage.setItem('nov_budget_unit', document.getElementById('budget-unit').value);
  localStorage.setItem('nov_budget_daily', read('budget-daily'));
  localStorage.setItem('nov_budget_monthly', read('budget-monthly'));
  budgetBannerText = '';
  renderSafetyBanner();
  await renderUsageDashboard();
  showGlobalToast('✓ บันทึกเพดานแล้ว');
  setTimeout(hideGlobalToast, 1500);
}

async function saveModelPricesFromForm() {
  const prices = getModelPrices();
  document.querySelectorAll('#usage-prices .usage-price-row').forEach(row => {
    const model = row.dataset.model;
    const entry = {};
    row.querySelectorAll('input').forEach(inp => {
      const n = parseFloat(inp.value);
      if (Number.isFinite(n) && n >= 0) entry[inp.dataset.field] = n;
    });
    if (Number.isFinite(entry.in) && Number.isFinite(entry.out)) prices[model] = entry;
    else delete prices[model];
  });
  saveModelPrices(prices);
  await renderUsageDashboard();
  showGlobalToast('✓ บันทึกราคาแล้ว');
  setTimeout(hideGlobalToast, 1500);
}

function renderGeminiOverheadResult(r) {
  const el = document.getElementById('gemini-overhead-result');
  if (!el || !r) return;
  if (r.error) {
    el.innerHTML = `<span style="color: #dc2626;">ตรวจไม่สำเร็จ: ${escapeHtml(r.error)}</span>`;
    return;
  }
  const rows = Object.entries(r.schemas).map(([name, n]) => `${escapeHtml(name)} +${n.toLocaleString()}`).join(' · ');
  el.innerHTML = `ผลตรวจ (${escapeHtml(r.model)}, ${escapeHtml(new Date(r.at).toLocaleString('th-TH'))}):<br>
    ข้อความทดสอบ ${r.base.toLocaleString()} token · system prompt +${r.systemTokens.toLocaleString()} · โหมด JSON +${r.jsonModeTokens.toLocaleString()}<br>
    JSON schema แต่ละแบบเพิ่ม: ${rows}`;
}

async function runGeminiOverheadTest() {
  const el = document.getElementById('gemini-overhead-result');
  el.innerHTML = '<span class="spinner-icon"></span> กำลังตรวจ...';
  let result;
  try {
    result = { ...(await measureGeminiOverhead()), at: new Date().toISOString() };
  } catch (err) {
    result = { error: err.message, at: new Date().toISOString() };
  }
  localStorage.setItem('nov_gemini_overhead_test', JSON.stringify(result));
  renderGeminiOverheadResult(result);
}

async function exportDiagnosticLog() {
  const report = await buildDiagnosticReport();
  downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `noveltranslate-diagnostics-${backupFileStamp()}.json`);
}

async function clearDiagnosticLogFromUi() {
  if (!confirm('ล้างบันทึกข้อผิดพลาดทั้งหมด?')) return;
  await clearDiagnosticLog();
  await renderUsageDashboard();
}

async function clearUsageHistory() {
  if (!confirm('ล้างสถิติการใช้งาน AI ทั้งหมด (รวมค่าเฉลี่ยต่อตอนที่ใช้ประมาณก่อนแปลล่วงหน้า)?\nเพดานที่ตั้งไว้จะเริ่มนับใหม่จากศูนย์')) return;
  await dbClearUsage();
  await renderUsageDashboard();
}

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
    if (document.getElementById('bookshelf-modal')?.classList.contains('active')) {
      const bookIds = [...new Set(changes.map(c => c.bookId).filter(Boolean))];
      if (changes.some(c => c.kind === 'books' && !c.bookId) || !bookIds.length) await openBookshelfModal();
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

function exportTxt() {
  const chap = chapters[currentChapterIndex];
  let txt = `${currentBookTitle}\n${chap.title}\n\n`;
  chap.paragraphs.forEach(p => { txt += p.th + "\n\n"; });
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${chap.title}.txt`;
  a.click();
}

// ==================== PWA ====================
let deferredInstallPrompt = null;

function setupPwa() {
  const isSecure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && isSecure) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker registration failed:', err));
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.getElementById('install-app-btn').style.display = 'inline-flex';
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.getElementById('install-app-btn').style.display = 'none';
  });
}

async function promptInstallApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  document.getElementById('install-app-btn').style.display = 'none';
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
  setupSelectionMonitor();
  setupScrollMonitor();
  setupFullscreenListener();
  setupPopoverDelegation();

  const lastBookId = localStorage.getItem('nov_last_book_id');
  if (lastBookId) {
    await loadBookFromDB(lastBookId);
  } else {
    renderVirtualWindow(0, true);
  }
  initSafetyOnStartup();
});
