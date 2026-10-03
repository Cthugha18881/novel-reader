// ============================================================================
// NOVELTRANSLATE AI - API & TRANSLATION ENGINE (api.js)
// ============================================================================

if (typeof window.inMemoryGlossaryCache === 'undefined') {
  window.inMemoryGlossaryCache = [];
}

let currentApiKeyIndex = 0;

function getStoredApiKeys() {
  const raw = localStorage.getItem('nov_gemini_keys') || localStorage.getItem('gemini_api_keys') || '';
  return raw.split('\n').map(k => k.trim()).filter(Boolean);
}

function getActiveApiKey() {
  const keys = getStoredApiKeys();
  if (keys.length === 0) return null;
  if (currentApiKeyIndex >= keys.length) currentApiKeyIndex = 0;
  return keys[currentApiKeyIndex];
}

function rotateApiKey() {
  const keys = getStoredApiKeys();
  if (keys.length <= 1) return;
  currentApiKeyIndex = (currentApiKeyIndex + 1) % keys.length;
  console.log(`[Key Rotator] สลับไปใช้ Key ลำดับที่ ${currentApiKeyIndex + 1}/${keys.length}`);
}

// ---------------- FETCH LIVE MODELS ----------------

async function fetchLiveModels() {
  const statusEl = document.getElementById('fetch-status-text');
  const modelSelect = document.getElementById('gemini-primary-model');
  const btn = document.getElementById('fetch-models-btn');
  const keyArea = document.getElementById('gemini-keys-area');

  let keys = [];
  if (keyArea && keyArea.value.trim()) {
    keys = keyArea.value.trim().split('\n').map(k => k.trim()).filter(Boolean);
  } else {
    keys = getStoredApiKeys();
  }

  if (keys.length === 0) {
    alert("กรุณากรอก API Key ในช่องข้อความก่อนตรวจเช็ก");
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#ef4444';
      statusEl.textContent = '❌ กรุณาวาง API Key ก่อนตรวจเช็กโมเดล';
    }
    return;
  }

  const testKey = keys[0];

  if (btn) btn.disabled = true;
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#38bdf8';
    statusEl.textContent = 'กำลังเชื่อมต่อเพื่อตรวจสอบรายการโมเดล...';
  }

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': testKey
      }
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error?.message || `HTTP ${res.status}: ยิง API ไม่สำเร็จ`);
    }

    const availableModels = (data.models || []).filter(m => 
      m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
    );

    if (availableModels.length === 0) {
      throw new Error('ไม่พบโมเดลที่รองรับในคีย์นี้');
    }

    if (modelSelect) {
      const currentSelected = modelSelect.value;
      modelSelect.innerHTML = '';

      availableModels.forEach(m => {
        const modelCode = m.name.replace(/^models\//, '');
        const opt = document.createElement('option');
        opt.value = modelCode;
        opt.textContent = `${m.displayName || modelCode} (${modelCode})`;
        if (modelCode === currentSelected) opt.selected = true;
        modelSelect.appendChild(opt);
      });

      if (!availableModels.some(m => m.name.replace(/^models\//, '') === currentSelected)) {
        modelSelect.selectedIndex = 0;
      }
    }

    if (statusEl) {
      statusEl.style.color = '#22c55e';
      statusEl.textContent = `✅ ตรวจสอบสำเร็จ! พบ ${availableModels.length} โมเดลที่พร้อมใช้งาน`;
    }
  } catch (err) {
    console.error("fetchLiveModels error:", err);
    if (statusEl) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = `❌ เชื่อมต่อล้มเหลว: ${err.message}`;
    }
    alert(`เชื่อมต่อไม่สำเร็จ: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------------- CORS PROXY SCRAPER ----------------

async function fetchNovelChapterContent(targetUrl) {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error("ไม่สามารถเชื่อมต่อเว็บต้นทางผ่าน Proxy ได้");

  const data = await res.json();
  const html = data.contents;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  let title = doc.querySelector("h1")?.innerText?.trim() || "";
  let bookTitle = doc.querySelector(".novel-title, .title, h2")?.innerText?.trim() || "นิยายจีน";

  const contentEl = doc.querySelector("#content, .content, .txtnav") || doc.body;
  contentEl.querySelectorAll("script, style, a, .ads").forEach(el => el.remove());

  const rawText = contentEl.innerText || contentEl.textContent || "";
  if (!rawText.trim()) {
    throw new Error("ดึงเนื้อหาไม่สำเร็จ หรือเนื้อหาในหน้านี้ว่างเปล่า");
  }

  return {
    bookTitle: bookTitle,
    chapterTitle: title,
    author: "",
    content: rawText
  };
}

// ---------------- PROMPTING & HELPERS ----------------

function getGenreInstruction(genre) {
  switch (genre) {
    case 'xianxia':
      return "สำนวนเทพเซียน บำเพ็ญเพียร วิถีเต๋า สงบนิ่ง ปราณฟ้าดิน มรรคผล อภิญญา และค่ายกลโบราณ";
    case 'wuxia':
      return "สำนวนยุทธภพ กำลังภายใน บุญคุณความแค้น เพลงดาบ กระบี่สุรา และคุณธรรมน้ำมิตร";
    case 'system_game':
      return "สำนวนระบบ ดันเจี้ยน การอัปเลเวล แจ้งเตือนสเตตัส ภาษาอ่านง่าย กระชับ ทันสมัย";
    case 'scifi':
      return "สำนวนมหากาพย์ไซไฟ อวกาศ เทคโนโลยี ควอนตัม สเกลระดับจักรวาลและดวงดาว";
    default:
      return "สำนวนนิยายแปลจีนอ่านสนุก สละสลวย กระชับ ลื่นไหล เป็นธรรมชาติ";
  }
}

function cleanAndParseJSON(rawStr) {
  let cleaned = rawStr.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
    }
    throw err;
  }
}

function cleanTermString(str) {
  return (str || '').replace(/[【】\[\]\s]/g, '').trim();
}

function rescueEmptyBrackets(thText, srcText) {
  if (!thText) return "";
  return thText.replace(/【\s*】/g, `【${srcText.substring(0, 8)}】`);
}

// ---------------- EXECUTE API CALL ----------------

async function executeApiCall(rawText, modelToUse, rawChapTitle = "", rawBookTitle = "", prevSummary = "", signal = null, onStatusUpdate = null) {
  const activeKey = getActiveApiKey();
  const genre = currentBookGenre || "xianxia";

  if (!activeKey) throw new Error("กรุณาใส่ API Key ในเมนู 'ตั้งค่า' ก่อน");

  const activeTerms = await getActiveGlossaryForCurrentBook();
  const termList = Object.entries(activeTerms).map(([k,v]) => `${k}=${v.resolvedTgt}`).join(", ");
  const genreRule = getGenreInstruction(genre);

  const authorCtx = currentAuthor ? `ผู้แต่ง: "${currentAuthor}"` : '';
  const bookCtx = currentBookTitle ? `นิยายเรื่อง: "${currentBookTitle}"` : '';

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
  * ให้สรุปใน "chapter_summary" สั้นๆ เช่น "ประกาศของผู้เขียน: แจ้งขอลาหยุด..."
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

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent`;

  const res = await fetch(endpoint, {
    method: 'POST',
    signal: signal,
    headers: { 
      'Content-Type': 'application/json',
      'x-goog-api-key': activeKey
    },
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

  if (chapterType === "announcement") {
    chapterDossier = { key_events: [], state_transitions: [], current_status_snapshot: {} };
  }

  paragraphs = paragraphs.map(p => ({
    th: rescueEmptyBrackets(p.th, p.src),
    src: p.src
  }));

  if (chapterType !== "announcement" && Array.isArray(parsedResult.used_entities) && parsedResult.used_entities.length > 0) {
    for (const ent of parsedResult.used_entities) {
      if (ent.src && ent.tgt) {
        const cleanSrc = cleanTermString(ent.src);
        const cleanTgt = cleanTermString(ent.tgt);
        const existing = (window.inMemoryGlossaryCache || []).find(x => x.src === cleanSrc);
        if (!existing && typeof dbSaveGlossaryItem === 'function') {
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

  return {
    bookTitle: translatedBookTitle,
    chapterTitle: translatedChapTitle,
    chapterType: chapterType,
    summary: chapterSummary,
    dossier: chapterDossier,
    paragraphs: paragraphs
  };
}

async function pairThaiToSourceParagraph(thaiWord, chinesePara) {
  const activeKey = getActiveApiKey();
  if (!activeKey) return null;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`;
  const prompt = `จากย่อหน้าภาษาจีนนี้: "${chinesePara}"\nจงหาคำภาษาจีนต้นฉบับที่ตรงกับคำแปลไทยว่า: "${thaiWord}" ตอบเฉพาะตัวอักษรจีนคำนั้นเท่านั้น ไม่ต้องใส่คำอธิบายอื่น`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-goog-api-key': activeKey
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}
