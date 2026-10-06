// POST /api/billing/webhook — Stripe แจ้งผลการชำระเงิน (เรียกจากเซิร์ฟเวอร์ของ Stripe เท่านั้น ไม่มี CORS)
// ตรวจลายเซ็นก่อนทุกครั้ง แล้วอัปเดตแพ็กเกจในฐานข้อมูล ทุกขั้นทำซ้ำได้ (Stripe ส่งซ้ำได้ถ้าเราตอบไม่ทัน)
import { json, rpc, stripeRequest } from '../../lib/http.js';
import { readEnv } from '../../lib/core.js';
import { readBillingEnv, verifyStripeSignature, subscriptionPatch, passFromSession, customerOf } from '../../lib/billing.js';

export async function POST(request) {
  const billing = readBillingEnv(process.env);
  const env = readEnv(process.env);
  if (billing.missing.length || !env.supabaseUrl || !env.serviceKey) return json(503, { error: 'billing not configured' });

  const raw = await request.text();
  if (!verifyStripeSignature(raw, request.headers.get('stripe-signature'), billing.webhookSecret)) {
    return json(400, { error: 'invalid signature' });
  }
  let event;
  try { event = JSON.parse(raw); } catch (e) { return json(400, { error: 'invalid json' }); }

  try {
    await handleEvent(event, { env, billing });
    return json(200, { received: true });
  } catch (err) {
    // ตอบ 500 ให้ Stripe ส่งซ้ำภายหลัง
    console.error('webhook failed', event?.type, err.message);
    return json(500, { error: 'processing failed' });
  }
}

export async function handleEvent(event, { env, billing }) {
  const obj = event?.data?.object;
  switch (event?.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const userId = obj?.metadata?.user_id || obj?.client_reference_id;
      const customer = customerOf(obj);
      if (userId && customer) await rpc(env, 'dt_billing_set_customer', { p_user: userId, p_customer: customer });
      const pass = passFromSession(obj);
      if (pass) await rpc(env, 'dt_billing_grant_pass', pass);
      // สมัครรายเดือน: ดึง subscription ล่าสุดมาบันทึกเลย ไม่ต้องรอ event ของ subscription
      if (obj?.mode === 'subscription' && obj.subscription) {
        const subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription.id;
        const sub = await stripeRequest(billing, 'GET', `/subscriptions/${encodeURIComponent(subId)}`);
        const patch = subscriptionPatch(sub, billing);
        await rpc(env, 'dt_billing_apply_subscription', { ...patch, p_user: patch.p_user || userId });
      }
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      await rpc(env, 'dt_billing_apply_subscription', subscriptionPatch(obj, billing));
      return;
    default:
      // event อื่นไม่ต้องทำอะไร (ตอบ 200 ให้ Stripe ไม่ส่งซ้ำ)
      return;
  }
}
