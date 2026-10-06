// ==================== บริการแปลของ Dusktale: บัญชีผู้ใช้ + ผู้ให้บริการ "dusktale" ====================
// เข้าสู่ระบบด้วยอีเมล (ลิงก์ หรือรหัส 6 หลัก) ผ่าน Supabase Auth แบบ REST (ไม่ต้องโหลดไลบรารีเพิ่ม)
// แปลผ่านเซิร์ฟเวอร์ของ Dusktale (server/) ซึ่งรับคำขอแบบเดียวกับ OpenAI จึงใช้ callOpenAIOnce เดิมได้
// session เก็บแบบเดียวกับ API Key (setSecret: ตามตัวเลือก "ไม่จำหลังปิดแท็บ" และไม่อยู่ในไฟล์สำรอง)
// ค่าตั้งว่าง (js/hosted-config.js) = ไม่มีผู้ให้บริการนี้ แอพทำงานแบบเดิมทุกอย่าง

const HOSTED = (() => {
  const c = (typeof window !== 'undefined' && window.DUSKTALE_HOSTED) || {};
  const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
  return {
    apiBase: clean(c.apiBase),
    // Project URL อย่างเดียว (ตัด /rest/v1 ที่อาจคัดลอกติดมา)
    supabaseUrl: clean(c.supabaseUrl).replace(/\/(rest|auth)\/v1$/i, ''),
    anonKey: String(c.supabaseAnonKey || '').trim(),
    emailHasCode: c.emailHasCode === true,
    freeTokens: Number(c.freeMonthlyTokens) || 400000,
    tokensPerChapter: Number(c.tokensPerChapter) || 11000
  };
})();
const HOSTED_SESSION_KEY = 'nov_hosted_session';
let hostedRefreshPromise = null;
let hostedMe = null;

function isHostedConfigured() {
  return !!(HOSTED.apiBase && HOSTED.supabaseUrl && HOSTED.anonKey);
}

// ---------- ฟังก์ชันล้วน (ทดสอบได้) ----------
/** อ่านผลจากลิงก์เข้าสู่ระบบในอีเมล (#access_token=...&refresh_token=...) หรือ error */
function parseAuthHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  if (p.get('error') || p.get('error_description')) return { error: p.get('error_description') || p.get('error') };
  const access = p.get('access_token');
  const refresh = p.get('refresh_token');
  if (!access || !refresh) return null;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Number(p.get('expires_at')) || now + (Number(p.get('expires_in')) || 3600);
  return { access_token: access, refresh_token: refresh, expires_at: expiresAt, type: p.get('type') || '' };
}

/** session จากคำตอบของ /token หรือ /verify */
function sessionFromAuthResponse(data, nowSec = Math.floor(Date.now() / 1000)) {
  if (!data?.access_token || !data?.refresh_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Number(data.expires_at) || nowSec + (Number(data.expires_in) || 3600),
    email: data.user?.email || ''
  };
}

function hostedSessionNeedsRefresh(session, nowSec = Math.floor(Date.now() / 1000)) {
  return !session?.access_token || !Number.isFinite(session.expires_at) || session.expires_at - nowSec < 90;
}

/** ข้อความโควตาสำหรับแสดงในแอพ: ใช้ไปเท่าไร เหลือประมาณกี่ตอน */
function describeHostedQuota(me, tokensPerChapter = HOSTED.tokensPerChapter) {
  const limit = Math.max(0, Number(me?.limit) || 0);
  const used = Math.min(limit, Math.max(0, Number(me?.used) || 0));
  const left = limit - used;
  const pct = limit ? Math.round(100 * used / limit) : 0;
  return { limit, used, left, pct, chaptersLeft: Math.floor(left / tokensPerChapter), chaptersTotal: Math.floor(limit / tokensPerChapter) };
}

// ---------- session ----------
function readHostedSession() {
  try {
    const s = JSON.parse(getSecret(HOSTED_SESSION_KEY) || 'null');
    return s && s.refresh_token ? s : null;
  } catch (e) {
    return null;
  }
}

