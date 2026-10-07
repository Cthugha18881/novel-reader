// ==================== MODEL BENCHMARK (เทียบโมเดลด้วยตอนเดียวกัน) ====================
// แปลตอนที่เปิดอยู่ด้วยหลายโมเดล (ผู้ให้บริการที่ใส่คีย์ไว้แล้ว) แล้วเทียบคำแปลทีละย่อหน้า เวลา และ token จริง
// ใช้ข้อมูลนี้เลือกโมเดลหลัก/โมเดลงานรอง
// การเทียบไม่แตะเรื่องจริง: ไม่เขียนคลังศัพท์ ไม่ทำบันทึกเหตุการณ์ ไม่เปลี่ยนการตั้งค่า (เลือก "ใช้ผลนี้" เองถึงจะเปลี่ยนตอน)

const BENCHMARK_MAX_MODELS = 4;
const BENCHMARK_META_KEY = 'benchmarkLast';
let benchmarkState = null;   // { chapId, bookId, chapTitle, qualityMode, src: [], results: [] }

function benchmarkProviders() {
  return Object.keys(LLM_PROVIDERS).filter(p => getProviderKeys(p).length > 0);
}

function benchmarkDefaultRows() {
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem('nov_benchmark_models') || '[]'); } catch (e) { return []; }
  })();
  const providers = benchmarkProviders();
  const rows = (Array.isArray(saved) ? saved : []).filter(r => providers.includes(r?.provider) && r.model).slice(0, BENCHMARK_MAX_MODELS);
  if (rows.length) return rows;
  const active = getActiveLlmConfig();
  return active.keys.length && active.model ? [{ provider: active.provider, model: active.model }] : [];
}

async function openBenchmarkModal() {
  closeModal('settings-modal');
  closeModal('usage-modal');
  openModal('benchmark-modal');
  if (!benchmarkState) {
    const last = await dbGetMeta(BENCHMARK_META_KEY).catch(() => null);
    if (last?.results?.length) benchmarkState = last;
  }
  renderBenchmarkSetup(benchmarkDefaultRows());
  renderBenchmarkResults();
}

function benchmarkRowHtml(row = {}, i = 0) {
  const providers = benchmarkProviders();
  const models = getCachedModels(row.provider || providers[0] || 'gemini');
  return `<div class="bench-row" data-row="${i}">
    <select class="form-input" data-bench="provider" onchange="this.closest('.bench-row').querySelector('[data-bench=model]').setAttribute('list', 'bench-models-' + this.value)">
      ${providers.map(p => `<option value="${p}" ${p === row.provider ? 'selected' : ''}>${escapeHtml(LLM_PROVIDERS[p].label)}</option>`).join('')}
    </select>
    <input class="form-input" data-bench="model" list="bench-models-${escapeHtml(row.provider || providers[0] || '')}" value="${escapeHtml(row.model || '')}" placeholder="ชื่อโมเดล เช่น xiaomi/mimo-v2.6-flash">
    <select class="form-input" data-bench="reasoning" title="การคิดก่อนตอบ (ใช้กับ OpenRouter เท่านั้น)">
      <option value="">คิด: ตามตั้งค่า</option>
      ${REASONING_LEVELS.map(l => `<option value="${l}" ${row.reasoning === l ? 'selected' : ''}>คิด: ${({ none: 'ปิด', low: 'น้อย', medium: 'กลาง', high: 'มาก', default: 'ค่าของโมเดล' })[l]}</option>`).join('')}
    </select>
    <button class="btn btn-danger" style="padding: 2px 8px;" onclick="this.closest('.bench-row').remove()" title="เอาออก">✕</button>
  </div>`;
}

