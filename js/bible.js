// ==================== BOOK BIBLE (คู่มือเรื่อง) ====================
// เก็บใน bookData: { bookId, bible: { characters, styleNotes }, replaceRules, styleExamples }
// character: { id, src, aliases[], gender, role, selfRef, addressing[{to, term}], notes, locked, source, pending, updatedAt }
// หลัก: AI เพิ่มตัวละครใหม่ได้เอง แต่การ "เปลี่ยน" ข้อมูลเดิมจะเป็นแค่ข้อเสนอ (pending) รอผู้ใช้ยืนยัน
//       รายการที่ผู้ใช้ล็อกไว้ AI แก้ไม่ได้เลย

const GENDER_LABELS = { male: 'ชาย', female: 'หญิง', unknown: 'ไม่ทราบ' };
const MAX_GUIDE_CHARACTERS = 25;
const MAX_STYLE_EXAMPLES = 40;
const BIBLE_FIELDS = ['gender', 'role', 'selfRef'];

function emptyBible() {
  return { characters: [], styleNotes: '' };
}

async function getBookExtras(bookId) {
  const data = await dbGetBookData(bookId);
  return {
    bookId,
    bible: { ...emptyBible(), ...(data.bible || {}) },
    replaceRules: Array.isArray(data.replaceRules) ? data.replaceRules : [],
    styleExamples: Array.isArray(data.styleExamples) ? data.styleExamples : [],
    ...Object.fromEntries(Object.entries(data).filter(([k]) => !['bookId', 'bible', 'replaceRules', 'styleExamples'].includes(k)))
  };
}

/**
 * บันทึกเฉพาะส่วนของคู่มือเรื่องจากหน้าต่างแก้ไข ลงบนข้อมูลล่าสุดในฐานข้อมูล
 * (ข้อมูลอื่นของเรื่อง เช่น สารบัญ ประวัติแชทผู้ช่วย อาจถูกบันทึกระหว่างที่หน้าต่างเปิดอยู่ จึงห้ามเขียนทับด้วยสำเนาเก่า)
 */
async function saveBibleDraft() {
  if (!bibleDraft?.bookId) return;
  const fresh = await getBookExtras(bibleDraft.bookId);
  await dbSaveBookData({ ...fresh, bible: bibleDraft.bible, replaceRules: bibleDraft.replaceRules, styleExamples: bibleDraft.styleExamples });
}
function isBibleAutoEnabled() {
  return localStorage.getItem('nov_enable_bible_auto') !== 'false';
}

function newCharacterId() {
  return 'chr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function characterNames(ch) {
  return [ch.src, ...(ch.aliases || [])].filter(Boolean);
}

function findCharacter(bible, name) {
  return bible.characters.find(ch => characterNames(ch).includes(name));
}

function cleanList(list) {
  return [...new Set((Array.isArray(list) ? list : []).map(x => cleanTermString(x)).filter(Boolean))];
}

/**
 * รวมข้อมูลตัวละครที่ AI สกัดได้เข้าคู่มือ
 * @returns {{ added: number, proposed: number }}
 */
