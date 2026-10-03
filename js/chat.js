// ============================================================================
// NOVELTRANSLATE AI - CHAT & READING COMPANION MODULE (chat.js)
// รองรับ:
// 1. Hard Chapter Fence (ป้องกันสปอยล์ข้ามตอน)
// 2. Book-Isolated Chat Session (แยกประวัติรายเรื่อง ป้องกันบริบทปนเปื้อน)
// 3. Alias Graph Engine (ค้นหาฉายา / ชื่อแฝง / ตำแหน่งในอดีต)
// 4. Quote / Dialogue Back-Reference (ดึงคำพูดจริงจากย่อหน้าในบท)
// 5. Delta-State Analyzer (วิเคราะห์จุดเปลี่ยน อดีต VS ปัจจุบัน)
// 6. Chapter Classification Filter (กรองข้ามประกาศคนเขียน และแยกตอนพิเศษ)
// 7. Universal Scaling & Cross-Book Shelf Comparison (ถกสเกลพลังข้ามเรื่อง)
// ============================================================================

let chatSessionsByBook = {};
let isChatResponding = false;

function getCurrentBookChatHistory() {
  const bId = currentBookId || 'default';
  if (!chatSessionsByBook[bId]) {
    chatSessionsByBook[bId] = [];
  }
  return chatSessionsByBook[bId];
}

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
    renderCurrentBookChatSession();
    scrollChatToBottom();
  }
}

