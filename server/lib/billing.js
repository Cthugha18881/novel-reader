// ฟังก์ชันล้วนของระบบชำระเงิน (Stripe): ค่าตั้ง, เข้ารหัสฟอร์ม, ตรวจลายเซ็น webhook, สร้างคำขอ Checkout
// บัตร = สมัครรายเดือน (Stripe Subscription ต่ออายุอัตโนมัติ)
// PromptPay = ซื้อสิทธิ์ 30 วันทีละครั้ง (PromptPay ตัดเงินอัตโนมัติไม่ได้)
import { createHmac, timingSafeEqual } from 'node:crypto';

export const PAID_PLANS = ['plus', 'pro', 'max'];
export const PASS_DAYS = 30;
const PLAN_LABELS = { plus: 'Plus', pro: 'Pro', max: 'Max' };

/** ค่าตั้งของระบบชำระเงินจาก environment variables (ไม่ตั้ง = ปิดรับชำระเงิน แอพส่วนอื่นยังใช้ได้) */
export function readBillingEnv(env) {
  const cfg = {
    secretKey: env.STRIPE_SECRET_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    prices: { plus: env.STRIPE_PRICE_PLUS || '', pro: env.STRIPE_PRICE_PRO || '', max: env.STRIPE_PRICE_MAX || '' },
    // ราคาซื้อ 30 วันผ่าน PromptPay (บาท)
    passThb: { plus: Number(env.DT_PASS_PLUS_THB) || 59, pro: Number(env.DT_PASS_PRO_THB) || 179, max: Number(env.DT_PASS_MAX_THB) || 299 },
    promptpay: env.DT_PROMPTPAY !== 'false'
  };
  cfg.testMode = /^(sk|rk)_test_/.test(cfg.secretKey);
  cfg.missing = Object.entries({
    STRIPE_SECRET_KEY: cfg.secretKey, STRIPE_WEBHOOK_SECRET: cfg.webhookSecret,
    STRIPE_PRICE_PLUS: cfg.prices.plus, STRIPE_PRICE_PRO: cfg.prices.pro, STRIPE_PRICE_MAX: cfg.prices.max
  }).filter(([, v]) => !v).map(([k]) => k);
  return cfg;
}

/** object -> application/x-www-form-urlencoded แบบที่ Stripe ใช้ (a[b][0][c]=...) */
export function formEncode(obj, prefix = '') {
  const parts = [];
  const add = (name, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => add(`${name}[${i}]`, v));
    else if (typeof value === 'object') Object.entries(value).forEach(([k, v]) => add(`${name}[${k}]`, v));
    else parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  };
  Object.entries(obj || {}).forEach(([k, v]) => add(prefix ? `${prefix}[${k}]` : k, v));
  return parts.join('&');
}

export function parseStripeSignature(header) {
  const out = { t: 0, v1: [] };
  String(header || '').split(',').forEach(part => {
    const [k, v] = part.split('=').map(s => (s || '').trim());
    if (k === 't') out.t = Number(v) || 0;
    if (k === 'v1' && v) out.v1.push(v);
  });
  return out;
}

/** ตรวจว่า webhook มาจาก Stripe จริง (HMAC-SHA256 ของ "t.body") และไม่เก่าเกิน 5 นาที */
export function verifyStripeSignature(rawBody, header, secret, { now = Date.now() / 1000, tolerance = 300 } = {}) {
  if (!secret || !header) return false;
  const { t, v1 } = parseStripeSignature(header);
  if (!t || !v1.length || Math.abs(now - t) > tolerance) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest();
  return v1.some(sig => {
    if (!/^[0-9a-f]+$/i.test(sig)) return false;
    const got = Buffer.from(sig, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export function validateCheckoutRequest(body, billing) {
  const plan = body?.plan;
  const method = body?.method;
  if (!PAID_PLANS.includes(plan)) return { ok: false, error: 'แพ็กเกจไม่ถูกต้อง' };
  if (!['card', 'promptpay'].includes(method)) return { ok: false, error: 'วิธีชำระเงินไม่ถูกต้อง' };
  if (method === 'promptpay' && !billing.promptpay) return { ok: false, error: 'ยังไม่เปิดรับ PromptPay' };
  return { ok: true, plan, method };
}

/** พารามิเตอร์สร้าง Checkout Session */
export function buildCheckoutParams({ plan, method, userId, email, customerId, billing, siteUrl }) {
  const base = String(siteUrl || '').replace(/[?#].*$/, '');
  const params = {
    client_reference_id: userId,
    success_url: `${base}?billing=success`,
    cancel_url: `${base}?billing=cancel`,
    locale: 'th',
    metadata: { user_id: userId, plan, kind: method === 'card' ? 'subscription' : 'pass' }
  };
  if (customerId) params.customer = customerId;
  else if (email) params.customer_email = email;

  if (method === 'card') {
    params.mode = 'subscription';
    params.line_items = [{ price: billing.prices[plan], quantity: 1 }];
    params.subscription_data = { metadata: { user_id: userId, plan } };
    params.allow_promotion_codes = true;
  } else {
    params.mode = 'payment';
    params.payment_method_types = ['promptpay'];
    params.line_items = [{
      quantity: 1,
      price_data: {
        currency: 'thb',
        unit_amount: Math.round(billing.passThb[plan] * 100),
        product_data: { name: `Dusktale ${PLAN_LABELS[plan]} ${PASS_DAYS} วัน` }
      }
    }];
    params.payment_intent_data = { metadata: { user_id: userId, plan, kind: 'pass' } };
    if (!customerId) params.customer_creation = 'always';
  }
  return params;
}

export function planForPrice(priceId, billing) {
  if (!priceId) return null;
  return PAID_PLANS.find(p => billing.prices[p] === priceId) || null;
}

/** subscription ของ Stripe -> ข้อมูลที่เก็บในฐานข้อมูล (รองรับทั้ง API รุ่นเก่าและใหม่ที่ย้ายวันสิ้นรอบไปไว้ใน items) */
export function subscriptionPatch(sub, billing) {
  const item = sub?.items?.data?.[0];
  const periodEnd = Number(sub?.current_period_end || item?.current_period_end) || 0;
  const plan = planForPrice(item?.price?.id, billing) || (PAID_PLANS.includes(sub?.metadata?.plan) ? sub.metadata.plan : null);
  return {
    p_user: sub?.metadata?.user_id || null,
    p_customer: typeof sub?.customer === 'string' ? sub.customer : (sub?.customer?.id || null),
    p_sub: sub?.id || null,
    p_status: sub?.status || 'incomplete',
    p_plan: plan,
    p_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    p_cancel: !!sub?.cancel_at_period_end
  };
}

/** Checkout ที่จ่าย PromptPay สำเร็จแล้ว -> สิทธิ์ 30 วัน (null ถ้ายังไม่ได้เงินหรือไม่ใช่การซื้อแบบนี้) */
export function passFromSession(session) {
  if (session?.mode !== 'payment' || session?.payment_status !== 'paid') return null;
  const md = session.metadata || {};
  if (md.kind !== 'pass' || !PAID_PLANS.includes(md.plan) || !md.user_id) return null;
  return { p_user: md.user_id, p_plan: md.plan, p_days: PASS_DAYS, p_ref: session.id };
}

export function customerOf(obj) {
  return typeof obj?.customer === 'string' ? obj.customer : (obj?.customer?.id || null);
}
