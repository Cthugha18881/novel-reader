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

// เรคคอร์ด meta: { key, value: [แท็ก], updatedAt } updatedAt ใช้ตัดสินตอนซิงก์ว่าเครื่องไหนแก้ล่าสุด
// แท็กเริ่มต้น/รุ่นก่อนที่ไม่มีเวลา ใช้ updatedAt = 1 เพื่อให้รายการที่แก้จากเครื่องอื่นชนะเสมอ
async function loadTagDefs() {
  if (tagDefs) return tagDefs;
  const rec = await readTagDefsRecord();
  tagDefs = Array.isArray(rec?.value) ? sanitizeBookTags(rec.value, { keepPin: true }) : sanitizeBookTags(TAG_DEFAULTS, { keepPin: true });
  if (!Array.isArray(rec?.value) || !Number.isFinite(rec.updatedAt)) await writeTagDefsRecord(Number.isFinite(rec?.updatedAt) ? rec.updatedAt : 1);
  return tagDefs;
}

function readTagDefsRecord() {
  return new Promise((resolve) => {
    try {
      const req = db.transaction('meta', 'readonly').objectStore('meta').get(TAG_DEFS_META);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

function writeTagDefsRecord(updatedAt) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key: TAG_DEFS_META, value: tagDefs, updatedAt });
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => { console.warn('save tags failed:', tx.error); resolve(); };
    } catch (e) {
      resolve();
    }
  });
}

/** ผู้ใช้แก้รายการแท็ก: บันทึกพร้อมเวลา แล้วให้ซิงก์ส่งไปเครื่องอื่น */
async function saveTagDefs() {
  await writeTagDefsRecord(Date.now());
  markDataChanged('books');
}

/** ซิงก์ได้รายการแท็กใหม่จากเครื่องอื่น: โหลดใหม่และวาดชั้นหนังสือ */
async function reloadTagDefs() {
  tagDefs = null;
  await loadTagDefs();
  await afterTagsChanged();
}

