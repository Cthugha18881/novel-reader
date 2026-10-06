// POST /api/v1/chat/completions — แปลด้วย AI ของ Dusktale (รูปแบบเดียวกับ OpenAI)
// ลำดับ: ตรวจ origin -> ตรวจผู้ใช้ -> ตรวจคำขอ -> จองโควตา -> เรียก OpenRouter -> ปรับโควตาเป็นยอดจริง
// ไม่บันทึกเนื้อหาของคำขอ/คำตอบ เก็บแค่จำนวน token และค่าใช้จ่าย
import { LIMITS, validateChatBody, estimateTokens, reservationTokens, buildUpstreamBody, usageFromResponse, mapUpstreamError, quotaExceededMessage } from '../../../lib/core.js';
import { json, apiError, prepare, preflight, getUser, rpc } from '../../../lib/http.js';

export function OPTIONS(request) {
  return preflight(request);
}

export async function POST(request) {
  const { env, cors } = prepare(request);
  if (!cors.allowed) return apiError(403, 'origin นี้ไม่ได้รับอนุญาต', 'forbidden', cors.headers);
  if (env.missing.length) return apiError(503, 'บริการแปลของ Dusktale ยังตั้งค่าไม่ครบ', 'config', cors.headers);

  const user = await getUser(env, request);
  if (!user) return apiError(401, 'กรุณาเข้าสู่ระบบ Dusktale ใหม่ (session หมดอายุ)', 'auth', cors.headers);

  const size = Number(request.headers.get('content-length') || 0);
  if (size > LIMITS.maxBodyBytes) return apiError(413, 'คำขอใหญ่เกินไป', 'bad_request', cors.headers);
  let body;
  try { body = await request.json(); } catch { return apiError(400, 'อ่านคำขอไม่ได้ (ต้องเป็น JSON)', 'bad_request', cors.headers); }
  const req = validateChatBody(body);
  if (!req.ok) return apiError(400, req.error, 'bad_request', cors.headers);

  // จองโควตาแบบ atomic ในฐานข้อมูล (กันกดแปลพร้อมกันหลายแท็บจนเกินโควตา)
  let reserve;
  try {
    reserve = await rpc(env, 'dt_reserve', { p_user: user.id, p_tokens: reservationTokens(estimateTokens(req.messages), req.maxTokens), p_model: env.model });
  } catch (err) {
    console.error('reserve failed', err.message);
    return apiError(503, 'ระบบโควตาขัดข้องชั่วคราว ลองใหม่อีกครั้ง', 'server', cors.headers);
  }
  if (!reserve?.ok) {
    if (reserve?.reason === 'busy') return apiError(429, 'ส่งคำขอพร้อมกันมากเกินไป รอสักครู่แล้วลองใหม่', 'rate', cors.headers);
    return apiError(402, quotaExceededMessage(reserve || {}), 'quota', cors.headers);
  }
  const maxTokens = Math.min(req.maxTokens, reserve.max_output || LIMITS.maxOutputTokens);

  let upstream, data;
  try {
    upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': env.siteUrl,
        'X-Title': 'Dusktale'
      },
      body: JSON.stringify(buildUpstreamBody({ ...req, maxTokens }, { model: env.model, reasoning: env.reasoning })),
      signal: request.signal
    });
    data = await upstream.json().catch(() => ({}));
  } catch (err) {
    await rpc(env, 'dt_settle', { p_id: reserve.id, p_status: 'failed', p_input: 0, p_output: 0, p_cost: null }).catch(() => {});
    return apiError(502, 'เชื่อมต่อเซิร์ฟเวอร์ AI ไม่ได้ ลองใหม่อีกครั้ง', 'network', cors.headers);
  }

  if (!upstream.ok) {
    await rpc(env, 'dt_settle', { p_id: reserve.id, p_status: 'failed', p_input: 0, p_output: 0, p_cost: null }).catch(() => {});
    console.error('upstream error', upstream.status, data?.error?.message);
    const mapped = mapUpstreamError(upstream.status, data?.error?.message);
    return apiError(mapped.status, mapped.message, 'upstream', cors.headers);
  }

  const usage = usageFromResponse(data);
  let settled = null;
  try {
    settled = await rpc(env, 'dt_settle', { p_id: reserve.id, p_status: 'done', p_input: usage.input, p_output: usage.output, p_cost: usage.cost });
  } catch (err) {
    console.error('settle failed', err.message);
  }
  const headers = { ...cors.headers };
  if (settled?.used !== undefined) headers['X-Dusktale-Used'] = String(settled.used);
  if (settled?.limit !== undefined) headers['X-Dusktale-Limit'] = String(settled.limit);
  return json(200, data, headers);
}
