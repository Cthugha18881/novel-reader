// ทดสอบเซิร์ฟเวอร์โดยไม่ต่ออินเทอร์เน็ต: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, parseAllowedOrigins, isOriginAllowed, corsHeaders, bearerToken, validateChatBody, estimateTokens,
  reservationTokens, buildUpstreamBody, usageFromResponse, mapUpstreamError, quotaExceededMessage, readEnv, serviceHeaders
} from '../lib/core.js';

test('origins: ค่าเริ่มต้น GitHub Pages + localhost เท่านั้น', () => {
  const allowed = parseAllowedOrigins('');
  assert.deepEqual(allowed, ['https://cthugha18881.github.io']);
  assert.ok(isOriginAllowed('https://cthugha18881.github.io', allowed));
  assert.ok(isOriginAllowed('http://localhost:8765', allowed));
  assert.ok(!isOriginAllowed('https://evil.example', allowed));
  assert.ok(!isOriginAllowed('', allowed));
  assert.deepEqual(parseAllowedOrigins('https://a.com/, https://b.com'), ['https://a.com', 'https://b.com']);
  assert.equal(corsHeaders('https://evil.example', allowed).headers['Access-Control-Allow-Origin'], undefined);
});

test('bearerToken', () => {
  assert.equal(bearerToken('Bearer abc.def'), 'abc.def');
  assert.equal(bearerToken('bearer x'), 'x');
  assert.equal(bearerToken(''), '');
  assert.equal(bearerToken('Basic x'), '');
});

test('validateChatBody: เก็บเฉพาะช่องที่อนุญาต จำกัด max_tokens', () => {
  const r = validateChatBody({ model: 'anything', messages: [{ role: 'system', content: 's', extra: 1 }, { role: 'user', content: 'u' }], max_tokens: 99999, temperature: 5, response_format: { type: 'json_object' }, tools: [1] });
  assert.ok(r.ok);
  assert.deepEqual(r.messages, [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]);
  assert.equal(r.maxTokens, LIMITS.maxOutputTokens);
  assert.equal(r.temperature, 2);
  assert.deepEqual(r.responseFormat, { type: 'json_object' });
  assert.equal(validateChatBody({ messages: [] }).ok, false);
  assert.equal(validateChatBody({ messages: [{ role: 'tool', content: 'x' }] }).ok, false);
  assert.equal(validateChatBody({ messages: [{ role: 'user', content: 'x'.repeat(LIMITS.maxPromptChars + 1) }] }).ok, false);
  assert.equal(validateChatBody(null).ok, false);
  assert.equal(validateChatBody({ messages: [{ role: 'user', content: 'x' }], max_completion_tokens: 500 }).maxTokens, 500);
});

test('estimateTokens / reservationTokens', () => {
  const zh = estimateTokens([{ role: 'user', content: '林动走了过来' }]);
  const en = estimateTokens([{ role: 'user', content: 'abcdef' }]);
  assert.ok(zh > en);
  assert.equal(reservationTokens(1000, 16384), 1000 + 4000);
  assert.equal(reservationTokens(10000, 16384), 10000 + 16384);
});

test('buildUpstreamBody: ใช้โมเดลของเซิร์ฟเวอร์เสมอ ขอยอด cost', () => {
  const req = validateChatBody({ model: 'gpt-expensive', messages: [{ role: 'user', content: 'x' }], max_tokens: 100 });
  const b = buildUpstreamBody(req, { model: 'server/model', reasoning: 'none' });
  assert.equal(b.model, 'server/model');
  assert.equal(b.max_tokens, 100);
  assert.deepEqual(b.usage, { include: true });
  assert.deepEqual(b.reasoning, { effort: 'none' });
  assert.equal(buildUpstreamBody(req, { model: 'm', reasoning: 'default' }).reasoning, undefined);
});

test('usageFromResponse / mapUpstreamError / quotaExceededMessage', () => {
  assert.deepEqual(usageFromResponse({ usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.0012 } }), { input: 10, output: 20, cost: 0.0012 });
  assert.deepEqual(usageFromResponse({}), { input: 0, output: 0, cost: null });
  assert.equal(mapUpstreamError(402).status, 503);      // เครดิตของเซิร์ฟเวอร์หมด ไม่ใช่โควตาผู้ใช้
  assert.equal(mapUpstreamError(429).status, 429);
  assert.equal(mapUpstreamError(400, 'response_format not supported').message, 'response_format not supported');
  assert.equal(mapUpstreamError(500).status, 502);
  assert.match(quotaExceededMessage({ used: 400000, limit: 400000 }), /400K จาก 400K/);
});

test('readEnv / serviceHeaders', () => {
  const env = readEnv({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_ANON_KEY: 'a' });
  assert.equal(env.supabaseUrl, 'https://x.supabase.co');
  assert.deepEqual(env.missing, ['SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY', 'DT_MODEL']);
  assert.equal(serviceHeaders('sb_secret_abc').Authorization, undefined);
  assert.equal(serviceHeaders('eyJhbGc').Authorization, 'Bearer eyJhbGc');
});

// ---------- ทั้งเส้นทางของ /api/v1/chat/completions (จำลอง Supabase และ OpenRouter) ----------
function setupEnv() {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x',
    OPENROUTER_API_KEY: 'or-key', DT_MODEL: 'openai/luna', DT_ALLOWED_ORIGINS: 'https://cthugha18881.github.io'
  });
}

