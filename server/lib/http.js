// I/O ของเซิร์ฟเวอร์: ตอบ JSON, ตรวจผู้ใช้กับ Supabase Auth, เรียกฟังก์ชันในฐานข้อมูล (RPC)
import { corsHeaders, bearerToken, readEnv, serviceHeaders } from './core.js';

export function json(status, data, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

/** รูปแบบ error เดียวกับ OpenAI เพื่อให้แอพอ่านข้อความได้เหมือนผู้ให้บริการอื่น */
export function apiError(status, message, type, headers) {
  return json(status, { error: { message, type } }, headers);
}

/** เตรียม env + CORS ของคำขอนี้ */
export function prepare(request) {
  const env = readEnv(process.env);
  const cors = corsHeaders(request.headers.get('origin'), env.allowedOrigins);
  return { env, cors };
}

export function preflight(request) {
  const { cors } = prepare(request);
  return new Response(null, { status: cors.allowed ? 204 : 403, headers: cors.headers });
}

/** ตรวจ access token ของผู้ใช้กับ Supabase Auth คืน user หรือ null */
export async function getUser(env, request) {
  const token = bearerToken(request.headers.get('authorization'));
  if (!token) return null;
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? user : null;
}

/** เรียก Stripe REST API (ไม่ใช้ไลบรารี) คืน JSON หรือโยน error ที่มีข้อความของ Stripe */
export async function stripeRequest(billing, method, path, params = null, { idempotencyKey } = {}) {
  const { formEncode } = await import('./billing.js');
  const headers = { Authorization: `Bearer ${billing.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const query = method === 'GET' && params ? `?${formEncode(params)}` : '';
  const res = await fetch(`https://api.stripe.com/v1${path}${query}`, {
    method, headers, body: method === 'GET' || !params ? undefined : formEncode(params)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function rpc(env, name, args) {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders(env.serviceKey),
    body: JSON.stringify(args)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`rpc ${name} failed (${res.status}): ${data?.message || ''}`);
  return data;
}
