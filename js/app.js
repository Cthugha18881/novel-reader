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
    title: "คู่มือเริ่มต้น v2.7.0",
    paragraphs: [
      { th: "ยินดีต้อนรับสู่ NovelTranslate AI v2.7.0", src: "欢迎来到 NovelTranslate" },
      { th: "ระบบได้ทำการแยกโครงสร้างโค้ดเป็น Modular Architecture เรียบร้อยแล้ว", src: "已完全重构为模块化架构" }
    ],
    summary: "ผู้ใช้เริ่มต้นใช้งาน NovelTranslate AI v2.7.0"
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
  const wasFullscreen = body.classList.contains('is-fullscreen');
  body.className = 'theme-' + currentTheme;
  if (wasFullscreen) body.classList.add('is-fullscreen');

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

function buildChapterBlockHtml(chap, chapIdx, activeTerms) {
  let parasHtml = '';
  chap.paragraphs.forEach((p, pIdx) => {
    const highlightedTh = applyInlineTermHighlighting(p.th || "", activeTerms);
    parasHtml += `
      <div class="para-item" id="para-box-${chapIdx}-${pIdx}">
        <div class="para-th" onclick="toggleParagraphSrc(event, '${chapIdx}-${pIdx}')" data-unique-key="${chapIdx}-${pIdx}" data-th="${escapeHtml(encodeURIComponent(p.th || ''))}" data-src="${escapeHtml(encodeURIComponent(p.src || ''))}">${highlightedTh}</div>
        <div class="para-src" id="src-${chapIdx}-${pIdx}">${escapeHtml(p.src || "ไม่มีข้อความต้นฉบับ")}</div>
      </div>
    `;
  });

  return `
      <div class="chapter-block" id="chapter-block-${chapIdx}" data-index="${chapIdx}" data-id="${escapeHtml(chap.id)}">
      <div class="chapter-block-divider">
        <span class="chapter-divider-pill">📖 ${escapeHtml(chap.title)}</span>
      </div>
      <div class="chapter-body">${parasHtml}</div>
    </div>
  `;
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
      isSelectedChinese = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uD840-\uD87F][\uDC00-\uDFFF]?/.test(text);

      const tag = document.getElementById('sel-tag-label');
      const preview = document.getElementById('sel-preview-text');
      const pairBtn = document.getElementById('reverse-pair-btn');

      tag.innerText = isSelectedChinese ? "คำจีนที่เลือก:" : "คำไทยที่เลือก:";
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
  const rawText = chapter.paragraphs.map(p => p.src || '').filter(Boolean).join('\n\n');
  if (!rawText) return alert('บทนี้ไม่มีต้นฉบับภาษาจีน จึงแปลใหม่ไม่ได้');

  if (isTaskRunning('retranslate')) return alert('กำลังแปลบทอื่นใหม่อยู่ กรุณารอให้เสร็จก่อน');

  const books = await dbGetAllBooks();
  const bookId = chapter.bookId || currentBookId;
  const ctx = makeBookContext(books.find(item => item.bookId === bookId) || getCurrentBookContext());
  const controller = beginTask('retranslate');
  showGlobalToast(`กำลังแปล "${chapter.title}" ใหม่...`);
  try {
    // ใช้ summary ของบทก่อนหน้าเป็นบริบท (ไม่ใช่ summary ของบทตัวเอง)
    const bookChaps = await dbGetChaptersByBook(bookId);
    const prevChap = bookChaps
      .filter(c => (c.order || 0) < (chapter.order || 0))
      .sort((a, b) => b.order - a.order)[0];
    const result = await translateChapter(rawText, ctx, {
      signal: controller.signal,
      onStatus: showGlobalToast,
      prevSummary: prevChap?.summary || ''
    });
    chapter.paragraphs = result.paragraphs;
    chapter.summary = result.summary || chapter.summary || '';
    chapter.translationMeta = result.translationMeta;
    await dbSaveChapter(chapter);
    const activeCopy = chapters.find(item => item.id === chapId);
    if (activeCopy) {
      activeCopy.paragraphs = chapter.paragraphs;
      activeCopy.summary = chapter.summary;
      activeCopy.translationMeta = chapter.translationMeta;
    }
    if (currentBookId === bookId) await renderVirtualWindow(currentChapterIndex);
    await refreshShelfViewOnly(bookId);
    alert(`แปล "${chapter.title}" ใหม่และบันทึกแล้ว`);
  } catch (err) {
    if (!isAbortError(err)) alert(`แปลบทใหม่ไม่สำเร็จ: ${err.message}`);
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
    const prompt = `จับคู่คำแปลไทยที่ผู้ใช้อ่านเลือกกับข้อความจีนในย่อหน้าต้นฉบับ โดยคืนเฉพาะคำหรือวลีจีนที่ตรงกันและปรากฏต่อเนื่องในต้นฉบับ ห้ามเดาคำที่ไม่มีอยู่\nข้อความที่เลือก: ${JSON.stringify(selectedWordBuffer)}\nย่อหน้าไทย: ${JSON.stringify(th)}\nต้นฉบับจีน: ${JSON.stringify(src)}\nตอบ JSON เท่านั้น: {"src":"วลีจีนที่พบ"}`;
    const answer = await callLLMJson(prompt, { maxRetries: 3, schema: SCHEMAS.findSource });
    const candidate = (typeof answer?.src === 'string' ? answer.src : '').trim();
    if (!candidate || !src.includes(candidate)) throw new Error('ไม่พบวลีจีนที่ตรงกับต้นฉบับ');

    const srcEl = document.getElementById(`src-${selectedParagraphContext.uniqueKey}`);
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
    alert(`ค้นหาคำจีนไม่สำเร็จ: ${err.message}`);
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
  const ctx = getCurrentBookContext();
  const requestBookId = ctx.bookId;
  checkAndRefreshBottomStatus();

  try {
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

    const { text, nextUrl, rawChapTitle, rawBookTitle, author } = await scrapePage(targetUrl, signal);
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
      prevSummary: lastChap?.summary || "",
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
    endTask('prefetch', controller);
    if (!isTaskRunning('prefetch')) isPrefetching = false;
    checkAndRefreshBottomStatus();
  }
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

  try {
    const { text, nextUrl, rawChapTitle, rawBookTitle, author } = await scrapePage(chapterUrl, signal);
    if (author) ctx.author = author;

    const lastChap = chapters[chapters.length - 1];
    const result = await translateChapter(text, ctx, {
      signal,
      rawChapTitle,
      rawBookTitle,
      prevSummary: lastChap?.summary || "",
      onStatus: (msg) => { btnText.innerText = msg.substring(0, 30) + "..."; }
    });

    const currentAll = await dbGetChaptersByBook(ctx.bookId);
    let newChap = currentAll.find(c => sameSourceUrl(c.sourceUrl, chapterUrl));
    if (!newChap) {
      const maxOrder = currentAll.reduce((max, c) => Math.max(max, c.order || 0), 0);
      newChap = buildChapterRecord({
        bookId: ctx.bookId,
        order: maxOrder + 1,
        title: result.chapterTitle || rawChapTitle || `ตอนที่ ${maxOrder + 1}`,
        result,
        sourceUrl: chapterUrl,
        nextUrl
      });
      await dbSaveChapter(newChap);
    }

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
  refreshImportTargetOptions(preferBookId);
  openModal('import-modal');
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

    const { text, nextUrl, rawChapTitle, rawBookTitle, author } = await scrapePage(url, signal);
    const ctx = makeBookContext({
      bookId: targetBookId,
      title: existingBook?.title || rawBookTitle || 'นิยายเรื่องใหม่',
      author: author || existingBook?.author || '',
      genre: existingBook?.genre || chosenGenre,
      sourceLang: existingBook?.sourceLang
    });

    status.innerText = `พบ "${rawChapTitle}" กำลังวิเคราะห์ชื่อเฉพาะและแปลผ่าน AI...`;

    const prevChap = existingChaps.reduce((best, c) => (!best || (c.order || 0) > (best.order || 0)) ? c : best, null);
    const result = await translateChapter(text, ctx, {
      signal,
      rawChapTitle,
      rawBookTitle,
      prevSummary: prevChap?.summary || "",
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
    else status.innerText = "ข้อผิดพลาด: " + (isMissingPageError(err) ? 'ไม่พบหน้านิยาย (404 Not Found)' : err.message);
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
    baseUrl: getProviderBaseUrl(provider)
  };
}

function stashSettingsForm() {
  settingsDrafts[settingsFormProvider] = {
    keys: document.getElementById('llm-keys-area').value,
    model: document.getElementById('llm-model-input').value.trim(),
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
}

async function fetchLiveModels() {
  const provider = document.getElementById('llm-provider-select').value;
  const firstKey = document.getElementById('llm-keys-area').value.split('\n').map(k => k.trim()).find(k => k.length > 5);
  const baseUrl = document.getElementById('llm-baseurl-input').value.trim();
  const statusText = document.getElementById('fetch-status-text');
  const fetchBtn = document.getElementById('fetch-models-btn');

  if (!firstKey) return alert("กรุณากรอก API Key ก่อนกดตรวจเช็กโมเดล");

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
  Object.entries(settingsDrafts).forEach(([provider, draft]) => {
    const parsedKeys = draft.keys.split('\n').map(k => k.trim()).filter(k => k.length > 5);
    localStorage.setItem(`nov_llm_keys_${provider}`, JSON.stringify(parsedKeys));
    localStorage.setItem(`nov_llm_model_${provider}`, draft.model);
    if (provider === 'openai') localStorage.setItem(`nov_llm_baseurl_${provider}`, draft.baseUrl);
    keyIndexByProvider[provider] = 0;
  });
  const activeProvider = document.getElementById('llm-provider-select').value;
  localStorage.setItem('nov_llm_provider', activeProvider);

  localStorage.setItem('nov_retry_limit', document.getElementById('retry-limit').value || "10");
  localStorage.setItem('nov_enable_deep_ner', document.getElementById('enable-deep-ner-scan').checked ? 'true' : 'false');
  localStorage.setItem('nov_verify_mode', document.getElementById('verify-mode-select').value);
  localStorage.setItem('nov_enable_infinite', document.getElementById('enable-infinite-scroll').checked ? 'true' : 'false');
  localStorage.setItem('nov_enable_prefetch', document.getElementById('enable-live-prefetch').checked ? 'true' : 'false');
  localStorage.setItem('nov_enable_auto_glossary', document.getElementById('enable-auto-glossary').checked ? 'true' : 'false');

  lastPrefetchError = '';
  closeModal('settings-modal');
  renderVirtualWindow(currentChapterIndex, true);

  const cfg = getActiveLlmConfig();
  const warning = cfg.model ? '' : '\n⚠️ ยังไม่ได้เลือกโมเดล กรุณากด "ตรวจเช็กโมเดล" แล้วเลือกโมเดลก่อนใช้งาน';
  alert(`บันทึกการตั้งค่าเรียบร้อยแล้ว\nใช้งาน ${LLM_PROVIDERS[cfg.provider].label} (${cfg.model || 'ยังไม่เลือกโมเดล'}) — คลัง API Key ${cfg.keys.length} ตัว${warning}`);
}

function loadSettings() {
  migrateLegacyLlmSettings();

  if (localStorage.getItem('nov_theme')) {
    const storedTheme = localStorage.getItem('nov_theme');
    currentTheme = ['sepia', 'light', 'dark'].includes(storedTheme) ? storedTheme : 'sepia';
    document.getElementById('app-body').className = 'theme-' + currentTheme;
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

  const verifySelect = document.getElementById('verify-mode-select');
  if (verifySelect) verifySelect.value = getVerifyMode();

  const prefetchChk = document.getElementById('enable-live-prefetch');
  if (prefetchChk) prefetchChk.checked = (localStorage.getItem('nov_enable_prefetch') !== 'false');

  const infiniteChk = document.getElementById('enable-infinite-scroll');
  if (infiniteChk) infiniteChk.checked = (localStorage.getItem('nov_enable_infinite') !== 'false');

  const autoGlossChk = document.getElementById('enable-auto-glossary');
  if (autoGlossChk) autoGlossChk.checked = (localStorage.getItem('nov_enable_auto_glossary') !== 'false');
}

// ==================== BACKUP ====================
async function exportBackup() {
  try {
    const data = await dbExportAll();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `noveltranslate-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    alert(`สำรองข้อมูลไม่สำเร็จ: ${err.message}`);
  }
}

function triggerBackupImport() {
  document.getElementById('backup-file-input').click();
}

async function handleBackupFileSelected(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    return alert('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูล JSON ที่ถูกต้อง');
  }
  if (!isValidBackup(data)) return alert('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของ NovelTranslate');

  const msg = `พบข้อมูลในไฟล์สำรอง:\n- นิยาย ${data.books.length} เรื่อง\n- ตอน ${data.chapters.length} ตอน\n- คำศัพท์ ${data.glossaries.length} คำ\n\nข้อมูลที่มีอยู่แล้วและซ้ำกับในไฟล์จะถูกเขียนทับ ต้องการนำเข้าใช่หรือไม่?`;
  if (!confirm(msg)) return;

  try {
    abortAllRunningProcesses();
    await dbImportAll(data);
    await refreshInMemoryGlossaryCache();
    const targetBookId = localStorage.getItem('nov_last_book_id') || data.books[0]?.bookId;
    if (targetBookId) await loadBookFromDB(targetBookId);
    await openBookshelfModal();
    alert('✓ นำเข้าข้อมูลสำรองเรียบร้อยแล้ว');
  } catch (err) {
    alert(`นำเข้าข้อมูลไม่สำเร็จ: ${err.message}`);
  }
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
});
