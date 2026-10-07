// ==================== TRANSLATION QUALITY (ประวัติเวอร์ชันของตอน + รายงานคุณภาพทั้งเรื่อง) ====================
// ประวัติเวอร์ชัน: ทุกครั้งที่คำแปลของตอนถูกแทน (แปลใหม่ / วางเนื้อหาเต็ม / ดึงใหม่ / กู้คืน / ใช้ผลเทียบโมเดล)
//   เก็บฉบับก่อนหน้าไว้ใน store chapterVersions (ค่าเริ่มต้น 3 ฉบับต่อตอน) เทียบทีละย่อหน้าและกู้คืนได้
//   thDraft (ฉบับก่อนเกลา/ก่อนผู้ใช้แก้ รายย่อหน้า) ยังทำงานเหมือนเดิม
// รายงานคุณภาพ: รวมจุดที่ควรตรวจของทั้งเรื่องไว้ที่เดียว กดแล้วไปที่ย่อหน้านั้นได้

const VERSION_REASON_LABELS = {
  retranslate: 'ก่อนแปลใหม่',
  translate: 'ก่อนแปลตอนที่รอแปล',
  preview: 'ก่อนแปลจากตัวอย่าง',
  refetch: 'ก่อนดึงจากหน้าเว็บใหม่',
  paste: 'ก่อนวางเนื้อหาเต็ม',
  restore: 'ก่อนกู้คืนฉบับเก่า',
  benchmark: 'ก่อนใช้ผลเทียบโมเดล',
  sync: 'ฉบับในเครื่องนี้ ก่อนรับฉบับใหม่กว่าจากอีกเครื่อง'
};
const VERSION_KEEP_DEFAULT = 3;
const VERSION_KEEP_MAX = 10;

function getVersionKeep() {
  const raw = localStorage.getItem('nov_version_keep');
  if (raw === null || raw === '') return VERSION_KEEP_DEFAULT;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(VERSION_KEEP_MAX, Math.max(0, n)) : VERSION_KEEP_DEFAULT;
}

/** ตอนนี้มีคำแปลจริงที่ควรเก็บไหม (ตอนรอแปล / ตอนที่ไม่มีคำแปลเลย ไม่ต้องเก็บ) */
function chapterHasTranslation(chap) {
  if (!chap || chap.status === 'pending') return false;
  return (chap.paragraphs || []).some(p => (p.th || '').trim() && p.th !== UNTRANSLATED_MARK);
}

function versionContentKey(paragraphs) {
  return hashString((paragraphs || []).map(p => `${p.src || ''}\u0001${p.th || ''}`).join('\u0002'));
}

function buildVersionRecord(chap, reason, at = Date.now()) {
  return {
    id: `${chap.id}_v${at}`,
    chapId: chap.id,
    bookId: chap.bookId,
    at,
    reason: VERSION_REASON_LABELS[reason] ? reason : 'retranslate',
    title: chap.title || '',
    summary: chap.summary || '',
    chapterType: chap.chapterType || 'story',
    ...(chap.previewOnly ? { previewOnly: true } : {}),
    translationMeta: chap.translationMeta ? { ...chap.translationMeta } : null,
    paragraphs: (chap.paragraphs || []).map(p => ({ ...p }))
  };
}

/** เก็บคำแปลปัจจุบันของตอนเป็นฉบับก่อนหน้า คืน true ถ้าเก็บ (ฉบับเดียวกับฉบับล่าสุดที่เก็บไว้ ไม่เก็บซ้ำ) */
async function saveChapterVersion(chap, reason = 'retranslate') {
  const keep = getVersionKeep();
  if (!keep || !chapterHasTranslation(chap) || !chap.bookId) return false;
  const latest = (await dbGetChapterVersions(chap.id))[0];
  if (latest && versionContentKey(latest.paragraphs) === versionContentKey(chap.paragraphs)) return true;
  await dbAddChapterVersion(buildVersionRecord(chap, reason), keep);
  return true;
}

/**
 * จับคู่ย่อหน้าปัจจุบันกับฉบับเก่าด้วยข้อความต้นฉบับ (ไม่ใช่ตำแหน่ง) เพราะแปลใหม่แล้วจำนวนย่อหน้าอาจเปลี่ยน
 * คืนแถว { cur, old, changed } โดย cur/old เป็น index หรือ null (มีเฉพาะฉบับใดฉบับหนึ่ง)
 */
