// ==================== AI READING COMPANION (ENHANCED RAG ENGINE) ====================
let chatHistory = [];
let isChatResponding = false;

function toggleChatDrawer() {
  const drawer = document.getElementById('chat-drawer');
  const bubble = document.getElementById('chat-bubble-btn');
  if (!drawer) return;

  const isOpen = drawer.classList.contains('active');
  if (isOpen) {
    drawer.classList.remove('active');
    if (bubble) bubble.style.display = 'flex';
  } else {
    drawer.classList.add('active');
    if (bubble) bubble.style.display = 'none';
    const input = document.getElementById('chat-user-input');
    if (input) setTimeout(() => input.focus(), 200);
    scrollChatToBottom();
  }
}

function scrollChatToBottom() {
  const body = document.getElementById('chat-messages-body');
  if (body) {
    setTimeout(() => {
      body.scrollTop = body.scrollHeight;
    }, 50);
  }
}

function clearChatHistory() {
  chatHistory = [];
  const body = document.getElementById('chat-messages-body');
  if (body) {
    body.innerHTML = `
      <div class="chat-msg chat-msg-bot">
        สวัสดีครับ! ผมคือผู้ช่วยอ่านนิยายเรื่อง <b>${currentBookTitle}</b> ถามเจาะลึกประวัติของวิเศษ ทบทวนเนื้อหาย้อนหลัง หรือเช็กระดับพลังได้เลยครับ 📖
      </div>
    `;
  }
}

// ---------------- LOCAL INVERTED INDEX & DOSSIER RECONSTRUCTOR ----------------

async function findBilingualStateTimeline(userQuery) {
  const query = userQuery.trim().toLowerCase();
  const bookChaps = await dbGetChaptersByBook(currentBookId);
  bookChaps.sort((a, b) => a.order - b.order);

  const curChap = chapters[currentChapterIndex] || {};
  const maxOrder = curChap.order || bookChaps.length;

  // กรองเฉพาะตอนที่ไม่เกินตอนปัจจุบันที่ผู้อ่านกำลังอ่านอยู่ (ป้องกันสปอยล์)
  const availableChaps = bookChaps.filter(c => (c.order || 0) <= maxOrder);

  // ค้นหาคำศัพท์ใน Glossary เพื่อหาคู่ { src (จีน), tgt (ไทย) }
  const activeTerms = await getActiveGlossaryForCurrentBook();
  const matchedTerms = [];

  for (const [chineseSrc, data] of Object.entries(activeTerms)) {
    const thaiTgt = (data.resolvedTgt || "").toLowerCase();
    if (query.includes(chineseSrc.toLowerCase()) || (thaiTgt && query.includes(thaiTgt))) {
      matchedTerms.push({ src: chineseSrc, th: data.resolvedTgt, category: data.category });
    }
  }

  // ค้นหาใน Dossier ของทุกบท
  const matchedTransitions = [];
  const matchedEvents = [];

  availableChaps.forEach(ch => {
    const d = ch.dossier;
    if (!d) return;

    // 1. ตรวจจับ State Transitions ของไอเทม/วิชา
    if (Array.isArray(d.state_transitions)) {
      d.state_transitions.forEach(st => {
        let isHit = false;
        // เช็คตรงกับคำค้นหาของผู้ใช้
        if (query.includes(st.src.toLowerCase()) || query.includes((st.th || "").toLowerCase())) isHit = true;
        // เช็คตรงกับ Glossary ที่ตรวจพบ
        if (matchedTerms.some(t => t.src === st.src || (st.th && t.th === st.th))) isHit = true;

        if (isHit) {
          matchedTransitions.push({
            chapter: ch.order,
            title: ch.title,
            ...st
          });
        }
      });
    }

    // 2. ตรวจจับ Key Events ที่มีคำตรงกัน
    if (Array.isArray(d.key_events)) {
      d.key_events.forEach(ev => {
        let isHit = query.split(/\s+/).some(w => w.length >= 2 && ev.toLowerCase().includes(w));
        if (matchedTerms.some(t => ev.includes(t.th) || ev.includes(t.src))) isHit = true;
        if (isHit) {
          matchedEvents.push(`- ตอนที่ ${ch.order} (${ch.title}): ${ev}`);
        }
      });
    }
  });

  return {
    matchedTerms,
    matchedTransitions,
    matchedEvents: matchedEvents.slice(-8)
  };
}

