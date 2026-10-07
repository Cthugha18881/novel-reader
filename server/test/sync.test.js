// ทดสอบซิงก์หลายเครื่องโดยไม่ต่ออินเทอร์เน็ต (จำลอง Supabase)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePushBody, parsePullQuery, syncPushError, SYNC_LIMITS } from '../lib/sync.js';

test('validatePushBody: ตรวจ key/ข้อมูล และตัด key ซ้ำ (เก็บตัวหลังสุด)', () => {
  const r = validatePushBody({ records: [
    { key: 'c:ch1', data: 'z1:aaa' },
    { key: 'g:林动', data: 'z1:bbb' },
    { key: 'c:ch1', data: 'z1:ccc' },
    { key: 'b:bk1', deleted: true, data: 'ignored' }
  ] });
  assert.ok(r.ok);
  assert.deepEqual(r.records, [
    { key: 'c:ch1', deleted: false, data: 'z1:ccc' },
    { key: 'g:林动', deleted: false, data: 'z1:bbb' },
    { key: 'b:bk1', deleted: true }
  ]);
  assert.equal(validatePushBody({ records: [] }).ok, false);
  assert.equal(validatePushBody(null).ok, false);
  assert.equal(validatePushBody({ records: [{ key: 'x:1', data: 'a' }] }).ok, false);
  assert.equal(validatePushBody({ records: [{ key: 'c:', data: 'a' }] }).ok, false);
  assert.equal(validatePushBody({ records: [{ key: 'c:1' }] }).ok, false);
  assert.equal(validatePushBody({ records: [{ key: 'c:1', data: 'x'.repeat(SYNC_LIMITS.maxRecordChars + 1) }] }).ok, false);
  assert.equal(validatePushBody({ records: Array.from({ length: SYNC_LIMITS.maxRecords + 1 }, (_, i) => ({ key: `c:${i}`, data: 'a' })) }).ok, false);
  assert.equal(validatePushBody({ records: [{ key: 'c:1', data: 'x'.repeat(2_500_000) }, { key: 'c:2', data: 'x'.repeat(2_500_000) }] }).ok, false);
});

test('parsePullQuery / syncPushError', () => {
  assert.deepEqual(parsePullQuery('https://a/api/sync/pull?since=42&limit=50'), { since: 42, limit: 50 });
  assert.deepEqual(parsePullQuery('https://a/api/sync/pull?since=-1&limit=9999'), { since: 0, limit: 200 });
  assert.deepEqual(parsePullQuery('https://a/api/sync/pull'), { since: 0, limit: SYNC_LIMITS.pullLimit });
  assert.equal(syncPushError({ reason: 'plan' }).status, 403);
  const storage = syncPushError({ reason: 'storage', used: 100 * 1048576, limit: 100 * 1048576 });
  assert.equal(storage.status, 413);
  assert.match(storage.message, /100 จาก 100 MB/);
});

function setupEnv() {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x',
    OPENROUTER_API_KEY: 'or-key', DT_MODEL: 'openai/luna', DT_ALLOWED_ORIGINS: 'https://cthugha18881.github.io'
  });
}

function mockFetch(rpcReplies) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const reply = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return reply({ id: 'u1' });
    const name = u.split('/rpc/')[1];
    if (name && rpcReplies[name]) return reply(rpcReplies[name](init.body ? JSON.parse(init.body) : null));
    return new Response('{}', { status: 404 });
  };
  return calls;
}

const req = (method, path, body, token = 'jwt') => new Request(`https://api.example${path}`, {
  method,
  headers: { Origin: 'https://cthugha18881.github.io', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
});

test('push: ส่งรายการไปที่ฐานข้อมูลของผู้ใช้คนนั้น / แพ็กเกจไม่มีซิงก์ -> 403 / เต็ม -> 413', async () => {
  setupEnv();
  let calls = mockFetch({ dt_sync_push: (b) => ({ ok: true, seq: 9, used: 10, limit: 100, got: b }) });
  const { POST } = await import('../api/sync/push.js');
  const res = await POST(req('POST', '/api/sync/push', { records: [{ key: 'c:1', data: 'z1:x' }] }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).seq, 9);
  const sent = JSON.parse(calls.find(c => c.url.endsWith('/rpc/dt_sync_push')).init.body);
  assert.equal(sent.p_user, 'u1');
  assert.deepEqual(sent.p_records, [{ key: 'c:1', deleted: false, data: 'z1:x' }]);

  mockFetch({ dt_sync_push: () => ({ ok: false, reason: 'plan' }) });
  assert.equal((await POST(req('POST', '/api/sync/push', { records: [{ key: 'c:1', data: 'z1:x' }] }))).status, 403);
  mockFetch({ dt_sync_push: () => ({ ok: false, reason: 'storage', used: 5, limit: 5 }) });
  assert.equal((await POST(req('POST', '/api/sync/push', { records: [{ key: 'c:1', data: 'z1:x' }] }))).status, 413);
  assert.equal((await POST(req('POST', '/api/sync/push', { records: [{ key: 'c:1', data: 'z1:x' }] }, ''))).status, 401);
  calls = mockFetch({});
  assert.equal((await POST(req('POST', '/api/sync/push', { records: [{ key: 'bad', data: 'x' }] }))).status, 400);
  assert.ok(!calls.some(c => c.url.includes('/rpc/')));
});

test('pull / status: อ่านเฉพาะของผู้ใช้คนนั้น (ใช้ได้แม้แพ็กเกจหมดอายุ)', async () => {
  setupEnv();
  const calls = mockFetch({
    dt_sync_pull: (b) => ({ records: [{ key: 'c:1', seq: 3, deleted: false, data: 'z1:x' }], next: 3, more: false, args: b }),
    dt_sync_status: () => ({ enabled: false, used: 2048, limit: 0, count: 1, seq: 3 })
  });
  const { GET: pull } = await import('../api/sync/pull.js');
  const res = await pull(req('GET', '/api/sync/pull?since=2&limit=50'));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.records[0].key, 'c:1');
  assert.deepEqual(JSON.parse(calls.find(c => c.url.endsWith('/rpc/dt_sync_pull')).init.body), { p_user: 'u1', p_since: 2, p_limit: 50 });
  const { GET: status } = await import('../api/sync/status.js');
  const s = await (await status(req('GET', '/api/sync/status'))).json();
  assert.deepEqual(s, { enabled: false, used: 2048, limit: 0, count: 1, seq: 3, lastAt: null });
});
