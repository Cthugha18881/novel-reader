// ==================== READING EXPERIENCE ====================
// ตั้งค่าการอ่าน, เลื่อนทีละหน้าจอ, ฟังเสียงอ่าน (TTS), ค้นหาข้อความ, บุ๊กมาร์กและโน้ตระดับย่อหน้า
// ไม่เปลี่ยนการจัดย่อหน้า (ชิดซ้าย/ย่อหน้าแรก) ของเนื้อเรื่อง ปรับได้เฉพาะฟอนต์ ขนาด ระยะ และความกว้าง

// ---------- ตั้งค่าการอ่าน ----------
const READING_FONTS = {
  sarabun: { label: 'Sarabun (ค่าเริ่มต้น)', css: "'Sarabun', sans-serif" },
  notoSans: { label: 'Noto Sans Thai', css: "'Noto Sans Thai', 'Sarabun', sans-serif" },
  notoSerif: { label: 'Noto Serif Thai (มีหัว)', css: "'Noto Serif Thai', 'Sarabun', serif" },
  kanit: { label: 'Kanit', css: "'Kanit', 'Sarabun', sans-serif" },
  system: { label: 'ฟอนต์ของเครื่อง', css: "system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif" }
};
const READING_PREF_DEFAULTS = { font: 'sarabun', lineHeight: 1.9, width: 740, paraGap: 14, pageButtons: false };
const READING_PREF_LIMITS = { lineHeight: [1.3, 2.8], width: [480, 1200], paraGap: [0, 48] };

