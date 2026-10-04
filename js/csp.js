// ==================== CONTENT SECURITY POLICY ====================
// ต้องโหลดเป็นสคริปต์แรกใน <head> (ก่อนฟอนต์และสคริปต์อื่น)
// จำกัดปลายทางที่หน้าเว็บส่งข้อมูลออกไปได้ (connect-src/img-src) ถ้ามีสคริปต์แปลกปลอมหลุดเข้ามา จะส่ง API Key ออกไปทาง fetch/รูปภาพไม่ได้
// สร้างแบบ dynamic เพราะ Base URL ของ OpenAI-compatible ผู้ใช้ตั้งเองได้
// หมายเหตุ: ยังต้องใช้ 'unsafe-inline' เพราะปุ่มทั้งแอพใช้ onclick="..." และ style="..." แบบ inline
(function () {
  const FIXED_CONNECT_ORIGINS = [
    'https://generativelanguage.googleapis.com',
    'https://api.anthropic.com',
    'https://r.jina.ai'
  ];

  function originOf(url) {
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) ? u.origin : '';
    } catch (e) {
      return '';
    }
  }

  const custom = [];
  try {
    custom.push(originOf(localStorage.getItem('nov_llm_baseurl_openai') || 'https://api.openai.com/v1'));
  } catch (e) {
    custom.push('https://api.openai.com');
  }

  const connect = [...new Set(["'self'", ...FIXED_CONNECT_ORIGINS, ...custom.filter(Boolean)])];
  window.NT_CSP_CONNECT_ORIGINS = connect.filter(o => o !== "'self'");

  const policy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
  ].join('; ');

  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = policy;
  document.head.appendChild(meta);
})();

/** ปลายทางนี้ส่งคำขอได้ภายใต้ CSP ที่โหลดอยู่ตอนนี้หรือไม่ (ถ้าเปลี่ยน Base URL ต้องรีโหลดหน้าก่อน) */
function isConnectAllowedByCsp(url) {
  if (!Array.isArray(window.NT_CSP_CONNECT_ORIGINS)) return true;
  try {
    const u = new URL(url, location.href);
    if (u.origin === location.origin) return true;
    return window.NT_CSP_CONNECT_ORIGINS.includes(u.origin);
  } catch (e) {
    return false;
  }
}
