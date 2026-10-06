// ฟังก์ชันล้วน (ไม่มี I/O) ของเซิร์ฟเวอร์ Dusktale: ตรวจคำขอ, CORS, ประมาณ token, สร้างคำขอไป OpenRouter
// แยกไว้เพื่อทดสอบได้ด้วย node --test โดยไม่ต้องต่ออินเทอร์เน็ต

export const LIMITS = {
  maxOutputTokens: 16384,   // เพดาน token ขาออกต่อคำขอ (พอสำหรับคำแปล 1 ส่วน)
  maxPromptChars: 400000,   // ข้อความรวมทุก message ต่อคำขอ
  maxMessages: 8,
  maxBodyBytes: 2_000_000
};

/** origin ที่อนุญาต: จาก DT_ALLOWED_ORIGINS (คั่นด้วย ,) + localhost สำหรับทดสอบ */
export function parseAllowedOrigins(value) {
  const list = String(value || 'https://cthugha18881.github.io')
    .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
  return [...new Set(list)];
}

export function isOriginAllowed(origin, allowed) {
  if (!origin) return false;
  if (allowed.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function corsHeaders(origin, allowed) {
  const ok = isOriginAllowed(origin, allowed);
  return {
    allowed: ok,
    headers: ok ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Expose-Headers': 'X-Dusktale-Used, X-Dusktale-Limit',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin'
    } : { 'Vary': 'Origin' }
  };
}

export function bearerToken(header) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header || '').trim());
  return m ? m[1] : '';
}

/** ตรวจ body แบบ OpenAI chat completions เก็บเฉพาะช่องที่อนุญาต */
export function validateChatBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'รูปแบบคำขอไม่ถูกต้อง' };
  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, error: 'ต้องมี messages อย่างน้อย 1 รายการ' };
  if (messages.length > LIMITS.maxMessages) return { ok: false, error: `messages ได้ไม่เกิน ${LIMITS.maxMessages} รายการ` };
  let chars = 0;
  const clean = [];
  for (const m of messages) {
    if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') {
      return { ok: false, error: 'message ต้องมี role (system/user/assistant) และ content เป็นข้อความ' };
    }
    chars += m.content.length;
    clean.push({ role: m.role, content: m.content });
  }
  if (chars > LIMITS.maxPromptChars) return { ok: false, error: `ข้อความยาวเกิน ${LIMITS.maxPromptChars.toLocaleString()} ตัวอักษรต่อคำขอ` };

  let responseFormat = null;
  const rf = body.response_format;
  if (rf && typeof rf === 'object') {
    if (rf.type === 'json_object') responseFormat = { type: 'json_object' };
    else if (rf.type === 'json_schema' && rf.json_schema && typeof rf.json_schema === 'object') responseFormat = { type: 'json_schema', json_schema: rf.json_schema };
  }
  const requested = Number(body.max_tokens ?? body.max_completion_tokens);
  const maxTokens = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), LIMITS.maxOutputTokens) : LIMITS.maxOutputTokens;
  const temperature = Number.isFinite(body.temperature) ? Math.min(2, Math.max(0, body.temperature)) : undefined;
  return { ok: true, messages: clean, responseFormat, maxTokens, temperature, chars };
}

/** ประมาณ token ขาเข้าจากความยาวข้อความ (จีน/ญี่ปุ่น/เกาหลี ~1.1 ต่อตัว, ที่เหลือ ~3 ตัวอักษรต่อ token) */
export function estimateTokens(messages) {
  let cjk = 0, other = 0;
  for (const m of messages) {
    for (const ch of m.content) {
      if (/[぀-ヿ㐀-鿿가-힯豈-﫿]/.test(ch)) cjk++;
      else other++;
    }
  }
  return Math.ceil(cjk * 1.1 + other / 3) + 20 * messages.length;
}

/** จองโควตาก่อนเรียก AI: ขาเข้า + ขาออกที่น่าจะใช้ (ไม่เกินเพดานที่ขอ) แล้วค่อยปรับเป็นยอดจริงหลังได้ผล */
export function reservationTokens(inputEstimate, maxOutput) {
  return inputEstimate + Math.min(maxOutput, inputEstimate * 2 + 2000);
}

