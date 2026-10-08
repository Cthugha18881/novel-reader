// ==================== ระดับสมาชิกและสิทธิ์การใช้งาน ====================
// ผู้เยี่ยมชม (ไม่เข้าสู่ระบบ) / สมาชิกฟรี / Plus / Pro / Max: จำกัดจำนวนต่อวันและเปิด-ปิดบางฟีเจอร์
// ค่าในไฟล์นี้เป็นค่าตั้งต้น สมาชิกที่เข้าสู่ระบบใช้ค่าจากเซิร์ฟเวอร์ (ตาราง dt_plans.features) ถ้ามี
// ไม่ล็อกข้อมูลที่มีอยู่แล้วเสมอ: อ่าน แก้คำแปล คลังศัพท์ สำรอง/กู้คืน ส่งออก TXT ใช้ได้ทุกระดับ
// ถ้าไม่ได้ตั้งบริการ Dusktale (hosted-config.js ว่าง) จะไม่จำกัดอะไรเลย เพราะไม่มีทางเข้าสู่ระบบ

// null = ไม่จำกัด
const PLAN_DEFAULTS = {
  guest: { name: 'ผู้เยี่ยมชม', byokChaptersPerDay: 10, maxBooks: 3, batchMax: 5, assistantPerDay: 10, autoBible: false, epub: false, bgm: false, bestMode: false, cloudSync: false, cloudStorageMB: 0, followBooks: 0 },
  free: { name: 'สมาชิกฟรี', byokChaptersPerDay: 20, maxBooks: 10, batchMax: 10, assistantPerDay: 30, autoBible: true, epub: true, bgm: true, bestMode: false, cloudSync: false, cloudStorageMB: 0, followBooks: 0 },
  plus: { name: 'Plus', byokChaptersPerDay: 40, maxBooks: null, batchMax: 30, assistantPerDay: null, autoBible: true, epub: true, bgm: true, bestMode: true, cloudSync: true, cloudStorageMB: 100, followBooks: 0 },
  pro: { name: 'Pro', byokChaptersPerDay: null, maxBooks: null, batchMax: 100, assistantPerDay: null, autoBible: true, epub: true, bgm: true, bestMode: true, cloudSync: true, cloudStorageMB: 300, followBooks: 10 },
  max: { name: 'Max', byokChaptersPerDay: null, maxBooks: null, batchMax: 100, assistantPerDay: null, autoBible: true, epub: true, bgm: true, bestMode: true, cloudSync: true, cloudStorageMB: 600, followBooks: null },
  // ไม่ได้ตั้งบริการ Dusktale: ไม่มีเซิร์ฟเวอร์ให้ซิงก์
  unlimited: { name: 'ไม่จำกัด', byokChaptersPerDay: null, maxBooks: null, batchMax: 100, assistantPerDay: null, autoBible: true, epub: true, bgm: true, bestMode: true, cloudSync: false, cloudStorageMB: 0, followBooks: null }
};
const PLAN_ORDER = ['guest', 'free', 'plus', 'pro', 'max'];
const PAID_PLAN_IDS = ['plus', 'pro', 'max'];
// โควตา AI ของ Dusktale ต่อเดือน (ใช้แสดงผล ค่าจริงอยู่ที่ dt_plans.monthly_tokens)
const PLAN_HOSTED_TOKENS = { guest: 0, free: 400000, plus: 1600000, pro: 6000000, max: 12000000 };
// ราคาต่อ 30 วัน (บาท) ถ้าโหลดราคาจากเซิร์ฟเวอร์ไม่ได้ (ราคาจริงอยู่ที่ Stripe)
const PLAN_PRICE_FALLBACK = { plus: 59, pro: 179, max: 299 };
// ราคาปกติหลังช่วงเปิดตัว (แสดงขีดทับคู่กับราคาจริง) ตั้งใหม่ได้ที่ hosted-config.js → listPrices
// ไม่แสดงถ้าราคาปกติไม่สูงกว่าราคาที่ขายจริง (เช่นขึ้นราคาแล้ว)
const PLAN_LIST_PRICE_FALLBACK = { plus: 99, pro: 239, max: 399 };
const PLAN_CACHE_KEY = 'nov_plan_cache';
// สิทธิ์ที่จำไว้ใช้ได้นานแค่ไหนตอนออฟไลน์ (เกินนี้ถือเป็นสมาชิกฟรีจนกว่าจะต่อเซิร์ฟเวอร์ได้)
const PLAN_CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;
const PLAN_CACHE_REFRESH_AGE = 6 * 3600 * 1000;

const PLAN_FEATURE_LABELS = {
  autoBible: 'คู่มือเรื่องและบันทึกเหตุการณ์อัตโนมัติ',
  epub: 'ส่งออกไฟล์ EPUB',
  bgm: 'เพลงประกอบการอ่าน',
  bestMode: 'โหมดแปล "ดีที่สุด" (เกลาสำนวน + ตรวจความหมาย)',
  cloudSync: 'ซิงก์หลายเครื่อง + สำรองบนคลาวด์'
};

