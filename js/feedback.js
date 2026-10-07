// ==================== ส่งความเห็น / แจ้งปัญหา ====================
// เข้าสู่ระบบแล้ว: ส่งตรงไปที่เซิร์ฟเวอร์ (ตาราง dt_feedback ใน Supabase)
// ยังไม่เข้าสู่ระบบ / ไม่มีบริการ Dusktale: เปิดหน้า GitHub Issues ที่กรอกข้อความไว้ให้
// ข้อมูลวินิจฉัย (เลือกแนบได้ ดูก่อนส่งได้): รุ่นแอพ เบราว์เซอร์ จอ แพ็กเกจ ผู้ให้บริการ AI ข้อผิดพลาดล่าสุด
// ไม่แนบ API Key (ตัดด้วย redactSecrets อีกชั้น) และไม่แนบเนื้อหานิยาย

const FEEDBACK_ISSUES_URL = 'https://github.com/Cthugha18881/novel-reader/issues/new';

function appVersionLabel() {
  const m = /v\d+(\.\d+)+/.exec(document.title || '');
  return m ? m[0] : '';
}

async function buildFeedbackDiagnostics() {
  const ent = typeof getEntitlements === 'function' ? getEntitlements() : null;
  const errors = typeof getDiagnosticLog === 'function' ? (await getDiagnosticLog()).slice(-8) : [];
  const diag = {
    version: appVersionLabel(),
    userAgent: navigator.userAgent,
    language: navigator.language,
    screen: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`,
    online: navigator.onLine,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || false,
    plan: ent?.tier || '',
    provider: typeof getActiveProvider === 'function' ? getActiveProvider() : '',
    qualityMode: typeof getQualityMode === 'function' ? getQualityMode() : '',
    cloudSync: typeof isCloudSyncEnabled === 'function' ? isCloudSyncEnabled() : false,
    books: typeof dbGetAllBooks === 'function' ? (await dbGetAllBooks().catch(() => [])).length : 0,
    recentErrors: errors.map(e => ({ at: e.at, source: e.source, kind: e.kind, status: e.status, provider: e.provider, model: e.model, task: e.task, message: e.message }))
  };
  // ตัดสิ่งที่หน้าตาเหมือนคีย์ออกอีกชั้น (ข้อผิดพลาดบางอย่างอาจมีคีย์ติดมา)
  const text = typeof redactSecrets === 'function' ? redactSecrets(JSON.stringify(diag)) : JSON.stringify(diag);
  return JSON.parse(text);
}

/** ลิงก์เปิด GitHub Issue ที่กรอกหัวข้อและรายละเอียดไว้แล้ว (ตัดให้สั้น ไม่ให้ URL ยาวเกิน) */
function buildFeedbackIssueUrl(category, message, diagnostics) {
  const labels = { bug: 'ปัญหา', translation: 'คำแปล', idea: 'ข้อเสนอ', billing: 'แพ็กเกจ', other: 'ความเห็น' };
  const firstLine = String(message || '').split('\n')[0].slice(0, 60);
  const title = `[${labels[category] || 'ความเห็น'}] ${firstLine}`;
  let body = String(message || '').slice(0, 2500);
  if (diagnostics) {
    const d = { ...diagnostics, recentErrors: (diagnostics.recentErrors || []).slice(-3) };
    body += `\n\n---\nข้อมูลช่วยแก้ปัญหา:\n\`\`\`json\n${JSON.stringify(d, null, 1).slice(0, 2500)}\n\`\`\``;
  }
  return `${FEEDBACK_ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function setFeedbackMsg(text, tone = '') {
  const el = document.getElementById('feedback-msg');
  if (!el) return;
  el.textContent = text;
  el.className = `hint${tone ? ` text-${tone}` : ''}`;
}

async function openFeedbackModal(category) {
  const sel = document.getElementById('feedback-category');
  if (sel && category) sel.value = category;
  setFeedbackMsg(canSendFeedbackToServer()
    ? 'ส่งถึงผู้พัฒนาโดยตรง (ผูกกับบัญชีของคุณ เพื่อตอบกลับทางอีเมลได้)'
    : 'ยังไม่ได้เข้าสู่ระบบ: กดส่งแล้วจะเปิดหน้า GitHub ให้ส่งต่อ (ต้องมีบัญชี GitHub) หรือเข้าสู่ระบบก่อนเพื่อส่งตรงจากแอพ');
  openModal('feedback-modal');
  const pre = document.getElementById('feedback-diag-text');
  if (pre) pre.textContent = JSON.stringify(await buildFeedbackDiagnostics(), null, 2);
}

function canSendFeedbackToServer() {
  return typeof isHostedConfigured === 'function' && isHostedConfigured() && typeof isHostedSignedIn === 'function' && isHostedSignedIn();
}

async function sendFeedbackFromUi() {
  const category = document.getElementById('feedback-category')?.value || 'other';
  const input = document.getElementById('feedback-message');
  const message = (input?.value || '').trim();
  if (message.length < 3) {
    setFeedbackMsg('กรุณาเขียนรายละเอียดสั้นๆ', 'danger');
    input?.focus();
    return;
  }
  const diagnostics = document.getElementById('feedback-include-diag')?.checked ? await buildFeedbackDiagnostics() : null;
  if (!canSendFeedbackToServer()) {
    window.open(buildFeedbackIssueUrl(category, message, diagnostics), '_blank', 'noopener');
    closeModal('feedback-modal');
    return;
  }
  const btn = document.getElementById('feedback-send-btn');
  if (btn) btn.disabled = true;
  setFeedbackMsg('กำลังส่ง...');
  try {
    const token = await getHostedAccessToken();
    const res = await fetch(`${HOSTED.apiBase}/feedback`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, message, diagnostics })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    if (input) input.value = '';
    closeModal('feedback-modal');
    showGlobalToast('ส่งความเห็นแล้ว ขอบคุณที่ช่วยปรับปรุง Dusktale 🙏');
    setTimeout(hideGlobalToast, 3000);
  } catch (err) {
    setFeedbackMsg(`ส่งไม่สำเร็จ: ${err.message}`, 'danger');
  } finally {
    if (btn) btn.disabled = false;
  }
}
