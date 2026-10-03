// ============================================================================
// NOVELTRANSLATE AI - UNIVERSAL GLOSSARY MODULE (glossary.js)
// ============================================================================

window.inMemoryGlossaryCache = window.inMemoryGlossaryCache || [];
let currentGlossaryCategory = 'all';
let selectedGlossarySrcs = new Set();

async function loadGlossaryFromDb() {
  if (typeof dbGetAllGlossary === 'function') {
    window.inMemoryGlossaryCache = await dbGetAllGlossary() || [];
  } else {
    window.inMemoryGlossaryCache = [];
  }
}

async function getActiveGlossaryForCurrentBook() {
  const map = {};
  const list = window.inMemoryGlossaryCache || [];

  list.forEach(item => {
    const isGlobal = item.scope === 'global';
    const isTagged = Array.isArray(item.books) && item.books.includes(currentBookId);

    if (isGlobal || isTagged) {
      let resolvedTgt = item.tgt;
      if (item.overrides && item.overrides[currentBookId]) {
        resolvedTgt = item.overrides[currentBookId];
      }
      map[item.src] = {
        resolvedTgt: resolvedTgt,
        category: item.category || 'character',
        scope: item.scope,
        aliases: item.aliases || []
      };
    }
  });

  return map;
}

function switchGlossaryCategory(cat, event) {
  currentGlossaryCategory = cat;
  document.querySelectorAll('.cat-tab-btn').forEach(b => b.classList.remove('active'));
  if (event && event.target) event.target.classList.add('active');
  renderGlossaryUI();
}

