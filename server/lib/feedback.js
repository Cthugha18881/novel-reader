// ตรวจความเห็น/แจ้งปัญหาที่ส่งมาจากแอพ (ฟังก์ชันล้วน ทดสอบได้)

export const FEEDBACK_CATEGORIES = ['bug', 'translation', 'idea', 'billing', 'other'];
export const FEEDBACK_LIMITS = { message: 4000, diagnosticsChars: 12000 };

export function validateFeedback(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'รูปแบบไม่ถูกต้อง' };
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length < 3) return { ok: false, error: 'กรุณาเขียนรายละเอียดสั้นๆ' };
  if (message.length > FEEDBACK_LIMITS.message) return { ok: false, error: `ข้อความยาวได้ไม่เกิน ${FEEDBACK_LIMITS.message} ตัวอักษร` };
  const category = FEEDBACK_CATEGORIES.includes(body.category) ? body.category : 'other';
  let diagnostics = null;
  if (body.diagnostics && typeof body.diagnostics === 'object' && !Array.isArray(body.diagnostics)) {
    const text = JSON.stringify(body.diagnostics);
    if (text.length > FEEDBACK_LIMITS.diagnosticsChars) return { ok: false, error: 'ข้อมูลวินิจฉัยใหญ่เกินไป' };
    diagnostics = body.diagnostics;
  }
  return { ok: true, category, message, diagnostics };
}