function mockFetch({ user = { id: 'u1', email: 'a@b.c' }, reserve = { ok: true, id: 7, used: 0, limit: 400000, max_output: 16384 }, upstreamStatus = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const body = init.body ? JSON.parse(init.body) : null;
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (String(url).endsWith('/auth/v1/user')) return user ? reply(200, user) : reply(401, { msg: 'bad jwt' });
    if (String(url).endsWith('/rpc/dt_reserve')) return reply(200, reserve);
    if (String(url).endsWith('/rpc/dt_settle')) return reply(200, { ok: true, used: 1234, limit: 400000, args: body });
    if (String(url).startsWith('https://openrouter.ai/')) {
      if (upstreamStatus !== 200) return reply(upstreamStatus, { error: { message: 'upstream says no' } });
      return reply(200, { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0001 } });
    }
    return reply(404, {});
  };
  return calls;
}

function chatRequest(body, { token = 'user-jwt', origin = 'https://cthugha18881.github.io' } = {}) {
  return new Request('https://api.example/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
}

const BODY = { model: 'whatever', messages: [{ role: 'user', content: 'แปล 林动' }], max_tokens: 2000 };

test('chat: สำเร็จ -> จอง ส่งไป OpenRouter ด้วยโมเดลของเซิร์ฟเวอร์ แล้วปรับยอดจริง', async () => {
  setupEnv();
  const calls = mockFetch();
  const { POST } = await import('../api/v1/chat/completions.js');
  const res = await POST(chatRequest(BODY));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://cthugha18881.github.io');
  assert.equal(res.headers.get('X-Dusktale-Used'), '1234');
  const upstream = calls.find(c => c.url.startsWith('https://openrouter.ai/'));
  const sent = JSON.parse(upstream.init.body);
  assert.equal(sent.model, 'openai/luna');
  assert.equal(sent.max_tokens, 2000);
  assert.equal(upstream.init.headers.Authorization, 'Bearer or-key');
  const settle = calls.find(c => c.url.endsWith('/rpc/dt_settle'));
  assert.deepEqual(JSON.parse(settle.init.body), { p_id: 7, p_status: 'done', p_input: 100, p_output: 50, p_cost: 0.0001 });
  const data = await res.json();
  assert.equal(data.choices[0].message.content, '{"ok":true}');
});

test('chat: ไม่มี token -> 401 ไม่เรียก OpenRouter', async () => {
  setupEnv();
  const calls = mockFetch();
  const { POST } = await import('../api/v1/chat/completions.js');
  const res = await POST(chatRequest(BODY, { token: '' }));
  assert.equal(res.status, 401);
  assert.ok(!calls.some(c => c.url.startsWith('https://openrouter.ai/')));
});

test('chat: origin อื่น -> 403', async () => {
  setupEnv();
  mockFetch();
  const { POST } = await import('../api/v1/chat/completions.js');
  assert.equal((await POST(chatRequest(BODY, { origin: 'https://evil.example' }))).status, 403);
});

test('chat: โควตาหมด -> 402 พร้อมข้อความภาษาไทย', async () => {
  setupEnv();
  const calls = mockFetch({ reserve: { ok: false, reason: 'quota', used: 400000, limit: 400000 } });
  const { POST } = await import('../api/v1/chat/completions.js');
  const res = await POST(chatRequest(BODY));
  assert.equal(res.status, 402);
  const data = await res.json();
  assert.equal(data.error.type, 'quota');
  assert.match(data.error.message, /โควตา/);
  assert.ok(!calls.some(c => c.url.startsWith('https://openrouter.ai/')));
});

test('chat: เรียกพร้อมกันมากเกิน -> 429', async () => {
  setupEnv();
  mockFetch({ reserve: { ok: false, reason: 'busy' } });
  const { POST } = await import('../api/v1/chat/completions.js');
  assert.equal((await POST(chatRequest(BODY))).status, 429);
});

test('chat: OpenRouter เครดิตหมด (402) -> 503 และคืนโควตา (failed)', async () => {
  setupEnv();
  const calls = mockFetch({ upstreamStatus: 402 });
  const { POST } = await import('../api/v1/chat/completions.js');
  const res = await POST(chatRequest(BODY));
  assert.equal(res.status, 503);
  const settle = calls.find(c => c.url.endsWith('/rpc/dt_settle'));
  assert.equal(JSON.parse(settle.init.body).p_status, 'failed');
});

test('chat: คำขอผิดรูปแบบ -> 400 ไม่จองโควตา', async () => {
  setupEnv();
  const calls = mockFetch();
  const { POST } = await import('../api/v1/chat/completions.js');
  const res = await POST(chatRequest({ messages: 'not-an-array' }));
  assert.equal(res.status, 400);
  assert.ok(!calls.some(c => c.url.endsWith('/rpc/dt_reserve')));
});

test('health: บอกค่าที่ขาด ไม่เปิดเผยค่าลับ', async () => {
  for (const k of ['OPENROUTER_API_KEY', 'DT_MODEL']) delete process.env[k];
  const { GET } = await import('../api/health.js');
  const data = await (await GET(new Request('https://api.example/api/health', { headers: { Origin: 'https://cthugha18881.github.io' } }))).json();
  assert.equal(data.ok, false);
  assert.deepEqual(data.missing, ['OPENROUTER_API_KEY', 'DT_MODEL']);
  assert.ok(!JSON.stringify(data).includes('sb_secret_x'));
});
