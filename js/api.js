// ==================== SCRAPER & TRANSLATION ENGINE ====================
// ทุกฟังก์ชันแปลรับ BookContext ({ bookId, title, author, genre }) เป็นพารามิเตอร์
// ห้ามอ่าน currentBookId/currentBookGenre ตรงๆ เพราะงานเบื้องหลังอาจทำงานกับเรื่องอื่นอยู่

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

async function scrapePage(url, signal = null) {
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { throw new Error('กรุณาใส่ URL ที่ถูกต้อง'); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('รองรับเฉพาะ URL ที่ขึ้นต้นด้วย http:// หรือ https://');

  let rawText = "";
  let rawChapTitle = "";
  let rawBookTitle = "";
  let author = "";

  try {
    const res = await fetch(`https://r.jina.ai/${url}`, { signal });
    if (res.ok) {
      const md = await res.text();
      if (md.includes('404 Not Found') || md.includes('页面不存在') || (md.includes('Just a moment...') && md.length < 1500)) {
        throw new Error(`404`);
      }

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
        if (!rawChapTitle && (l.includes('第') && l.includes('章'))) {
          rawChapTitle = l;
          return false;
        }
        return true;
      });
      rawText = filteredLines.join('\n\n');
    } else {
      throw new Error(res.status === 404 ? '404' : `ดึงหน้าเว็บไม่สำเร็จ (HTTP ${res.status})`);
    }
  } catch(e) {
    if (e.name === 'AbortError') throw new LLMError("ผู้ใช้สั่งหยุดการทำงาน", 'abort');
    throw e;
  }

  if (!rawText || rawText.length < 40) throw new Error('ไม่พบเนื้อหานิยายในหน้าที่ดึงมาได้');

  return {
    text: rawText,
    nextUrl: computeNextNumericUrl(url),
    rawChapTitle: rawChapTitle || "บทนิยาย",
    rawBookTitle: rawBookTitle || "",
    author: author
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
    const paragraphs = [];
    let bookTitle = "";
    let chapterTitle = "";
    let summary = "";

    const bookMatch = rawStr.match(/"translatedBookTitle"\s*:\s*"([^"]+)"/);
    if (bookMatch) bookTitle = bookMatch[1];

    const chapMatch = rawStr.match(/"translatedChapterTitle"\s*:\s*"([^"]+)"/);
    if (chapMatch) chapterTitle = chapMatch[1];

    const sumMatch = rawStr.match(/"chapter_summary"\s*:\s*"([^"]+)"/);
    if (sumMatch) summary = sumMatch[1];

    const pRegex = /\{\s*"th"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"src"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/g;
    let pMatch;
    while ((pMatch = pRegex.exec(rawStr)) !== null) {
      paragraphs.push({
        th: pMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
        src: pMatch[2].replace(/\\n/g, '\n').replace(/\\"/g, '"')
      });
    }

    if (paragraphs.length > 0) {
      return {
        translatedBookTitle: bookTitle,
        translatedChapterTitle: chapterTitle,
        chapter_summary: summary,
        paragraphs: paragraphs
      };
    }
    throw new Error("โครงสร้าง JSON เสียหาย: " + err.message);
  }
}

