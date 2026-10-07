// POST /api/feedback {category, message, diagnostics?} — ความเห็น/แจ้งปัญหาจากในแอพ (ต้องเข้าสู่ระบบ)
import { json, apiError, prepare, preflight, getUser, rpc } from '../lib/http.js';
import { validateFeedback } from '../lib/feedback.js';

export function OPTIONS(request) {
  return preflight(request);
}

export async function POST(request) {
  const { env, cors } = prepare(request);
  if (!cors.allowed) return apiError(403, 'origin นี้ไม่ได้รับอนุญาต', 'forbidden', cors.headers);
  if (!env.supabaseUrl || !env.serviceKey) return apiError(503, 'ส่งความเห็นไม่ได้ชั่วคราว', 'config', cors.headers);
  const user = await getUser(env, request);
  if (!user) return apiError(401, 'กรุณาเข้าสู่ระบบ Dusktale ก่อนส่งความเห็น', 'auth', cors.headers);
  const body = await request.json().catch(() => null);
  const fb = validateFeedback(body);
  if (!fb.ok) return apiError(400, fb.error, 'invalid_request', cors.headers);
  try {
    const r = await rpc(env, 'dt_feedback_add', {
      p_user: user.id, p_email: user.email || '', p_category: fb.category, p_message: fb.message, p_diagnostics: fb.diagnostics
    });
    if (!r?.ok) return apiError(429, 'วันนี้ส่งความเห็นครบจำนวนแล้ว ลองใหม่พรุ่งนี้', 'rate', cors.headers);
    return json(200, { ok: true, id: r.id }, cors.headers);
  } catch (err) {
    console.error('feedback failed', err.message);
    return apiError(503, 'ส่งความเห็นไม่สำเร็จชั่วคราว ลองใหม่ภายหลัง', 'server', cors.headers);
  }
}