function mergeCharacterUpdates(bible, updates) {
  let added = 0;
  let proposed = 0;
  for (const raw of (Array.isArray(updates) ? updates : [])) {
    const src = cleanTermString(raw?.src);
    if (!src) continue;
    const update = {
      gender: ['male', 'female'].includes(raw.gender) ? raw.gender : '',
      role: cleanTermString(raw.role),
      selfRef: cleanTermString(raw.selfRef),
      aliases: cleanList(raw.aliases).filter(a => a !== src),
      addressing: (Array.isArray(raw.addressing) ? raw.addressing : [])
        .map(a => ({ to: cleanTermString(a?.to), term: cleanTermString(a?.term) }))
        .filter(a => a.to && a.term && a.to !== src)
    };
    const existing = findCharacter(bible, src) || update.aliases.map(a => findCharacter(bible, a)).find(Boolean);

    if (!existing) {
      bible.characters.push({
        id: newCharacterId(), src, aliases: update.aliases,
        gender: update.gender || 'unknown', role: update.role, selfRef: update.selfRef,
        addressing: update.addressing, notes: '', locked: false, source: 'ai', pending: null, updatedAt: Date.now()
      });
      added++;
      continue;
    }
    if (existing.locked) continue;

    const pending = { ...(existing.pending || {}) };
    let changed = false;
    for (const field of BIBLE_FIELDS) {
      const incoming = update[field];
      if (!incoming) continue;
      const current = existing[field];
      if (!current || current === 'unknown') {
        existing[field] = incoming;
        changed = true;
      } else if (current !== incoming) {
        pending[field] = incoming;
      }
    }
    // ชื่อเรียกอื่นเพิ่มได้เลย (ไม่ทับข้อมูลเดิม) รวมถึงชื่อที่ AI ใช้รายงานมา ถ้าจับคู่ได้ผ่านชื่อเรียกอื่น
    const newAliases = [src, ...update.aliases].filter(a => !characterNames(existing).includes(a) && !findCharacter(bible, a));
    if (newAliases.length) {
      existing.aliases = [...(existing.aliases || []), ...newAliases];
      changed = true;
    }
    for (const addr of update.addressing) {
      const cur = (existing.addressing || []).find(a => a.to === addr.to);
      if (!cur) {
        existing.addressing = [...(existing.addressing || []), addr];
        changed = true;
      } else if (cur.term !== addr.term) {
        pending.addressing = [...(pending.addressing || []).filter(a => a.to !== addr.to), addr];
      }
    }
    const hasPending = Object.keys(pending).length > 0;
    if (hasPending && JSON.stringify(pending) !== JSON.stringify(existing.pending || {})) proposed++;
    existing.pending = hasPending ? pending : null;
    if (changed || hasPending) existing.updatedAt = Date.now();
  }
  return { added, proposed };
}

async function applyCharacterUpdates(bookId, updates) {
  if (!bookId || !Array.isArray(updates) || updates.length === 0) return { added: 0, proposed: 0 };
  const extras = await getBookExtras(bookId);
  const result = mergeCharacterUpdates(extras.bible, updates);
  if (result.added || result.proposed || updates.length) await dbSaveBookData(extras);
  return result;
}

function relevantCharacters(bible, text) {
  if (!text) return [];
  return bible.characters
    .filter(ch => characterNames(ch).some(n => n && text.includes(n)))
    .slice(0, MAX_GUIDE_CHARACTERS);
}

function formatCharacterLine(ch, activeTerms) {
  const thName = activeTerms?.[ch.src]?.resolvedTgt || '';
  const parts = [`${ch.src}${thName ? ` = ${thName}` : ''}`];
  if (ch.aliases?.length) parts.push(`ชื่อเรียกอื่น: ${ch.aliases.join(', ')}`);
  if (ch.gender && ch.gender !== 'unknown') parts.push(`เพศ: ${GENDER_LABELS[ch.gender]}`);
  if (ch.role) parts.push(`บทบาท: ${ch.role}`);
  if (ch.selfRef) parts.push(`แทนตัวเองว่า: ${ch.selfRef}`);
  if (ch.addressing?.length) parts.push(`เรียกผู้อื่น: ${ch.addressing.map(a => `${a.to}→"${a.term}"`).join(', ')}`);
  if (ch.notes) parts.push(`หมายเหตุ: ${ch.notes}`);
  return '- ' + parts.join(' | ');
}

/** ส่วน "คู่มือเรื่อง" ที่ใส่ใน prompt: แนวทางสำนวน + เฉพาะตัวละครที่ปรากฏในข้อความนี้ */
function buildGuideSection(extras, activeTerms, text) {
  const lines = [];
  const notes = (extras?.bible?.styleNotes || '').trim();
  if (notes) lines.push(`แนวทางสำนวนของเรื่องนี้ (ผู้อ่านกำหนด ให้ยึดตามนี้):\n${notes}`);
  const chars = relevantCharacters(extras?.bible || emptyBible(), text);
  if (chars.length) lines.push(`ข้อมูลตัวละครที่ปรากฏในส่วนนี้ (ใช้กำหนดเพศ สรรพนาม และคำเรียกขานให้ถูกต้อง):\n${chars.map(ch => formatCharacterLine(ch, activeTerms)).join('\n')}`);
  return lines.join('\n\n');
}

