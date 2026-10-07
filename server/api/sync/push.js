// POST /api/sync/push {records: [{key, deleted?, data?}]} — ส่งรายการที่เปลี่ยนขึ้นคลาวด์ (Plus ขึ้นไป)
// ฐานข้อมูลตรวจแพ็กเกจและพื้นที่เอง (dt_sync_push) เซิร์ฟเวอร์ไม่อ่านเนื้อหา
import { json, apiError, prepare, preflight, getUser, rpc } from '../../lib/http.js';
import { validatePushBody, syncPushError } from '../../lib/sync.js';

export function OPTIONS(request) {
  return preflight(request);
}

export async function POST(request) {
  const { env, cors } = prepare(request);
  if (!cors.allowed) return apiError(403, 'origin นี้ไม่ได้รับอนุญาต', 'forbidden', cors.headers);
  if (!env.supabaseUrl || !env.serviceKey) return apiError(503, 'ระบบซิงก์ยังไม่พร้อม', 'config', cors.headers);
  const user = await getUser(env, request);
  if (!user) return apiError(401, 'กรุณาเข้าสู่ระบบ Dusktale ใหม่', 'auth', cors.headers);
  const body = await request.json().catch(() => null);
  const req = validatePushBody(body);
  if (!req.ok) return apiError(400, req.error, 'invalid_request', cors.headers);
  try {
    const result = await rpc(env, 'dt_sync_push', { p_user: user.id, p_records: req.records });
    if (!result?.ok) {
      const e = syncPushError(result);
      return json(e.status, { error: { message: e.message, type: e.type }, used: result?.used, limit: result?.limit }, cors.headers);
    }
    return json(200, { ok: true, seq: result.seq, used: result.used, limit: result.limit }, cors.headers);
  } catch (err) {
    console.error('sync push failed', err.message);
    return apiError(503, 'ซิงก์ไม่สำเร็จชั่วคราว ลองใหม่ภายหลัง', 'server', cors.headers);
  }
}