// รวมยอด Snapshot สถานะสุทธิปัจจุบัน (Net Inventory Consolidation)
function consolidateCurrentInventory(bookChaps, maxOrder) {
  const inventory = new Map();
  let latestRealm = "ไม่ระบุ";
  let latestInjuries = "ปกติ";

  bookChaps.filter(c => (c.order || 0) <= maxOrder).forEach(ch => {
    const d = ch.dossier;
    if (!d) return;

    if (d.current_status_snapshot) {
      if (d.current_status_snapshot.protagonist_realm) latestRealm = d.current_status_snapshot.protagonist_realm;
      if (d.current_status_snapshot.injuries) latestInjuries = d.current_status_snapshot.injuries;
    }

    if (Array.isArray(d.state_transitions)) {
      d.state_transitions.forEach(st => {
        if (!st.is_protagonist && st.owner && !st.owner.includes("ตัวเอก") && !st.owner.includes("หลี่")) return;

        const key = st.src;
        if (st.action === 'acquired' || st.action === 'modified' || st.action === 'retcon') {
          inventory.set(key, { ...st, lastUpdatedChapter: ch.order });
        } else if (st.action === 'lost' || st.action === 'consumed' || st.action === 'transferred') {
          inventory.delete(key);
        }
      });
    }
  });

  return {
    currentHoldings: Array.from(inventory.values()),
    latestRealm,
    latestInjuries
  };
}

async function buildHierarchicalStoryContext(userQuery) {
  const curChap = chapters[currentChapterIndex] || {};
  const bookChaps = await dbGetChaptersByBook(currentBookId);
  bookChaps.sort((a, b) => a.order - b.order);

  const maxOrder = curChap.order || bookChaps.length;

  // 1. ค้นหา Timeline และหลักฐานเจาะจงในเครื่อง
  const searchEvidence = await findBilingualStateTimeline(userQuery);

  // 2. สรุปสถานะสุทธิปัจจุบัน (Net Inventory)
  const netStatus = consolidateCurrentInventory(bookChaps, maxOrder);

  // 3. ดึง Summary ของ 10 ตอนล่าสุด
  const recentSummaries = [];
  bookChaps.filter(c => (c.order || 0) <= maxOrder).slice(-10).forEach(ch => {
    if (ch.summary) recentSummaries.push(`- ตอนที่ ${ch.order} (${ch.title}): ${ch.summary}`);
  });

  // 4. เนื้อหาบทปัจจุบัน
  const currentChapterText = (curChap.paragraphs || [])
    .map(p => p.th || "")
    .filter(Boolean)
    .join("\n");

  return {
    bookTitle: currentBookTitle,
    genre: currentBookGenre,
    author: currentAuthor,
    currentChapTitle: curChap.title || "บทปัจจุบัน",
    currentChapOrder: maxOrder,
    evidence: searchEvidence,
    netStatus: netStatus,
    recentSummaries: recentSummaries.join("\n"),
    currentChapterText: currentChapterText.substring(0, 4500)
  };
}