// ---------- Style examples (เรียนจากที่ผู้ใช้แก้คำแปลเอง) ----------
function bigrams(text) {
  const s = (text || '').replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function pickStyleExamples(examples, text, limit = 4) {
  if (!examples?.length) return [];
  const target = bigrams(text);
  const scored = examples.map((ex, idx) => {
    let score = 0;
    bigrams(ex.src).forEach(b => { if (target.has(b)) score++; });
    return { ex, score, idx };
  });
  const relevant = scored.filter(s => s.score >= 2).sort((a, b) => b.score - a.score || b.idx - a.idx).map(s => s.ex);
  const recent = examples.slice(-2).reverse();
  return [...new Set([...relevant, ...recent])].slice(0, limit);
}

function buildStyleExamplesSection(extras, text) {
  const picked = pickStyleExamples(extras?.styleExamples || [], text);
  if (!picked.length) return '';
  return `ตัวอย่างคำแปลที่ผู้อ่านแก้ไขเอง (ยึดสำนวน น้ำเสียง และการเลือกคำแบบนี้):\n${picked.map(ex => `- ต้นฉบับ: ${ex.src}\n  คำแปลที่ต้องการ: ${ex.th}`).join('\n')}`;
}

async function addStyleExample(bookId, src, th) {
  if (!bookId || !src || !th) return;
  const extras = await getBookExtras(bookId);
  extras.styleExamples = extras.styleExamples.filter(ex => ex.src !== src);
  extras.styleExamples.push({ src, th, at: Date.now() });
  if (extras.styleExamples.length > MAX_STYLE_EXAMPLES) extras.styleExamples = extras.styleExamples.slice(-MAX_STYLE_EXAMPLES);
  await dbSaveBookData(extras);
}

/** เปลี่ยนชื่อในคลังศัพท์แล้ว ตัวอย่างสำนวนต้องเปลี่ยนตาม ไม่งั้นจะสอนชื่อเก่าให้ AI */
async function syncStyleExamplesForTerm(bookId, oldTgt, newTgt) {
  if (!bookId || !oldTgt || !newTgt || oldTgt === newTgt) return;
  const extras = await getBookExtras(bookId);
  let changed = false;
  extras.styleExamples.forEach(ex => {
    if (ex.th.includes(oldTgt)) {
      ex.th = ex.th.split(oldTgt).join(newTgt);
      changed = true;
    }
  });
  if (changed) await dbSaveBookData(extras);
}

// ==================== BIBLE UI ====================
let bibleEditingBookId = null;
let bibleDraft = null;
let bibleActiveTab = 'characters';

async function openBibleModal() {
  if (currentBookId === 'default_novel') return alert('กรุณาเปิดนิยายสักเรื่องก่อน');
  bibleEditingBookId = currentBookId;
  bibleDraft = await getBookExtras(currentBookId);
  document.getElementById('bible-book-title').innerText = currentBookTitle;
  document.getElementById('bible-auto-chk').checked = isBibleAutoEnabled();
  await switchBibleTab(bibleActiveTab);
  openModal('bible-modal');
}

async function switchBibleTab(tab) {
  bibleActiveTab = tab;
  document.querySelectorAll('.bible-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.bible-tab-panel').forEach(p => { p.style.display = p.dataset.tab === tab ? 'block' : 'none'; });
  await renderBibleTab();
}

async function renderBibleTab() {
  if (!bibleDraft) return;
  if (bibleActiveTab === 'characters') await renderBibleCharacters();
  else if (bibleActiveTab === 'style') document.getElementById('bible-style-notes').value = bibleDraft.bible.styleNotes || '';
  else if (bibleActiveTab === 'rules') renderReplaceRules();
  else if (bibleActiveTab === 'examples') renderStyleExamples();
}

function formatAddressing(list) {
  return (list || []).map(a => `${a.to}=${a.term}`).join(', ');
}

function parseAddressing(text) {
  return (text || '').split(/[,，\n]/).map(s => s.trim()).filter(Boolean).map(s => {
    const [to, ...rest] = s.split('=');
    return { to: cleanTermString(to), term: cleanTermString(rest.join('=')) };
  }).filter(a => a.to && a.term);
}

async function renderBibleCharacters() {
  const list = document.getElementById('bible-characters-list');
  const activeTerms = await getActiveGlossaryForBook(bibleEditingBookId);
  const chars = bibleDraft.bible.characters;
  const pendingCount = chars.filter(c => c.pending).length;
  document.getElementById('bible-pending-note').innerText = pendingCount ? `มีข้อเสนอแก้ไขจาก AI ${pendingCount} ตัวละคร (กรอบสีเหลือง) กดรับหรือปฏิเสธได้` : '';
  if (chars.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:16px; opacity:0.6; font-size:12px;">ยังไม่มีตัวละครในคู่มือ ระบบจะเพิ่มให้อัตโนมัติระหว่างแปล หรือกด "✨ สร้างจากตอนที่แปลแล้ว"</div>';
    return;
  }
  list.innerHTML = chars.map((ch, idx) => {
    const thName = activeTerms[ch.src]?.resolvedTgt || '';
    const pendingHtml = ch.pending ? `
      <div class="bible-pending">
        <b>AI เสนอให้แก้:</b>
        ${BIBLE_FIELDS.filter(f => ch.pending[f]).map(f => `${({ gender: 'เพศ', role: 'บทบาท', selfRef: 'แทนตัวเอง' })[f]}: ${escapeHtml(ch[f] || '-')} → <b>${escapeHtml(f === 'gender' ? GENDER_LABELS[ch.pending[f]] || ch.pending[f] : ch.pending[f])}</b>`).join(' · ')}
        ${ch.pending.addressing ? `เรียกผู้อื่น: <b>${escapeHtml(formatAddressing(ch.pending.addressing))}</b>` : ''}
        <div style="margin-top:4px; display:flex; gap:4px;">
          <button class="btn btn-primary" style="padding:1px 8px; font-size:10px;" onclick="resolveBiblePending(${idx}, true)">รับ</button>
          <button class="btn" style="padding:1px 8px; font-size:10px;" onclick="resolveBiblePending(${idx}, false)">ไม่รับ</button>
        </div>
      </div>` : '';
    return `
      <div class="bible-char-card${ch.locked ? ' locked' : ''}${ch.pending ? ' has-pending' : ''}" data-idx="${idx}">
        <div class="bible-char-head">
          <b>${escapeHtml(ch.src)}</b> ${thName ? `➔ <span style="color:#2563eb;">${escapeHtml(thName)}</span>` : '<span style="opacity:0.5; font-size:11px;">(ยังไม่มีในคลังศัพท์)</span>'}
          <span style="margin-left:auto; display:flex; gap:6px; align-items:center;">
            <label style="font-size:11px; cursor:pointer;"><input type="checkbox" ${ch.locked ? 'checked' : ''} onchange="bibleDraft.bible.characters[${idx}].locked = this.checked; renderBibleCharacters();"> 🔒 ล็อก</label>
            <button class="btn btn-danger" style="padding:1px 6px; font-size:10px;" onclick="removeBibleCharacter(${idx})">✕</button>
          </span>
        </div>
        <div class="bible-char-grid">
          <label>เพศ <select data-field="gender" onchange="updateBibleField(${idx}, 'gender', this.value)">
            ${Object.entries(GENDER_LABELS).map(([v, l]) => `<option value="${v}" ${ch.gender === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
          <label>บทบาท <input type="text" value="${escapeHtml(ch.role || '')}" placeholder="เช่น พระเอก, อาจารย์ของพระเอก" onchange="updateBibleField(${idx}, 'role', this.value)"></label>
          <label>แทนตัวเองว่า <input type="text" value="${escapeHtml(ch.selfRef || '')}" placeholder="เช่น ข้า, ผม, ข้าน้อย" onchange="updateBibleField(${idx}, 'selfRef', this.value)"></label>
          <label>ชื่อเรียกอื่น (คั่นด้วย ,) <input type="text" value="${escapeHtml((ch.aliases || []).join(', '))}" placeholder="เช่น 小动, 林兄" onchange="updateBibleField(${idx}, 'aliases', this.value)"></label>
          <label class="wide">เรียกผู้อื่นว่า (ชื่อจีน=คำเรียก คั่นด้วย ,) <input type="text" value="${escapeHtml(formatAddressing(ch.addressing))}" placeholder="เช่น 萧炎=พี่เซียว, 师父=ท่านอาจารย์" onchange="updateBibleField(${idx}, 'addressing', this.value)"></label>
          <label class="wide">หมายเหตุ <input type="text" value="${escapeHtml(ch.notes || '')}" placeholder="ข้อมูลอื่นที่ AI ควรรู้" onchange="updateBibleField(${idx}, 'notes', this.value)"></label>
        </div>
        ${pendingHtml}
      </div>`;
  }).join('');
}

function updateBibleField(idx, field, value) {
  const ch = bibleDraft.bible.characters[idx];
  if (!ch) return;
  if (field === 'aliases') ch.aliases = cleanList(value.split(/[,，]/));
  else if (field === 'addressing') ch.addressing = parseAddressing(value);
  else ch[field] = field === 'gender' ? value : cleanTermString(value);
  ch.source = 'user';
  ch.updatedAt = Date.now();
}

function resolveBiblePending(idx, accept) {
  const ch = bibleDraft.bible.characters[idx];
  if (!ch?.pending) return;
  if (accept) {
    BIBLE_FIELDS.forEach(f => { if (ch.pending[f]) ch[f] = ch.pending[f]; });
    (ch.pending.addressing || []).forEach(addr => {
      ch.addressing = [...(ch.addressing || []).filter(a => a.to !== addr.to), addr];
    });
  }
  ch.pending = null;
  renderBibleCharacters();
}

function removeBibleCharacter(idx) {
  const ch = bibleDraft.bible.characters[idx];
  if (!ch || !confirm(`ลบ "${ch.src}" ออกจากคู่มือเรื่องใช่หรือไม่? (คำในคลังศัพท์จะไม่ถูกลบ)`)) return;
  bibleDraft.bible.characters.splice(idx, 1);
  renderBibleCharacters();
}

function addBibleCharacter() {
  const src = cleanTermString(prompt('ชื่อตัวละครภาษาต้นฉบับ (เช่น 林动):', ''));
  if (!src) return;
  if (findCharacter(bibleDraft.bible, src)) return alert('มีตัวละครนี้ในคู่มือแล้ว');
  bibleDraft.bible.characters.unshift({
    id: newCharacterId(), src, aliases: [], gender: 'unknown', role: '', selfRef: '', addressing: [],
    notes: '', locked: true, source: 'user', pending: null, updatedAt: Date.now()
  });
  renderBibleCharacters();
}

function renderReplaceRules() {
  const list = document.getElementById('bible-rules-list');
  const rules = bibleDraft.replaceRules;
  list.innerHTML = rules.length ? rules.map((r, idx) => `
    <div class="bible-rule-row">
      <input type="checkbox" ${r.enabled !== false ? 'checked' : ''} onchange="bibleDraft.replaceRules[${idx}].enabled = this.checked" title="เปิด/ปิดกฎนี้">
      <input type="text" value="${escapeHtml(r.from)}" onchange="bibleDraft.replaceRules[${idx}].from = this.value" placeholder="คำที่ต้องการแทน">
      <span>➔</span>
      <input type="text" value="${escapeHtml(r.to)}" onchange="bibleDraft.replaceRules[${idx}].to = this.value" placeholder="แทนด้วย (เว้นว่าง = ลบ)">
      <button class="btn btn-danger" style="padding:1px 6px; font-size:10px;" onclick="bibleDraft.replaceRules.splice(${idx}, 1); renderReplaceRules();">✕</button>
    </div>`).join('') : '<div style="text-align:center; padding:12px; opacity:0.6; font-size:12px;">ยังไม่มีกฎแทนคำ</div>';
}

function addReplaceRule() {
  bibleDraft.replaceRules.push({ from: '', to: '', enabled: true });
  renderReplaceRules();
}

function renderStyleExamples() {
  const list = document.getElementById('bible-examples-list');
  const examples = bibleDraft.styleExamples;
  list.innerHTML = examples.length ? examples.slice().reverse().map((ex, revIdx) => {
    const idx = examples.length - 1 - revIdx;
    return `
      <div class="bible-example">
        <div class="para-src" style="display:block; margin:0 0 4px;">${escapeHtml(ex.src)}</div>
        <div style="font-size:13px;">${escapeHtml(ex.th)}</div>
        <button class="btn btn-danger" style="padding:1px 6px; font-size:10px; margin-top:4px;" onclick="bibleDraft.styleExamples.splice(${idx}, 1); renderStyleExamples();">ลบตัวอย่างนี้</button>
      </div>`;
  }).join('') : '<div style="text-align:center; padding:12px; opacity:0.6; font-size:12px;">ยังไม่มีตัวอย่าง ตัวอย่างจะถูกเพิ่มเมื่อคุณแก้คำแปลในหน้าอ่าน (แตะย่อหน้า → ✎ แก้คำแปล)</div>';
}

async function saveBibleModal() {
  if (!bibleDraft) return;
  bibleDraft.bible.styleNotes = (bibleDraft.bible.styleNotes || '').trim();
  bibleDraft.replaceRules = bibleDraft.replaceRules.filter(r => r.from);
  localStorage.setItem('nov_enable_bible_auto', document.getElementById('bible-auto-chk').checked ? 'true' : 'false');
  await saveBibleDraft();
  closeModal('bible-modal');
}

/** ใช้กฎแทนคำกับทุกตอนที่แปลไว้แล้วของเรื่องนี้ */
async function applyReplaceRulesToBook() {
  if (!bibleDraft) return;
  bibleDraft.replaceRules = bibleDraft.replaceRules.filter(r => r.from);
  await saveBibleDraft();
  const rules = normalizeReplaceRules(bibleDraft.replaceRules);
  if (rules.length === 0) return alert('ยังไม่มีกฎที่เปิดใช้งาน');
  if (!confirm(`ใช้กฎแทนคำ ${rules.length} ข้อกับทุกตอนที่แปลแล้วของเรื่องนี้ใช่หรือไม่?`)) return;
  const opts = await getCleanupOptionsForBook(bibleEditingBookId);
  let changedChapters = 0;
  for (const chap of await dbGetChaptersByBook(bibleEditingBookId)) {
    let changed = false;
    chap.paragraphs = chap.paragraphs.map(p => {
      if (p.kind === 'site_junk' || !p.th) return p;
      const th = transformOutsideTerms(p.th, opts.termTgts, seg => applyUserReplaceRules(seg, rules));
      if (th === p.th) return p;
      changed = true;
      return { ...p, th };
    });
    if (changed) {
      await dbSaveChapter(chap);
      changedChapters++;
      const mem = chapters.find(c => c.id === chap.id);
      if (mem) mem.paragraphs = chap.paragraphs;
    }
  }
  if (currentBookId === bibleEditingBookId) renderVirtualWindow(currentChapterIndex);
  alert(`ใช้กฎแทนคำเรียบร้อย มีการแก้ไข ${changedChapters} ตอน`);
}

// ---------- Character extraction (AI) ----------
/** คำสั่งส่วนสกัดข้อมูลตัวละคร ใช้ร่วมกันทั้งตอนสแกนก่อนแปลและตอนสร้างคู่มือจากตอนเก่า */
function buildCharacterExtractionInstruction(bible, text) {
  const known = relevantCharacters(bible || emptyBible(), text);
  const knownLines = known.length
    ? `ข้อมูลตัวละครที่มีอยู่แล้ว (ส่งเฉพาะเมื่อพบข้อมูลใหม่หรือหลักฐานว่าข้อมูลเดิมผิด):\n${known.map(ch => formatCharacterLine(ch, null)).join('\n')}`
    : '';
  return `สกัด "characters" = ข้อมูลตัวละครที่มีบทบาทในข้อความนี้ เพื่อใช้กำหนดสรรพนามและคำเรียกขานให้ถูกต้องตลอดเรื่อง:
- "src": ชื่อตัวละครตามต้นฉบับ (ชื่อหลัก), "aliases": ชื่อเรียกอื่นตามต้นฉบับที่หมายถึงคนเดียวกัน (ชื่อเล่น ฉายา สรรพนามเฉพาะ)
- "gender": "male" | "female" | "unknown" (ดูจาก 他/她, คำเรียก, บริบท ถ้าไม่แน่ใจให้ "unknown")
- "role": บทบาทสั้นๆ ภาษาไทย (เช่น พระเอก, ศิษย์พี่ของพระเอก, ศัตรู)
- "selfRef": สรรพนามที่ตัวละครนี้ควรใช้แทนตัวเองในภาษาไทยตามแนวเรื่องและฐานะ (เช่น ข้า, ข้าน้อย, ผม, ฉัน)
- "addressing": ตัวละครนี้เรียกคนอื่นว่าอะไร [{"to": "ชื่อต้นฉบับของอีกฝ่าย", "term": "คำเรียกภาษาไทย"}] เฉพาะที่เห็นจากบทสนทนาจริง
ส่งเฉพาะตัวละครที่มีหลักฐานในข้อความนี้ ห้ามเดา
${knownLines}`;
}

async function extractCharacterProfiles(text, ctx, bible, { signal = null, onStatus = null } = {}) {
  const prompt = `คุณคือบรรณาธิการนิยายแนว "${ctx.genre}" เรื่อง "${ctx.title}"
${buildCharacterExtractionInstruction(bible, text)}

ตอบกลับเป็น JSON เท่านั้น: {"characters":[{"src":"","aliases":[],"gender":"unknown","role":"","selfRef":"","addressing":[]}]}

ข้อความ:
${text}`;
  const parsed = await callLLMJson(prompt, { signal, onStatus, schema: SCHEMAS.characters, role: 'aux' });
  return Array.isArray(parsed?.characters) ? parsed.characters : [];
}

/** สร้าง/เติมคู่มือจากตอนเนื้อเรื่องที่แปลแล้ว (เหมาะกับเรื่องที่แปลไว้ก่อนมีระบบคู่มือ) */
async function generateBibleFromChapters() {
  if (!hasActiveApiKey()) return alert("กรุณาใส่ API Key ในเมนู 'ตั้งค่า' ก่อนใช้งาน");
  const books = await dbGetAllBooks();
  const ctx = makeBookContext(books.find(b => b.bookId === bibleEditingBookId) || getCurrentBookContext());
  const storyChaps = (await dbGetChaptersByBook(bibleEditingBookId)).filter(isStoryChapter).sort((a, b) => b.order - a.order);
  let text = '';
  for (const ch of storyChaps) {
    const chText = ch.paragraphs.filter(p => (p.kind || 'story') === 'story').map(p => p.src).join('\n');
    if (text.length + chText.length > 12000) break;
    text = chText + '\n\n' + text;
  }
  if (!text.trim()) return alert('ยังไม่มีตอนเนื้อเรื่องที่แปลไว้');
  showGlobalToast('AI กำลังวิเคราะห์ตัวละครจากตอนที่แปลแล้ว...');
  try {
    const updates = await extractCharacterProfiles(text, ctx, bibleDraft.bible);
    const result = mergeCharacterUpdates(bibleDraft.bible, updates);
    await saveBibleDraft();
    await renderBibleCharacters();
    alert(`วิเคราะห์เสร็จแล้ว: เพิ่มตัวละครใหม่ ${result.added} ตัว, เสนอแก้ไข ${result.proposed} ตัว`);
  } catch (err) {
    if (!isAbortError(err)) alert(`สร้างคู่มือไม่สำเร็จ: ${err.message}`);
  } finally {
    hideGlobalToast();
  }
}
