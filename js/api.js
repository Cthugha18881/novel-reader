// ==================== API & TRANSLATION ENGINE ====================
let apiKeyPool = [];
let currentApiKeyIndex = 0;
let activeAbortController = null;
let retryAbortRequested = false;

function getActiveApiKey() {
  if (!apiKeyPool || apiKeyPool.length === 0) {
    const singleKey = (localStorage.getItem('nov_gemini_key') || "").trim();
    return singleKey;
  }
  return apiKeyPool[currentApiKeyIndex] || apiKeyPool[0];
}

function rotateApiKey() {
  if (apiKeyPool && apiKeyPool.length > 1) {
    currentApiKeyIndex = (currentApiKeyIndex + 1) % apiKeyPool.length;
    console.log(`[KeyPool] Rotated to Key #${currentApiKeyIndex + 1} of ${apiKeyPool.length}`);
  }
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
  return 'book_' + btoa(url.split('?')[0]).substring(0, 16);
}

async function scrapePage(url, signal = null) {
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
    } else if (res.status === 404) {
      throw new Error('404');
    }
  } catch(e) {
    if (e.name === 'AbortError') throw new Error("คำสั่งถูกยกเลิกแล้ว");
    throw e;
  }

  if (!rawText || rawText.length < 40) throw new Error("404");

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

  let str = rawStr.replace(/```json/gi, '').replace(/```/g, '').trim();
  str = str.replace(/(?<!\\)[\r\n\t]/g, (match) => {
    if (match === '\n') return '\\n';
    if (match === '\r') return '\\r';
    if (match === '\t') return '\\t';
    return match;
  });
  str = str.replace(/,\s*([\]}])/g, '$1');

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

