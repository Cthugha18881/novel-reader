// ==================== ระดับสมาชิกและสิทธิ์การใช้งาน ====================
// ผู้เยี่ยมชม (ไม่เข้าสู่ระบบ) / สมาชิกฟรี / Plus / Pro: จำกัดจำนวนต่อวันและเปิด-ปิดบางฟีเจอร์
// ค่าในไฟล์นี้เป็นค่าตั้งต้น สมาชิกที่เข้าสู่ระบบใช้ค่าจากเซิร์ฟเวอร์ (ตาราง dt_plans.features) ถ้ามี
// ไม่ล็อกข้อมูลที่มีอยู่แล้วเสมอ: อ่าน แก้คำแปล คลังศัพท์ สำรอง/กู้คืน ส่งออก TXT ใช้ได้ทุกระดับ
// ถ้าไม่ได้ตั้งบริการ Dusktale (hosted-config.js ว่าง) จะไม่จำกัดอะไรเลย เพราะไม่มีทางเข้าสู่ระบบ

// null = ไม่จำกัด
const PLAN_DEFAULTS = {
  guest: { name: 'ผู้เยี่ยมชม', byokChaptersPerDay: 20, maxBooks: 3, batchMax: 5, assistantPerDay: 10, autoBible: false, epub: false, bgm: false, bestMode: false },
  free: { name: 'สมาชิกฟรี', byokChaptersPerDay: 40, maxBooks: 10, batchMax: 10, assistantPerDay: 30, autoBible: true, epub: true, bgm: true, bestMode: false },
  plus: { name: 'Plus', byokChaptersPerDay: null, maxBooks: null, batchMax: 50, assistantPerDay: null, autoBible: true, epub: true, bgm: true, bestMode: true },
  pro: { name: 'Pro', byokChaptersPerDay: null, maxBooks: null, batchMax: 50, assistantPerDay: null, autoBible: true, epub: true, bgm: true, bestMode: true },
  unlimited: { name: 'ไม่จำกัด', byokChaptersPerDay: null, maxBooks: null, batchMax: 50, assistantPerDay: null, autoBible: true, epub: true, bgm: true, bestMode: true }
};
const PLAN_ORDER = ['guest', 'free', 'plus', 'pro'];
const PLAN_CACHE_KEY = 'nov_plan_cache';
// สิทธิ์ที่จำไว้ใช้ได้นานแค่ไหนตอนออฟไลน์ (เกินนี้ถือเป็นสมาชิกฟรีจนกว่าจะต่อเซิร์ฟเวอร์ได้)
const PLAN_CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;
const PLAN_CACHE_REFRESH_AGE = 6 * 3600 * 1000;

const PLAN_FEATURE_LABELS = {
  autoBible: 'คู่มือเรื่องและบันทึกเหตุการณ์อัตโนมัติ',
  epub: 'ส่งออกไฟล์ EPUB',
  bgm: 'เพลงประกอบการอ่าน',
  bestMode: 'โหมดแปล "ดีที่สุด" (เกลาสำนวน + ตรวจความหมาย)'
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
  try {
    localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ plan: me.plan, planName: me.planName || '', features: me.features || null, at: Date.now() }));
  } catch (e) {}
  if (typeof renderPlanBox === 'function') renderPlanBox();
}

