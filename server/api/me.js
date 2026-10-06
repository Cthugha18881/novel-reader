// GET /api/me — แพ็กเกจและโควตาที่ใช้ไปของเดือนนี้ (แสดงในหน้าตั้งค่าของแอพ)
import { json, apiError, prepare, preflight, getUser, rpc } from '../lib/http.js';

export function OPTIONS(request) {
  return preflight(request);
}

export async function GET(request) {
  const { env, cors } = prepare(request);
  if (!cors.allowed) return apiError(403, 'origin นี้ไม่ได้รับอนุญาต', 'forbidden', cors.headers);
  if (env.missing.length) return apiError(503, 'บริการแปลของ Dusktale ยังตั้งค่าไม่ครบ', 'config', cors.headers);
  const user = await getUser(env, request);
  if (!user) return apiError(401, 'กรุณาเข้าสู่ระบบ Dusktale ใหม่ (session หมดอายุ)', 'auth', cors.headers);
  try {
    const summary = await rpc(env, 'dt_usage_summary', { p_user: user.id });
    return json(200, { email: user.email || '', ...summary }, cors.headers);
  } catch (err) {
    console.error('summary failed', err.message);
    return apiError(503, 'อ่านข้อมูลโควตาไม่ได้ชั่วคราว', 'server', cors.headers);
  }
}
