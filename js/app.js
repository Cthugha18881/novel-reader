// ============================================================================
// NOVELTRANSLATE AI - MAIN APPLICATION CONTROLLER (app.js)
// ============================================================================

let currentBookId = localStorage.getItem('nov_current_book_id') || null;
let currentBookTitle = "ยังไม่ได้เลือกเรื่อง";
let currentBookGenre = "xianxia";
let currentAuthor = "";
let chapters = [];
let currentChapterIndex = 0;
let currentFontSize = parseInt(localStorage.getItem('nov_font_size') || '18', 10);
let currentTheme = localStorage.getItem('nov_theme') || 'theme-sepia';

let selectedWordBuffer = "";
let currentSelectedParagraphIndex = null;

// ---------------- INITIALIZATION ----------------

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(currentTheme);
  applyFontSize(currentFontSize);
  initModalListeners();
  initSelectionDetection();
  initScrollHandler();
  initSettingsUI();

  await refreshLocalData();
});

async function refreshLocalData() {
  if (typeof dbInit === 'function') await dbInit();
  if (typeof loadGlossaryFromDb === 'function') await loadGlossaryFromDb();

  if (currentBookId && typeof dbGetBook === 'function') {
    const book = await dbGetBook(currentBookId);
    if (book) {
      currentBookTitle = book.title || "นิยาย";
      currentBookGenre = book.genre || "xianxia";
      currentAuthor = book.author || "";
      chapters = await dbGetChaptersByBook(currentBookId);
      chapters.sort((a, b) => a.order - b.order);

      const savedOrder = parseInt(localStorage.getItem(`nov_last_read_${currentBookId}`) || '1', 10);
      currentChapterIndex = chapters.findIndex(c => c.order === savedOrder);
      if (currentChapterIndex < 0) currentChapterIndex = 0;

      renderCurrentChapter();
    } else {
      currentBookId = null;
      renderEmptyState();
    }
  } else {
    renderEmptyState();
  }
}

function renderEmptyState() {
  document.getElementById('display-book-title').textContent = "ยินดีต้อนรับสู่ NovelTranslate AI";
  document.getElementById('display-chap-title').textContent = "กรุณาวางลิงก์นิยาย หรือเลือกจากชั้นหนังสือ";
  document.getElementById('reading-content').innerHTML = `
    <div style="text-align: center; padding: 60px 20px; opacity: 0.7;">
      <div style="font-size: 48px; margin-bottom: 12px;">📖</div>
      <p style="font-size: 16px;">ยังไม่มีนิยายที่กำลังอ่านอยู่ในขณะนี้</p>
      <button class="btn btn-primary" style="margin-top: 10px;" onclick="openModal('import-modal')">+ วางลิงก์นิยายเพื่อเริ่มแปล</button>
    </div>
  `;
}

// ---------------- READING VIEW RENDERING ----------------

function updateChapterHeaderUI(chap) {
  const bookTitleEl = document.getElementById('display-book-title');
  const chapTitleEl = document.getElementById('display-chap-title');

  if (bookTitleEl) bookTitleEl.textContent = currentBookTitle;

  if (chapTitleEl) {
    let badge = "";
    if (chap.chapterType === "announcement") {
      badge = `<span style="font-size: 11px; background: #ef4444; color: #fff; padding: 2px 7px; border-radius: 4px; margin-right: 6px; vertical-align: middle;">📢 ประกาศคนเขียน</span>`;
    } else if (chap.chapterType === "side_story") {
      badge = `<span style="font-size: 11px; background: #8b5cf6; color: #fff; padding: 2px 7px; border-radius: 4px; margin-right: 6px; vertical-align: middle;">✨ ตอนพิเศษ</span>`;
    }
    chapTitleEl.innerHTML = `${badge}${escapeHtml(chap.title || ("ตอนที่ " + chap.order))}`;
  }
}

