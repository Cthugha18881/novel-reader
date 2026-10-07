// POST /api/billing/sync — ดึงสถานะการสมัครล่าสุดจาก Stripe มาบันทึก (เรียกตอนกลับมาจากหน้า Stripe)
// ไม่ต้องรอ webhook อย่างเดียว: webhook ช้า/พลาด หรือข้อมูลค้างจากรุ่นก่อน ก็แก้ตัวเองได้
import { json, apiError, prepare, preflight, getUser, rpc, stripeRequest } from '../../lib/http.js';
import { readBillingEnv, subscriptionPatch } from '../../lib/billing.js';

export function OPTIONS(request) {
  return preflight(request);
}

const ACTIVE_SUB = ['active', 'trialing', 'past_due'];

/** เลือกการสมัครที่ควรบันทึก: ที่ยังใช้งานอยู่ก่อน ไม่มีใช้ตัวล่าสุด */
export function pickSubscription(list) {
  const subs = Array.isArray(list) ? list : [];
  return subs.find(s => ACTIVE_SUB.includes(s?.status)) ||
    subs.slice().sort((a, b) => (Number(b?.created) || 0) - (Number(a?.created) || 0))[0] || null;
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
    if (!profile?.customerId) return json(200, { synced: false }, cors.headers);
    const subs = await stripeRequest(billing, 'GET', '/subscriptions', { customer: profile.customerId, status: 'all', limit: 5 });
    const sub = pickSubscription(subs?.data);
    if (!sub) return json(200, { synced: false }, cors.headers);
    const patch = subscriptionPatch(sub, billing);
    await rpc(env, 'dt_billing_apply_subscription', { ...patch, p_user: user.id, p_customer: profile.customerId });
    return json(200, { synced: true }, cors.headers);
  } catch (err) {
    console.error('billing sync failed', err.message);
    return apiError(502, 'อัปเดตสถานะการสมัครไม่สำเร็จ ลองใหม่อีกครั้ง', 'server', cors.headers);
  }
}
