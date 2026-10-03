// ==================== BOOKSHELF & BATCH ENGINE ====================
let isBatchRunning = false;
let batchCancelRequested = false;
let isBatchComplete = false;
let bookSortModes = {};

function getGenreThaiName(g) {
  switch(g) {
    case 'xianxia': return 'เซียนเซีย';
    case 'wuxia': return 'กำลังภายใน';
    case 'western_fantasy': return 'แฟนตาซีตะวันตก';
    case 'system_game': return 'ระบบ/เกม';
    case 'scifi': return 'ไซไฟ';
    case 'horror': return 'สยองขวัญ';
    case 'historical': return 'ย้อนยุค/ราชสำนัก';
    case 'urban_life': return 'สังคมเมือง';
    case 'modern_romance': return 'โรแมนติก';
    case 'fanfic': return 'แฟนฟิค';
    default: return 'วรรณกรรมทั่วไป';
  }
}

function handleBatchActionClick() {
  if (isBatchComplete) {
    document.getElementById('batch-progress-box').style.display = 'none';
  } else {
    cancelBatchTranslate();
  }
}

function cancelBatchTranslate() {
  if (isBatchRunning) {
    batchCancelRequested = true;
    abortAllRunningProcesses();
    document.getElementById('batch-progress-desc').innerText = "กำลังสั่งหยุด...";
  }
}