function renderCurrentChapter() {
  if (!chapters || chapters.length === 0 || !chapters[currentChapterIndex]) {
    renderEmptyState();
    return;
  }

  const curChap = chapters[currentChapterIndex];
  localStorage.setItem(`nov_last_read_${currentBookId}`, curChap.order);

  updateChapterHeaderUI(curChap);

  const container = document.getElementById('reading-content');
  container.innerHTML = "";

  const paragraphs = curChap.paragraphs || [];
  if (paragraphs.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.6;">(ไม่มีเนื้อหาในตอนนี้)</div>`;
    return;
  }

  paragraphs.forEach((p, idx) => {
    const pEl = document.createElement('p');
    pEl.className = 'read-paragraph';
    pEl.dataset.pIndex = idx;
    pEl.innerHTML = renderParagraphWithGlossaryHighlights(p.th || "");
    container.appendChild(pEl);
  });

  window.scrollTo({ top: 0, behavior: 'instant' });
  attachTermClickListeners();
}

function renderParagraphWithGlossaryHighlights(thaiText) {
  let safeHtml = escapeHtml(thaiText);
  const cache = window.inMemoryGlossaryCache || [];
  if (cache.length === 0) return safeHtml;

  const relevantTerms = cache.filter(t => 
    t.scope === 'global' || (Array.isArray(t.books) && t.books.includes(currentBookId))
  );

  relevantTerms.sort((a, b) => (b.tgt || "").length - (a.tgt || "").length);

  for (const term of relevantTerms) {
    if (!term.tgt || term.tgt.length < 2) continue;
    const escapedTgt = term.tgt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedTgt})`, 'g');
    safeHtml = safeHtml.replace(regex, `<span class="glossary-term-highlight" data-src="${escapeHtml(term.src)}" data-tgt="${escapeHtml(term.tgt)}" data-cat="${term.category || 'character'}">$1</span>`);
  }

  return safeHtml;
}

// ---------------- TERM POPOVER & SELECTION DETECTION ----------------

function attachTermClickListeners() {
  const spans = document.querySelectorAll('.glossary-term-highlight');
  const popover = document.getElementById('term-popover');
  const popText = document.getElementById('popover-text');
  const editBtn = document.getElementById('popover-edit-btn');

  spans.forEach(span => {
    span.onclick = (e) => {
      e.stopPropagation();
      const src = span.dataset.src;
      const tgt = span.dataset.tgt;
      const cat = span.dataset.cat;

      popText.innerHTML = `<b>${escapeHtml(src)}</b> ➔ ${escapeHtml(tgt)} <span style="font-size: 10px; opacity: 0.7;">[${cat}]</span>`;
      
      const rect = span.getBoundingClientRect();
      popover.style.display = 'flex';
      popover.style.top = `${window.scrollY + rect.top - 42}px`;
      popover.style.left = `${Math.max(10, window.scrollX + rect.left)}px`;

      editBtn.onclick = () => openEditTermModal(src, tgt, cat);
    };
  });

  document.addEventListener('click', (e) => {
    if (popover && !popover.contains(e.target) && !e.target.classList.contains('glossary-term-highlight')) {
      popover.style.display = 'none';
    }
  });
}

function initSelectionDetection() {
  const selectionBar = document.getElementById('selection-bar');
  const previewText = document.getElementById('sel-preview-text');

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";

    if (text.length >= 1 && text.length <= 50) {
      selectedWordBuffer = text;
      previewText.textContent = text;
      selectionBar.style.display = 'flex';

      let node = sel.anchorNode;
      while (node && !node.classList?.contains('read-paragraph')) {
        node = node.parentNode;
      }
      if (node && node.dataset.pIndex) {
        currentSelectedParagraphIndex = parseInt(node.dataset.pIndex, 10);
      }
    }
  });
}

function dismissSelectionBar() {
  const bar = document.getElementById('selection-bar');
  if (bar) bar.style.display = 'none';
  selectedWordBuffer = "";
  window.getSelection()?.removeAllRanges();
}

async function addFromSelectionBar() {
  if (!selectedWordBuffer) return;
  const word = selectedWordBuffer;
  dismissSelectionBar();
  openEditTermModal("", word, "character");
}

async function findChineseForSelection() {
  if (!selectedWordBuffer || currentSelectedParagraphIndex === null) return;
  const thaiWord = selectedWordBuffer;
  const curChap = chapters[currentChapterIndex];
  const p = curChap?.paragraphs?.[currentSelectedParagraphIndex];
  if (!p || !p.src) {
    alert("ไม่พบข้อความภาษาจีนต้นฉบับในย่อหน้านี้");
    return;
  }

  showActionToast(`กำลังค้นหาอักษรจีนสำหรับ "${thaiWord}"...`);
  try {
    const matchedSrc = await pairThaiToSourceParagraph(thaiWord, p.src);
    hideActionToast();
    if (matchedSrc) {
      dismissSelectionBar();
      openEditTermModal(matchedSrc, thaiWord, "character");
    } else {
      alert(`ไม่พบคำจีนที่ตรงกับ "${thaiWord}" ในย่อหน้านี้`);
    }
  } catch (err) {
    hideActionToast();
    alert(`เกิดข้อผิดพลาด: ${err.message}`);
  }
}

// ---------------- CHAPTER NAVIGATION & SCROLL ----------------

async function prevChapter() {
  if (currentChapterIndex > 0) {
    currentChapterIndex--;
    renderCurrentChapter();
  } else {
    alert("นี่คือบทแรกสุดแล้วครับ");
  }
}

async function handleNextChapterClick() {
  if (currentChapterIndex < chapters.length - 1) {
    currentChapterIndex++;
    renderCurrentChapter();
  } else {
    alert("คุณอ่านถึงตอนล่าสุดในเครื่องแล้ว หากต้องการอ่านต่อ กรุณาวาง URL บทถัดไปที่ปุ่ม '+ วางลิงก์'");
  }
}

function initScrollHandler() {
  window.addEventListener('scroll', () => {
    const isInfiniteEnabled = localStorage.getItem('nov_enable_infinite_scroll') !== 'false';
    if (!isInfiniteEnabled) return;

    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
      appendNextChapterSeamlessly();
    }
  });
}

let isAppendingChapter = false;
async function appendNextChapterSeamlessly() {
  if (isAppendingChapter) return;
  if (currentChapterIndex >= chapters.length - 1) return;

  isAppendingChapter = true;
  currentChapterIndex++;
  const nextChap = chapters[currentChapterIndex];
  localStorage.setItem(`nov_last_read_${currentBookId}`, nextChap.order);

  const container = document.getElementById('reading-content');
  const divider = document.createElement('div');
  divider.className = 'chapter-divider-bar';
  divider.innerHTML = `<span>ตอนที่ ${nextChap.order}: ${escapeHtml(nextChap.title)}</span>`;
  container.appendChild(divider);

  (nextChap.paragraphs || []).forEach((p, idx) => {
    const pEl = document.createElement('p');
    pEl.className = 'read-paragraph';
    pEl.dataset.pIndex = idx;
    pEl.innerHTML = renderParagraphWithGlossaryHighlights(p.th || "");
    container.appendChild(pEl);
  });

  attachTermClickListeners();
  updateChapterHeaderUI(nextChap);
  isAppendingChapter = false;
}

// ---------------- IMPORT & TRANSLATE HANDLERS ----------------

async function startTranslateFirst() {
  const urlInput = document.getElementById('import-url');
  const genreInput = document.getElementById('import-novel-genre');
  const statusEl = document.getElementById('import-status');
  const startBtn = document.getElementById('start-btn');
  const startBtnText = document.getElementById('start-btn-text');

  const url = urlInput ? urlInput.value.trim() : "";
  const genre = genreInput ? genreInput.value : "xianxia";

  if (!url) {
    if (statusEl) statusEl.textContent = "กรุณากรอก URL หน้านิยาย";
    return;
  }

  const activeKey = getActiveApiKey();
  if (!activeKey) {
    alert("กรุณาใส่ Gemini API Key ในเมนู 'ตั้งค่า' ก่อนเริ่มแปล");
    openModal('settings-modal');
    return;
  }

  if (startBtn) startBtn.disabled = true;
  if (startBtnText) startBtnText.textContent = "กำลังดึงเนื้อหาและแปล...";
  if (statusEl) statusEl.textContent = "กำลังดึงเนื้อหาภาษาจีนจากเว็บต้นทาง...";

  try {
    const scraped = await fetchNovelChapterContent(url);
    if (!scraped || !scraped.content) {
      throw new Error("ไม่สามารถดึงเนื้อหาจาก URL นี้ได้ กรุณาตรวจสอบลิงก์");
    }

    if (statusEl) statusEl.textContent = "กำลังแปลเนื้อหาและสกัด Dossier ด้วย AI...";

    let book = null;
    if (typeof dbFindBookByTitle === 'function') {
      book = await dbFindBookByTitle(scraped.bookTitle || "นิยายใหม่");
    }

    if (!book) {
      const newBookId = "book_" + Date.now();
      book = {
        id: newBookId,
        title: scraped.bookTitle || "นิยายใหม่",
        genre: genre,
        author: scraped.author || "",
        sourceUrl: url,
        createdAt: Date.now()
      };
      if (typeof dbSaveBook === 'function') await dbSaveBook(book);
    }

    currentBookId = book.id;
    currentBookTitle = book.title;
    currentBookGenre = book.genre;
    currentAuthor = book.author;
    localStorage.setItem('nov_current_book_id', currentBookId);

    const primaryModel = (localStorage.getItem('nov_primary_model') || "gemini-3.5-flash-lite").trim();
    const transResult = await executeApiCall(
      scraped.content,
      primaryModel,
      scraped.chapterTitle,
      scraped.bookTitle,
      "",
      null,
      (msg) => { if (statusEl) statusEl.textContent = msg; }
    );

    let nextOrder = 1;
    if (typeof dbGetChaptersByBook === 'function') {
      const existingChaps = await dbGetChaptersByBook(currentBookId);
      nextOrder = existingChaps.length + 1;
    }

    const newChapter = {
      bookId: currentBookId,
      order: nextOrder,
      title: transResult.chapterTitle || scraped.chapterTitle || `ตอนที่ ${nextOrder}`,
      chapterType: transResult.chapterType || "regular",
      summary: transResult.summary || "",
      dossier: transResult.dossier || null,
      paragraphs: transResult.paragraphs || [],
      sourceUrl: url,
      createdAt: Date.now()
    };

    if (typeof dbSaveChapter === 'function') {
      await dbSaveChapter(newChapter);
    }

    closeModal('import-modal');
    if (urlInput) urlInput.value = "";
    if (statusEl) statusEl.textContent = "";

    await refreshLocalData();
  } catch (err) {
    if (statusEl) statusEl.textContent = `เกิดข้อผิดพลาด: ${err.message}`;
    console.error(err);
  } finally {
    if (startBtn) startBtn.disabled = false;
    if (startBtnText) startBtnText.textContent = "เริ่มแปลตอนนี้";
  }
}

function handleImportCancel() {
  closeModal('import-modal');
  const statusEl = document.getElementById('import-status');
  if (statusEl) statusEl.textContent = "";
}

// ---------------- SETTINGS UI & SAVE ----------------

function initSettingsUI() {
  const area = document.getElementById('gemini-keys-area');
  const modelSelect = document.getElementById('gemini-primary-model');
  const retryInput = document.getElementById('retry-limit');
  const infiniteChk = document.getElementById('enable-infinite-scroll');
  const bilingualChk = document.getElementById('enable-bilingual-verify');

  if (area) area.value = localStorage.getItem('nov_gemini_keys') || '';
  if (modelSelect) modelSelect.value = localStorage.getItem('nov_primary_model') || 'gemini-3.5-flash-lite';
  if (retryInput) retryInput.value = localStorage.getItem('nov_retry_limit') || '10';
  if (infiniteChk) infiniteChk.checked = localStorage.getItem('nov_enable_infinite_scroll') !== 'false';
  if (bilingualChk) bilingualChk.checked = localStorage.getItem('nov_enable_bilingual_verify') !== 'false';
}

function saveSettings() {
  const area = document.getElementById('gemini-keys-area');
  const modelSelect = document.getElementById('gemini-primary-model');
  const retryInput = document.getElementById('retry-limit');
  const infiniteChk = document.getElementById('enable-infinite-scroll');
  const bilingualChk = document.getElementById('enable-bilingual-verify');

  if (area) localStorage.setItem('nov_gemini_keys', area.value.trim());
  if (modelSelect) localStorage.setItem('nov_primary_model', modelSelect.value);
  if (retryInput) localStorage.setItem('nov_retry_limit', retryInput.value);
  if (infiniteChk) localStorage.setItem('nov_enable_infinite_scroll', infiniteChk.checked);
  if (bilingualChk) localStorage.setItem('nov_enable_bilingual_verify', bilingualChk.checked);

  currentApiKeyIndex = 0;
  closeModal('settings-modal');
  alert('บันทึกการตั้งค่าเรียบร้อยแล้ว');
}

// ---------------- THEME & FONT HELPERS ----------------

function applyFontSize(size) {
  currentFontSize = Math.max(14, Math.min(32, size));
  localStorage.setItem('nov_font_size', currentFontSize);
  document.documentElement.style.setProperty('--reading-font-size', `${currentFontSize}px`);
  const content = document.getElementById('reading-content');
  if (content) content.style.fontSize = `${currentFontSize}px`;
}

function adjustFontSize(delta) {
  applyFontSize(currentFontSize + delta);
}

function applyTheme(themeClass) {
  currentTheme = themeClass;
  localStorage.setItem('nov_theme', currentTheme);
  const body = document.getElementById('app-body');
  if (body) body.className = themeClass;

  const deskBtn = document.getElementById('desktop-theme-btn');
  const mobBtn = document.getElementById('mobile-theme-btn');
  const label = themeClass === 'theme-sepia' ? 'ถนอมสายตา' : (themeClass === 'theme-dark' ? 'โหมดมืด' : 'โหมดสว่าง');
  if (deskBtn) deskBtn.textContent = label;
  if (mobBtn) mobBtn.textContent = label;
}

function cycleTheme() {
  if (currentTheme === 'theme-sepia') applyTheme('theme-dark');
  else if (currentTheme === 'theme-dark') applyTheme('theme-light');
  else applyTheme('theme-sepia');
}

function toggleFullscreenMode() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
  } else {
    document.exitFullscreen();
  }
}

function showActionToast(msg) {
  const toast = document.getElementById('global-action-toast');
  const txt = document.getElementById('global-toast-msg');
  if (toast && txt) {
    txt.textContent = msg;
    toast.style.display = 'flex';
  }
}

function hideActionToast() {
  const toast = document.getElementById('global-action-toast');
  if (toast) toast.style.display = 'none';
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

function openGlossaryModal() {
  openModal('glossary-modal');
  if (typeof renderGlossaryUI === 'function') renderGlossaryUI();
}

function openBookshelfModal() {
  openModal('bookshelf-modal');
  if (typeof renderBookshelfUI === 'function') renderBookshelfUI();
}

function initModalListeners() {
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  });
}

function exportTxt() {
  if (!chapters || chapters.length === 0 || !chapters[currentChapterIndex]) return;
  const cur = chapters[currentChapterIndex];
  const text = `${cur.title}\n\n` + (cur.paragraphs || []).map(p => p.th).join('\n\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${currentBookTitle}_ตอนที่_${cur.order}.txt`;
  a.click();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
