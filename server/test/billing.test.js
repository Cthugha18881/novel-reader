// ทดสอบระบบชำระเงินโดยไม่ต่ออินเทอร์เน็ต (จำลอง Stripe และ Supabase)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  readBillingEnv, formEncode, parseStripeSignature, verifyStripeSignature, validateCheckoutRequest,
  buildCheckoutParams, planForPrice, subscriptionPatch, passFromSession, isSubscriptionCanceling
} from '../lib/billing.js';

const BILLING_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_PLUS: 'price_plus', STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_MAX: 'price_max'
};

test('readBillingEnv: บอกค่าที่ขาด ราคาเริ่มต้น 59/179/299 และโหมดทดสอบ', () => {
  const empty = readBillingEnv({});
  assert.deepEqual(empty.missing, ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PLUS', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_MAX']);
  const b = readBillingEnv(BILLING_ENV);
  assert.deepEqual(b.missing, []);
  assert.equal(b.testMode, true);
  assert.deepEqual(b.passThb, { plus: 59, pro: 179, max: 299 });
  assert.equal(readBillingEnv({ ...BILLING_ENV, STRIPE_SECRET_KEY: 'sk_live_x' }).testMode, false);
  assert.equal(readBillingEnv({ ...BILLING_ENV, DT_PROMPTPAY: 'false' }).promptpay, false);
});

test('formEncode: รูปแบบซ้อนแบบ Stripe', () => {
  const s = formEncode({ mode: 'payment', line_items: [{ price_data: { unit_amount: 9900 }, quantity: 1 }], payment_method_types: ['promptpay'], skip: null, flag: true });
  assert.equal(decodeURIComponent(s), 'mode=payment&line_items[0][price_data][unit_amount]=9900&line_items[0][quantity]=1&payment_method_types[0]=promptpay&flag=true');
});

function sign(body, secret, t) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

test('verifyStripeSignature: ถูกต้อง / ลายเซ็นผิด / เก่าเกิน / ไม่มี header', () => {
  const body = '{"id":"evt_1"}';
  const now = 1_800_000_000;
  assert.ok(verifyStripeSignature(body, sign(body, 'whsec_test', now), 'whsec_test', { now }));
  assert.ok(!verifyStripeSignature(body, sign(body, 'whsec_other', now), 'whsec_test', { now }));
  assert.ok(!verifyStripeSignature(body + ' ', sign(body, 'whsec_test', now), 'whsec_test', { now }));
  assert.ok(!verifyStripeSignature(body, sign(body, 'whsec_test', now - 1000), 'whsec_test', { now }));
  assert.ok(!verifyStripeSignature(body, '', 'whsec_test', { now }));
  assert.ok(!verifyStripeSignature(body, 't=1,v1=zz', 'whsec_test', { now: 1 }));
  assert.deepEqual(parseStripeSignature('t=5, v1=ab, v0=cd, v1=ef'), { t: 5, v1: ['ab', 'ef'] });
});

test('validateCheckoutRequest', () => {
  const b = readBillingEnv(BILLING_ENV);
  assert.ok(validateCheckoutRequest({ plan: 'plus', method: 'card' }, b).ok);
  assert.ok(validateCheckoutRequest({ plan: 'pro', method: 'promptpay' }, b).ok);
  assert.ok(validateCheckoutRequest({ plan: 'max', method: 'card' }, b).ok);
  assert.equal(validateCheckoutRequest({ plan: 'free', method: 'card' }, b).ok, false);
  assert.equal(validateCheckoutRequest({ plan: 'plus', method: 'bitcoin' }, b).ok, false);
  assert.equal(validateCheckoutRequest({ plan: 'plus', method: 'promptpay' }, readBillingEnv({ ...BILLING_ENV, DT_PROMPTPAY: 'false' })).ok, false);
  assert.equal(validateCheckoutRequest(null, b).ok, false);
});