function renderCurrentBookChatSession() {
  const body = document.getElementById('chat-messages-body');
  if (!body) return;

  const history = getCurrentBookChatHistory();
  if (history.length === 0) {
    body.innerHTML = `
      <div class="chat-msg chat-msg-bot">
        สวัสดีครับ! ผมคือเพื่อนอ่านนิยายเรื่อง <b>${escapeHtml(currentBookTitle || 'เล่มนี้')}</b> ถามสเตตัส สรุปเนื้อหา ทบทวนเหตุการณ์ย้อนหลัง เปรียบเทียบพัฒนาการ หรือคุยเทียบสเกลพลังได้เต็มที่เลยครับ 📖
      </div>
    `;
  } else {
    body.innerHTML = '';
    history.forEach(msg => {
      const msgDiv = document.createElement('div');
      msgDiv.className = `chat-msg chat-msg-${msg.role === 'user' ? 'user' : 'bot'}`;
      msgDiv.innerHTML = msg.role === 'user' ? escapeHtml(msg.text) : formatChatReply(msg.text);
      body.appendChild(msgDiv);
    });
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
  const bId = currentBookId || 'default';
  chatSessionsByBook[bId] = [];
  renderCurrentBookChatSession();
}

// ---------------- 1. ALIAS GRAPH ENGINE ----------------

async function buildAliasGraph(availableChaps) {
  const aliasMap = new Map();
  const activeTerms = await getActiveGlossaryForCurrentBook();

  for (const [src, item] of Object.entries(activeTerms)) {
    const tgt = item.resolvedTgt || "";
    if (tgt) {
      if (!aliasMap.has(tgt)) aliasMap.set(tgt, new Set());
      aliasMap.get(tgt).add(src);
      aliasMap.get(tgt).add(tgt);

      if (Array.isArray(item.aliases)) {
        item.aliases.forEach(a => aliasMap.get(tgt).add(a));
      }
    }
  }

  // ดึงความสัมพันธ์จาก Dossier (ข้ามบทที่เป็นประกาศคนเขียน)
  availableChaps.filter(c => c.chapterType !== 'announcement').forEach(ch => {
    const d = ch.dossier;
    if (d && Array.isArray(d.state_transitions)) {
      d.state_transitions.forEach(st => {
        if (st.category === 'character' || st.category === 'title') {
          const mainName = st.th || st.src;
          if (!aliasMap.has(mainName)) aliasMap.set(mainName, new Set());
          aliasMap.get(mainName).add(st.src);
          if (st.th) aliasMap.get(mainName).add(st.th);
          if (st.owner) aliasMap.get(mainName).add(st.owner);
        }
      });
    }
  });

  return aliasMap;
}

function resolveAllQueryAliases(query, aliasGraph) {
  const allRelatedNames = new Set();
  const qLower = query.toLowerCase();

  for (const [canonical, aliases] of aliasGraph.entries()) {
    let matched = false;
    for (const name of aliases) {
      if (name && qLower.includes(name.toLowerCase())) {
        matched = true;
        break;
      }
    }
    if (matched) {
      aliases.forEach(a => allRelatedNames.add(a));
    }
  }

  return Array.from(allRelatedNames);
}

// ---------------- 2. DELTA-STATE ANALYZER ----------------

function analyzeDeltaState(userQuery, availableChaps, expandedTerms) {
  const q = userQuery.toLowerCase();
  const isComparisonQuery = /แต่ก่อน|ตอนนี้|ทำไมถึง|เทียบกับ|เปลี่ยนไป|พัฒนา|เก่งขึ้น|แรกเริ่ม|ตอนแรก|กลายเป็น/.test(q);
  if (!isComparisonQuery || expandedTerms.length === 0) return null;

  const timelineRecords = [];

  // กรองเฉพาะเนื้อหาหลัก (ข้ามประกาศและตอนพิเศษนอกเส้นเรื่องหลัก)
  availableChaps.filter(c => c.chapterType !== 'announcement' && c.chapterType !== 'side_story').forEach(ch => {
    const d = ch.dossier;
    if (!d) return;

    if (Array.isArray(d.state_transitions)) {
      d.state_transitions.forEach(st => {
        const matches = expandedTerms.some(term => 
          (st.src && st.src.toLowerCase().includes(term.toLowerCase())) ||
          (st.th && st.th.toLowerCase().includes(term.toLowerCase())) ||
          (st.owner && st.owner.toLowerCase().includes(term.toLowerCase()))
        );
        if (matches) {
          timelineRecords.push({
            chapter: ch.order,
            title: ch.title,
            action: st.action,
            details: st.details,
            realm: d.current_status_snapshot?.protagonist_realm || "ไม่ระบุ"
          });
        }
      });
    }
  });

  if (timelineRecords.length < 2) return null;

  const earliest = timelineRecords[0];
  const latest = timelineRecords[timelineRecords.length - 1];

  return {
    isDetected: true,
    earliest: `[จุดเริ่มต้น - ตอนที่ ${earliest.chapter}] สถานะ: ${earliest.action} | รายละเอียด: ${earliest.details}`,
    latest: `[จุดปัจจุบัน - ตอนที่ ${latest.chapter}] สถานะ: ${latest.action} | รายละเอียด: ${latest.details}`,
    milestonesCount: timelineRecords.length,
    intermediateSteps: timelineRecords.slice(1, -1).map(r => `ตอนที่ ${r.chapter}: ${r.details}`).slice(-4)
  };
}

// ---------------- 3. INVERTED INDEX & SCANNER ----------------

async function findBilingualStateTimeline(userQuery, maxAllowedOrder) {
  const query = userQuery.trim().toLowerCase();
  const bookChaps = await dbGetChaptersByBook(currentBookId);
  bookChaps.sort((a, b) => a.order - b.order);

  // 1. HARD CHAPTER FENCE: กักข้อมูลไว้แค่ตอนที่กำลังอ่านอยู่
  const availableChaps = bookChaps.filter(c => (c.order || 0) <= maxAllowedOrder);

  // 2. ALIAS GRAPH
  const aliasGraph = await buildAliasGraph(availableChaps);
  let expandedTerms = resolveAllQueryAliases(query, aliasGraph);
  if (expandedTerms.length === 0) {
    expandedTerms = query.split(/\s+/).filter(w => w.length >= 2);
  }

  // 3. DELTA-STATE ANALYZER
  const deltaComparison = analyzeDeltaState(userQuery, availableChaps, expandedTerms);

  const matchedTransitions = [];
  const matchedEvents = [];
  const matchedQuotes = [];

  const isAskingForQuotes = /พูดว่า|คำพูด|ประโยค|สั่งเสีย|ตะโกน|กล่าวว่า|อุทาน/.test(query);

  availableChaps.forEach(ch => {
    // ข้ามบทประกาศเด็ดขาด
    if (ch.chapterType === 'announcement') return;

    const d = ch.dossier;

    if (d && Array.isArray(d.state_transitions)) {
      d.state_transitions.forEach(st => {
        const isHit = expandedTerms.some(term => 
          (st.src && st.src.toLowerCase().includes(term.toLowerCase())) ||
          (st.th && st.th.toLowerCase().includes(term.toLowerCase())) ||
          (st.owner && st.owner.toLowerCase().includes(term.toLowerCase()))
        );

        if (isHit) {
          matchedTransitions.push({
            chapter: ch.order,
            title: ch.title,
            isSideStory: ch.chapterType === 'side_story',
            ...st
          });
        }
      });
    }

    if (d && Array.isArray(d.key_events)) {
      d.key_events.forEach(ev => {
        const isHit = expandedTerms.some(term => ev.toLowerCase().includes(term.toLowerCase()));
        if (isHit) {
          const prefix = ch.chapterType === 'side_story' ? '[ตอนพิเศษ] ' : '';
          matchedEvents.push(`- ตอนที่ ${ch.order} ${prefix}(${ch.title}): ${ev}`);
        }
      });
    }

    if (isAskingForQuotes && Array.isArray(ch.paragraphs)) {
      ch.paragraphs.forEach(p => {
        if (!p.th) return;
        if ((p.th.includes('“') || p.th.includes('"') || p.th.includes('「')) && 
            expandedTerms.some(term => p.th.toLowerCase().includes(term.toLowerCase()))) {
          matchedQuotes.push(`[ตอนที่ ${ch.order}] ${p.th.trim()}`);
        }
      });
    }
  });

  return {
    expandedTerms,
    deltaComparison,
    matchedTransitions,
    matchedEvents: matchedEvents.slice(-8),
    matchedQuotes: matchedQuotes.slice(-5)
  };
}

function consolidateCurrentInventory(bookChaps, maxAllowedOrder) {
  const inventory = new Map();
  let latestRealm = "ไม่ระบุ";
  let latestInjuries = "ปกติ";

  // กรองเฉพาะเนื้อเรื่องหลัก regular (ไม่เอา announcement และ side_story)
  bookChaps
    .filter(c => (c.order || 0) <= maxAllowedOrder && c.chapterType !== 'announcement' && c.chapterType !== 'side_story')
    .forEach(ch => {
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

async function findCrossBookContextIfAny(userQuery) {
  const query = userQuery.toLowerCase();
  const allBooks = await dbGetAllBooks();
  const otherBooks = allBooks.filter(b => b.id !== currentBookId);

  const matchedOtherBooks = [];
  for (const b of otherBooks) {
    const bTitle = (b.title || "").toLowerCase();
    if (bTitle.length >= 2 && query.includes(bTitle)) {
      const bChaps = await dbGetChaptersByBook(b.id);
      bChaps.sort((a, b) => a.order - b.order);
      const lastChap = bChaps[bChaps.length - 1];
      const otherNet = consolidateCurrentInventory(bChaps, lastChap ? lastChap.order : 9999);
      
      matchedOtherBooks.push({
        title: b.title,
        genre: b.genre || "ไม่ระบุ",
        totalChapters: bChaps.length,
        realm: otherNet.latestRealm,
        topItems: otherNet.currentHoldings.slice(0, 5).map(h => h.th).join(', ')
      });
    }
  }

  return matchedOtherBooks;
}

// ---------------- 4. HIERARCHICAL CONTEXT BUILDER ----------------

async function buildHierarchicalStoryContext(userQuery, isFullRecapMode = false) {
  const curChap = chapters[currentChapterIndex] || {};
  const bookChaps = await dbGetChaptersByBook(currentBookId);
  bookChaps.sort((a, b) => a.order - b.order);

  const maxAllowedOrder = curChap.order || (currentChapterIndex + 1);
  const availableChaps = bookChaps.filter(c => (c.order || 0) <= maxAllowedOrder);

  const searchEvidence = await findBilingualStateTimeline(userQuery, maxAllowedOrder);
  const netStatus = consolidateCurrentInventory(bookChaps, maxAllowedOrder);
  const crossBooks = await findCrossBookContextIfAny(userQuery);

  const timelineMilestones = [];
  availableChaps.forEach(ch => {
    if (ch.chapterType === 'announcement') return;

    const tag = ch.chapterType === 'side_story' ? '[ตอนพิเศษ] ' : '';
    if (ch.dossier && Array.isArray(ch.dossier.key_events) && ch.dossier.key_events.length > 0) {
      timelineMilestones.push(`[ตอนที่ ${ch.order}] ${tag}${ch.dossier.key_events.join('; ')}`);
    } else if (ch.summary) {
      timelineMilestones.push(`[ตอนที่ ${ch.order}] ${tag}${ch.summary}`);
    }
  });

  let sampledTimeline = timelineMilestones;
  if (timelineMilestones.length > 25 && !isFullRecapMode) {
    const step = Math.ceil(timelineMilestones.length / 20);
    sampledTimeline = timelineMilestones.filter((_, idx) => idx % step === 0 || idx >= timelineMilestones.length - 5);
  }

  const recentSummaries = [];
  availableChaps.filter(c => c.chapterType !== 'announcement').slice(-8).forEach(ch => {
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
    currentChapOrder: maxAllowedOrder,
    currentChapType: curChap.chapterType || "regular",
    evidence: searchEvidence,
    netStatus: netStatus,
    crossBooks: crossBooks,
    sampledTimeline: sampledTimeline.join("\n"),
    recentSummaries: recentSummaries.join("\n"),
    currentChapterText: currentChapterText.substring(0, 4000)
  };
}

async function requestFullStoryRecap() {
  const curChap = chapters[currentChapterIndex] || {};
  const maxOrder = curChap.order || (currentChapterIndex + 1);
  const prompt = `ช่วยสรุปภาพรวมมหากาพย์ของนิยายเรื่อง "${currentBookTitle}" ตั้งแต่ตอนที่ 1 จนถึงตอนที่ ${maxOrder} (${curChap.title}) ให้ฟังอย่างละเอียดและเห็นภาพรวมครบทั้ง 4 ด้านหน่อยครับ`;
  await sendChatMessage(prompt, true);
}

// ---------------- 5. MAIN CHAT CONTROLLER ----------------

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
  loadingBubble.innerHTML = `<span class="spinner-icon" style="margin-right: 6px;"></span> ${forceRecapMode ? 'กำลังประมวลผลสรุป 4 มิติ...' : 'กำลังวิเคราะห์ไทม์ไลน์และสืบค้นข้อมูล...'}`;
  chatBody.appendChild(loadingBubble);
  scrollChatToBottom();

  isChatResponding = true;

  try {
    const isRecap = forceRecapMode || /สรุปเรื่อง|สรุปตั้งแต่ตอนที่ 1|ภาพรวมทั้งหมด|สรุปมหากาพย์/.test(userText);
    const ctx = await buildHierarchicalStoryContext(userText, isRecap);

    let evidenceSection = "ไม่มีหลักฐานเจาะจงเฉพาะคำ";
    if (ctx.evidence.matchedTransitions.length > 0) {
      evidenceSection = "ประวัติความเคลื่อนไหว (State Transitions) ที่ตรวจพบ:\n" + 
        ctx.evidence.matchedTransitions.map(t => 
          `* [ตอนที่ ${t.chapter} - ${t.title}${t.isSideStory ? ' (ตอนพิเศษ)' : ''}] คำจีน: "${t.src}" (${t.th}) | การกระทำ: [${t.action}] โดย: ${t.owner} -> รายละเอียด: ${t.details}`
        ).join("\n");
    }

    let holdingsSection = ctx.netStatus.currentHoldings.length > 0 
      ? ctx.netStatus.currentHoldings.map(h => `- ${h.th} (${h.src}) [${h.category}] ได้รับในตอนที่ ${h.lastUpdatedChapter}`).join("\n")
      : "ไม่มีรายการของวิเศษคงเหลือที่บันทึกไว้";

    let deltaSection = "";
    if (ctx.evidence.deltaComparison) {
      const d = ctx.evidence.deltaComparison;
      deltaSection = `[การวิเคราะห์ความเปลี่ยนแปลงเชิงเวลา (Delta-State Analysis)]:\n` +
        `- สภาพในอดีต: ${d.earliest}\n` +
        `- สภาพปัจจุบัน: ${d.latest}\n` +
        `- ลำดับจุดเปลี่ยนสำคัญระหว่างทาง:\n` +
        d.intermediateSteps.map(s => `  * ${s}`).join('\n') + `\n`;
    }

    let crossBooksSection = "";
    if (ctx.crossBooks.length > 0) {
      crossBooksSection = `[ข้อมูลนิยายเรื่องอื่นในชั้นหนังสือที่ถูกกล่าวถึง เพื่อใช้เปรียบเทียบ]:\n` +
        ctx.crossBooks.map(cb => `- เรื่อง "${cb.title}" (แนว ${cb.genre}): อ่านถึงตอนที่ ${cb.totalChapters}, ระดับพลังล่าสุด: ${cb.realm}, สมบัติเด่น: ${cb.topItems || 'ไม่ระบุ'}`).join('\n');
    }

    let quotesSection = "";
    if (ctx.evidence.matchedQuotes.length > 0) {
      quotesSection = `[บทสนทนา/คำพูดจริงที่คัดลอกมาจากเนื้อหาในตอน]:\n` + ctx.evidence.matchedQuotes.join('\n');
    }

    let systemPrompt = "";

    if (isRecap) {
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
1. 🗺️ **เส้นเรื่องหลักและหมุดหมายสำคัญ:** เล่าลำดับการเดินทาง เหตุการณ์พลิกผันใหญ่ๆ ตั้งแต่เริ่มเรื่องจนถึงจุดปัจจุบัน
2. ⚔️ **สถานะขั้วอำนาจและศัตรู:** ฝ่ายใดเป็นมิตร ฝ่ายใดเป็นศัตรู มีความแค้นหรือข้อพิพาทกับใครอยู่
3. 🧬 **พัฒนาการของตัวเอก:** การเติบโตของระดับพลัง วิชาประจำตัว และการเปลี่ยนแปลงสถานะในยุทธภพ
4. 🚩 **เป้าหมายเร่งด่วนในปัจจุบัน:** สิ่งที่ตัวเอกกำลังมุ่งหน้าไปทำในบทปัจจุบัน

ข้อบังคับ: เขียนกระชับ ลื่นไหล เป็นกันเอง ห้ามแต่งเรื่องขึ้นมาเอง และห้ามสปอยล์เกินตอนที่ ${ctx.currentChapOrder}`;
    } else {
      systemPrompt = `คุณคือ "เพื่อนสนิทร่วมอ่านนิยาย" (Reading Companion) ผู้เชี่ยวชาญวรรณกรรมนิยายจีน กำลังภายใน และแฟนตาซีทุกแขนง
นักอ่านกำลังเปิดอ่านเรื่อง: "${ctx.bookTitle}" (ผู้แต่ง: ${ctx.author || 'ไม่ระบุ'}, แนว: ${ctx.genre})
สายตานักอ่านอยู่ที่: ตอนที่ ${ctx.currentChapOrder} ("${ctx.currentChapTitle}")

[กฎเหล็กเรื่องกำแพงความรู้ (Strict Knowledge Boundary)]:
1. คุณมีความรู้ในเรื่อง "${ctx.bookTitle}" สิ้นสุดที่ตอนที่ ${ctx.currentChapOrder} เท่านั้น ห้ามเดาหรือสปอยล์เหตุการณ์ในตอนอนาคตเด็ดขาด
2. สำหรับข้อเท็จจริงในเรื่อง ให้ยึดตาม [หลักฐานและสถานะสุทธิ] ที่ให้มาอย่างเคร่งครัด

${deltaSection ? deltaSection + "\n" : ""}[หลักฐานประวัติความเคลื่อนไหว (Ground Truth Evidence)]:
${evidenceSection}

[เหตุการณ์สำคัญที่เกี่ยวข้อง]:
${ctx.evidence.matchedEvents.join("\n") || "- ไม่มี"}

${quotesSection ? quotesSection + "\n" : ""}[สถานะสุทธิล่าสุดของตัวเอก ณ ตอนที่ ${ctx.currentChapOrder}]:
- ระดับพลัง: ${ctx.netStatus.latestRealm}
- อาการบาดเจ็บ: ${ctx.netStatus.latestInjuries}
- ไอเทม/วิชาที่ถือครองอยู่จริงในปัจจุบัน (Active Inventory):
${holdingsSection}

${crossBooksSection ? crossBooksSection + "\n" : ""}[สรุปเนื้อหาตอนล่าสุด]:
${ctx.recentSummaries || "- ไม่มีสรุป"}

[แนวทางการคุยและเปรียบเทียบ (Discussion & Universal Scaling Guide)]:
- หากมีการวิเคราะห์ความเปลี่ยนแปลงเชิงเวลา (Delta-State) ให้อธิบายชัดเจนว่าเดิมทีสถานะเป็นอย่างไร เกิดจุดเปลี่ยนอะไรในตอนไหน และทำไมปัจจุบันถึงกลายมาเป็นแบบนี้
- หากผู้ใช้ถามเปรียบเทียบพลัง ตัวละคร หรือวิชากับนิยายเรื่องอื่น:
  * ใช้ความรู้สากลของคุณเกี่ยวกับวรรณกรรมเรื่องนั้นๆ มาร่วมวิเคราะห์อย่างออกรส
  * ใช้เกณฑ์เทียบสเกลพลังจากผลงานการทำลายล้างจริง (Feats / Universal Tiers: ระดับมนุษย์ -> ระดับทำลายภูเขา/เมือง -> ระดับทำลายทวีป/ดวงดาว -> ระดับจักรวาล/มหาเต๋า)
  * ออกความเห็นและคุยสนุกสนานเหมือนเพื่อนนั่งเมาท์นิยายข้างๆ กัน
- ตอบเป็นภาษาไทย สำนวนเป็นกันเอง สนุกสนาน คมชัด ตรงประเด็น`;
    }

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: "เข้าใจบริบทและพร้อมเป็นคู่หูคุยนิยายอย่างแม่นยำและสนุกสนานแล้วครับ!" }] }
    ];

    const currentHistory = getCurrentBookChatHistory();
    currentHistory.slice(-4).forEach(h => {
      contents.push({ role: h.role, parts: [{ text: h.text }] });
    });

    contents.push({ role: 'user', parts: [{ text: userText }] });

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${primaryModel}:generateContent?key=${activeKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contents,
        generationConfig: { temperature: 0.6, maxOutputTokens: 1500 }
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

    currentHistory.push({ role: 'user', text: userText });
    currentHistory.push({ role: 'model', text: replyText });
  } catch (err) {
    const targetBubble = document.getElementById(loadingBubbleId);
    if (targetBubble) {
      targetBubble.innerHTML = `<span style="color:#ef4444;">เกิดข้อผิดพลาดในการสืบค้น: ${escapeHtml(err.message)}</span>`;
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
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function askBotAboutSelection() {
  if (!selectedWordBuffer) return;
  const word = selectedWordBuffer.trim();
  dismissSelectionBar();
  toggleChatDrawer();
  sendChatMessage(`ช่วยตรวจสอบสถานะและประวัติของ "${word}" ให้หน่อยครับว่าโผล่มาตอนไหน ปัจจุบันเป็นอย่างไร และอยู่กับใคร?`);
}
