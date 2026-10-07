// GET /api/sync/status — พื้นที่ที่ใช้ จำนวนรายการ และสิทธิ์ซิงก์ของแพ็กเกจปัจจุบัน
import { json, apiError, prepare, preflight, getUser, rpc } from '../../lib/http.js';

export function OPTIONS(request) {
  return preflight(request);
}

export async function GET(request) {
  const { env, cors } = prepare(request);
  if (!cors.allowed) return apiError(403, 'origin นี้ไม่ได้รับอนุญาต', 'forbidden', cors.headers);
  if (!env.supabaseUrl || !env.serviceKey) return apiError(503, 'ระบบซิงก์ยังไม่พร้อม', 'config', cors.headers);
  const user = await getUser(env, request);
  if (!user) return apiError(401, 'กรุณาเข้าสู่ระบบ Dusktale ใหม่', 'auth', cors.headers);
  try {
    const s = await rpc(env, 'dt_sync_status', { p_user: user.id });
    return json(200, {
      enabled: !!s?.enabled, used: Number(s?.used) || 0, limit: Number(s?.limit) || 0,
      count: Number(s?.count) || 0, seq: Number(s?.seq) || 0, lastAt: s?.lastAt || null
    }, cors.headers);
  } catch (err) {
    console.error('sync status failed', err.message);
    return apiError(503, 'อ่านสถานะซิงก์ไม่ได้ชั่วคราว', 'server', cors.headers);
  }
}
