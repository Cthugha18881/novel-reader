// GET /api/sync/pull?since=<seq>&limit=<n> — รายการที่เปลี่ยนหลัง seq ที่เครื่องมีแล้ว
// ดึงได้แม้แพ็กเกจหมดอายุ (ข้อมูลเป็นของผู้ใช้เสมอ)
import { json, apiError, prepare, preflight, getUser, rpc } from '../../lib/http.js';
import { parsePullQuery } from '../../lib/sync.js';

export function OPTIONS(request) {
  return preflight(request);
}

export async function GET(request) {
  const { env, cors } = prepare(request);
  if (!cors.allowed) return apiError(403, 'origin นี้ไม่ได้รับอนุญาต', 'forbidden', cors.headers);
  if (!env.supabaseUrl || !env.serviceKey) return apiError(503, 'ระบบซิงก์ยังไม่พร้อม', 'config', cors.headers);
  const user = await getUser(env, request);
  if (!user) return apiError(401, 'กรุณาเข้าสู่ระบบ Dusktale ใหม่', 'auth', cors.headers);
  const { since, limit } = parsePullQuery(request.url);
  try {
    const result = await rpc(env, 'dt_sync_pull', { p_user: user.id, p_since: since, p_limit: limit });
    return json(200, { records: result?.records || [], next: result?.next ?? since, more: !!result?.more }, cors.headers);
  } catch (err) {
    console.error('sync pull failed', err.message);
    return apiError(503, 'ดึงข้อมูลจากคลาวด์ไม่สำเร็จชั่วคราว ลองใหม่ภายหลัง', 'server', cors.headers);
  }
}
