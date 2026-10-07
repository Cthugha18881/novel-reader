// ==================== หน้าการใช้งาน AI และเพดาน token (แยกจาก app.js; ตัวนับอยู่ใน usage.js) ====================
// โหลดหลัง app.js (ดู index.html) ทุกอย่างในไฟล์นี้ถูกเรียกหลังหน้าโหลดเสร็จ จึงใช้ตัวแปรของ app.js ได้ตามปกติ

// ==================== AI USAGE DASHBOARD ====================
let budgetBannerText = '';
let profileWarningHost = '';

/** hook จาก api.js: โปรไฟล์ของเว็บนี้หาเนื้อหาไม่เจอติดกันถึงเกณฑ์ */
function notifyProfileFailing(host) {
  profileWarningHost = host;
  logDiagnostic({ source: 'scrape', kind: 'profile', message: `${host}: โปรไฟล์หาเนื้อหาไม่เจอติดกัน ${PROFILE_FAIL_WARN_AT} ครั้ง` });
  renderSafetyBanner();
}

/** hook จาก usage.js: เกินเพดานแล้วแต่ผู้ใช้กดแปลเอง */
function askBudgetOverride(message) {
  return appConfirm(message, { title: 'เกินเพดานการใช้งาน', confirmLabel: 'แปลต่อครั้งนี้', cancelLabel: 'ไม่แปล' });
}

/** hook จาก usage.js: ใช้ไปแล้ว 80% ของเพดาน */
function notifyBudgetWarning(message) {
  budgetBannerText = message;
  renderSafetyBanner();
}

function dismissBudgetBanner() {
  budgetBannerText = '';
  renderSafetyBanner();
}

function usageCardHtml(label, t) {
  const cachePct = t.input ? Math.round(t.cacheRead / t.input * 100) : 0;
  return `<div class="usage-card">
    <div class="usage-card-label">${label}</div>
    <div class="usage-card-main">~${formatTokenCount(t.tokens)} <span>token (ประมาณ)</span></div>
    <div class="usage-card-sub">ส่ง ${formatTokenCount(t.input)} · รับ ${formatTokenCount(t.output)} · ${t.calls.toLocaleString()} ครั้ง</div>
    ${t.estimatedInput ? `<div class="usage-card-sub" title="คำขอที่ส่งไปแล้วแต่ถูกยกเลิก/การเชื่อมต่อหลุด ผู้ให้บริการอาจคิดค่าขาเข้า">ยอดส่งรวมค่าประมาณ ${formatTokenCount(t.estimatedInput)} จากคำขอที่ไม่ได้ยอดกลับมา</div>` : ''}
    <div class="usage-card-sub">อ่านจาก cache ${cachePct}%</div>
  </div>`;
}