/** รวมค่าตั้งต้นของระดับกับค่าจากเซิร์ฟเวอร์ (รับเฉพาะคีย์ที่รู้จักและชนิดถูกต้อง) */
function resolveEntitlements(tier, serverFeatures) {
  const base = { ...(PLAN_DEFAULTS[tier] || PLAN_DEFAULTS.free) };
  if (serverFeatures && typeof serverFeatures === 'object') {
    for (const key of Object.keys(base)) {
      if (key === 'name' || !(key in serverFeatures)) continue;
      const v = serverFeatures[key];
      if (typeof base[key] === 'boolean' && typeof v === 'boolean') base[key] = v;
      else if (typeof base[key] !== 'boolean' && (v === null || (Number.isInteger(v) && v >= 0))) base[key] = v;
    }
  }
  return base;
}

function readPlanCache() {
  try {
    const c = JSON.parse(localStorage.getItem(PLAN_CACHE_KEY) || 'null');
    return c && typeof c === 'object' && typeof c.plan === 'string' ? c : null;
  } catch (e) { return null; }
}

/** เรียกจาก fetchHostedMe เมื่อได้ข้อมูลจากเซิร์ฟเวอร์ */
function savePlanCache(me) {
  if (!me || typeof me.plan !== 'string') return;
  // ซื้อ 30 วัน/สมัครรายเดือน: จำวันหมดสิทธิ์ไว้ด้วย ออฟไลน์เกินวันนั้นกลับเป็นสมาชิกฟรี
  const b = me.billing || {};
  const until = b.source === 'pass' ? Date.parse(b.passExpiresAt || '')
    : b.source === 'subscription' ? Date.parse(b.renewsAt || '') + 3 * 86400000 : NaN;
  try {
    localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ plan: me.plan, planName: me.planName || '', features: me.features || null, at: Date.now(), until: Number.isFinite(until) ? until : null }));
  } catch (e) {}
  if (typeof renderPlanBox === 'function') renderPlanBox();
}

function getPlanTier() {
  if (typeof isHostedConfigured !== 'function' || !isHostedConfigured()) return 'unlimited';
  if (typeof isHostedSignedIn !== 'function' || !isHostedSignedIn()) return 'guest';
  const cache = readPlanCache();
  if (cache && Date.now() - (cache.at || 0) < PLAN_CACHE_MAX_AGE && PLAN_DEFAULTS[cache.plan] && cache.plan !== 'guest' && cache.plan !== 'unlimited' &&
      !(cache.until && Date.now() > cache.until)) return cache.plan;
  return 'free';
}

function getEntitlements() {
  const tier = getPlanTier();
  const cache = tier !== 'guest' && tier !== 'unlimited' ? readPlanCache() : null;
  const ent = resolveEntitlements(tier, cache?.plan === tier ? cache.features : null);
  if (cache?.plan === tier && cache.planName) ent.name = cache.planName;
  return { tier, ...ent };
}

function planAllows(feature) {
  return getEntitlements()[feature] === true;
}