async function startBatchTranslateForBook(bookId) {
  if (isBatchRunning) return alert("กำลังมีกระบวนการแปลล่วงหน้าทำงานอยู่ กรุณารอหรือกดยกเลิกก่อน");

  const input = document.getElementById(`batch-input-${bookId}`);
  const count = parseInt(input.value || "5", 10);
  if (isNaN(count) || count < 1) return alert("กรุณาระบุจำนวนบทที่ถูกต้อง (อย่างน้อย 1 บท)");

  let bookChaps = await dbGetChaptersByBook(bookId);
  bookChaps.sort((a, b) => a.order - b.order);
  if (bookChaps.length === 0) return alert("ไม่พบบทตั้งต้นของนิยายเรื่องนี้");

  let lastChap = bookChaps[bookChaps.length - 1];
  let targetUrl = lastChap.nextUrl;

  if (!targetUrl) {
    const inputUrl = prompt(`ไม่พบ URL ตอนถัดไปสำหรับ "${lastChap.title}"\nกรุณาวาง URL ของตอนถัดไป:`, "");
    if (!inputUrl || !inputUrl.trim()) return;
    targetUrl = inputUrl.trim();
    lastChap.nextUrl = targetUrl;
    await dbSaveChapter(lastChap);
  }

  isBatchRunning = true;
  batchCancelRequested = false;
  isBatchComplete = false;

  const progressBox = document.getElementById('batch-progress-box');
  const progressTitle = document.getElementById('batch-progress-title');
  const progressDesc = document.getElementById('batch-progress-desc');
  const actionBtn = document.getElementById('batch-action-btn');

  progressBox.className = 'progress-box';
  progressBox.style.display = 'block';
  progressTitle.innerText = "กำลังแปลล่วงหน้า...";
  actionBtn.className = 'btn btn-danger';
  actionBtn.innerText = "หยุดแปล";

  let successCount = 0;

  for (let i = 1; i <= count; i++) {
    if (batchCancelRequested) {
      progressDesc.innerText = `หยุดการแปลตามคำสั่งแล้ว (แปลและบันทึกเสร็จสิ้น ${successCount} ตอน)`;
      break;
    }

    const urlSegment = targetUrl.substring(targetUrl.lastIndexOf('/'));
    progressDesc.innerText = `กำลังดึงและแปลตอนที่ ${i}/${count}... (URL: ${urlSegment})`;

    try {
      const { text, nextUrl, rawChapTitle, rawBookTitle, author } = await scrapePage(targetUrl);
      if (author) currentAuthor = author;
      
      const prevSummary = lastChap?.summary || "";

      const result = await translateTextWithPingPong(text, (msg) => {
        progressDesc.innerText = `[${i}/${count}] ${msg.substring(0, 32)}...`;
      }, rawChapTitle, rawBookTitle, prevSummary);

      const currentAll = await dbGetChaptersByBook(bookId);
      const maxOrder = currentAll.reduce((max, c) => Math.max(max, c.order || 0), 0);

      const chapTitle = result.chapterTitle || rawChapTitle || `ตอนที่ ${maxOrder + 1}`;

      const newChap = {
        id: `${bookId}_chap_${Date.now()}_${i}`,
        bookId: bookId,
        order: maxOrder + 1,
        title: chapTitle,
        paragraphs: result.paragraphs,
        summary: result.summary || "",
        sourceUrl: targetUrl,
        nextUrl: nextUrl
      };

      await dbSaveChapter(newChap);
      successCount++;
      lastChap = newChap;

      const books = await dbGetAllBooks();
      const targetBook = books.find(b => b.bookId === bookId);
      
      let finalBookTitle = currentBookTitle;
      let customFlag = false;
      if (targetBook) {
        customFlag = targetBook.isUserCustomTitle || false;
        finalBookTitle = customFlag ? targetBook.title : (result.bookTitle || targetBook.title);
      }

      await dbSaveBook({
        bookId: bookId,
        title: finalBookTitle,
        author: currentAuthor,
        genre: targetBook?.genre || currentBookGenre,
        isUserCustomTitle: customFlag,
        lastChapterId: targetBook?.lastChapterId || (currentBookId === bookId ? chapters[currentChapterIndex]?.id : bookChaps[0]?.id),
        lastChapterIndex: (targetBook && targetBook.lastChapterIndex !== undefined) ? targetBook.lastChapterIndex : 0,
        lastChapterTitle: (targetBook && targetBook.lastChapterTitle) ? targetBook.lastChapterTitle : (bookChaps[0]?.title || 'ตอนที่ 1'),
        totalChapters: maxOrder + 1,
        lastUrl: targetUrl,
        updatedAt: Date.now()
      });

      if (currentBookId === bookId) chapters.push(newChap);

      refreshShelfViewOnly(bookId);
      targetUrl = nextUrl;

      if (i < count && !batchCancelRequested) {
        progressDesc.innerText = `บันทึก "${chapTitle}" สำเร็จ พักระบบ 2.5 วิก่อนเริ่มบทถัดไป...`;
        await new Promise(r => setTimeout(r, 2500));
      }
    } catch (err) {
      progressDesc.innerText = `หยุดที่ตอนที่ ${i}: ${err.message === '404' ? 'ไม่พบหน้านิยาย (เลข URL กระโดด)' : err.message}\n(กรุณากดปุ่ม 'แก้ URL ถัดไป' เพื่อใส่ลิงก์ใหม่)`;
      break;
    }
  }

  isBatchRunning = false;
  isBatchComplete = true;
  actionBtn.className = 'btn btn-secondary';
  actionBtn.innerText = "ปิดการแจ้งเตือน";

  if (successCount === count && !batchCancelRequested) {
    progressBox.className = 'progress-box success';
    progressTitle.innerText = "✓ แปลล่วงหน้าเสร็จสมบูรณ์!";
    progressDesc.innerText = `บันทึกเนื้อหาเรียบร้อยแล้วทั้งหมด ${successCount} ตอน พร้อมให้อ่านแบบออฟไลน์`;
  }

  openBookshelfModal();
  checkAndRefreshBottomStatus();
}