function alignVersionParagraphs(current, old) {
  const bySrc = new Map();
  (old || []).forEach((p, j) => {
    const key = p.src || `#${j}`;
    if (!bySrc.has(key)) bySrc.set(key, []);
    bySrc.get(key).push(j);
  });
  const used = new Set();
  const rows = [];
  (current || []).forEach((p, i) => {
    const key = p.src || `#${i}`;
    const j = (bySrc.get(key) || []).find(x => !used.has(x));
    if (j === undefined) {
      rows.push({ cur: i, old: null, changed: true });
      return;
    }
    used.add(j);
    rows.push({ cur: i, old: j, changed: (p.th || '') !== (old[j].th || '') });
  });
  (old || []).forEach((p, j) => { if (!used.has(j)) rows.push({ cur: null, old: j, changed: true }); });
  return rows;
}

// ---------- UI: หน้าต่างประวัติเวอร์ชัน ----------
let versionView = { chapId: null, versions: [], index: 0, onlyChanged: true };

async function openVersionHistory(chapId) {
  const chap = await findChapterAnywhere(chapId);
  if (!chap) return appAlert('ไม่พบตอนนี้');
  versionView = { chapId, versions: await dbGetChapterVersions(chapId), index: 0, onlyChanged: true };
  openModal('version-modal');
  await renderVersionHistory();
}

function versionLabel(v) {
  const meta = v.translationMeta || {};
  const model = meta.model ? ` · ${meta.model}` : '';
  const mode = meta.qualityMode ? ` · ${({ fast: 'เร็ว', balanced: 'สมดุล', thorough: 'ละเอียด', best: 'ดีที่สุด' })[meta.qualityMode] || meta.qualityMode}` : '';
  return `${new Date(v.at).toLocaleString('th-TH')} (${VERSION_REASON_LABELS[v.reason] || v.reason}${model}${mode})`;
}

async function renderVersionHistory() {
  const box = document.getElementById('version-modal-body');
  const chap = await findChapterAnywhere(versionView.chapId);
  if (!box || !chap) return;
  document.getElementById('version-modal-title').textContent = `ฉบับก่อนหน้า: ${chap.title || ''}`;
  const keepSelect = `<label style="font-size: 11px; display: flex; gap: 4px; align-items: center;">เก็บย้อนหลัง
    <select class="form-input" style="width: auto; padding: 2px 4px; font-size: 11px;" onchange="setVersionKeep(this.value)">
      ${[0, 1, 2, 3, 5, 10].map(n => `<option value="${n}" ${n === getVersionKeep() ? 'selected' : ''}>${n === 0 ? 'ไม่เก็บ' : `${n} ฉบับ`}</option>`).join('')}
    </select> ต่อตอน</label>`;
  if (!versionView.versions.length) {
    box.innerHTML = `<div class="reader-empty">ยังไม่มีฉบับก่อนหน้าของตอนนี้<br><small>ระบบเก็บให้เองทุกครั้งที่แปลใหม่ วางเนื้อหาเต็ม หรือดึงจากเว็บใหม่</small></div>
      <div style="margin-top: 8px;">${keepSelect}</div>`;
    return;
  }
  const v = versionView.versions[versionView.index];
  const rows = alignVersionParagraphs(chap.paragraphs, v.paragraphs);
  const changed = rows.filter(r => r.changed);
  const shown = versionView.onlyChanged ? changed : rows;
  const cell = (p) => p ? escapeHtml(p.th || '(ว่าง)') : '<span style="opacity: 0.5;">(ไม่มีย่อหน้านี้)</span>';
  box.innerHTML = `
    <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 8px;">
      <select class="form-input" style="flex: 1; min-width: 200px;" onchange="versionView.index = Number(this.value); renderVersionHistory()">
        ${versionView.versions.map((x, i) => `<option value="${i}" ${i === versionView.index ? 'selected' : ''}>${escapeHtml(versionLabel(x))}</option>`).join('')}
      </select>
      ${keepSelect}
    </div>
    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; font-size: 12px;">
      <span>ต่างกัน <b>${changed.length}</b> จาก ${rows.length} ย่อหน้า</span>
      <label style="cursor: pointer;"><input type="checkbox" ${versionView.onlyChanged ? 'checked' : ''} onchange="versionView.onlyChanged = this.checked; renderVersionHistory()"> แสดงเฉพาะที่ต่าง</label>
      <span style="margin-left: auto; display: flex; gap: 6px;">
        <button class="btn btn-primary btn-sm" onclick="restoreChapterVersion()">↩ กู้คืนทั้งตอน</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCurrentVersion()">ลบฉบับนี้</button>
      </span>
    </div>
    <div class="version-diff">
      <div class="version-diff-head"><span>ปัจจุบัน</span><span>ฉบับนี้</span></div>
      ${shown.map(r => `<div class="version-row${r.changed ? ' changed' : ''}">
        <div>${cell(r.cur !== null ? chap.paragraphs[r.cur] : null)}</div>
        <div>${cell(r.old !== null ? v.paragraphs[r.old] : null)}
          ${r.changed && r.cur !== null && r.old !== null ? `<div><button class="para-action-btn" onclick="restoreVersionParagraph(${r.cur}, ${r.old})">↩ ใช้ย่อหน้านี้</button></div>` : ''}</div>
      </div>`).join('') || '<div class="reader-empty">ทุกย่อหน้าเหมือนกัน</div>'}
    </div>`;
}

