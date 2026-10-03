// ==================== APP CONTROLLER & VIEWER ====================
let currentTheme = 'sepia';
let currentFontSize = 18;
let currentUrl = "";
let nextUrlCalculated = "";
let isPrefetching = false;
let currentBookId = "default_novel";
let currentBookTitle = "NovelTranslate";
let currentAuthor = "";
let currentBookGenre = "xianxia";
let isUserCustomTitle = false;

let bookIdForGenreEdit = null;
let termBeingEditedSrc = null;

let renderedWindowIndices = []; 
let isAppendingNextChapter = false;
let chapterIntersectionObserver = null;

let selectedWordBuffer = "";
let isSelectedChinese = false;
let selectedParagraphContext = { th: "", src: "", uniqueKey: "" };

let chapters = [
  {
    id: "guide_chap_1",
    title: "คู่มือเริ่มต้น v2.5.1",
    paragraphs: [
      { th: "ยินดีต้อนรับสู่ NovelTranslate AI v2.5.1", src: "欢迎来到 NovelTranslate" },
      { th: "ระบบได้ทำการแยกโครงสร้างโค้ดเป็น Modular Architecture เรียบร้อยแล้ว", src: "已完全重构为模块化架构" }
    ],
    summary: "ผู้ใช้เริ่มต้นใช้งาน NovelTranslate AI v2.5.1"
  }
];
let currentChapterIndex = 0;

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
  document.getElementById('app-body').className = 'theme-' + currentTheme;
  if (document.body.classList.contains('is-fullscreen')) document.body.classList.add('is-fullscreen');
  
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
        <div class="para-th" onclick="toggleParagraphSrc(event, '${chapIdx}-${pIdx}')" data-unique-key="${chapIdx}-${pIdx}" data-th="${encodeURIComponent(p.th || '')}" data-src="${encodeURIComponent(p.src || '')}">${highlightedTh}</div>
        <div class="para-src" id="src-${chapIdx}-${pIdx}">${p.src || "ไม่มีข้อความต้นฉบับ"}</div>
      </div>
    `;
  });

  return `
    <div class="chapter-block" id="chapter-block-${chapIdx}" data-index="${chapIdx}" data-id="${chap.id}">
      <div class="chapter-block-divider">
        <span class="chapter-divider-pill">📖 ${chap.title}</span>
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