/** แท็กที่มากับหนังสือ (เช่นซิงก์จากเครื่องอื่น) แต่เครื่องนี้ยังไม่รู้จัก: เพิ่มเข้ารายการ */
async function mergeTagDefsFromBooks(books) {
  await loadTagDefs();
  const known = new Set(tagDefs.map(t => t.id));
  let added = false;
  books.forEach(b => sanitizeBookTags(b.tags).forEach(t => {
    if (known.has(t.id)) return;
    known.add(t.id);
    tagDefs.push({ ...t, pin: 'normal' });
    added = true;
  }));
  // คงเวลาเดิม: แค่เติมแท็กที่รู้จากหนังสือ ไม่ใช่การแก้ ไม่ควรชนะรายการที่เครื่องอื่นแก้ล่าสุด
  if (added) await writeTagDefsRecord((await readTagDefsRecord())?.updatedAt || 1);
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

/** ไล่สีจากสีที่เลือกไปเฉดเข้มขึ้นเล็กน้อย ทึบ 80% ตัวอักษร: ขาว / ดำ / อัตโนมัติตามความสว่างของสี */
function tagPillStyle(color, text = 'auto') {
  const [r, g, b] = hexToRgb(color);
  const dark = [r, g, b].map(v => Math.round(v * 0.72));
  const darkText = text === 'dark' || (text !== 'light' && (0.299 * r + 0.587 * g + 0.114 * b) > 170);
  return `background: linear-gradient(135deg, rgba(${r},${g},${b},0.8), rgba(${dark.join(',')},0.8)); color: ${darkText ? '#1e293b' : '#fff'};`;
}

function tagPillHtml(tag, extraClass = '') {
  const def = getTagDef(tag.id) || tag;
  return `<span class="tag-pill${extraClass ? ` ${extraClass}` : ''}" style="${tagPillStyle(def.color, def.text)}" title="${escapeHtml(def.label)}">${escapeHtml(def.label)}</span>`;
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

/**
 * ลำดับบนชั้นหนังสือตามแท็กที่ตั้ง "บนสุดเสมอ" / "ล่างสุดเสมอ" (ค่าเริ่มต้น = ปกติ ไม่มีผล)
 * มีแท็กบนสุด = กลุ่มบน (แท็กที่อยู่ก่อนในรายการแท็กขึ้นก่อน) / ไม่มีแท็กบนสุดแต่มีแท็กล่างสุด = กลุ่มล่าง (แท็กที่อยู่หลังในรายการลงล่างกว่า)
 * ในกลุ่มเดียวกันคงลำดับตามที่เลือกเรียงไว้ (อ่านล่าสุด / ชื่อเรื่อง / ตอนมากสุด)
 */
function tagShelfRank(book, defs = tagDefs || []) {
  const ids = new Set(bookTagIds(book));
  const top = defs.findIndex(t => t.pin === 'top' && ids.has(t.id));
  if (top >= 0) return [0, top];
  let bottom = -1;
  defs.forEach((t, i) => { if (t.pin === 'bottom' && ids.has(t.id)) bottom = i; });
  return bottom >= 0 ? [2, bottom] : [1, 0];
}

function applyTagShelfOrder(entries, defs = tagDefs || []) {
  if (!defs.some(t => t.pin === 'top' || t.pin === 'bottom')) return entries;
  return entries.map((x, pos) => ({ x, pos, r: tagShelfRank(x.b, defs) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.pos - b.pos)
    .map(e => e.x);
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
    return `<button type="button" class="tag-dot${on ? ' on' : ''}" style="${tagPillStyle(t.color, t.text)}" onclick="toggleTagFilter(${jsArg(t.id)})" aria-pressed="${on}" title="${escapeHtml(t.label)} (${counts.get(t.id) || 0} เรื่อง)" aria-label="กรอง: ${escapeHtml(t.label)}"></button>`;
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
  const tags = sanitizeBookTags((tagDefs || []).filter(t => want.has(t.id)));
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
  setTagEditChoice('tag-edit-text', def?.text || 'auto');
  setTagEditChoice('tag-edit-pin', def?.pin || 'normal');
  document.getElementById('tag-edit-delete').hidden = !def;
  document.getElementById('tag-edit-hint').textContent = def ? 'แก้คำหรือสีแล้ว ทุกเรื่องที่ติดแท็กนี้จะเปลี่ยนตาม' : '';
  document.getElementById('tag-edit-presets').innerHTML = TAG_COLOR_PRESETS.map(c =>
    `<button type="button" class="tag-dot" style="${tagPillStyle(c)}" onclick="pickTagColor('${c}')" aria-label="เลือกสี ${c}"></button>`).join('');
  updateTagEditPreview();
  openModal('tag-edit-modal');
  setTimeout(() => document.getElementById('tag-edit-label')?.focus(), 60);
}

function setTagEditChoice(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => { r.checked = r.value === value; });
}

function getTagEditChoice(name, fallback) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

function pickTagColor(c) {
  document.getElementById('tag-edit-color').value = c;
  updateTagEditPreview();
}

function updateTagEditPreview() {
  const label = document.getElementById('tag-edit-label').value.trim() || 'ตัวอย่างแท็ก';
  const color = document.getElementById('tag-edit-color').value;
  const text = getTagEditChoice('tag-edit-text', 'auto');
  document.getElementById('tag-edit-preview').innerHTML = tagPillHtml({ id: '__preview', label, color, text }, 'tag-pill-lg');
}

async function saveTagFromEditor() {
  const label = document.getElementById('tag-edit-label').value.trim().slice(0, 40);
  const color = sanitizeTagColor(document.getElementById('tag-edit-color').value);
  const text = getTagEditChoice('tag-edit-text', 'auto');
  const pin = getTagEditChoice('tag-edit-pin', 'normal');
  if (!label) { document.getElementById('tag-edit-label').focus(); return; }
  await loadTagDefs();
  if (tagEditingId) {
    const def = getTagDef(tagEditingId);
    if (def) Object.assign(def, { label, color, text, pin });
    await saveTagDefs();
    await updateTagOnAllBooks(tagEditingId);
  } else {
    tagDefs.push({ id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label, color, text, pin });
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
    const tags = sanitizeBookTags(sanitizeBookTags(book.tags).map(t => t.id === tagId ? def : t).filter(Boolean));
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
      <span class="hint">${counts.get(t.id) || 0} เรื่อง${t.pin === 'top' ? ' · ⬆ บนสุดเสมอ' : t.pin === 'bottom' ? ' · ⬇ ล่างสุดเสมอ' : ''}</span>
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
