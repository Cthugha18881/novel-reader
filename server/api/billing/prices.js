// GET /api/billing/prices — ราคาแพ็กเกจและสถานะรับชำระเงิน (สาธารณะ ไม่ต้องเข้าสู่ระบบ)
// ราคารายเดือนอ่านจาก Price ใน Stripe โดยตรง ราคา PromptPay 30 วันจาก DT_PASS_*_THB
// แก้ราคาที่ Stripe/Vercel ที่เดียว แอพแสดงตามเอง
import { json, prepare, preflight, stripeRequest } from '../../lib/http.js';
import { readBillingEnv, PAID_PLANS } from '../../lib/billing.js';

export function OPTIONS(request) {
  return preflight(request);
}

// จำราคาไว้ 10 นาทีต่อ instance (ไม่เรียก Stripe ทุกครั้งที่มีคนเปิดหน้าแพ็กเกจ)
let cache = { at: 0, key: '', monthly: null };
const CACHE_MS = 10 * 60 * 1000;

export async function fetchMonthlyPrices(billing, now = Date.now()) {
  const key = PAID_PLANS.map(p => billing.prices[p]).join(',');
  if (cache.monthly && cache.key === key && now - cache.at < CACHE_MS) return cache.monthly;
  const monthly = {};
  for (const plan of PAID_PLANS) {
    try {
      const price = await stripeRequest(billing, 'GET', `/prices/${encodeURIComponent(billing.prices[plan])}`);
      if (price?.currency === 'thb' && Number.isFinite(price.unit_amount)) monthly[plan] = price.unit_amount / 100;
    } catch (err) {
      console.error('price lookup failed', plan, err.message);
    }
  }
  cache = { at: now, key, monthly };
  return monthly;
}

export function resetPriceCache() {
  cache = { at: 0, key: '', monthly: null };
}

export async function GET(request) {
  const { cors } = prepare(request);
  const billing = readBillingEnv(process.env);
  const enabled = billing.missing.length === 0;
  const monthly = enabled ? await fetchMonthlyPrices(billing) : {};
  const plans = {};
  for (const plan of PAID_PLANS) {
    plans[plan] = { monthlyThb: monthly[plan] ?? billing.passThb[plan], passThb: billing.passThb[plan] };
  }
  return json(200, { enabled, testMode: enabled && billing.testMode, promptpay: billing.promptpay, plans }, {
    ...cors.headers,
    'Cache-Control': 'public, max-age=300'
  });
}
