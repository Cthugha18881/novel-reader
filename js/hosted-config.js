// ==================== ค่าตั้งของบริการแปล Dusktale (ไม่ต้องใช้ API Key) ====================
// ใส่ค่าหลังตั้ง Supabase + Vercel ตาม docs/backend-setup.md แล้ว commit (ทุกค่าในไฟล์นี้เปิดเผยได้ ไม่ใช่ความลับ)
// เว้นว่าง = ปิดบริการนี้ แอพทำงานแบบเดิม (ใช้ API Key ของผู้ใช้เอง)
// ต้องโหลดก่อน csp.js เพราะ CSP ต้องอนุญาตปลายทางเหล่านี้ตั้งแต่เปิดหน้า
window.DUSKTALE_HOSTED = {
  // URL ของเซิร์ฟเวอร์บน Vercel ต่อด้วย /api เช่น 'https://dusktale-api.vercel.app/api'
  apiBase: '',
  // Supabase: Project Settings -> API -> Project URL เช่น 'https://abcd1234.supabase.co'
  supabaseUrl: '',
  // Supabase: Project Settings -> API Keys -> publishable key (sb_publishable_...) หรือ anon key แบบเก่า
  supabaseAnonKey: '',
  // อีเมลเข้าสู่ระบบมีรหัส 6 หลักหรือยัง (ต้องตั้ง SMTP ของตัวเองแล้วแก้เทมเพลตก่อน ดู docs/backend-setup.md)
  // false = แสดงแค่ "กดลิงก์ในอีเมล" ไม่มีช่องใส่รหัส
  emailHasCode: false,
  // ใช้แสดงผลในแอพเท่านั้น (โควตาจริงอยู่ที่ตาราง dt_plans ในฐานข้อมูล)
  freeMonthlyTokens: 400000,
  tokensPerChapter: 11000
};