function groupUsage(records, keyFn) {
  const groups = new Map();
  records.forEach(r => {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  return [...groups.entries()].map(([key, list]) => ({ key, total: sumUsage(list) })).sort((a, b) => b.total.tokens - a.total.tokens);
}

async function openUsageModal() {
  openModal('usage-modal');
  await renderUsageDashboard();
}

async function renderUsageDashboard() {
  const totals = await getUsageTotals();
  const budget = getBudgetSettings();
  const state = evaluateBudget(totals, budget);

  document.getElementById('usage-summary').innerHTML =
    usageCardHtml('วันนี้', totals.day) + usageCardHtml('เดือนนี้', totals.month);

  const statusEl = document.getElementById('usage-budget-status');
  if (!budget.daily && !budget.monthly) {
    statusEl.innerHTML = '<span style="opacity: 0.7;">ยังไม่ได้ตั้งเพดาน</span>';
  } else {
    const w = state.worst;
    const color = state.level === 'over' ? '#dc2626' : (state.level === 'warn' ? '#b45309' : '#16a34a');
    statusEl.innerHTML = `<span style="color: ${color}; font-weight: 600;">${state.level === 'over' ? '⛔ เกินเพดานแล้ว' : (state.level === 'warn' ? '⚠️ ใกล้ถึงเพดาน' : '✓ ยังไม่ถึงเพดาน')}</span>
      — ${escapeHtml(w.period)}ใช้ไป ${escapeHtml(formatBudgetAmount(w.used, state.unit))} จาก ${escapeHtml(formatBudgetAmount(w.limit, state.unit))} (${Math.round(w.ratio * 100)}%)
      ${state.unit === 'usd' ? '<div style="color: var(--warning);">เพดานนี้ตั้งไว้ด้วยหน่วยเดิม (เงิน) ยังใช้งานอยู่ กดบันทึกเพดานใหม่ด้านล่างเพื่อเปลี่ยนเป็นจำนวน token</div>' : ''}`;
  }
  // เพดานแบบเดิม (เงิน) ไม่เติมลงช่อง เพราะช่องเป็นหน่วย token แล้ว
  document.getElementById('budget-daily').value = budget.unit === 'tokens' ? (budget.daily || '') : '';
  document.getElementById('budget-monthly').value = budget.unit === 'tokens' ? (budget.monthly || '') : '';

  const tableRows = (groups, labelFn) => groups.length
    ? groups.map(g => `<tr><td>${labelFn(g.key)}</td><td>${formatTokenCount(g.total.input)}</td><td>${formatTokenCount(g.total.output)}</td><td>${g.total.input ? Math.round(g.total.cacheRead / g.total.input * 100) : 0}%</td></tr>`).join('')
    : '<tr><td colspan="4" style="opacity: 0.6; text-align: center;">ยังไม่มีการใช้งานในเดือนนี้</td></tr>';
  const head = '<thead><tr><th></th><th>ส่ง</th><th>รับ</th><th>cache</th></tr></thead>';

  const byModel = groupUsage(totals.records, r => `${r.provider}|${r.model}`);
  document.getElementById('usage-by-model').innerHTML = `<table class="backup-compare-table">${head}<tbody>${tableRows(byModel, k => {
    const [provider, model] = k.split('|');
    return `${escapeHtml(model)} <span style="opacity: 0.55;">(${escapeHtml(LLM_PROVIDERS[provider]?.label || provider)})</span>`;
  })}</tbody></table>`;

  const books = await dbGetAllBooks();
  const titleOf = id => id ? (books.find(b => b.bookId === id)?.title || 'เรื่องที่ลบไปแล้ว') : 'งานทั่วไป (ไม่ผูกกับเรื่อง)';
  const byBook = groupUsage(totals.records, r => r.bookId || '').slice(0, 10);
  document.getElementById('usage-by-book').innerHTML = `<table class="backup-compare-table">${head}<tbody>${tableRows(byBook, k => escapeHtml(titleOf(k)))}</tbody></table>`;

  // 14 วันล่าสุด
  const all = await dbGetAllUsage();
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(localDayKey(new Date(Date.now() - i * DAY_MS)));
  const perDay = days.map(d => sumUsage(all.filter(r => r.day === d)).tokens);
  const max = Math.max(1, ...perDay);
  document.getElementById('usage-days').innerHTML = days.map((d, i) => `
    <div class="usage-day" title="${d}: ${formatTokenCount(perDay[i])} token">
      <div class="usage-day-bar" style="height: ${Math.round(perDay[i] / max * 100)}%;"></div>
      <div class="usage-day-label">${Number(d.slice(8))}</div>
    </div>`).join('');

  // คำขอที่ผู้ให้บริการอาจคิดเงินแต่แอพไม่ได้ยอดกลับมา (ถูกยกเลิกกลางทาง / เชื่อมต่อหลุด)
  const reqs = await getRequestLog();
  const noUsage = reqs.filter(r => !r.usage);
  const aborted = noUsage.filter(r => r.kind === 'abort').length;
  const netFail = noUsage.filter(r => ['network', 'server', 'truncated', 'empty'].includes(r.kind)).length;
  document.getElementById('request-log-summary').innerText = reqs.length
    ? `คำขอล่าสุด ${reqs.length} ครั้ง: ได้ยอด token กลับมา ${reqs.length - noUsage.length} ครั้ง · ไม่ได้ยอดกลับมา ${noUsage.length} ครั้ง (ถูกยกเลิกกลางทาง ${aborted}, เชื่อมต่อหลุด/เซิร์ฟเวอร์ผิดพลาด ${netFail}) — คำขอที่ไม่ได้ยอดกลับมา ผู้ให้บริการอาจยังคิดค่า token ขาเข้าอยู่`
    : 'ยังไม่มีบันทึกคำขอ';

  try { renderGeminiOverheadResult(JSON.parse(localStorage.getItem('nov_gemini_overhead_test') || 'null')); } catch (e) {}

  const log = await getDiagnosticLog();
  document.getElementById('diag-log-count').innerText = log.length;
  document.getElementById('diag-log-recent').innerHTML = log.slice(-8).reverse().map(e =>
    `<div class="diag-entry"><b>${escapeHtml(new Date(e.at).toLocaleString('th-TH'))}</b> · ${escapeHtml(e.source)}/${escapeHtml(e.kind)}${e.model ? ` · ${escapeHtml(e.model)}` : ''}${e.task ? ` · ${escapeHtml(e.task)}` : ''}<div>${escapeHtml(e.message)}</div></div>`
  ).join('') || '<div style="opacity: 0.6;">ยังไม่มีข้อผิดพลาด</div>';
}

async function saveBudgetSettings() {
  const read = id => {
    const n = parseFloat(document.getElementById(id).value);
    return Number.isFinite(n) && n > 0 ? String(n) : '';
  };
  localStorage.setItem('nov_budget_unit', 'tokens');
  localStorage.setItem('nov_budget_daily', read('budget-daily'));
  localStorage.setItem('nov_budget_monthly', read('budget-monthly'));
  budgetBannerText = '';
  renderSafetyBanner();
  await renderUsageDashboard();
  showGlobalToast('✓ บันทึกเพดานแล้ว');
  setTimeout(hideGlobalToast, 1500);
}

function renderGeminiOverheadResult(r) {
  const el = document.getElementById('gemini-overhead-result');
  if (!el || !r) return;
  if (r.error) {
    el.innerHTML = `<span style="color: var(--danger);">ตรวจไม่สำเร็จ: ${escapeHtml(r.error)}</span>`;
    return;
  }
  const rows = Object.entries(r.schemas).map(([name, n]) => `${escapeHtml(name)} +${n.toLocaleString()}`).join(' · ');
  el.innerHTML = `ผลตรวจ (${escapeHtml(r.model)}, ${escapeHtml(new Date(r.at).toLocaleString('th-TH'))}):<br>
    ข้อความทดสอบ ${r.base.toLocaleString()} token · system prompt +${r.systemTokens.toLocaleString()} · โหมด JSON +${r.jsonModeTokens.toLocaleString()}<br>
    JSON schema แต่ละแบบเพิ่ม: ${rows}`;
}

async function runGeminiOverheadTest() {
  const el = document.getElementById('gemini-overhead-result');
  el.innerHTML = '<span class="spinner-icon"></span> กำลังตรวจ...';
  let result;
  try {
    result = { ...(await measureGeminiOverhead()), at: new Date().toISOString() };
  } catch (err) {
    result = { error: err.message, at: new Date().toISOString() };
  }
  localStorage.setItem('nov_gemini_overhead_test', JSON.stringify(result));
  renderGeminiOverheadResult(result);
}

async function exportDiagnosticLog() {
  const report = await buildDiagnosticReport();
  downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `dusktale-diagnostics-${backupFileStamp()}.json`);
}

async function clearDiagnosticLogFromUi() {
  if (!(await appConfirm('บันทึกข้อผิดพลาดทั้งหมดจะถูกลบ', { title: 'ล้างบันทึกข้อผิดพลาด', confirmLabel: 'ล้างบันทึก', danger: true }))) return;
  await clearDiagnosticLog();
  await renderUsageDashboard();
}

async function clearUsageHistory() {
  if (!(await appConfirm('สถิติการใช้งาน AI ทั้งหมดจะถูกลบ รวมค่าเฉลี่ยต่อตอนที่ใช้ประมาณก่อนแปลล่วงหน้า เพดานที่ตั้งไว้จะเริ่มนับใหม่จากศูนย์', { title: 'ล้างสถิติการใช้งาน', confirmLabel: 'ล้างสถิติ', danger: true }))) return;
  await dbClearUsage();
  await renderUsageDashboard();
}