function setVersionKeep(value) {
  localStorage.setItem('nov_version_keep', String(Math.min(VERSION_KEEP_MAX, Math.max(0, parseInt(value, 10) || 0))));
}

/** แทนเนื้อหาของตอนในหน่วยความจำด้วยข้อมูลที่บันทึกแล้ว และวาดหน้าใหม่ */
async function afterChapterRestored(chap) {
  await dbSaveChapter(chap);
  const mem = chapters.find(c => c.id === chap.id);
  if (mem && mem !== chap) Object.assign(mem, chap);
  if (currentBookId === chap.bookId) await renderVirtualWindow(currentChapterIndex);
}

async function restoreChapterVersion() {
  const chap = await findChapterAnywhere(versionView.chapId);
  const v = versionView.versions[versionView.index];
  if (!chap || !v) return;
  if (!(await appConfirm(`คำแปลทั้งตอนจะกลับเป็นฉบับ ${versionLabel(v)}\nคำแปลปัจจุบันจะเก็บไว้ในประวัติ กู้กลับได้`, { title: 'กู้คืนทั้งตอน', confirmLabel: 'กู้คืน' }))) return;
  if (await saveChapterVersion(chap, 'restore')) chap.hasVersions = true;
  chap.paragraphs = v.paragraphs.map(p => ({ ...p }));
  chap.summary = v.summary || '';
  chap.chapterType = v.chapterType || chap.chapterType || 'story';
  if (v.previewOnly) chap.previewOnly = true;
  else delete chap.previewOnly;
  chap.translationMeta = { ...(v.translationMeta || {}), restoredFrom: v.at, restoredAt: Date.now() };
  await afterChapterRestored(chap);
  versionView.versions = await dbGetChapterVersions(chap.id);
  versionView.index = 0;
  await renderVersionHistory();
  showGlobalToast('↩ กู้คืนคำแปลแล้ว');
  setTimeout(hideGlobalToast, 1500);
}

async function restoreVersionParagraph(curIdx, oldIdx) {
  const chap = await findChapterAnywhere(versionView.chapId);
  const v = versionView.versions[versionView.index];
  const p = chap?.paragraphs?.[curIdx];
  const old = v?.paragraphs?.[oldIdx];
  if (!p || !old) return;
  // ฉบับปัจจุบันเก็บไว้ใน thDraft สลับกลับได้ด้วยปุ่ม "↺" เหมือนการแก้คำแปลเอง
  chap.paragraphs[curIdx] = { ...p, th: old.th, thDraft: p.th, userEdited: true };
  delete chap.paragraphs[curIdx].fidelityIssue;
  await afterChapterRestored(chap);
  await renderVersionHistory();
}

async function deleteCurrentVersion() {
  const v = versionView.versions[versionView.index];
  if (!v || !(await appConfirm(`ฉบับ ${versionLabel(v)} จะถูกลบออกจากประวัติ`, { title: 'ลบฉบับเก่า', confirmLabel: 'ลบฉบับนี้', danger: true }))) return;
  await dbDeleteChapterVersion(v.id);
  versionView.versions = await dbGetChapterVersions(versionView.chapId);
  versionView.index = 0;
  if (!versionView.versions.length) {
    const chap = await findChapterAnywhere(versionView.chapId);
    if (chap) {
      delete chap.hasVersions;
      await afterChapterRestored(chap);
    }
  }
  await renderVersionHistory();
}

