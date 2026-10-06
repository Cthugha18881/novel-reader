// ==================== APP DIALOGS (แทน alert / confirm / prompt ของเบราว์เซอร์) ====================
// กล่องของเบราว์เซอร์บล็อกทั้งหน้า ปุ่มเป็น "OK/Cancel" ที่ไม่บอกผลของการกด และมือถือบางรุ่นบล็อกกล่องซ้ำ
// กล่องของแอพ: ปุ่มเขียนเป็นคำกริยาบอกผล ("ลบ 3 ตอน" / "ยกเลิก"), ปิดด้วย Esc ได้ (= ยกเลิก), โฟกัสอยู่ในกล่อง
// ทุกฟังก์ชันคืน Promise จึงต้อง await ตอนต้องการคำตอบ
//
// appAlert(message, { title })                                  -> Promise<void>
// appConfirm(message, { title, confirmLabel, cancelLabel, danger }) -> Promise<boolean>
// appPrompt(message, defaultValue, { title, confirmLabel, placeholder, multiline }) -> Promise<string | null>
// appChoose(message, [{ label, value, variant }], { title })    -> Promise<value | null>  (Esc = null)

const DIALOG_ID = 'app-dialog';
const dialogQueue = [];
let dialogActive = null;

function ensureDialogElement() {
  let el = document.getElementById(DIALOG_ID);
  if (el) return el;
  el = document.createElement('div');
  el.className = 'modal-overlay app-dialog-overlay';
  el.id = DIALOG_ID;
  el.innerHTML = `<div class="modal-box app-dialog-box">
    <div class="modal-head"><div class="modal-title" id="${DIALOG_ID}-title"></div><button class="modal-close" aria-label="ปิด" onclick="resolveAppDialog(null)">✕</button></div>
    <div class="app-dialog-message" id="${DIALOG_ID}-message"></div>
    <div class="app-dialog-input-wrap" id="${DIALOG_ID}-input-wrap"></div>
    <div class="app-dialog-actions" id="${DIALOG_ID}-actions"></div>
  </div>`;
  document.body.appendChild(el);
  return el;
}

function showNextDialog() {
  if (dialogActive || !dialogQueue.length) return;
  dialogActive = dialogQueue.shift();
  const d = dialogActive;
  ensureDialogElement();
  document.getElementById(`${DIALOG_ID}-title`).textContent = d.title || '';
  // ข้อความธรรมดา (ไม่ตีความเป็น HTML) ขึ้นบรรทัดใหม่ตาม \n
  document.getElementById(`${DIALOG_ID}-message`).textContent = d.message || '';
  const inputWrap = document.getElementById(`${DIALOG_ID}-input-wrap`);
  inputWrap.innerHTML = '';
  if (d.input) {
    const field = document.createElement(d.input.multiline ? 'textarea' : 'input');
    field.className = 'form-input';
    field.id = `${DIALOG_ID}-field`;
    if (!d.input.multiline) field.type = 'text';
    else field.rows = 4;
    field.value = d.input.value ?? '';
    field.placeholder = d.input.placeholder || '';
    field.setAttribute('aria-label', d.title || d.message || 'ข้อความ');
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && (!d.input.multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        resolveAppDialog(d.buttons.find(b => b.primary)?.value ?? true);
      }
    });
    inputWrap.appendChild(field);
  }
  const actions = document.getElementById(`${DIALOG_ID}-actions`);
  actions.innerHTML = '';
  d.buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = `btn${b.variant === 'primary' ? ' btn-primary' : b.variant === 'danger' ? ' btn-danger' : ''}`;
    btn.textContent = b.label;
    btn.addEventListener('click', () => resolveAppDialog(b.value));
    actions.appendChild(btn);
  });
  openModal(DIALOG_ID);
  // โฟกัสช่องกรอก (เลือกข้อความเดิมไว้) หรือปุ่มหลัก ปุ่มลบไม่โฟกัสให้เอง กันกด Enter พลาด
  setTimeout(() => {
    const field = document.getElementById(`${DIALOG_ID}-field`);
    if (field) {
      field.focus();
      field.select?.();
      return;
    }
    const buttons = [...actions.querySelectorAll('button')];
    (buttons.find(b => b.classList.contains('btn-primary')) || buttons.find(b => !b.classList.contains('btn-danger')) || buttons[0])?.focus();
  }, 70);
}

/** ปิดกล่องปัจจุบันด้วยค่า value (null = ยกเลิก/Esc/✕) */
function resolveAppDialog(value) {
  const d = dialogActive;
  if (!d) return;
  let result = value;
  if (d.input) {
    const field = document.getElementById(`${DIALOG_ID}-field`);
    result = value === null || value === false ? null : (field ? field.value : '');
  }
  dialogActive = null;
  closeModal(DIALOG_ID);
  d.resolve(result);
  setTimeout(showNextDialog, 0);
}

function openAppDialog(spec) {
  // หน้าทดสอบ / ก่อนหน้าโหลดเสร็จ: ไม่มี DOM ให้ใช้ กลับไปใช้กล่องของเบราว์เซอร์
  if (typeof document === 'undefined' || !document.body || typeof openModal !== 'function') {
    if (spec.input) return Promise.resolve(window.prompt(spec.message, spec.input.value ?? ''));
    if (spec.kind === 'alert') { window.alert(spec.message); return Promise.resolve(); }
    return Promise.resolve(window.confirm(spec.message) ? spec.buttons.find(b => b.primary)?.value ?? true : null);
  }
  return new Promise(resolve => {
    dialogQueue.push({ ...spec, resolve });
    showNextDialog();
  });
}

