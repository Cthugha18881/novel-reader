// ==================== SCRAPER & TRANSLATION ENGINE ====================
// ทุกฟังก์ชันแปลรับ BookContext ({ bookId, title, author, genre }) เป็นพารามิเตอร์
// ห้ามอ่าน currentBookId/currentBookGenre ตรงๆ เพราะงานเบื้องหลังอาจทำงานกับเรื่องอื่นอยู่

const TERM_CATEGORIES = ['character', 'title', 'location', 'skill', 'equipment', 'resource', 'realm'];
// จำนวนอักษรต้นฉบับต่อ 1 คำขอแปล บทที่ยาวกว่านี้จะถูกแบ่งเป็นหลายส่วน
const CHUNK_CHAR_LIMIT = 4500;
const MAX_EXTRA_PAGES = 6;
const HANZI_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]|[\uD840-\uD87F][\uDC00-\uDFFF]/;
const HANZI_REGEX_G = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]|[\uD840-\uD87F][\uDC00-\uDFFF]/g;

function makeBookContext(book = {}) {
  return {
    bookId: book.bookId,
    title: book.title || '',
    author: book.author || '',
    genre: book.genre || 'xianxia'
  };
}

function getCurrentBookContext() {
  return makeBookContext({
    bookId: currentBookId, title: currentBookTitle, author: currentAuthor, genre: currentBookGenre
  });
}

// ---------- JSON schemas สำหรับ structured output ----------
const strictObject = (properties) => ({
  type: 'object', additionalProperties: false, properties, required: Object.keys(properties)
});
const termItemSchema = strictObject({
  src: { type: 'string' }, tgt: { type: 'string' }, category: { type: 'string', enum: TERM_CATEGORIES }
});
const numberedThSchema = { type: 'array', items: strictObject({ i: { type: 'integer' }, th: { type: 'string' } }) };

const SCHEMAS = {
  translation: strictObject({
    translatedBookTitle: { type: 'string' },
    translatedChapterTitle: { type: 'string' },
    chapter_summary: { type: 'string' },
    paragraphs: numberedThSchema,
    used_entities: { type: 'array', items: termItemSchema }
  }),
  verify: strictObject({ verified: numberedThSchema }),
  newTerms: strictObject({ newTerms: { type: 'array', items: termItemSchema } }),
  research: strictObject({ tgt: { type: 'string' }, category: { type: 'string', enum: TERM_CATEGORIES } }),
  classify: strictObject({
    classified: { type: 'array', items: strictObject({ src: { type: 'string' }, category: { type: 'string', enum: TERM_CATEGORIES } }) }
  }),
  findSource: strictObject({ src: { type: 'string' } })
};

// ---------- URL helpers ----------
function computeNextNumericUrl(url) {
  if (!url) return null;
  const match = url.match(/^(.*?)(\d+)(\.html?|\/)?$/i);
  if (!match) return null;

  const prefix = match[1];
  const numStr = match[2];
  const suffix = match[3] || '';

  const nextNum = (BigInt(numStr) + 1n).toString();
  const paddedNextNum = nextNum.padStart(numStr.length, '0');

  return `${prefix}${paddedNextNum}${suffix}`;
}

function extractBookIdFromUrl(url) {
  const m = url.match(/txt\/(\d+)\//);
  if (m) return 'book_' + m[1];
  const m2 = url.match(/book\/(\d+)/);
  if (m2) return 'book_' + m2[1];
  const encoded = btoa(encodeURIComponent(url.split('?')[0])).replace(/[^a-zA-Z0-9_-]/g, '');
  return 'book_' + encoded.substring(0, 20);
}

// เฉพาะหน้าเว็บนิยายหาไม่เจอ (ไม่นับ error จาก AI เช่น 404 model not found)
function isMissingPageError(err) {
  if (err instanceof LLMError) return false;
  const msg = err?.message || '';
  return msg === '404' || msg.includes('404') || msg.includes('ไม่พบเนื้อหา');
}

function urlBaseName(url) {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop() || '';
    return { dir: path.slice(0, path.length - last.length), base: last.replace(/\.[a-z0-9]+$/i, '') };
  } catch (e) {
    return { dir: '', base: '' };
  }
}

