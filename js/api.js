async function executeApiCall(rawText, modelToUse, rawChapTitle = "", rawBookTitle = "", prevSummary = "", signal = null, onStatusUpdate = null) {
  const activeKey = getActiveApiKey();
  const genre = currentBookGenre || "xianxia";

  if (!activeKey) throw new Error("กรุณาใส่ API Key ในเมนู 'ตั้งค่า' ก่อน");

  const activeTerms = await getActiveGlossaryForCurrentBook();
  const termList = Object.entries(activeTerms).map(([k,v]) => `${k}=${v.resolvedTgt}`).join(", ");
  const genreRule = getGenreInstruction(genre);

  const authorCtx = currentAuthor ? `ผู้แต่ง: "${currentAuthor}"` : '';
  const bookCtx = currentBookTitle ? `นิยายเรื่อง: "${currentBookTitle}"` : '';

  // เช็กเบื้องต้นจากชื่อตอนด้วย Regex
  const isSuspectedAnnouncement = /请假|感言|通知|说明|上架|完本|月票|汇报|推书/.test(rawChapTitle);
  const isSuspectedSideStory = /番外|外传|特别篇|if线|IF线|后记/.test(rawChapTitle);

  const prompt = `คุณคือนักแปลนิยายมืออาชีพและผู้บันทึกฐานข้อมูลวรรณกรรม (Lore & State Tracker)
แปลเนื้อหาภาษาจีนต่อไปนี้เป็นภาษาไทยให้อ่านสนุก ไหลลื่น สละสลวย เป็นธรรมชาติ โดยคงความหมายและรูปประโยคให้ใกล้เคียงต้นฉบับที่สุด

สไตล์และบรรยากาศหลักของแนวเรื่อง:
${genreRule}

ข้อมูลบริบท:
- ${bookCtx} ${authorCtx}
${prevSummary ? `- เหตุการณ์ในตอนก่อนหน้า: "${prevSummary}"` : ''}

[การจำแนกประเภทของบท (Chapter Classification)]:
จงวิเคราะห์ว่าบทนี้เป็นเนื้อหาประเภทใด แล้วระบุลงใน "chapter_type":
1. "announcement" = เป็นประกาศของนักเขียน, ขอลาหยุด, ขอบคุณยอดวิว/ยอดโหวต, แจ้งป่วย, พูดคุยกับผู้อ่าน หรือบ่นเรื่องชีวิตส่วนตัว
2. "side_story" = ตอนพิเศษนอกเรื่อง (番外), เรื่องเล่าแยกเดี่ยว, โลกคู่ขนาน (IF Line) ที่ไม่นับรวมในไทม์ไลน์หลัก
3. "regular" = เนื้อเรื่องนิยายบทหลักตามปกติ

กฎเหล็กสำหรับการจัดการ Dossier ตามประเภทบท:
- หากเป็น "announcement":
  * ห้ามสร้างข้อมูลใน "dossier" เด็ดขาด (ให้ส่ง key_events ว่าง [], state_transitions ว่าง [])
  * ห้ามนำชื่อคนเขียน แพลตฟอร์ม หรือเรื่องส่วนตัวไปใส่ใน "used_entities"
  * ให้สรุปใน "chapter_summary" สั้นๆ เช่น "ประกาศของผู้เขียน: แจ้งขอลาหยุดเนื่องจาก..."
- หากเป็น "side_story":
  * แปลเนื้อหาตามปกติ สกัด key_events ได้ แต่ห้ามนำ state_transitions ไปเปลี่ยนแปลงสถานะของตัวเอกในเนื้อเรื่องหลัก
- หากเป็น "regular":
  * ดำเนินการสกัด Dossier, Key Events, และ State Transitions เต็มรูปแบบตามมาตรฐาน

กฎเหล็กเรื่องการจัดย่อหน้า สรรพนาม และคำศัพท์:
1. ล็อกสรรพนามให้คงที่ 100% ตลอดทั้งบท ห้ามสลับข้า/เจ้า กับ ผม/คุณ เด็ดขาด
2. คำเฉพาะใน [Glossary] ต้องคงรูปเดิม 100%: [${termList}]
3. ข้อความในวงเล็บทึบ 【 】 หรือ [ ] ต้องแปลเป็นภาษาไทยเสมอ ห้ามส่งวงเล็บว่างเปล่า
4. ห้ามรวบย่อหน้า แปล 1 ต่อ 1 กับต้นฉบับจีน

ผลลัพธ์ต้องส่งกลับเป็น JSON Object ตามโครงสร้างนี้เท่านั้น:
{
  "chapter_type": "regular|announcement|side_story",
  "translatedBookTitle": "คำแปลชื่อเรื่องภาษาไทย",
  "translatedChapterTitle": "คำแปลชื่อตอนภาษาไทย",
  "chapter_summary": "สรุปสั้นๆ 1-2 ประโยค",
  "dossier": {
    "key_events": ["เหตุการณ์สำคัญ"],
    "state_transitions": [
      {
        "src": "คำจีน",
        "th": "คำไทย",
        "category": "equipment|skill|resource|realm|character",
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

  let chapterType = parsedResult.chapter_type || (isSuspectedAnnouncement ? "announcement" : (isSuspectedSideStory ? "side_story" : "regular"));
  let paragraphs = Array.isArray(parsedResult) ? parsedResult : (parsedResult.paragraphs || []);
  let translatedChapTitle = parsedResult.translatedChapterTitle || rawChapTitle;
  let translatedBookTitle = parsedResult.translatedBookTitle || rawBookTitle;
  let chapterSummary = parsedResult.chapter_summary || "";
  let chapterDossier = parsedResult.dossier || { key_events: [], state_transitions: [], current_status_snapshot: {} };

  // เคลียร์ความปลอดภัยซ้ำสอง หากเป็น announcement
  if (chapterType === "announcement") {
    chapterDossier = { key_events: [], state_transitions: [], current_status_snapshot: {} };
  }

  paragraphs = paragraphs.map(p => ({
    th: rescueEmptyBrackets(p.th, p.src),
    src: p.src
  }));

  // Auto-sync used entities เข้าคลังศัพท์ (เฉพาะกรณีที่เป็นเนื้อเรื่องนิยาย regular หรือ side_story เท่านั้น)
  if (chapterType !== "announcement" && Array.isArray(parsedResult.used_entities) && parsedResult.used_entities.length > 0) {
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
    chapterType: chapterType, // regular | announcement | side_story
    summary: chapterSummary,
    dossier: chapterDossier,
    paragraphs: paragraphs
  };
}