function renderBenchmarkSetup(rows) {
  const box = document.getElementById('benchmark-setup');
  const providers = benchmarkProviders();
  const chap = chapters[currentChapterIndex];
  const usable = chap && currentBookId !== 'default_novel' && (chap.paragraphs || []).some(p => p.src);
  if (!providers.length) {
    box.innerHTML = '<div class="reader-empty">ยังไม่มีผู้ให้บริการที่ใส่ API Key ไว้ ใส่ที่ ตั้งค่า ก่อน<br><small>โมเดลอย่าง MiMo-V2.6-Flash / GPT-6 Luna ใช้ผ่าน OpenAI-compatible (เช่น OpenRouter) ได้</small></div>';
    return;
  }
  const datalists = providers.map(p => `<datalist id="bench-models-${p}">${getCachedModels(p).map(m => `<option value="${escapeHtml(typeof m === 'string' ? m : m.id || '')}">`).join('')}</datalist>`).join('');
  box.innerHTML = `
    <div class="quality-hint" style="margin-bottom: 6px;">แปลตอนที่เปิดอยู่ด้วยแต่ละโมเดล แล้วเทียบคำแปล เวลา และ token จริง ใช้โควตาของแต่ละผู้ให้บริการ (ประมาณเท่าแปล 1 ตอนต่อโมเดล) ไม่แตะคลังศัพท์และตอนจริง</div>
    <div style="font-size: 12px; margin-bottom: 6px;">ตอน: <b>${usable ? escapeHtml(chap.title) : 'ยังไม่ได้เปิดตอนที่มีต้นฉบับ'}</b>${usable ? ` · ${(chap.paragraphs || []).filter(p => p.src).length} ย่อหน้า` : ''}</div>
    <div class="bench-row bench-row-head"><span>ผู้ให้บริการ</span><span>โมเดล</span><span>การคิด</span><span></span></div>
    <div id="bench-rows">${(rows.length ? rows : [{}]).map(benchmarkRowHtml).join('')}</div>
    ${datalists}
    <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 6px;">
      <button class="btn" onclick="addBenchmarkRow()">+ เพิ่มโมเดล</button>
      <label style="font-size: 12px;">โหมดคุณภาพ
        <select class="form-input" id="bench-quality" style="width: auto;">
          ${QUALITY_MODES.map(m => `<option value="${m}" ${m === getQualityMode() ? 'selected' : ''}>${({ fast: 'เร็ว', balanced: 'สมดุล', thorough: 'ละเอียด', best: 'ดีที่สุด' })[m]}</option>`).join('')}
        </select></label>
      <span style="margin-left: auto; display: flex; gap: 6px;">
        <button class="btn btn-danger" id="bench-stop-btn" style="display: none;" onclick="abortTask('benchmark')">หยุด</button>
        <button class="btn btn-primary" id="bench-run-btn" ${usable ? '' : 'disabled'} onclick="runBenchmark()">▶ เริ่มเทียบ</button>
      </span>
    </div>
    <div id="bench-progress" class="quality-hint" style="margin-top: 6px;"></div>`;
}

function addBenchmarkRow() {
  const box = document.getElementById('bench-rows');
  if (box.querySelectorAll('.bench-row').length >= BENCHMARK_MAX_MODELS) return appAlert(`เทียบได้ครั้งละไม่เกิน ${BENCHMARK_MAX_MODELS} โมเดล`);
  box.insertAdjacentHTML('beforeend', benchmarkRowHtml({}, box.children.length));
}

function readBenchmarkRows() {
  return [...document.querySelectorAll('#bench-rows .bench-row')].map(row => {
    const v = (k) => row.querySelector(`[data-bench="${k}"]`)?.value?.trim() || '';
    return { provider: v('provider'), model: v('model'), reasoning: v('reasoning') };
  }).filter(r => r.provider && r.model);
}

