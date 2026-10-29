// ==================== แท็กบนชั้นหนังสือ ====================
// แท็ก 1 อัน = สี + คำ (ตั้งเองได้) แก้คำของแท็กแล้วทุกเรื่องที่ใช้แท็กนั้นเปลี่ยนตาม
// รายการแท็ก (ลำดับ สี คำ) เก็บใน meta ของฐานข้อมูลบัญชีนี้ ส่วนหนังสือเก็บสำเนาแท็กที่ติดไว้ (book.tags) ซึ่งซิงก์ข้ามเครื่องได้
// เครื่องอื่นที่ยังไม่มีรายการแท็ก จะรู้จักแท็กจากหนังสือที่ซิงก์มา
const TAG_DEFS_META = 'shelf_tags';
const TAG_FILTER_PREF = 'nov_home_tag_filter';
const TAG_DEFAULTS = [
  { id: 'fav', label: 'ชอบมาก', color: '#e11d48' },
  { id: 'ongoing', label: 'ต้นฉบับยังไม่จบ', color: '#a21caf' },
  { id: 'complete', label: 'ต้นฉบับจบแล้ว', color: '#0891b2' },
  { id: 'finished', label: 'อ่านจบแล้ว', color: '#d97706' },
  { id: 'paused', label: 'พักไว้ก่อน', color: '#94a3b8' }
];
const TAG_COLOR_PRESETS = ['#e11d48', '#ea580c', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#a21caf', '#db2777', '#94a3b8'];

let tagDefs = null;

async function loadTagDefs() {
  if (tagDefs) return tagDefs;
  const saved = await dbGetMeta(TAG_DEFS_META).catch(() => undefined);
  tagDefs = Array.isArray(saved) ? sanitizeBookTags(saved) : TAG_DEFAULTS.map(t => ({ ...t }));
  if (!Array.isArray(saved)) await saveTagDefs();
  return tagDefs;
}

async function saveTagDefs() {
  await dbSetMeta(TAG_DEFS_META, tagDefs).catch(err => console.warn('save tags failed:', err));
}

/** แท็กที่มากับหนังสือ (เช่นซิงก์จากเครื่องอื่น) แต่เครื่องนี้ยังไม่รู้จัก: เพิ่มเข้ารายการ */
async function mergeTagDefsFromBooks(books) {
  await loadTagDefs();
  const known = new Set(tagDefs.map(t => t.id));
  let added = false;
  books.forEach(b => sanitizeBookTags(b.tags).forEach(t => {
    if (known.has(t.id)) return;
    known.add(t.id);
    tagDefs.push(t);
    added = true;
  }));
  if (added) await saveTagDefs();
}

function getTagDef(id) {
  return (tagDefs || []).find(t => t.id === id) || null;
}

function bookTagIds(book) {
  return sanitizeBookTags(book?.tags).map(t => t.id);
}

// ---------- หน้าตา ----------
function hexToRgb(hex) {
  const h = sanitizeTagColor(hex).slice(1);
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

/** ไล่สีจากสีที่เลือกไปเฉดเข้มขึ้นเล็กน้อย ทึบ 80% ตัวอักษรขาวหรือเข้มตามความสว่างของสี */
function tagPillStyle(color) {
  const [r, g, b] = hexToRgb(color);
  const dark = [r, g, b].map(v => Math.round(v * 0.72));
  const light = (0.299 * r + 0.587 * g + 0.114 * b) > 170;
  return `background: linear-gradient(135deg, rgba(${r},${g},${b},0.8), rgba(${dark.join(',')},0.8)); color: ${light ? '#1e293b' : '#fff'};`;
}

function tagPillHtml(tag, extraClass = '') {
  const def = getTagDef(tag.id) || tag;
  return `<span class="tag-pill${extraClass ? ` ${extraClass}` : ''}" style="${tagPillStyle(def.color)}" title="${escapeHtml(def.label)}">${escapeHtml(def.label)}</span>`;
}

/** แท็กมุมขวาบนของปก + ปุ่ม + ใส่แท็ก (อยู่นอกปุ่มปก เพราะปุ่มซ้อนปุ่มไม่ได้) */
function coverTagsHtml(book) {
  const ids = new Set(bookTagIds(book));
  const tags = (tagDefs || []).filter(t => ids.has(t.id));
  return `<div class="cover-tags">${tags.map(t => tagPillHtml(t)).join('')}
    <button type="button" class="cover-tag-add" onclick="openBookTagsModal(${jsArg(book.bookId)})" title="ใส่แท็ก" aria-label="ใส่แท็กให้ ${escapeHtml(book.title || 'นิยาย')}">+</button></div>`;
}

// ---------- กรองตามแท็ก (แถบใต้ช่องค้นหา) ----------
function getTagFilter() {
  try {
    const v = JSON.parse(localStorage.getItem(TAG_FILTER_PREF) || '[]');
    return new Set(Array.isArray(v) ? v.filter(id => getTagDef(id)) : []);
  } catch (e) {
    return new Set();
  }
}

function setTagFilter(set) {
  try { localStorage.setItem(TAG_FILTER_PREF, JSON.stringify([...set])); } catch (e) {}
}

/** เลือกหลายสี = แสดงเรื่องที่มีแท็กใดแท็กหนึ่งในสีที่เลือก */
function filterEntriesByTags(entries, filter = getTagFilter()) {
  if (!filter.size) return entries;
  return entries.filter(x => bookTagIds(x.b).some(id => filter.has(id)));
}

function renderTagFilterBar() {
  const bar = document.getElementById('home-tag-filter');
  if (!bar) return;
  const filter = getTagFilter();
  const counts = new Map();
  (typeof homeBooksCache !== 'undefined' ? homeBooksCache : []).forEach(x => bookTagIds(x.b).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  bar.innerHTML = (tagDefs || []).map(t => {
    const on = filter.has(t.id);
    return `<button type="button" class="tag-dot${on ? ' on' : ''}" style="${tagPillStyle(t.color)}" onclick="toggleTagFilter(${jsArg(t.id)})" aria-pressed="${on}" title="${escapeHtml(t.label)} (${counts.get(t.id) || 0} เรื่อง)" aria-label="กรอง: ${escapeHtml(t.label)}"></button>`;
  }).join('') +
    `<button type="button" class="tag-dot-add" onclick="openTagEditor()" title="เพิ่มแท็กสีใหม่" aria-label="เพิ่มแท็กสีใหม่">+</button>` +
    ((tagDefs || []).length ? `<button type="button" class="btn btn-sm tag-manage-btn" onclick="openTagManager()" title="แก้คำ สี หรือลบแท็ก">✎ แก้แท็ก</button>` : '') +
    (filter.size ? `<span class="tag-filter-note">${escapeHtml([...filter].map(id => getTagDef(id)?.label).filter(Boolean).join(' / '))} <button type="button" class="btn btn-sm" onclick="clearTagFilter()">ล้าง</button></span>` : '');
}

function toggleTagFilter(id) {
  const f = getTagFilter();
  if (f.has(id)) f.delete(id); else f.add(id);
  setTagFilter(f);
  renderTagFilterBar();
  if (typeof renderHomeCards === 'function') renderHomeCards();
}

function clearTagFilter() {
  setTagFilter(new Set());
  renderTagFilterBar();
  if (typeof renderHomeCards === 'function') renderHomeCards();
}

// ---------- ติดแท็กให้หนังสือ ----------
let tagModalBookId = null;

async function openBookTagsModal(bookId) {
  await loadTagDefs();
  tagModalBookId = bookId;
  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  document.getElementById('book-tags-title').textContent = book?.title ? `· ${book.title}` : '';
  renderBookTagsModal(book);
  openModal('book-tags-modal');
}

function renderBookTagsModal(book) {
  const box = document.getElementById('book-tags-list');
  if (!box) return;
  const ids = new Set(bookTagIds(book));
  box.innerHTML = (tagDefs || []).length
    ? tagDefs.map(t => `<label class="book-tag-row">
        <input type="checkbox" ${ids.has(t.id) ? 'checked' : ''} onchange="toggleBookTag(${jsArg(t.id)}, this.checked)">
        ${tagPillHtml(t, 'tag-pill-lg')}
        <button type="button" class="btn btn-sm" onclick="event.preventDefault(); openTagEditor(${jsArg(t.id)})" title="แก้คำหรือสีของแท็กนี้ (เปลี่ยนทุกเรื่องที่ใช้)" aria-label="แก้แท็ก ${escapeHtml(t.label)}">✎</button>
      </label>`).join('')
    : '<div class="hint">ยังไม่มีแท็ก กด "+ สร้างแท็กใหม่" ด้านล่าง</div>';
}

async function setBookTags(bookId, ids) {
  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  if (!book) return null;
  const want = new Set(ids);
  // ไม่แก้ updatedAt: ใช้เรียง "อ่านล่าสุด" การติดแท็กไม่ใช่การอ่าน
  const tags = (tagDefs || []).filter(t => want.has(t.id)).map(t => ({ ...t }));
  const next = { ...book, tags };
  await dbSaveBook(next);
  return next;
}

async function toggleBookTag(tagId, on) {
  const bookId = tagModalBookId;
  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  if (!book) return;
  const ids = new Set(bookTagIds(book));
  if (on) ids.add(tagId); else ids.delete(tagId);
  const saved = await setBookTags(bookId, [...ids]);
  renderBookTagsModal(saved);
  await afterTagsChanged(bookId);
}

async function afterTagsChanged(bookId = null) {
  if (typeof homeOpen === 'undefined' || !homeOpen) return;
  if (bookId && typeof refreshHomeBook === 'function') await refreshHomeBook(bookId);
  else if (typeof renderHomeGrid === 'function') await renderHomeGrid();
  renderTagFilterBar();
}

// ---------- สร้าง / แก้ / ลบแท็ก ----------
let tagEditingId = null;

async function openTagEditor(id = null) {
  await loadTagDefs();
  tagEditingId = id;
  const def = id ? getTagDef(id) : null;
  const used = new Set((tagDefs || []).map(t => t.color));
  const color = def?.color || TAG_COLOR_PRESETS.find(c => !used.has(c)) || '#2563eb';
  document.getElementById('tag-edit-heading').textContent = def ? 'แก้แท็ก' : 'เพิ่มแท็กใหม่';
  document.getElementById('tag-edit-label').value = def?.label || '';
  document.getElementById('tag-edit-color').value = color;
  document.getElementById('tag-edit-delete').hidden = !def;
  document.getElementById('tag-edit-hint').textContent = def ? 'แก้คำหรือสีแล้ว ทุกเรื่องที่ติดแท็กนี้จะเปลี่ยนตาม' : '';
  document.getElementById('tag-edit-presets').innerHTML = TAG_COLOR_PRESETS.map(c =>
    `<button type="button" class="tag-dot" style="${tagPillStyle(c)}" onclick="pickTagColor('${c}')" aria-label="เลือกสี ${c}"></button>`).join('');
  updateTagEditPreview();
  openModal('tag-edit-modal');
  setTimeout(() => document.getElementById('tag-edit-label')?.focus(), 60);
}

function pickTagColor(c) {
  document.getElementById('tag-edit-color').value = c;
  updateTagEditPreview();
}

function updateTagEditPreview() {
  const label = document.getElementById('tag-edit-label').value.trim() || 'ตัวอย่างแท็ก';
  const color = document.getElementById('tag-edit-color').value;
  document.getElementById('tag-edit-preview').innerHTML = tagPillHtml({ id: '__preview', label, color }, 'tag-pill-lg');
}

async function saveTagFromEditor() {
  const label = document.getElementById('tag-edit-label').value.trim().slice(0, 40);
  const color = sanitizeTagColor(document.getElementById('tag-edit-color').value);
  if (!label) { document.getElementById('tag-edit-label').focus(); return; }
  await loadTagDefs();
  if (tagEditingId) {
    const def = getTagDef(tagEditingId);
    if (def) { def.label = label; def.color = color; }
    await saveTagDefs();
    await updateTagOnAllBooks(tagEditingId);
  } else {
    tagDefs.push({ id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label, color });
    await saveTagDefs();
  }
  closeModal('tag-edit-modal');
  await refreshTagViews();
}

/** แก้คำ/สีของแท็ก: สำเนาแท็กในทุกเรื่องที่ติดไว้ต้องเปลี่ยนตาม (เครื่องอื่นที่ซิงก์จะเห็นคำใหม่ด้วย) */
async function updateTagOnAllBooks(tagId) {
  const def = getTagDef(tagId);
  for (const book of await dbGetAllBooks()) {
    if (!bookTagIds(book).includes(tagId)) continue;
    const tags = sanitizeBookTags(book.tags).map(t => t.id === tagId ? (def ? { ...def } : null) : t).filter(Boolean);
    await dbSaveBook({ ...book, tags });
  }
}

async function deleteTagFromEditor() {
  const def = getTagDef(tagEditingId);
  if (!def) return;
  const using = (await dbGetAllBooks()).filter(b => bookTagIds(b).includes(def.id)).length;
  const ok = await appConfirm(`ลบแท็ก "${def.label}"${using ? ` ออกจาก ${using} เรื่องที่ติดไว้` : ''} (ไม่ลบนิยาย)`, { title: 'ลบแท็ก', confirmLabel: 'ลบแท็ก', danger: true });
  if (!ok) return;
  tagDefs = tagDefs.filter(t => t.id !== def.id);
  await saveTagDefs();
  await updateTagOnAllBooks(def.id);
  const f = getTagFilter();
  if (f.delete(def.id)) setTagFilter(f);
  closeModal('tag-edit-modal');
  await refreshTagViews();
}

async function refreshTagViews() {
  if (document.getElementById('book-tags-modal')?.classList.contains('active') && tagModalBookId) {
    renderBookTagsModal((await dbGetAllBooks()).find(b => b.bookId === tagModalBookId));
  }
  if (document.getElementById('tag-manager-modal')?.classList.contains('active')) renderTagManager();
  await afterTagsChanged();
}

// ---------- จัดการแท็กทั้งหมด ----------
async function openTagManager() {
  await loadTagDefs();
  renderTagManager();
  openModal('tag-manager-modal');
}

async function renderTagManager() {
  const box = document.getElementById('tag-manager-list');
  if (!box) return;
  const counts = new Map();
  (await dbGetAllBooks()).forEach(b => bookTagIds(b).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  box.innerHTML = (tagDefs || []).map((t, i) => `<div class="book-tag-row">
      ${tagPillHtml(t, 'tag-pill-lg')}
      <span class="hint">${counts.get(t.id) || 0} เรื่อง</span>
      <span class="tag-row-actions">
        <button type="button" class="btn btn-sm" onclick="moveTag(${i}, -1)" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">▲</button>
        <button type="button" class="btn btn-sm" onclick="moveTag(${i}, 1)" ${i === tagDefs.length - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">▼</button>
        <button type="button" class="btn btn-sm" onclick="openTagEditor(${jsArg(t.id)})">✎ แก้</button>
      </span>
    </div>`).join('') || '<div class="hint">ยังไม่มีแท็ก</div>';
}

async function moveTag(index, dir) {
  const j = index + dir;
  if (!tagDefs || j < 0 || j >= tagDefs.length) return;
  [tagDefs[index], tagDefs[j]] = [tagDefs[j], tagDefs[index]];
  await saveTagDefs();
  renderTagManager();
  await afterTagsChanged();
}