function renderChaptersHtml(bookId, bookChaps, readingChapId) {
  if (!bookChaps || bookChaps.length === 0) {
    return '<div style="padding:8px 14px; font-size:11px; opacity:0.5;">ไม่มีตอน</div>';
  }

  let chapsHtml = '';
  bookChaps.forEach((ch) => {
    let isActive = false;
    if (bookId === currentBookId && chapters[currentChapterIndex]) {
      isActive = (ch.id === chapters[currentChapterIndex].id);
    } else if (readingChapId) {
      isActive = (ch.id === readingChapId);
    }

    const activeClass = isActive ? 'active' : '';

    chapsHtml += `
      <div class="chap-subitem ${activeClass}">
        <input type="checkbox" class="chap-chk chk-book-${bookId}" value="${ch.id}" onchange="updateSelectedDeleteBtn('${bookId}')">
        <div class="chap-name-btn" onclick="jumpToChapterById('${bookId}', '${ch.id}')">
          📖 ${ch.title}
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button class="chap-action-btn" style="background:rgba(37,99,235,0.1); color:#2563eb;" onclick="jumpToChapterById('${bookId}', '${ch.id}')">อ่าน</button>
          <button class="chap-action-btn" style="background:rgba(16,185,129,0.1); color:#059669;" onclick="retranslateSpecificChapter(event, '${bookId}', '${ch.id}')" title="แปลบทนี้ใหม่ตามคลังคำศัพท์ล่าสุด">🔄 แปลใหม่</button>
        </div>
      </div>
    `;
  });
  return chapsHtml;
}

async function openBookshelfModal() {
  const listContainer = document.getElementById('bookshelf-list');
  if (!listContainer) return;
  listContainer.innerHTML = '<div style="text-align:center; padding:15px; opacity:0.6;">กำลังเปิดคลังหนังสือ...</div>';
  openModal('bookshelf-modal');

  const books = await dbGetAllBooks();
  books.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (books.length === 0) {
    listContainer.innerHTML = '<div style="text-align:center; padding:20px; opacity:0.6; font-size:13px;">ยังไม่มีนิยายในชั้นหนังสือ วางลิงก์เพื่อเริ่มอ่านตอนแรกได้เลย</div>';
    return;
  }

  listContainer.innerHTML = "";
  for (const b of books) {
    const itemBox = document.createElement('div');
    itemBox.className = 'book-item-container';

    let bookChaps = await dbGetChaptersByBook(b.bookId);
    if (!bookSortModes[b.bookId]) bookSortModes[b.bookId] = 'time_desc';
    applySortToChapters(bookChaps, bookSortModes[b.bookId]);

    const currentSort = bookSortModes[b.bookId];
    const timeBtnLabel = currentSort === 'time_desc' ? 'ล่าสุด ↓' : (currentSort === 'time_asc' ? 'เก่าสุด ↑' : 'เวลา');
    const titleBtnLabel = currentSort === 'title_asc' ? 'ชื่อ ก-ฮ ↓' : (currentSort === 'title_desc' ? 'ชื่อ ฮ-ก ↑' : 'ชื่อ');
    const genreBadge = getGenreThaiName(b.genre || 'xianxia');

    itemBox.innerHTML = `
      <div class="book-card-header">
        <div class="book-info" onclick="toggleBookAccordion('${b.bookId}')">
          <div class="book-title">
            📚 ${b.title || 'นิยายเรื่องใหม่'} 
            <span class="btn" style="padding: 1px 6px; font-size: 10px; margin-left: 6px; background: rgba(37,99,235,0.1); color: #2563eb;" onclick="openGenrePickerModal(event, '${b.bookId}')" title="คลิกเพื่อเลือกแนวเรื่องจากรายการ">
              🏷️ ${genreBadge} ✎
            </span>
            <span style="font-size:11px; font-weight:normal; opacity:0.7;">(▼ ดูตอนย่อย)</span>
          </div>
          <div class="book-meta" id="shelf-meta-${b.bookId}">อ่านค้างไว้: <b>${b.lastChapterTitle || 'ตอนที่ 1'}</b> | รวม ${bookChaps.length} ตอนที่บันทึกไว้</div>
        </div>
        <button class="btn btn-danger" style="padding:4px 8px; font-size:11px;" onclick="removeBookFromShelf(event, '${b.bookId}')">ลบทั้งเรื่อง</button>
      </div>
      <div class="batch-bar">
        <span>แปลล่วงหน้า</span>
        <input type="number" id="batch-input-${b.bookId}" class="form-input" style="width: 50px; padding: 3px 6px; font-size: 12px;" min="1" max="50" value="5">
        <span>บท</span>
        <button class="btn btn-primary" style="padding: 3px 8px; font-size: 11px;" onclick="startBatchTranslateForBook('${b.bookId}')">
          ⚡ เริ่มแปลล่วงหน้า
        </button>
        <button class="btn" style="padding: 3px 6px; font-size: 10px; margin-left: auto;" onclick="fixBookNextUrl('${b.bookId}')" title="แก้ไข URL สำหรับบทถัดไป">
          🔗 แก้ URL ถัดไป
        </button>
      </div>
      
      <div class="shelf-sub-toolbar" id="shelf-sub-bar-${b.bookId}" style="display: none;">
        <div style="display: flex; gap: 4px; align-items: center;">
          <span>เรียง:</span>
          <button class="btn" id="sort-time-btn-${b.bookId}" style="padding: 2px 7px; font-size: 10px;" onclick="toggleSortMode(event, '${b.bookId}', 'time')">
            ${timeBtnLabel}
          </button>
          <button class="btn" id="sort-title-btn-${b.bookId}" style="padding: 2px 7px; font-size: 10px;" onclick="toggleSortMode(event, '${b.bookId}', 'title')">
            ${titleBtnLabel}
          </button>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="btn" style="padding: 2px 6px; font-size: 10px;" onclick="toggleSelectAllChaps('${b.bookId}')">เลือกทั้งหมด</button>
          <button class="btn btn-danger" id="del-selected-btn-${b.bookId}" style="padding: 2px 6px; font-size: 10px; display: none;" onclick="deleteSelectedChapters('${b.bookId}')">ลบที่เลือก</button>
        </div>
      </div>

      <div class="book-chapters-list" id="shelf-chaps-${b.bookId}">
        ${renderChaptersHtml(b.bookId, bookChaps, b.lastChapterId)}
      </div>
    `;
    listContainer.appendChild(itemBox);
  }
}

