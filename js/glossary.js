// ==================== GLOSSARY UI & LOGIC ====================
let currentGlossaryCategory = 'all';
let termBeingAssigned = null;

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getActiveGlossaryForCurrentBook() {
  const allItems = await dbGetAllGlossaryItems();
  const activeMap = {};
  allItems.forEach(item => {
    if (item.scope === 'global' || (Array.isArray(item.books) && item.books.includes(currentBookId))) {
      const resolvedTgt = (item.overrides && item.overrides[currentBookId]) ? item.overrides[currentBookId] : item.tgt;
      const cleanTgt = cleanTermString(resolvedTgt);
      if (cleanTgt) {
        activeMap[item.src] = { ...item, resolvedTgt: cleanTgt };
      }
    }
  });
  return activeMap;
}

function applyInlineTermHighlighting(plainThText, activeTerms) {
  if (!plainThText) return "";
  const termEntries = Object.values(activeTerms);
  if (termEntries.length === 0) return plainThText;

  const validTerms = termEntries
    .map(t => ({ ...t, cleanTgt: cleanTermString(t.resolvedTgt) }))
    .filter(t => t.cleanTgt.length >= 1);

  if (validTerms.length === 0) return plainThText;

  validTerms.sort((a, b) => b.cleanTgt.length - a.cleanTgt.length);

  const termMap = new Map();
  validTerms.forEach(t => {
    if (!termMap.has(t.cleanTgt)) {
      termMap.set(t.cleanTgt, t.src);
    }
  });

  const uniqueTgtList = Array.from(termMap.keys());
  const pattern = uniqueTgtList.map(tgt => escapeRegExp(tgt)).join('|');
  const regex = new RegExp(`(${pattern})`, 'g');

  return plainThText.replace(regex, (match) => {
    const srcChar = termMap.get(match) || "";
    return `<span class="inline-term-highlight" data-src="${encodeURIComponent(srcChar)}" data-tgt="${encodeURIComponent(match)}">${match}</span>`;
  });
}

function showTermPopover(e, src, tgt) {
  const popover = document.getElementById('term-popover');
  const textSpan = document.getElementById('popover-text');
  const editBtn = document.getElementById('popover-edit-btn');
  const researchBtn = document.getElementById('popover-research-btn');

  textSpan.innerHTML = `<b>${src}</b> ➔ <span id="popover-tgt-span" style="color:#38bdf8;">${tgt}</span>`;
  
  researchBtn.onclick = async (ev) => {
    ev.stopPropagation();
    researchBtn.disabled = true;
    researchBtn.innerText = "กำลังหา...";
    try {
      const res = await researchGlossaryTermDirect(src);
      if (res && res.tgt) {
        const cleanNewTgt = cleanTermString(res.tgt);
        document.getElementById('popover-tgt-span').innerText = cleanNewTgt;
        await renderGlossaryUI();
        const activeHighlights = document.querySelectorAll(`.inline-term-highlight[data-src="${encodeURIComponent(src)}"]`);
        activeHighlights.forEach(el => {
          el.innerText = cleanNewTgt;
          el.setAttribute('data-tgt', encodeURIComponent(cleanNewTgt));
        });
      }
    } finally {
      researchBtn.disabled = false;
      researchBtn.innerText = "🔄 ค้นหาใหม่";
    }
  };

  editBtn.onclick = (ev) => {
    ev.stopPropagation();
    popover.style.display = 'none';
    openEditTermModal(src);
  };

  popover.style.display = 'flex';
  const rect = e.target.getBoundingClientRect();
  popover.style.top = `${rect.bottom + 6}px`;
  popover.style.left = `${Math.min(window.innerWidth - 260, Math.max(10, rect.left))}px`;
}

function setupPopoverDelegation() {
  document.addEventListener('click', (e) => {
    const highlightEl = e.target.closest('.inline-term-highlight');
    if (highlightEl) {
      e.stopPropagation();
      const src = decodeURIComponent(highlightEl.getAttribute('data-src') || '');
      const tgt = decodeURIComponent(highlightEl.getAttribute('data-tgt') || '');
      showTermPopover(e, src, tgt);
    } else {
      const popover = document.getElementById('term-popover');
      if (popover && !popover.contains(e.target)) {
        popover.style.display = 'none';
      }
    }
  });
}

async function openGlossaryModal() {
  const bookContextEl = document.getElementById('glossary-book-context');
  if (bookContextEl) {
    const authorLabel = currentAuthor ? ` | ผู้แต่ง: ${currentAuthor}` : '';
    const genreLabel = getGenreThaiName(currentBookGenre);
    bookContextEl.innerText = `เรื่องปัจจุบัน: ${currentBookTitle}${authorLabel} (แนว: ${genreLabel})`;
  }
  await refreshGlossaryScopeDropdown();
  await renderGlossaryUI();
  openModal('glossary-modal');
}

