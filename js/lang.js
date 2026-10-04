// ==================== SOURCE LANGUAGES ====================
// ทุกอย่างที่ต่างกันตามภาษาต้นฉบับ: ชื่อภาษา, คำแนะนำการแปล, ตัวอักษรที่ไม่ควรหลงเหลือ, เกณฑ์ความยาว

const KANA_REGEX = /[぀-ヿㇰ-ㇿ]/;
const HANGUL_REGEX = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const HAN_CHAR_REGEX = /[㐀-䶿一-鿿豈-﫿]|[\uD840-\uD87F][\uDC00-\uDFFF]/;

const SOURCE_LANGS = {
  zh: {
    name: 'จีน',
    // ไทย/จีน ยาวกว่าประมาณ 1.5-4 เท่า (นับตัวอักษร)
    ratio: [0.7, 9],
    leftover: /[㐀-䶿一-鿿豈-﫿]|[\uD840-\uD87F][\uDC00-\uDFFF]/,
    instruction: `- สำนวนจีน 4 ตัวอักษร (成语) และคำพังเพย: ถอดเป็นสำนวนไทยหรือภาษาไทยที่สื่อความหมายเดียวกัน ไม่แปลทีละคำ
- ข้อความในวงเล็บ 【 】 มักเป็นชื่อวิชา สถานะ หรือข้อความระบบ ให้แปลไว้ในวงเล็บเสมอ`
  },
  ja: {
    name: 'ญี่ปุ่น',
    ratio: [0.5, 6],
    leftover: /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿]/,
    instruction: `- คำนำหน้า/ต่อท้ายชื่อ (さん, 様, くん, ちゃん, 先輩, 先生): แปลเป็นคำไทยที่สื่อความสัมพันธ์เดียวกัน (คุณ, ท่าน, รุ่นพี่, อาจารย์) หรือคงไว้ถ้าคู่มือเรื่องกำหนด
- เสียงประกอบ/คำเลียนเสียง (ドキドキ, ゴゴゴ): แปลเป็นคำเลียนเสียงหรือคำบรรยายภาษาไทยที่เป็นธรรมชาติ
- บทพูดใน 「 」 『 』 ให้ใช้ “ ” และ ‘ ’ ตามลำดับ ตัดตัวอ่านกำกับ (ルビ/ふりกานะ) ที่ซ้ำกับคำหลักออก
- สรรพนามแทนตัว (俺, 僕, 私, わし) บอกบุคลิกตัวละคร เลือกสรรพนามไทยให้สอดคล้องและคงที่`
  },
  ko: {
    name: 'เกาหลี',
    ratio: [0.6, 5],
    leftover: /[가-힯ᄀ-ᇿ㄰-㆏]/,
    instruction: `- ระดับภาษา (존댓말/반말) สะท้อนความสัมพันธ์ ให้เลือกสรรพนามและหางเสียงไทยที่สื่อระดับความสุภาพเดียวกัน
- คำเรียกญาติ/ความสนิท (형, 오빠, 누나, 언니, 선배, 님): แปลเป็นคำไทยที่ตรงความสัมพันธ์ (พี่, รุ่นพี่, ท่าน) อย่างสม่ำเสมอ
- ข้อความระบบในวงเล็บ [ ] ของแนวระบบ/ฮันเตอร์ ให้แปลไว้ในวงเล็บเสมอ`
  },
  en: {
    name: 'อังกฤษ',
    ratio: [0.4, 3],
    leftover: null,
    instruction: `- "you/I" ไม่มีระดับในภาษาอังกฤษ ให้เลือกสรรพนามไทยตามเพศ อายุ และความสัมพันธ์ของตัวละคร แล้วใช้ให้คงที่
- สำนวนและคำแสลงให้ถอดความเป็นสำนวนไทย ไม่แปลตรงตัว ชื่อเฉพาะที่ไม่มีในคลังศัพท์ให้ทับศัพท์ตามหลักราชบัณฑิตฯ`
  },
  other: {
    name: 'ต้นฉบับ',
    ratio: [0.3, 9],
    leftover: null,
    instruction: '- ถอดสำนวนและคำเฉพาะทางวัฒนธรรมเป็นภาษาไทยที่สื่อความหมายเดียวกัน ไม่แปลตรงตัว'
  }
};

function normalizeLang(code) {
  return SOURCE_LANGS[code] ? code : DEFAULT_SOURCE_LANG;
}

function getLangName(code) {
  return SOURCE_LANGS[normalizeLang(code)].name;
}

function getLanguageInstruction(code) {
  return SOURCE_LANGS[normalizeLang(code)].instruction;
}

/** ตัวอักษรต้นฉบับที่ไม่ควรเหลือในคำแปลไทย (null = ตรวจไม่ได้ เช่นภาษาอังกฤษที่อาจคงชื่อไว้) */
function getLeftoverRegex(code) {
  return SOURCE_LANGS[normalizeLang(code)].leftover;
}

function getLengthRatioRange(code) {
  return SOURCE_LANGS[normalizeLang(code)].ratio;
}

/**
 * เดาภาษาต้นฉบับจากตัวอักษร: มีคานะพอสมควร = ญี่ปุ่น (คันจิเยอะก็ยังเป็นญี่ปุ่น), ฮันกึล = เกาหลี,
 * ฮั่นจื่อล้วน = จีน, ละตินเป็นหลัก = อังกฤษ
 */
function detectSourceLang(text) {
  const sample = (text || '').slice(0, 6000);
  let kana = 0, hangul = 0, han = 0, latin = 0;
  for (const ch of sample) {
    if (KANA_REGEX.test(ch)) kana++;
    else if (HANGUL_REGEX.test(ch)) hangul++;
    else if (HAN_CHAR_REGEX.test(ch)) han++;
    else if (/[A-Za-z]/.test(ch)) latin++;
  }
  const cjk = kana + hangul + han;
  if (cjk + latin < 20) return null;
  if (hangul > cjk * 0.3) return 'ko';
  if (kana > (kana + han) * 0.08) return 'ja';
  if (han > latin * 0.5) return 'zh';
  if (latin > cjk) return 'en';
  return 'other';
}

/** ข้อความที่ผู้ใช้เลือกเป็นภาษาต้นฉบับหรือไม่ (ใช้กับแถบเลือกคำ) */
function looksLikeSourceText(text) {
  return HAN_CHAR_REGEX.test(text) || KANA_REGEX.test(text) || HANGUL_REGEX.test(text);
}