async function runBenchmark() {
  const rows = readBenchmarkRows();
  if (!rows.length) return appAlert('ใส่อย่างน้อย 1 โมเดล');
  const chap = chapters[currentChapterIndex];
  const rawText = (chap?.paragraphs || []).map(p => p.src || '').filter(Boolean).join('\n\n');
  if (!rawText) return appAlert('ตอนนี้ไม่มีต้นฉบับ');
  const qualityMode = document.getElementById('bench-quality').value;
  if (!(await appConfirm(`แปลตอน "${chap.title}" ด้วย ${rows.length} โมเดล (โหมด ${qualityMode})\nใช้โควตา AI (token) ประมาณเท่าแปล ${rows.length} ตอน`, { title: 'เทียบโมเดล', confirmLabel: `เริ่มเทียบ ${rows.length} โมเดล` }))) return;

  // จำโมเดลที่เลือกไว้
  localStorage.setItem('nov_benchmark_models', JSON.stringify(rows.map(r => ({ provider: r.provider, model: r.model, reasoning: r.reasoning }))));

  const books = await dbGetAllBooks();
  const ctx = makeBookContext(books.find(b => b.bookId === currentBookId) || getCurrentBookContext());
  const bookChaps = await dbGetChaptersByBook(currentBookId);
  const prevChapter = findPrevStoryChapter(bookChaps, chap.order ?? 0);
  const main = beginTask('benchmark');
  tagTask(main.signal, { manual: true });
  const progress = document.getElementById('bench-progress');
  document.getElementById('bench-run-btn').style.display = 'none';
  document.getElementById('bench-stop-btn').style.display = 'inline-flex';
  // ย่อหน้าตามที่ translateChapter แบ่งเอง (ทุกโมเดลได้ชุดเดียวกัน) ใช้จับคู่ผลแต่ละโมเดลทีละย่อหน้า
  benchmarkState = { chapId: chap.id, bookId: currentBookId, chapTitle: chap.title, qualityMode, at: Date.now(), src: splitSourceParagraphs(rawText), results: [] };
  const diagnose = makeParagraphDiagnoser(await getActiveGlossaryForBook(currentBookId), ctx.sourceLang);
  try {
    for (const [i, r] of rows.entries()) {
      if (main.signal.aborted) break;
      // แต่ละโมเดลมี signal ของตัวเอง (ผูกโมเดล + นับ token แยกกัน) แต่หยุดพร้อมกันได้จากปุ่มหยุด
      const ctrl = new AbortController();
      main.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
      tagTask(ctrl.signal, { task: 'benchmark', manual: true });
      setModelOverride(ctrl.signal, { provider: r.provider, model: r.model, ...(r.reasoning ? { reasoning: r.reasoning } : {}) });
      const started = performance.now();
      const effectiveReasoning = r.reasoning || getProviderReasoning(r.provider);
      const reasoningNote = r.provider === 'openai' && isOpenRouterUrl(getProviderBaseUrl('openai')) ? ` · คิด: ${({ none: 'ปิด', low: 'น้อย', medium: 'กลาง', high: 'มาก', default: 'ค่าของโมเดล' })[effectiveReasoning]}` : '';
      const label = `${LLM_PROVIDERS[r.provider].label} · ${r.model}${reasoningNote}`;
      progress.innerHTML = `<span class="spinner-icon"></span> (${i + 1}/${rows.length}) ${escapeHtml(label)}...`;
      const entry = { ...r, label };
      try {
        const result = await translateChapter(rawText, ctx, {
          signal: ctrl.signal, benchmark: true, qualityMode, rawChapTitle: chap.title, prevChapter,
          onStatus: (s) => { progress.innerHTML = `<span class="spinner-icon"></span> (${i + 1}/${rows.length}) ${escapeHtml(label)}: ${escapeHtml(s)}`; }
        });
        const usage = getTaskInfo(ctrl.signal).chapter || {};
        Object.assign(entry, {
          ok: true,
          seconds: (performance.now() - started) / 1000,
          input: usage.input || 0, output: usage.output || 0, cacheRead: usage.cacheRead || 0, cacheWrite: usage.cacheWrite || 0, calls: usage.calls || 0, reasoningTokens: usage.reasoning || 0,
          title: result.chapterTitle || '',
          paragraphs: result.paragraphs.map(p => ({ th: p.th || '', kind: p.kind || 'story', ...(p.fidelityIssue ? { fidelityIssue: p.fidelityIssue } : {}) })),
          missing: result.missingCount || 0,
          suspicious: result.paragraphs.filter(p => (p.kind || 'story') === 'story' && diagnose(p).length).length,
          chapterType: result.chapterType,
          summary: result.summary || '',
          translationMeta: { ...result.translationMeta, provider: r.provider, model: r.model, auxModel: r.model, qualityMode }
        });
      } catch (err) {
        if (isAbortError(err) || main.signal.aborted) break;
        Object.assign(entry, { ok: false, error: err.message, seconds: (performance.now() - started) / 1000 });
      }
      benchmarkState.results.push(entry);
      renderBenchmarkResults();
    }
    progress.textContent = main.signal.aborted ? 'หยุดแล้ว (ผลของโมเดลที่เสร็จแล้วยังดูได้)' : 'เทียบเสร็จแล้ว';
    await dbSetMeta(BENCHMARK_META_KEY, benchmarkState).catch(() => {});
  } finally {
    endTask('benchmark', main);
    document.getElementById('bench-run-btn').style.display = 'inline-flex';
    document.getElementById('bench-stop-btn').style.display = 'none';
  }
}

