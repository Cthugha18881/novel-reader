// ==================== AI USAGE, BUDGET & DIAGNOSTICS ====================
// นับ token จริงจากผลตอบกลับของผู้ให้บริการ (ไม่ใช่ค่าประมาณ), เพดานค่าใช้จ่าย, เพดานจำนวนครั้งที่เรียก AI ต่อตอน
// และบันทึกข้อผิดพลาด (ตัด API Key ออกแล้ว) สำหรับส่งให้ช่วยตรวจปัญหา

// ---------- ข้อมูลของงานที่กำลังเรียก AI (ผูกกับ AbortSignal ของงานนั้น) ----------
// task: ชื่องานจาก beginTask ('prefetch', 'batch', 'next', ...) | bookId: เรื่องที่กำลังแปล | manual: ผู้ใช้กดสั่งเอง
// chapter: ตัวนับของตอนที่กำลังแปลอยู่ { calls, callLimit, input, output }
const taskInfoBySignal = new WeakMap();
const BACKGROUND_TASKS = new Set(['prefetch', 'batch']);

function tagTask(signal, info) {
  if (!signal) return null;
  const cur = taskInfoBySignal.get(signal) || {};
  const next = Object.assign(cur, info);
  taskInfoBySignal.set(signal, next);
  return next;
}

function getTaskInfo(signal) {
  return (signal && taskInfoBySignal.get(signal)) || {};
}

const DEFAULT_CHAPTER_CALL_LIMIT = 60;

/** เริ่มนับการเรียก AI ของตอนใหม่ (เรียกตอนเริ่ม translateChapter) */
function beginChapterUsage(signal, bookId) {
  return tagTask(signal, { bookId, chapter: { calls: 0, callLimit: DEFAULT_CHAPTER_CALL_LIMIT, input: 0, output: 0 } });
}

/** ตั้งเพดานจำนวนครั้งตามจำนวนส่วนของตอน (ตอนยาวแบ่งหลายส่วน ต้องเรียกมากกว่า) */
function setChapterCallLimit(signal, chunkCount) {
  const info = getTaskInfo(signal);
  if (info.chapter) info.chapter.callLimit = Math.max(DEFAULT_CHAPTER_CALL_LIMIT, 20 + chunkCount * 8);
}

