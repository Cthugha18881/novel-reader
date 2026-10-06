// POST /api/billing/portal -> { url } หน้าจัดการการสมัครของ Stripe (ยกเลิก เปลี่ยนบัตร ดูใบเสร็จ)
import { json, apiError, prepare, preflight, getUser, rpc, stripeRequest } from '../../lib/http.js';
import { readBillingEnv } from '../../lib/billing.js';

export function OPTIONS(request) {
  return preflight(request);
}

export async function POST(request) {
  const { env, cors } = prepare(request);
  if (!cors.allowed) return apiError(403, 'origin นี้ไม่ได้รับอนุญาต', 'forbidden', cors.headers);
  const billing = readBillingEnv(process.env);
  if (env.missing.length || billing.missing.length) return apiError(503, 'ยังไม่เปิดรับชำระเงิน', 'config', cors.headers);
  const user = await getUser(env, request);
  if (!user) return apiError(401, 'กรุณาเข้าสู่ระบบ Dusktale ใหม่', 'auth', cors.headers);
  try {
    const profile = await rpc(env, 'dt_billing_profile', { p_user: user.id });
    if (!profile?.customerId) return apiError(404, 'ยังไม่มีประวัติการชำระเงินของบัญชีนี้', 'not_found', cors.headers);
    const session = await stripeRequest(billing, 'POST', '/billing_portal/sessions', {
      customer: profile.customerId,
      return_url: env.siteUrl,
      locale: 'th'
    });
    return json(200, { url: session.url }, cors.headers);
  } catch (err) {
    console.error('portal failed', err.message);
    return apiError(502, 'เปิดหน้าจัดการการสมัครไม่สำเร็จ ลองใหม่อีกครั้ง', 'server', cors.headers);
  }
}