async function sendChatMessage(customPrompt = null) {
  if (isChatResponding) return;

  const inputEl = document.getElementById('chat-user-input');
  const userText = customPrompt ? customPrompt.trim() : (inputEl ? inputEl.value.trim() : "");
  if (!userText) return;

  const activeKey = getActiveApiKey();
  if (!activeKey) {
    alert("กรุณาใส่ API Key ในเมนู 'ตั้งค่า' ก่อนคุยกับ AI");
    return;
  }

  const primaryModel = (localStorage.getItem('nov_primary_model') || "gemini-3.5-flash-lite").trim();
  const chatBody = document.getElementById('chat-messages-body');

  if (!customPrompt && inputEl) inputEl.value = "";
  appendChatMessage("user", userText);
  scrollChatToBottom();

  const loadingBubbleId = "chat-loading-" + Date.now();
  const loadingBubble = document.createElement('div');
  loadingBubble.className = "chat-msg chat-msg-bot";
  loadingBubble.id = loadingBubbleId;
  loadingBubble.innerHTML = `<span class="spinner-icon" style="margin-right: 6px;"></span> กำลังสืบค้นข้อมูลในคลังบันทึก...`;
  chatBody.appendChild(loadingBubble);
  scrollChatToBottom();

  isChatResponding = true;

  try {
    const ctx = await buildHierarchicalStoryContext(userText);

    // ประกอบหลักฐานไทม์ไลน์ที่ค้นพบ
    let evidenceSection = "ไม่มีหลักฐานเจาะจงเฉพาะคำ";
    if (ctx.evidence.matchedTransitions.length > 0) {
      evidenceSection = "ประวัติความเคลื่อนไหว (State Transitions) ที่ระบบสแกนพบ:\n" + 
        ctx.evidence.matchedTransitions.map(t => 
          `* [ตอนที่ ${t.chapter} - ${t.title}] คำจีน: "${t.src}" (${t.th}) | การกระทำ: [${t.action}] โดย: ${t.owner} -> รายละเอียด: ${t.details}`
        ).join("\n");
    }

    let holdingsSection = ctx.netStatus.currentHoldings.length > 0 
      ? ctx.netStatus.currentHoldings.map(h => `- ${h.th} (${h.src}) [${h.category}] ได้รับในตอนที่ ${h.lastUpdatedChapter}`).join("\n")
      : "ไม่มีรายการของวิเศษคงเหลือที่บันทึกไว้";

    const systemPrompt = `คุณคือ "เพื่อนร่วมอ่านนิยายและผู้คุมฐานข้อมูลนิยาย" ผู้เชี่ยวชาญนิยายแนว ${ctx.genre}
งานของคุณคือตอบคำถาม ทบทวนเหตุการณ์ และวิเคราะห์สถานะของตัวละครให้นักอ่านฟังอย่างแม่นยำ 100%

บริบทเรื่อง: "${ctx.bookTitle}" (ผู้แต่ง: ${ctx.author || 'ไม่ระบุ'})
อ่านถึง: ตอนที่ ${ctx.currentChapOrder} ("${ctx.currentChapTitle}")

[หลักฐานประวัติความเคลื่อนไหวที่ระบบค้นพบในเครื่อง (Ground Truth Evidence)]:
${evidenceSection}

[เหตุการณ์สำคัญที่เกี่ยวข้อง]:
${ctx.evidence.matchedEvents.join("\n") || "- ไม่มี"}

[สถานะสุทธิล่าสุดของตัวเอก ณ ตอนที่ ${ctx.currentChapOrder}]:
- ระดับพลัง: ${ctx.netStatus.latestRealm}
- อาการบาดเจ็บ/สภาพร่างกาย: ${ctx.netStatus.latestInjuries}
- รายการของวิเศษ/วิชาที่ถือครองอยู่จริงในปัจจุบัน (Active Inventory):
${holdingsSection}

[สรุปเนื้อหา 10 ตอนล่าสุด]:
${ctx.recentSummaries || "- ไม่มีสรุป"}

[เนื้อหาในตอนปัจจุบัน]:
${ctx.currentChapterText || "- ไม่มีเนื้อหา"}

กฎการตอบคำถาม:
1. หากผู้ใช้ถามถึงสิ่งของ วิชา หรือมรรคผล ให้ตรวจเช็กจาก [ประวัติความเคลื่อนไหว] และ [รายการของวิเศษที่ถือครองอยู่จริง]
   - หากของชิ้นนั้นมีประวัติ "lost", "consumed", หรือ "transferred" ในตอนหลัง ให้ระบุชัดเจนว่าเคยได้ในตอนไหน และเสียไปหรือใช้ไปในตอนไหน ปัจจุบันไม่ได้ถือครองแล้ว
   - หากยังคงอยู่ในรายการ Active Inventory ให้ยืนยันว่าปัจจุบันยังถือครองอยู่
2. ตอบระบุเลขตอนเสมอ (เช่น "ได้มาในตอนที่ 12 และถูกทำลายไปในตอนที่ 45 ครับ") เพื่อความชัดเจน
3. คุยเป็นกันเอง สนุกสนาน ห้ามสปอยล์เกินกว่าตอนที่ ${ctx.currentChapOrder}`;

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: "เข้าใจแล้วครับ พร้อมตอบคำถามโดยอ้างอิงไทม์ไลน์สถานะที่ถูกต้องแม่นยำครับ!" }] }
    ];

    chatHistory.slice(-4).forEach(h => {
      contents.push({ role: h.role, parts: [{ text: h.text }] });
    });

    contents.push({ role: 'user', parts: [{ text: userText }] });

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${primaryModel}:generateContent?key=${activeKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contents,
        generationConfig: { temperature: 0.5, maxOutputTokens: 1200 }
      })
    });

    if (!res.ok) {
      if (res.status === 429) rotateApiKey();
      throw new Error(`API Error: ${res.status}`);
    }

    const data = await res.json();
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "ขออภัยครับ ไม่สามารถสืบค้นข้อมูลได้ในขณะนี้";

    const targetBubble = document.getElementById(loadingBubbleId);
    if (targetBubble) targetBubble.innerHTML = formatChatReply(replyText);

    chatHistory.push({ role: 'user', text: userText });
    chatHistory.push({ role: 'model', text: replyText });
  } catch (err) {
    const targetBubble = document.getElementById(loadingBubbleId);
    if (targetBubble) {
      targetBubble.innerHTML = `<span style="color:#ef4444;">เกิดข้อผิดพลาดในการสืบค้น: ${err.message}</span>`;
    }
  } finally {
    isChatResponding = false;
    scrollChatToBottom();
  }
}

function appendChatMessage(sender, text) {
  const chatBody = document.getElementById('chat-messages-body');
  if (!chatBody) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg chat-msg-${sender}`;
  msgDiv.innerHTML = (sender === 'user') ? escapeHtml(text) : formatChatReply(text);
  chatBody.appendChild(msgDiv);
}

function formatChatReply(text) {
  let formatted = escapeHtml(text);
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  formatted = formatted.replace(/\n/g, '<br>');
  return formatted;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function askBotAboutSelection() {
  if (!selectedWordBuffer) return;
  const word = selectedWordBuffer.trim();
  dismissSelectionBar();
  toggleChatDrawer();
  sendChatMessage(`ช่วยตรวจสอบสถานะและประวัติของ "${word}" ให้หน่อยครับว่าโผล่มาตอนไหน ปัจจุบันเป็นอย่างไร และอยู่กับใคร?`);
}