// ---------- วันที่ ----------
function localDayKey(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthOfDay(day) {
  return day.slice(0, 7);
}

// ---------- ราคา (ผู้ใช้กรอกเอง หน่วย USD ต่อ 1 ล้าน token) ----------
// ไม่ใส่ราคาตั้งต้น เพราะราคาเปลี่ยนบ่อย ถ้าไม่ได้กรอก แสดงเฉพาะจำนวน token
function getModelPrices() {
  try {
    const p = JSON.parse(localStorage.getItem('nov_model_prices') || '{}');
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch (e) {
    return {};
  }
}

function saveModelPrices(prices) {
  localStorage.setItem('nov_model_prices', JSON.stringify(prices));
}

/** ส่วนลดของ token ที่อ่านจาก cache (ถ้าไม่ได้กรอกราคา cache เอง): Claude ~10%, เจ้าอื่นประมาณ 25% ของราคา input */
function defaultCachedRatio(provider) {
  return provider === 'anthropic' ? 0.1 : 0.25;
}

/** ค่าใช้จ่ายโดยประมาณของเรคคอร์ดการใช้งาน คืน null ถ้ายังไม่ได้กรอกราคาของโมเดลนั้น */
function estimateCost(rec, prices = getModelPrices()) {
  const p = prices[rec.model];
  if (!p || !Number.isFinite(p.in) || !Number.isFinite(p.out)) return null;
  const cachedPrice = Number.isFinite(p.cached) ? p.cached : p.in * defaultCachedRatio(rec.provider);
  const cacheRead = rec.cacheRead || 0;
  const cacheWrite = rec.cacheWrite || 0;
  const plainInput = Math.max(0, (rec.input || 0) - cacheRead - cacheWrite);
  return (plainInput * p.in + cacheRead * cachedPrice + cacheWrite * p.in * 1.25 + (rec.output || 0) * p.out) / 1e6;
}

// ---------- บันทึกการใช้งาน ----------
/**
 * u: { provider, model, input, output, cacheRead, cacheWrite } โดย input = token ขาเข้าทั้งหมด (รวมส่วนที่อ่านจาก cache)
 * บันทึกแยกตาม วัน | ผู้ให้บริการ | โมเดล | เรื่อง
 */
async function recordUsage(u, signal = null) {
  const info = getTaskInfo(signal);
  const input = Math.max(0, Math.round(u.input || 0));
  const output = Math.max(0, Math.round(u.output || 0));
  if (!input && !output) return;
  if (info.chapter) {
    info.chapter.input += input;
    info.chapter.output += output;
    info.chapter.cacheRead = (info.chapter.cacheRead || 0) + Math.max(0, Math.round(u.cacheRead || 0));
    info.chapter.cacheWrite = (info.chapter.cacheWrite || 0) + Math.max(0, Math.round(u.cacheWrite || 0));
    info.chapter.reasoning = (info.chapter.reasoning || 0) + Math.max(0, Math.round(u.reasoning || 0));
  }
  const bookId = info.bookId || (signal ? '' : (typeof currentBookId === 'string' && currentBookId !== 'default_novel' ? currentBookId : ''));
  const day = localDayKey();
  const id = `${day}|${u.provider}|${u.model}|${bookId}`;
  try {
    await dbUpdateUsage(id, rec => {
      const r = rec || { id, day, month: monthOfDay(day), provider: u.provider, model: u.model, bookId, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      r.calls += 1;
      r.input += input;
      r.output += output;
      r.cacheRead += Math.max(0, Math.round(u.cacheRead || 0));
      r.cacheWrite += Math.max(0, Math.round(u.cacheWrite || 0));
      // ยอดประมาณ (คำขอที่ไม่ได้ยอดกลับมา) รวมอยู่ใน input แล้ว และเก็บแยกไว้แสดงให้รู้ว่าส่วนไหนเป็นค่าประมาณ
      if (u.estimated) {
        r.estimatedInput = (r.estimatedInput || 0) + input;
        r.calls -= 1;
        r.estimatedCalls = (r.estimatedCalls || 0) + 1;
      }
      return r;
    });
  } catch (e) {
    console.warn('Record usage failed:', e);
  }
}

// อัตราตัวอักษรต่อ token ล่าสุดของแต่ละผู้ให้บริการ (จากคำขอที่ได้ยอดกลับมา) ใช้ประมาณคำขอที่ไม่ได้ยอด
const charsPerTokenByProvider = {};

function learnCharsPerToken(provider, chars, inputTokens) {
  if (!chars || !inputTokens) return;
  const ratio = chars / inputTokens;
  const prev = charsPerTokenByProvider[provider];
  charsPerTokenByProvider[provider] = prev ? prev * 0.8 + ratio * 0.2 : ratio;
}

/**
 * คำขอที่ส่งไปแล้วแต่ไม่ได้ยอดกลับมา (ถูกยกเลิกกลางทาง / การเชื่อมต่อหลุด)
 * ผู้ให้บริการอาจยังคิดค่า token ขาเข้า จึงบันทึกเป็น "ค่าประมาณ" ไว้ (output ไม่ประมาณ เพราะส่วนใหญ่ยังไม่ทันสร้าง)
 */
async function recordEstimatedInput(provider, model, chars, signal) {
  const ratio = charsPerTokenByProvider[provider] || 2;
  const estimated = Math.round(chars / ratio);
  if (!estimated) return;
  await recordUsage({ provider, model, input: estimated, output: 0, estimated: true }, signal);
}

/** ค่าเฉลี่ย token ต่อตอนของเรื่อง แยกตามโหมดคุณภาพ (ใช้ประมาณก่อนแปลล่วงหน้า) */
async function recordChapterAverage(signal, mode) {
  const info = getTaskInfo(signal);
  if (!info.bookId || !info.chapter || !(info.chapter.input + info.chapter.output)) return;
  const id = `avg|${info.bookId}|${mode}`;
  const { input, output } = info.chapter;
  try {
    await dbUpdateUsage(id, rec => {
      const r = rec || { id, kind: 'avg', bookId: info.bookId, mode, chapters: 0, input: 0, output: 0 };
      // เก็บแค่ 20 ตอนล่าสุดโดยประมาณ (ค่าเก่าค่อยๆ ลดน้ำหนักลง)
      if (r.chapters >= 20) {
        r.input = r.input * 19 / 20;
        r.output = r.output * 19 / 20;
        r.chapters = 19;
      }
      r.chapters += 1;
      r.input += input;
      r.output += output;
      return r;
    });
  } catch (e) {
    console.warn('Record chapter average failed:', e);
  }
}

async function getChapterAverage(bookId, mode) {
  try {
    const rec = await dbGetUsage(`avg|${bookId}|${mode}`);
    if (!rec || rec.chapters < 2) return null;
    return { input: Math.round(rec.input / rec.chapters), output: Math.round(rec.output / rec.chapters), chapters: rec.chapters };
  } catch (e) {
    return null;
  }
}

function sumUsage(records, prices = getModelPrices()) {
  const total = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpricedTokens: 0 };
  records.forEach(r => {
    total.calls += r.calls || 0;
    total.input += r.input || 0;
    total.output += r.output || 0;
    total.cacheRead += r.cacheRead || 0;
    total.cacheWrite += r.cacheWrite || 0;
    total.estimatedInput = (total.estimatedInput || 0) + (r.estimatedInput || 0);
    const c = estimateCost(r, prices);
    if (c === null) total.unpricedTokens += (r.input || 0) + (r.output || 0);
    else total.cost += c;
  });
  total.tokens = total.input + total.output;
  return total;
}

async function getUsageTotals(now = new Date()) {
  const day = localDayKey(now);
  const records = await dbGetUsageByMonth(monthOfDay(day));
  return { day: sumUsage(records.filter(r => r.day === day)), month: sumUsage(records), records };
}

// ---------- เพดานค่าใช้จ่าย ----------
// nov_budget_unit: 'tokens' | 'usd' | nov_budget_daily / nov_budget_monthly: ตัวเลข (0 หรือว่าง = ไม่จำกัด)
function getBudgetSettings() {
  const num = name => {
    const n = parseFloat(localStorage.getItem(name) || '');
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    unit: localStorage.getItem('nov_budget_unit') === 'usd' ? 'usd' : 'tokens',
    daily: num('nov_budget_daily'),
    monthly: num('nov_budget_monthly')
  };
}

function formatBudgetAmount(n, unit) {
  return unit === 'usd' ? `$${n.toFixed(n < 1 ? 3 : 2)}` : `${formatTokenCount(Math.round(n))} token`;
}

/** สถานะเพดานจากยอดใช้จริง: level 'ok' | 'warn' (>= 80%) | 'over' */
function evaluateBudget(totals, budget = getBudgetSettings()) {
  const used = t => budget.unit === 'usd' ? t.cost : t.tokens;
  const checks = [];
  if (budget.daily) checks.push({ period: 'วันนี้', used: used(totals.day), limit: budget.daily });
  if (budget.monthly) checks.push({ period: 'เดือนนี้', used: used(totals.month), limit: budget.monthly });
  let level = 'ok';
  let worst = null;
  checks.forEach(c => {
    c.ratio = c.used / c.limit;
    if (!worst || c.ratio > worst.ratio) worst = c;
  });
  if (worst) level = worst.ratio >= 1 ? 'over' : (worst.ratio >= 0.8 ? 'warn' : 'ok');
  const unpricedWarning = budget.unit === 'usd' && totals.month.unpricedTokens > 0;
  return { level, worst, unit: budget.unit, unpricedWarning };
}

// งานที่ผู้ใช้กดยืนยันให้ใช้เกินเพดานแล้ว (ถามครั้งเดียวต่องาน)
const budgetApprovedSignals = new WeakSet();
let budgetApprovedUntil = 0;
let budgetWarnedDay = '';

/**
 * เรียกก่อนเรียก AI ทุกครั้ง: เกินเพดานแล้ว งานเบื้องหลังหยุดทันที ส่วนงานที่ผู้ใช้กดเองต้องยืนยันก่อน
 * hook จาก app.js: askBudgetOverride(message) -> boolean, notifyBudgetWarning(message)
 */
async function checkBudgetBeforeCall(signal) {
  const budget = getBudgetSettings();
  if (!budget.daily && !budget.monthly) return;
  let state;
  try {
    state = evaluateBudget(await getUsageTotals(), budget);
  } catch (e) {
    return;
  }
  const w = state.worst;
  if (state.level === 'warn' && budgetWarnedDay !== localDayKey()) {
    budgetWarnedDay = localDayKey();
    if (typeof notifyBudgetWarning === 'function') {
      notifyBudgetWarning(`ใช้ AI ไปแล้ว ${Math.round(w.ratio * 100)}% ของเพดาน${w.period} (${formatBudgetAmount(w.used, state.unit)} จาก ${formatBudgetAmount(w.limit, state.unit)})`);
    }
  }
  if (state.level !== 'over') return;

  const info = getTaskInfo(signal);
  const message = `ใช้ AI ครบเพดาน${w.period}แล้ว (${formatBudgetAmount(w.used, state.unit)} จาก ${formatBudgetAmount(w.limit, state.unit)})`;
  if (BACKGROUND_TASKS.has(info.task) && !info.manual) {
    throw new LLMError(`${message} หยุดงานเบื้องหลังไว้ก่อน เพิ่มเพดานได้ที่ ตั้งค่า → 📊 การใช้งาน AI`, 'budget');
  }
  if ((signal && budgetApprovedSignals.has(signal)) || Date.now() < budgetApprovedUntil) return;
  const ask = typeof askBudgetOverride === 'function' ? askBudgetOverride : (m) => confirm(m);
  if (!ask(`${message}\n\nต้องการใช้ต่อสำหรับงานนี้หรือไม่?`)) {
    throw new LLMError(`${message} ยกเลิกตามที่เลือก`, 'budget');
  }
  if (signal) budgetApprovedSignals.add(signal);
  else budgetApprovedUntil = Date.now() + 10 * 60 * 1000;
}

/** เพดานจำนวนครั้งที่เรียก AI ต่อตอน กันกรณีผิดปกติที่วนเรียกซ้ำจนเสียเงิน */
function countChapterCall(signal) {
  const info = getTaskInfo(signal);
  if (!info.chapter) return;
  info.chapter.calls += 1;
  if (info.chapter.calls > info.chapter.callLimit) {
    throw new LLMError(`ตอนนี้เรียก AI ไปแล้ว ${info.chapter.callLimit} ครั้ง ซึ่งมากผิดปกติ จึงหยุดไว้ก่อนเพื่อไม่ให้เสียโควตา (ลองแปลใหม่ หรือลดโหมดคุณภาพ)`, 'budget');
  }
}

// ---------- ตรวจ token ส่วนเกินที่ Gemini คิดแต่ไม่ได้รายงาน (ใช้ countTokens ซึ่งไม่เสียเงิน) ----------
// เทียบคำขอเดียวกันแบบมี/ไม่มี JSON schema และ system prompt เพื่อดูว่าส่วนไหนถูกนับเพิ่ม
async function geminiCountTokens(model, key, request) {
  const res = await guardedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:countTokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ generateContentRequest: { model: `models/${model}`, ...request } })
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw errorFromStatus(res.status, data.error?.message || data._raw?.slice(0, 200));
  return data.totalTokens || 0;
}