// หน้า 2,3,... ของบทเดียวกัน เช่น 123.html -> 123_2.html -> 123_3.html
function isContinuationPage(currentUrl, candidateUrl) {
  const cur = urlBaseName(currentUrl);
  const next = urlBaseName(candidateUrl);
  if (!cur.base || !next.base || cur.dir !== next.dir) return false;
  const root = cur.base.replace(/_\d+$/, '');
  return new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`).test(next.base);
}

// ---------- Scraper ----------
function extractNavLinks(markdown, pageUrl) {
  const links = { nextChapter: null, nextPage: null };
  const linkRegex = /\[([^\]]{0,80})\]\((\S+?)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = linkRegex.exec(markdown)) !== null) {
    const text = m[1].replace(/[\s→>›»]/g, '');
    let href;
    try { href = new URL(m[2], pageUrl).href; } catch (e) { continue; }
    if (!/^https?:/.test(href) || href.split('#')[0] === pageUrl.split('#')[0]) continue;
    if (!links.nextChapter && /下一章|下一节|下一節|下章|nextchapter/i.test(text)) links.nextChapter = href;
    else if (!links.nextPage && /下一页|下一頁|下页|nextpage|^next$/i.test(text)) links.nextPage = href;
  }
  return links;
}

function parseJinaMarkdown(md, pageUrl) {
  let rawChapTitle = "";
  let rawBookTitle = "";
  let author = "";

  const lines = md.split('\n').map(l => l.trim());
  const titleLine = lines.find(l => l.startsWith('Title:'));
  if (titleLine) {
    const fullTitle = titleLine.replace('Title:', '').trim();
    const parts = fullTitle.split(/[-_]/);
    if (parts.length >= 2) {
      rawBookTitle = parts[0].trim();
      rawChapTitle = parts[1].replace('-69书吧', '').trim();
    } else {
      rawChapTitle = fullTitle.replace('-69书吧', '').trim();
    }
  }

  const authorLine = lines.find(l => l.includes('作者：') || l.includes('作者:'));
  if (authorLine) {
    const m = authorLine.match(/作者[：:]\s*([^\s]+)/);
    if (m) author = m[1];
  }

  const filteredLines = lines.filter(l => {
    if (!l || l.length < 2) return false;
    if (l.startsWith('Title:') || l.startsWith('URL Source:') || l.startsWith('Published Time:') || l.startsWith('Markdown Content:')) return false;
    if (l.startsWith('!') || l.startsWith('[') || l.startsWith('http')) return false;
    // บรรทัดเมนูนำทางที่มีลิงก์ปนอยู่ เช่น "上一章 ← [目录](...) → [下一章](...)"
    if (/\]\((https?:)?\/?\/?[^)]*\)/.test(l)) return false;
    if (!rawChapTitle && (l.includes('第') && l.includes('章'))) {
      rawChapTitle = l;
      return false;
    }
    return true;
  });

  return {
    text: filteredLines.join('\n\n'),
    rawChapTitle,
    rawBookTitle,
    author,
    nav: extractNavLinks(md, pageUrl)
  };
}

async function fetchJinaMarkdown(url, signal) {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, { signal });
    if (!res.ok) throw new Error(res.status === 404 ? '404' : `ดึงหน้าเว็บไม่สำเร็จ (HTTP ${res.status})`);
    const md = await res.text();
    if (md.includes('404 Not Found') || md.includes('页面不存在') || (md.includes('Just a moment...') && md.length < 1500)) {
      throw new Error('404');
    }
    return md;
  } catch (e) {
    if (e.name === 'AbortError') throw new LLMError("ผู้ใช้สั่งหยุดการทำงาน", 'abort');
    throw e;
  }
}

async function scrapePage(url, signal = null) {
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { throw new Error('กรุณาใส่ URL ที่ถูกต้อง'); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('รองรับเฉพาะ URL ที่ขึ้นต้นด้วย http:// หรือ https://');

  const first = parseJinaMarkdown(await fetchJinaMarkdown(url, signal), url);
  const textParts = [first.text];
  let nav = first.nav;

  // บทที่แบ่งเป็นหลายหน้า: ตามลิงก์ "下一页" ที่ยังเป็นบทเดิมไปต่อ
  for (let page = 0; page < MAX_EXTRA_PAGES && !nav.nextChapter && nav.nextPage && isContinuationPage(url, nav.nextPage); page++) {
    try {
      const next = parseJinaMarkdown(await fetchJinaMarkdown(nav.nextPage, signal), nav.nextPage);
      if (next.text) textParts.push(next.text);
      nav = next.nav;
    } catch (e) {
      if (isAbortError(e)) throw e;
      break;
    }
  }

  const rawText = textParts.join('\n\n');
  if (!rawText || rawText.length < 40) throw new Error('ไม่พบเนื้อหานิยายในหน้าที่ดึงมาได้');

  let nextUrl = nav.nextChapter;
  let nextUrlSource = 'link';
  if (!nextUrl && nav.nextPage && !isContinuationPage(url, nav.nextPage)) nextUrl = nav.nextPage;
  if (!nextUrl) {
    nextUrl = computeNextNumericUrl(url);
    nextUrlSource = 'guess';
  }

  return {
    text: rawText,
    nextUrl,
    nextUrlSource,
    pageCount: textParts.length,
    rawChapTitle: first.rawChapTitle || "บทนิยาย",
    rawBookTitle: first.rawBookTitle || "",
    author: first.author
  };
}

function getGenreInstruction(genre) {
  switch (genre) {
    case 'xianxia':
      return `สไตล์: "เซียนเซีย / เทพเซียนบำเพ็ญเพียรเต๋า (Xianxia)"
- สรรพนาม: "ข้า - เจ้า", "ผู้อาวุโส - ศิษย์น้อง/ผู้น้อย" (ห้ามหลุด ผม/ฉัน/คุณ)
- ศัพท์เต๋า: บำเพ็ญเพียร, ลมปราณ, แก่นทองคำ, ทัณฑ์สวรรค์, วิถีสวรรค์, ยอดเขา`;
    case 'wuxia':
      return `สไตล์: "กำลังภายใน / ยุทธภพดั้งเดิม (Wuxia)"
- สรรพนาม: "ข้า - ท่าน/เจ้า", "จอมยุทธ์" (ห้ามหลุด ผม/คุณ)
- บรรยากาศยุทธจักร: สำนัก, คัมภีร์ยุทธ, ปราณคุ้มกาย, ท่องยุทธภพ, คุณธรรมน้ำมิตร`;
    case 'western_fantasy':
      return `สไตล์: "แฟนตาซีตะวันตก / ดาบและเวทมนตร์ (Western Fantasy)"
- สรรพนาม: "ข้า - เจ้า" หรือ "ฉัน - นาย" ตามความสนิทสนม
- บรรยากาศ: อัศวิน, จอมเวท, มังกร, โบสถ์, วงเวท, มานา, สัจธรรม`;
    case 'system_game':
      return `สไตล์: "ระบบ / ดันเจี้ยน / ผู้เล่น (System/Game)"
- ข้อความแจ้งเตือน: [ติ๊ง! ตรวจพบภารกิจ], [เลเวลอัป], ค่าสเตตัส
- สรรพนาม: "ฉัน - นาย" กึ่งสมัยใหม่`;
    case 'scifi':
      return `สไตล์: "ไซไฟ / มหากาพย์จักรวาล (Sci-Fi)"
- ศัพท์วิทยาศาสตร์: ยานรบ, รูหนอน, วาร์ป, คลื่นแม่เหล็ก, พันธุกรรม, มิติอวกาศ`;
    case 'horror':
      return `สไตล์: "สยองขวัญ / ระทึกขวัญเอาชีวิตรอด (Horror)"
- บรรยากาศ: วังเวง, เย็นเยียบ, เสียงลมหายใจ, กลิ่นคาว, เงาตะคุ่ม, กลิ่นอายความตาย`;
    case 'historical':
      return `สไตล์: "ย้อนยุค / ชิงบัลลังก์ / ราชสำนัก (Historical)"
- บรรยากาศ: ราชสำนัก, ขุนนาง, ราชาศัพท์จีน (กระหม่อม, พระองค์, ฝ่าบาท, ฮ่องเต้), กลศึกการเมือง`;
    case 'urban_life':
      return `สไตล์: "สังคมเมือง / ธุรกิจ / แพทย์ / รวยเงียบ (Urban Life)"
- บรรยากาศ: สังคมยุคปัจจุบัน, ภาษาพูดเป็นธรรมชาติ, ศัพท์ธุรกิจ, คลินิก, รถหรู`;
    case 'modern_romance':
      return `สไตล์: "โรแมนติก / ดราม่า / ชีวิตประจำวัน (Romance)"
- บรรยากาศ: ภาษาละมุน นุ่มนวล เน้นอารมณ์ความรู้สึก สายตาและบทสนทนาที่ลึกซึ้ง`;
    case 'fanfic':
      return `สไตล์: "แฟนฟิค / ข้ามโลกมัลติเวิร์ส (Fanfic)"
- บรรยากาศ: ภาษาเป็นกันเอง สนุกสนาน คุมบุคลิกตัวละครให้ตรงตามต้นฉบับดั้งเดิม`;
    default:
      return `สไตล์: วรรณกรรมทั่วไป อ่านลื่นไหลเป็นธรรมชาติ`;
  }
}

function rescueEmptyBrackets(thText, srcText) {
  if (!thText || !srcText) return thText;
  if (!/【\s*】|\[\s*\]/.test(thText)) return thText;

  const srcBrackets = [];
  const regexSrc = /【(.*?)】|\[(.*?)\]/g;
  let m;
  while ((m = regexSrc.exec(srcText)) !== null) {
    const val = (m[1] || m[2] || "").trim();
    if (val) srcBrackets.push(val);
  }

  if (srcBrackets.length === 0) return thText;

  let bIdx = 0;
  return thText.replace(/【\s*】|\[\s*\]/g, () => {
    if (bIdx < srcBrackets.length) {
      const rawChinese = srcBrackets[bIdx++];
      const cached = inMemoryGlossaryCache.find(x => x.src === rawChinese);
      if (cached && cached.tgt) return `【${cached.tgt}】`;
      return `【${rawChinese}】`;
    }
    return '';
  });
}

function cleanAndParseJSON(rawStr) {
  if (!rawStr) throw new Error("ผลลัพธ์ว่างเปล่า");

  const input = rawStr.replace(/```json/gi, '').replace(/```/g, '').trim();
  let str = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        str += ch;
        escaped = false;
      } else if (ch === '\\') {
        str += ch;
        escaped = true;
      } else if (ch === '"') {
        str += ch;
        inString = false;
      } else if (ch === '\n') str += '\\n';
      else if (ch === '\r') str += '\\r';
      else if (ch === '\t') str += '\\t';
      else str += ch;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ',') {
      let lookahead = i + 1;
      while (/\s/.test(input[lookahead] || '')) lookahead++;
      if (input[lookahead] === '}' || input[lookahead] === ']') continue;
    }
    str += ch;
  }

  try {
    return JSON.parse(str);
  } catch (err) {
    // กู้ย่อหน้าที่อ่านได้ ย่อหน้าที่หายจะถูกเติมทีหลังด้วยรอบ gap-fill
    const unescape = (s) => { try { return JSON.parse(`"${s}"`); } catch (e) { return s; } };
    const pick = (key) => { const m = rawStr.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`)); return m ? unescape(m[1]) : ''; };
    const paragraphs = [];
    const pRegex = /\{\s*"i"\s*:\s*(\d+)\s*,\s*"th"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/g;
    let pMatch;
    while ((pMatch = pRegex.exec(rawStr)) !== null) {
      paragraphs.push({ i: parseInt(pMatch[1], 10), th: unescape(pMatch[2]) });
    }
    if (paragraphs.length > 0) {
      return {
        translatedBookTitle: pick('translatedBookTitle'),
        translatedChapterTitle: pick('translatedChapterTitle'),
        chapter_summary: pick('chapter_summary'),
        paragraphs,
        used_entities: [],
        _partial: true
      };
    }
    throw new Error("โครงสร้าง JSON เสียหาย: " + err.message);
  }
}