async function refreshGlossaryScopeDropdown() {
  const selectEl = document.getElementById('gloss-scope-filter');
  if (!selectEl) return;

  const previousVal = selectEl.value;
  const books = await dbGetAllBooks();

  let optionsHtml = '';
  books.forEach(b => {
    const isCurrent = (b.bookId === currentBookId);
    const label = isCurrent ? `📚 ${b.title} (เรื่องปัจจุบัน)` : `📚 ${b.title}`;
    optionsHtml += `<option value="book_${b.bookId}">${label}</option>`;
  });

  optionsHtml += `
    <option value="global">🌐 คำสากลเท่านั้น (Global)</option>
    <option value="all">📦 คำทั้งหมดในคลัง (All Terms)</option>
  `;

  selectEl.innerHTML = optionsHtml;
  if (previousVal && selectEl.querySelector(`option[value="${previousVal}"]`)) {
    selectEl.value = previousVal;
  } else {
    selectEl.value = `book_${currentBookId}`;
  }
}

function switchGlossaryCategory(cat, e) {
  currentGlossaryCategory = cat;
  document.querySelectorAll('.cat-tab-btn').forEach(b => b.classList.remove('active'));
  if (e && e.target) e.target.classList.add('active');
  renderGlossaryUI();
}

function getCategoryLabel(cat) {
  switch(cat) {
    case 'character': return '👤 บุคคล/สัตว์';
    case 'title': return '🎖️ ตำแหน่ง';
    case 'location': return '🏔 สถานที่';
    case 'skill': return '📜 ทักษะ/วิชา';
    case 'equipment': return '🗡️️ อุปกรณ์';
    case 'resource': return '💊 ทรัพยากร';
    case 'realm': return '🧬 ลำดับขั้น';
    default: return '🏷️ อื่นๆ';
  }
}