async function measureGeminiOverhead() {
  const cfg = getActiveLlmConfig('main', 'gemini');
  if (!cfg.keys.length || !cfg.model) throw new Error('ต้องใส่ API Key และเลือกโมเดลของ Gemini ก่อน');
  const key = cfg.keys[0];
  const ctx = { bookId: 'test', title: 'ทดสอบ', genre: 'xianxia', sourceLang: 'zh' };
  const contents = [{ role: 'user', parts: [{ text: 'ย่อหน้าต้นฉบับที่ต้องแปล: [{"i":0,"src":"林动缓缓睁开双眼。"}]' }] }];
  const system = { parts: [{ text: buildTranslationSystemPrompt(ctx) }] };
  const json = (schema) => ({ response_mime_type: 'application/json', ...(schema ? { responseSchema: toGeminiSchema(schema) } : {}) });

  const base = await geminiCountTokens(cfg.model, key, { contents });
  const withSystem = await geminiCountTokens(cfg.model, key, { contents, systemInstruction: system });
  const jsonOnly = await geminiCountTokens(cfg.model, key, { contents, generationConfig: json(null) });
  const schemas = {};
  for (const name of ['translation', 'preScan', 'verify', 'polish', 'fidelity']) {
    schemas[name] = (await geminiCountTokens(cfg.model, key, { contents, generationConfig: json(SCHEMAS[name]) })) - base;
  }
  return { model: cfg.model, base, systemTokens: withSystem - base, jsonModeTokens: jsonOnly - base, schemas };
}

