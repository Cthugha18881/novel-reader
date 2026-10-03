// ============================================================================
// NOVELTRANSLATE AI - BOOKSHELF MODULE (shelf.js)
// ============================================================================

async function renderBookshelfUI() {
  const grid = document.getElementById('bookshelf-grid');
  if (!grid) return;

  const books = await dbGetAllBooks();
  grid.innerHTML = '';

  if (books.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; opacity: 0.6;">
        ยังไม่มีนิยายในชั้นหนังสือ เริ่มต้นด้วยการกดปุ่ม "+ วางลิงก์"
      </div>
    `;
    return;
  }

  for (const b of books) {
    const chaps = await dbGetChaptersByBook(b.id);
    const card = document.createElement('div');
    card.className = `book-card ${b.id === currentBookId ? 'active-book' : ''}`;
    card.style.cssText = `border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; padding: 14px; background: rgba(255,255,255,0.03); display: flex; flex-direction: column; justify-content: space-between;`;

    card.innerHTML = `
      <div>
        <h4 style="margin: 0 0 6px 0; font-size: 15px; color: #2563eb;">${escapeHtml(b.title)}</h4>
        <div style="font-size: 12px; opacity: 0.7; margin-bottom: 4px;">แนวเรื่อง: ${b.genre || 'ทั่วไป'}</div>
        <div style="font-size: 12px; opacity: 0.7;">จำนวนตอนในเครื่อง: ${chaps.length} ตอน</div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 14px;">
        <button class="btn btn-sm btn-primary" onclick="selectBookToRead('${b.id}')" style="flex:1;">อ่านเรื่องนี้</button>
        <button class="btn btn-sm btn-danger" onclick="confirmDeleteBook('${b.id}', '${escapeHtml(b.title)}')">ลบ</button>
      </div>
    `;
    grid.appendChild(card);
  }
}

async function selectBookToRead(bookId) {
  currentBookId = bookId;
  localStorage.setItem('nov_current_book_id', bookId);
  closeModal('bookshelf-modal');
  await refreshLocalData();
}

async function confirmDeleteBook(bookId, title) {
  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบนิยายเรื่อง "${title}" และตอนทั้งหมดออกจากเครื่อง?`)) return;

  await dbDeleteBook(bookId);
  if (currentBookId === bookId) {
    currentBookId = null;
    localStorage.removeItem('nov_current_book_id');
  }
  await renderBookshelfUI();
  await refreshLocalData();
}
