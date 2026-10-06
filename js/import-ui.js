// ==================== วางลิงก์ / นำเข้าข้อความและไฟล์ (แยกจาก app.js) ====================
// โหลดหลัง app.js (ดู index.html) ทุกอย่างในไฟล์นี้ถูกเรียกหลังหน้าโหลดเสร็จ จึงใช้ตัวแปรของ app.js ได้ตามปกติ

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
    status.innerHTML = `<span style="color: var(--danger);">อ่านไฟล์ไม่สำเร็จ: ${escapeHtml(err.message)}</span>`;
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
    document.getElementById('import-text-preview').innerHTML = `<span style="color: var(--danger);">ข้อความยาวเกินไป (${text.length.toLocaleString()} ตัวอักษร) วางได้ไม่เกิน ${IMPORT_LIMITS.pasteChars.toLocaleString()} ตัวอักษร ลองแบ่งเป็นหลายครั้ง</span>`;
    return;
  }
  importTextParsed = { bookTitle: document.getElementById('import-text-title').value.trim(), chapters: splitTextIntoChapters(text) };
  renderImportTextPreview();
}

function renderImportTextPreview() {
  const box = document.getElementById('import-text-preview');
  const list = importTextParsed?.chapters || [];
  if (!list.length) {
    box.innerHTML = '<span style="color: var(--danger);">ไม่พบเนื้อหาในข้อความ/ไฟล์นี้</span>';
    return;
  }
  const total = list.reduce((n, ch) => n + ch.paragraphs.join('').length, 0);
  const sample = list.length <= 6 ? list : [...list.slice(0, 3), null, ...list.slice(-2)];
  const lang = detectSourceLang(list.slice(0, 3).map(ch => ch.paragraphs.join('\n')).join('\n'));
  box.innerHTML = `
    <div>พบ <b>${list.length}</b> ตอน · ${total.toLocaleString()} ตัวอักษร${lang ? ` · ภาษาที่ตรวจพบ: <b>${escapeHtml(getLangName(lang))}</b>` : ''}</div>
    <ol style="padding-left: 20px; margin-top: 4px;">${sample.map((ch, i) => ch
      ? `<li value="${list.indexOf(ch) + 1}">${escapeHtml(ch.title)} <span style="opacity: 0.6;">(${ch.paragraphs.join('').length.toLocaleString()} ตัวอักษร)</span></li>`
      : '<li style="list-style: none; opacity: 0.6;">…</li>').join('')}</ol>`;
}

/** นำเข้าข้อความ/ไฟล์เป็น "ตอนที่รอแปล" (ยังไม่ใช้โควตา AI จนกว่าจะสั่งแปล) */
async function importTextChapters() {
  if (!importTextParsed) previewImportText();
  const list = importTextParsed?.chapters || [];
  if (!list.length) return appAlert('กรุณาวางข้อความหรือเลือกไฟล์ก่อน');
  try { checkImportChapterCount(list.length); } catch (err) { return appAlert(err.message); }

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
    appAlert(`นำเข้า ${records.length} ตอนแล้ว (ยังไม่แปล)\nกด "⚡ แปลตอนนี้เลย" ในหน้าอ่าน หรือ "⚡ เริ่มแปลล่วงหน้า" ที่ชั้นหนังสือเพื่อแปลทีละหลายตอน`);
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
  if (!url) return appAlert("กรุณาใส่ URL หน้านิยาย");
  if (isTaskRunning('import')) return;

  const status = document.getElementById('import-status');
  const startBtn = document.getElementById('start-btn');
  const btnText = document.getElementById('start-btn-text');

  status.style.display = 'block';
  setStatusTone(status, 'info');
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

    const { text, nextUrl, rawChapTitle, rawBookTitle, author, lockInfo } = await scrapePage(url, signal, { bookId: targetBookId });
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
      lockInfo,
      prevChapter: prevChap,
      onStatus: (msg) => {
        setStatusTone(status, 'warn');
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
    setStatusTone(status, 'error');
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