// ---------- บันทึกรายคำขอ (ใช้เทียบกับหน้าเว็บผู้ให้บริการ) ----------
// เก็บยอดดิบที่ผู้ให้บริการตอบกลับมาของ 300 คำขอล่าสุด + คำขอที่ไม่ได้ยอดกลับมา (เช่นถูกยกเลิกกลางทาง)
const REQUEST_LOG_META_KEY = 'requestLog';
const REQUEST_LOG_MAX = 300;
let requestLogChain = Promise.resolve();

function logRequest(entry) {
  const clean = { at: new Date().toISOString(), ...entry };
  if (clean.error) clean.error = redactSecrets(clean.error).slice(0, 200);
  requestLogChain = requestLogChain.then(async () => {
    if (typeof db === 'undefined' || !db) return;
    const list = (await dbGetMeta(REQUEST_LOG_META_KEY)) || [];
    list.push(clean);
    await dbSetMeta(REQUEST_LOG_META_KEY, list.slice(-REQUEST_LOG_MAX));
  }).catch(() => {});
  return requestLogChain;
}

async function getRequestLog() {
  try {
    return (await dbGetMeta(REQUEST_LOG_META_KEY)) || [];
  } catch (e) {
    return [];
  }
}

// ---------- บันทึกข้อผิดพลาด ----------
const DIAG_META_KEY = 'diagLog';
const DIAG_MAX_ENTRIES = 200;
const SECRET_LIKE_PATTERN = /(AIza[0-9A-Za-z_-]{10,}|sk-ant-[0-9A-Za-z_-]{6,}|sk-[0-9A-Za-z_-]{10,}|jina_[0-9A-Za-z]{6,}|Bearer\s+[0-9A-Za-z._-]{10,}|key=[0-9A-Za-z_-]{10,})/g;