async function toggleSortMode(e, bookId, type) {
  e.stopPropagation();
  let currentMode = bookSortModes[bookId] || 'time_desc';

  if (type === 'time') bookSortModes[bookId] = (currentMode === 'time_desc') ? 'time_asc' : 'time_desc';
  else if (type === 'title') bookSortModes[bookId] = (currentMode === 'title_asc') ? 'title_desc' : 'title_asc';

  const currentSort = bookSortModes[bookId];
  const timeBtn = document.getElementById(`sort-time-btn-${bookId}`);
  const titleBtn = document.getElementById(`sort-title-btn-${bookId}`);

  if (timeBtn) timeBtn.innerText = currentSort === 'time_desc' ? 'ล่าสุด ↓' : (currentSort === 'time_asc' ? 'เก่าสุด ↑' : 'เวลา');
  if (titleBtn) titleBtn.innerText = currentSort === 'title_asc' ? 'ชื่อ ก-ฮ ↓' : (currentSort === 'title_desc' ? 'ชื่อ ฮ-ก ↑' : 'ชื่อ');

  let bookChaps = await dbGetChaptersByBook(bookId);
  applySortToChapters(bookChaps, currentSort);

  const books = await dbGetAllBooks();
  const b = books.find(x => x.bookId === bookId);

  const listEl = document.getElementById(`shelf-chaps-${bookId}`);
  if (listEl) listEl.innerHTML = renderChaptersHtml(bookId, bookChaps, b?.lastChapterId);
  updateSelectedDeleteBtn(bookId);
}

function applySortToChapters(chapsList, sortMode) {
  if (sortMode === 'time_desc') chapsList.sort((x, y) => y.order - x.order);
  else if (sortMode === 'time_asc') chapsList.sort((x, y) => x.order - y.order);
  else if (sortMode === 'title_asc') chapsList.sort((x, y) => x.title.localeCompare(y.title, 'th', { numeric: true }));
  else if (sortMode === 'title_desc') chapsList.sort((x, y) => y.title.localeCompare(x.title, 'th', { numeric: true }));
}

function toggleBookAccordion(bookId) {
  const list = document.getElementById(`shelf-chaps-${bookId}`);
  const bar = document.getElementById(`shelf-sub-bar-${bookId}`);
  if (list && bar) {
    const isShown = (list.style.display === 'block');
    list.style.display = isShown ? 'none' : 'block';
    bar.style.display = isShown ? 'none' : 'flex';
  }
}

