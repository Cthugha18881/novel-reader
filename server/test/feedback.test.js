// ทดสอบส่งความเห็นจากในแอพ (จำลอง Supabase)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFeedback, FEEDBACK_LIMITS } from '../lib/feedback.js';

test('validateFeedback: ข้อความ หมวด และข้อมูลวินิจฉัย', () => {
  const ok = validateFeedback({ category: 'bug', message: '  แปลไม่ได้  ', diagnostics: { version: 'v3' } });
  assert.deepEqual(ok, { ok: true, category: 'bug', message: 'แปลไม่ได้', diagnostics: { version: 'v3' } });
  assert.equal(validateFeedback({ category: 'weird', message: 'abc' }).category, 'other');
  assert.equal(validateFeedback({ message: 'ab' }).ok, false);
  assert.equal(validateFeedback({ message: 'x'.repeat(FEEDBACK_LIMITS.message + 1) }).ok, false);
  assert.equal(validateFeedback({ message: 'abc', diagnostics: { big: 'x'.repeat(FEEDBACK_LIMITS.diagnosticsChars) } }).ok, false);
  assert.equal(validateFeedback({ message: 'abc', diagnostics: [1, 2] }).diagnostics, null);
  assert.equal(validateFeedback(null).ok, false);
});

function setupEnv() {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x',
    OPENROUTER_API_KEY: 'or-key', DT_MODEL: 'openai/luna', DT_ALLOWED_ORIGINS: 'https://cthugha18881.github.io'
  });
}

function mockFetch(addReply) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const reply = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return reply({ id: 'u1', email: 'a@b.c' });
    if (u.endsWith('/rpc/dt_feedback_add')) return reply(addReply);
    return new Response('{}', { status: 404 });
  };
  return calls;
}

const req = (body, token = 'jwt') => new Request('https://api.example/api/feedback', {
  method: 'POST',
  headers: { Origin: 'https://cthugha18881.github.io', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body)
});

test('feedback: บันทึกพร้อมอีเมลของผู้ส่ง / เกินวันละ 20 -> 429 / ไม่เข้าสู่ระบบ -> 401', async () => {
  setupEnv();
  let calls = mockFetch({ ok: true, id: 5 });
  const { POST } = await import('../api/feedback.js');
  const res = await POST(req({ category: 'idea', message: 'อยากได้โหมดกลางคืน' }));
  assert.equal(res.status, 200);
  const sent = JSON.parse(calls.find(c => c.url.endsWith('/rpc/dt_feedback_add')).init.body);
  assert.equal(sent.p_user, 'u1');
  assert.equal(sent.p_email, 'a@b.c');
  assert.equal(sent.p_category, 'idea');
  mockFetch({ ok: false, reason: 'rate' });
  assert.equal((await POST(req({ message: 'อีกเรื่อง' }))).status, 429);
  calls = mockFetch({ ok: true });
  assert.equal((await POST(req({ message: 'x' }))).status, 400);
  assert.equal((await POST(req({ message: 'ไม่มี token' }, ''))).status, 401);
});
