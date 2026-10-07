// ==================== เมนู ⋯ และส่งออกตอนที่อ่านอยู่ (แยกจาก app.js) ====================
// โหลดหลัง app.js (ดู index.html) ทุกอย่างในไฟล์นี้ถูกเรียกหลังหน้าโหลดเสร็จ จึงใช้ตัวแปรของ app.js ได้ตามปกติ

function exportTxt() {
  const chap = chapters[currentChapterIndex];
  let txt = `${currentBookTitle}\n${chap.title}\n\n`;
  chap.paragraphs.forEach(p => { txt += p.th + "\n\n"; });
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${chap.title}.txt`;
  a.click();
}

// ==================== เมนู ⋯ ====================
// เมนูหลัก (มือถือ: ปุ่ม ⋯ บนหัวและแถบล่าง) รวมปุ่มที่ไม่ได้ใช้ทุกตอน หัวจอจึงไม่ต้องเลื่อนข้าง
function openMoreMenu(anchor) {
  openActionMenu(anchor, [
    { icon: '📖', label: 'คลังศัพท์', hint: 'ชื่อเฉพาะและคำแปลที่ล็อกไว้', onSelect: openGlossaryModal },
    { icon: '🧭', label: 'คู่มือเรื่อง', hint: 'ตัวละคร สรรพนาม แนวทางสำนวน', onSelect: openBibleModal },
    { icon: '⚙️', label: 'ตั้งค่า', hint: 'API key โมเดล สำรองข้อมูล', onSelect: openSettingsModal },
    { icon: '💬', label: 'ส่งความเห็น / แจ้งปัญหา', hint: 'บอกสิ่งที่เจอหรืออยากได้', onSelect: () => openFeedbackModal() },
    { icon: '📲', label: 'ติดตั้งแอพ', hint: 'อ่านแบบออฟไลน์ได้', hidden: !deferredInstallPrompt, onSelect: promptInstallApp }
  ], { title: 'เมนู' });
}

// เมนูของตอนที่อ่านอยู่ (แทนปุ่มลอย 🔄 🔍+ เดิม) คำสั่งที่ใช้โควตา AI บอกไว้ในคำอธิบาย
function openChapterMenu(anchor) {
  const chap = chapters[currentChapterIndex];
  if (!chap || currentBookId === 'default_novel') return;
  openActionMenu(anchor, [
    { icon: '🔄', label: 'แปลตอนนี้ใหม่', hint: 'ใช้โควตา AI · ถามก่อนเริ่ม', onSelect: retranslateCurrentActiveChapter },
    { icon: '🔍', label: 'สแกนหาคำศัพท์ใหม่', hint: 'ใช้โควตา AI · เพิ่มชื่อที่ยังไม่มีในคลัง', onSelect: scanTermsInCurrentChapter },
    { icon: '🕘', label: 'ประวัติคำแปล', hint: 'ดู/กู้คืนคำแปลรุ่นก่อน', hidden: !chap.hasVersions, onSelect: () => openVersionHistory(chap.id) },
    { icon: '📊', label: 'รายงานคุณภาพของเรื่อง', hint: 'ย่อหน้าน่าสงสัย คำศัพท์ใหม่', onSelect: () => openQualityReport(currentBookId) },
    { icon: '⬇️', label: 'ส่งออกตอนนี้เป็น .TXT', onSelect: exportTxt }
  ], { title: chap.title || 'ตอนนี้' });
}