// ==================== รายงานคุณภาพทั้งเรื่อง ====================
const QUALITY_LIST_LIMIT = 200;

/** รวบรวมจุดที่ควรตรวจของเรื่อง (คำนวณในเครื่อง ไม่ใช้ AI) */
async function buildQualityReport(bookId) {
  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  const chaps = (await dbGetChaptersByBook(bookId)).sort((a, b) => (a.order || 0) - (b.order || 0));
  const labels = computeChapterNumbers(chaps);
  const [activeTerms, extras, glossary] = await Promise.all([getActiveGlossaryForBook(bookId), getBookExtras(bookId), dbGetAllGlossaryItems()]);
  const diagnose = makeParagraphDiagnoser(activeTerms, getBookSourceLang(book));
  const report = { bookId, title: book?.title || bookId, chapters: chaps.length, suspicious: [], fidelity: [], oldPrompt: [], pending: [], locked: [], preview: [], pendingCharacters: [], newTerms: [], storyLogMissing: 0, storyLogStale: 0 };
  const ref = (c) => ({ chapId: c.id, label: labels.get(c.id), title: c.title || '' });

  chaps.forEach(c => {
    if (c.status === 'pending') return report.pending.push(ref(c));
    if (c.chapterType === 'placeholder') return report.locked.push(ref(c));
    if (c.previewOnly) report.preview.push(ref(c));
    if (!chapterHasTranslation(c)) return;
    const meta = c.translationMeta || {};
    if (!meta.skipped && meta.promptVersion !== PROMPT_VERSION) report.oldPrompt.push({ ...ref(c), promptVersion: meta.promptVersion || 'ไม่ทราบ', model: meta.model || '' });
    c.paragraphs.forEach((p, i) => {
      const kind = p.kind || 'story';
      if (kind === 'site_junk') return;
      if (p.fidelityIssue) report.fidelity.push({ ...ref(c), paraIdx: i, issue: p.fidelityIssue, th: p.th || '' });
      // ย่อหน้าที่ผู้ใช้แก้เองถือว่าตรวจแล้ว (ยกเว้นยังไม่ได้แปล)
      if (kind !== 'story' || (p.userEdited && p.th !== UNTRANSLATED_MARK)) return;
      const reasons = diagnose(p);
      if (reasons.length) report.suspicious.push({ ...ref(c), paraIdx: i, reasons, th: p.th || '' });
    });
    if (['story', 'side_story'].includes(c.chapterType || 'story') && storySourceText(c).trim()) {
      if (!c.storyLog) report.storyLogMissing++;
      else if (!isStoryLogFresh(c)) report.storyLogStale++;
    }
  });
  report.pendingCharacters = (extras.bible?.characters || []).filter(ch => ch.pending).map(ch => ({ src: ch.src, name: activeTerms[ch.src]?.resolvedTgt || ch.src }));
  report.newTerms = glossary
    .filter(t => t.auto && !t.confirmed && Array.isArray(t.books) && t.books.includes(bookId))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map(t => ({ src: t.src, tgt: resolveTermForBook(t, bookId), category: t.category, count: t.count || 1 }));
  return report;
}

let qualityReportBookId = null;

async function openQualityReport(bookId = currentBookId) {
  closeModal('bookshelf-modal');
  await openReaderTools('quality', bookId);
}

function qualityItemButton(r, bookId, extra = '') {
  return `<button class="reader-result" onclick="jumpToParagraph(${jsArg(bookId)}, ${jsArg(r.chapId)}, ${Number(r.paraIdx || 0)}, true)">
    <div class="reader-result-meta">#${escapeHtml(r.label)} ${escapeHtml(r.title)}${r.paraIdx !== undefined ? ` · ย่อหน้า ${r.paraIdx + 1}` : ''}${extra}</div>
    ${r.th ? `<div class="reader-result-text">${escapeHtml(r.th.slice(0, 160))}${r.th.length > 160 ? '…' : ''}</div>` : ''}</button>`;
}

