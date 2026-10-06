// POST /api/billing/checkout {plan: 'plus'|'pro', method: 'card'|'promptpay'} -> { url } หน้าชำระเงินของ Stripe
import { json, apiError, prepare, preflight, getUser, rpc, stripeRequest } from '../../lib/http.js';
import { readBillingEnv, validateCheckoutRequest, buildCheckoutParams } from '../../lib/billing.js';

export function OPTIONS(request) {
  return preflight(request);
}

const ACTIVE_SUB = ['active', 'trialing', 'past_due'];

export async function POST(request) {
  const { env, cors } = prepare(request);
  if (!cors.allowed) return apiError(403, 'origin นี้ไม่ได้รับอนุญาต', 'forbidden', cors.headers);
  const billing = readBillingEnv(process.env);
  if (env.missing.length || billing.missing.length) return apiError(503, 'ยังไม่เปิดรับชำระเงิน', 'config', cors.headers);
  const user = await getUser(env, request);
  if (!user) return apiError(401, 'กรุณาเข้าสู่ระบบ Dusktale ก่อนสมัครแพ็กเกจ', 'auth', cors.headers);

  const body = await request.json().catch(() => null);
  const req = validateCheckoutRequest(body, billing);
  if (!req.ok) return apiError(400, req.error, 'invalid_request', cors.headers);

  try {
    const profile = await rpc(env, 'dt_billing_profile', { p_user: user.id });
    // สมัครรายเดือนซ้ำไม่ได้: เปลี่ยนแพ็กเกจ/ยกเลิกผ่านหน้าจัดการการสมัคร
    if (req.method === 'card' && ACTIVE_SUB.includes(profile?.subStatus)) {
      return apiError(409, 'คุณสมัครรายเดือนอยู่แล้ว ใช้ปุ่ม "จัดการการสมัคร" เพื่อเปลี่ยนแพ็กเกจหรือยกเลิก', 'conflict', cors.headers);
    }
    const params = buildCheckoutParams({
      plan: req.plan, method: req.method, userId: user.id, email: user.email,
      customerId: profile?.customerId || null, billing, siteUrl: env.siteUrl
    });
    const session = await stripeRequest(billing, 'POST', '/checkout/sessions', params);
    return json(200, { url: session.url, testMode: billing.testMode }, cors.headers);
  } catch (err) {
    console.error('checkout failed', err.message);
    return apiError(502, 'สร้างหน้าชำระเงินไม่สำเร็จ ลองใหม่อีกครั้ง', 'server', cors.headers);
  }
}