async function bilingualCrossVerificationPass(paragraphs, ctx, { signal = null, onStatus = null } = {}) {
  if (!paragraphs || paragraphs.length === 0) return paragraphs;

  if (onStatus) onStatus("🔍 กำลังตรวจสอบความถูกต้องเทียบต้นฉบับสองภาษา (Bilingual Cross-Verification)...");

  const activeTerms = await getActiveGlossaryForBook(ctx.bookId);
  const termList = Object.entries(activeTerms).map(([k, v]) => `${k}=${v.resolvedTgt}`).join(", ");
  const genreRule = getGenreInstruction(ctx.genre);

  const prompt = `คุณคือบรรณาธิการอาวุโสและผู้ตรวจสอบความถูกต้องของงานแปล (Bilingual Quality Auditor)
หน้าที่ของคุณ: ตรวจเทียบคำแปลภาษาไทยกับภาษาจีนต้นฉบับแบบย่อหน้าต่อย่อหน้า (1 ต่อ 1) เพื่อให้ความหมายสมบูรณ์ตรงตามต้นฉบับที่สุด

แนวเรื่อง: "${ctx.genre}"
${genreRule}

กฎเหล็กสำคัญที่สุด (ฝ่าฝืนไม่ได้เด็ดขาด):
1. **ล็อกสรรพนามให้คงที่ 100% (Pronoun Lock):**
   - ห้ามเปลี่ยนชุดสรรพนามของตัวละครเด็ดขาด! หากประโยคใช้ 'ข้า-เจ้า' หรือ 'ข้า-ท่าน' ให้คงไว้ตามนั้น ห้ามสลับเป็น 'ผม/ฉัน/นาย/คุณ' เด็ดขาด
2. **ความถูกต้องของใจความ (Semantic Accuracy):**
   - ตรวจสอบว่าประธาน กริยา กรรม สลับตำแหน่งจนความหมายเพี้ยนหรือไม่ (เช่น ใครเป็นผู้ลงมือ ใครเป็นฝ่ายถูกกระทำ)
   - ตรวจสอบคำปฏิเสธและเงื่อนไข (ห้ามตกหล่นคำว่า 'ไม่', 'มิได้', 'หาได้...ไม่')
3. **รักษาคำใน [Glossary] ให้ตรงรูปเดิม 100%:**
   - หากย่อหน้าจีนมีคำเหล่านี้ ปลายทางภาษาไทยต้องใช้คำแปลตามนี้เป๊ะๆ ห้ามดัดแปลง ห้ามเติมคำสร้อย:
   [${termList}]
4. **คำในวงเล็บทึบ 【 】 หรือ [ ] ต้องแปลเป็นภาษาไทยเสมอ:**
   - ห้ามส่งวงเล็บเปล่า 【 】 หรือ [ ] กลับมาเด็ดขาด ทุกวงเล็บต้องมีคำแปลภาษาไทยที่ถูกต้องอยู่ข้างใน (เช่น 【大海水】 -> 【น้ำมหาสมุทร】, 【石榴木】 -> 【ไม้ทับทิม】)
5. **ความสะอาดของภาษาไทย:**
   - ผลลัพธ์ต้องเป็นภาษาไทยล้วน 100% ห้ามมีตัวอักษรจีน (Hanzi) หลุดรอดมาเด็ดขาด
   - **ห้ามใส่เครื่องหมายขีดสนทนา —— นำหน้าประโยคเด็ดขาด** ให้ใช้อัญประกาศ '...' หรือ “...” ตามปกติ
   - ตรวจแก้คำสะกดผิดภาษาไทยที่พบบ่อย
6. **รักษาจำนวนย่อหน้าเดิม 100%**: จำนวนผลลัพธ์ใน array "verified_paragraphs" ต้องเท่ากับต้นฉบับที่ส่งเข้ามา (${paragraphs.length} ย่อหน้า)

เนื้อหาคู่ย่อหน้าที่ต้องตรวจทาน:
${JSON.stringify(paragraphs.map(p => ({ src: p.src || "", th: p.th || "" })))}

จงตอบกลับเป็น JSON Object ในรูปแบบนี้เท่านั้น:
{
  "verified_paragraphs": [
    "ข้อความภาษาไทยย่อหน้าที่ 1 ที่ตรวจทานแล้ว (ไม่มีขีด —— และไม่มีวงเล็บเปล่า)",
    "ข้อความภาษาไทยย่อหน้าที่ 2 ที่ตรวจทานแล้ว (ไม่มีขีด —— และไม่มีวงเล็บเปล่า)"
  ]
}`;

  try {
    const parsed = await callLLMJson(prompt, { signal, onStatus });
    const verifiedList = parsed.verified_paragraphs || [];

    if (Array.isArray(verifiedList) && verifiedList.length === paragraphs.length) {
      return paragraphs.map((p, idx) => {
        let verifiedText = verifiedList[idx] || p.th;
        if (typeof verifiedText === 'string') {
          verifiedText = rescueEmptyBrackets(verifiedText, p.src);
          verifiedText = verifiedText.replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uD840-\uD87F][\uDC00-\uDFFF]?/g, '');
          verifiedText = verifiedText.replace(/^——\s*/g, '').replace(/(\n)——\s*/g, '$1').trim();
        }
        return {
          th: verifiedText || p.th,
          src: p.src
        };
      });
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
    console.warn("Bilingual verification fallback:", err);
  }
  return paragraphs;
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
        category: ent.category || 'character',
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

