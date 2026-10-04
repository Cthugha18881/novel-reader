// ==================== DETERMINISTIC CLEANUP (ไม่ใช้ AI) ====================
// ทำงานหลังแปลเสร็จทุกครั้ง: แปลงเครื่องหมายแบบจีน, แก้คำสะกดผิดที่ผิดแน่นอน, กฎแทนคำของผู้ใช้
// ทุกขั้นจะไม่แตะช่วงข้อความที่เป็นคำในคลังศัพท์ เพื่อให้ไฮไลต์/ค้นหาคำ/แทนชื่อย้อนหลังยังทำงานได้

// เครื่องหมายแบบจีน/ญี่ปุ่นที่หลุดมาในคำแปลไทย
const PUNCTUATION_RULES = [
  [/……|…/g, '...'],
  [/[，、]/g, ' '],
  [/。(?=\s*$)/g, ''],
  [/。/g, ' '],
  [/！/g, '!'],
  [/？/g, '?'],
  [/：/g, ': '],
  [/；/g, '; '],
  [/「/g, '“'], [/」/g, '”'],
  [/『/g, '‘'], [/』/g, '’'],
  [/（/g, ' ('], [/）/g, ') '],
  [/～/g, '~'],
  [/\s*\.\.\.\s*\.\.\./g, '...'],
  [/ {2,}/g, ' '],
  [/ +([!?)\]”’])/g, '$1'],
  [/([(“‘\[]) +/g, '$1']
];

// คำที่สะกดผิดแน่นอน (ไม่มีความหมายอื่นที่ถูกต้อง) ใช้ lookahead กันไปแก้คำที่ยาวกว่าซึ่งถูกอยู่แล้ว
const THAI_MISSPELLINGS = [
  [/อนุญาติ/g, 'อนุญาต'],
  [/ศรีษะ/g, 'ศีรษะ'],
  [/สังเกตุ/g, 'สังเกต'],
  [/โอกาศ/g, 'โอกาส'],
  [/ปรากฎ/g, 'ปรากฏ'],
  [/ทะเลสาป/g, 'ทะเลสาบ'],
  [/รสชาด/g, 'รสชาติ'],
  [/ผลัดผ่อน/g, 'ผัดผ่อน'],
  [/พิศดาร/g, 'พิสดาร'],
  [/อัฒจรรย์/g, 'อัฒจันทร์'],
  [/บิณฑบาตร/g, 'บิณฑบาต'],
  [/ประณีประนอม/g, 'ประนีประนอม'],
  [/คลินิค/g, 'คลินิก'],
  [/จราจล/g, 'จลาจล'],
  [/ผาสุข/g, 'ผาสุก'],
  [/เบญจเพส/g, 'เบญจเพศ'],
  [/กงศุล/g, 'กงสุล'],
  [/ทนุถนอม/g, 'ทะนุถนอม'],
  [/มัธยัสต์/g, 'มัธยัสถ์'],
  [/อนุเสาวรีย์/g, 'อนุสาวรีย์'],
  [/ปิกนิค/g, 'ปิกนิก'],
  [/เวทย์มนต์|เวทย์มนตร์|เวทมนต์(?!ร์)/g, 'เวทมนตร์'],
  [/ดำริห์/g, 'ดำริ'],
  [/พังทะลาย/g, 'พังทลาย'],
  [/เลือกสรรค์/g, 'เลือกสรร'],
  [/สร้างสรร(?!ค์)/g, 'สร้างสรรค์'],
  [/กระเพรา/g, 'กะเพรา'],
  [/ไอศครีม/g, 'ไอศกรีม'],
  [/ทระนง/g, 'ทะนง'],
  [/ผูกพันธ์/g, 'ผูกพัน'],
  [/บรรเทิง/g, 'บันเทิง'],
  [/ลายเซ็นต์/g, 'ลายเซ็น'],
  [/ผัดเปลี่ยน/g, 'ผลัดเปลี่ยน'],
  [/กระทันหัน/g, 'กะทันหัน'],
  [/ลำใย/g, 'ลำไย'],
  [/ฉนั้น/g, 'ฉะนั้น'],
  [/นะค่ะ/g, 'นะคะ'],
  [/ค่ะ\?/g, 'คะ?']
];

/** ช่วงตำแหน่งของคำในคลังศัพท์ในข้อความ (เรียงจากคำยาวก่อน ไม่ซ้อนกัน) */
function findProtectedRanges(text, termTgts) {
  const ranges = [];
  const sorted = [...new Set(termTgts.filter(t => t && t.length >= 2))].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    let at = text.indexOf(term);
    while (at !== -1) {
      const end = at + term.length;
      if (!ranges.some(r => at < r.end && end > r.start)) ranges.push({ start: at, end });
      at = text.indexOf(term, end);
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** ใช้ fn กับเฉพาะส่วนของข้อความที่ไม่ใช่คำในคลังศัพท์ */
function transformOutsideTerms(text, termTgts, fn) {
  if (!text) return text;
  const ranges = findProtectedRanges(text, termTgts);
  if (ranges.length === 0) return fn(text);
  let out = '';
  let cursor = 0;
  for (const r of ranges) {
    out += fn(text.slice(cursor, r.start)) + text.slice(r.start, r.end);
    cursor = r.end;
  }
  return out + fn(text.slice(cursor));
}

function applyRegexRules(text, rules) {
  return rules.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

function normalizeReplaceRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .filter(r => r && r.enabled !== false && typeof r.from === 'string' && r.from.length > 0 && typeof r.to === 'string')
    .sort((a, b) => b.from.length - a.from.length);
}

function applyUserReplaceRules(text, rules) {
  return normalizeReplaceRules(rules).reduce((acc, r) => acc.split(r.from).join(r.to), text);
}

/**
 * ทำความสะอาดคำแปล 1 ย่อหน้า
 * @param {string} th
 * @param {{ termTgts?: string[], replaceRules?: object[] }} opts
 */
function cleanupThaiText(th, { termTgts = [], replaceRules = [] } = {}) {
  if (!th) return th;
  let out = transformOutsideTerms(th, termTgts, seg => applyRegexRules(seg, THAI_MISSPELLINGS));
  out = transformOutsideTerms(out, termTgts, seg => applyUserReplaceRules(seg, replaceRules));
  out = transformOutsideTerms(out, termTgts, seg => applyRegexRules(seg, PUNCTUATION_RULES));
  return out.replace(/^\s+|\s+$/g, '');
}

/** ทำความสะอาดทุกย่อหน้าของตอน (ข้ามข้อความจากหน้าเว็บที่ไม่ได้แปล) คืน array ใหม่ */
function cleanupParagraphs(paragraphs, opts) {
  return paragraphs.map(p => {
    if (p.kind === 'site_junk' || !p.th) return p;
    const cleaned = cleanupThaiText(p.th, opts);
    return cleaned === p.th ? p : { ...p, th: cleaned };
  });
}

async function getCleanupOptionsForBook(bookId) {
  const [activeTerms, data] = await Promise.all([getActiveGlossaryForBook(bookId), dbGetBookData(bookId)]);
  return {
    termTgts: Object.values(activeTerms).map(t => t.resolvedTgt),
    replaceRules: data.replaceRules || []
  };
}