function qualitySection(title, count, body, { open = false, hint = '' } = {}) {
  return `<details class="quality-section"${open ? ' open' : ''}>
    <summary><span>${title}</span><b class="${count ? 'quality-count-bad' : 'quality-count-ok'}">${count ? count.toLocaleString() : '✓'}</b></summary>
    ${hint ? `<div class="quality-hint">${hint}</div>` : ''}
    ${count ? body : '<div class="quality-hint">ไม่มี</div>'}
  </details>`;
}

function limitList(list, render) {
  const shown = list.slice(0, QUALITY_LIST_LIMIT).map(render).join('');
  return shown + (list.length > QUALITY_LIST_LIMIT ? `<div class="quality-hint">…และอีก ${(list.length - QUALITY_LIST_LIMIT).toLocaleString()} รายการ</div>` : '');
}

async function renderQualityReport() {
  const box = document.getElementById('reader-quality-panel');
  if (!box) return;
  const bookId = qualityReportBookId || currentBookId;
  if (!bookId || bookId === 'default_novel') {
    box.innerHTML = '<div class="reader-empty">เปิดนิยายจากชั้นหนังสือก่อน</div>';
    return;
  }
  box.innerHTML = '<div class="reader-empty"><span class="spinner-icon"></span> กำลังตรวจทั้งเรื่อง...</div>';
  const r = await buildQualityReport(bookId);
  const isCurrent = bookId === currentBookId;
  const reasonText = (reasons) => reasons.map(x => SUSPICIOUS_REASON_LABELS[x] || x).join(', ');
  const total = r.suspicious.length + r.fidelity.length + r.oldPrompt.length + r.pendingCharacters.length + r.newTerms.length;
  box.innerHTML = `
    <div class="quality-head">
      <div><b>${escapeHtml(r.title)}</b> · ${r.chapters.toLocaleString()} ตอน</div>
      <div class="quality-hint">${total ? `พบ ${total.toLocaleString()} จุดที่ควรตรวจ` : 'ไม่พบจุดที่ต้องตรวจ'} · ตรวจในเครื่อง ไม่ใช้โควตา AI
        <button class="btn btn-sm" style="margin-left: 6px;" onclick="renderQualityReport()">ตรวจใหม่</button></div>
    </div>
    ${qualitySection('🔎 ย่อหน้าน่าสงสัย', r.suspicious.length, limitList(r.suspicious, x => qualityItemButton(x, bookId, ` · <span class="quality-reason">${escapeHtml(reasonText(x.reasons))}</span>`)), {
      open: true, hint: 'ตรวจด้วยกฎ: ตัวอักษรต้นฉบับหลงเหลือ, ชื่อไม่ตรงคลังศัพท์, ความยาวผิดปกติ, วงเล็บ, ย่อหน้าที่แปลไม่สำเร็จ (ย่อหน้าที่แก้เองแล้วไม่นับ)'
    })}
    ${qualitySection('🛡️ ตรวจความหมายหลังเกลาไม่ผ่าน', r.fidelity.length, limitList(r.fidelity, x => qualityItemButton(x, bookId, ` · <span class="quality-reason">${escapeHtml(x.issue)}</span>`)), {
      hint: 'โหมด "ดีที่สุด": ฉบับเกลาความหมายไม่ตรง ระบบใช้ร่างแรกแทนแล้ว ควรอ่านทวนอีกครั้ง'
    })}
    ${qualitySection('🕰️ แปลด้วยคำสั่งรุ่นเก่า', r.oldPrompt.length, limitList(r.oldPrompt, x => `<div class="quality-row">${qualityItemButton(x, bookId, ` · คำสั่งรุ่น ${escapeHtml(x.promptVersion)}${x.model ? ` · ${escapeHtml(x.model)}` : ''}`)}
      <button class="btn" style="padding: 2px 8px; font-size: 11px; flex-shrink: 0;" onclick="retranslateSpecificChapterDirect(${jsArg(x.chapId)})" title="ใช้โควตา AI">🔄 แปลใหม่</button></div>`), {
      hint: `คำสั่งแปลปัจจุบันรุ่น ${PROMPT_VERSION} ตอนที่แปลก่อนหน้านี้อาจได้คุณภาพต่ำกว่า แปลใหม่ได้ทีละตอน (ฉบับเดิมเก็บไว้ในประวัติ)`
    })}
    ${qualitySection('👤 ตัวละครที่ข้อมูลขัดกัน รอยืนยัน', r.pendingCharacters.length, `<div class="quality-hint">${r.pendingCharacters.map(c => escapeHtml(c.name)).join(', ')}</div>
      ${isCurrent ? '<button class="btn btn-secondary btn-sm" onclick="closeModal(\'reader-tools-modal\'); openBibleModal()">เปิดคู่มือเรื่องเพื่อยืนยัน</button>' : ''}`, {
      hint: 'AI เจอข้อมูลใหม่ที่ไม่ตรงกับคู่มือเรื่อง (เพศ บทบาท คำเรียก) ยังไม่ได้ใช้จนกว่าจะยืนยัน'
    })}
    ${qualitySection('🏷️ คำศัพท์ใหม่ที่ AI เพิ่ม ยังไม่ยืนยัน', r.newTerms.length, `
      <div style="margin-bottom: 6px;"><button class="btn btn-secondary" style="padding: 3px 10px; font-size: 12px;" onclick="confirmAllNewTerms(${jsArg(bookId)})">✓ ยืนยันทั้งหมด</button></div>
      ${limitList(r.newTerms, t => `<div class="quality-term">
        <span><b>${escapeHtml(t.src)}</b> → ${escapeHtml(t.tgt)} <small style="opacity: 0.6;">${escapeHtml(getCategoryLabel(t.category))} · พบ ${t.count} ครั้ง</small></span>
        <span style="display: flex; gap: 4px;">
          <button class="btn" style="padding: 1px 8px; font-size: 11px;" onclick="confirmGlossaryTerms([${jsArg(t.src)}]).then(renderQualityReport)">✓</button>
          ${isCurrent ? `<button class="btn" style="padding: 1px 8px; font-size: 11px;" onclick="openEditTermModal(${jsArg(t.src)})">✎ แก้</button>` : ''}
        </span></div>`)}`, {
      hint: 'ตรวจคำแปลชื่อที่ AI ตั้งให้ ถ้าถูกแล้วกดยืนยัน ถ้าผิดกดแก้ (ระบบแทนชื่อในตอนที่แปลแล้วให้)'
    })}
    ${qualitySection('⏳ ตอนที่ยังไม่ได้แปล', r.pending.length, limitList(r.pending, x => qualityItemButton(x, bookId)))}
    ${qualitySection('🔒 ตอนกันก๊อป / ตอนที่ต้องซื้อ', r.locked.length, limitList(r.locked, x => qualityItemButton(x, bookId)))}
    ${qualitySection('📄 แปลจากตัวอย่าง (ไม่ครบตอน)', r.preview.length, limitList(r.preview, x => qualityItemButton(x, bookId)))}
    ${qualitySection('📜 บันทึกเหตุการณ์ขาด/ไม่ตรงเนื้อหา', r.storyLogMissing + r.storyLogStale, `<div class="quality-hint">ขาด ${r.storyLogMissing} ตอน · เนื้อหาเปลี่ยนหลังทำบันทึก ${r.storyLogStale} ตอน (ผู้ช่วย AI และเพลงประกอบจะแม่นน้อยลง)</div>
      ${isCurrent ? '<button class="btn btn-secondary btn-sm" onclick="closeModal(\'reader-tools-modal\'); openStoryLogFromAssistant()">เปิดแท็บบันทึกเหตุการณ์</button>' : ''}`)}`;
}

/** ยืนยันคำศัพท์ที่ AI เพิ่ม (ไม่เปลี่ยนคำแปล แค่บอกว่าตรวจแล้ว) */
async function confirmGlossaryTerms(srcList) {
  const set = new Set(srcList);
  for (const item of inMemoryGlossaryCache.filter(t => set.has(t.src) && t.auto && !t.confirmed)) {
    item.confirmed = true;
    await dbSaveGlossaryItem(item);
  }
}

async function confirmAllNewTerms(bookId) {
  const list = inMemoryGlossaryCache.filter(t => t.auto && !t.confirmed && Array.isArray(t.books) && t.books.includes(bookId)).map(t => t.src);
  if (!list.length || !(await appConfirm(`คำศัพท์ใหม่ ${list.length} คำจะถูกบันทึกว่าตรวจแล้ว คำแปลไม่เปลี่ยน`, { title: 'ยืนยันคำศัพท์', confirmLabel: `ยืนยัน ${list.length} คำ` }))) return;
  await confirmGlossaryTerms(list);
  await renderQualityReport();
}