// ---------- Paragraph helpers ----------
function splitSourceParagraphs(rawText) {
  return rawText.split(/\n\s*\n+/).map(t => t.trim()).filter(Boolean);
}

function chunkParagraphs(items, limit = CHUNK_CHAR_LIMIT) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const item of items) {
    const len = (item.src || '').length;
    if (current.length && size + len > limit) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// ส่งเฉพาะคำศัพท์ที่ปรากฏในข้อความจริง ลด token และให้โมเดลโฟกัส
function buildRelevantTermList(activeTerms, text) {
  return Object.entries(activeTerms)
    .filter(([src]) => src && text.includes(src))
    .sort((a, b) => b[0].length - a[0].length)
    .map(([src, v]) => `${src}=${v.resolvedTgt}`)
    .join(", ");
}

function cleanThaiOutput(th, src) {
  let out = typeof th === 'string' ? th : '';
  out = rescueEmptyBrackets(out, src);
  out = out.replace(/^——\s*/g, '').replace(/(\n)——\s*/g, '$1');
  return out.trim();
}

/**
 * หาย่อหน้าที่น่าจะแปลพลาด เพื่อส่งตรวจทานเฉพาะจุด (โหมด smart)
 * @returns {number[]} index ของย่อหน้าที่น่าสงสัย
 */
function findSuspiciousParagraphs(paragraphs, activeTerms) {
  const termEntries = Object.entries(activeTerms);
  const suspicious = [];
  paragraphs.forEach((p, idx) => {
    const th = p.th || '';
    const src = p.src || '';
    const reasons = [];
    if (HANZI_REGEX.test(th)) reasons.push('hanzi');
    if (/【\s*】|\[\s*\]/.test(th)) reasons.push('empty-bracket');
    if ((src.match(/【/g) || []).length !== (th.match(/【/g) || []).length) reasons.push('bracket-count');
    if (src.length >= 12) {
      const ratio = th.length / src.length;
      if (ratio < 0.7 || ratio > 9) reasons.push('length');
    }
    for (const [termSrc, v] of termEntries) {
      if (src.includes(termSrc) && v.resolvedTgt && !th.includes(v.resolvedTgt)) {
        reasons.push('glossary');
        break;
      }
    }
    if (reasons.length) suspicious.push(idx);
  });
  return suspicious;
}

function getVerifyMode() {
  const mode = localStorage.getItem('nov_verify_mode');
  if (['off', 'smart', 'full'].includes(mode)) return mode;
  return localStorage.getItem('nov_enable_bilingual_verify') === 'false' ? 'off' : 'smart';
}

// ---------- Verification pass ----------
async function bilingualCrossVerificationPass(paragraphs, ctx, { signal = null, onStatus = null, mode = getVerifyMode() } = {}) {
  if (!paragraphs || paragraphs.length === 0 || mode === 'off') return paragraphs;

  const activeTerms = await getActiveGlossaryForBook(ctx.bookId);
  const targetIdx = mode === 'full'
    ? paragraphs.map((_, i) => i)
    : findSuspiciousParagraphs(paragraphs, activeTerms);
  if (targetIdx.length === 0) return paragraphs;

  if (onStatus) onStatus(`🔍 ตรวจทานเทียบต้นฉบับ ${targetIdx.length}/${paragraphs.length} ย่อหน้า...`);
  const genreRule = getGenreInstruction(ctx.genre);
  const result = paragraphs.slice();
  const items = targetIdx.map(i => ({ i, src: paragraphs[i].src || '', th: paragraphs[i].th || '' }));

  for (const chunk of chunkParagraphs(items)) {
    const chunkText = chunk.map(c => c.src).join('\n');
    const termList = buildRelevantTermList(activeTerms, chunkText);
    const prompt = `คุณคือบรรณาธิการอาวุโสและผู้ตรวจสอบความถูกต้องของงานแปล (Bilingual Quality Auditor)
หน้าที่ของคุณ: ตรวจเทียบคำแปลภาษาไทยกับภาษาจีนต้นฉบับแบบย่อหน้าต่อย่อหน้า (1 ต่อ 1) แล้วแก้ไขให้ความหมายสมบูรณ์ตรงตามต้นฉบับที่สุด

แนวเรื่อง: "${ctx.genre}"
${genreRule}

กฎเหล็กสำคัญที่สุด (ฝ่าฝืนไม่ได้เด็ดขาด):
1. **ล็อกสรรพนามให้คงที่ 100% (Pronoun Lock):** ห้ามเปลี่ยนชุดสรรพนามของตัวละคร หากใช้ 'ข้า-เจ้า' หรือ 'ข้า-ท่าน' ให้คงไว้ ห้ามสลับเป็น 'ผม/ฉัน/นาย/คุณ'
2. **ความถูกต้องของใจความ:** ตรวจว่าประธาน กริยา กรรม สลับจนความหมายเพี้ยนหรือไม่ และห้ามตกหล่นคำปฏิเสธ ('ไม่', 'มิได้', 'หาได้...ไม่')
3. **คำในคลังศัพท์ต้องตรงรูปเดิม 100%:** หากย่อหน้าจีนมีคำเหล่านี้ ภาษาไทยต้องใช้คำแปลตามนี้เป๊ะๆ: [${termList}]
4. **คำในวงเล็บทึบ 【 】 หรือ [ ] ต้องมีคำแปลไทยอยู่ข้างในเสมอ** ห้ามส่งวงเล็บว่าง
5. **ภาษาไทยล้วน 100%** ห้ามมีอักษรจีนหลุดมา ห้ามใส่ขีด —— นำหน้าบทสนทนา ให้ใช้ '...' หรือ “...” และแก้คำสะกดผิด
6. ตอบกลับทุกย่อหน้าที่ส่งมา โดยใช้หมายเลข "i" เดิมของแต่ละย่อหน้า

ย่อหน้าที่ต้องตรวจทาน (i = หมายเลขย่อหน้า, src = จีนต้นฉบับ, th = คำแปลปัจจุบัน):
${JSON.stringify(chunk)}

ตอบกลับเป็น JSON เท่านั้น: {"verified":[{"i":หมายเลข,"th":"ข้อความไทยที่ตรวจทานแล้ว"}]}`;

    try {
      const parsed = await callLLMJson(prompt, { signal, onStatus, schema: SCHEMAS.verify });
      const list = Array.isArray(parsed?.verified) ? parsed.verified : [];
      const allowed = new Set(chunk.map(c => c.i));
      list.forEach(v => {
        const i = Number(v?.i);
        if (!allowed.has(i) || typeof v.th !== 'string') return;
        const cleaned = cleanThaiOutput(v.th, result[i].src).replace(HANZI_REGEX_G, '').trim();
        if (cleaned) result[i] = { ...result[i], th: cleaned };
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      console.warn("Bilingual verification fallback:", err);
    }
  }
  return result;
}

async function saveUsedEntities(entities, bookId) {
  if (!Array.isArray(entities)) return;
  for (const ent of entities) {
    if (typeof ent?.src !== 'string' || typeof ent?.tgt !== 'string' || !ent.src || !ent.tgt) continue;
    const cleanSrc = cleanTermString(ent.src);
    const cleanTgt = cleanTermString(ent.tgt);
    const existing = inMemoryGlossaryCache.find(x => x.src === cleanSrc);
    if (!existing) {
      await dbSaveGlossaryItem({
        src: cleanSrc,
        tgt: cleanTgt,
        category: TERM_CATEGORIES.includes(ent.category) ? ent.category : 'character',
        scope: 'tagged',
        books: [bookId],
        count: 1,
        overrides: {},
        updatedAt: Date.now()
      });
    } else {
      if (!Array.isArray(existing.books)) existing.books = [];
      if (!existing.books.includes(bookId)) existing.books.push(bookId);
      existing.count = (existing.count || 1) + 1;
      existing.updatedAt = Date.now();
      await dbSaveGlossaryItem(existing);
    }
  }
}

// ---------- Translation ----------
function buildTranslationPrompt(chunk, ctx, { termList, isFirstChunk, partLabel, rawChapTitle, rawBookTitle, prevSummary, prevTranslatedTail }) {
  const genreRule = getGenreInstruction(ctx.genre);
  const authorCtx = ctx.author ? `ผู้แต่ง: "${ctx.author}"` : '';
  const bookCtx = ctx.title ? `นิยายเรื่อง: "${ctx.title}"` : '';

  return `คุณคือนักแปลนิยายมืออาชีพ แปลเนื้อหาภาษาจีนต่อไปนี้เป็นภาษาไทยให้อ่านสนุก ไหลลื่น สละสลวย เป็นธรรมชาติ โดยคงความหมายและรูปประโยคให้ใกล้เคียงต้นฉบับที่สุด

สไตล์และบรรยากาศหลักของแนวเรื่อง:
${genreRule}

กฎการปรับแต่งโทนอารมณ์ตามฉาก (Scene-Adaptive Translation) และถอดรหัสสำนวน:
1. **ฉากต่อสู้/ระทึกขวัญ:** ใช้ประโยคสั้น กระชับ ใช้คำกริยาแสดงความรวดเร็วและหนักหน่วง ตัดคำเชื่อมเยิ่นเย้อเพื่อสร้างจังหวะที่ดุเดือด
2. **ฉากบทสนทนา/อุบาย:** ถ่ายทอดคารมให้เฉียบคม รักษาบุคลิกและระดับความสัมพันธ์ของตัวละครให้คงที่
3. **ฉากฝึกตน/บรรยายปรัชญา:** ใช้ศัพท์แสงวรรณกรรมที่ลึกซึ้ง ให้ความรู้สึกขลังและสง่างาม
4. **สำนวนจีน 4 ตัวอักษร (成语):** ห้ามแปลตรงตัวแบบคำต่อคำจนขัดหู ให้ถอดความหมายเป็นสำนวนไทยหรือภาษาเขียนที่สละสลวยและเข้าใจง่ายทันที แต่ **คำในคลังศัพท์ต้องคงเดิม 100% เหนือกฎสำนวน**

ข้อมูลบริบท:
- ${bookCtx} ${authorCtx}
${prevSummary ? `- เหตุการณ์ในตอนก่อนหน้า: "${prevSummary}"` : ''}
${partLabel ? `- ข้อความนี้คือ${partLabel}ของบท` : ''}
${prevTranslatedTail ? `- ย่อหน้าก่อนหน้าที่แปลแล้ว (ใช้รักษาความต่อเนื่องของสำนวน ห้ามแปลซ้ำ): "${prevTranslatedTail}"` : ''}

กฎการเทียบเคียงและล็อกคำศัพท์ (3-Tier Priority):
1. Tier 1 (ตรงเรื่อง): หากเป็นชื่อตัวละครหรือสถานที่ในนิยายเรื่อง "${ctx.title}" ให้ใช้คำแปล/ทับศัพท์ที่ตรงกับฉบับแปลไทย
2. Tier 2 (ผู้แต่ง/จักรวาลเดียวกัน): หากไม่พบในเรื่องนี้ ให้เทียบเคียงกับศัพท์ที่ใช้ในผลงานอื่นของ ${authorCtx} ในจักรวาลเดียวกัน
3. Tier 3 (มาตรฐานแนวเรื่อง): หากเป็นคำใหม่ ให้ใช้คำแปลที่สละสลวยตามมาตรฐานวรรณกรรมนิยายแนว "${ctx.genre}"

กฎเหล็กเรื่องการจัดย่อหน้า สรรพนาม และโครงสร้าง (สำคัญสูงสุด):
1. **ล็อกสรรพนามให้คงที่ 100%:** สรรพนามตัวละครต้องสอดคล้องกันตลอดทั้งบท (เช่น หากใช้ 'ข้า-เจ้า' ต้องคงไว้ตามนั้น ห้ามสลับเป็น 'ผม/ฉัน/คุณ' เด็ดขาด)
2. ${isFirstChunk ? `แปลชื่อตอนและชื่อเรื่องภาษาจีนให้สละสลวยตรงความหมาย
   - ชื่อตอนต้นฉบับ: "${rawChapTitle}"
   - ชื่อเรื่องต้นฉบับ: "${rawBookTitle}"` : 'ส่วนนี้ไม่ต้องแปลชื่อตอน/ชื่อเรื่อง ให้ส่งสตริงว่าง "" ในสองฟิลด์นั้น'}
3. **แปลทุกย่อหน้าแยกกันแบบ 1 ต่อ 1** ตอบกลับย่อหน้าละ 1 รายการพร้อมหมายเลข "i" เดิม ห้ามรวมหรือข้ามย่อหน้า และไม่ต้องส่งข้อความจีนกลับมา
4. คำศัพท์เฉพาะที่ต้องล็อกคำแปล 100%: [${termList}]
5. **ข้อความในวงเล็บทึบ 【 】 หรือ [ ] ต้องแปลเป็นภาษาไทยเสมอ ห้ามส่งวงเล็บว่างเปล่า 【 】 เด็ดขาด เช่น 【大海水】 -> 【น้ำมหาสมุทร】, 【石榴木】 -> 【ไม้ทับทิม】, 【城头土】 -> 【ดินหัวเมือง】**
6. ในบทสนทนา ให้ใช้เครื่องหมายอัญประกาศ ' หรือ “ ” ห้ามใช้เครื่องหมาย " ซ้ำซ้อน และ **ห้ามใส่ขีด —— นำหน้าบทสนทนา**
7. สรุปเหตุการณ์สำคัญของข้อความนี้ในฟิลด์ "chapter_summary" ความยาว 1-2 ประโยค เพื่อใช้ต่อบริบทในบทถัดไป
8. สกัด "used_entities" (ชื่อเฉพาะสำคัญและระดับพลังที่ปรากฏ) แนบกลับมาด้วยเพื่อบันทึกลงคลังศัพท์

ผลลัพธ์ต้องส่งกลับเป็น JSON Object ตามโครงสร้างนี้เท่านั้น:
{
  "translatedBookTitle": "คำแปลชื่อเรื่องภาษาไทย",
  "translatedChapterTitle": "คำแปลชื่อตอนภาษาไทย",
  "chapter_summary": "สรุปสั้นๆ 1-2 ประโยค",
  "paragraphs": [ {"i": 0, "th": "คำแปลไทยของย่อหน้าหมายเลข 0"} ],
  "used_entities": [ {"src": "คำจีน", "tgt": "คำแปลไทย", "category": "character|title|location|skill|equipment|resource|realm"} ]
}

ย่อหน้าต้นฉบับที่ต้องแปล (i = หมายเลขย่อหน้า):
${JSON.stringify(chunk.map(c => ({ i: c.i, src: c.src })))}`;
}

/**
 * แปล 1 ชุดย่อหน้า ถ้าผลถูกตัดเพราะยาวเกิน จะแบ่งครึ่งแล้วแปลใหม่อัตโนมัติ
 * @returns {{ map: Map<number,string>, meta: object, entities: object[] }}
 */
async function translateChunkAdaptive(chunk, ctx, options) {
  try {
    const prompt = buildTranslationPrompt(chunk, ctx, options);
    const parsed = await callLLMJson(prompt, { signal: options.signal, onStatus: options.onStatus, schema: SCHEMAS.translation });
    const allowed = new Set(chunk.map(c => c.i));
    const map = new Map();
    const list = Array.isArray(parsed?.paragraphs) ? parsed.paragraphs : [];
    list.forEach((p, pos) => {
      // รองรับโมเดลที่ไม่ส่ง i มา (ส่ง array ของ string หรือ {th}) โดยเทียบตามลำดับ
      const i = (p && typeof p === 'object' && Number.isInteger(Number(p.i))) ? Number(p.i) : chunk[pos]?.i;
      const th = typeof p === 'string' ? p : p?.th;
      if (allowed.has(i) && typeof th === 'string' && th.trim() && !map.has(i)) map.set(i, th);
    });
    return { map, meta: parsed || {}, entities: Array.isArray(parsed?.used_entities) ? parsed.used_entities : [] };
  } catch (err) {
    if (err?.kind === 'truncated' && chunk.length > 1) {
      const mid = Math.ceil(chunk.length / 2);
      if (options.onStatus) options.onStatus(`ผลลัพธ์ยาวเกินขีดจำกัด กำลังแบ่งส่วนแปลใหม่ (${chunk.length} ย่อหน้า)...`);
      const a = await translateChunkAdaptive(chunk.slice(0, mid), ctx, options);
      const b = await translateChunkAdaptive(chunk.slice(mid), ctx, { ...options, isFirstChunk: false });
      return {
        map: new Map([...a.map, ...b.map]),
        meta: { ...b.meta, ...a.meta, chapter_summary: [a.meta.chapter_summary, b.meta.chapter_summary].filter(Boolean).join(' ') },
        entities: [...a.entities, ...b.entities]
      };
    }
    throw err;
  }
}

async function executeApiCall(rawText, ctx, { rawChapTitle = "", rawBookTitle = "", prevSummary = "", signal = null, onStatus = null } = {}) {
  const sourceParas = splitSourceParagraphs(rawText);
  if (sourceParas.length === 0) throw new Error('ไม่พบย่อหน้าต้นฉบับสำหรับแปล');
  const items = sourceParas.map((src, i) => ({ i, src }));
  const chunks = chunkParagraphs(items);
  const activeTerms = await getActiveGlossaryForBook(ctx.bookId);
  const providerLabel = `${LLM_PROVIDERS[getActiveProvider()].label} (${getActiveLlmConfig().model})`;

  const translated = new Map();
  const summaries = [];
  let bookTitle = '';
  let chapterTitle = '';
  let entities = [];

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const partLabel = chunks.length > 1 ? `ส่วนที่ ${c + 1}/${chunks.length}` : '';
    if (onStatus) onStatus(`กำลังแปลผ่าน ${providerLabel}${partLabel ? ` — ${partLabel}` : ''}...`);
    const lastIdx = chunk[0].i - 1;
    const res = await translateChunkAdaptive(chunk, ctx, {
      termList: buildRelevantTermList(activeTerms, chunk.map(x => x.src).join('\n')),
      isFirstChunk: c === 0,
      partLabel,
      rawChapTitle,
      rawBookTitle,
      prevSummary,
      prevTranslatedTail: lastIdx >= 0 ? (translated.get(lastIdx) || '').slice(-300) : '',
      signal,
      onStatus
    });
    res.map.forEach((th, i) => translated.set(i, th));
    if (c === 0) {
      bookTitle = res.meta.translatedBookTitle || '';
      chapterTitle = res.meta.translatedChapterTitle || '';
    }
    if (res.meta.chapter_summary) summaries.push(res.meta.chapter_summary);
    entities = entities.concat(res.entities);
  }

  // รอบเก็บตก: ย่อหน้าที่โมเดลรวม/ข้ามไป แปลใหม่เฉพาะย่อหน้านั้น
  const missing = items.filter(it => !translated.has(it.i));
  if (missing.length > 0) {
    if (onStatus) onStatus(`กำลังแปลย่อหน้าที่ตกหล่น ${missing.length} ย่อหน้า...`);
    for (const chunk of chunkParagraphs(missing)) {
      try {
        const res = await translateChunkAdaptive(chunk, ctx, {
          termList: buildRelevantTermList(activeTerms, chunk.map(x => x.src).join('\n')),
          isFirstChunk: false,
          partLabel: 'ย่อหน้าที่ตกหล่นบางส่วน',
          prevSummary,
          signal,
          onStatus
        });
        res.map.forEach((th, i) => translated.set(i, th));
      } catch (err) {
        if (isAbortError(err)) throw err;
        console.warn('Gap-fill failed:', err);
      }
    }
  }

  const stillMissing = items.filter(it => !translated.has(it.i)).length;
  if (translated.size === 0) throw new Error('โมเดลไม่ส่งย่อหน้าคำแปลที่อ่านได้กลับมา');
  if (stillMissing > items.length * 0.3) {
    throw new Error(`แปลได้ไม่ครบ (ขาด ${stillMissing}/${items.length} ย่อหน้า) กรุณาลองใหม่`);
  }

  let paragraphs = items.map(it => ({
    th: translated.has(it.i)
      ? cleanThaiOutput(translated.get(it.i), it.src)
      : '⚠️ (ย่อหน้านี้แปลไม่สำเร็จ แตะเพื่อดูต้นฉบับ หรือกด 🔄 เพื่อแปลบทนี้ใหม่)',
    src: it.src
  }));

  await saveUsedEntities(entities, ctx.bookId);

  paragraphs = await bilingualCrossVerificationPass(paragraphs, ctx, { signal, onStatus });
  paragraphs = paragraphs.map(p => ({ th: cleanThaiOutput(p.th, p.src) || p.th, src: p.src }));

  return {
    bookTitle: bookTitle || rawBookTitle,
    chapterTitle: chapterTitle || rawChapTitle,
    summary: summaries.join(' ').slice(0, 600),
    paragraphs,
    missingCount: stillMissing
  };
}

/**
 * Pipeline แปล 1 บท: สกัดศัพท์ใหม่ -> แปล (แบ่งส่วนอัตโนมัติ) -> ตรวจทาน
 * retry/หมุนคีย์อยู่ใน callLLM แล้ว ที่นี่จึงไม่ต้องวนซ้ำเอง
 */
async function translateChapter(rawText, ctx, { onStatus = null, signal = null, rawChapTitle = "", rawBookTitle = "", prevSummary = "" } = {}) {
  if (!ctx?.bookId) throw new Error('ไม่พบข้อมูลนิยายสำหรับการแปล');
  throwIfAborted(signal);

  if (onStatus) onStatus("กำลังสแกนหาชื่อเฉพาะและระดับพลังใหม่...");
  try {
    await extractAndStoreAutoGlossary(rawText, ctx, { signal, onStatus });
  } catch (err) {
    if (isAbortError(err)) throw err;
    console.warn("Auto-Glossary scan skipped:", err.message);
  }

  return executeApiCall(rawText, ctx, { rawChapTitle, rawBookTitle, prevSummary, signal, onStatus });
}