/** ตัดสิ่งที่หน้าตาเหมือน API Key ออก และตัด key ที่ผู้ใช้ตั้งไว้จริงออกด้วย */
function redactSecrets(text) {
  let out = String(text ?? '').replace(SECRET_LIKE_PATTERN, '[KEY]');
  try {
    const known = [];
    Object.keys(LLM_PROVIDERS).forEach(p => known.push(...getProviderKeys(p)));
    const jina = getSecret('nov_jina_key');
    if (jina) known.push(jina);
    known.filter(k => k && k.length >= 6).forEach(k => { out = out.split(k).join('[KEY]'); });
  } catch (e) {}
  return out;
}

let diagWriteChain = Promise.resolve();

function logDiagnostic(entry) {
  const clean = {
    at: new Date().toISOString(),
    source: entry.source || 'app',
    kind: entry.kind || '',
    status: entry.status || 0,
    provider: entry.provider || '',
    model: entry.model || '',
    task: entry.task || '',
    message: redactSecrets(entry.message || '').slice(0, 400)
  };
  diagWriteChain = diagWriteChain.then(async () => {
    if (typeof db === 'undefined' || !db) return;
    const list = (await dbGetMeta(DIAG_META_KEY)) || [];
    list.push(clean);
    await dbSetMeta(DIAG_META_KEY, list.slice(-DIAG_MAX_ENTRIES));
  }).catch(() => {});
  return diagWriteChain;
}

async function getDiagnosticLog() {
  try {
    return (await dbGetMeta(DIAG_META_KEY)) || [];
  } catch (e) {
    return [];
  }
}

async function clearDiagnosticLog() {
  await dbSetMeta(DIAG_META_KEY, undefined);
}

async function buildDiagnosticReport() {
  const settings = {};
  Object.keys(LLM_PROVIDERS).forEach(p => {
    settings[p] = { model: getProviderModel(p), auxModel: getProviderAuxModel(p), keyCount: getProviderKeys(p).length };
  });
  settings.openaiBaseUrl = getProviderBaseUrl('openai');
  settings.activeProvider = getActiveProvider();
  settings.fallbackProvider = getFallbackProvider();
  settings.qualityMode = typeof getQualityMode === 'function' ? getQualityMode() : '';
  return {
    app: document.title,
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    settings,
    log: await getDiagnosticLog(),
    requests: await getRequestLog(),
    geminiOverheadTest: (() => { try { return JSON.parse(localStorage.getItem('nov_gemini_overhead_test') || 'null'); } catch (e) { return null; } })()
  };
}

// ข้อผิดพลาดที่ไม่ได้ถูกจัดการในหน้าเว็บ
window.addEventListener('error', e => {
  logDiagnostic({ source: 'app', kind: 'error', message: `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}` });
});
window.addEventListener('unhandledrejection', e => {
  const r = e.reason;
  if (r?.kind === 'abort' || r?.name === 'AbortError') return;
  logDiagnostic({ source: 'app', kind: 'unhandled', message: r?.message || String(r) });
});