function saveHostedSession(session) {
  setSecret(HOSTED_SESSION_KEY, session ? JSON.stringify(session) : '');
}

function isHostedSignedIn() {
  return isHostedConfigured() && !!readHostedSession();
}

async function hostedAuthFetch(path, body, { method = 'POST', token = '' } = {}) {
  let res;
  try {
    res = await fetch(`${HOSTED.supabaseUrl}/auth/v1${path}`, {
      method,
      headers: { apikey: HOSTED.anonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    return { ok: false, status: 0, message: 'เชื่อมต่อระบบบัญชีไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่' };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, message: data.msg || data.error_description || data.message || data.error || `HTTP ${res.status}` };
}

/** ส่งอีเมลเข้าสู่ระบบ (สมัครให้อัตโนมัติถ้ายังไม่มีบัญชี) อีเมลมีทั้งลิงก์และรหัส 6 หลัก (ถ้าตั้งเทมเพลตไว้) */
async function hostedSendOtp(email) {
  const redirect = location.origin + location.pathname;
  return hostedAuthFetch(`/otp?redirect_to=${encodeURIComponent(redirect)}`, { email, create_user: true });
}

async function hostedVerifyOtp(email, code) {
  const r = await hostedAuthFetch('/verify', { type: 'email', email, token: code });
  const session = r.ok ? sessionFromAuthResponse(r.data) : null;
  if (session) { saveHostedSession({ ...session, email: session.email || email }); hostedMe = null; }
  return { ...r, ok: !!session };
}

async function refreshHostedSession(session) {
  const r = await hostedAuthFetch('/token?grant_type=refresh_token', { refresh_token: session.refresh_token });
  if (!r.ok) {
    // refresh token ใช้ไม่ได้แล้ว (ออกจากระบบที่อื่น / หมดอายุ): ต้องเข้าสู่ระบบใหม่
    if (r.status === 400 || r.status === 401 || r.status === 403) { saveHostedSession(null); hostedMe = null; }
    throw new LLMError(r.status ? 'การเข้าสู่ระบบ Dusktale หมดอายุ กรุณาเข้าสู่ระบบใหม่ในหน้าตั้งค่า' : r.message, r.status ? 'auth' : 'network', r.status);
  }
  const next = sessionFromAuthResponse(r.data);
  if (!next) throw new LLMError('ต่ออายุการเข้าสู่ระบบไม่สำเร็จ', 'auth');
  const merged = { ...next, email: next.email || session.email || '' };
  saveHostedSession(merged);
  return merged;
}

/** access token ที่ยังไม่หมดอายุ (ต่ออายุให้เองถ้าใกล้หมด ทำครั้งเดียวแม้หลายคำขอพร้อมกัน) */
async function getHostedAccessToken() {
  const session = readHostedSession();
  if (!session) throw new LLMError("กรุณาเข้าสู่ระบบ Dusktale ในเมนู 'ตั้งค่า' ก่อน", 'config');
  if (!hostedSessionNeedsRefresh(session)) return session.access_token;
  if (!hostedRefreshPromise) hostedRefreshPromise = refreshHostedSession(session).finally(() => { hostedRefreshPromise = null; });
  return (await hostedRefreshPromise).access_token;
}

async function hostedSignOut() {
  const session = readHostedSession();
  if (session?.access_token) await hostedAuthFetch('/logout', null, { token: session.access_token }).catch(() => {});
  saveHostedSession(null);
  hostedMe = null;
}

/** แพ็กเกจและโควตาของเดือนนี้ (จากเซิร์ฟเวอร์) */
async function fetchHostedMe() {
  const token = await getHostedAccessToken();
  const res = await fetch(`${HOSTED.apiBase}/me`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new LLMError(data.error?.message || `HTTP ${res.status}`, res.status === 401 ? 'auth' : 'server', res.status);
  hostedMe = data;
  return data;
}

/** กลับมาจากลิงก์ในอีเมล: เก็บ session แล้วลบ token ออกจากแถบที่อยู่ */
function consumeHostedAuthRedirect() {
  if (!isHostedConfigured() || typeof location === 'undefined') return;
  const result = parseAuthHash(location.hash);
  if (!result) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (result.error) { window.__hostedAuthError = result.error; return; }
  saveHostedSession({ access_token: result.access_token, refresh_token: result.refresh_token, expires_at: result.expires_at, email: '' });
  window.__hostedJustSignedIn = true;
}

// ---------- ผู้ให้บริการ "dusktale" ใน llm.js ----------
async function callHostedOnce(cfg, key, prompt, opts, signal, jsonMode = null) {
  const token = await getHostedAccessToken();
  // เซิร์ฟเวอร์เลือกโมเดลและการคิดก่อนตอบเอง ส่งแค่ "auto"
  return callOpenAIOnce({ ...cfg, baseUrl: `${HOSTED.apiBase}/v1`, model: 'auto', reasoning: 'default' }, token, prompt, opts, signal, jsonMode);
}

if (isHostedConfigured() && typeof LLM_PROVIDERS !== 'undefined') {
  LLM_PROVIDERS.dusktale = {
    label: 'Dusktale (ไม่ต้องใช้ API Key)',
    keyHint: '',
    defaultModel: 'auto',
    suggestedModels: ['auto'],
    hosted: true
  };
  PROVIDER_CALLERS.dusktale = callHostedOnce;
  consumeHostedAuthRedirect();
}

// ---------- หน้าตั้งค่า: กล่องบัญชี Dusktale ----------
let hostedPendingEmail = '';

function hostedBoxHead() {
  return `<div class="hosted-head"><img src="icons/icon-64.png" alt="" width="36" height="36">
    <div><b>แปลด้วย AI ของ Dusktale</b><div class="hint" style="margin-top: 0;">ไม่ต้องสมัครหรือใส่ API Key · ฟรีเดือนละประมาณ ${Math.floor(HOSTED.freeTokens / HOSTED.tokensPerChapter)} ตอน</div></div></div>`;
}

function setHostedMsg(text, tone = '') {
  const el = document.getElementById('hosted-msg');
  if (!el) return;
  el.textContent = text;
  el.className = `hint${tone ? ` text-${tone}` : ''}`;
}

/** วาดกล่องบัญชี (refresh = โหลดโควตาจากเซิร์ฟเวอร์ใหม่) */
async function renderHostedAccountBox(refresh = false) {
  const box = document.getElementById('hosted-account-box');
  if (!box || !isHostedConfigured()) return;
  const session = readHostedSession();
  if (!session) {
    box.innerHTML = `<div class="hosted-card">${hostedBoxHead()}
      <label class="form-label" for="hosted-email">อีเมล (ใช้เข้าสู่ระบบ ไม่ต้องตั้งรหัสผ่าน)</label>
      <div class="hosted-row">
        <input type="email" id="hosted-email" class="form-input" placeholder="you@example.com" autocomplete="email" value="${escapeHtml(hostedPendingEmail)}" onkeydown="if (event.key === 'Enter') hostedSendFromUi()">
        <button class="btn btn-primary" id="hosted-send-btn" onclick="hostedSendFromUi()">ส่งลิงก์เข้าสู่ระบบ</button>
      </div>
      <div class="hosted-row" id="hosted-code-row"${hostedPendingEmail && HOSTED.emailHasCode ? '' : ' hidden'}>
        <input id="hosted-code" class="form-input mono" inputmode="numeric" maxlength="10" placeholder="รหัสจากอีเมล" autocomplete="one-time-code" aria-label="รหัสจากอีเมล" onkeydown="if (event.key === 'Enter') hostedVerifyFromUi()">
        <button class="btn" id="hosted-verify-btn" onclick="hostedVerifyFromUi()">ยืนยันรหัส</button>
      </div>
      <div id="hosted-msg" class="hint" aria-live="polite"></div>
      <p class="hint">เมื่อใช้บริการนี้ ต้นฉบับที่แปลจะส่งผ่านเซิร์ฟเวอร์ของ Dusktale ไปยังผู้ให้บริการ AI ดู <a href="legal/privacy.html" target="_blank" rel="noopener">นโยบายความเป็นส่วนตัว</a></p>
    </div>`;
    return;
  }
  const quotaHtml = (me) => {
    const q = describeHostedQuota(me);
    const reset = me.periodEnd ? new Date(me.periodEnd).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';
    return `<div class="bp-bar" role="progressbar" aria-label="โควตาที่ใช้ไป" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${q.pct}"><span style="width: ${Math.max(2, q.pct)}%"></span></div>
      <div class="hint">ใช้ไป ${formatTokenCount(q.used)} จาก ${formatTokenCount(q.limit)} token เดือนนี้ · เหลือประมาณ <b>${q.chaptersLeft}</b> ตอน${reset ? ` · เริ่มรอบใหม่ ${escapeHtml(reset)}` : ''}</div>`;
  };
  box.innerHTML = `<div class="hosted-card">${hostedBoxHead()}
    <div class="hosted-who">เข้าสู่ระบบเป็น <b>${escapeHtml(hostedMe?.email || session.email || 'ผู้ใช้ Dusktale')}</b>${hostedMe?.planName ? ` · แพ็กเกจ <b>${escapeHtml(hostedMe.planName)}</b>` : ''}</div>
    <div class="hosted-quota" id="hosted-quota">${hostedMe && !refresh ? quotaHtml(hostedMe) : '<div class="hint">กำลังโหลดโควตา...</div>'}</div>
    <div class="hosted-row">
      <button class="btn btn-sm" onclick="renderHostedAccountBox(true)">รีเฟรชโควตา</button>
      <button class="btn btn-sm" onclick="hostedSignOutFromUi()">ออกจากระบบ</button>
    </div>
    <div id="hosted-msg" class="hint" aria-live="polite"></div>
  </div>`;
  if (hostedMe && !refresh) return;
  try {
    const me = await fetchHostedMe();
    const quota = document.getElementById('hosted-quota');
    if (quota) quota.innerHTML = quotaHtml(me);
    const who = box.querySelector('.hosted-who');
    if (who) who.innerHTML = `เข้าสู่ระบบเป็น <b>${escapeHtml(me.email || session.email || 'ผู้ใช้ Dusktale')}</b>${me.planName ? ` · แพ็กเกจ <b>${escapeHtml(me.planName)}</b>` : ''}`;
  } catch (err) {
    const quota = document.getElementById('hosted-quota');
    if (quota) quota.innerHTML = '';
    setHostedMsg(`โหลดโควตาไม่ได้: ${err.message}`, 'danger');
    if (err.kind === 'auth' && !readHostedSession()) renderHostedAccountBox();
  }
}

async function hostedSendFromUi() {
  const email = (document.getElementById('hosted-email')?.value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setHostedMsg('กรุณาใส่อีเมลให้ถูกต้อง', 'danger');
  const btn = document.getElementById('hosted-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังส่ง...'; }
  const r = await hostedSendOtp(email);
  if (btn) { btn.disabled = false; btn.textContent = 'ส่งอีกครั้ง'; }
  if (!r.ok) return setHostedMsg(r.status === 429 ? 'ส่งอีเมลถี่เกินไป รอสักครู่แล้วลองใหม่' : `ส่งอีเมลไม่สำเร็จ: ${r.message}`, 'danger');
  hostedPendingEmail = email;
  if (HOSTED.emailHasCode) {
    document.getElementById('hosted-code-row').hidden = false;
    setHostedMsg(`ส่งอีเมลไปที่ ${email} แล้ว กดลิงก์ในอีเมล (เปิดในเบราว์เซอร์นี้) หรือใส่รหัสจากอีเมลในช่องด้านบน`, 'success');
    document.getElementById('hosted-code')?.focus();
  } else {
    setHostedMsg(`ส่งอีเมลไปที่ ${email} แล้ว เปิดอีเมลแล้วกดลิงก์ "Sign in" ในเบราว์เซอร์นี้ (ไม่เจอ ดูในโฟลเดอร์สแปม/ขยะ)`, 'success');
  }
}

async function hostedVerifyFromUi() {
  const code = (document.getElementById('hosted-code')?.value || '').replace(/\s+/g, '');
  if (!hostedPendingEmail || !/^\d{6,10}$/.test(code)) return setHostedMsg('ใส่รหัสตัวเลขจากอีเมล', 'danger');
  const btn = document.getElementById('hosted-verify-btn');
  if (btn) btn.disabled = true;
  const r = await hostedVerifyOtp(hostedPendingEmail, code);
  if (btn) btn.disabled = false;
  if (!r.ok) return setHostedMsg(`รหัสไม่ถูกต้องหรือหมดอายุ: ${r.message}`, 'danger');
  onHostedSignedIn();
}

/** เข้าสู่ระบบสำเร็จ: ใช้ Dusktale เป็นผู้ให้บริการหลักทันที (ไม่ต้องกดบันทึกอีกครั้ง) */
function onHostedSignedIn() {
  hostedPendingEmail = '';
  localStorage.setItem('nov_llm_provider', 'dusktale');
  const sel = document.getElementById('llm-provider-select');
  if (sel) sel.value = 'dusktale';
  renderHostedAccountBox(true);
  if (typeof showGlobalToast === 'function') { showGlobalToast('เข้าสู่ระบบ Dusktale แล้ว แปลได้เลย'); setTimeout(() => typeof hideGlobalToast === 'function' && hideGlobalToast(), 2500); }
  if (typeof currentBookId !== 'undefined' && currentBookId === 'default_novel' && typeof renderVirtualWindow === 'function') renderVirtualWindow(0, true);
}

async function hostedSignOutFromUi() {
  if (!(await appConfirm('ออกจากระบบ Dusktale ในเครื่องนี้ นิยายและคลังศัพท์ยังอยู่ครบ', { title: 'ออกจากระบบ', confirmLabel: 'ออกจากระบบ' }))) return;
  await hostedSignOut();
  renderHostedAccountBox();
}

/** ปุ่มบนหน้าต้อนรับ: เปิดหน้าตั้งค่าที่กล่องเข้าสู่ระบบ */
function openHostedSignIn() {
  openSettingsModal('ai');
  const sel = document.getElementById('llm-provider-select');
  if (sel && sel.value !== 'dusktale') { sel.value = 'dusktale'; onProviderSelectChange(); }
  setTimeout(() => document.getElementById('hosted-email')?.focus(), 120);
}

if (isHostedConfigured() && typeof document !== 'undefined') {
  // ตัวเลือกผู้ให้บริการ: ใส่ไว้บนสุด
  const sel = document.getElementById('llm-provider-select');
  if (sel && !sel.querySelector('option[value="dusktale"]')) sel.insertAdjacentHTML('afterbegin', '<option value="dusktale">Dusktale — ไม่ต้องใช้ API Key (แนะนำ)</option>');
  // ลิงก์ในอีเมลเปิดในแท็บที่เปิดแอพอยู่แล้ว (เปลี่ยนแค่ #...): หน้าไม่โหลดใหม่ จึงต้องรับเองตรงนี้
  window.addEventListener('hashchange', () => {
    consumeHostedAuthRedirect();
    if (window.__hostedJustSignedIn) { window.__hostedJustSignedIn = false; onHostedSignedIn(); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    if (window.__hostedJustSignedIn) setTimeout(() => { window.__hostedJustSignedIn = false; onHostedSignedIn(); }, 1200);
    if (window.__hostedAuthError) setTimeout(() => appAlert(`เข้าสู่ระบบไม่สำเร็จ: ${window.__hostedAuthError}\nลิงก์อาจหมดอายุหรือถูกใช้ไปแล้ว ส่งลิงก์ใหม่ได้ที่ ตั้งค่า → 🤖 AI`), 1200);
  });
}