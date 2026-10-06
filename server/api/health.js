// GET /api/health — เช็กว่าเซิร์ฟเวอร์ตั้งค่าครบหรือยัง (บอกแค่ชื่อค่าที่ขาด ไม่เปิดเผยค่าลับ)
import { json, prepare, preflight } from '../lib/http.js';

export function OPTIONS(request) {
  return preflight(request);
}

export function GET(request) {
  const { env, cors } = prepare(request);
  return json(200, {
    ok: env.missing.length === 0,
    missing: env.missing,
    modelConfigured: !!env.model,
    allowedOrigins: env.allowedOrigins
  }, cors.headers);
}