async function renderVirtualWindow(targetIdx, scrollToTop = false) {
  const isInfinite = localStorage.getItem('nov_enable_infinite') !== 'false';
  const container = document.getElementById('reading-content');
  container.style.fontSize = currentFontSize + 'px';

  currentChapterIndex = Math.max(0, Math.min(targetIdx, chapters.length - 1));
  const curChap = chapters[currentChapterIndex];

  document.getElementById('display-book-title').innerText = currentBookTitle;
  document.getElementById('display-chap-title').innerText = curChap.title;

  const activeTerms = await getActiveGlossaryForCurrentBook();

  if (!isInfinite) {
    if (chapterIntersectionObserver) {
      chapterIntersectionObserver.disconnect();
      chapterIntersectionObserver = null;
    }
    renderedWindowIndices = [currentChapterIndex];
    container.innerHTML = buildChapterBlockHtml(curChap, currentChapterIndex, activeTerms);
    document.getElementById('manual-chap-nav').style.display = 'flex';
    updateInfiniteStatusBanner('', false);
    if (scrollToTop) window.scrollTo({ top: 0, behavior: 'smooth' });
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

  if (scrollToTop) {
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
  const container = document.getElementById('reading-content');
  const activeTerms = await getActiveGlossaryForCurrentBook();

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = buildChapterBlockHtml(nextChap, nextIdx, activeTerms);
  container.appendChild(tempDiv.firstElementChild);
  
  if (!renderedWindowIndices.includes(nextIdx)) {
    renderedWindowIndices.push(nextIdx);
  }

  if (renderedWindowIndices.length > 3) {
    const removeIdx = renderedWindowIndices.shift();
    const removeEl = document.getElementById(`chapter-block-${removeIdx}`);
    if (removeEl) removeEl.remove();
  }

  setupChapterIntersectionObserver();
  isAppendingNextChapter = false;
  checkAndRefreshBottomStatus();
  checkProactivePrefetch();
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
    updateInfiniteStatusBanner(`
      <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">
        อ่านจบ "${lastChap.title}" แล้ว
      </div>
      <button class="btn btn-primary" style="padding: 6px 14px;" onclick="triggerManualFetchNext()">
        ⚡ แปลตอนถัดไปทันที
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
    triggerReadingPrefetchIfEnabled(true);
  }
}

function setupScrollMonitor() {
  window.addEventListener('scroll', () => {
    const isInfinite = localStorage.getItem('nov_enable_infinite') !== 'false';
    if (!isInfinite) return;

    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 1200) {
      if (currentChapterIndex < chapters.length - 1) appendNextChapterToWindow();
      else checkProactivePrefetch();
    }
  }, { passive: true });
}

async function saveReadingPointer(idx) {
  if (currentBookId === "default_novel" || !chapters[idx]) return;
  const targetChap = chapters[idx];

  const books = await dbGetAllBooks();
  const curBook = books.find(b => b.bookId === currentBookId);

  await dbSaveBook({
    bookId: currentBookId,
    title: currentBookTitle,
    author: currentAuthor,
    genre: currentBookGenre,
    isUserCustomTitle: isUserCustomTitle,
    lastChapterId: targetChap.id,
    lastChapterIndex: idx,
    lastChapterTitle: targetChap.title,
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
      isSelectedChinese = /[\u4e00-\u9fa5]/.test(text);

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

function abortAllRunningProcesses() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  isPrefetching = false;
  document.getElementById('prefetch-badge').style.display = 'none';
  checkAndRefreshBottomStatus();
}

async function deleteSelectedChapters(bookId) {
  const chks = document.querySelectorAll(`.chk-book-${bookId}:checked`);
  const count = chks.length;
  if (count === 0) return;

  if (!confirm(`คุณต้องการลบตอนที่เลือกจำนวน ${count} ตอน ออกจากเครื่องใช่หรือไม่?`)) return;

  abortAllRunningProcesses();

  const idsToDelete = Array.from(chks).map(c => c.value);
  await dbDeleteMultipleChapters(idsToDelete);

  const remainingChaps = await dbGetChaptersByBook(bookId);
  remainingChaps.sort((x, y) => x.order - y.order);

  const books = await dbGetAllBooks();
  const targetBook = books.find(b => b.bookId === bookId);

  if (targetBook) {
    if (remainingChaps.length > 0) {
      let safeActiveId = targetBook.lastChapterId;
      if (!remainingChaps.some(c => c.id === safeActiveId)) safeActiveId = remainingChaps[0].id;
      const safeActiveChap = remainingChaps.find(c => c.id === safeActiveId) || remainingChaps[0];
      const safeActiveIdx = remainingChaps.indexOf(safeActiveChap);
      const latestChap = remainingChaps[remainingChaps.length - 1];

      await dbSaveBook({
        ...targetBook,
        totalChapters: remainingChaps.length,
        lastChapterId: safeActiveChap.id,
        lastChapterTitle: safeActiveChap.title,
        lastChapterIndex: safeActiveIdx,
        lastUrl: latestChap.sourceUrl
      });
    } else {
      await dbSaveBook({
        ...targetBook,
        totalChapters: 0,
        lastChapterId: '',
        lastChapterTitle: "ไม่มีตอน",
        lastChapterIndex: 0,
        lastUrl: ''
      });
    }
  }

  if (currentBookId === bookId) await loadBookFromDB(bookId);
  else refreshShelfViewOnly(bookId);
}

async function loadBookFromDB(bookId, specifyChapIdOrIdx = null) {
  const books = await dbGetAllBooks();
  const targetBook = books.find(b => b.bookId === bookId);
  if (!targetBook) return;

  const loadedChaps = await dbGetChaptersByBook(bookId);
  if (loadedChaps.length > 0) {
    loadedChaps.sort((a, b) => a.order - b.order);
    chapters = loadedChaps;
    currentBookId = bookId;
    currentBookTitle = targetBook.title;
    currentAuthor = targetBook.author || "";
    currentBookGenre = targetBook.genre || "xianxia";
    isUserCustomTitle = targetBook.isUserCustomTitle || false;

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
    
    renderVirtualWindow(currentChapterIndex, true);
    refreshShelfViewOnly(bookId);
  } else {
    chapters = [{
      id: "empty_chap",
      title: "ไม่มีตอนในเครื่อง",
      paragraphs: [{ th: "นิยายเรื่องนี้ยังไม่มีตอนที่บันทึกไว้ หรือถูกลบออกไปทั้งหมดแล้ว", src: "暂无内容" }],
      summary: ""
    }];
    currentChapterIndex = 0;
    renderVirtualWindow(0, true);
    refreshShelfViewOnly(bookId);
  }
}

async function removeBookFromShelf(e, bookId) {
  e.stopPropagation();
  if (!confirm("ต้องการลบนิยายเรื่องนี้และตอนที่เก็บไว้ทั้งหมดในเครื่องใช่หรือไม่?")) return;
  abortAllRunningProcesses();
  await dbDeleteBook(bookId);
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
  
  if (isPrefetching) return;
  isPrefetching = true;
  checkAndRefreshBottomStatus();

  try {
    const bookChaps = await dbGetChaptersByBook(currentBookId);
    if (bookChaps.some(c => c.sourceUrl === targetUrl)) {
      document.getElementById('prefetch-badge').style.display = 'inline-block';
      isPrefetching = false;
      checkAndRefreshBottomStatus();
      return;
    }

    updateInfiniteStatusBanner(`
      <div style="font-size: 13px; font-weight: 500; color: #2563eb;">
        <span class="spinner-icon"></span> กำลังดึงเนื้อหาตอนถัดไปจากเว็บต้นฉบับ...
      </div>
    `, true);

    const { text, nextUrl, rawChapTitle, rawBookTitle, author } = await scrapePage(targetUrl);
    if (author) currentAuthor = author;
    
    updateInfiniteStatusBanner(`
      <div style="font-size: 13px; font-weight: 500; color: #2563eb;">
        <span class="spinner-icon"></span> กำลังวิเคราะห์ชื่อเฉพาะและแปล "${rawChapTitle}" ผ่าน AI...
      </div>
    `, true);

    const prevSummary = lastChap?.summary || "";

    const result = await translateTextWithPingPong(text, (msg) => {
      updateInfiniteStatusBanner(`
        <div style="font-size: 13px; font-weight: 500; color: #b45309;">
          <span class="spinner-icon"></span> ${msg}
        </div>
      `, true);
    }, rawChapTitle, rawBookTitle, prevSummary);
    
    const currentAll = await dbGetChaptersByBook(currentBookId);
    if (currentAll.some(c => c.sourceUrl === targetUrl)) {
      isPrefetching = false;
      checkAndRefreshBottomStatus();
      return;
    }

    const maxOrder = currentAll.reduce((max, c) => Math.max(max, c.order || 0), 0);
    const chapTitle = result.chapterTitle || rawChapTitle || `ตอนที่ ${maxOrder + 1}`;

    const newChap = {
      id: `${currentBookId}_chap_${Date.now()}`,
      bookId: currentBookId,
      order: maxOrder + 1,
      title: chapTitle,
      paragraphs: result.paragraphs,
      summary: result.summary || "",
      sourceUrl: targetUrl,
      nextUrl: nextUrl
    };

    await dbSaveChapter(newChap);

    const books = await dbGetAllBooks();
    const curBook = books.find(b => b.bookId === currentBookId);
    if (curBook) {
      const resolvedTitle = curBook.isUserCustomTitle ? curBook.title : (result.bookTitle || curBook.title);
      await dbSaveBook({
        ...curBook,
        title: resolvedTitle,
        author: currentAuthor,
        genre: curBook.genre || currentBookGenre,
        totalChapters: maxOrder + 1,
        lastChapterId: curBook.lastChapterId || chapters[currentChapterIndex]?.id,
        lastChapterIndex: curBook.lastChapterIndex !== undefined ? curBook.lastChapterIndex : currentChapterIndex,
        lastChapterTitle: curBook.lastChapterTitle || chapters[currentChapterIndex]?.title,
        lastUrl: targetUrl,
        updatedAt: Date.now()
      });
    }

    chapters.push(newChap);
    nextUrlCalculated = nextUrl;
    document.getElementById('prefetch-badge').style.display = 'inline-block';

    const isInfinite = localStorage.getItem('nov_enable_infinite') !== 'false';
    if (isInfinite) appendNextChapterToWindow();
  } catch (e) {
    console.warn("Reading prefetch failed:", e);
    if (e.message && (e.message.includes('404') || e.message.includes('ไม่พบเนื้อหา'))) {
      lastChap.nextUrl = null;
      await dbSaveChapter(lastChap);
      nextUrlCalculated = null;
    }
  } finally {
    isPrefetching = false;
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

  if (nextUrlCalculated) {
    const btnText = document.getElementById('next-btn-text');
    const nextBtn = document.getElementById('next-chap-btn');
    const cancelBtn = document.getElementById('cancel-retry-btn');
    
    btnText.innerText = "กำลังแปลตอนถัดไป...";
    nextBtn.disabled = true;
    cancelBtn.style.display = 'inline-flex';

    try {
      currentUrl = nextUrlCalculated;
      const { text, nextUrl, rawChapTitle, rawBookTitle, author } = await scrapePage(currentUrl);
      nextUrlCalculated = nextUrl;
      if (author) currentAuthor = author;

      const lastChap = chapters[chapters.length - 1];
      const prevSummary = lastChap?.summary || "";

      const result = await translateTextWithPingPong(text, (msg) => {
        btnText.innerText = msg.substring(0, 30) + "...";
      }, rawChapTitle, rawBookTitle, prevSummary);

      const currentAll = await dbGetChaptersByBook(currentBookId);
      const maxOrder = currentAll.reduce((max, c) => Math.max(max, c.order || 0), 0);

      const chapTitle = result.chapterTitle || rawChapTitle || `ตอนที่ ${maxOrder + 1}`;

      const newChap = {
        id: `${currentBookId}_chap_${Date.now()}`,
        bookId: currentBookId,
        order: maxOrder + 1,
        title: chapTitle,
        paragraphs: result.paragraphs,
        summary: result.summary || "",
        sourceUrl: currentUrl,
        nextUrl: nextUrl
      };

      await dbSaveChapter(newChap);
      chapters.push(newChap);

      currentChapterIndex = chapters.length - 1;
      renderVirtualWindow(currentChapterIndex, true);
      checkProactivePrefetch();
    } catch (err) {
      if (!retryAbortRequested) {
        document.getElementById('import-url').value = nextUrlCalculated || '';
        const modalTitle = document.getElementById('import-modal-title');
        if (modalTitle) modalTitle.innerText = "ไม่พบ URL ตอนถัดไป (กรุณาวาง URL ใหม่)";
        openModal('import-modal');
      }
    } finally {
      btnText.innerText = "ตอนถัดไป →";
      nextBtn.disabled = false;
      cancelBtn.style.display = 'none';
    }
  } else {
    openModal('import-modal');
  }
}

function prevChapter() {
  if (currentChapterIndex > 0) {
    currentChapterIndex--;
    renderVirtualWindow(currentChapterIndex, true);
  }
}

async function startTranslateFirst() {
  const url = document.getElementById('import-url').value.trim();
  const chosenGenre = document.getElementById('import-novel-genre').value;
  if (!url) return alert("กรุณาใส่ URL หน้านิยาย");

  const status = document.getElementById('import-status');
  const startBtn = document.getElementById('start-btn');
  const btnText = document.getElementById('start-btn-text');

  status.style.display = 'block';
  status.style.background = '#eff6ff';
  status.style.color = '#1e40af';
  status.innerText = "กำลังสแกนหาเนื้อหา...";
  startBtn.disabled = true;
  btnText.innerText = "กำลังทำงาน...";

  try {
    const targetBookId = extractBookIdFromUrl(url);

    const { text, nextUrl, rawChapTitle, rawBookTitle, author } = await scrapePage(url);
    nextUrlCalculated = nextUrl;
    if (author) currentAuthor = author;
    currentBookGenre = chosenGenre;

    status.innerText = `พบ "${rawChapTitle}" กำลังวิเคราะห์ชื่อเฉพาะและแปลผ่าน AI...`;

    const existingChaps = await dbGetChaptersByBook(targetBookId);
    const maxOrder = existingChaps.reduce((max, c) => Math.max(max, c.order || 0), 0);

    const prevChap = existingChaps.find(c => c.order === maxOrder);
    const prevSummary = prevChap?.summary || "";

    const result = await translateTextWithPingPong(text, (msg) => {
      status.style.background = '#fffbeb';
      status.style.color = '#b45309';
      status.innerText = msg;
    }, rawChapTitle, rawBookTitle, prevSummary);

    const books = await dbGetAllBooks();
    const existingBook = books.find(b => b.bookId === targetBookId);
    
    let finalBookTitle = currentBookTitle;
    let isCustom = false;

    if (existingBook && existingBook.isUserCustomTitle) {
      finalBookTitle = existingBook.title;
      isCustom = true;
    } else if (result.bookTitle) {
      finalBookTitle = result.bookTitle;
      isCustom = false;
    }

    const chapTitle = result.chapterTitle || rawChapTitle || `ตอนที่ ${maxOrder + 1}`;

    const newChapter = {
      id: `${targetBookId}_chap_${Date.now()}`,
      bookId: targetBookId,
      order: maxOrder + 1,
      title: chapTitle,
      paragraphs: result.paragraphs,
      summary: result.summary || "",
      sourceUrl: url,
      nextUrl: nextUrl
    };

    await dbSaveChapter(newChapter);

    if (currentBookId === targetBookId) {
      chapters.push(newChapter);
      currentChapterIndex = chapters.length - 1;
    } else {
      currentBookId = targetBookId;
      chapters = [newChapter];
      currentChapterIndex = 0;
    }

    currentBookTitle = finalBookTitle;
    isUserCustomTitle = isCustom;
    currentUrl = url;

    await dbSaveBook({
      bookId: currentBookId,
      title: currentBookTitle,
      author: currentAuthor,
      genre: currentBookGenre,
      isUserCustomTitle: isUserCustomTitle,
      lastChapterId: newChapter.id,
      lastChapterIndex: currentChapterIndex,
      lastChapterTitle: newChapter.title,
      totalChapters: maxOrder + 1,
      lastUrl: url,
      updatedAt: Date.now()
    });
    localStorage.setItem('nov_last_book_id', currentBookId);

    renderVirtualWindow(currentChapterIndex, true);
    closeModal('import-modal');
  } catch (err) {
    status.style.background = '#fef2f2';
    status.style.color = '#991b1b';
    status.innerText = "ข้อผิดพลาด: " + (err.message === '404' ? 'ไม่พบหน้านิยาย (404 Not Found)' : err.message);
  } finally {
    startBtn.disabled = false;
    btnText.innerText = "เริ่มแปลตอนนี้";
  }
}

async function fetchLiveModels() {
  const activeKey = getActiveApiKey();
  const statusText = document.getElementById('fetch-status-text');
  const fetchBtn = document.getElementById('fetch-models-btn');

  if (!activeKey) return alert("กรุณากรอก API Key ก่อนกดตรวจเช็กโมเดล");

  fetchBtn.disabled = true;
  fetchBtn.innerText = "กำลังตรวจเช็ก...";
  statusText.style.display = "block";
  statusText.style.color = "#2563eb";
  statusText.innerText = "กำลังเชื่อมต่อไปยัง Google API...";

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${activeKey}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error?.message || "ไม่สามารถดึงรายชื่อโมเดลได้");
    if (!data.models || !Array.isArray(data.models)) throw new Error("ไม่พบข้อมูลโมเดลในบัญชีนี้");

    const availableModels = data.models
      .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(name => name.toLowerCase().includes("gemini"));

    if (availableModels.length === 0) throw new Error("ไม่พบโมเดล Gemini ที่พร้อมใช้งาน");

    localStorage.setItem('nov_cached_models', JSON.stringify(availableModels));
    populateModelDropdowns(availableModels);

    statusText.style.color = "#16a34a";
    statusText.innerText = `✓ ตรวจพบโมเดลพร้อมใช้งาน ${availableModels.length} รุ่น (อัปเดตลงตัวเลือกแล้ว)`;
  } catch (err) {
    statusText.style.color = "#dc2626";
    statusText.innerText = "เกิดข้อผิดพลาด: " + err.message;
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.innerText = "ตรวจเช็กโมเดล";
  }
}

function populateModelDropdowns(modelsList) {
  const primarySelect = document.getElementById('gemini-primary-model');
  const savedPrimary = localStorage.getItem('nov_primary_model') || primarySelect.value;

  primarySelect.innerHTML = "";
  modelsList.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.innerText = m;
    if (m === savedPrimary) opt.selected = true;
    primarySelect.appendChild(opt);
  });
}

function saveSettings() {
  const keysRaw = document.getElementById('gemini-keys-area').value;
  const parsedKeys = keysRaw.split('\n').map(k => k.trim()).filter(k => k.length > 5);

  apiKeyPool = parsedKeys;
  currentApiKeyIndex = 0;

  localStorage.setItem('nov_gemini_keys_pool', JSON.stringify(parsedKeys));
  if (parsedKeys.length > 0) {
    localStorage.setItem('nov_gemini_key', parsedKeys[0]);
  } else {
    localStorage.removeItem('nov_gemini_key');
  }

  localStorage.setItem('nov_primary_model', document.getElementById('gemini-primary-model').value);
  localStorage.setItem('nov_retry_limit', document.getElementById('retry-limit').value || "10");
  
  const deepNerChk = document.getElementById('enable-deep-ner-scan');
  localStorage.setItem('nov_enable_deep_ner', deepNerChk.checked ? 'true' : 'false');

  const bilingualVerifyChk = document.getElementById('enable-bilingual-verify');
  localStorage.setItem('nov_enable_bilingual_verify', bilingualVerifyChk.checked ? 'true' : 'false');

  const infiniteChk = document.getElementById('enable-infinite-scroll');
  localStorage.setItem('nov_enable_infinite', infiniteChk.checked ? 'true' : 'false');

  const prefetchChk = document.getElementById('enable-live-prefetch');
  localStorage.setItem('nov_enable_prefetch', prefetchChk.checked ? 'true' : 'false');

  const autoGlossChk = document.getElementById('enable-auto-glossary');
  localStorage.setItem('nov_enable_auto_glossary', autoGlossChk.checked ? 'true' : 'false');

  closeModal('settings-modal');
  renderVirtualWindow(currentChapterIndex, true);
  alert(`บันทึกการตั้งค่าเรียบร้อยแล้ว (คลัง API Key พร้อมใช้งาน ${parsedKeys.length} ตัว)`);
}

function loadSettings() {
  try {
    const poolRaw = localStorage.getItem('nov_gemini_keys_pool');
    if (poolRaw) {
      apiKeyPool = JSON.parse(poolRaw);
    } else if (localStorage.getItem('nov_gemini_key')) {
      apiKeyPool = [localStorage.getItem('nov_gemini_key').trim()];
    }
  } catch (e) {
    apiKeyPool = [];
  }

  const keysArea = document.getElementById('gemini-keys-area');
  if (keysArea) {
    keysArea.value = (apiKeyPool || []).join('\n');
  }

  if (localStorage.getItem('nov_theme')) {
    currentTheme = localStorage.getItem('nov_theme');
    document.getElementById('app-body').className = 'theme-' + currentTheme;
    const themeText = currentTheme === 'sepia' ? 'ถนอมสายตา' : (currentTheme === 'light' ? 'สว่าง' : 'มืด');
    const mobileBtn = document.getElementById('mobile-theme-btn');
    const desktopBtn = document.getElementById('desktop-theme-btn');
    if (mobileBtn) mobileBtn.innerText = themeText;
    if (desktopBtn) desktopBtn.innerText = themeText;
    localStorage.setItem('nov_theme', currentTheme);
  }

  if (localStorage.getItem('nov_font_size')) {
    currentFontSize = parseInt(localStorage.getItem('nov_font_size'), 10);
  }

  try {
    const cached = JSON.parse(localStorage.getItem('nov_cached_models') || '[]');
    if (Array.isArray(cached) && cached.length > 0) populateModelDropdowns(cached);
  } catch(e) {}

  if (localStorage.getItem('nov_primary_model')) document.getElementById('gemini-primary-model').value = localStorage.getItem('nov_primary_model');
  if (localStorage.getItem('nov_retry_limit')) document.getElementById('retry-limit').value = localStorage.getItem('nov_retry_limit');

  const deepNerVal = localStorage.getItem('nov_enable_deep_ner');
  const deepNerChk = document.getElementById('enable-deep-ner-scan');
  if (deepNerChk) deepNerChk.checked = (deepNerVal === 'true');

  const bilingualVerifyVal = localStorage.getItem('nov_enable_bilingual_verify');
  const bilingualVerifyChk = document.getElementById('enable-bilingual-verify');
  if (bilingualVerifyChk) bilingualVerifyChk.checked = (bilingualVerifyVal !== 'false');

  const prefetchVal = localStorage.getItem('nov_enable_prefetch');
  const prefetchChk = document.getElementById('enable-live-prefetch');
  if (prefetchChk) prefetchChk.checked = (prefetchVal !== 'false');

  const infiniteVal = localStorage.getItem('nov_enable_infinite');
  const infiniteChk = document.getElementById('enable-infinite-scroll');
  if (infiniteChk) infiniteChk.checked = (infiniteVal !== 'false');

  const autoGlossVal = localStorage.getItem('nov_enable_auto_glossary');
  const autoGlossChk = document.getElementById('enable-auto-glossary');
  if (autoGlossChk) autoGlossChk.checked = (autoGlossVal !== 'false');
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

window.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  await refreshInMemoryGlossaryCache();
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
