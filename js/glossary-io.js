// ==================== GLOSSARY IMPORT / EXPORT (CSV / JSON) ====================
// ส่งออก: ทั้งคลัง หรือเฉพาะคำที่เรื่องนี้ใช้ (คำแปลตามเรื่องนี้) เป็น CSV (เปิดใน Excel/Google Sheets ได้) หรือ JSON
// นำเข้า: ดูตัวอย่างก่อน แยกคำใหม่ / ซ้ำ / ชนกัน แล้วเลือกเองว่าคำที่ชนกันจะ ข้าม / แทนคำแปลหลัก / ตั้งเป็นคำแปลเฉพาะเรื่อง
//   ไม่มีการทับคำแปลเดิมโดยไม่ได้เลือก

const GLOSSARY_FILE_FORMAT = 'NovelTranslateGlossary';
const GLOSSARY_IMPORT_MAX_ROWS = 20000;
const GLOSSARY_IMPORT_MAX_BYTES = 10e6;
const GLOSSARY_CSV_COLUMNS = ['src', 'tgt', 'category', 'lang', 'scope'];
// ชื่อหัวคอลัมน์ที่รับได้ (ไฟล์จากที่อื่น / ภาษาไทย)
const GLOSSARY_HEADER_ALIASES = {
  src: ['src', 'source', 'original', 'raw', 'term', 'ต้นฉบับ', 'คำต้นฉบับ', '原文', '中文'],
  tgt: ['tgt', 'target', 'translation', 'thai', 'th', 'คำแปล', 'ไทย', 'แปล'],
  category: ['category', 'type', 'หมวด', 'หมวดหมู่', 'ประเภท'],
  lang: ['lang', 'language', 'ภาษา'],
  scope: ['scope', 'ขอบเขต']
};

// ---------- CSV ----------
function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  return rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
}