test('buildCheckoutParams: บัตร = สมัครรายเดือน, PromptPay = 30 วันเป็นเงินบาท', () => {
  const b = readBillingEnv(BILLING_ENV);
  const card = buildCheckoutParams({ plan: 'pro', method: 'card', userId: 'u1', email: 'a@b.c', billing: b, siteUrl: 'https://site/app/?x=1#y' });
  assert.equal(card.mode, 'subscription');
  assert.deepEqual(card.line_items, [{ price: 'price_pro', quantity: 1 }]);
  assert.equal(card.subscription_data.metadata.user_id, 'u1');
  assert.equal(card.customer_email, 'a@b.c');
  assert.equal(card.success_url, 'https://site/app/?billing=success');
  const pp = buildCheckoutParams({ plan: 'plus', method: 'promptpay', userId: 'u1', customerId: 'cus_1', billing: b, siteUrl: 'https://site/' });
  assert.equal(pp.mode, 'payment');
  assert.deepEqual(pp.payment_method_types, ['promptpay']);
  assert.equal(pp.line_items[0].price_data.currency, 'thb');
  assert.equal(pp.line_items[0].price_data.unit_amount, 5900);
  assert.equal(pp.customer, 'cus_1');
  assert.equal(pp.customer_email, undefined);
  assert.equal(pp.metadata.kind, 'pass');
});

test('subscriptionPatch: รองรับวันสิ้นรอบทั้งแบบเก่าและใหม่ / หาแพ็กเกจจาก price', () => {
  const b = readBillingEnv(BILLING_ENV);
  const oldShape = subscriptionPatch({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1_800_000_000, metadata: { user_id: 'u1' }, items: { data: [{ price: { id: 'price_plus' } }] } }, b);
  assert.equal(oldShape.p_plan, 'plus');
  assert.equal(oldShape.p_period_end, new Date(1_800_000_000_000).toISOString());
  const newShape = subscriptionPatch({ id: 'sub_2', customer: { id: 'cus_2' }, status: 'canceled', cancel_at_period_end: true, items: { data: [{ current_period_end: 1_800_000_100, price: { id: 'price_pro' } }] } }, b);
  assert.equal(newShape.p_plan, 'pro');
  assert.equal(newShape.p_customer, 'cus_2');
  assert.equal(newShape.p_user, null);
  assert.equal(newShape.p_cancel, true);
  assert.equal(planForPrice('price_other', b), null);
  assert.equal(planForPrice('price_max', b), 'max');
});

test('passFromSession: ให้สิทธิ์เฉพาะที่จ่ายแล้วและเป็นการซื้อ 30 วัน', () => {
  const paid = { id: 'cs_1', mode: 'payment', payment_status: 'paid', metadata: { kind: 'pass', plan: 'plus', user_id: 'u1' } };
  assert.deepEqual(passFromSession(paid), { p_user: 'u1', p_plan: 'plus', p_days: 30, p_ref: 'cs_1' });
  assert.equal(passFromSession({ ...paid, payment_status: 'unpaid' }), null);
  assert.equal(passFromSession({ ...paid, mode: 'subscription' }), null);
  assert.equal(passFromSession({ ...paid, metadata: { ...paid.metadata, plan: 'free' } }), null);
});

// ---------- endpoint (จำลอง fetch) ----------
function setupEnv() {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x',
    OPENROUTER_API_KEY: 'or-key', DT_MODEL: 'openai/luna', DT_ALLOWED_ORIGINS: 'https://cthugha18881.github.io',
    DT_SITE_URL: 'https://cthugha18881.github.io/novel-reader/', ...BILLING_ENV
  });
}