function clampNumber(value, [min, max], fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function getReadingPrefs() {
  let raw = {};
  try {
    raw = JSON.parse(localStorage.getItem('nov_reading_prefs') || '{}') || {};
  } catch (e) {
    raw = {};
  }
  return {
    font: READING_FONTS[raw.font] ? raw.font : READING_PREF_DEFAULTS.font,
    lineHeight: clampNumber(raw.lineHeight, READING_PREF_LIMITS.lineHeight, READING_PREF_DEFAULTS.lineHeight),
    width: clampNumber(raw.width, READING_PREF_LIMITS.width, READING_PREF_DEFAULTS.width),
    paraGap: clampNumber(raw.paraGap, READING_PREF_LIMITS.paraGap, READING_PREF_DEFAULTS.paraGap),
    pageButtons: raw.pageButtons === true
  };
}

function applyReadingPrefs(prefs = getReadingPrefs()) {
  const root = document.documentElement.style;
  root.setProperty('--reader-font', READING_FONTS[prefs.font].css);
  root.setProperty('--reader-line-height', String(prefs.lineHeight));
  root.setProperty('--reader-width', `${prefs.width}px`);
  root.setProperty('--reader-para-gap', `${prefs.paraGap}px`);
  document.body.classList.toggle('page-buttons-on', prefs.pageButtons);
}

function saveReadingPrefs(patch) {
  const prefs = { ...getReadingPrefs(), ...patch };
  localStorage.setItem('nov_reading_prefs', JSON.stringify(prefs));
  applyReadingPrefs(getReadingPrefs());
  return prefs;
}

function toggleReaderPanel(force) {
  const panel = document.getElementById('reader-panel');
  const open = force !== undefined ? force : !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  if (open) renderReaderPanel();
}

function renderReaderPanel() {
  const prefs = getReadingPrefs();
  const infinite = localStorage.getItem('nov_enable_infinite') !== 'false';
  const themeBtn = (id, label) => `<button class="btn${currentTheme === id ? ' btn-primary' : ''}" onclick="setReaderTheme('${id}')">${label}</button>`;
  document.getElementById('reader-panel-body').innerHTML = `
    <div class="reader-row"><span>ธีม</span><div class="reader-seg">${themeBtn('sepia', 'ถนอมสายตา')}${themeBtn('light', 'สว่าง')}${themeBtn('dark', 'มืด')}</div></div>
    <div class="reader-row"><span>ฟอนต์</span>
      <select class="form-input" onchange="saveReadingPrefs({ font: this.value })">${Object.entries(READING_FONTS).map(([k, f]) => `<option value="${k}" ${k === prefs.font ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}</select></div>
    <div class="reader-row"><span>ขนาดตัวอักษร</span><div class="reader-seg">
      <button class="btn" onclick="adjustFontSize(-1); renderReaderPanel()">A-</button><b style="min-width: 42px; text-align: center;">${currentFontSize}px</b><button class="btn" onclick="adjustFontSize(1); renderReaderPanel()">A+</button></div></div>
    ${readerSliderHtml('ระยะบรรทัด', 'lineHeight', prefs.lineHeight, 0.1)}
    ${readerSliderHtml('ระยะห่างย่อหน้า', 'paraGap', prefs.paraGap, 2)}
    ${readerSliderHtml('ความกว้างหน้า (จอใหญ่)', 'width', prefs.width, 20)}
    <div class="reader-row"><span>การเลื่อน</span><div class="reader-seg">
      <button class="btn${infinite ? ' btn-primary' : ''}" onclick="setReadingMode(true)" title="ตอนถัดไปต่อท้ายอัตโนมัติ">ต่อเนื่อง</button>
      <button class="btn${!infinite ? ' btn-primary' : ''}" onclick="setReadingMode(false)" title="แสดงทีละตอน มีปุ่มตอนก่อน/ถัดไป">ทีละตอน</button></div></div>
    <label class="reader-row" style="cursor: pointer;"><span>ปุ่มเลื่อนทีละหน้าจอ ▲▼<br><small style="opacity: 0.65;">ใช้ปุ่มลูกศรซ้าย/ขวาบนคีย์บอร์ดได้ด้วย</small></span>
      <input type="checkbox" ${prefs.pageButtons ? 'checked' : ''} onchange="saveReadingPrefs({ pageButtons: this.checked })"></label>
    <div style="text-align: right; margin-top: 6px;"><button class="btn" style="font-size: 11px;" onclick="resetReadingPrefs()">คืนค่าเริ่มต้น</button></div>`;
}

function formatReadingPref(key, value) {
  return key === 'lineHeight' ? Number(value).toFixed(1) : `${value}px`;
}

function readerSliderHtml(label, key, value, step) {
  const [min, max] = READING_PREF_LIMITS[key];
  return `<div class="reader-row"><span>${label}</span><div class="reader-seg">
    <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" oninput="onReadingSlider(this, '${key}')">
    <b style="min-width: 48px; text-align: right;">${formatReadingPref(key, value)}</b></div></div>`;
}

function onReadingSlider(input, key) {
  if (!(key in READING_PREF_LIMITS)) return;
  input.nextElementSibling.textContent = formatReadingPref(key, input.value);
  // เปลี่ยนระยะ/ความกว้างแล้วเนื้อหาเลื่อน: ตรึงย่อหน้าที่อ่านอยู่ไว้ที่เดิม
  preserveScrollAnchor(() => saveReadingPrefs({ [key]: Number(input.value) }));
}

function setReaderTheme(theme) {
  let guard = 0;
  while (currentTheme !== theme && guard++ < 3) cycleTheme();
  renderReaderPanel();
}

function setReadingMode(infinite) {
  localStorage.setItem('nov_enable_infinite', infinite ? 'true' : 'false');
  const chk = document.getElementById('enable-infinite-scroll');
  if (chk) chk.checked = infinite;
  renderReaderPanel();
  const pos = findTopVisibleParagraph();
  renderVirtualWindow(pos ? pos.chapIdx : currentChapterIndex, false, pos ? pos.paraIdx : null);
}

function resetReadingPrefs() {
  localStorage.removeItem('nov_reading_prefs');
  applyReadingPrefs();
  renderReaderPanel();
}

// ---------- เลื่อนทีละหน้าจอ ----------
function pageScroll(direction) {
  const header = document.querySelector('header');
  const top = document.body.classList.contains('is-fullscreen') ? 0 : (header?.offsetHeight || 0);
  // เหลือบรรทัดท้ายของหน้าเดิมไว้นิดหน่อย จะได้ไม่หลงบรรทัด
  const step = Math.max(120, window.innerHeight - top - 56);
  window.scrollBy({ top: direction * step, behavior: 'smooth' });
}

function setupReaderKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable) return;
    if (document.querySelector('.modal-overlay.active')) return;
    if (!getReadingPrefs().pageButtons) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      pageScroll(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      pageScroll(-1);
    }
  });
}

// ---------- รักษาตำแหน่งอ่านเมื่อเพิ่ม/เอาตอนออกจากหน้า ----------
/** เรียก fn ที่เปลี่ยน DOM แล้วเลื่อนชดเชยให้ย่อหน้าที่อ่านอยู่อยู่ที่เดิมบนจอ (ไม่พึ่ง scroll anchoring ของเบราว์เซอร์ ซึ่ง Safari ไม่มี) */
function preserveScrollAnchor(fn) {
  const pos = typeof findTopVisibleParagraph === 'function' ? findTopVisibleParagraph() : null;
  const anchor = pos ? document.getElementById(`para-box-${pos.chapIdx}-${pos.paraIdx}`) : null;
  const before = anchor ? anchor.getBoundingClientRect().top : null;
  fn();
  if (anchor && anchor.isConnected && before !== null) {
    const diff = anchor.getBoundingClientRect().top - before;
    if (Math.abs(diff) > 1) window.scrollBy(0, diff);
  }
}

// ==================== ฟังเสียงอ่าน (TTS) ====================
const TTS_CHUNK_CHARS = 180;
const tts = { active: false, paused: false, chapId: null, paraIdx: 0, token: 0, waiting: false, wakeLock: null };

function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

function getTtsVoices() {
  return ttsSupported() ? window.speechSynthesis.getVoices() : [];
}

function getThaiVoices(voices = getTtsVoices()) {
  return voices.filter(v => /^th([-_]|$)/i.test(v.lang || ''));
}

function pickTtsVoice() {
  const voices = getTtsVoices();
  const saved = localStorage.getItem('nov_tts_voice');
  return voices.find(v => v.voiceURI === saved) || getThaiVoices(voices)[0] || null;
}

function getTtsRate() {
  return clampNumber(localStorage.getItem('nov_tts_rate'), [0.5, 2.5], 1);
}

/**
 * แบ่งข้อความเป็นช่วงสั้นๆ (เบราว์เซอร์บางตัวหยุดอ่านเองถ้าข้อความยาวเกิน ~15 วินาที)
 * ตัดที่ช่องว่าง/เครื่องหมายวรรคตอนก่อน ภาษาไทยเว้นวรรคระหว่างประโยคจึงตัดได้เป็นธรรมชาติ
 */
function splitForSpeech(text, max = TTS_CHUNK_CHARS) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const tokens = clean.split(/(?<=[\s。！？!?…,，、;；:：”"」』)])/);
  const chunks = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  for (const tok of tokens) {
    if ((cur + tok).length <= max) {
      cur += tok;
      continue;
    }
    push();
    if (tok.length <= max) cur = tok;
    else for (let i = 0; i < tok.length; i += max) chunks.push(tok.slice(i, i + max).trim());
  }
  push();
  return chunks.filter(Boolean);
}

function isSpeakableParagraph(p) {
  return !!(p && (p.th || '').trim() && (p.kind || 'story') !== 'site_junk');
}

function isReadableChapter(chap) {
  return !!(chap && chap.status !== 'pending' && chap.chapterType !== 'placeholder' && Array.isArray(chap.paragraphs));
}

function setTtsHighlight() {
  document.querySelectorAll('.para-tts-active').forEach(el => el.classList.remove('para-tts-active'));
  if (!tts.active) return null;
  const chapIdx = chapters.findIndex(c => c.id === tts.chapId);
  const el = chapIdx === -1 ? null : document.getElementById(`para-box-${chapIdx}-${tts.paraIdx}`);
  if (el) el.classList.add('para-tts-active');
  return el;
}

function isTtsParagraph(chapId, pIdx) {
  return tts.active && tts.chapId === chapId && tts.paraIdx === pIdx;
}

function renderTtsBar(status = '') {
  const bar = document.getElementById('tts-bar');
  if (!bar) return;
  bar.classList.toggle('open', tts.active);
  document.body.classList.toggle('tts-on', tts.active);
  if (!tts.active) return;
  const voices = getTtsVoices();
  const thai = getThaiVoices(voices);
  const list = thai.length ? thai : voices;
  const current = pickTtsVoice();
  const chap = chapters.find(c => c.id === tts.chapId);
  const rates = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
  document.getElementById('tts-bar-body').innerHTML = `
    <div class="tts-row">
      <button class="btn" onclick="ttsStep(-1)" title="ย่อหน้าก่อน">⏮</button>
      <button class="btn btn-primary" onclick="toggleTtsPause()" title="${tts.paused ? 'อ่านต่อ' : 'หยุดชั่วคราว'}">${tts.paused ? '▶' : '⏸'}</button>
      <button class="btn" onclick="ttsStep(1)" title="ย่อหน้าถัดไป">⏭</button>
      <select class="form-input" onchange="setTtsRate(this.value)" title="ความเร็ว">${rates.map(r => `<option value="${r}" ${r === getTtsRate() ? 'selected' : ''}>${r}x</option>`).join('')}</select>
      <button class="btn" onclick="stopTts()" title="ปิดเสียงอ่าน">✕</button>
    </div>
    <div class="tts-sub">${escapeHtml(status || (chap ? `${chap.title} · ย่อหน้า ${tts.paraIdx + 1}` : ''))}</div>
    <div class="tts-row">
      <select class="form-input" style="flex: 1; min-width: 0;" onchange="setTtsVoice(this.value)" title="เสียง">${list.length ? list.map(v => `<option value="${escapeHtml(v.voiceURI)}" ${current && v.voiceURI === current.voiceURI ? 'selected' : ''}>${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>`).join('') : '<option>เสียงเริ่มต้นของเครื่อง</option>'}</select>
    </div>
    ${thai.length ? '' : '<div class="tts-warn">⚠️ เครื่องนี้ไม่มีเสียงภาษาไทย อาจอ่านไม่ออกหรือออกเสียงผิด ติดตั้งเสียงไทยได้ที่ Windows: ตั้งค่า → เวลาและภาษา → คำพูด / Android: Google Text-to-speech → ภาษาไทย / iPhone: ตั้งค่า → การช่วยการเข้าถึง → เนื้อหาที่ถูกอ่าน</div>'}
    <div class="tts-sub" style="opacity: 0.55;">มือถือบางรุ่นหยุดอ่านเมื่อปิดจอหรือสลับแอพ</div>`;
}

async function requestTtsWakeLock() {
  try {
    if ('wakeLock' in navigator && !tts.wakeLock) {
      tts.wakeLock = await navigator.wakeLock.request('screen');
      tts.wakeLock.addEventListener('release', () => { tts.wakeLock = null; });
    }
  } catch (e) {
    tts.wakeLock = null;
  }
}

function releaseTtsWakeLock() {
  try {
    if (tts.wakeLock) tts.wakeLock.release();
  } catch (e) {}
  tts.wakeLock = null;
}

/** เริ่มอ่านจากย่อหน้าที่ระบุ หรือจากย่อหน้าบนสุดที่เห็นบนจอ */
function startTts(chapIdx = null, paraIdx = null) {
  if (!ttsSupported()) return alert('เบราว์เซอร์นี้ไม่รองรับการอ่านออกเสียง ลองใช้ Chrome, Edge หรือ Safari รุ่นใหม่');
  let pos = chapIdx !== null ? { chapIdx, paraIdx: paraIdx || 0 } : findTopVisibleParagraph();
  if (!pos || !chapters[pos.chapIdx]) pos = { chapIdx: currentChapterIndex, paraIdx: 0 };
  tts.active = true;
  tts.paused = false;
  requestTtsWakeLock();
  speakParagraph(chapters[pos.chapIdx].id, pos.paraIdx);
}

function toggleTts() {
  if (tts.active) stopTts();
  else startTts();
}

function readFromParagraph(e, chapIdx, pIdx) {
  if (e) e.stopPropagation();
  startTts(chapIdx, pIdx);
}

function stopTts() {
  tts.token++;
  tts.active = false;
  tts.paused = false;
  tts.waiting = false;
  if (ttsSupported()) window.speechSynthesis.cancel();
  releaseTtsWakeLock();
  setTtsHighlight();
  renderTtsBar();
}

// หยุดชั่วคราวด้วยการยกเลิกแล้วเริ่มย่อหน้าเดิมใหม่ (pause()/resume() ของ Android ใช้ไม่ได้จริง)
function toggleTtsPause() {
  if (!tts.active) return;
  if (tts.paused) {
    tts.paused = false;
    requestTtsWakeLock();
    speakParagraph(tts.chapId, tts.paraIdx);
  } else {
    tts.paused = true;
    tts.token++;
    window.speechSynthesis.cancel();
    releaseTtsWakeLock();
    renderTtsBar();
  }
}

function ttsStep(delta) {
  if (!tts.active) return;
  const chap = chapters.find(c => c.id === tts.chapId);
  if (!chap) return;
  let i = tts.paraIdx + delta;
  while (i >= 0 && i < chap.paragraphs.length && !isSpeakableParagraph(chap.paragraphs[i])) i += delta;
  tts.paused = false;
  speakParagraph(tts.chapId, Math.max(0, i));
}

function setTtsRate(value) {
  localStorage.setItem('nov_tts_rate', String(clampNumber(value, [0.5, 2.5], 1)));
  if (tts.active && !tts.paused) speakParagraph(tts.chapId, tts.paraIdx);
}

function setTtsVoice(uri) {
  localStorage.setItem('nov_tts_voice', uri);
  if (tts.active && !tts.paused) speakParagraph(tts.chapId, tts.paraIdx);
}

async function speakParagraph(chapId, paraIdx) {
  const token = ++tts.token;
  window.speechSynthesis.cancel();
  const chapIdx = chapters.findIndex(c => c.id === chapId);
  const chap = chapters[chapIdx];
  if (!chap) return stopTts();
  if (!isReadableChapter(chap)) return ttsFinishChapter(chapIdx, token);
  let i = Math.max(0, paraIdx);
  while (i < chap.paragraphs.length && !isSpeakableParagraph(chap.paragraphs[i])) i++;
  if (i >= chap.paragraphs.length) return ttsFinishChapter(chapIdx, token);

  tts.chapId = chapId;
  tts.paraIdx = i;
  tts.waiting = false;
  // ย่อหน้าที่จะอ่านยังไม่อยู่บนหน้า (เช่นอยู่คนละตอน): แสดงตอนนั้นก่อน
  if (!document.getElementById(`para-box-${chapIdx}-${i}`)) {
    await renderVirtualWindow(chapIdx, false, i);
    if (token !== tts.token) return;
  }
  const el = setTtsHighlight();
  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.top < 60 || rect.bottom > window.innerHeight - 140) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  renderTtsBar();
  const chunks = splitForSpeech(chap.paragraphs[i].th);
  speakChunks(chunks, 0, token, () => speakParagraph(chapId, i + 1));
}

function speakChunks(chunks, k, token, onDone) {
  if (token !== tts.token) return;
  if (k >= chunks.length) return onDone();
  const u = new SpeechSynthesisUtterance(chunks[k]);
  u.lang = 'th-TH';
  const voice = pickTtsVoice();
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  u.rate = getTtsRate();
  u.onend = () => speakChunks(chunks, k + 1, token, onDone);
  u.onerror = (ev) => {
    if (token !== tts.token || ev.error === 'interrupted' || ev.error === 'canceled') return;
    renderTtsBar(`อ่านไม่สำเร็จ (${ev.error || 'ไม่ทราบสาเหตุ'}) ข้ามไปย่อหน้าถัดไป`);
    speakChunks(chunks, chunks.length, token, onDone);
  };
  window.speechSynthesis.speak(u);
}

/** จบตอน: อ่านตอนถัดไปต่อ ถ้ายังไม่มี/ยังไม่แปล ให้รอการแปลล่วงหน้า หรือหยุด */
async function ttsFinishChapter(chapIdx, token) {
  if (token !== tts.token) return;
  const next = chapters[chapIdx + 1];
  if (next && isReadableChapter(next)) return speakParagraph(next.id, 0);
  if (next && !isReadableChapter(next)) {
    stopTts();
    showGlobalToast(next.status === 'pending' ? 'หยุดอ่าน: ตอนถัดไปยังไม่ได้แปล' : 'หยุดอ่าน: ตอนถัดไปเป็นตอนกันก๊อป/ตอนที่ต้องซื้อ');
    setTimeout(hideGlobalToast, 2500);
    return;
  }
  // ตอนสุดท้ายในเครื่อง: รอแปลตอนถัดไป (ถ้ามีลิงก์และเปิดแปลล่วงหน้าไว้)
  const last = chapters[chapters.length - 1];
  if (last?.nextUrl && localStorage.getItem('nov_enable_prefetch') !== 'false') {
    tts.waiting = true;
    renderTtsBar('⏳ กำลังรอแปลตอนถัดไป...');
    const before = chapters.length;
    if (!isPrefetching) triggerReadingPrefetchIfEnabled(true);
    const started = Date.now();
    while (Date.now() - started < 180000) {
      await new Promise(r => setTimeout(r, 1500));
      if (token !== tts.token) return;
      if (chapters.length > before) return speakParagraph(chapters[chapIdx + 1].id, 0);
      if (!isPrefetching && lastPrefetchError) break;
    }
  }
  stopTts();
  showGlobalToast('อ่านจบตอนล่าสุดแล้ว');
  setTimeout(hideGlobalToast, 2500);
}

function setupTts() {
  if (!ttsSupported()) return;
  window.speechSynthesis.onvoiceschanged = () => { if (tts.active) renderTtsBar(); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && tts.active && !tts.paused) requestTtsWakeLock();
  });
}

// ==================== ค้นหา ====================
/**
 * ทำข้อความให้ค้นง่าย: ตัวเล็ก, ไม่สนช่องว่าง/อักขระล่องหน, รวม "ํ+า" เป็น "ำ"
 * (ภาษาไทยไม่เว้นวรรคระหว่างคำ และคำแปลอาจเว้นวรรคไม่ตรงกับที่ผู้ใช้พิมพ์)
 * map[i] = ตำแหน่งในข้อความเดิม ใช้ตัดข้อความตัวอย่างรอบคำที่เจอ
 */
function normalizeForSearch(value) {
  const original = String(value || '').normalize('NFC');
  const out = [];
  const map = [];
  const mapEnd = [];
  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    if (/[\s​-‍﻿]/.test(ch)) continue;
    if (ch === 'ํ' && original[i + 1] === 'า') {
      out.push('ำ');
      map.push(i);
      mapEnd.push(i + 2);
      i++;
      continue;
    }
    out.push(ch.toLowerCase()[0] || ch);
    map.push(i);
    mapEnd.push(i + 1);
  }
  return { text: out.join(''), map, mapEnd, original };
}

/** ตำแหน่งที่เจอคำค้นในข้อความ (ในข้อความเดิม) สูงสุด max ที่ */
function findSearchMatches(value, query, max = 5) {
  const q = normalizeForSearch(query).text;
  if (!q) return [];
  const norm = normalizeForSearch(value);
  const out = [];
  let from = 0;
  while (out.length < max) {
    const idx = norm.text.indexOf(q, from);
    if (idx === -1) break;
    out.push({ start: norm.map[idx], end: norm.mapEnd[idx + q.length - 1] });
    from = idx + q.length;
  }
  return out;
}

function searchSnippetHtml(original, match, radius = 40) {
  const text = String(original || '');
  const from = Math.max(0, match.start - radius);
  const to = Math.min(text.length, match.end + radius);
  return `${from > 0 ? '…' : ''}${escapeHtml(text.slice(from, match.start))}<mark>${escapeHtml(text.slice(match.start, match.end))}</mark>${escapeHtml(text.slice(match.end, to))}${to < text.length ? '…' : ''}`;
}

const SEARCH_MAX_RESULTS = 300;
let searchRunToken = 0;

/**
 * ค้นในตอนที่บันทึกไว้ field: 'th' | 'src' | 'both', scope: 'book' | 'all'
 * คืนผลทีละเรื่องผ่าน onProgress (ค้นทุกเรื่องอาจใช้เวลา จึงพักให้หน้าจอตอบสนองเป็นช่วงๆ)
 */
async function searchChapters(query, { bookId = null, scope = 'book', field = 'th', onProgress = null } = {}) {
  const token = ++searchRunToken;
  const results = [];
  const books = await dbGetAllBooks();
  const targets = scope === 'all' ? books : books.filter(b => b.bookId === bookId);
  let truncated = false;
  for (const book of targets) {
    const chaps = (await dbGetChaptersByBook(book.bookId)).sort((a, b) => (a.order || 0) - (b.order || 0));
    const labels = computeChapterNumbers(chaps);
    for (let ci = 0; ci < chaps.length; ci++) {
      const chap = chaps[ci];
      if (ci % 40 === 39) {
        await new Promise(r => setTimeout(r, 0));
        if (token !== searchRunToken) return null;
      }
      if (!Array.isArray(chap.paragraphs)) continue;
      chap.paragraphs.forEach((p, pi) => {
        if (truncated || (p.kind || 'story') === 'site_junk') return;
        const fields = field === 'both' ? ['th', 'src'] : [field];
        for (const f of fields) {
          const matches = findSearchMatches(p[f], query, 1);
          if (!matches.length) continue;
          results.push({ bookId: book.bookId, bookTitle: book.title || book.bookId, chapId: chap.id, chapTitle: chap.title || '', label: labels.get(chap.id), paraIdx: pi, field: f, snippet: searchSnippetHtml(p[f], matches[0]) });
          if (results.length >= SEARCH_MAX_RESULTS) truncated = true;
          break;
        }
      });
      if (truncated) break;
    }
    if (onProgress) onProgress(results, truncated);
    if (truncated) break;
  }
  return token === searchRunToken ? { results, truncated } : null;
}

// ==================== บุ๊กมาร์กและโน้ต (เก็บใน bookData.bookmarks ซึ่งอยู่ในไฟล์สำรอง) ====================
const MAX_BOOKMARKS_PER_BOOK = 1000;
const BOOKMARK_EXCERPT = 60;
let bookmarkCache = { bookId: null, list: [] };

async function loadBookmarks(bookId) {
  if (!bookId || bookId === 'default_novel') return [];
  const extras = await getBookExtras(bookId);
  return Array.isArray(extras.bookmarks) ? extras.bookmarks : [];
}

/** อ่านใหม่จากฐานข้อมูลก่อนแก้ทุกครั้ง (อีกแท็บอาจเพิ่มไว้) */
async function updateBookmarks(bookId, mutate) {
  const extras = await getBookExtras(bookId);
  const list = Array.isArray(extras.bookmarks) ? extras.bookmarks : [];
  const next = mutate(list) || list;
  extras.bookmarks = next.slice(-MAX_BOOKMARKS_PER_BOOK);
  await dbSaveBookData(extras);
  if (bookmarkCache.bookId === bookId) bookmarkCache.list = extras.bookmarks;
  return extras.bookmarks;
}

async function refreshBookmarkCache(bookId = currentBookId) {
  try {
    bookmarkCache = { bookId, list: await loadBookmarks(bookId) };
  } catch (e) {
    bookmarkCache = { bookId, list: [] };
  }
}

/** บุ๊กมาร์กของย่อหน้านี้ (ใช้ตำแหน่งที่ตรวจจากข้อความแล้ว เผื่อย่อหน้าเลื่อนหลังแปลใหม่) */
function findBookmark(chapId, pIdx) {
  if (bookmarkCache.bookId !== currentBookId || !bookmarkCache.list.length) return null;
  const chap = chapters.find(c => c.id === chapId);
  return bookmarkCache.list.find(b => b.chapId === chapId && (chap ? resolveBookmarkParagraph(chap, b) : b.paraIdx) === pIdx) || null;
}

/**
 * ย่อหน้าของบุ๊กมาร์กในตอนปัจจุบัน: เลขย่อหน้าอาจเลื่อนหลังแปลใหม่ จึงตรวจข้อความต้นฉบับช่วงต้นที่จำไว้
 * ถ้าไม่ตรงให้หาย่อหน้าที่ขึ้นต้นเหมือนกัน ไม่เจอใช้เลขเดิม (ไม่เกินจำนวนย่อหน้า)
 */
function resolveBookmarkParagraph(chap, bm) {
  const paras = chap?.paragraphs || [];
  if (!paras.length) return 0;
  const starts = (p) => (bm.srcStart && (p?.src || '').startsWith(bm.srcStart)) || (!bm.srcStart && bm.thStart && (p?.th || '').startsWith(bm.thStart));
  if (starts(paras[bm.paraIdx])) return bm.paraIdx;
  if (bm.srcStart || bm.thStart) {
    const found = paras.findIndex(starts);
    if (found !== -1) return found;
  }
  return Math.min(Math.max(0, bm.paraIdx || 0), paras.length - 1);
}

let bookmarkBeingEdited = null;

function openBookmarkEditor(e, chapIdx, pIdx) {
  if (e) e.stopPropagation();
  const chap = chapters[chapIdx];
  const p = chap?.paragraphs?.[pIdx];
  if (!p || currentBookId === 'default_novel') return alert('เปิดนิยายจากชั้นหนังสือก่อน จึงจะบุ๊กมาร์กได้');
  const existing = findBookmark(chap.id, pIdx);
  bookmarkBeingEdited = { bookId: currentBookId, chapId: chap.id, paraIdx: pIdx, id: existing?.id || null };
  document.getElementById('bookmark-excerpt').textContent = (p.th || p.src || '').slice(0, 200);
  document.getElementById('bookmark-note').value = existing?.note || '';
  document.getElementById('bookmark-delete-btn').style.display = existing ? 'inline-flex' : 'none';
  document.getElementById('bookmark-modal-title').textContent = existing ? 'แก้บุ๊กมาร์ก / โน้ต' : 'เพิ่มบุ๊กมาร์ก';
  openModal('bookmark-modal');
  setTimeout(() => document.getElementById('bookmark-note').focus(), 120);
}

async function openBookmarkEditorById(bookId, id) {
  const bm = (await loadBookmarks(bookId)).find(b => b.id === id);
  if (!bm) return;
  bookmarkBeingEdited = { bookId, chapId: bm.chapId, paraIdx: bm.paraIdx, id };
  document.getElementById('bookmark-excerpt').textContent = bm.excerpt || '';
  document.getElementById('bookmark-note').value = bm.note || '';
  document.getElementById('bookmark-delete-btn').style.display = 'inline-flex';
  document.getElementById('bookmark-modal-title').textContent = 'แก้บุ๊กมาร์ก / โน้ต';
  openModal('bookmark-modal');
}

async function saveBookmarkFromEditor() {
  const edit = bookmarkBeingEdited;
  if (!edit) return;
  const note = document.getElementById('bookmark-note').value.trim().slice(0, 2000);
  const chap = chapters.find(c => c.id === edit.chapId) || (await dbGetChaptersByBook(edit.bookId)).find(c => c.id === edit.chapId);
  const p = chap?.paragraphs?.[edit.paraIdx] || {};
  await updateBookmarks(edit.bookId, (list) => {
    // หาด้วย id เท่านั้น: บุ๊กมาร์กเก่าที่เลขย่อหน้าเลื่อนไปแล้วอาจมีเลขเดียวกับย่อหน้านี้ แต่เป็นคนละย่อหน้า
    const existing = edit.id ? list.find(b => b.id === edit.id) : null;
    if (existing) {
      existing.note = note;
      existing.updatedAt = Date.now();
      return list;
    }
    list.push({
      id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      chapId: edit.chapId,
      paraIdx: edit.paraIdx,
      chapTitle: chap?.title || '',
      excerpt: (p.th || p.src || '').slice(0, 200),
      srcStart: (p.src || '').slice(0, BOOKMARK_EXCERPT),
      thStart: (p.th || '').slice(0, BOOKMARK_EXCERPT),
      note,
      at: Date.now()
    });
    return list;
  });
  closeModal('bookmark-modal');
  bookmarkBeingEdited = null;
  refreshBookmarkMarkers();
  if (document.getElementById('reader-tools-modal')?.classList.contains('active')) renderBookmarkList();
  showGlobalToast(note ? '🔖 บันทึกโน้ตแล้ว' : '🔖 บุ๊กมาร์กแล้ว');
  setTimeout(hideGlobalToast, 1200);
}

async function deleteBookmarkFromEditor() {
  const edit = bookmarkBeingEdited;
  if (!edit || !confirm('ลบบุ๊กมาร์กนี้?')) return;
  await updateBookmarks(edit.bookId, (list) => list.filter(b => b.id !== edit.id));
  closeModal('bookmark-modal');
  bookmarkBeingEdited = null;
  refreshBookmarkMarkers();
  if (document.getElementById('reader-tools-modal')?.classList.contains('active')) renderBookmarkList();
}

async function deleteBookmarkById(bookId, id) {
  if (!confirm('ลบบุ๊กมาร์กนี้?')) return;
  await updateBookmarks(bookId, (list) => list.filter(b => b.id !== id));
  refreshBookmarkMarkers();
  renderBookmarkList();
}

/** อัปเดตเครื่องหมาย 🔖 บนย่อหน้าที่แสดงอยู่ โดยไม่ต้องสร้างหน้าใหม่ */
function refreshBookmarkMarkers() {
  document.querySelectorAll('#reading-content .chapter-block').forEach(block => {
    const chapIdx = parseInt(block.getAttribute('data-index'), 10);
    const chap = chapters[chapIdx];
    if (!chap) return;
    block.querySelectorAll('.para-item').forEach(el => {
      const m = el.id.match(/^para-box-(\d+)-(\d+)$/);
      if (!m) return;
      const pIdx = parseInt(m[2], 10);
      const bm = findBookmark(chap.id, pIdx);
      el.classList.toggle('para-bookmarked', !!bm);
      const old = el.querySelector(':scope > .para-bookmark-mark');
      if (old) old.remove();
      if (bm) el.insertAdjacentHTML('afterbegin', bookmarkMarkHtml(bm, chapIdx, pIdx));
    });
  });
}

function bookmarkMarkHtml(bm, chapIdx, pIdx) {
  return `<button class="para-bookmark-mark" onclick="openBookmarkEditor(event, ${chapIdx}, ${pIdx})" title="${escapeHtml(bm.note ? `โน้ต: ${bm.note}` : 'บุ๊กมาร์ก (แตะเพื่อแก้/เพิ่มโน้ต)')}">${bm.note ? '📝' : '🔖'}</button>`;
}

// ==================== หน้าต่างค้นหา / บุ๊กมาร์ก ====================
let readerToolsTab = 'search';

async function openReaderTools(tab = 'search') {
  readerToolsTab = tab;
  openModal('reader-tools-modal');
  switchReaderToolsTab(tab);
}

function switchReaderToolsTab(tab) {
  readerToolsTab = tab;
  document.querySelectorAll('#reader-tools-modal .reader-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.getElementById('reader-search-panel').style.display = tab === 'search' ? 'block' : 'none';
  document.getElementById('reader-bookmark-panel').style.display = tab === 'bookmarks' ? 'block' : 'none';
  if (tab === 'search') setTimeout(() => document.getElementById('reader-search-input')?.focus(), 100);
  else renderBookmarkList();
}

async function runReaderSearch() {
  const query = document.getElementById('reader-search-input').value;
  const scope = document.getElementById('reader-search-scope').value;
  const field = document.getElementById('reader-search-field').value;
  const box = document.getElementById('reader-search-results');
  if (normalizeForSearch(query).text.length < 1) {
    box.innerHTML = '<div class="reader-empty">พิมพ์คำที่ต้องการค้นหา</div>';
    return;
  }
  if (scope === 'book' && currentBookId === 'default_novel') {
    box.innerHTML = '<div class="reader-empty">ยังไม่ได้เปิดนิยาย เลือก "ทุกเรื่อง" หรือเปิดเรื่องจากชั้นหนังสือก่อน</div>';
    return;
  }
  box.innerHTML = '<div class="reader-empty"><span class="spinner-icon"></span> กำลังค้นหา...</div>';
  const render = (results, truncated, done) => {
    if (!results.length) {
      box.innerHTML = done ? '<div class="reader-empty">ไม่พบข้อความนี้</div>' : '<div class="reader-empty"><span class="spinner-icon"></span> กำลังค้นหา...</div>';
      return;
    }
    let lastBook = '';
    const rows = results.map(r => {
      const head = scope === 'all' && r.bookId !== lastBook ? `<div class="reader-result-book">${escapeHtml(r.bookTitle)}</div>` : '';
      lastBook = r.bookId;
      return `${head}<button class="reader-result" onclick="jumpToParagraph(${jsArg(r.bookId)}, ${jsArg(r.chapId)}, ${Number(r.paraIdx)}, true)">
        <div class="reader-result-meta">#${escapeHtml(r.label)} ${escapeHtml(r.chapTitle)} · ย่อหน้า ${r.paraIdx + 1}${r.field === 'src' ? ' · ต้นฉบับ' : ''}</div>
        <div class="reader-result-text">${r.snippet}</div></button>`;
    }).join('');
    box.innerHTML = `<div class="reader-result-count">พบ ${results.length}${truncated ? '+' : ''} ย่อหน้า${truncated ? ` (แสดง ${SEARCH_MAX_RESULTS} แรก ลองใช้คำที่เจาะจงขึ้น)` : ''}${done ? '' : ' · กำลังค้นต่อ...'}</div>${rows}`;
  };
  const res = await searchChapters(query, { bookId: currentBookId, scope, field, onProgress: (r, t) => render(r, t, false) });
  if (res) render(res.results, res.truncated, true);
}

function onReaderSearchKey(e) {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    runReaderSearch();
  }
}

async function renderBookmarkList() {
  const box = document.getElementById('reader-bookmark-list');
  if (!box) return;
  if (currentBookId === 'default_novel') {
    box.innerHTML = '<div class="reader-empty">เปิดนิยายจากชั้นหนังสือก่อน</div>';
    return;
  }
  const bookId = currentBookId;
  const [list, chaps] = await Promise.all([loadBookmarks(bookId), dbGetChaptersByBook(bookId)]);
  chaps.sort((a, b) => (a.order || 0) - (b.order || 0));
  const labels = computeChapterNumbers(chaps);
  const orderOf = new Map(chaps.map(c => [c.id, c.order || 0]));
  const sorted = list.slice().sort((a, b) => (orderOf.get(a.chapId) ?? Infinity) - (orderOf.get(b.chapId) ?? Infinity) || a.paraIdx - b.paraIdx);
  if (!sorted.length) {
    box.innerHTML = '<div class="reader-empty">ยังไม่มีบุ๊กมาร์ก<br><small>แตะย่อหน้าในหน้าอ่าน แล้วกด "🔖 บุ๊กมาร์ก/โน้ต"</small></div>';
    return;
  }
  box.innerHTML = `<div class="reader-result-count">${sorted.length} รายการในเรื่องนี้</div>` + sorted.map(b => {
    const exists = orderOf.has(b.chapId);
    return `<div class="reader-bookmark">
      <div class="reader-result-meta">${exists ? `#${escapeHtml(labels.get(b.chapId))} ` : ''}${escapeHtml(b.chapTitle || '')}${exists ? '' : ' <span style="color:#dc2626;">(ตอนนี้ถูกลบแล้ว)</span>'} · ${escapeHtml(new Date(b.updatedAt || b.at).toLocaleDateString('th-TH'))}</div>
      <div class="reader-result-text">${escapeHtml(b.excerpt || '')}</div>
      ${b.note ? `<div class="reader-bookmark-note">📝 ${escapeHtml(b.note)}</div>` : ''}
      <div style="display: flex; gap: 6px; margin-top: 4px;">
        ${exists ? `<button class="btn btn-primary" style="padding: 2px 8px; font-size: 11px;" onclick="jumpToBookmark(${jsArg(bookId)}, ${jsArg(b.id)})">ไปที่ย่อหน้านี้</button>` : ''}
        <button class="btn" style="padding: 2px 8px; font-size: 11px;" onclick="openBookmarkEditorById(${jsArg(bookId)}, ${jsArg(b.id)})">แก้โน้ต</button>
        <button class="btn btn-danger" style="padding: 2px 8px; font-size: 11px;" onclick="deleteBookmarkById(${jsArg(bookId)}, ${jsArg(b.id)})">ลบ</button>
      </div></div>`;
  }).join('');
}

async function jumpToBookmark(bookId, id) {
  const bm = (await loadBookmarks(bookId)).find(b => b.id === id);
  if (!bm) return;
  const chap = (await dbGetChaptersByBook(bookId)).find(c => c.id === bm.chapId);
  if (!chap) return alert('ตอนนี้ถูกลบไปแล้ว');
  await jumpToParagraph(bookId, bm.chapId, resolveBookmarkParagraph(chap, bm), true);
}

/** ไปที่ย่อหน้าที่ระบุ (เปิดเรื่องนั้นถ้ายังไม่ได้เปิด) แล้วกะพริบให้เห็น */
async function jumpToParagraph(bookId, chapId, paraIdx, closeTools = false) {
  if (closeTools) closeModal('reader-tools-modal');
  if (currentBookId !== bookId || !chapters.some(c => c.id === chapId)) {
    await loadBookFromDB(bookId, chapId, { paraIdx });
  } else {
    const idx = chapters.findIndex(c => c.id === chapId);
    if (!document.getElementById(`para-box-${idx}-${paraIdx}`)) await renderVirtualWindow(idx, true, paraIdx);
    else currentChapterIndex = idx;
  }
  const idx = chapters.findIndex(c => c.id === chapId);
  // ต้นตอน (ย่อหน้า 0) renderVirtualWindow เลื่อนไปหัวตอนให้แล้ว ย่อหน้าอื่นเลื่อนไปที่ย่อหน้า
  if (paraIdx > 0 || document.getElementById(`para-box-${idx}-${paraIdx}`)) scrollToParagraph(idx, paraIdx);
  const el = document.getElementById(`para-box-${idx}-${paraIdx}`);
  if (el) {
    el.classList.remove('para-flash');
    void el.offsetWidth;
    el.classList.add('para-flash');
    setTimeout(() => el.classList.remove('para-flash'), 2200);
  }
}

function setupReader() {
  applyReadingPrefs();
  setupReaderKeys();
  setupTts();
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('reader-panel');
    // ใช้ composedPath: ปุ่มในแผงถูกสร้างใหม่ตอนกด (renderReaderPanel) e.target จึงหลุดจากแผงไปแล้ว
    const path = e.composedPath();
    if (panel?.classList.contains('open') && !path.includes(panel) && !path.some(n => n.hasAttribute?.('data-reader-panel-toggle'))) toggleReaderPanel(false);
  });
}