async function renderGlossaryUI() {
  const list = document.getElementById('glossary-list');
  if (!list) return;
  list.innerHTML = "";

  const books = await dbGetAllBooks();
  const bookMap = new Map();
  books.forEach(b => bookMap.set(b.bookId, b.title));

  let items = await dbGetAllGlossaryItems();
  const scopeFilter = document.getElementById('gloss-scope-filter')?.value || `book_${currentBookId}`;
  const sortMode = document.getElementById('gloss-sort-select').value;
  const query = document.getElementById('gloss-search-input').value.trim().toLowerCase();

  if (scopeFilter.startsWith('book_')) {
    const targetBId = scopeFilter.replace('book_', '');
    items = items.filter(it => Array.isArray(it.books) && it.books.includes(targetBId));
  } else if (scopeFilter === 'global') {
    items = items.filter(it => it.scope === 'global');
  }

  if (currentGlossaryCategory !== 'all') {
    items = items.filter(it => it.category === currentGlossaryCategory);
  }

  if (query) {
    items = items.filter(it => it.src.toLowerCase().includes(query) || it.tgt.toLowerCase().includes(query));
  }

  if (sortMode === 'count_desc') items.sort((a, b) => (b.count || 1) - (a.count || 1));
  else if (sortMode === 'time_desc') items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  else if (sortMode === 'time_asc') items.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  else if (sortMode === 'th_asc') items.sort((a, b) => a.tgt.localeCompare(b.tgt, 'th'));
  else if (sortMode === 'th_desc') items.sort((a, b) => b.tgt.localeCompare(a.tgt, 'th'));
  else if (sortMode === 'len_desc') items.sort((a, b) => b.src.length - a.src.length);

  if (items.length === 0) {
    list.innerHTML = `<div style="text-align:center; padding:20px; opacity:0.5; font-size:12px;">ไม่พบคำศัพท์ที่ตรงกับเงื่อนไขในหมวดหมู่นี้</div>`;
    updateGlossaryBatchToolbar();
    return;
  }

  items.forEach(data => {
    const isGlobal = data.scope === 'global';
    const isCurrentAttached = Array.isArray(data.books) && data.books.includes(currentBookId);

    let bookTagsHtml = '';
    if (isGlobal) {
      bookTagsHtml = `<span class="gloss-scope-tag gloss-scope-global" onclick="openBookAssignModal('${data.src}')" title="คำนี้ใช้ได้กับทุกเรื่อง (คลิกเพื่อแก้ไข)">🌐 สากล</span>`;
    } else {
      const bookNames = (data.books || []).map(bId => bookMap.get(bId) || 'ไม่ทราบชื่อเรื่อง');
      const labelText = bookNames.length > 0 ? (bookNames.length === 1 ? bookNames[0] : `${bookNames[0]} (+${bookNames.length - 1})`) : 'ไม่มีแท็ก';
      bookTagsHtml = `<span class="gloss-scope-tag gloss-scope-local" onclick="openBookAssignModal('${data.src}')" title="คลิกเพื่อจัดการเรื่องที่ใช้งาน: ${bookNames.join(', ')}">🏷️ ${labelText}</span>`;
    }

    const attachBtn = (!isGlobal && !isCurrentAttached) ? 
      `<button class="btn" style="padding:1px 4px; font-size:9px; background:rgba(37,99,235,0.1); color:#2563eb;" onclick="quickAttachCurrentBook('${data.src}')" title="ดึงคำนี้มาใช้กับเรื่องปัจจุบัน">+ ใช้กับเรื่องนี้</button>` : '';

    const row = document.createElement('div');
    row.className = 'gloss-item-row';
    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; flex:1; overflow:hidden;">
        <input type="checkbox" class="gloss-item-chk" value="${data.src}" onchange="updateGlossaryBatchToolbar()" style="cursor:pointer; accent-color:#2563eb;">
        <div style="flex: 1; overflow: hidden;">
          <div style="display:flex; align-items:center; gap:5px; flex-wrap: wrap;">
            <span class="gloss-badge">${getCategoryLabel(data.category)}</span>
            ${bookTagsHtml}
            ${attachBtn}
            <b>${data.src}</b> ➔ <span id="gloss-tgt-val-${data.src}" style="color:#2563eb; font-weight:600;">${data.tgt}</span>
            <span style="font-size:10px; opacity:0.4;">(${data.count || 1})</span>
          </div>
        </div>
      </div>
      <div style="display:flex; gap:4px; align-items:center; shrink: 0;">
        <button class="btn" style="padding:2px 6px; font-size:10px;" id="btn-research-${data.src}" onclick="researchGlossaryTerm('${data.src}')" title="ค้นหาคำแปลยอดนิยมตามลำดับขั้น 3-Tier">🔄</button>
        <button class="btn" style="padding:2px 6px; font-size:10px;" onclick="openEditTermModal('${data.src}')">✎</button>
        <button class="btn btn-danger" style="padding:2px 6px; font-size:10px;" onclick="delGloss('${data.src}')">✕</button>
      </div>
    `;
    list.appendChild(row);
  });

  updateGlossaryBatchToolbar();
}

function updateGlossaryBatchToolbar() {
  const chks = document.querySelectorAll('.gloss-item-chk:checked');
  const bar = document.getElementById('gloss-batch-toolbar');
  const countEl = document.getElementById('gloss-batch-count');
  if (bar) {
    if (chks.length > 0) {
      bar.style.display = 'flex';
      countEl.innerText = `เลือกไว้ ${chks.length} คำ`;
    } else {
      bar.style.display = 'none';
    }
  }
}

function toggleSelectAllGlossary() {
  const chks = document.querySelectorAll('.gloss-item-chk');
  if (chks.length === 0) return;
  const allChecked = Array.from(chks).every(c => c.checked);
  chks.forEach(c => c.checked = !allChecked);
  updateGlossaryBatchToolbar();
}

async function batchDeleteSelectedTerms() {
  const chks = document.querySelectorAll('.gloss-item-chk:checked');
  if (chks.length === 0) return;
  if (!confirm(`ต้องการลบคำศัพท์ที่เลือกจำนวน ${chks.length} คำใช่หรือไม่?`)) return;

  const srcList = Array.from(chks).map(c => c.value);
  await dbDeleteMultipleGlossaryItems(srcList);
  await renderGlossaryUI();
  renderVirtualWindow(currentChapterIndex);
}

async function batchSetScopeGlobal(isGlobal) {
  const chks = document.querySelectorAll('.gloss-item-chk:checked');
  if (chks.length === 0) return;

  const items = await dbGetAllGlossaryItems();
  const srcList = Array.from(chks).map(c => c.value);

  for (const s of srcList) {
    const it = items.find(x => x.src === s);
    if (it) {
      it.scope = isGlobal ? 'global' : 'tagged';
      it.updatedAt = Date.now();
      await dbSaveGlossaryItem(it);
    }
  }
  await renderGlossaryUI();
  renderVirtualWindow(currentChapterIndex);
}

async function batchResearchSelectedTerms() {
  const chks = document.querySelectorAll('.gloss-item-chk:checked');
  if (chks.length === 0) return;

  const count = chks.length;
  if (!confirm(`ต้องการเริ่มให้ AI รีเสิร์ชคำศัพท์ที่เลือกจำนวน ${count} คำแบบเรียงคิวอัตโนมัติใช่หรือไม่?`)) return;

  const srcList = Array.from(chks).map(c => c.value);
  const countEl = document.getElementById('gloss-batch-count');

  for (let i = 0; i < srcList.length; i++) {
    const src = srcList[i];
    countEl.innerText = `กำลังรีเสิร์ช (${i+1}/${count}): ${src}...`;
    await researchGlossaryTermDirect(src);
    if (i < srcList.length - 1) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  await renderGlossaryUI();
  renderVirtualWindow(currentChapterIndex);
  alert(`✓ รีเสิร์ชคำศัพท์เสร็จสมบูรณ์ทั้ง ${count} คำ`);
}

async function openBookAssignModal(src) {
  termBeingAssigned = src;
  const titleEl = document.getElementById('assign-term-title');
  const container = document.getElementById('assign-books-list');
  titleEl.innerText = src;
  container.innerHTML = '<div style="text-align:center; padding:10px;">กำลังโหลด...</div>';
  openModal('book-assign-modal');

  const items = await dbGetAllGlossaryItems();
  const cur = items.find(x => x.src === src);
  if (!cur) return closeModal('book-assign-modal');

  const books = await dbGetAllBooks();
  let html = `
    <label style="display:flex; align-items:center; gap:8px; padding:6px; border-bottom:1px solid rgba(0,0,0,0.06); cursor:pointer; font-weight:600;">
      <input type="checkbox" id="assign-global-chk" ${cur.scope === 'global' ? 'checked' : ''} style="cursor:pointer; accent-color:#2563eb;">
      <span>🌐 ใช้งานได้กับทุกเรื่อง (Global)</span>
    </label>
  `;

  books.forEach(b => {
    const isChecked = Array.isArray(cur.books) && cur.books.includes(b.bookId);
    html += `
      <label style="display:flex; align-items:center; gap:8px; padding:6px; cursor:pointer; font-size:12px;">
        <input type="checkbox" class="assign-book-chk" value="${b.bookId}" ${isChecked ? 'checked' : ''} style="cursor:pointer; accent-color:#2563eb;">
        <span>📚 ${b.title}</span>
      </label>
    `;
  });

  container.innerHTML = html;
}

async function openBatchBookAssignModal() {
  const chks = document.querySelectorAll('.gloss-item-chk:checked');
  if (chks.length === 0) return;

  termBeingAssigned = null;
  const titleEl = document.getElementById('assign-term-title');
  const container = document.getElementById('assign-books-list');
  titleEl.innerText = `ทั้งหมด (${chks.length}) คำที่เลือก`;
  container.innerHTML = '<div style="text-align:center; padding:10px;">กำลังโหลด...</div>';
  openModal('book-assign-modal');

  const books = await dbGetAllBooks();
  let html = `
    <label style="display:flex; align-items:center; gap:8px; padding:6px; border-bottom:1px solid rgba(0,0,0,0.06); cursor:pointer; font-weight:600;">
      <input type="checkbox" id="assign-global-chk" style="cursor:pointer; accent-color:#2563eb;">
      <span>🌐 ใช้งานได้กับทุกเรื่อง (Global)</span>
    </label>
  `;

  books.forEach(b => {
    const isCurrent = (b.bookId === currentBookId);
    html += `
      <label style="display:flex; align-items:center; gap:8px; padding:6px; cursor:pointer; font-size:12px;">
        <input type="checkbox" class="assign-book-chk" value="${b.bookId}" ${isCurrent ? 'checked' : ''} style="cursor:pointer; accent-color:#2563eb;">
        <span>📚 ${b.title}</span>
      </label>
    `;
  });

  container.innerHTML = html;
}

async function saveBookAssignment() {
  const isGlobal = document.getElementById('assign-global-chk').checked;
  const chks = document.querySelectorAll('.assign-book-chk:checked');
  const selectedBooks = Array.from(chks).map(c => c.value);

  const items = await dbGetAllGlossaryItems();

  if (termBeingAssigned) {
    const cur = items.find(x => x.src === termBeingAssigned);
    if (cur) {
      cur.scope = isGlobal ? 'global' : 'tagged';
      cur.books = selectedBooks;
      cur.updatedAt = Date.now();
      await dbSaveGlossaryItem(cur);
    }
  } else {
    const selectedGlossChks = document.querySelectorAll('.gloss-item-chk:checked');
    const srcList = Array.from(selectedGlossChks).map(c => c.value);

    for (const src of srcList) {
      const cur = items.find(x => x.src === src);
      if (cur) {
        cur.scope = isGlobal ? 'global' : 'tagged';
        cur.books = [...selectedBooks];
        cur.updatedAt = Date.now();
        await dbSaveGlossaryItem(cur);
      }
    }
  }

  closeModal('book-assign-modal');
  await refreshGlossaryScopeDropdown();
  await renderGlossaryUI();
  renderVirtualWindow(currentChapterIndex);
}

async function quickAttachCurrentBook(src) {
  const items = await dbGetAllGlossaryItems();
  const cur = items.find(x => x.src === src);
  if (cur) {
    if (!Array.isArray(cur.books)) cur.books = [];
    if (!cur.books.includes(currentBookId)) {
      cur.books.push(currentBookId);
      cur.updatedAt = Date.now();
      await dbSaveGlossaryItem(cur);
      await renderGlossaryUI();
      renderVirtualWindow(currentChapterIndex);
    }
  }
}

async function addGlossary() {
  const s = cleanTermString(document.getElementById('gloss-src').value);
  const t = cleanTermString(document.getElementById('gloss-tgt').value);
  const cat = document.getElementById('gloss-cat').value;

  if (!s || !t) return alert("กรุณาใส่ทั้งคำจีนและคำแปลไทย");

  const existing = (await dbGetAllGlossaryItems()).find(it => it.src === s);
  const booksList = existing && Array.isArray(existing.books) ? existing.books : [];
  if (!booksList.includes(currentBookId)) booksList.push(currentBookId);

  const oldTgt = existing ? existing.tgt : null;

  await dbSaveGlossaryItem({
    src: s,
    tgt: t,
    category: cat,
    scope: existing ? existing.scope : 'tagged',
    books: booksList,
    count: existing ? (existing.count || 1) + 1 : 1,
    overrides: existing?.overrides || {},
    updatedAt: Date.now()
  });

  if (oldTgt && oldTgt !== t) {
    await syncUpdatedTermAcrossChapters(s, oldTgt, t);
  }

  document.getElementById('gloss-src').value = "";
  document.getElementById('gloss-tgt').value = "";
  await renderGlossaryUI();
  renderVirtualWindow(currentChapterIndex);
}

async function openEditTermModal(src) {
  termBeingEditedSrc = src;
  const items = await dbGetAllGlossaryItems();
  const cur = items.find(x => x.src === src);
  if (!cur) return;

  document.getElementById('edit-term-src-label').innerText = src;
  document.getElementById('edit-term-tgt-input').value = cleanTermString(cur.tgt);
  document.getElementById('edit-term-cat-select').value = cur.category || "character";

  openModal('edit-term-modal');
  setTimeout(() => document.getElementById('edit-term-tgt-input').focus(), 150);
}

async function saveEditedGlossaryTerm() {
  if (!termBeingEditedSrc) return;
  const items = await dbGetAllGlossaryItems();
  const cur = items.find(x => x.src === termBeingEditedSrc);
  if (!cur) return closeModal('edit-term-modal');

  const newTgt = cleanTermString(document.getElementById('edit-term-tgt-input').value);
  const newCat = document.getElementById('edit-term-cat-select').value;

  if (!newTgt) return alert("กรุณาระบุคำแปลภาษาไทย");

  const oldTgt = cur.tgt;
  cur.tgt = newTgt;
  cur.category = newCat;
  cur.updatedAt = Date.now();

  await dbSaveGlossaryItem(cur);

  if (oldTgt && oldTgt !== newTgt) {
    await syncUpdatedTermAcrossChapters(termBeingEditedSrc, oldTgt, newTgt);
  }

  closeModal('edit-term-modal');
  await renderGlossaryUI();
  renderVirtualWindow(currentChapterIndex);
}

async function researchGlossaryTermDirect(src) {
  const activeKey = getActiveApiKey();
  const genre = currentBookGenre || "xianxia";
  const primaryModel = (localStorage.getItem('nov_primary_model') || "gemini-3.5-flash-lite").trim();
  if (!activeKey) return null;

  const authorCtx = currentAuthor ? `ผู้แต่ง: "${currentAuthor}"` : '';
  const bookCtx = currentBookTitle ? `นิยายเรื่อง: "${currentBookTitle}"` : '';

  const prompt = `คุณคือผู้เชี่ยวชาญการแปลนิยายจีนมืออาชีพ
ข้อมูลบริบท: ${bookCtx} ${authorCtx} แนวเรื่อง: "${genre}"
คำศัพท์ที่ต้องวิเคราะห์: "${src}"

จงสืบค้นและกำหนดคำแปลภาษาไทยตามลำดับขั้นบันได 3 ระดับ (Tiered Resolution):
1. Tier 1 (ตรงเรื่อง): หากคำนี้เป็นชื่อตัวละคร สถานที่ หรือวิชาในเรื่อง "${currentBookTitle}" ให้ใช้คำแปล/ทับศัพท์ที่ตรงกับฉบับแปลไทยที่เผยแพร่แล้ว
2. Tier 2 (ผู้แต่ง/จักรวาลเดียวกัน): หากไม่พบในเรื่องนี้ ให้เทียบเคียงกับศัพท์ที่ใช้ในผลงานอื่นของผู้แต่ง ${authorCtx} ในจักรวาลเดียวกัน
3. Tier 3 (มาตรฐานวรรณกรรมประจำแนว): หากเป็นคำใหม่ ให้แปลอย่างสละสลวยตามมาตรฐานวรรณกรรมนิยายแนว "${genre}"

เลือก 1 ใน 7 หมวดหมู่นี้:
- "character": บุคคล, สิ่งมีชีวิต, สัตว์อสูร
- "title": ตำแหน่ง, ฐานะ, คำเรียกขาน
- "location": สถานที่, สำนัก, เมือง, ดินแดน
- "skill": ทักษะ, วิชา, เคล็ดวิชา
- "equipment": อุปกรณ์, อาวุธ, เทคโนโลยี
- "resource": ทรัพยากร, โอสถ, สมุนไพร, แร่
- "realm": ลำดับขั้น, ขอบเขตพลัง, สเตตัส

ตอบกลับเป็น JSON เท่านั้น:
{
  "tgt": "คำแปลไทยที่ถูกต้องและสละสลวยที่สุด (ห้ามมีคำสร้อย ห้ามมีวงเล็บ และห้ามมีช่องว่างเกิน)",
  "category": "character|title|location|skill|equipment|resource|realm"
}`;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${primaryModel}:generateContent?key=${activeKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    if (!res.ok) {
      if (res.status === 429) rotateApiKey();
      return null;
    }
    const data = await res.json();
    const parsed = JSON.parse(data.candidates[0].content.parts[0].text);

    if (parsed.tgt) {
      const cleanNewTgt = cleanTermString(parsed.tgt);
      const items = await dbGetAllGlossaryItems();
      const cur = items.find(x => x.src === src);
      if (cur) {
        const oldTgt = cur.tgt;
        cur.tgt = cleanNewTgt;
        if (parsed.category) cur.category = parsed.category;
        cur.updatedAt = Date.now();
        await dbSaveGlossaryItem(cur);

        if (oldTgt && oldTgt !== cleanNewTgt) {
          await syncUpdatedTermAcrossChapters(src, oldTgt, cleanNewTgt);
        }
      }
      return { tgt: cleanNewTgt, category: parsed.category };
    }
  } catch (err) {
    console.warn("Direct lookup failed:", err);
  }
  return null;
}

async function researchGlossaryTerm(src) {
  const activeKey = getActiveApiKey();
  if (!activeKey) return alert("กรุณาใส่ API Key ในเมนู 'ตั้งค่า' ก่อนใช้งาน");

  const tgtEl = document.getElementById(`gloss-tgt-val-${src}`);
  const btnEl = document.getElementById(`btn-research-${src}`);
  if (btnEl) btnEl.disabled = true;
  if (tgtEl) tgtEl.innerText = "กำลังรีเสิร์ช...";

  try {
    const res = await researchGlossaryTermDirect(src);
    if (res && res.tgt) {
      const items = await dbGetAllGlossaryItems();
      const cur = items.find(x => x.src === src);
      if (cur && tgtEl) tgtEl.innerText = cur.tgt;
    }
  } catch (err) {
    alert("รีเสิร์ชไม่สำเร็จ: " + err.message);
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

async function autoOrganizeGlossaryWithAI() {
  const activeKey = getActiveApiKey();
  const primaryModel = (localStorage.getItem('nov_primary_model') || "gemini-3.5-flash-lite").trim();
  const genre = currentBookGenre || "xianxia";

  if (!activeKey) return alert("กรุณาใส่ API Key ในเมนู 'ตั้งค่า' ก่อน");

  let items = await dbGetAllGlossaryItems();
  if (items.length === 0) return alert("ไม่มีคำศัพท์ในคลัง");

  if (!confirm(`ต้องการให้ AI วิเคราะห์และจัดหมวดหมู่คำศัพท์ทั้งหมด ${items.length} คำ ลงใน 7 หมวดหมู่อัตโนมัติใช่หรือไม่?`)) return;

  const termList = items.map(it => ({ src: it.src, tgt: it.tgt }));
  const prompt = `คุณคือบรรณาธิการนิยายแนว "${genre}"
จงวิเคราะห์รายการคำศัพท์เฉพาะเหล่านี้ และจัดกลุ่มคำศัพท์แต่ละคำลงใน 1 ใน 7 หมวดหมู่ที่เหมาะสมที่สุด:
- "character": บุคคล, ตัวละคร, สัตว์อสูร, เผ่าพันธุ์
- "title": ตำแหน่ง, ฐานะ, คำเรียกขาน
- "location": สถานที่, สำนัก, ตระกูล, เมือง, ดวงดาว
- "skill": ทักษะ, วิชา, เคล็ดวิชา, เวทมนตร์
- "equipment": อาวุธ, สมบัติวิเศษ, อุปกรณ์เทคโน
- "resource": เม็ดยาโอสถ, สมุนไพร, แร่, วัตถุดิบ
- "realm": ขอบเขตพลัง, ลำดับขั้น, เลเวล, แรงก์

รายการคำศัพท์:
${JSON.stringify(termList)}

ตอบกลับเป็น JSON เท่านั้น:
{
  "classified": [
    { "src": "คำจีน", "category": "character|title|location|skill|equipment|resource|realm" }
  ]
}`;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${primaryModel}:generateContent?key=${activeKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    if (!res.ok) throw new Error("ยิง API ไม่สำเร็จ");
    const data = await res.json();
    const parsed = JSON.parse(data.candidates[0].content.parts[0].text);

    let updatedCount = 0;
    if (Array.isArray(parsed.classified)) {
      for (const c of parsed.classified) {
        const it = items.find(x => x.src === c.src);
        if (it && it.category !== c.category) {
          it.category = c.category;
          it.updatedAt = Date.now();
          await dbSaveGlossaryItem(it);
          updatedCount++;
        }
      }
    }
    await renderGlossaryUI();
    alert(`✓ จัดระเบียบเสร็จสมบูรณ์! อัปเดตหมวดหมู่คำศัพท์ไปทั้งหมด ${updatedCount} คำ`);
  } catch (err) {
    alert("จัดหมวดหมู่อัตโนมัติไม่สำเร็จ: " + err.message);
  }
}

async function delGloss(src) {
  if (!confirm(`ต้องการลบคำว่า "${src}" ออกจากคลังศัพท์ใช่หรือไม่?`)) return;
  await dbDeleteGlossaryItem(src);
  await renderGlossaryUI();
  renderVirtualWindow(currentChapterIndex);
}

async function extractAndStoreAutoGlossary(rawText, modelToUse, signal = null) {
  const isAutoGlossaryEnabled = localStorage.getItem('nov_enable_auto_glossary') !== 'false';
  if (!isAutoGlossaryEnabled) return 0;

  const activeKey = getActiveApiKey();
  const genre = currentBookGenre || "xianxia";
  const isDeepNer = localStorage.getItem('nov_enable_deep_ner') === 'true';
  if (!activeKey) return 0;

  const existingItems = await dbGetAllGlossaryItems();
  const existingTerms = existingItems.map(x => x.src);

  const authorCtx = currentAuthor ? `ผู้แต่ง: "${currentAuthor}"` : '';
  const bookCtx = currentBookTitle ? `นิยายเรื่อง: "${currentBookTitle}"` : '';

  const prompt = `คุณคือผู้เชี่ยวชาญการแปลนิยายจีนแนว "${genre}"
บริบทเรื่อง: ${bookCtx} ${authorCtx}
จงวิเคราะห์ข้อความภาษาจีนต่อไปนี้อย่างละเอียด และสกัดหา "ชื่อเฉพาะใหม่" ทั้งหมดที่สำคัญต่อความต่อเนื่อง โดยเฉพาะ:
1. **ลำดับขั้นและระดับพลัง (Realms & Stages):** คำบอกระดับพลังทุกคำ เช่น ขอบเขตหลอม, สร้างฐานราก, แก่นทองคำ, ก่อกำเนิด, รวมวิญญาณ
2. **ข้อความในวงเล็บทึบ 【 】 หรือ [ ]:** มักเป็นชื่อวิชา มรรคผล ธาตุกำเนิด หรือสถานะพิเศษ (เช่น 【大海水】, 【石榴木】, 【城头土】) ให้สกัดคำที่อยู่ข้างในออกมาด้วยเสมอ
3. **ชื่อเฉพาะทั่วไป:** ตัวละคร, สัตว์อสูร, สถานที่, สำนัก, วิชา, เคล็ดวิชา, สมบัติ, ยาโอสถ
${isDeepNer ? `4. **คำประสมพิเศษและฉายา:** ฉายาตัวละคร, คำเรียกเฉพาะของเผ่าพันธุ์, ตำแหน่งเฉพาะถิ่น` : ''}

จัดลง 7 หมวดหมู่:
- "character": บุคคล, ตัวละคร, สัตว์อสูร, เผ่าพันธุ์
- "title": ตำแหน่ง, ฐานะ, คำเรียกขาน
- "location": สำนัก, เมือง, ภูเขา, ตระกูล, ดินแดน
- "skill": วิชา, ทักษะยุทธ, คัมภีร์, สกิล
- "equipment": อาวุธ, สมบัติวิเศษ, อุปกรณ์เทคโน
- "resource": โอสถ, สมุนไพร, หินพลังงาน, แร่
- "realm": ขอบเขตลมปราณ, ลำดับขั้น, เลเวล, ระดับพลัง

ข้อกำหนด:
1. ห้ามเลือกคำทั่วไป (เช่น พ่อ, แม่, ประตู, ท้องฟ้า)
2. คำที่มีอยู่แล้วห้ามส่งซ้ำ: [${existingTerms.slice(-60).join(', ')}]
3. คำแปลไทยใน "tgt" ต้องเป็นชื่อเฉพาะตรงตัว **ห้ามใส่วงเล็บทึบ 【 】 หรือเครื่องหมายคำพูดใดๆ ติดมา**

ตอบกลับเป็น JSON เท่านั้น:
{
  "newTerms": [
    { "src": "คำจีน", "tgt": "คำแปลไทยมาตรฐาน", "category": "character|title|location|skill|equipment|resource|realm" }
  ]
}`;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${activeKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${prompt}\n\nเนื้อหาบท:\n${rawText}` }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const outText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (outText) {
        const parsed = JSON.parse(outText);
        const items = parsed.newTerms || [];
        let addedCount = 0;
        for (const item of items) {
          if (item.src && item.tgt) {
            const cleanSrc = cleanTermString(item.src);
            const cleanTgt = cleanTermString(item.tgt);
            const existing = existingItems.find(x => x.src === cleanSrc);
            if (!existing) {
              await dbSaveGlossaryItem({
                src: cleanSrc,
                tgt: cleanTgt,
                category: item.category || 'character',
                scope: 'tagged',
                books: [currentBookId],
                count: 1,
                overrides: {},
                updatedAt: Date.now()
              });
              addedCount++;
            } else {
              if (!existing.books.includes(currentBookId)) existing.books.push(currentBookId);
              existing.count = (existing.count || 1) + 1;
              existing.updatedAt = Date.now();
              await dbSaveGlossaryItem(existing);
            }
          }
        }
        return addedCount;
      }
    }
  } catch (err) {
    console.warn("Auto-Glossary scan skipped:", err.message);
  }
  return 0;
}