function renderGlossaryUI() {
  const listContainer = document.getElementById('glossary-list');
  const searchInput = document.getElementById('gloss-search-input');
  const scopeFilter = document.getElementById('gloss-scope-filter');
  const sortSelect = document.getElementById('gloss-sort-select');
  const bookCtxEl = document.getElementById('glossary-book-context');

  if (!listContainer) return;

  if (bookCtxEl) {
    bookCtxEl.textContent = `เรื่องปัจจุบัน: ${currentBookTitle || 'ยังไม่ได้เลือก'}`;
  }

  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const scopeVal = scopeFilter ? scopeFilter.value : 'all';
  const sortVal = sortSelect ? sortSelect.value : 'count_desc';

  let items = (window.inMemoryGlossaryCache || []).slice();

  if (currentGlossaryCategory !== 'all') {
    items = items.filter(it => (it.category || 'character') === currentGlossaryCategory);
  }

  if (scopeVal === 'current_book' && currentBookId) {
    items = items.filter(it => it.scope === 'global' || (Array.isArray(it.books) && it.books.includes(currentBookId)));
  } else if (scopeVal === 'global_only') {
    items = items.filter(it => it.scope === 'global');
  }

  if (query) {
    items = items.filter(it => 
      it.src.toLowerCase().includes(query) || 
      (it.tgt && it.tgt.toLowerCase().includes(query))
    );
  }

  items.sort((a, b) => {
    if (sortVal === 'count_desc') return (b.count || 1) - (a.count || 1);
    if (sortVal === 'time_desc') return (b.updatedAt || 0) - (a.updatedAt || 0);
    if (sortVal === 'time_asc') return (a.updatedAt || 0) - (b.updatedAt || 0);
    if (sortVal === 'th_asc') return (a.tgt || '').localeCompare(b.tgt || '', 'th');
    if (sortVal === 'th_desc') return (b.tgt || '').localeCompare(a.tgt || '', 'th');
    if (sortVal === 'len_desc') return (b.src || '').length - (a.src || '').length;
    return 0;
  });

  listContainer.innerHTML = '';
  if (items.length === 0) {
    listContainer.innerHTML = `<div style="text-align:center; padding:25px; opacity:0.6; font-size:12px;">ไม่พบคำศัพท์</div>`;
    return;
  }

  items.forEach(it => {
    const isSelected = selectedGlossarySrcs.has(it.src);
    const row = document.createElement('div');
    row.style.cssText = `display:flex; align-items:center; justify-content:space-between; padding:8px; border-bottom:1px solid rgba(0,0,0,0.06); font-size:12px;`;

    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleSelectTerm('${escapeHtml(it.src)}', this.checked)">
        <div>
          <b>${escapeHtml(it.src)}</b> ➔ <span style="color:#2563eb;">${escapeHtml(it.tgt)}</span>
          <span style="font-size:10px; opacity:0.6; margin-left:6px;">[${it.category || 'character'}] (${it.scope === 'global' ? '🌐 สากล' : '🏷️ ประจำเรื่อง'})</span>
        </div>
      </div>
      <div style="display:flex; gap:4px;">
        <button class="btn" style="padding:2px 6px; font-size:10px;" onclick="openEditTermModal('${escapeHtml(it.src)}', '${escapeHtml(it.tgt)}', '${it.category || 'character'}')">✎</button>
        <button class="btn btn-danger" style="padding:2px 6px; font-size:10px;" onclick="deleteGlossaryItem('${escapeHtml(it.src)}')">✕</button>
      </div>
    `;
    listContainer.appendChild(row);
  });

  updateBatchToolbarUI();
}

function toggleSelectTerm(src, checked) {
  if (checked) selectedGlossarySrcs.add(src);
  else selectedGlossarySrcs.delete(src);
  updateBatchToolbarUI();
}

function toggleSelectAllGlossary() {
  const items = window.inMemoryGlossaryCache || [];
  if (selectedGlossarySrcs.size >= items.length) {
    selectedGlossarySrcs.clear();
  } else {
    items.forEach(it => selectedGlossarySrcs.add(it.src));
  }
  renderGlossaryUI();
}

function updateBatchToolbarUI() {
  const bar = document.getElementById('gloss-batch-toolbar');
  const countLabel = document.getElementById('gloss-batch-count');
  if (!bar || !countLabel) return;

  if (selectedGlossarySrcs.size > 0) {
    bar.style.display = 'flex';
    countLabel.textContent = `เลือกไว้ ${selectedGlossarySrcs.size} คำ`;
  } else {
    bar.style.display = 'none';
  }
}

async function addGlossary() {
  const srcInput = document.getElementById('gloss-src');
  const tgtInput = document.getElementById('gloss-tgt');
  const catInput = document.getElementById('gloss-cat');

  const src = srcInput ? srcInput.value.trim() : '';
  const tgt = tgtInput ? tgtInput.value.trim() : '';
  const cat = catInput ? catInput.value : 'character';

  if (!src || !tgt) {
    alert('กรุณากรอกทั้งคำจีนและคำแปลไทย');
    return;
  }

  await dbSaveGlossaryItem({
    src: src,
    tgt: tgt,
    category: cat,
    scope: currentBookId ? 'tagged' : 'global',
    books: currentBookId ? [currentBookId] : [],
    count: 1,
    overrides: {},
    updatedAt: Date.now()
  });

  if (srcInput) srcInput.value = '';
  if (tgtInput) tgtInput.value = '';

  await loadGlossaryFromDb();
  renderGlossaryUI();
  if (typeof renderCurrentChapter === 'function') renderCurrentChapter();
}

async function deleteGlossaryItem(src) {
  if (!confirm(`ต้องการลบคำว่า "${src}" หรือไม่?`)) return;
  if (typeof dbDeleteGlossaryItem === 'function') {
    await dbDeleteGlossaryItem(src);
  }
  selectedGlossarySrcs.delete(src);
  await loadGlossaryFromDb();
  renderGlossaryUI();
  if (typeof renderCurrentChapter === 'function') renderCurrentChapter();
}

let activeEditingSrc = null;
function openEditTermModal(src, tgt, cat) {
  activeEditingSrc = src;
  const srcLabel = document.getElementById('edit-term-src-label');
  const tgtInput = document.getElementById('edit-term-tgt-input');
  const catSelect = document.getElementById('edit-term-cat-select');

  if (srcLabel) srcLabel.textContent = src || "(คำใหม่)";
  if (tgtInput) tgtInput.value = tgt || "";
  if (catSelect) catSelect.value = cat || "character";

  openModal('edit-term-modal');
}

async function saveEditedGlossaryTerm() {
  const tgtInput = document.getElementById('edit-term-tgt-input');
  const catSelect = document.getElementById('edit-term-cat-select');
  const newTgt = tgtInput ? tgtInput.value.trim() : "";
  const newCat = catSelect ? catSelect.value : "character";

  if (!newTgt) {
    alert("กรุณาใส่คำแปลภาษาไทย");
    return;
  }

  if (activeEditingSrc) {
    const existing = (window.inMemoryGlossaryCache || []).find(x => x.src === activeEditingSrc);
    await dbSaveGlossaryItem({
      src: activeEditingSrc,
      tgt: newTgt,
      category: newCat,
      scope: existing ? existing.scope : 'tagged',
      books: existing ? existing.books : (currentBookId ? [currentBookId] : []),
      count: existing ? (existing.count || 1) : 1,
      overrides: existing ? existing.overrides : {},
      updatedAt: Date.now()
    });
  }

  closeModal('edit-term-modal');
  await loadGlossaryFromDb();
  renderGlossaryUI();
  if (typeof renderCurrentChapter === 'function') renderCurrentChapter();
}