function renderBenchmarkResults() {
  const box = document.getElementById('benchmark-results');
  if (!box) return;
  const s = benchmarkState;
  if (!s?.results?.length) {
    box.innerHTML = '';
    return;
  }
  const ok = s.results.filter(r => r.ok);
  const sameChapter = s.chapId === chapters[currentChapterIndex]?.id;
  const summaryRows = s.results.map((r, i) => {
    if (!r.ok) return `<tr><td>${escapeHtml(r.label)}</td><td colspan="5" style="color: var(--danger);">ไม่สำเร็จ: ${escapeHtml(r.error || '')}</td></tr>`;
    return `<tr>
      <td>${escapeHtml(r.label)}</td>
      <td>${r.seconds.toFixed(0)} วิ</td>
      <td>${formatTokenCount(r.input)} / ${formatTokenCount(r.output)}${r.reasoningTokens ? `<br><small title="token ที่โมเดลใช้คิดก่อนตอบ รวมอยู่ในขาออกแล้ว คิดเงินเป็นขาออก">ใช้คิด ${formatTokenCount(r.reasoningTokens)} (${Math.round(r.reasoningTokens / Math.max(1, r.output) * 100)}%)</small>` : ''}${r.cacheRead ? `<br><small>cache ${formatTokenCount(r.cacheRead)}</small>` : ''}</td>
      <td>${r.suspicious}${r.missing ? ` · ขาด ${r.missing}` : ''}</td>
      <td>${sameChapter ? `<button class="btn" style="padding: 2px 8px; font-size: 11px;" onclick="applyBenchmarkResult(${i})" title="ใช้คำแปลของโมเดลนี้กับตอนนี้ (ฉบับเดิมเก็บไว้ในประวัติ)">ใช้ผลนี้</button>` : ''}</td>
    </tr>`;
  }).join('');
  const paraRows = s.src.map((src, i) => {
    if (!src) return '';
    const cells = ok.map(r => {
      const p = r.paragraphs[i];
      if (!p || p.kind === 'site_junk') return '<td class="bench-cell muted">—</td>';
      return `<td class="bench-cell">${escapeHtml(p.th)}${p.fidelityIssue ? `<div class="quality-reason">⚠️ ตรวจความหมายไม่ผ่าน: ${escapeHtml(p.fidelityIssue)}</div>` : ''}</td>`;
    }).join('');
    return `<tr><td class="bench-cell bench-src">${escapeHtml(src)}</td>${cells}</tr>`;
  }).join('');
  box.innerHTML = `
    <div style="font-size: 12px; margin: 10px 0 6px;"><b>ผลเทียบ:</b> ${escapeHtml(s.chapTitle || '')} · โหมด ${escapeHtml(s.qualityMode)} · ${new Date(s.at).toLocaleString('th-TH')}${sameChapter ? '' : ' <span class="quality-hint">(คนละตอนกับที่เปิดอยู่)</span>'}</div>
    <div class="bench-table-wrap"><table class="bench-summary">
      <thead><tr><th>โมเดล</th><th>เวลา</th><th>token เข้า / ออก</th><th>ย่อหน้าน่าสงสัย</th><th></th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table></div>
    <div class="quality-hint">token เป็นยอดที่ผู้ให้บริการส่งกลับมา (รวมตรวจทาน/เกลาตามโหมด) ยอดจริงดูที่หน้าเว็บผู้ให้บริการ</div>
    ${ok.length ? `<div class="bench-table-wrap" style="margin-top: 8px;"><table class="bench-paras">
      <thead><tr><th>ต้นฉบับ</th>${ok.map(r => `<th>${escapeHtml(r.label)}</th>`).join('')}</tr></thead>
      <tbody>${paraRows}</tbody>
    </table></div>` : ''}`;
}

/** ใช้คำแปลของโมเดลที่เลือกกับตอนจริง (เก็บคำแปลเดิมในประวัติเวอร์ชัน) */
async function applyBenchmarkResult(i) {
  const r = benchmarkState?.results?.[i];
  const chap = chapters.find(c => c.id === benchmarkState?.chapId);
  if (!r?.ok || !chap) return;
  if (!(await appConfirm(`คำแปลปัจจุบันจะเก็บไว้ในประวัติเวอร์ชัน (🕘) กู้คืนได้`, { title: `ใช้คำแปลของ ${r.label}`, confirmLabel: 'ใช้คำแปลนี้' }))) return;
  const editedCount = chap.paragraphs.filter(p => p.userEdited).length;
  let keepEdits = false;
  if (editedCount > 0) {
    const choice = await appChoose(`มี ${editedCount} ย่อหน้าที่คุณแก้เอง`, [
      { label: 'ใช้ของโมเดลทั้งหมด', value: 'all' },
      { label: 'เก็บที่แก้ไว้', value: 'keep', variant: 'primary' }
    ], { title: 'ย่อหน้าที่แก้เอง' });
    if (!choice) return;
    keepEdits = choice === 'keep';
  }
  let paragraphs = benchmarkState.src.map((src, k) => ({ ...(r.paragraphs[k] || { th: '' }), src }));
  if (keepEdits) paragraphs = mergeUserEdits(chap.paragraphs, paragraphs);
  await applyTranslationToChapter(chap, {
    paragraphs, summary: r.summary, chapterType: r.chapterType || chap.chapterType, translationMeta: { ...r.translationMeta, translatedAt: Date.now(), fromBenchmark: true }
  }, { updateTitle: false, reason: 'benchmark' });
  showGlobalToast('ใช้คำแปลนี้แล้ว');
  setTimeout(hideGlobalToast, 1500);
}
