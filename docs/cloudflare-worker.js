// ตัวอย่าง proxy สำรองสำหรับ NovelTranslate AI (Cloudflare Workers แผนฟรีใช้ได้)
// ใช้เมื่อ r.jina.ai ล่มหรือโดนจำกัดจำนวนครั้ง: แอพจะส่งลิงก์หน้านิยายมา แล้ว Worker ดึง HTML ของหน้านั้นส่งกลับ
//
// วิธีติดตั้ง
// 1. สมัคร/เข้าสู่ระบบ https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
// 2. วางโค้ดไฟล์นี้ทั้งหมดแทนโค้ดตัวอย่าง แล้วกด Deploy
// 3. Settings → Variables and Secrets เพิ่ม
//    - ALLOWED_ORIGIN = ที่อยู่ของแอพ เช่น https://<ชื่อผู้ใช้>.github.io (ไม่มี / ท้าย)
//    - PROXY_KEY (แบบ Secret) = รหัสอะไรก็ได้ที่ยาวพอ (ไม่บังคับ แต่แนะนำ กันคนอื่นแอบใช้ proxy ของคุณ)
// 4. ในแอพ: ตั้งค่า → 🌐 ตั้งค่าเว็บต้นฉบับ → Proxy สำรอง → + เพิ่ม
//    ใส่ URL เช่น https://<ชื่อ worker>.<บัญชี>.workers.dev/?url={url} และใส่ Proxy key ให้ตรงกับ PROXY_KEY แล้วรีโหลดหน้า
//
// ข้อจำกัด: Worker ดึงได้แค่ HTML ที่เซิร์ฟเวอร์ส่งมา เว็บที่โหลดเนื้อหาด้วย JavaScript หรือมีหน้าตรวจบอท (Cloudflare challenge)
// อาจดึงเนื้อหาไม่ได้ ใช้กับเว็บที่ r.jina.ai เคยดึงได้ปกติ

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Proxy-Key',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    if (env.PROXY_KEY && request.headers.get('X-Proxy-Key') !== env.PROXY_KEY) {
      return new Response('Forbidden', { status: 403, headers: cors });
    }

    const target = new URL(request.url).searchParams.get('url');
    let targetUrl;
    try {
      targetUrl = new URL(target || '');
    } catch (e) {
      return new Response('Missing or invalid ?url=', { status: 400, headers: cors });
    }
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return new Response('Only http(s) URLs are allowed', { status: 400, headers: cors });
    }

    try {
      const res = await fetch(targetUrl.href, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,ko;q=0.7,en;q=0.6'
        },
        redirect: 'follow',
        cf: { cacheTtl: 300 }
      });
      const body = await res.arrayBuffer();
      return new Response(body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': res.headers.get('Content-Type') || 'text/html; charset=utf-8' }
      });
    } catch (e) {
      return new Response('Fetch failed: ' + e.message, { status: 502, headers: cors });
    }
  }
};