function updateSelectedDeleteBtn(bookId) {
  const chks = document.querySelectorAll(`.chk-book-${bookId}:checked`);
  const delBtn = document.getElementById(`del-selected-btn-${bookId}`);
  if (delBtn) {
    if (chks.length > 0) {
      delBtn.style.display = 'inline-flex';
      delBtn.innerText = `ลบที่เลือก (${chks.length})`;
    } else {
      delBtn.style.display = 'none';
    }
  }
}

function toggleSelectAllChaps(bookId) {
  const chks = document.querySelectorAll(`.chk-book-${bookId}`);
  if (chks.length === 0) return;
  const allChecked = Array.from(chks).every(c => c.checked);
  chks.forEach(c => c.checked = !allChecked);
  updateSelectedDeleteBtn(bookId);
}

async function retranslateSpecificChapter(e, bookId, chapId) {
  e.stopPropagation();
  await retranslateSpecificChapterDirect(chapId);
}

async function openGenrePickerModal(e, bookId) {
  e.stopPropagation();
  bookIdForGenreEdit = bookId;
  const books = await dbGetAllBooks();
  const b = books.find(x => x.bookId === bookId);
  if (!b) return;

  document.getElementById('genre-picker-book-title').innerText = b.title || 'นิยาย';
  document.getElementById('genre-picker-select').value = b.genre || 'xianxia';

  openModal('genre-picker-modal');
}

async function saveChosenBookGenre() {
  if (!bookIdForGenreEdit) return;
  const books = await dbGetAllBooks();
  const b = books.find(x => x.bookId === bookIdForGenreEdit);
  if (!b) return closeModal('genre-picker-modal');

  const selectedGenre = document.getElementById('genre-picker-select').value;
  b.genre = selectedGenre;
  b.updatedAt = Date.now();
  await dbSaveBook(b);

  if (currentBookId === bookIdForGenreEdit) {
    currentBookGenre = selectedGenre;
  }

  closeModal('genre-picker-modal');
  refreshShelfViewOnly(bookIdForGenreEdit);
}

async function refreshShelfViewOnly(bookId) {
  let liveChaps = await dbGetChaptersByBook(bookId);
  applySortToChapters(liveChaps, bookSortModes[bookId] || 'time_desc');
  const listEl = document.getElementById(`shelf-chaps-${bookId}`);
  const metaEl = document.getElementById(`shelf-meta-${bookId}`);
  const books = await dbGetAllBooks();
  const targetBook = books.find(b => b.bookId === bookId);

  if (listEl) listEl.innerHTML = renderChaptersHtml(bookId, liveChaps, targetBook?.lastChapterId);
  if (metaEl && targetBook) {
    metaEl.innerHTML = `อ่านค้างไว้: <b>${targetBook.lastChapterTitle || 'ตอนที่ 1'}</b> | รวม ${liveChaps.length} ตอนที่บันทึกไว้`;
  }
  updateSelectedDeleteBtn(bookId);
}

async function fixBookNextUrl(bookId) {
  const bookChaps = await dbGetChaptersByBook(bookId);
  bookChaps.sort((x, y) => x.order - y.order);
  if (bookChaps.length === 0) return;
  const lastChap = bookChaps[bookChaps.length - 1];

  const input = prompt(`แก้ไข URL ตอนถัดไปสำหรับ "${lastChap.title}":`, lastChap.nextUrl || "");
  if (input && input.trim()) {
    lastChap.nextUrl = input.trim();
    await dbSaveChapter(lastChap);
    if (currentBookId === bookId) nextUrlCalculated = lastChap.nextUrl;
    alert("อัปเดต URL เรียบร้อยแล้ว ตอนนี้สามารถกด 'เริ่มแปลล่วงหน้า' ได้ทันที");
    checkAndRefreshBottomStatus();
  }
}

async function jumpToChapterById(bookId, chapId) {
  await loadBookFromDB(bookId, chapId);
  closeModal('bookshelf-modal');
}