export function buildUpstreamBody(req, { model, reasoning = 'none' }) {
  const body = { model, messages: req.messages, max_tokens: req.maxTokens, usage: { include: true } };
  if (req.responseFormat) body.response_format = req.responseFormat;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (reasoning && reasoning !== 'default') body.reasoning = { effort: reasoning };
  return body;
}

export function usageFromResponse(data) {
  const u = data?.usage || {};
  const input = Number(u.prompt_tokens) || 0;
  const output = Number(u.completion_tokens) || 0;
  const cost = Number(u.cost);
  return { input, output, cost: Number.isFinite(cost) ? cost : null };
}

/** แปลงข้อผิดพลาดจาก OpenRouter เป็นคำตอบให้แอพ (แอพแยกชนิดจาก status) */
export function mapUpstreamError(status, message) {
  const msg = String(message || '').slice(0, 300);
  // เครดิต/คีย์ของเซิร์ฟเวอร์มีปัญหา: ไม่ใช่โควตาของผู้ใช้ จึงไม่ส่ง 402 กลับไป
  if (status === 402 || status === 401 || status === 403) return { status: 503, message: 'บริการแปลของ Dusktale ขัดข้องชั่วคราว ผู้ดูแลกำลังแก้ไข ลองใหม่ภายหลัง หรือใช้ API Key ของคุณเองก่อน' };
  if (status === 429) return { status: 429, message: 'คิวแปลแน่นชั่วคราว ลองใหม่ในอีกสักครู่' };
  if (status === 400 || status === 404 || status === 413 || status === 422) return { status: 400, message: msg || 'คำขอไม่ถูกต้อง' };
  return { status: 502, message: 'เซิร์ฟเวอร์ AI ตอบกลับผิดปกติ ลองใหม่อีกครั้ง' };
}

export function formatTokens(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
}

export function quotaExceededMessage({ used = 0, limit = 0 } = {}) {
  return `โควตาแปลของเดือนนี้หมดแล้ว (ใช้ไป ${formatTokens(used)} จาก ${formatTokens(limit)} token) ` +
    'รอรอบเดือนใหม่ อัปเกรดแพ็กเกจ หรือใช้ API Key ของคุณเองในหน้าตั้งค่า';
}

/** Project URL ของ Supabase: ตัด /rest/v1 หรือ /auth/v1 ที่คัดลอกติดมา และ / ท้าย */
export function normalizeSupabaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/i, '').replace(/\/+$/, '');
}

/** ค่าตั้งของเซิร์ฟเวอร์จาก environment variables พร้อมรายการที่ยังขาด (ไม่คืนค่าลับออกไป) */
export function readEnv(env) {
  const cfg = {
    supabaseUrl: normalizeSupabaseUrl(env.SUPABASE_URL),
    anonKey: env.SUPABASE_ANON_KEY || '',
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    openrouterKey: env.OPENROUTER_API_KEY || '',
    model: env.DT_MODEL || '',
    reasoning: env.DT_REASONING || 'none',
    allowedOrigins: parseAllowedOrigins(env.DT_ALLOWED_ORIGINS),
    siteUrl: env.DT_SITE_URL || 'https://cthugha18881.github.io/novel-reader/'
  };
  const required = { SUPABASE_URL: cfg.supabaseUrl, SUPABASE_ANON_KEY: cfg.anonKey, SUPABASE_SERVICE_ROLE_KEY: cfg.serviceKey, OPENROUTER_API_KEY: cfg.openrouterKey, DT_MODEL: cfg.model };
  cfg.missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  return cfg;
}

/** header สำหรับเรียก Supabase ด้วยคีย์ฝั่งเซิร์ฟเวอร์ (รองรับทั้งคีย์แบบเก่า JWT และแบบใหม่ sb_secret_) */
export function serviceHeaders(serviceKey) {
  const h = { apikey: serviceKey, 'Content-Type': 'application/json' };
  if (!String(serviceKey).startsWith('sb_secret_')) h.Authorization = `Bearer ${serviceKey}`;
  return h;
}
