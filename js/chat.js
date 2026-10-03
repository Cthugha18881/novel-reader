// ==================== AI READING COMPANION (CHAT BOT) ====================
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
        สวัสดีครับ! ผมคือผู้ช่วยอ่านนิยายเรื่อง <b>${currentBookTitle}</b> ถามเรื่องย่อ สเตตัสตัวละคร หรือทบทวนเหตุการณ์ที่ผ่านมาได้เลยครับ 📖
      </div>
    `;
  }
}

async function buildHierarchicalStoryContext() {
  const curChap = chapters[currentChapterIndex] || {};
  const bookChaps = await dbGetChaptersByBook(currentBookId);
  bookChaps.sort((a, b) => a.order - b.order);

  // 1. ดึงสรุปย้อนหลังตั้งแต่บทแรกจนถึงบทก่อนหน้า (คุม Token ให้กระชับ)
  const summaries = [];
  for (const ch of bookChaps) {
    if (ch.order <= (curChap.order || 0)) {
      if (ch.summary) {
        summaries.push(`- ตอนที่ ${ch.order} (${ch.title}): ${ch.summary}`);
      }
    }
  }

  // 2. ดึงคลังคำศัพท์เฉพาะเรื่องนี้
  const activeTerms = await getActiveGlossaryForCurrentBook();
  const glossList = Object.entries(activeTerms)
    .slice(0, 50)
    .map(([k, v]) => `${k} -> ${v.resolvedTgt} [หมวด: ${v.category}]`)
    .join("\n");

  // 3. ดึงเนื้อหาตอนปัจจุบัน (ย่อหน้าไทย)
  const currentChapterText = (curChap.paragraphs || [])
    .map(p => p.th || "")
    .filter(Boolean)
    .join("\n");

  return {
    bookTitle: currentBookTitle,
    genre: currentBookGenre,
    author: currentAuthor,
    currentChapTitle: curChap.title || "บทปัจจุบัน",
    currentChapOrder: curChap.order || 1,
    timeline: summaries.slice(-15).join("\n"), // ดึงย้อนหลังสูงสุด 15 บท
    glossary: glossList,
    currentChapterText: currentChapterText.substring(0, 5000) // จำกัดเนื้อหาบทปัจจุบันกันบวม
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

  // แสดงข้อความ User
  if (!customPrompt && inputEl) inputEl.value = "";
  appendChatMessage("user", userText);
  scrollChatToBottom();

  // สร้างฟองสบู่กำลังตอบ
  const loadingBubbleId = "chat-loading-" + Date.now();
  const loadingBubble = document.createElement('div');
  loadingBubble.className = "chat-msg chat-msg-bot";
  loadingBubble.id = loadingBubbleId;
  loadingBubble.innerHTML = `<span class="spinner-icon" style="margin-right: 6px;"></span> กำลังทบทวนเนื้อเรื่อง...`;
  chatBody.appendChild(loadingBubble);
  scrollChatToBottom();

  isChatResponding = true;

  try {
    const ctx = await buildHierarchicalStoryContext();

    const systemPrompt = `คุณคือ "เพื่อนร่วมอ่านนิยาย" (Reading Companion) ผู้เชี่ยวชาญนิยายแนว ${ctx.genre}
งานของคุณคือคุยแลกเปลี่ยน ตอบคำถาม วิเคราะห์ตัวละคร และสรุปเนื้อเรื่องให้นักอ่านฟังอย่างเป็นกันเองและสนุกสนาน

ข้อมูลบริบทนิยาย:
- เรื่อง: "${ctx.bookTitle}" (ผู้แต่ง: ${ctx.author || 'ไม่ระบุ'})
- แนวเรื่อง: ${ctx.genre}
- ตอนปัจจุบันที่ผู้อ่านกำลังอ่านอยู่: "${ctx.currentChapTitle}" (ตอนที่ ${ctx.currentChapOrder})

สรุปไทม์ไลน์เหตุการณ์ที่ผ่านมา (ย้อนหลัง):
${ctx.timeline || '(ไม่มีบันทึกสรุปก่อนหน้านี้)'}

คลังศัพท์และตัวละครสำคัญ:
${ctx.glossary || '(ไม่มีข้อมูลศัพท์)'}

เนื้อหาในตอนปัจจุบันที่กำลังอ่าน:
${ctx.currentChapterText || '(ไม่มีข้อความ)'}

กฎสำคัญที่สุด:
1. ตอบเป็นภาษาไทย สำนวนเป็นกันเองเหมือนเพื่อนนั่งอ่านนิยายด้วยกัน สุภาพแต่สนุกสนาน
2. ยึดข้อมูลตามที่ให้มาเท่านั้น **ห้ามแต่งเรื่องสปอยล์ล่วงหน้าเกินกว่าตอนที่ ${ctx.currentChapOrder}** เด็ดขาด
3. ถ้าถามถึงตัวละครหรือระดับพลัง ให้ใช้ชื่อภาษาไทยตามคลังศัพท์
4. กระชับ ตรงประเด็น ไม่เยิ่นเย้อจนน่าเบื่อ`;

    const contents = [];
    contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
    contents.push({ role: 'model', parts: [{ text: "เข้าใจแล้วครับ พร้อมเป็นคู่หูคุยเรื่องนิยายเรื่องนี้แล้วครับ!" }] });

    // ประวัติการแชทย้อนหลัง 4 ข้อความ
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
        generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
      })
    });

    if (!res.ok) {
      if (res.status === 429) rotateApiKey();
      throw new Error(`API Error: ${res.status}`);
    }

    const data = await res.json();
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "ขออภัยครับ ไม่สามารถตอบได้ในขณะนี้";

    // อัปเดตฟองข้อความ
    const targetBubble = document.getElementById(loadingBubbleId);
    if (targetBubble) {
      targetBubble.innerHTML = formatChatReply(replyText);
    }

    chatHistory.push({ role: 'user', text: userText });
    chatHistory.push({ role: 'model', text: replyText });
  } catch (err) {
    const targetBubble = document.getElementById(loadingBubbleId);
    if (targetBubble) {
      targetBubble.innerHTML = `<span style="color:#ef4444;">เกิดข้อผิดพลาดในการตอบ: ${err.message}</span>`;
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
  // ตัวหนา **คำ**
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  // บรรทัดใหม่
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
  sendChatMessage(`ช่วยอธิบายหรือบอกข้อมูลเกี่ยวกับ "${word}" ในเรื่องนี้หน่อยครับว่าคือใคร/คืออะไร และมีบทบาทอย่างไร?`);
}