// ---------- ตัวนับรายวัน (เก็บในฐานข้อมูลเดียวกับชั้นหนังสือ) ----------
function planDayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `plan_day_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function getPlanCounters() {
  try {
    const v = await dbGetMeta(planDayKey());
    return { byok: Number(v?.byok) || 0, assistant: Number(v?.assistant) || 0 };
  } catch (e) {
    return { byok: 0, assistant: 0 };
  }
}

let planCounterChain = Promise.resolve();
/** เพิ่มตัวนับทีละคำขอ (ต่อคิวกันสองงานพร้อมกันเขียนทับกัน) */
function bumpPlanCounter(kind) {
  planCounterChain = planCounterChain.then(async () => {
    const key = planDayKey();
    const cur = await getPlanCounters();
    cur[kind] = (cur[kind] || 0) + 1;
    await dbSetMeta(key, cur);
    // ลบตัวนับของวันก่อนๆ (เก็บไว้ไม่มีประโยชน์)
    const yesterday = planDayKey(new Date(Date.now() - 86400000));
    dbSetMeta(yesterday, undefined).catch(() => {});
  }).catch(err => console.warn('plan counter failed:', err));
  return planCounterChain;
}

class PlanLimitError extends Error {
  constructor(message, limitKind) {
    super(message);
    this.name = 'PlanLimitError';
    this.limitKind = limitKind;
  }
}

function isByokProvider() {
  return typeof getActiveProvider !== 'function' || getActiveProvider() !== 'dusktale';
}

/** ข้อความเมื่อถึงขีดจำกัด + สิ่งที่ได้ถ้าเข้าสู่ระบบ/อัปเกรด */
function describePlanLimit(kind, ent = getEntitlements()) {
  // ระดับถัดไปที่ได้มากกว่า (Plus ที่ชนเพดานแปลล่วงหน้า → Pro)
  const idx = PLAN_ORDER.indexOf(ent.tier);
  const nextTier = PLAN_ORDER[Math.min(PLAN_ORDER.length - 1, (idx < 0 ? 0 : idx) + 1)];
  const next = PLAN_DEFAULTS[nextTier];
  const fmt = (n, unit) => n === null ? 'ไม่จำกัด' : `${n} ${unit}`;
  const upsell = ent.tier === 'guest'
    ? `เข้าสู่ระบบฟรีด้วยอีเมลเพื่อเพิ่มเป็น`
    : `แพ็กเกจ ${next.name} เพิ่มเป็น`;
  switch (kind) {
    case 'byok': return `วันนี้แปลด้วย API Key ของคุณครบ ${ent.byokChaptersPerDay} ตอนแล้ว (${ent.name}) ${upsell} ${fmt(next.byokChaptersPerDay, 'ตอนต่อวัน')}${ent.tier !== 'guest' ? ' หรือแปลต่อด้วยโควตา AI ของ Dusktale' : ''} · เริ่มนับใหม่พรุ่งนี้`;
    case 'assistant': return `วันนี้ถามผู้ช่วย AI ครบ ${ent.assistantPerDay} คำถามแล้ว (${ent.name}) ${upsell} ${fmt(next.assistantPerDay, 'คำถามต่อวัน')} · เริ่มนับใหม่พรุ่งนี้`;
    case 'books': return `ชั้นหนังสือมีครบ ${ent.maxBooks} เรื่องแล้ว (${ent.name}) เรื่องเดิมยังอ่านและแปลต่อได้ตามปกติ ${upsell} ${fmt(next.maxBooks, 'เรื่อง')} หรือลบเรื่องที่อ่านจบแล้ว (สำรองไฟล์ไว้ก่อนได้)`;
    case 'batch': return `${ent.name} แปลล่วงหน้าได้ครั้งละไม่เกิน ${ent.batchMax} ตอน ${upsell} ${fmt(next.batchMax, 'ตอนต่อครั้ง')}`;
    case 'follow': return ent.followBooks
      ? `${ent.name} ติดตามตอนใหม่อัตโนมัติได้ ${ent.followBooks} เรื่อง เลิกติดตามเรื่องอื่นก่อน หรือแพ็กเกจ Max ติดตามได้ไม่จำกัด`
      : 'ติดตามตอนใหม่อัตโนมัติใช้ได้ตั้งแต่แพ็กเกจ Pro ขึ้นไป (กด "เช็กตอนใหม่" เองได้ทุกระดับ)';
    default: return `${PLAN_FEATURE_LABELS[kind] || 'ฟีเจอร์นี้'} ใช้ได้ตั้งแต่${PLAN_DEFAULTS.free[kind] ? 'สมาชิกฟรี (เข้าสู่ระบบด้วยอีเมล)' : 'แพ็กเกจ Plus'}ขึ้นไป`;
  }
}

/** กล่องแจ้งเมื่อถึงขีดจำกัด: ผู้เยี่ยมชมมีปุ่มเข้าสู่ระบบ สมาชิกมีปุ่มดูแพ็กเกจ */
let planPromptShownAt = {};
async function showPlanLimit(kind, { once = false } = {}) {
  // งานเบื้องหลัง (แปลล่วงหน้า/โหลดอัตโนมัติ) แจ้งครั้งเดียวต่อชั่วโมง ไม่เด้งซ้ำ
  if (once && Date.now() - (planPromptShownAt[kind] || 0) < 3600000) return;
  planPromptShownAt[kind] = Date.now();
  const ent = getEntitlements();
  const msg = describePlanLimit(kind, ent);
  const choices = ent.tier === 'guest'
    ? [{ label: 'เข้าสู่ระบบฟรี', value: 'login', variant: 'primary' }, { label: 'ดูแพ็กเกจ', value: 'plans' }]
    : [{ label: 'ดูแพ็กเกจ', value: 'plans', variant: 'primary' }];
  const pick = await appChoose(msg, choices, { title: 'ถึงขีดจำกัดของแพ็กเกจ', cancelLabel: 'ปิด' });
  if (pick === 'login' && typeof openHostedSignIn === 'function') openHostedSignIn();
  if (pick === 'plans') openPlansModal();
}

// ---------- จุดตรวจที่โค้ดส่วนอื่นเรียก ----------
/** ก่อนแปล 1 ตอนด้วยคีย์ของผู้ใช้ (โยน PlanLimitError ถ้าครบโควตาวันนี้) */
async function assertCanTranslateChapter({ background = false } = {}) {
  if (!isByokProvider()) return;
  const ent = getEntitlements();
  if (ent.byokChaptersPerDay === null) return;
  const { byok } = await getPlanCounters();
  if (byok >= ent.byokChaptersPerDay) {
    showPlanLimit('byok', { once: background });
    throw new PlanLimitError(describePlanLimit('byok', ent), 'byok');
  }
}

function recordChapterTranslated() {
  if (!isByokProvider() || getEntitlements().byokChaptersPerDay === null) return Promise.resolve();
  return bumpPlanCounter('byok');
}

async function canAskAssistant() {
  const ent = getEntitlements();
  if (ent.assistantPerDay === null) return true;
  const { assistant } = await getPlanCounters();
  if (assistant < ent.assistantPerDay) return true;
  showPlanLimit('assistant');
  return false;
}

function recordAssistantQuestion() {
  if (getEntitlements().assistantPerDay === null) return Promise.resolve();
  return bumpPlanCounter('assistant');
}

/** ก่อนสร้างเรื่องใหม่บนชั้นหนังสือ (เรื่องเดิมเพิ่มตอนได้เสมอ) */
async function canAddBook() {
  const ent = getEntitlements();
  if (ent.maxBooks === null) return true;
  const count = (await dbGetAllBooks()).length;
  if (count < ent.maxBooks) return true;
  showPlanLimit('books');
  return false;
}

function requireFeature(feature) {
  if (planAllows(feature)) return true;
  showPlanLimit(feature);
  return false;
}

// ---------- หน้าตั้งค่า: กล่องแพ็กเกจ ----------
async function renderPlanBox() {
  const box = document.getElementById('plan-box');
  if (!box) return;
  const ent = getEntitlements();
  if (ent.tier === 'unlimited') { box.hidden = true; return; }
  box.hidden = false;
  const counters = await getPlanCounters();
  const books = (await dbGetAllBooks().catch(() => [])).length;
  const usage = (used, limit, unit) => limit === null ? `${used} ${unit} (ไม่จำกัด)` : `${Math.min(used, limit)}/${limit} ${unit}`;
  box.innerHTML = `<div class="plan-card">
    <div class="plan-head"><b>แพ็กเกจ: ${escapeHtml(ent.name)}</b>
      <button class="btn btn-sm" onclick="openPlansModal()">ดูแพ็กเกจทั้งหมด</button></div>
    <div class="hint">วันนี้แปลด้วย API Key ของคุณ ${usage(counters.byok, ent.byokChaptersPerDay, 'ตอน')} · ถามผู้ช่วย ${usage(counters.assistant, ent.assistantPerDay, 'คำถาม')} · ชั้นหนังสือ ${usage(books, ent.maxBooks, 'เรื่อง')}</div>
    ${ent.tier === 'guest' ? '<div class="hint">เข้าสู่ระบบฟรีด้วยอีเมล: แปลได้มากขึ้น ชั้นหนังสือ 10 เรื่อง คู่มือเรื่องอัตโนมัติ EPUB เพลงประกอบ และโควตา AI ของ Dusktale <button class="btn btn-sm btn-primary" onclick="openHostedSignIn()">เข้าสู่ระบบฟรี</button></div>' : ''}
  </div>`;
}

// ---------- ตารางเปรียบเทียบแพ็กเกจ ----------
function buildPlansTableHtml(currentTier) {
  const fmt = (v, unit) => v === null ? 'ไม่จำกัด' : v === true ? '✓' : v === false ? '–' : `${v}${unit ? ` ${unit}` : ''}`;
  const perChapter = (typeof HOSTED !== 'undefined' && HOSTED.tokensPerChapter) || 20000;
  const tokenLabel = (n) => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`;
  const hostedTokens = (t) => PLAN_HOSTED_TOKENS[t] ? `${tokenLabel(PLAN_HOSTED_TOKENS[t])} token/เดือน (≈${Math.floor(PLAN_HOSTED_TOKENS[t] / perChapter)} ตอน)` : '–';
  const rows = [
    // แถวราคาเป็น HTML (ขีดทับราคาปกติ) แถวอื่นเป็นข้อความธรรมดา
    ['ราคา / 30 วัน', t => PAID_PLAN_IDS.includes(t) ? { html: planPriceHtml(t) } : 'ฟรี'],
    ['แปลด้วย API Key ของคุณ', t => fmt(PLAN_DEFAULTS[t].byokChaptersPerDay, 'ตอน/วัน')],
    ['แปลด้วย AI ของ Dusktale', hostedTokens],
    ['ชั้นหนังสือ', t => fmt(PLAN_DEFAULTS[t].maxBooks, 'เรื่อง')],
    ['แปลล่วงหน้าแบบชุด', t => fmt(PLAN_DEFAULTS[t].batchMax, 'ตอน/ครั้ง')],
    ['ผู้ช่วย AI', t => fmt(PLAN_DEFAULTS[t].assistantPerDay, 'คำถาม/วัน')],
    ['ติดตามตอนใหม่อัตโนมัติ', t => PLAN_DEFAULTS[t].followBooks === 0 ? '–' : fmt(PLAN_DEFAULTS[t].followBooks, 'เรื่อง')],
    ...Object.keys(PLAN_FEATURE_LABELS).map(k => [PLAN_FEATURE_LABELS[k], t =>
      k === 'cloudSync' && PLAN_DEFAULTS[t].cloudSync ? `✓ ${PLAN_DEFAULTS[t].cloudStorageMB} MB` : fmt(PLAN_DEFAULTS[t][k])])
  ];
  const head = PLAN_ORDER.map(t => `<th scope="col"${t === currentTier ? ' class="plan-current"' : ''}>${escapeHtml(PLAN_DEFAULTS[t].name)}${t === currentTier ? '<br><small>ระดับของคุณ</small>' : ''}</th>`).join('');
  const cellHtml = (v) => (v && typeof v === 'object' ? v.html : escapeHtml(v));
  const body = rows.map(([label, cell]) => `<tr><th scope="row">${escapeHtml(label)}</th>${PLAN_ORDER.map(t => `<td${t === currentTier ? ' class="plan-current"' : ''}>${cellHtml(cell(t))}</td>`).join('')}</tr>`).join('');
  return `<div class="plans-table-wrap"><table class="plans-table"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderPlansModalBody() {
  const ent = getEntitlements();
  const body = document.getElementById('plans-modal-body');
  if (!body) return;
  body.innerHTML = `${buildPlansTableHtml(ent.tier)}
    ${buildPurchaseHtml(ent)}
    <p class="hint">ทุกระดับ: อ่านตอนที่แปลไว้ แก้คำแปล คลังศัพท์ สำรอง/กู้คืนข้อมูล และส่งออก TXT ได้เสมอ ไม่มีการล็อกข้อมูลของคุณ (ข้อมูลบนคลาวด์ดาวน์โหลดคืนได้แม้แพ็กเกจหมดอายุ) · กดเช็กตอนใหม่เองได้ทุกระดับ ติดตามอัตโนมัติจะเช็กให้ระหว่างเปิดแอพ</p>`;
}

function openPlansModal() {
  renderPlansModalBody();
  openModal('plans-modal');
  // ราคาและสถานะรับชำระเงินล่าสุดจากเซิร์ฟเวอร์ (เปลี่ยนแล้ววาดใหม่)
  const before = JSON.stringify(billingInfo);
  loadBillingInfo().then(() => {
    if (JSON.stringify(billingInfo) !== before && document.getElementById('plans-modal')?.classList.contains('active')) renderPlansModalBody();
  }).catch(() => {});
  // เคยชำระเงินแล้ว: ดึงสถานะการสมัครล่าสุดจาก Stripe (เช่นยกเลิก/เปลี่ยนแพ็กเกจจากที่อื่น)
  if (billingAvailable() && typeof hostedMe !== 'undefined' && hostedMe?.billing?.hasCustomer) {
    const beforeMe = JSON.stringify(hostedMe.billing);
    syncBillingStatus().then(me => {
      if (me && JSON.stringify(me.billing) !== beforeMe && document.getElementById('plans-modal')?.classList.contains('active')) renderPlansModalBody();
    });
  }
}

/** ให้เซิร์ฟเวอร์ดึงสถานะจาก Stripe มาบันทึก แล้วโหลดแพ็กเกจใหม่ (พลาดไม่เป็นไร ใช้ข้อมูลเดิม) */
async function syncBillingStatus() {
  try { await billingPost('sync'); } catch (e) { console.warn('billing sync failed:', e.message); }
  try { return await fetchHostedMe(); } catch (e) { return null; }
}

// ---------- ชำระเงิน (Stripe Checkout) ----------
// ราคาและสถานะจากเซิร์ฟเวอร์ (GET /api/billing/prices) แก้ราคาที่ Stripe/Vercel ที่เดียว แอพตามเอง
const BILLING_INFO_KEY = 'nov_billing_info';
const BILLING_INFO_MAX_AGE = 6 * 3600 * 1000;
let billingInfo = (() => {
  try {
    const c = JSON.parse(localStorage.getItem(BILLING_INFO_KEY) || 'null');
    return c && typeof c === 'object' && c.plans ? c : null;
  } catch (e) { return null; }
})();

async function loadBillingInfo(force = false) {
  if (typeof isHostedConfigured !== 'function' || !isHostedConfigured()) return null;
  if (!force && billingInfo && Date.now() - (billingInfo.at || 0) < BILLING_INFO_MAX_AGE) return billingInfo;
  const res = await fetch(`${HOSTED.apiBase}/billing/prices`);
  if (!res.ok) return billingInfo;
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== 'object') return billingInfo;
  billingInfo = { enabled: data.enabled === true, testMode: data.testMode === true, plans: data.plans && typeof data.plans === 'object' ? data.plans : {}, at: Date.now() };
  try { localStorage.setItem(BILLING_INFO_KEY, JSON.stringify(billingInfo)); } catch (e) {}
  return billingInfo;
}

/** ราคาต่อ 30 วัน (บาท): จากเซิร์ฟเวอร์ → ค่าใน hosted-config.js → ค่าตั้งต้น */
function planPrice(plan, kind = 'monthlyThb') {
  const fromServer = Number(billingInfo?.plans?.[plan]?.[kind]);
  if (Number.isFinite(fromServer) && fromServer > 0) return fromServer;
  const fromConfig = typeof HOSTED !== 'undefined' ? Number(HOSTED.prices?.[plan]) : NaN;
  return Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : PLAN_PRICE_FALLBACK[plan];
}

/** ราคาปกติ (ก่อนลด) คืน null ถ้าไม่มีส่วนลด */
function planListPrice(plan, kind = 'monthlyThb') {
  const fromConfig = typeof HOSTED !== 'undefined' ? Number(HOSTED.listPrices?.[plan]) : NaN;
  const list = Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : PLAN_LIST_PRICE_FALLBACK[plan];
  return Number.isFinite(list) && list > planPrice(plan, kind) ? list : null;
}

/** ราคาแบบขีดทับราคาปกติ (HTML) เช่น ~~99~~ 59 บาท */
function planPriceHtml(plan, kind = 'monthlyThb') {
  const price = planPrice(plan, kind);
  const list = planListPrice(plan, kind);
  return `${list ? `<s class="plan-price-old" aria-label="ราคาปกติ ${list} บาท">${list}</s> ` : ''}<span class="plan-price-now">${price} บาท</span>`;
}

function planDiscountPercent(plan) {
  const list = planListPrice(plan);
  return list ? Math.round((1 - planPrice(plan) / list) * 100) : 0;
}

function billingAvailable() {
  if (typeof isHostedConfigured !== 'function' || !isHostedConfigured()) return false;
  return billingInfo?.enabled === true || (typeof HOSTED !== 'undefined' && HOSTED.billingEnabled);
}

function billingIsTestMode() {
  return billingInfo ? billingInfo.testMode === true : (typeof HOSTED !== 'undefined' && HOSTED.billingTestMode);
}

/** ส่วนสมัครแพ็กเกจใต้ตาราง: ผู้เยี่ยมชมต้องเข้าสู่ระบบก่อน / สมัครรายเดือนอยู่แล้วมีปุ่มจัดการการสมัคร */
function buildPurchaseHtml(ent) {
  if (ent.tier === 'unlimited') return '';
  if (ent.tier === 'guest') {
    return `<div class="plan-buy"><p class="hint">เข้าสู่ระบบฟรีด้วยอีเมลก่อน แล้วสมัคร Plus, Pro หรือ Max ได้จากหน้านี้</p>
      <div class="modal-actions"><button class="btn btn-primary" onclick="closeModal('plans-modal'); openHostedSignIn()">เข้าสู่ระบบฟรี</button></div></div>`;
  }
  if (!billingAvailable()) return '<p class="hint">แพ็กเกจ Plus, Pro และ Max จะเปิดให้สมัครเร็วๆ นี้</p>';
  const b = (typeof hostedMe !== 'undefined' && hostedMe?.billing) || {};
  const subActive = ['active', 'trialing', 'past_due'].includes(b.subStatus);
  const testBadge = billingIsTestMode() ? '<span class="plan-test-badge">โหมดทดสอบ ไม่มีการตัดเงินจริง</span>' : '';
  const status = describeBillingStatus(b);
  // สมัครรายเดือนอยู่: ไม่แสดงปุ่มซื้อ (ซื้อซ้อนเสียเงินเปล่า) เปลี่ยนแพ็กเกจ/ยกเลิกผ่านปุ่มด้านล่าง
  if (subActive) {
    const canceled = !!b.cancelAtPeriodEnd;
    return `<div class="plan-buy">
      <div class="plan-buy-head"><b>การสมัครของคุณ</b>${testBadge}</div>
      ${status ? `<div class="plan-sub-status">${escapeHtml(status)}</div>` : ''}
      <div class="plan-sub-actions">
        ${canceled
          ? '<button class="btn btn-primary btn-sm" onclick="openBillingPortal()">ต่ออายุการสมัคร</button>'
          : `<button class="btn btn-primary btn-sm" onclick="openBillingPortal('update')">เปลี่ยนแพ็กเกจ</button>
             <button class="btn btn-sm" onclick="openBillingPortal('cancel')">ยกเลิกการสมัคร</button>`}
        <button class="btn btn-sm" onclick="openBillingPortal()">บัตร / ใบเสร็จ</button>
      </div>
      <p class="hint">${canceled
        ? 'ยกเลิกแล้ว จะไม่ตัดเงินรอบถัดไป ใช้ได้จนครบรอบที่จ่าย อยากใช้ต่อกด "ต่ออายุการสมัคร"'
        : 'ยกเลิกได้ทุกเมื่อ ใช้ได้จนครบรอบที่จ่ายแล้ว · อัปเกรดจ่ายแค่ส่วนต่างของรอบนี้ · ลดแพ็กเกจมีผลรอบถัดไป'}</p>
      <div id="billing-msg" class="hint" aria-live="polite"></div>
    </div>`;
  }
  // มีสิทธิ์ PromptPay อยู่: ต่ออายุระดับเดิม หรืออัปเกรด (ระดับต่ำกว่าและบัตรซ่อนไว้ กันซื้อซ้อน)
  const passExp = Date.parse(b.passExpiresAt || '');
  if (PAID_PLAN_IDS.includes(b.passPlan) && passExp > Date.now()) {
    const cur = b.passPlan;
    const daysLeft = Math.max(1, Math.ceil((passExp - Date.now()) / 86400000));
    const higher = PAID_PLAN_IDS.slice(PAID_PLAN_IDS.indexOf(cur) + 1);
    // เครดิตเงินที่เหลือ = ราคา 30 วันของระดับเดิม x วันที่เหลือ / 30 แปลงเป็นวันของระดับใหม่ (ตรงกับ dt_billing_grant_pass)
    const credit = Math.round(planPrice(cur, 'passThb') * daysLeft / 30);
    const upgradeDays = (plan) => Math.floor(daysLeft * planPrice(cur, 'passThb') / planPrice(plan, 'passThb'));
    return `<div class="plan-buy">
      <div class="plan-buy-head"><b>สิทธิ์ของคุณ</b>${testBadge}</div>
      <div class="plan-sub-status">${escapeHtml(status)} · เหลือ ${daysLeft} วัน</div>
      <div class="plan-sub-actions">
        <button class="btn btn-primary btn-sm" onclick="startCheckout('${cur}', 'promptpay')">ต่ออายุ ${escapeHtml(PLAN_DEFAULTS[cur].name)} อีก 30 วัน · PromptPay ${planPrice(cur, 'passThb')} บาท</button>
        ${higher.map(p => `<button class="btn btn-sm" onclick="startCheckout('${p}', 'promptpay')">อัปเกรดเป็น ${escapeHtml(PLAN_DEFAULTS[p].name)} · PromptPay ${planPrice(p, 'passThb')} บาท</button>`).join('')}
        ${b.hasCustomer ? '<button class="btn btn-sm" onclick="openBillingPortal()">ใบเสร็จ</button>' : ''}
      </div>
      <p class="hint">ต่ออายุ: วันใหม่ต่อจากวันหมดอายุเดิม ไม่เสียวัน${higher.length ? ` · อัปเกรด: เงินที่เหลือของ ${escapeHtml(PLAN_DEFAULTS[cur].name)} ${daysLeft} วัน (≈${credit} บาท) ไม่หาย แปลงเป็นวันของระดับใหม่ ${higher.map(p => `${escapeHtml(PLAN_DEFAULTS[p].name)} ≈ ${upgradeDays(p) + 30} วัน`).join(' / ')} รวม 30 วันที่ซื้อใหม่` : ''} · สมัครรายเดือนด้วยบัตรได้เมื่อสิทธิ์นี้หมด</p>
      <div id="billing-msg" class="hint" aria-live="polite"></div>
    </div>`;
  }
  const card = (plan) => {
    const name = PLAN_DEFAULTS[plan].name;
    const monthly = planPrice(plan);
    const pass = planPrice(plan, 'passThb');
    const perChapter = PLAN_HOSTED_TOKENS[plan] ? (monthly / Math.floor(PLAN_HOSTED_TOKENS[plan] / ((typeof HOSTED !== 'undefined' && HOSTED.tokensPerChapter) || 20000))).toFixed(2) : '';
    // PromptPay ก่อน: คนไทยใช้มากกว่า และค่าธรรมเนียมต่ำกว่าบัตร
    const off = planDiscountPercent(plan);
    return `<div class="plan-buy-card${ent.tier === plan ? ' plan-buy-current' : ''}">
      <div class="plan-buy-name">${escapeHtml(name)} <span class="plan-buy-price">${planPriceHtml(plan)}</span><span class="hint"> / 30 วัน</span>${off ? ` <span class="plan-off-badge">ราคาเปิดตัว -${off}%</span>` : ''}</div>
      ${perChapter ? `<div class="hint">ตกตอนละประมาณ ${perChapter} บาท (AI ของ Dusktale)</div>` : ''}
      <button class="btn btn-primary btn-sm" onclick="startCheckout('${plan}', 'promptpay')">จ่าย PromptPay ${pass} บาท (30 วัน)</button>
      <button class="btn btn-sm" onclick="startCheckout('${plan}', 'card')">สมัครรายเดือนด้วยบัตร</button>
    </div>`;
  };
  return `<div class="plan-buy">
    <div class="plan-buy-head"><b>สมัครแพ็กเกจ</b>${testBadge}</div>
    ${status ? `<div class="hint">${status}</div>` : ''}
    <div class="plan-buy-grid">${PAID_PLAN_IDS.map(card).join('')}</div>
    ${PAID_PLAN_IDS.some(p => planListPrice(p)) ? `<p class="hint">ราคาเปิดตัวช่วงแรก ราคาปกติ ${PAID_PLAN_IDS.filter(p => planListPrice(p)).map(p => `${escapeHtml(PLAN_DEFAULTS[p].name)} ${planListPrice(p)} บาท`).join(' / ')}</p>` : ''}
    <p class="hint">บัตร: ต่ออายุอัตโนมัติทุกเดือน ยกเลิกได้ทุกเมื่อ ใช้ได้จนครบรอบที่จ่ายแล้ว · PromptPay: จ่ายครั้งเดียวได้ 30 วัน ซื้อเพิ่มก่อนหมดได้ วันจะต่อจากเดิม</p>
    ${b.hasCustomer ? '<div class="modal-actions"><button class="btn btn-sm" onclick="openBillingPortal()">ใบเสร็จ / ประวัติการชำระเงิน</button></div>' : ''}
    <div id="billing-msg" class="hint" aria-live="polite"></div>
  </div>`;
}

function formatThaiDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** สถานะการสมัครเป็นข้อความสั้น (ใช้ทั้งในหน้าต่างแพ็กเกจและกล่องบัญชี) */
function describeBillingStatus(b) {
  if (!b) return '';
  const name = (p) => PLAN_DEFAULTS[p]?.name || p;
  if (['active', 'trialing'].includes(b.subStatus) && b.subPlan) {
    return b.cancelAtPeriodEnd
      ? `สมัคร ${name(b.subPlan)} รายเดือน · ยกเลิกแล้ว ใช้ได้ถึง ${formatThaiDate(b.renewsAt)}`
      : `สมัคร ${name(b.subPlan)} รายเดือน · ต่ออายุอัตโนมัติ ${formatThaiDate(b.renewsAt)}`;
  }
  if (b.subStatus === 'past_due' && b.subPlan) return `ตัดบัตรรอบใหม่ของ ${name(b.subPlan)} ไม่สำเร็จ กรุณาอัปเดตบัตรในหน้าจัดการการสมัคร`;
  if (b.passPlan && b.passExpiresAt) return `${name(b.passPlan)} (PromptPay) ใช้ได้ถึง ${formatThaiDate(b.passExpiresAt)}`;
  return '';
}

async function billingPost(path, body) {
  const token = await getHostedAccessToken();
  const res = await fetch(`${HOSTED.apiBase}/billing/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