async function bilingualCrossVerificationPass(paragraphs, modelToUse, signal = null, onStatusUpdate = null) {
  const activeKey = getActiveApiKey();
  const genre = currentBookGenre || "xianxia";
  if (!activeKey || !paragraphs || paragraphs.length === 0) return paragraphs;

  if (onStatusUpdate) onStatusUpdate("🔍 กำลังตรวจสอบความถูกต้องเทียบต้นฉบับสองภาษา (Bilingual Cross-Verification)...");

  const activeTerms = await getActiveGlossaryForCurrentBook();
  const termList = Object.entries(activeTerms).map(([k, v]) => `${k}=${v.resolvedTgt}`).join(", ");
  const genreRule = getGenreInstruction(genre);

  const prompt = `คุณคือบรรณาธิการอาวุโสและผู้ตรวจสอบความถูกต้องของงานแปล (Bilingual Quality Auditor)
หน้าที่ของคุณ: ตรวจเทียบคำแปลภาษาไทยกับภาษาจีนต้นฉบับแบบย่อหน้าต่อย่อหน้า (1 ต่อ 1) เพื่อให้ความหมายสมบูรณ์ตรงตามต้นฉบับที่สุด

แนวเรื่อง: "${genre}"
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
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${activeKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    if (!res.ok) {
      if (res.status === 429) rotateApiKey();
      return paragraphs;
    }

    const data = await res.json();
    const outText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outText) return paragraphs;

    const parsed = JSON.parse(outText);
    const verifiedList = parsed.verified_paragraphs || [];

    if (Array.isArray(verifiedList) && verifiedList.length === paragraphs.length) {
      return paragraphs.map((p, idx) => {
        let verifiedText = verifiedList[idx] || p.th;
        if (typeof verifiedText === 'string') {
          verifiedText = rescueEmptyBrackets(verifiedText, p.src);
          verifiedText = verifiedText.replace(/[\u4e00-\u9fa5]+/g, '');
          verifiedText = verifiedText.replace(/^——\s*/g, '').replace(/(\n)——\s*/g, '$1').trim();
        }
        return {
          th: verifiedText || p.th,
          src: p.src
        };
      });
    }
  } catch (err) {
    console.warn("Bilingual verification fallback:", err);
  }
  return paragraphs;
}

async function executeApiCall(rawText, modelToUse, rawChapTitle = "", rawBookTitle = "", prevSummary = "", signal = null, onStatusUpdate = null) {
  const activeKey = getActiveApiKey();
  const genre = currentBookGenre || "xianxia";

  if (!activeKey) throw new Error("กรุณาใส่ API Key ในเมนู 'ตั้งค่า' ก่อน");

  const activeTerms = await getActiveGlossaryForCurrentBook();
  const termList = Object.entries(activeTerms).map(([k,v]) => `${k}=${v.resolvedTgt}`).join(", ");
  const genreRule = getGenreInstruction(genre);

  const authorCtx = currentAuthor ? `ผู้แต่ง: "${currentAuthor}"` : '';
  const bookCtx = currentBookTitle ? `นิยายเรื่อง: "${currentBookTitle}"` : '';

  const prompt = `คุณคือนักแปลนิยายมืออาชีพและผู้บันทึกฐานข้อมูลวรรณกรรม (Lore & State Tracker)
แปลเนื้อหาภาษาจีนต่อไปนี้เป็นภาษาไทยให้อ่านสนุก ไหลลื่น สละสลวย เป็นธรรมชาติ โดยคงความหมายและรูปประโยคให้ใกล้เคียงต้นฉบับที่สุด

สไตล์และบรรยากาศหลักของแนวเรื่อง:
${genreRule}

ข้อมูลบริบท:
- ${bookCtx} ${authorCtx}
${prevSummary ? `- เหตุการณ์ในตอนก่อนหน้า: "${prevSummary}"` : ''}

กฎเหล็กเรื่องการจัดย่อหน้า สรรพนาม และโครงสร้าง:
1. ล็อกสรรพนามให้คงที่ 100% ตลอดทั้งบท ห้ามสลับข้า/เจ้า กับ ผม/คุณ เด็ดขาด
2. คำเฉพาะใน [Glossary] ต้องคงรูปเดิม 100%: [${termList}]
3. ข้อความในวงเล็บทึบ 【 】 หรือ [ ] ต้องแปลเป็นภาษาไทยเสมอ ห้ามส่งวงเล็บว่างเปล่า
4. ห้ามรวบย่อหน้า แปล 1 ต่อ 1 กับต้นฉบับจีน

ระบบบันทึกฐานข้อมูลและสถานะประจำตอน (Structured Chapter Dossier):
จงวิเคราะห์เหตุการณ์ในบทนี้และสกัดข้อมูล 3 ส่วนลงในฟิลด์ "dossier":
1. "key_events": เหตุการณ์สำคัญที่เกิดขึ้นจริง 2-4 ข้อ
2. "state_transitions": ติดตามความเคลื่อนไหวของสิ่งของ, วิชา, มรรคผล, และระดับพลัง:
   - "src": ชื่อจีนต้นฉบับ (ห้ามตกหล่น เพื่อใช้เป็น Anchor ค้นหาถาวร)
   - "th": คำแปลภาษาไทย
   - "category": character|title|location|skill|equipment|resource|realm
   - "owner": ใครเป็นผู้ถือครองหรือใช้งาน (ระบุชื่อตัวละคร หรือระบุว่า "ศัตรู/บุคคลอื่น")
   - "is_protagonist": true หากเป็นของที่ตัวเอกครอบครองหรือได้รับ, false หากเป็นของคนอื่น
   - "action": กำหนดประเภทสถานะอย่างแม่นยำ:
     * "acquired" = ได้รับมาใหม่, ซื้อมา, ชิงมาได้, สำเร็จวิชา
     * "lost" = สูญเสีย, ถูกทำลาย, พังทลาย, โดนแย่งชิงไป
     * "consumed" = ใช้หมดไป (กินยาโอสถ, ใช้ยันต์, สละพลัง)
     * "transferred" = มอบให้ผู้อื่น, ส่งมอบให้สำนัก
     * "modified" = เลื่อนขั้น, อัปเกรด, หลอมรวมใหม่
     * "retcon" = ความจริงเฉลย (เช่น ของที่คิดว่าพัง/หายไป แท้จริงเป็นของปลอม)
   - "details": อธิบายสั้นๆ ว่าเกิดขึ้นอย่างไร
3. "current_status_snapshot":
   - "protagonist_realm": ระดับพลังปัจจุบันของตัวเอก (หากมีการเปลี่ยนแปลงหรือกล่าวถึง)
   - "injuries": อาการบาดเจ็บหรือคำสาป (ถ้ามี)

ผลลัพธ์ต้องส่งกลับเป็น JSON Object ตามโครงสร้างนี้เท่านั้น:
{
  "translatedBookTitle": "คำแปลชื่อเรื่องภาษาไทย",
  "translatedChapterTitle": "คำแปลชื่อตอนภาษาไทย",
  "chapter_summary": "สรุปสั้นๆ 1-2 ประโยค",
  "dossier": {
    "key_events": ["เหตุการณ์ที่ 1", "เหตุการณ์ที่ 2"],
    "state_transitions": [
      {
        "src": "คำจีน",
        "th": "คำไทย",
        "category": "equipment|skill|resource|realm",
        "owner": "ชื่อเจ้าของ",
        "is_protagonist": true,
        "action": "acquired|lost|consumed|transferred|modified|retcon",
        "details": "รายละเอียดเหตุการณ์"
      }
    ],
    "current_status_snapshot": {
      "protagonist_realm": "ระดับพลังปัจจุบัน",
      "injuries": "ไม่มี หรือ บาดเจ็บจุดใด"
    }
  },
  "paragraphs": [
    {"th": "คำแปลไทยของย่อหน้านั้น", "src": "ข้อความจีนของย่อหน้านั้น"}
  ],
  "used_entities": [
    {"src": "คำจีน", "tgt": "คำแปลไทย", "category": "character|title|location|skill|equipment|resource|realm"}
  ]
}`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${activeKey}`;
  
  const res = await fetch(endpoint, {
    method: 'POST',
    signal: signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${prompt}\n\nเนื้อหาที่ต้องแปล:\n${rawText}` }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });

  const data = await res.json();
  if (!res.ok) {
    if (res.status === 429) rotateApiKey();
    throw new Error(data.error?.message || `HTTP ${res.status}: ยิง API ไม่สำเร็จ`);
  }

  let outText = data.candidates[0].content.parts[0].text;
  const parsedResult = cleanAndParseJSON(outText);

  let paragraphs = Array.isArray(parsedResult) ? parsedResult : (parsedResult.paragraphs || []);
  let translatedChapTitle = parsedResult.translatedChapterTitle || rawChapTitle;
  let translatedBookTitle = parsedResult.translatedBookTitle || rawBookTitle;
  let chapterSummary = parsedResult.chapter_summary || "";
  let chapterDossier = parsedResult.dossier || { key_events: [], state_transitions: [], current_status_snapshot: {} };

  paragraphs = paragraphs.map(p => ({
    th: rescueEmptyBrackets(p.th, p.src),
    src: p.src
  }));

  // Auto-sync used entities เข้าคลังศัพท์
  if (Array.isArray(parsedResult.used_entities) && parsedResult.used_entities.length > 0) {
    for (const ent of parsedResult.used_entities) {
      if (ent.src && ent.tgt) {
        const cleanSrc = cleanTermString(ent.src);
        const cleanTgt = cleanTermString(ent.tgt);
        const existing = inMemoryGlossaryCache.find(x => x.src === cleanSrc);
        if (!existing) {
          await dbSaveGlossaryItem({
            src: cleanSrc,
            tgt: cleanTgt,
            category: ent.category || 'character',
            scope: 'tagged',
            books: [currentBookId],
            count: 1,
            overrides: {},
            updatedAt: Date.now()
          });
        }
      }
    }
  }

  const isBilingualVerifyEnabled = localStorage.getItem('nov_enable_bilingual_verify') !== 'false';
  if (isBilingualVerifyEnabled && paragraphs.length > 0) {
    paragraphs = await bilingualCrossVerificationPass(paragraphs, modelToUse, signal, onStatusUpdate);
  }

  return {
    bookTitle: translatedBookTitle,
    chapterTitle: translatedChapTitle,
    summary: chapterSummary,
    dossier: chapterDossier,
    paragraphs: paragraphs
  };
}

async function translateTextWithPingPong(rawText, onStatusUpdate = null, rawChapTitle = "", rawBookTitle = "", prevSummary = "") {
  retryAbortRequested = false;

  const primaryModel = (localStorage.getItem('nov_primary_model') || "gemini-3.5-flash-lite").trim();
  const maxRetries = parseInt(localStorage.getItem('nov_retry_limit') || "10", 10);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (retryAbortRequested) throw new Error("ผู้ใช้ยกเลิกการส่งซ้ำ");

    try {
      activeAbortController = new AbortController();

      if (attempt === 1) {
        if (onStatusUpdate) onStatusUpdate("กำลังสแกนหาชื่อเฉพาะและระดับพลังใหม่...");
        await extractAndStoreAutoGlossary(rawText, primaryModel, activeAbortController.signal);
      }

      if (onStatusUpdate) onStatusUpdate(`กำลังแปลผ่านโมเดล ${primaryModel}...`);
      const res = await executeApiCall(rawText, primaryModel, rawChapTitle, rawBookTitle, prevSummary, activeAbortController.signal, onStatusUpdate);
      activeAbortController = null;
      return res;
    } catch (err) {
      activeAbortController = null;
      if (err.name === 'AbortError' || retryAbortRequested) throw new Error("ผู้ใช้สั่งหยุดการทำงาน");

      const errMsg = (err.message || "").toLowerCase();
      const isRateLimit = errMsg.includes("429") || errMsg.includes("resourceexhausted") || errMsg.includes("quota");
      const isHighDemand = isRateLimit || 
                           errMsg.includes("high demand") || 
                           errMsg.includes("503") || 
                           errMsg.includes("overloaded");

      if (!isHighDemand || attempt === maxRetries || retryAbortRequested) throw err;

      if (isRateLimit && apiKeyPool.length > 1) {
        rotateApiKey();
        if (onStatusUpdate) {
          onStatusUpdate(`โควต้าเต็ม! สลับใช้คีย์ #${currentApiKeyIndex + 1}/${apiKeyPool.length} ทันที...`);
        }
        await new Promise(r => setTimeout(r, 800));
        continue;
      }

      for (let sec = 5; sec > 0; sec--) {
        if (retryAbortRequested) throw new Error("ผู้ใช้ยกเลิกการส่งซ้ำ");
        if (onStatusUpdate) {
          const keyLabel = apiKeyPool.length > 1 ? ` (คีย์ #${currentApiKeyIndex + 1}/${apiKeyPool.length})` : '';
          onStatusUpdate(`คิวแน่น! ลองใหม่รอบที่ ${attempt}/${maxRetries}${keyLabel} ใน ${sec} วิ...`);
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
}
