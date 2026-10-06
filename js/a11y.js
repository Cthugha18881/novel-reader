// ==================== การเข้าถึง: หน้าต่าง (modal) และชื่อที่โปรแกรมอ่านจออ่าน (แยกจาก app.js) ====================
// โหลดหลัง app.js (ดู index.html) ทุกอย่างในไฟล์นี้ถูกเรียกหลังหน้าโหลดเสร็จ จึงใช้ตัวแปรของ app.js ได้ตามปกติ

// ---------- หน้าต่าง (modal): role dialog, ปิดด้วย Esc, ล็อกโฟกัสไว้ข้างใน, คืนโฟกัสเมื่อปิด (WCAG 2.1.2 / 2.4.3 / 4.1.2) ----------
const MODAL_FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const modalReturnFocus = new Map();

function modalFocusables(modal) {
  return [...modal.querySelectorAll(MODAL_FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
}

/** หน้าต่างบนสุดที่เปิดอยู่ (z-index สูงสุด ถ้าเท่ากันใช้อันที่อยู่ท้ายสุดในหน้า) */
function topmostModal() {
  const open = [...document.querySelectorAll('.modal-overlay.active')];
  return open.sort((a, b) => (parseInt(getComputedStyle(a).zIndex, 10) || 0) - (parseInt(getComputedStyle(b).zIndex, 10) || 0)).pop() || null;
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  const box = modal.querySelector('.modal-box') || modal;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const title = modal.querySelector('.modal-title');
  if (title) {
    if (!title.id) title.id = `${id}-title`;
    box.setAttribute('aria-labelledby', title.id);
  }
  modal.querySelectorAll('.modal-close').forEach(btn => { if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', 'ปิด'); });
  if (!modal.classList.contains('active') && document.activeElement && document.activeElement !== document.body) {
    modalReturnFocus.set(id, document.activeElement);
  }
  modal.classList.add('active');
  document.body.classList.add('modal-open');
  // โฟกัสช่องแรกที่กรอกได้ ถ้าไม่มีใช้ปุ่มแรก (รอให้เนื้อหาที่เพิ่งวาดเสร็จก่อน)
  setTimeout(() => {
    if (!modal.classList.contains('active') || modal.contains(document.activeElement)) return;
    const items = modalFocusables(modal);
    const field = items.find(el => el.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, select'));
    (field || items.find(el => !el.classList.contains('modal-close')) || items[0])?.focus({ preventScroll: true });
  }, 60);
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  const wasOpen = modal.classList.contains('active');
  modal.classList.remove('active');
  if (!document.querySelector('.modal-overlay.active')) {
    document.body.classList.remove('modal-open');
  }
  const back = modalReturnFocus.get(id);
  modalReturnFocus.delete(id);
  if (wasOpen && back?.isConnected) back.focus({ preventScroll: true });
}

// ---------- ชื่อที่โปรแกรมอ่านจออ่าน (WCAG 4.1.2 / 2.5.3) ----------
// ปุ่มที่มีแต่อีโมจิ (🔎 🎧 🔄): ชื่อปุ่มคำนวณจากเนื้อหาก่อน title จึงถูกอ่านเป็นชื่ออีโมจิ -> ใช้ title เป็น aria-label
// ช่องกรอกที่ไม่มี label: ใช้ placeholder / title / ค่า (เช่น checkbox ของคำศัพท์) เป็นชื่อ
const LETTER_REGEX = /[A-Za-z฀-๿぀-ヿ㐀-鿿가-힯0-9]/;

function nameControl(el) {
  if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
  if (el.matches('button')) {
    if (!LETTER_REGEX.test(el.textContent || '') && el.title) el.setAttribute('aria-label', el.title);
    return;
  }
  if (el.labels && el.labels.length) return;
  // label ที่มองเห็นแต่ไม่ได้ผูกกับช่อง (ป้ายเหนือช่องในกลุ่มเดียวกัน) ใช้ก่อน placeholder
  const groupLabel = el.closest('.form-group')?.querySelector('.form-label')?.textContent?.trim();
  const name = groupLabel || el.placeholder || el.title || (el.type === 'checkbox' && el.value && el.value !== 'on' ? `เลือก ${el.value}` : '');
  if (name) el.setAttribute('aria-label', name);
}

function nameControlsIn(root) {
  if (root.nodeType !== 1) return;
  if (root.matches?.('button, input, textarea, select')) nameControl(root);
  root.querySelectorAll?.('button, input, textarea, select').forEach(nameControl);
}

function setupAccessibleNames() {
  nameControlsIn(document.body);
  // ปุ่ม/ช่องที่สร้างทีหลัง (รายการคลังศัพท์ ชั้นหนังสือ แถบเสียงอ่าน ฯลฯ)
  new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(nameControlsIn)))
    .observe(document.body, { childList: true, subtree: true });
}

function setupModalKeyboard() {
  document.addEventListener('keydown', (e) => {
    const modal = topmostModal();
    // ไม่มีหน้าต่างเปิด: Esc ปิดแผงตั้งค่าการอ่าน / แผงผู้ช่วย
    if (!modal) {
      if (e.key !== 'Escape') return;
      if (document.getElementById('reader-panel')?.classList.contains('open')) toggleReaderPanel(false);
      else if (document.getElementById('assistant-panel')?.classList.contains('open')) toggleAssistantPanel(false);
      return;
    }
    if (e.key === 'Escape') {
      // ใช้ปุ่มปิดของหน้าต่างนั้น (บางหน้าต่างต้องยกเลิกงาน/ล้างข้อมูลที่ค้างตอนปิด)
      e.preventDefault();
      const closeBtn = modal.querySelector('.modal-head .modal-close') || modal.querySelector('.modal-close');
      if (closeBtn) closeBtn.click();
      else closeModal(modal.id);
      return;
    }
    if (e.key !== 'Tab') return;
    const items = modalFocusables(modal);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!modal.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