async function scanTermsInCurrentChapter() {
  const curChap = chapters[currentChapterIndex];
  if (!curChap || !Array.isArray(curChap.paragraphs) || curChap.paragraphs.length === 0) {
    return alert("ไม่พบเนื้อหาในบทปัจจุบันสำหรับสแกน");
  }

  const activeKey = getActiveApiKey();
  if (!activeKey) return alert("กรุณาใส่ API Key ในเมนู 'ตั้งค่า' ก่อนใช้งาน");

  const primaryModel = (localStorage.getItem('nov_primary_model') || "gemini-3.5-flash-lite").trim();
  const btn = document.getElementById('scan-terms-btn');
  const originalText = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-icon" style="margin:0; width:12px; height:12px;"></span>`;
  showGlobalToast(`กำลังสแกนหาคำศัพท์เฉพาะใน "${curChap.title}"...`);

  const srcText = curChap.paragraphs.map(p => p.src || "").filter(Boolean).join("\n\n");

  try {
    const addedCount = await extractAndStoreAutoGlossary(srcText, primaryModel);
    if (addedCount > 0) {
      alert(`✓ สแกน "${curChap.title}" เสร็จสิ้น!\nพบชื่อเฉพาะใหม่ ${addedCount} คำ และบันทึกเข้าคลังคำศัพท์เรียบร้อยแล้ว\n(หากต้องการให้บทนี้เปลี่ยนคำตามศัพท์ใหม่ สามารถกดปุ่ม 🔄 ที่มุมขวาบนเพื่อแปลใหม่ได้ทันที)`);
    } else {
      alert(`ตรวจสอบ "${curChap.title}" เรียบร้อยแล้ว ไม่พบชื่อเฉพาะใหม่ตกหล่น (ทุกคำมีอยู่ในคลังแล้ว)`);
    }
    await renderGlossaryUI();
    renderVirtualWindow(currentChapterIndex);
  } catch (err) {
    alert("สแกนไม่สำเร็จ: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
    hideGlobalToast();
  }
}
