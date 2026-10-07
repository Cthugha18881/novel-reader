// ฟังก์ชันล้วนของซิงก์หลายเครื่อง: ตรวจคำขอส่งรายการขึ้นคลาวด์ (เซิร์ฟเวอร์ไม่อ่านเนื้อหา แค่ตรวจรูปแบบและขนาด)

export const SYNC_LIMITS = {
  maxRecords: 500,          // ต่อคำขอ
  maxRecordChars: 3_000_000, // ต่อรายการ (ข้อมูลที่บีบอัดแล้ว)
  maxBodyChars: 4_000_000,   // ต่อคำขอ (Vercel รับได้ไม่เกิน ~4.5MB)
  pullLimit: 100
};

// key ของรายการ: b:<เรื่อง> c:<ตอน> g:<คำศัพท์> d:<ข้อมูลเสริมของเรื่อง>
const KEY_PATTERN = /^[bcgd]:[^\u0000-\u001f]{1,290}$/;

/** ตรวจ body ของ /api/sync/push และตัด key ซ้ำในคำขอเดียว (เก็บตัวหลังสุด) */
export function validatePushBody(body) {
  const list = body?.records;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'ไม่มีรายการให้ซิงก์' };
  if (list.length > SYNC_LIMITS.maxRecords) return { ok: false, error: `ส่งได้ไม่เกิน ${SYNC_LIMITS.maxRecords} รายการต่อครั้ง` };
  const byKey = new Map();
  let chars = 0;
  for (const r of list) {
    if (!r || typeof r.key !== 'string' || !KEY_PATTERN.test(r.key)) return { ok: false, error: 'รูปแบบรายการไม่ถูกต้อง' };
    const deleted = r.deleted === true;
    if (!deleted && (typeof r.data !== 'string' || !r.data || r.data.length > SYNC_LIMITS.maxRecordChars)) {
      return { ok: false, error: 'ข้อมูลของรายการไม่ถูกต้องหรือใหญ่เกินไป' };
    }
    chars += deleted ? 0 : r.data.length;
    byKey.set(r.key, deleted ? { key: r.key, deleted: true } : { key: r.key, deleted: false, data: r.data });
  }
  if (chars > SYNC_LIMITS.maxBodyChars) return { ok: false, error: 'ข้อมูลต่อครั้งใหญ่เกินไป แบ่งส่งหลายครั้ง' };
  return { ok: true, records: [...byKey.values()] };
}

export function parsePullQuery(url) {
  const u = new URL(url);
  const since = Number(u.searchParams.get('since'));
  const limit = Number(u.searchParams.get('limit'));
  return {
    since: Number.isFinite(since) && since > 0 ? Math.floor(since) : 0,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : SYNC_LIMITS.pullLimit
  };
}

export function syncPushError(result) {
  switch (result?.reason) {
    case 'plan': return { status: 403, type: 'plan', message: 'ซิงก์หลายเครื่องใช้ได้ตั้งแต่แพ็กเกจ Plus ขึ้นไป (ข้อมูลที่อยู่บนคลาวด์แล้วยังดาวน์โหลดคืนได้)' };
    case 'storage': return { status: 413, type: 'storage', message: `พื้นที่คลาวด์เต็ม (${Math.round((result.used || 0) / 1048576)} จาก ${Math.round((result.limit || 0) / 1048576)} MB) ลบเรื่องที่ไม่ใช้แล้ว หรืออัปเกรดแพ็กเกจ` };
    case 'too_many': return { status: 400, type: 'invalid_request', message: `ส่งได้ไม่เกิน ${SYNC_LIMITS.maxRecords} รายการต่อครั้ง` };
    default: return { status: 400, type: 'invalid_request', message: 'รูปแบบรายการไม่ถูกต้อง' };
  }
}