function setBillingMsg(text, tone = '') {
  const el = document.getElementById('billing-msg');
  if (!el) return;
  el.textContent = text;
  el.className = `hint${tone ? ` text-${tone}` : ''}`;
}

/** ไปหน้าชำระเงินของ Stripe (ข้อมูลบัตรกรอกที่ Stripe ไม่ผ่านแอพ/เซิร์ฟเวอร์ของเรา) */
async function startCheckout(plan, method) {
  setBillingMsg('กำลังเปิดหน้าชำระเงิน...');
  document.querySelectorAll('.plan-buy button').forEach(b => { b.disabled = true; });
  try {
    const { url } = await billingPost('checkout', { plan, method });
    if (!/^https:\/\/checkout\.stripe\.com\//.test(url || '')) throw new Error('ได้ลิงก์ชำระเงินที่ไม่ถูกต้อง');
    location.href = url;
  } catch (err) {
    setBillingMsg(`เปิดหน้าชำระเงินไม่สำเร็จ: ${err.message}`, 'danger');
    document.querySelectorAll('.plan-buy button').forEach(b => { b.disabled = false; });
  }
}

/** หน้าจัดการการสมัครของ Stripe: flow 'cancel' = หน้ายกเลิก, 'update' = หน้าเปลี่ยนแพ็กเกจ, ไม่ใส่ = หน้าหลัก */
async function openBillingPortal(flow) {
  setBillingMsg(flow === 'cancel' ? 'กำลังเปิดหน้ายกเลิกการสมัคร...' : flow === 'update' ? 'กำลังเปิดหน้าเปลี่ยนแพ็กเกจ...' : 'กำลังเปิดหน้าจัดการการสมัคร...');
  try {
    const { url } = await billingPost('portal', flow ? { flow } : {});
    if (!/^https:\/\/billing\.stripe\.com\//.test(url || '')) throw new Error('ได้ลิงก์ที่ไม่ถูกต้อง');
    location.href = url;
  } catch (err) {
    setBillingMsg(`เปิดไม่สำเร็จ: ${err.message}`, 'danger');
  }
}

/** กลับมาจากหน้าชำระเงิน: รอ webhook อัปเดตแพ็กเกจ (ปกติไม่กี่วินาที) แล้วแจ้งผล */
async function handleBillingReturn() {
  let params;
  try { params = new URLSearchParams(location.search); } catch (e) { return; }
  const result = params.get('billing');
  if (!result) return;
  params.delete('billing');
  const qs = params.toString();
  history.replaceState(history.state, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  if (result === 'cancel') {
    showGlobalToast('ยกเลิกการชำระเงินแล้ว ยังไม่มีการตัดเงิน');
    setTimeout(hideGlobalToast, 3000);
    return;
  }
  // กลับจากหน้ายกเลิก/เปลี่ยนแพ็กเกจ: รอ webhook แล้วแสดงสถานะใหม่
  if (result === 'updated' && isHostedSignedIn()) {
    showGlobalToast('กำลังอัปเดตสถานะการสมัคร...');
    try {
      const me = await syncBillingStatus();
      if (!me) throw new Error('no data');
      hideGlobalToast();
      appAlert(`แพ็กเกจตอนนี้: ${me.planName || me.plan}\n${describeBillingStatus(me.billing) || ''}`, { title: 'อัปเดตการสมัครแล้ว' });
    } catch (e) {
      hideGlobalToast();
    }
    return;
  }
  if (result !== 'success' || !isHostedSignedIn()) return;
  const before = readPlanCache()?.plan || 'free';
  showGlobalToast('ชำระเงินสำเร็จ กำลังอัปเดตแพ็กเกจ...');
  for (let i = 0; i < 6; i++) {
    try {
      // รอบแรก: ดึงสถานะการสมัครจาก Stripe เอง ไม่ต้องรอ webhook (PromptPay รอ webhook ตามปกติ)
      const me = i === 0 ? await syncBillingStatus() : await fetchHostedMe();
      if (!me) throw new Error('no data');
      if (me.plan !== before || me.billing?.source === 'subscription' || me.billing?.source === 'pass') {
        hideGlobalToast();
        appAlert(`ขอบคุณที่สนับสนุน Dusktale แพ็กเกจของคุณตอนนี้: ${me.planName || me.plan}\n${describeBillingStatus(me.billing) || ''}`, { title: 'ชำระเงินสำเร็จ' });
        return;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 3000));
  }
  hideGlobalToast();
  appAlert('ได้รับการชำระเงินแล้ว แต่ระบบยังอัปเดตแพ็กเกจไม่เสร็จ (PromptPay อาจใช้เวลาสักครู่) ลองกด "รีเฟรชโควตา" ในหน้าตั้งค่าอีกครั้งภายหลัง ถ้าเกิน 1 ชั่วโมงแจ้งผู้ดูแลได้', { title: 'กำลังอัปเดตแพ็กเกจ' });
}

// สมาชิก: อัปเดตแพ็กเกจจากเซิร์ฟเวอร์เป็นระยะ (เปลี่ยนแพ็กเกจแล้วไม่ต้องออกจากระบบ)
document.addEventListener('DOMContentLoaded', () => {
  if (typeof location !== 'undefined' && /[?&]billing=/.test(location.search)) {
    setTimeout(() => handleBillingReturn().catch(err => console.warn('billing return failed:', err)), 800);
    return;
  }
  setTimeout(() => {
    if (typeof isHostedSignedIn !== 'function' || !isHostedSignedIn()) return;
    const cache = readPlanCache();
    if (cache && Date.now() - (cache.at || 0) < PLAN_CACHE_REFRESH_AGE) return;
    fetchHostedMe().catch(() => {});
  }, 3000);
});