function getPlanTier() {
  if (typeof isHostedConfigured !== 'function' || !isHostedConfigured()) return 'unlimited';
  if (typeof isHostedSignedIn !== 'function' || !isHostedSignedIn()) return 'guest';
  const cache = readPlanCache();
  if (cache && Date.now() - (cache.at || 0) < PLAN_CACHE_MAX_AGE && PLAN_DEFAULTS[cache.plan] && cache.plan !== 'guest' && cache.plan !== 'unlimited') return cache.plan;
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
  const next = PLAN_DEFAULTS[ent.tier === 'guest' ? 'free' : 'plus'];
  const fmt = (n, unit) => n === null ? 'ไม่จำกัด' : `${n} ${unit}`;
  const upsell = ent.tier === 'guest'
    ? `เข้าสู่ระบบฟรีด้วยอีเมลเพื่อเพิ่มเป็น`
    : `แพ็กเกจ Plus เพิ่มเป็น`;
  switch (kind) {
    case 'byok': return `วันนี้แปลด้วย API Key ของคุณครบ ${ent.byokChaptersPerDay} ตอนแล้ว (${ent.name}) ${upsell} ${fmt(next.byokChaptersPerDay, 'ตอนต่อวัน')}${ent.tier !== 'guest' ? ' หรือแปลต่อด้วยโควตา AI ของ Dusktale' : ''} · เริ่มนับใหม่พรุ่งนี้`;
    case 'assistant': return `วันนี้ถามผู้ช่วย AI ครบ ${ent.assistantPerDay} คำถามแล้ว (${ent.name}) ${upsell} ${fmt(next.assistantPerDay, 'คำถามต่อวัน')} · เริ่มนับใหม่พรุ่งนี้`;
    case 'books': return `ชั้นหนังสือมีครบ ${ent.maxBooks} เรื่องแล้ว (${ent.name}) เรื่องเดิมยังอ่านและแปลต่อได้ตามปกติ ${upsell} ${fmt(next.maxBooks, 'เรื่อง')} หรือลบเรื่องที่อ่านจบแล้ว (สำรองไฟล์ไว้ก่อนได้)`;
    case 'batch': return `${ent.name} แปลล่วงหน้าได้ครั้งละไม่เกิน ${ent.batchMax} ตอน ${upsell} ${fmt(next.batchMax, 'ตอนต่อครั้ง')}`;
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
    ? [{ label: 'เข้าสู่ระบบฟรี', value: 'login', variant: 'primary' }, { label: 'ดูแพ็กเกจ', value: 'plans' }, { label: 'ปิด', value: null }]
    : [{ label: 'ดูแพ็กเกจ', value: 'plans', variant: 'primary' }, { label: 'ปิด', value: null }];
  const pick = await appChoose(msg, choices, { title: 'ถึงขีดจำกัดของแพ็กเกจ' });
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
  const hostedTokens = { guest: '–', free: '400K token/เดือน (≈20 ตอน)', plus: '4M token/เดือน (≈200 ตอน)', pro: '12M token/เดือน (≈600 ตอน)' };
  const rows = [
    ['แปลด้วย API Key ของคุณ', t => fmt(PLAN_DEFAULTS[t].byokChaptersPerDay, 'ตอน/วัน')],
    ['แปลด้วย AI ของ Dusktale', t => hostedTokens[t]],
    ['ชั้นหนังสือ', t => fmt(PLAN_DEFAULTS[t].maxBooks, 'เรื่อง')],
    ['แปลล่วงหน้าแบบชุด', t => fmt(PLAN_DEFAULTS[t].batchMax, 'ตอน/ครั้ง')],
    ['ผู้ช่วย AI', t => fmt(PLAN_DEFAULTS[t].assistantPerDay, 'คำถาม/วัน')],
    ...Object.keys(PLAN_FEATURE_LABELS).map(k => [PLAN_FEATURE_LABELS[k], t => fmt(PLAN_DEFAULTS[t][k])])
  ];
  const head = PLAN_ORDER.map(t => `<th scope="col"${t === currentTier ? ' class="plan-current"' : ''}>${escapeHtml(PLAN_DEFAULTS[t].name)}${t === currentTier ? '<br><small>ระดับของคุณ</small>' : ''}</th>`).join('');
  const body = rows.map(([label, cell]) => `<tr><th scope="row">${escapeHtml(label)}</th>${PLAN_ORDER.map(t => `<td${t === currentTier ? ' class="plan-current"' : ''}>${escapeHtml(cell(t))}</td>`).join('')}</tr>`).join('');
  return `<div class="plans-table-wrap"><table class="plans-table"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function openPlansModal() {
  const ent = getEntitlements();
  const body = document.getElementById('plans-modal-body');
  if (!body) return;
  body.innerHTML = `${buildPlansTableHtml(ent.tier)}
    <p class="hint">ทุกระดับ: อ่านตอนที่แปลไว้ แก้คำแปล คลังศัพท์ สำรอง/กู้คืนข้อมูล และส่งออก TXT ได้เสมอ ไม่มีการล็อกข้อมูลของคุณ</p>
    <p class="hint">แพ็กเกจ Plus และ Pro จะเปิดให้สมัครเร็วๆ นี้ · ซิงก์หลายเครื่องและแปลล่วงหน้าบนเซิร์ฟเวอร์ตามมาในรุ่นถัดไป</p>
    ${ent.tier === 'guest' ? '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal(\'plans-modal\'); openHostedSignIn()">เข้าสู่ระบบฟรี</button></div>' : ''}`;
  openModal('plans-modal');
}

// สมาชิก: อัปเดตแพ็กเกจจากเซิร์ฟเวอร์เป็นระยะ (เปลี่ยนแพ็กเกจแล้วไม่ต้องออกจากระบบ)
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (typeof isHostedSignedIn !== 'function' || !isHostedSignedIn()) return;
    const cache = readPlanCache();
    if (cache && Date.now() - (cache.at || 0) < PLAN_CACHE_REFRESH_AGE) return;
    fetchHostedMe().catch(() => {});
  }, 3000);
});
