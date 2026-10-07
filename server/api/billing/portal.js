// POST /api/billing/portal {flow?: 'cancel'|'update'} -> { url } หน้าจัดการการสมัครของ Stripe
// flow = เปิดตรงไปที่หน้ายกเลิก/เปลี่ยนแพ็กเกจของการสมัครที่ใช้อยู่ ไม่ต้องหาปุ่มเอง
// ไม่มี flow (หรือเปิด flow ไม่ได้ เช่นยกเลิกไปแล้ว) = หน้าหลัก (บัตร ใบเสร็จ ต่ออายุกลับ)
import { json, apiError, prepare, preflight, getUser, rpc, stripeRequest } from '../../lib/http.js';
import { readBillingEnv, isSubscriptionCanceling } from '../../lib/billing.js';

export function OPTIONS(request) {
  return preflight(request);
}

const ACTIVE_SUB = ['active', 'trialing', 'past_due'];

export function buildPortalParams({ customerId, siteUrl, flow, subscriptionId }) {
  const base = String(siteUrl || '').replace(/[?#].*$/, '');
  const params = { customer: customerId, return_url: base, locale: 'th' };
  if (subscriptionId && (flow === 'cancel' || flow === 'update')) {
    const type = flow === 'cancel' ? 'subscription_cancel' : 'subscription_update';
    params.flow_data = {
      type,
      [type]: { subscription: subscriptionId },
      after_completion: { type: 'redirect', redirect: { return_url: `${base}?billing=updated` } }
    };
  }
  return params;
}

export async function POST(request) {
  const { env, cors } = prepare(request);
  if (!cors.allowed) return apiError(403, 'origin นี้ไม่ได้รับอนุญาต', 'forbidden', cors.headers);
  const billing = readBillingEnv(process.env);
  if (env.missing.length || billing.missing.length) return apiError(503, 'ยังไม่เปิดรับชำระเงิน', 'config', cors.headers);
  const user = await getUser(env, request);
  if (!user) return apiError(401, 'กรุณาเข้าสู่ระบบ Dusktale ใหม่', 'auth', cors.headers);
  const body = await request.json().catch(() => ({}));
  const flow = ['cancel', 'update'].includes(body?.flow) ? body.flow : null;
  try {
    const profile = await rpc(env, 'dt_billing_profile', { p_user: user.id });
    if (!profile?.customerId) return apiError(404, 'ยังไม่มีประวัติการชำระเงินของบัญชีนี้', 'not_found', cors.headers);
    let subscriptionId = null;
    if (flow) {
      const subs = await stripeRequest(billing, 'GET', '/subscriptions', { customer: profile.customerId, status: 'all', limit: 5 });
      const sub = (subs?.data || []).find(s => ACTIVE_SUB.includes(s.status));
      // ยกเลิกไว้แล้ว (รอสิ้นรอบ): ไม่มีหน้ายกเลิกซ้ำ เปิดหน้าหลักให้กด "ต่ออายุ" แทน
      if (sub && !(flow === 'cancel' && isSubscriptionCanceling(sub))) subscriptionId = sub.id;
    }
    let session;
    try {
      session = await stripeRequest(billing, 'POST', '/billing_portal/sessions', buildPortalParams({ customerId: profile.customerId, siteUrl: env.siteUrl, flow, subscriptionId }));
    } catch (err) {
      if (!subscriptionId) throw err;
      // เปิดหน้าเฉพาะไม่ได้ (เช่นปิดการเปลี่ยนแพ็กเกจในการตั้งค่า portal) -> หน้าหลัก
      console.warn('portal flow failed, fallback', err.message);
      session = await stripeRequest(billing, 'POST', '/billing_portal/sessions', buildPortalParams({ customerId: profile.customerId, siteUrl: env.siteUrl }));
    }
    return json(200, { url: session.url }, cors.headers);
  } catch (err) {
    console.error('portal failed', err.message);
    return apiError(502, 'เปิดหน้าจัดการการสมัครไม่สำเร็จ ลองใหม่อีกครั้ง', 'server', cors.headers);
  }
}
