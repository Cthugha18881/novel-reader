// ==================== AI READING COMPANION (ENHANCED RAG & RECURSIVE RECAP) ====================
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
        สวัสดีครับ! ผมคือผู้ช่วยอ่านนิยายเรื่อง <b>${currentBookTitle}</b> ถามเจาะลึกประวัติของวิเศษ ทบทวนเนื้อหาย้อนหลัง หรือกดปุ่ม <b>"📜 สรุปภาพรวมตั้งแต่ตอนที่ 1"</b> ได้เลยครับ 📖
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

  const availableChaps = bookChaps.filter(c => (c.order || 0) <= maxOrder);

  const activeTerms = await getActiveGlossaryForCurrentBook();
  const matchedTerms = [];

  for (const [chineseSrc, data] of Object.entries(activeTerms)) {
    const thaiTgt = (data.resolvedTgt || "").toLowerCase();
    if (query.includes(chineseSrc.toLowerCase()) || (thaiTgt && query.includes(thaiTgt))) {
      matchedTerms.push({ src: chineseSrc, th: data.resolvedTgt, category: data.category });
    }
  }

  const matchedTransitions = [];
  const matchedEvents = [];

  availableChaps.forEach(ch => {
    const d = ch.dossier;
    if (!d) return;

    if (Array.isArray(d.state_transitions)) {
      d.state_transitions.forEach(st => {
        let isHit = false;
        if (query.includes(st.src.toLowerCase()) || query.includes((st.th || "").toLowerCase())) isHit = true;
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

// ---------------- HIERARCHICAL PYRAMID RECAP BUILDER ----------------

async function buildHierarchicalStoryContext(userQuery, isFullRecapMode = false) {
  const curChap = chapters[currentChapterIndex] || {};
  const bookChaps = await dbGetChaptersByBook(currentBookId);
  bookChaps.sort((a, b) => a.order - b.order);

  const maxOrder = curChap.order || bookChaps.length;
  const availableChaps = bookChaps.filter(c => (c.order || 0) <= maxOrder);

  const searchEvidence = await findBilingualStateTimeline(userQuery);
  const netStatus = consolidateCurrentInventory(bookChaps, maxOrder);

  // ดึงเหตุการณ์สะสมเพื่อสร้าง Pyramid Summary
  const timelineMilestones = [];
  availableChaps.forEach(ch => {
    if (ch.dossier && Array.isArray(ch.dossier.key_events) && ch.dossier.key_events.length > 0) {
      timelineMilestones.push(`[ตอนที่ ${ch.order}] ${ch.dossier.key_events.join('; ')}`);
    } else if (ch.summary) {
      timelineMilestones.push(`[ตอนที่ ${ch.order}] ${ch.summary}`);
    }
  });

  // กรองตัวอย่างกรณีตอนเยอะเกิน 25 ตอน (Sampling Down เพื่อคุม Context)
  let sampledTimeline = timelineMilestones;
  if (timelineMilestones.length > 25 && !isFullRecapMode) {
    const step = Math.ceil(timelineMilestones.length / 20);
    sampledTimeline = timelineMilestones.filter((_, idx) => idx % step === 0 || idx >= timelineMilestones.length - 5);
  }

  const recentSummaries = [];
  availableChaps.slice(-8).forEach(ch => {
    if (ch.summary) recentSummaries.push(`- ตอนที่ ${ch.order} (${ch.title}): ${ch.summary}`);
  });

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
    totalChaptersRead: availableChaps.length,
    evidence: searchEvidence,
    netStatus: netStatus,
    sampledTimeline: sampledTimeline.join("\n"),
    recentSummaries: recentSummaries.join("\n"),
    currentChapterText: currentChapterText.substring(0, 4500)
  };
}

// ฟังก์ชันสำหรับปุ่ม Quick Chip "สรุปภาพรวมตั้งแต่ตอนที่ 1"
async function requestFullStoryRecap() {
  const curChap = chapters[currentChapterIndex] || {};
  const maxOrder = curChap.order || (currentChapterIndex + 1);
  const prompt = `ช่วยสรุปภาพรวมมหากาพย์ของนิยายเรื่อง "${currentBookTitle}" ตั้งแต่ตอนที่ 1 จนถึงตอนที่ ${maxOrder} (${curChap.title}) ให้ฟังอย่างละเอียดและเห็นภาพรวมครบทั้ง 4 ด้านหน่อยครับ`;
  await sendChatMessage(prompt, true);
}

// ---------------- MAIN CHAT CONTROLLER ----------------

async function sendChatMessage(customPrompt = null, forceRecapMode = false) {
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
  loadingBubble.innerHTML = `<span class="spinner-icon" style="margin-right: 6px;"></span> ${forceRecapMode ? 'กำลังประมวลผลสรุปเนื้อเรื่อง 4 มิติ...' : 'กำลังสืบค้นข้อมูลในคลังบันทึก...'}`;
  chatBody.appendChild(loadingBubble);
  scrollChatToBottom();

  isChatResponding = true;

  try {
    const isRecap = forceRecapMode || userText.includes("สรุปเรื่อง") || userText.includes("สรุปตั้งแต่ตอนที่ 1") || userText.includes("ภาพรวมทั้งหมด");
    const ctx = await buildHierarchicalStoryContext(userText, isRecap);

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

    let systemPrompt = "";

    if (isRecap) {
      // โหมดสรุปภาพรวม 4 มิติ (Multi-Track Storyline Breakdown)
      systemPrompt = `คุณคือ "เพื่อนร่วมอ่านนิยายและผู้เชี่ยวชาญการวิเคราะห์วรรณกรรม" แนว ${ctx.genre}
งานของคุณคือสรุปภาพรวมเนื้อเรื่องของ "${ctx.bookTitle}" ตั้งแต่ตอนที่ 1 จนถึงตอนที่ ${ctx.currentChapOrder} ("${ctx.currentChapTitle}")

[ฐานข้อมูลเหตุการณ์สำคัญตั้งแต่เริ่มต้นจนถึงปัจจุบัน (Historical Milestones)]:
${ctx.sampledTimeline || "(ไม่มีบันทึกเหตุการณ์)"}

[สถานะสุทธิของตัวเอก ณ ปัจจุบัน]:
- ขอบเขตพลัง: ${ctx.netStatus.latestRealm}
- สภาพร่างกาย/บาดแผล: ${ctx.netStatus.latestInjuries}
- ไอเทม/วิชาที่ครอบครองอยู่จริง:
${holdingsSection}

จงวิเคราะห์และเขียนสรุปภาพรวมให้นักอ่านเห็นภาพชัดเจน โดยจัดแบ่งเป็น 4 แกนสำคัญ:
1. 🗺️ **เส้นเรื่องหลักและหมุดหมายสำคัญ:** เล่าลำดับการเดินทาง เหตุการณ์พลิกผันใหญ่ๆ ตั้งแต่เริ่มเรื่องจนถึงจุดที่กำลังเผชิญอยู่ในปัจจุบัน
2. ⚔️ **สถานะขั้วอำนาจและศัตรู:** ฝ่ายใดเป็นมิตร ฝ่ายใดเป็นศัตรู มีความแค้นหรือข้อพิพาทกับใครอยู่
3. 🧬 **พัฒนาการของตัวเอก:** การเติบโตของระดับพลัง วิชาประจำตัว และการเปลี่ยนแปลงสถานะในยุทธภพ
4. 🚩 **เป้าหมายเร่งด่วนในปัจจุบัน:** สิ่งที่ตัวเอกกำลังมุ่งหน้าไปทำหรือแก้วิกฤตในตอนปัจจุบัน

ข้อบังคับ:
- เขียนให้อ่านสนุก กระชับ ลื่นไหล เป็นกันเองเหมือนเล่าให้เพื่อนฟัง
- ห้ามแต่งเรื่องขึ้นมาเอง ยึดตามไทม์ไลน์ที่ให้ และห้ามสปอยล์เกินตอนที่ ${ctx.currentChapOrder}`;
    } else {
      // โหมดตอบคำถามเจาะจงตามปกติ
      systemPrompt = `คุณคือ "เพื่อนร่วมอ่านนิยายและผู้คุมฐานข้อมูลนิยาย" ผู้เชี่ยวชาญนิยายแนว ${ctx.genre}
งานของคุณคือตอบคำถาม ทบทวนเหตุการณ์ และวิเคราะห์สถานะของตัวละครให้นักอ่านฟังอย่างแม่นยำ 100%

บริบทเรื่อง: "${ctx.bookTitle}" (ผู้แต่ง: ${ctx.author || 'ไม่ระบุ'})
อ่านถึง: ตอนที่ ${ctx.currentChapOrder} ("${ctx.currentChapTitle}")

[หลักฐานประวัติความเคลื่อนไหวที่ระบบค้นพบในเครื่อง (Ground Truth Evidence)]:
${evidenceSection}

[เหตุการณ์สำคัญที่เกี่ยวข้อง]:
${ctx.evidence.matchedEvents.join("\n") || "- ไม่มี"}

[สถานะสุทธิล่าสุดของตัวเอก ณ ตอนที่ ${ctx.currentChapOrder}]:
- ระดับพลัง: ${ctx.netStatus.latestRealm}
- อาการบาดเจ็บ: ${ctx.netStatus.latestInjuries}
- รายการของวิเศษ/วิชาที่ถือครองอยู่จริงในปัจจุบัน (Active Inventory):
${holdingsSection}

[สรุปเนื้อหาตอนล่าสุด]:
${ctx.recentSummaries || "- ไม่มีสรุป"}

[เนื้อหาในตอนปัจจุบัน]:
${ctx.currentChapterText || "- ไม่มีเนื้อหา"}

กฎการตอบคำถาม:
1. ตอบระบุเลขตอนเสมอ (เช่น "ได้มาในตอนที่ 12 และเสียไปในตอนที่ 45 ครับ")
2. หากสิ่งของเคยมีประวัติ lost/consumed ในตอนหลัง ให้ระบุชัดเจนว่าปัจจุบันไม่ได้ถือครองแล้ว
3. คุยเป็นกันเอง สนุกสนาน ห้ามสปอยล์เกินกว่าตอนที่ ${ctx.currentChapOrder}`;
    }

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: "เข้าใจโครงสร้างข้อมูลและพร้อมตอบคำถามอย่างแม่นยำครับ!" }] }
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
        generationConfig: { temperature: 0.5, maxOutputTokens: 1500 }
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