/** แยก CSV/TSV ตามมาตรฐาน RFC 4180: ช่องที่มีจุลภาค/ขึ้นบรรทัด/เครื่องหมายคำพูด อยู่ใน "..." และ "" = " */
function parseDelimited(text, delimiter = ',') {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** เดาตัวคั่นจากบรรทัดแรก: แท็บ (TSV จาก Excel) / จุลภาค / อัฒภาค */
function detectDelimiter(text) {
  const first = String(text || '').replace(/^﻿/, '').split(/\r?\n/)[0] || '';
  const counts = { '\t': (first.match(/\t/g) || []).length, ',': (first.match(/,/g) || []).length, ';': (first.match(/;/g) || []).length };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

// ---------- แปลงไฟล์เป็นรายการคำ ----------
function normalizeImportedTerm(raw) {
  const src = cleanTermString(raw?.src);
  const tgt = cleanTermString(raw?.tgt);
  if (!src || !tgt || src.length > 200 || tgt.length > 200) return null;
  const category = TERM_CATEGORIES.includes(String(raw?.category || '').trim()) ? String(raw.category).trim() : '';
  const lang = raw?.lang ? normalizeLang(String(raw.lang).trim()) : '';
  const scope = /^(global|สากล)$/i.test(String(raw?.scope || '').trim()) ? 'global' : (raw?.scope ? 'book' : '');
  return { src, tgt, category, lang, scope };
}

/** คืน { terms, skipped, format } จากเนื้อหาไฟล์ (JSON ของแอพ / JSON อาร์เรย์ / CSV / TSV) */
function parseGlossaryFile(text, fileName = '') {
  const trimmed = String(text || '').replace(/^﻿/, '').trim();
  let rows = [];
  let format = 'csv';
  if (/\.json$/i.test(fileName) || /^[[{]/.test(trimmed)) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (e) {
      throw new Error('ไฟล์ JSON อ่านไม่ได้ (รูปแบบไม่ถูกต้อง)');
    }
    rows = Array.isArray(data) ? data : (Array.isArray(data?.terms) ? data.terms : []);
    if (!rows.length) throw new Error('ไม่พบรายการคำศัพท์ในไฟล์ JSON');
    format = 'json';
  } else {
    const table = parseDelimited(trimmed, detectDelimiter(trimmed));
    if (!table.length) throw new Error('ไฟล์ว่าง');
    const header = table[0].map(h => h.trim().toLowerCase());
    const colOf = (key) => header.findIndex(h => GLOSSARY_HEADER_ALIASES[key].includes(h));
    const hasHeader = colOf('src') !== -1 && colOf('tgt') !== -1;
    const cols = hasHeader
      ? Object.fromEntries(Object.keys(GLOSSARY_HEADER_ALIASES).map(k => [k, colOf(k)]))
      : { src: 0, tgt: 1, category: 2, lang: 3, scope: 4 };
    rows = (hasHeader ? table.slice(1) : table).map(r => Object.fromEntries(Object.entries(cols).filter(([, i]) => i >= 0).map(([k, i]) => [k, r[i] ?? ''])));
  }
  if (rows.length > GLOSSARY_IMPORT_MAX_ROWS) throw new Error(`ไฟล์มี ${rows.length.toLocaleString()} รายการ เกินที่รับได้ (${GLOSSARY_IMPORT_MAX_ROWS.toLocaleString()})`);
  // คำซ้ำในไฟล์: ใช้รายการหลังสุด
  const bySrc = new Map();
  let skipped = 0;
  rows.forEach(r => {
    const t = normalizeImportedTerm(r);
    if (t) bySrc.set(t.src, t);
    else skipped++;
  });
  return { terms: [...bySrc.values()], skipped, format };
}

/**
 * เทียบกับคลังศัพท์ปัจจุบัน
 * target: 'book' (ผูกกับ bookId) | 'global'
 * คืนรายการพร้อม status: new | same | conflict และ current (คำแปลที่เรื่องนี้/คลังใช้อยู่)
 */
function classifyImportedTerms(terms, existingItems, bookId, target) {
  const bySrc = new Map((existingItems || []).map(it => [it.src, it]));
  return terms.map(t => {
    const existing = bySrc.get(t.src);
    if (!existing) return { ...t, status: 'new' };
    const current = target === 'book' && bookId ? resolveTermForBook(existing, bookId) : cleanTermString(existing.tgt);
    return { ...t, status: current === t.tgt ? 'same' : 'conflict', current };
  });
}

// ---------- ส่งออก ----------
function downloadTextFile(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'glossary';
}

/** คำที่จะส่งออก: scope 'book' = คำที่เรื่องนี้ใช้ (คำแปลตามเรื่องนี้) / 'all' = ทั้งคลัง */
async function collectGlossaryForExport(scope, bookId) {
  const items = await dbGetAllGlossaryItems();
  if (scope === 'book') {
    const active = await getActiveGlossaryForBook(bookId);
    return Object.values(active).map(t => ({ src: t.src, tgt: t.resolvedTgt, category: t.category || '', lang: getTermLang(t), scope: t.scope === 'global' ? 'global' : 'book' }));
  }
  return items.map(t => ({ src: t.src, tgt: t.tgt, category: t.category || '', lang: getTermLang(t), scope: t.scope === 'global' ? 'global' : 'book', overrides: t.overrides || {}, previousTgts: t.previousTgts || [] }));
}

async function exportGlossaryFile(format) {
  const scope = document.getElementById('gloss-io-scope')?.value === 'all' || currentBookId === 'default_novel' ? 'all' : 'book';
  const terms = await collectGlossaryForExport(scope, currentBookId);
  if (!terms.length) return alert('ไม่มีคำศัพท์ให้ส่งออก');
  terms.sort((a, b) => a.src.localeCompare(b.src));
  const day = new Date().toISOString().slice(0, 10);
  const base = `glossary-${safeFileName(scope === 'book' ? currentBookTitle : 'ทั้งคลัง')}-${day}`;
  if (format === 'json') {
    const payload = { format: GLOSSARY_FILE_FORMAT, version: 1, exportedAt: new Date().toISOString(), scope, ...(scope === 'book' ? { bookTitle: currentBookTitle } : {}), terms };
    downloadTextFile(`${base}.json`, JSON.stringify(payload, null, 2), 'application/json');
  } else {
    // ใส่ BOM ให้ Excel อ่านภาษาไทย/จีนถูก
    const rows = [GLOSSARY_CSV_COLUMNS, ...terms.map(t => GLOSSARY_CSV_COLUMNS.map(c => t[c] ?? ''))];
    downloadTextFile(`${base}.csv`, '﻿' + toCsv(rows), 'text/csv;charset=utf-8');
  }
  showGlobalToast(`ส่งออกคำศัพท์ ${terms.length.toLocaleString()} คำแล้ว`);
  setTimeout(hideGlobalToast, 1500);
}

// ---------- นำเข้า ----------
let pendingGlossaryImport = null;

function triggerGlossaryImport() {
  document.getElementById('gloss-import-file').click();
}

async function handleGlossaryImportFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > GLOSSARY_IMPORT_MAX_BYTES) return alert('ไฟล์ใหญ่เกินไป (สูงสุด 10 MB)');
  let parsed;
  try {
    parsed = parseGlossaryFile(await file.text(), file.name);
  } catch (err) {
    return alert(`นำเข้าไม่ได้: ${err.message}`);
  }
  if (!parsed.terms.length) return alert('ไม่พบคำศัพท์ที่ใช้ได้ในไฟล์ (ต้องมีคอลัมน์ต้นฉบับและคำแปล)');
  pendingGlossaryImport = { ...parsed, fileName: file.name };
  // ไฟล์ใหม่เริ่มที่ตัวเลือกปลอดภัยเสมอ (ข้ามคำที่ชนกัน) ไม่ใช้ตัวเลือกที่ค้างจากการนำเข้าครั้งก่อน
  document.getElementById('glossary-import-body').innerHTML = '';
  openModal('glossary-import-modal');
  renderGlossaryImportPreview();
}

function glossaryImportTarget() {
  return currentBookId === 'default_novel' ? 'global' : (document.querySelector('input[name="gloss-import-target"]:checked')?.value || 'book');
}

function glossaryImportPolicy() {
  return document.querySelector('input[name="gloss-import-policy"]:checked')?.value || 'skip';
}

function renderGlossaryImportPreview() {
  if (!pendingGlossaryImport) return;
  const target = glossaryImportTarget();
  const hasBook = currentBookId !== 'default_novel';
  const list = classifyImportedTerms(pendingGlossaryImport.terms, inMemoryGlossaryCache, currentBookId, target);
  pendingGlossaryImport.classified = list;
  const count = (s) => list.filter(t => t.status === s).length;
  const conflicts = list.filter(t => t.status === 'conflict');
  const box = document.getElementById('glossary-import-body');
  const prevPolicy = glossaryImportPolicy();
  box.innerHTML = `
    <div style="font-size: 12px; margin-bottom: 8px;">ไฟล์: <b>${escapeHtml(pendingGlossaryImport.fileName)}</b> · ${list.length.toLocaleString()} คำ${pendingGlossaryImport.skipped ? ` · ข้าม ${pendingGlossaryImport.skipped} แถวที่ไม่มีต้นฉบับหรือคำแปล` : ''}</div>
    <div class="gloss-import-stats">
      <div><b>${count('new').toLocaleString()}</b><span>คำใหม่</span></div>
      <div><b>${count('same').toLocaleString()}</b><span>มีอยู่แล้ว (เหมือนกัน)</span></div>
      <div class="${conflicts.length ? 'warn' : ''}"><b>${conflicts.length.toLocaleString()}</b><span>คำแปลไม่ตรงกับที่มี</span></div>
    </div>
    <div class="gloss-import-options">
      <b>คำใหม่ใช้กับ</b>
      ${hasBook ? `<label><input type="radio" name="gloss-import-target" value="book" ${target === 'book' ? 'checked' : ''} onchange="renderGlossaryImportPreview()"> เรื่องนี้ (${escapeHtml(currentBookTitle)})</label>` : ''}
      <label><input type="radio" name="gloss-import-target" value="global" ${target === 'global' ? 'checked' : ''} onchange="renderGlossaryImportPreview()"> ทุกเรื่องที่เป็นภาษาเดียวกัน (คำสากล)</label>
    </div>
    ${conflicts.length ? `<div class="gloss-import-options">
      <b>คำที่คำแปลไม่ตรงกับที่มี (${conflicts.length})</b>
      <label><input type="radio" name="gloss-import-policy" value="skip" ${prevPolicy === 'skip' ? 'checked' : ''}> ข้าม ใช้คำแปลเดิม</label>
      ${hasBook ? `<label><input type="radio" name="gloss-import-policy" value="override" ${prevPolicy === 'override' ? 'checked' : ''}> ใช้คำแปลจากไฟล์เฉพาะเรื่องนี้ (เรื่องอื่นใช้คำเดิม)</label>` : ''}
      <label><input type="radio" name="gloss-import-policy" value="replace" ${prevPolicy === 'replace' ? 'checked' : ''}> แทนคำแปลหลัก (ทุกเรื่องที่ใช้คำนี้)</label>
      <div class="quality-hint">ถ้าเลือกใช้คำแปลจากไฟล์ ระบบจะแทนชื่อในตอนที่แปลแล้วให้ด้วย และจำชื่อเดิมไว้ให้ผู้ช่วย AI</div>
      <div class="gloss-import-conflicts">${conflicts.slice(0, 50).map(t => `<div><b>${escapeHtml(t.src)}</b>: ${escapeHtml(t.current)} → <span style="color: var(--accent-text);">${escapeHtml(t.tgt)}</span></div>`).join('')}${conflicts.length > 50 ? `<div>…และอีก ${conflicts.length - 50} คำ</div>` : ''}</div>
    </div>` : ''}`;
}

/** ใช้ผลนำเข้า คืน { added, attached, replaced, overridden, skipped } */
async function applyGlossaryImport(classified, { bookId, target, policy, defaultLang }) {
  const stats = { added: 0, attached: 0, replaced: 0, overridden: 0, skipped: 0 };
  const hasBook = bookId && bookId !== 'default_novel';
  for (const t of classified) {
    const existing = inMemoryGlossaryCache.find(x => x.src === t.src);
    if (t.status === 'new' || !existing) {
      await dbSaveGlossaryItem({
        // ไม่มีหมวดในไฟล์: เว้นไว้ ให้ปุ่ม "จัดหมวดด้วย AI" ในคลังศัพท์จัดให้ภายหลังได้
        src: t.src, tgt: t.tgt, category: t.category || '',
        scope: target === 'global' || t.scope === 'global' ? 'global' : 'tagged',
        lang: t.lang || defaultLang,
        books: target === 'book' && hasBook ? [bookId] : [],
        count: 1, overrides: {}, imported: true, updatedAt: Date.now()
      });
      stats.added++;
      continue;
    }
    if (t.status === 'same') {
      if (target === 'book' && hasBook && existing.scope !== 'global' && !(existing.books || []).includes(bookId)) {
        existing.books = [...(existing.books || []), bookId];
        await dbSaveGlossaryItem(existing);
        stats.attached++;
      }
      continue;
    }
    if (policy === 'skip' || (policy === 'override' && !hasBook)) {
      stats.skipped++;
      continue;
    }
    const before = snapshotTerm(existing);
    if (policy === 'override') {
      existing.overrides = { ...(existing.overrides || {}), [bookId]: t.tgt };
      if (existing.scope !== 'global' && !(existing.books || []).includes(bookId)) existing.books = [...(existing.books || []), bookId];
      stats.overridden++;
    } else {
      existing.tgt = t.tgt;
      if (hasBook && existing.overrides?.[bookId]) delete existing.overrides[bookId];
      if (target === 'book' && hasBook && existing.scope !== 'global' && !(existing.books || []).includes(bookId)) existing.books = [...(existing.books || []), bookId];
      stats.replaced++;
    }
    if (t.category) existing.category = t.category;
    if (existing.auto) existing.confirmed = true;
    existing.updatedAt = Date.now();
    await dbSaveGlossaryItem(existing);
    // แทนชื่อในตอนที่แปลแล้ว + จำชื่อเดิม (เหมือนแก้คำในคลังศัพท์เอง)
    await syncTermChange(before, existing);
  }
  return stats;
}

async function confirmGlossaryImport() {
  const pending = pendingGlossaryImport;
  if (!pending?.classified) return;
  const target = glossaryImportTarget();
  const policy = glossaryImportPolicy();
  const changing = pending.classified.filter(t => t.status === 'conflict').length;
  if (changing && policy !== 'skip' && !confirm(`จะเปลี่ยนคำแปล ${changing} คำ และแทนชื่อในตอนที่แปลแล้วของเรื่องที่เกี่ยวข้อง\n\nดำเนินการต่อหรือไม่?`)) return;
  const btn = document.getElementById('gloss-import-confirm-btn');
  btn.disabled = true;
  showGlobalToast('กำลังนำเข้าคำศัพท์...');
  try {
    const stats = await applyGlossaryImport(pending.classified, { bookId: currentBookId, target, policy, defaultLang: getCurrentBookContext().sourceLang });
    await refreshInMemoryGlossaryCache();
    closeModal('glossary-import-modal');
    pendingGlossaryImport = null;
    await renderGlossaryUI();
    renderVirtualWindow(currentChapterIndex);
    alert(`นำเข้าเสร็จแล้ว\nคำใหม่ ${stats.added} · ผูกกับเรื่องนี้ ${stats.attached} · แทนคำแปลหลัก ${stats.replaced} · คำแปลเฉพาะเรื่อง ${stats.overridden} · ข้าม ${stats.skipped}`);
  } catch (err) {
    alert(`นำเข้าไม่สำเร็จ: ${err.message}`);
  } finally {
    btn.disabled = false;
    hideGlobalToast();
  }
}