function mockFetch({ profile = { customerId: null, subStatus: null }, subscription = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return reply(200, { id: 'u1', email: 'a@b.c' });
    if (u.endsWith('/rpc/dt_billing_profile')) return reply(200, profile);
    if (u.includes('/rpc/')) return reply(200, { ok: true });
    if (u === 'https://api.stripe.com/v1/checkout/sessions') return reply(200, { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
    if (u === 'https://api.stripe.com/v1/billing_portal/sessions') return reply(200, { url: 'https://billing.stripe.com/p/session/x' });
    if (u.startsWith('https://api.stripe.com/v1/subscriptions/')) return reply(200, subscription);
    return reply(404, {});
  };
  return calls;
}

const appRequest = (path, body) => new Request(`https://api.example${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://cthugha18881.github.io', Authorization: 'Bearer user-jwt' },
  body: JSON.stringify(body)
});

test('checkout: สร้างหน้าชำระเงินด้วย secret key ของเซิร์ฟเวอร์', async () => {
  setupEnv();
  const calls = mockFetch();
  const { POST } = await import('../api/billing/checkout.js');
  const res = await POST(appRequest('/api/billing/checkout', { plan: 'plus', method: 'promptpay' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, 'https://checkout.stripe.com/c/pay/cs_1');
  const stripe = calls.find(c => c.url.endsWith('/checkout/sessions'));
  assert.equal(stripe.init.headers.Authorization, 'Bearer sk_test_abc');
  assert.match(decodeURIComponent(stripe.init.body), /payment_method_types\[0\]=promptpay/);
  assert.match(decodeURIComponent(stripe.init.body), /metadata\[user_id\]=u1/);
});

test('checkout: สมัครรายเดือนซ้ำ -> 409 / แพ็กเกจผิด -> 400 / ยังไม่ตั้ง Stripe -> 503', async () => {
  setupEnv();
  mockFetch({ profile: { customerId: 'cus_1', subStatus: 'active' } });
  const { POST } = await import('../api/billing/checkout.js');
  assert.equal((await POST(appRequest('/api/billing/checkout', { plan: 'pro', method: 'card' }))).status, 409);
  assert.equal((await POST(appRequest('/api/billing/checkout', { plan: 'gold', method: 'card' }))).status, 400);
  delete process.env.STRIPE_SECRET_KEY;
  const res = await POST(appRequest('/api/billing/checkout', { plan: 'plus', method: 'card' }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.type, 'config');
});

test('portal: ไม่มีประวัติการชำระเงิน -> 404 / มี -> url', async () => {
  setupEnv();
  mockFetch();
  const { POST } = await import('../api/billing/portal.js');
  assert.equal((await POST(appRequest('/api/billing/portal', {}))).status, 404);
  mockFetch({ profile: { customerId: 'cus_1' } });
  const res = await POST(appRequest('/api/billing/portal', {}));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, 'https://billing.stripe.com/p/session/x');
});

function webhookRequest(event, { secret = 'whsec_test' } = {}) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  return new Request('https://api.example/api/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': sign(body, secret, t) }, body });
}

test('webhook: ลายเซ็นผิด -> 400 ไม่แตะฐานข้อมูล', async () => {
  setupEnv();
  const calls = mockFetch();
  const { POST } = await import('../api/billing/webhook.js');
  const res = await POST(webhookRequest({ type: 'checkout.session.completed', data: { object: {} } }, { secret: 'whsec_wrong' }));
  assert.equal(res.status, 400);
  assert.ok(!calls.some(c => c.url.includes('/rpc/')));
});

test('webhook: จ่าย PromptPay สำเร็จ -> ผูก customer + ให้สิทธิ์ 30 วัน', async () => {
  setupEnv();
  const calls = mockFetch();
  const { POST } = await import('../api/billing/webhook.js');
  const session = { id: 'cs_9', mode: 'payment', payment_status: 'paid', customer: 'cus_9', client_reference_id: 'u1', metadata: { kind: 'pass', plan: 'pro', user_id: 'u1' } };
  const res = await POST(webhookRequest({ type: 'checkout.session.completed', data: { object: session } }));
  assert.equal(res.status, 200);
  const grant = calls.find(c => c.url.endsWith('/rpc/dt_billing_grant_pass'));
  assert.deepEqual(JSON.parse(grant.init.body), { p_user: 'u1', p_plan: 'pro', p_days: 30, p_ref: 'cs_9' });
  assert.ok(calls.some(c => c.url.endsWith('/rpc/dt_billing_set_customer')));
});

test('webhook: PromptPay ยังไม่ได้เงิน -> ไม่ให้สิทธิ์ / สมัครรายเดือน -> บันทึก subscription', async () => {
  setupEnv();
  let calls = mockFetch();
  const { POST } = await import('../api/billing/webhook.js');
  await POST(webhookRequest({ type: 'checkout.session.completed', data: { object: { id: 'cs_2', mode: 'payment', payment_status: 'unpaid', metadata: { kind: 'pass', plan: 'plus', user_id: 'u1' } } } }));
  assert.ok(!calls.some(c => c.url.endsWith('/rpc/dt_billing_grant_pass')));

  const sub = { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1_900_000_000, metadata: { user_id: 'u1', plan: 'plus' }, items: { data: [{ price: { id: 'price_plus' } }] } };
  calls = mockFetch({ subscription: sub });
  await POST(webhookRequest({ type: 'checkout.session.completed', data: { object: { id: 'cs_3', mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', metadata: { user_id: 'u1', plan: 'plus', kind: 'subscription' } } } }));
  const apply = calls.find(c => c.url.endsWith('/rpc/dt_billing_apply_subscription'));
  const args = JSON.parse(apply.init.body);
  assert.equal(args.p_user, 'u1');
  assert.equal(args.p_plan, 'plus');
  assert.equal(args.p_status, 'active');
});

test('webhook: ยกเลิกการสมัคร -> บันทึกสถานะ canceled / event อื่นตอบ 200', async () => {
  setupEnv();
  const calls = mockFetch();
  const { POST } = await import('../api/billing/webhook.js');
  const res = await POST(webhookRequest({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', items: { data: [{ price: { id: 'price_pro' } }] } } } }));
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(calls.find(c => c.url.endsWith('/rpc/dt_billing_apply_subscription')).init.body).p_status, 'canceled');
  assert.equal((await POST(webhookRequest({ type: 'invoice.created', data: { object: {} } }))).status, 200);
});

test('prices: ปิดรับชำระเงิน -> enabled false พร้อมราคาตั้งต้น ไม่เรียก Stripe', async () => {
  setupEnv();
  delete process.env.STRIPE_SECRET_KEY;
  const calls = mockFetch();
  const { GET, resetPriceCache } = await import('../api/billing/prices.js');
  resetPriceCache();
  const data = await (await GET(new Request('https://api.example/api/billing/prices', { headers: { Origin: 'https://cthugha18881.github.io' } }))).json();
  assert.equal(data.enabled, false);
  assert.deepEqual(data.plans.max, { monthlyThb: 299, passThb: 299 });
  assert.ok(!calls.some(c => c.url.startsWith('https://api.stripe.com/')));
});

test('prices: อ่านราคารายเดือนจาก Stripe (บาท) และจำไว้ ไม่เรียกซ้ำ', async () => {
  setupEnv();
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const id = String(url).split('/').pop();
    const amounts = { price_plus: 6900, price_pro: 17900, price_max: 29900 };
    return new Response(JSON.stringify({ id, currency: 'thb', unit_amount: amounts[id] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const { GET, resetPriceCache } = await import('../api/billing/prices.js');
  resetPriceCache();
  const req = () => new Request('https://api.example/api/billing/prices', { headers: { Origin: 'https://cthugha18881.github.io' } });
  const res = await GET(req());
  const data = await res.json();
  assert.equal(data.enabled, true);
  assert.equal(data.testMode, true);
  assert.equal(data.plans.plus.monthlyThb, 69);
  assert.equal(data.plans.plus.passThb, 59);
  assert.equal(data.plans.max.monthlyThb, 299);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://cthugha18881.github.io');
  await GET(req());
  assert.equal(calls.length, 3);
});
test('portal: flow ยกเลิก/เปลี่ยนแพ็กเกจ เปิดหน้าเฉพาะของการสมัครที่ใช้อยู่ แล้วกลับมาที่แอพ', async () => {
  const { buildPortalParams } = await import('../api/billing/portal.js');
  const plain = buildPortalParams({ customerId: 'cus_1', siteUrl: 'https://site/app/?x=1' });
  assert.equal(plain.return_url, 'https://site/app/');
  assert.equal(plain.flow_data, undefined);
  const cancel = buildPortalParams({ customerId: 'cus_1', siteUrl: 'https://site/app/', flow: 'cancel', subscriptionId: 'sub_1' });
  assert.equal(cancel.flow_data.type, 'subscription_cancel');
  assert.equal(cancel.flow_data.subscription_cancel.subscription, 'sub_1');
  assert.equal(cancel.flow_data.after_completion.redirect.return_url, 'https://site/app/?billing=updated');
  const update = buildPortalParams({ customerId: 'cus_1', siteUrl: 'https://site/app/', flow: 'update', subscriptionId: 'sub_1' });
  assert.equal(update.flow_data.type, 'subscription_update');
  assert.equal(buildPortalParams({ customerId: 'cus_1', siteUrl: 'x', flow: 'cancel' }).flow_data, undefined);

  setupEnv();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const reply = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return reply({ id: 'u1' });
    if (u.endsWith('/rpc/dt_billing_profile')) return reply({ customerId: 'cus_1', subStatus: 'active' });
    if (u.startsWith('https://api.stripe.com/v1/subscriptions?')) return reply({ data: [{ id: 'sub_old', status: 'canceled' }, { id: 'sub_9', status: 'active', cancel_at_period_end: false }] });
    if (u.endsWith('/billing_portal/sessions')) return reply({ url: 'https://billing.stripe.com/p/session/y' });
    return new Response('{}', { status: 404 });
  };
  const { POST } = await import('../api/billing/portal.js');
  const res = await POST(appRequest('/api/billing/portal', { flow: 'cancel' }));
  assert.equal(res.status, 200);
  const sent = decodeURIComponent(calls.find(c => c.url.endsWith('/billing_portal/sessions')).init.body);
  assert.match(sent, /flow_data\[type\]=subscription_cancel/);
  assert.match(sent, /flow_data\[subscription_cancel\]\[subscription\]=sub_9/);
});
test('ยกเลิกรอสิ้นรอบ: รองรับทั้ง cancel_at_period_end (รุ่นเก่า) และ cancel_at (หน้า portal รุ่นใหม่)', () => {
  const b = readBillingEnv(BILLING_ENV);
  assert.equal(isSubscriptionCanceling({ status: 'active', cancel_at_period_end: true }), true);
  assert.equal(isSubscriptionCanceling({ status: 'active', cancel_at_period_end: false, cancel_at: 1_900_000_000 }), true);
  assert.equal(isSubscriptionCanceling({ status: 'active', cancel_at_period_end: false, cancel_at: null }), false);
  assert.equal(isSubscriptionCanceling({ status: 'canceled', cancel_at: 1_900_000_000 }), false);
  const patch = subscriptionPatch({ id: 'sub_1', status: 'active', cancel_at: 1_900_000_000, cancel_at_period_end: false, items: { data: [{ current_period_end: 1_900_000_000, price: { id: 'price_max' } }] } }, b);
  assert.equal(patch.p_cancel, true);
  assert.equal(patch.p_plan, 'max');
});

test('sync: ดึงการสมัครที่ใช้งานอยู่จาก Stripe มาบันทึก (ไม่รอ webhook)', async () => {
  const { pickSubscription } = await import('../api/billing/sync.js');
  assert.equal(pickSubscription([{ id: 'a', status: 'canceled', created: 5 }, { id: 'b', status: 'active', created: 1 }]).id, 'b');
  assert.equal(pickSubscription([{ id: 'a', status: 'canceled', created: 1 }, { id: 'c', status: 'canceled', created: 9 }]).id, 'c');
  assert.equal(pickSubscription([]), null);

  setupEnv();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const reply = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return reply({ id: 'u1' });
    if (u.endsWith('/rpc/dt_billing_profile')) return reply({ customerId: 'cus_1', subStatus: 'active' });
    if (u.startsWith('https://api.stripe.com/v1/subscriptions?')) return reply({ data: [{ id: 'sub_9', status: 'active', cancel_at: 1_900_000_000, customer: 'cus_1', items: { data: [{ current_period_end: 1_900_000_000, price: { id: 'price_max' } }] } }] });
    if (u.includes('/rpc/')) return reply({ ok: true });
    return new Response('{}', { status: 404 });
  };
  const { POST } = await import('../api/billing/sync.js');
  const res = await POST(appRequest('/api/billing/sync', {}));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).synced, true);
  const args = JSON.parse(calls.find(c => c.url.endsWith('/rpc/dt_billing_apply_subscription')).init.body);
  assert.equal(args.p_user, 'u1');
  assert.equal(args.p_cancel, true);
  assert.equal(args.p_plan, 'max');
});