function appAlert(message, { title = '' } = {}) {
  return openAppDialog({ kind: 'alert', title, message: String(message ?? ''), buttons: [{ label: 'ตกลง', value: true, variant: 'primary', primary: true }] }).then(() => undefined);
}

function appConfirm(message, { title = '', confirmLabel = 'ยืนยัน', cancelLabel = 'ยกเลิก', danger = false } = {}) {
  return openAppDialog({
    kind: 'confirm', title, message: String(message ?? ''),
    buttons: [
      { label: cancelLabel, value: false },
      { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary', primary: true }
    ]
  }).then(v => v === true);
}

function appPrompt(message, defaultValue = '', { title = '', confirmLabel = 'บันทึก', cancelLabel = 'ยกเลิก', placeholder = '', multiline = false } = {}) {
  return openAppDialog({
    kind: 'prompt', title, message: String(message ?? ''),
    input: { value: defaultValue ?? '', placeholder, multiline },
    buttons: [
      { label: cancelLabel, value: null },
      { label: confirmLabel, value: true, variant: 'primary', primary: true }
    ]
  });
}

// ==================== ACTION MENU (เมนู ⋯) ====================
// openActionMenu(anchorButton, [{ icon, label, hint, danger, hidden, onSelect }], { title })
// จอกว้าง: เมนูเล็กใต้ปุ่ม / มือถือ: แผ่นเลื่อนขึ้นจากล่าง (กดถึงง่ายด้วยนิ้วโป้ง)
// ลูกศรขึ้นลงเลื่อนรายการ, Esc / แตะข้างนอก = ปิด แล้วคืนโฟกัสให้ปุ่มที่เปิด
const ACTION_MENU_ID = 'action-menu';
let actionMenuState = null;

function closeActionMenu({ restoreFocus = true } = {}) {
  const state = actionMenuState;
  if (!state) return;
  actionMenuState = null;
  document.removeEventListener('pointerdown', state.onOutside, true);
  window.removeEventListener('resize', state.onResize);
  document.getElementById(ACTION_MENU_ID)?.remove();
  document.getElementById(`${ACTION_MENU_ID}-backdrop`)?.remove();
  state.anchor?.setAttribute('aria-expanded', 'false');
  if (restoreFocus && state.anchor?.isConnected) state.anchor.focus();
}

function positionActionMenu(menu, anchor) {
  const sheet = window.innerWidth < 768 || !anchor;
  menu.classList.toggle('action-menu-sheet', sheet);
  if (sheet) {
    menu.style.left = menu.style.top = menu.style.right = '';
    return;
  }
  const r = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
  const below = r.bottom + 6;
  const top = below + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - menu.offsetHeight - 6) : below;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openActionMenu(anchor, items, { title = '' } = {}) {
  const sameAnchor = actionMenuState?.anchor === anchor;
  closeActionMenu({ restoreFocus: false });
  if (sameAnchor) return; // กดปุ่มเดิมซ้ำ = ปิด
  const visible = (items || []).filter(it => it && !it.hidden);
  if (!visible.length) return;

  const backdrop = document.createElement('div');
  backdrop.id = `${ACTION_MENU_ID}-backdrop`;
  backdrop.className = 'action-menu-backdrop';
  const menu = document.createElement('div');
  menu.id = ACTION_MENU_ID;
  menu.className = 'action-menu';
  menu.setAttribute('role', 'menu');
  if (title) {
    menu.setAttribute('aria-label', title);
    const head = document.createElement('div');
    head.className = 'action-menu-title';
    head.textContent = title;
    menu.appendChild(head);
  }
  visible.forEach(it => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `action-menu-item${it.danger ? ' danger' : ''}`;
    btn.setAttribute('role', 'menuitem');
    btn.innerHTML = `<span class="action-menu-icon" aria-hidden="true"></span><span class="action-menu-text"><span class="action-menu-label"></span>${it.hint ? '<span class="action-menu-hint"></span>' : ''}</span>`;
    btn.querySelector('.action-menu-icon').textContent = it.icon || '';
    btn.querySelector('.action-menu-label').textContent = it.label;
    if (it.hint) btn.querySelector('.action-menu-hint').textContent = it.hint;
    btn.addEventListener('click', () => {
      closeActionMenu({ restoreFocus: true });
      try { it.onSelect?.(); } catch (err) { console.error(err); }
    });
    menu.appendChild(btn);
  });
  menu.addEventListener('keydown', (e) => {
    const list = [...menu.querySelectorAll('.action-menu-item')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeActionMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === 'Tab') closeActionMenu({ restoreFocus: false });
  });

  document.body.appendChild(backdrop);
  document.body.appendChild(menu);
  positionActionMenu(menu, anchor);
  anchor?.setAttribute('aria-haspopup', 'menu');
  anchor?.setAttribute('aria-expanded', 'true');
  const onOutside = (e) => {
    const path = e.composedPath ? e.composedPath() : [];
    if (path.includes(menu) || (anchor && path.includes(anchor))) return;
    closeActionMenu({ restoreFocus: false });
  };
  const onResize = () => positionActionMenu(menu, anchor);
  actionMenuState = { anchor, onOutside, onResize };
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', onResize);
  menu.querySelector('.action-menu-item')?.focus();
}

/** เลือก 1 จากหลายทาง choices: [{ label, value, variant: 'primary' | 'danger' | '' }] คืน value หรือ null ถ้ายกเลิก */
function appChoose(message, choices, { title = '', cancelLabel = 'ยกเลิก' } = {}) {
  return openAppDialog({
    kind: 'choose', title, message: String(message ?? ''),
    buttons: [{ label: cancelLabel, value: null }, ...choices.map(c => ({ ...c, primary: c.variant === 'primary' }))]
  });
}