async function executeApiCall(rawText, ctx, { rawChapTitle = "", rawBookTitle = "", prevSummary = "", signal = null, onStatus = null } = {}) {
  const activeTerms = await getActiveGlossaryForBook(ctx.bookId);
  const termList = Object.entries(activeTerms).map(([k,v]) => `${k}=${v.resolvedTgt}`).join(", ");
  const genreRule = getGenreInstruction(ctx.genre);

  const authorCtx = ctx.author ? `ผู้แต่ง: "${ctx.author}"` : '';
  const bookCtx = ctx.title ? `นิยายเรื่อง: "${ctx.title}"` : '';

  const prompt = `คุณคือนักแปลนิยายมืออาชีพ แปลเนื้อหาภาษาจีนต่อไปนี้เป็นภาษาไทยให้อ่านสนุก ไหลลื่น สละสลวย เป็นธรรมชาติ โดยคงความหมายและรูปประโยคให้ใกล้เคียงต้นฉบับที่สุด

สไตล์และบรรยากาศหลักของแนวเรื่อง:
${genreRule}

กฎการปรับแต่งโทนอารมณ์ตามฉาก (Scene-Adaptive Translation) และถอดรหัสสำนวน:
1. **ฉากต่อสู้/ระทึกขวัญ:** ใช้ประโยคสั้น กระชับ ใช้คำกริยาแสดงความรวดเร็วและหนักหน่วง ตัดคำเชื่อมเยิ่นเย้อเพื่อสร้างจังหวะที่ดุเดือด
2. **ฉากบทสนทนา/อุบาย:** ถ่ายทอดคารมให้เฉียบคม รักษาบุคลิกและระดับความสัมพันธ์ของตัวละครให้คงที่
3. **ฉากฝึกตน/บรรยายปรัชญา:** ใช้ศัพท์แสงวรรณกรรมที่ลึกซึ้ง ให้ความรู้สึกขลังและสง่างาม
4. **สำนวนจีน 4 ตัวอักษร (成语):** ห้ามแปลตรงตัวแบบคำต่อคำจนขัดหู ให้ถอดความหมายเป็นสำนวนไทยหรือภาษาเขียนที่สละสลวยและเข้าใจง่ายทันที แต่ **คำใน [Glossary] ต้องคงเดิม 100% เหนือกฎสำนวน**

ข้อมูลบริบท:
- ${bookCtx} ${authorCtx}
${prevSummary ? `- เหตุการณ์ในตอนก่อนหน้า: "${prevSummary}"` : ''}

กฎการเทียบเคียงและล็อกคำศัพท์ (3-Tier Priority):
1. Tier 1 (ตรงเรื่อง): หากเป็นชื่อตัวละครหรือสถานที่ในนิยายเรื่อง "${ctx.title}" ให้ใช้คำแปล/ทับศัพท์ที่ตรงกับฉบับแปลไทย
2. Tier 2 (ผู้แต่ง/จักรวาลเดียวกัน): หากไม่พบในเรื่องนี้ ให้เทียบเคียงกับศัพท์ที่ใช้ในผลงานอื่นของ ${authorCtx} ในจักรวาลเดียวกัน
3. Tier 3 (มาตรฐานแนวเรื่อง): หากเป็นคำใหม่ ให้ใช้คำแปลที่สละสลวยตามมาตรฐานวรรณกรรมนิยายแนว "${ctx.genre}"

กฎเหล็กเรื่องการจัดย่อหน้า สรรพนาม และโครงสร้าง (สำคัญสูงสุด):
1. **ล็อกสรรพนามให้คงที่ 100%:** สรรพนามตัวละครต้องสอดคล้องกันตลอดทั้งบท (เช่น หากใช้ 'ข้า-เจ้า' ต้องคงไว้ตามนั้น ห้ามสลับเป็น 'ผม/ฉัน/คุณ' เด็ดขาด)
2. แปลชื่อตอนและชื่อเรื่องภาษาจีนให้สละสลวยตรงความหมาย
   - ชื่อตอนต้นฉบับ: "${rawChapTitle}"
   - ชื่อเรื่องต้นฉบับ: "${rawBookTitle}"
3. ห้ามรวบย่อหน้ารวมกันเป็นก้อนเดียวเด็ดขาด แยกย่อหน้าแปลให้ตรงกับต้นฉบับแบบ 1 ต่อ 1
4. คำศัพท์เฉพาะที่ต้องล็อกคำแปล 100%: [${termList}]
5. **ข้อความในวงเล็บทึบ 【 】 หรือ [ ] ต้องแปลเป็นภาษาไทยเสมอ ห้ามส่งวงเล็บว่างเปล่า 【 】 เด็ดขาด เช่น 【大海水】 -> 【น้ำมหาสมุทร】, 【石榴木】 -> 【ไม้ทับทิม】, 【城头土】 -> 【ดินหัวเมือง】**
6. ในบทสนทนา ให้ใช้เครื่องหมายอัญประกาศ ' หรือ “ ” ห้ามใช้เครื่องหมาย " ซ้ำซ้อน และ **ห้ามใส่ขีด —— นำหน้าบทสนทนา**
7. สรุปเหตุการณ์สำคัญของบทนี้ในฟิลด์ "chapter_summary" ความยาว 1-2 ประโยค เพื่อใช้ต่อบริบทในบทถัดไป
8. สกัด "used_entities" (ชื่อเฉพาะสำคัญและระดับพลังที่ปรากฏในบทนี้) แนบกลับมาด้วยเพื่อบันทึกลงคลังศัพท์

ผลลัพธ์ต้องส่งกลับเป็น JSON Object ตามโครงสร้างนี้เท่านั้น:
{
  "translatedBookTitle": "คำแปลชื่อเรื่องภาษาไทย",
  "translatedChapterTitle": "คำแปลชื่อตอนภาษาไทย",
  "chapter_summary": "สรุปสั้นๆ 1-2 ประโยคว่าในบทนี้เกิดอะไรขึ้นบ้างเพื่อส่งต่อบริบท",
  "paragraphs": [
    {"th": "คำแปลไทยของย่อหน้านั้น (มีคำแปลในวงเล็บครบถ้วน)", "src": "ข้อความจีนของย่อหน้านั้น"}
  ],
  "used_entities": [
    {"src": "คำจีน", "tgt": "คำแปลไทย", "category": "character|title|location|skill|equipment|resource|realm"}
  ]
}`;

  if (onStatus) onStatus(`กำลังแปลผ่าน ${LLM_PROVIDERS[getActiveProvider()].label} (${getActiveLlmConfig().model})...`);
  const parsedResult = await callLLMJson(`${prompt}\n\nเนื้อหาที่ต้องแปล:\n${rawText}`, { signal, onStatus });

  const rawParagraphs = rawText.split(/\n\s*\n+/).map(text => text.trim()).filter(Boolean);
  let paragraphs = Array.isArray(parsedResult) ? parsedResult : parsedResult?.paragraphs;
  if (!Array.isArray(paragraphs)) throw new Error('ผลแปลไม่มีรายการย่อหน้า กรุณาลองใหม่');
  paragraphs = paragraphs.map((p, idx) => {
    if (typeof p === 'string') return { th: p, src: rawParagraphs[idx] || '' };
    return {
      th: typeof p?.th === 'string' ? p.th : '',
      src: typeof p?.src === 'string' ? p.src : (rawParagraphs[idx] || '')
    };
  }).filter(p => p.th.trim());
  if (paragraphs.length === 0) throw new Error('โมเดลไม่ส่งย่อหน้าคำแปลที่อ่านได้กลับมา');

  paragraphs = paragraphs.map(p => ({
    th: rescueEmptyBrackets(p.th, p.src),
    src: p.src
  }));

  await saveUsedEntities(parsedResult?.used_entities, ctx.bookId);

  const isBilingualVerifyEnabled = localStorage.getItem('nov_enable_bilingual_verify') !== 'false';
  if (isBilingualVerifyEnabled) {
    paragraphs = await bilingualCrossVerificationPass(paragraphs, ctx, { signal, onStatus });
  }

  const formattedParas = [];
  paragraphs.forEach(item => {
    let cleanTh = item.th || "";
    cleanTh = rescueEmptyBrackets(cleanTh, item.src);
    cleanTh = cleanTh.replace(/^——\s*/g, '').replace(/(\n)——\s*/g, '$1');
    if (cleanTh.trim()) formattedParas.push({ th: cleanTh, src: item.src || "" });
  });

  return {
    bookTitle: parsedResult.translatedBookTitle || rawBookTitle,
    chapterTitle: parsedResult.translatedChapterTitle || rawChapTitle,
    summary: parsedResult.chapter_summary || "",
    paragraphs: formattedParas
  };
}

/**
 * Pipeline แปล 1 บท: สกัดศัพท์ใหม่ -> แปล -> (ตรวจทาน)
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
