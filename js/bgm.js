// ==================== BACKGROUND MUSIC (เพลงประกอบตามอารมณ์ของฉาก) ====================
// เล่นเพลงเบาๆ ใต้เสียงอ่าน เปลี่ยนเพลงตามอารมณ์ของช่วงที่กำลังอ่าน (ค่อยๆ เฟดข้าม)
// ไฟล์: audio/bgm/<แนวเรื่อง>/<อารมณ์>.mp3 (+ <อารมณ์>_2.mp3, _3 ถ้ามีหลายเพลง) รายการและพรอมต์อยู่ใน docs/bgm-prompts.md
// อารมณ์มาจาก chapter.storyLog.moods (AI ติดป้ายตอนทำบันทึกเหตุการณ์) ถ้าไม่มี เดาจากคำในเนื้อเรื่อง

const BGM_BASE = 'audio/bgm';
const BGM_GENRE_FOLDERS = ['xianxia', 'wuxia', 'western_fantasy', 'system_game', 'scifi', 'horror', 'historical', 'urban_life', 'modern_romance', 'light_novel', 'kr_fantasy', 'mystery', 'apocalypse'];
// ไม่มีไฟล์ของอารมณ์นี้: ใช้อารมณ์ใกล้เคียงในแนวเดียวกันก่อน แล้วค่อยใช้ชุด general
const BGM_MOOD_FALLBACK = { dread: 'tense', battle: 'tense', epic: 'battle', mystery: 'tense', comedy: 'calm', warm: 'calm', sad: 'calm', tense: 'calm', calm: null };
const BGM_MAX_VARIANTS = 3;
const BGM_FADE_SEC = 3;
const BGM_MIN_SWITCH_MS = 20000;   // เปลี่ยนเพลงได้ไม่ถี่กว่านี้ (กันเพลงสลับไปมา)
const BGM_MIN_SEGMENT_PARAS = 3;   // ช่วงอารมณ์ที่สั้นกว่านี้ ไม่เปลี่ยนเพลง

// ---------- ตั้งค่า ----------
function isBgmEnabled() {
  return localStorage.getItem('nov_bgm_enabled') !== 'false';
}

function isBgmSilentReading() {
  return localStorage.getItem('nov_bgm_silent') === 'true';
}

function getBgmVolume() {
  const n = Number(localStorage.getItem('nov_bgm_volume'));
  return Number.isFinite(n) && localStorage.getItem('nov_bgm_volume') !== null ? Math.min(1, Math.max(0, n)) : 0.3;
}

function bgmGenreFolder(genre) {
  return BGM_GENRE_FOLDERS.includes(genre) ? genre : 'general';
}

/** อารมณ์ที่ลองตามลำดับ เช่น dread -> tense -> calm */
function bgmMoodChain(mood) {
  const chain = [];
  let m = STORY_MOODS.includes(mood) ? mood : 'calm';
  while (m && !chain.includes(m)) {
    chain.push(m);
    m = BGM_MOOD_FALLBACK[m];
  }
  return chain;
}

/** ลำดับไฟล์ที่ลองหา: [โฟลเดอร์, อารมณ์] ของแนวเรื่องก่อน แล้วชุด general */
function bgmCandidates(genre, mood) {
  const folder = bgmGenreFolder(genre);
  const chain = bgmMoodChain(mood);
  const out = [];
  if (folder !== 'general') chain.forEach(m => out.push([folder, m]));
  chain.forEach(m => out.push(['general', m]));
  return out;
}

function bgmTrackUrl(folder, mood, variant = 1) {
  return `${BGM_BASE}/${folder}/${mood}${variant > 1 ? `_${variant}` : ''}.mp3`;
}

// ---------- หาไฟล์ (เว็บแบบ static ดูรายชื่อไฟล์ในโฟลเดอร์ไม่ได้ จึงถามทีละชื่อ แล้วจำผลไว้) ----------
const bgmExistsCache = new Map();

async function bgmFileExists(url) {
  if (bgmExistsCache.has(url)) return bgmExistsCache.get(url);
  const check = fetch(url, { method: 'HEAD', cache: 'no-cache' })
    .then(res => res.ok && !/text\/html/i.test(res.headers.get('content-type') || ''))
    .catch(() => false);
  bgmExistsCache.set(url, check);
  return check;
}

async function bgmVariants(folder, mood) {
  if (!(await bgmFileExists(bgmTrackUrl(folder, mood)))) return [];
  const urls = [bgmTrackUrl(folder, mood)];
  for (let v = 2; v <= BGM_MAX_VARIANTS; v++) {
    if (await bgmFileExists(bgmTrackUrl(folder, mood, v))) urls.push(bgmTrackUrl(folder, mood, v));
    else break;
  }
  return urls;
}

/** ไฟล์ที่จะเล่นสำหรับอารมณ์นี้ (สุ่มเพลงอื่นที่ไม่ใช่ avoidUrl ถ้ามีหลายเพลง) */
async function resolveBgmTrack(genre, mood, avoidUrl = null) {
  for (const [folder, m] of bgmCandidates(genre, mood)) {
    const urls = await bgmVariants(folder, m);
    if (!urls.length) continue;
    const pool = urls.length > 1 ? urls.filter(u => u !== avoidUrl) : urls;
    return { url: pool[Math.floor(Math.random() * pool.length)], folder, mood: m, wanted: mood };
  }
  return null;
}

/** มีไฟล์กี่อารมณ์ในแนวนี้และชุด general (แสดงในหน้าตั้งค่า) */
async function scanBgmAvailability(genre) {
  const folder = bgmGenreFolder(genre);
  const check = async (f) => (await Promise.all(STORY_MOODS.map(m => bgmFileExists(bgmTrackUrl(f, m))))).filter(Boolean).length;
  return { folder, genreCount: folder === 'general' ? null : await check(folder), generalCount: await check('general') };
}

// ---------- อารมณ์ของแต่ละช่วง ----------
// ใช้เมื่อไม่มีป้ายจาก AI (ตอนที่แปลก่อนมีระบบนี้ / ปิดบันทึกเหตุการณ์) เดาจากคำในคำแปล ค่าที่ได้เป็นการประมาณ
const BGM_MOOD_KEYWORDS = {
  battle: ['ต่อสู้', 'โจมตี', 'ปะทะ', 'ฟาดฟัน', 'ฟันลง', 'หมัด', 'ระเบิด', 'พุ่งเข้า', 'สังหาร', 'เข่นฆ่า', 'ศัตรู', 'หลบ', 'กระบวนท่า', 'บาดแผล', 'โลหิต', 'เลือดสาด'],
  tense: ['อันตราย', 'ระวัง', 'ตึงเครียด', 'กดดัน', 'หวาดระแวง', 'ไม่ชอบมาพากล', 'จ้องเขม็ง', 'เจตนาฆ่า', 'ข่มขู่', 'ภัยคุกคาม', 'ใจหาย', 'กลืนน้ำลาย'],
  sad: ['ร้องไห้', 'น้ำตา', 'เศร้า', 'เสียใจ', 'สูญเสีย', 'โศก', 'อาลัย', 'ตายจาก', 'จากไป', 'สะอื้น', 'ปวดใจ'],
  warm: ['อบอุ่น', 'อ่อนโยน', 'ห่วงใย', 'โอบกอด', 'กอด', 'จูบ', 'รักใคร่', 'ครอบครัว', 'ยิ้มอ่อน', 'อ้อมแขน', 'หัวใจเต้น'],
  mystery: ['ลึกลับ', 'ปริศนา', 'ประหลาด', 'ความลับ', 'ซากปรักหักพัง', 'โบราณ', 'ค้นพบ', 'ร่องรอย', 'เบาะแส', 'อักขระ', 'ถ้ำ'],
  epic: ['ทะลวง', 'ฝ่าด่าน', 'ชัยชนะ', 'ยิ่งใหญ่', 'ตื่นรู้', 'สะเทือนฟ้า', 'พลังมหาศาล', 'เลื่อนขั้น', 'เลเวลอัป', 'บรรลุ', 'กึกก้อง'],
  comedy: ['หัวเราะ', 'ขำ', 'ตลก', 'ฮ่าฮ่า', 'แซว', 'ล้อเล่น', 'กลอกตา', 'หน้ามืดตามัว', 'หน้าแตก'],
  dread: ['สยอง', 'ขนลุก', 'ผี', 'ศพ', 'น่าขนลุก', 'หลอน', 'กรีดร้อง', 'อสุรกาย', 'ซอมบี้', 'เน่าเปื่อย', 'วิญญาณร้าย']
};

function scoreParagraphMoods(text) {
  const t = String(text || '');
  const scores = {};
  Object.entries(BGM_MOOD_KEYWORDS).forEach(([mood, words]) => {
    scores[mood] = words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  });
  return scores;
}

/** รวมช่วงที่สั้นเกินไปเข้ากับช่วงก่อนหน้า (เพลงจะได้ไม่สลับถี่) */
function mergeShortMoodSegments(segments, paragraphCount, minParas = BGM_MIN_SEGMENT_PARAS) {
  const out = [];
  segments.forEach((s, i) => {
    const end = i + 1 < segments.length ? segments[i + 1].from : paragraphCount;
    const long = end - s.from >= minParas;
    const last = out[out.length - 1];
    if (!last) out.push({ ...s, from: 0 });
    else if (!long || last.mood === s.mood) return;
    else out.push({ ...s });
  });
  return out;
}

/** เดาอารมณ์จากคำ: ให้คะแนนรายย่อหน้า เฉลี่ยกับย่อหน้ารอบข้าง (±2) แล้วรวมเป็นช่วง */
function estimateChapterMoods(chap) {
  const paras = chap?.paragraphs || [];
  if (!paras.length) return [];
  const per = paras.map(p => ((p.kind || 'story') === 'site_junk' ? {} : scoreParagraphMoods(p.th)));
  const moods = paras.map((_, i) => {
    const total = {};
    for (let j = Math.max(0, i - 2); j <= Math.min(paras.length - 1, i + 2); j++) {
      Object.entries(per[j]).forEach(([m, n]) => { total[m] = (total[m] || 0) + n; });
    }
    const [best, score] = Object.entries(total).sort((a, b) => b[1] - a[1])[0] || ['calm', 0];
    return score >= 2 ? best : 'calm';
  });
  const segments = [];
  moods.forEach((m, i) => {
    if (!segments.length || segments[segments.length - 1].mood !== m) segments.push({ from: i, mood: m });
  });
  return mergeShortMoodSegments(segments, paras.length);
}

/** ช่วงอารมณ์ของตอน: จากป้ายของ AI (ถ้ายังตรงกับเนื้อหา) หรือเดาจากคำ */
function getChapterMoodSegments(chap) {
  const count = (chap?.paragraphs || []).length;
  if (isStoryLogFresh(chap) && chap.storyLog.moods?.length) {
    return { segments: mergeShortMoodSegments(normalizeStoryMoods(chap.storyLog.moods, count), count, 2), source: 'ai' };
  }
  return { segments: estimateChapterMoods(chap), source: 'estimate' };
}

function moodAtParagraph(segments, paraIdx) {
  let mood = 'calm';
  for (const s of segments) {
    if (s.from <= paraIdx) mood = s.mood;
    else break;
  }
  return mood;
}

// ---------- ตัวเล่น: 2 ช่องสลับกันเพื่อเฟดข้าม ----------
const bgm = { ctx: null, master: null, players: [], active: -1, mood: null, track: null, playing: false, lastSwitch: 0, token: 0, looping: false, lastError: '', source: '' };

function bgmEnsurePlayers() {
  if (bgm.players.length) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    try {
      bgm.ctx = new AC();
      bgm.master = bgm.ctx.createGain();
      bgm.master.gain.value = getBgmVolume();
      bgm.master.connect(bgm.ctx.destination);
    } catch (e) {
      bgm.ctx = null;
    }
  }
  for (let i = 0; i < 2; i++) {
    const el = new Audio();
    el.preload = 'auto';
    const p = { el, gain: null, level: 0, fadeTimer: null };
    // iPhone ปรับ el.volume ไม่ได้ ใช้ Web Audio คุมความดังแทนถ้ามี
    if (bgm.ctx) {
      try {
        p.gain = bgm.ctx.createGain();
        p.gain.gain.value = 0;
        bgm.ctx.createMediaElementSource(el).connect(p.gain);
        p.gain.connect(bgm.master);
      } catch (e) {
        p.gain = null;
      }
    }
    el.addEventListener('timeupdate', () => bgmCheckLoop(p));
    bgm.players.push(p);
  }
}

/** ต้องเรียกในจังหวะที่ผู้ใช้กดปุ่ม (เบราว์เซอร์ไม่ให้เล่นเสียงเองถ้าผู้ใช้ยังไม่ได้กด) */
function bgmUnlock() {
  if (!isBgmEnabled()) return;
  bgmEnsurePlayers();
  if (bgm.ctx && bgm.ctx.state === 'suspended') bgm.ctx.resume().catch(() => {});
}

function bgmApplyLevel(p) {
  if (p.gain) p.el.volume = 1;
  else p.el.volume = Math.max(0, Math.min(1, p.level * getBgmVolume()));
}

function bgmFade(p, target, seconds = BGM_FADE_SEC) {
  clearInterval(p.fadeTimer);
  if (p.gain && bgm.ctx) {
    const now = bgm.ctx.currentTime;
    p.gain.gain.cancelScheduledValues(now);
    p.gain.gain.setValueAtTime(p.gain.gain.value, now);
    p.gain.gain.linearRampToValueAtTime(target, now + seconds);
    p.level = target;
    return;
  }
  const start = p.level;
  const t0 = Date.now();
  p.fadeTimer = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / (seconds * 1000));
    p.level = start + (target - start) * k;
    bgmApplyLevel(p);
    if (k >= 1) clearInterval(p.fadeTimer);
  }, 50);
}

async function bgmPlayUrl(url, token) {
  bgmEnsurePlayers();
  const nextIdx = bgm.active === 0 ? 1 : 0;
  const next = bgm.players[nextIdx];
  const prev = bgm.players[bgm.active];
  clearInterval(next.fadeTimer);
  next.level = 0;
  if (next.gain) {
    next.gain.gain.cancelScheduledValues(0);
    next.gain.gain.value = 0;
  }
  bgmApplyLevel(next);
  next.el.src = url;
  try {
    if (bgm.ctx && bgm.ctx.state === 'suspended') await bgm.ctx.resume();
    await next.el.play();
  } catch (e) {
    bgm.lastError = e?.name === 'NotAllowedError' ? 'เบราว์เซอร์ยังไม่อนุญาตให้เล่นเสียง (กดปุ่มฟังเสียงอ่าน/เพลงอีกครั้ง)' : `เล่นเพลงไม่ได้: ${e?.message || e}`;
    return false;
  }
  if (token !== bgm.token) {
    next.el.pause();
    return false;
  }
  bgm.lastError = '';
  bgmFade(next, 1);
  if (prev && prev !== next) {
    bgmFade(prev, 0);
    setTimeout(() => { if (bgm.players[bgm.active] !== prev) prev.el.pause(); }, BGM_FADE_SEC * 1000 + 100);
  }
  bgm.active = nextIdx;
  return true;
}

/** ใกล้จบเพลง: เฟดเข้าเพลงเดิม (หรือเพลงอื่นของอารมณ์เดียวกัน) แทนการวนแบบกระตุก */
function bgmCheckLoop(p) {
  if (!bgm.playing || bgm.looping || bgm.players[bgm.active] !== p) return;
  const d = p.el.duration;
  if (!Number.isFinite(d) || d < BGM_FADE_SEC * 3) {
    p.el.loop = true;
    return;
  }
  if (d - p.el.currentTime < BGM_FADE_SEC + 0.5) {
    bgm.looping = true;
    bgmSetMood(bgm.genre, bgm.mood, { force: true }).finally(() => { bgm.looping = false; });
  }
}

/** เปลี่ยนเพลงตามอารมณ์ (ไม่ถี่กว่า BGM_MIN_SWITCH_MS ยกเว้น force หรือยังไม่ได้เล่น) */
async function bgmSetMood(genre, mood, { force = false } = {}) {
  if (!isBgmEnabled()) return;
  if (!force && bgm.playing && bgm.mood === mood && bgm.genre === genre) return;
  if (!force && bgm.playing && Date.now() - bgm.lastSwitch < BGM_MIN_SWITCH_MS) return;
  const token = ++bgm.token;
  const track = await resolveBgmTrack(genre, mood, force ? bgm.track?.url : null);
  if (token !== bgm.token) return;
  bgm.genre = genre;
  bgm.mood = mood;
  if (!track) {
    bgm.track = null;
    bgm.lastError = 'ยังไม่มีไฟล์เพลง (ดู docs/bgm-prompts.md)';
    bgmFadeOutAll();
    bgm.playing = false;
    renderBgmStatus();
    return;
  }
  // อารมณ์ใหม่ใช้ไฟล์เดียวกับที่เล่นอยู่ (เช่นใช้แทนกัน) ไม่ต้องเปลี่ยน
  if (!force && bgm.playing && bgm.track?.url === track.url) {
    bgm.track = track;
    renderBgmStatus();
    return;
  }
  const ok = await bgmPlayUrl(track.url, token);
  if (ok) {
    bgm.track = track;
    bgm.playing = true;
    bgm.lastSwitch = Date.now();
  }
  renderBgmStatus();
}

function bgmFadeOutAll(seconds = 1.5) {
  bgm.players.forEach(p => {
    bgmFade(p, 0, seconds);
    setTimeout(() => { if (!bgm.playing || bgm.players[bgm.active] !== p) p.el.pause(); }, seconds * 1000 + 100);
  });
}

function bgmPause() {
  bgm.token++;
  bgm.playing = false;
  bgmFadeOutAll();
  renderBgmStatus();
}

function bgmStop() {
  bgmPause();
  bgm.mood = null;
  bgm.track = null;
}

function setBgmVolume(value) {
  const v = Math.min(1, Math.max(0, Number(value) || 0));
  localStorage.setItem('nov_bgm_volume', String(v));
  if (bgm.master) bgm.master.gain.value = v;
  bgm.players.forEach(bgmApplyLevel);
}

/** เรียกทุกครั้งที่ย่อหน้าที่อ่านเปลี่ยน (จากเสียงอ่าน หรือจากการเลื่อนอ่านถ้าเปิดโหมดอ่านเงียบ) */
function bgmOnParagraph(chap, paraIdx) {
  if (!isBgmEnabled() || !chap) return;
  const { segments, source } = getChapterMoodSegments(chap);
  bgm.source = source;
  const genre = typeof currentBookGenre !== 'undefined' ? currentBookGenre : 'general';
  bgmSetMood(genre, moodAtParagraph(segments, paraIdx));
}

// ---------- UI ----------
function bgmStatusText() {
  if (!isBgmEnabled()) return '🎵 ปิดเพลงประกอบ';
  if (bgm.lastError) return `🎵 ${bgm.lastError}`;
  if (!bgm.playing || !bgm.mood) return '🎵 เพลงประกอบ: รอเริ่ม';
  const t = bgm.track;
  const using = t && t.mood !== bgm.mood ? ` (ใช้เพลง${STORY_MOOD_LABELS[t.mood]}แทน)` : '';
  return `🎵 ${STORY_MOOD_LABELS[bgm.mood]}${using}${t ? ` · ${t.folder}` : ''}${bgm.source === 'estimate' ? ' · อารมณ์เดาจากคำ' : ''}`;
}

function renderBgmStatus() {
  document.querySelectorAll('[data-bgm-status]').forEach(el => { el.textContent = bgmStatusText(); });
}

function bgmControlsHtml() {
  return `<div class="bgm-row">
    <label title="เพลงประกอบตามอารมณ์ของฉาก"><input type="checkbox" ${isBgmEnabled() ? 'checked' : ''} onchange="toggleBgm(this.checked)"> 🎵</label>
    <input type="range" min="0" max="1" step="0.05" value="${getBgmVolume()}" oninput="setBgmVolume(this.value)" title="ความดังเพลง">
    <span class="bgm-status" data-bgm-status>${escapeHtml(bgmStatusText())}</span>
  </div>`;
}

function toggleBgm(on) {
  localStorage.setItem('nov_bgm_enabled', on ? 'true' : 'false');
  if (!on) {
    bgmStop();
    return;
  }
  bgmUnlock();
  bgmResumeForCurrentPosition();
}

/** เริ่ม/เล่นต่อจากย่อหน้าที่อ่านอยู่ (ย่อหน้าที่เสียงอ่านอยู่ หรือย่อหน้าบนจอ) */
function bgmResumeForCurrentPosition() {
  if (!isBgmEnabled()) return;
  if (typeof tts !== 'undefined' && tts.active && !tts.paused) {
    const chap = chapters.find(c => c.id === tts.chapId);
    return bgmOnParagraph(chap, tts.paraIdx);
  }
  if (isBgmSilentReading()) {
    const pos = findTopVisibleParagraph();
    if (pos) bgmOnParagraph(chapters[pos.chapIdx], pos.paraIdx);
  }
}

function toggleBgmSilentReading(on) {
  localStorage.setItem('nov_bgm_silent', on ? 'true' : 'false');
  if (on) {
    bgmUnlock();
    bgmResumeForCurrentPosition();
  } else if (!(typeof tts !== 'undefined' && tts.active)) {
    bgmStop();
  }
}

/** ฟังตัวอย่างเพลงของอารมณ์หนึ่ง (ตรวจว่าไฟล์ใช้ได้) */
async function previewBgmMood(mood) {
  localStorage.setItem('nov_bgm_enabled', 'true');
  bgmUnlock();
  const genre = typeof currentBookGenre !== 'undefined' ? currentBookGenre : 'general';
  bgm.source = 'preview';
  await bgmSetMood(genre, mood, { force: true });
}

async function renderBgmSettings(box) {
  if (!box) return;
  const genre = typeof currentBookGenre !== 'undefined' ? currentBookGenre : 'general';
  box.innerHTML = `
    <div class="reader-row"><span>เพลงประกอบตามอารมณ์<br><small style="opacity: 0.65;">เล่นเบาๆ ตอนฟังเสียงอ่าน</small></span>
      <input type="checkbox" ${isBgmEnabled() ? 'checked' : ''} onchange="toggleBgm(this.checked)"></div>
    <label class="reader-row" style="cursor: pointer;"><span>เล่นตอนอ่านเงียบๆ ด้วย<br><small style="opacity: 0.65;">ตามย่อหน้าที่เห็นบนจอ</small></span>
      <input type="checkbox" ${isBgmSilentReading() ? 'checked' : ''} onchange="toggleBgmSilentReading(this.checked)"></label>
    <div class="reader-row"><span>ความดังเพลง</span><div class="reader-seg"><input type="range" min="0" max="1" step="0.05" value="${getBgmVolume()}" oninput="setBgmVolume(this.value)"></div></div>
    <div class="reader-row"><span>ลองฟัง</span><div class="reader-seg">
      <select class="form-input" id="bgm-preview-mood">${STORY_MOODS.map(m => `<option value="${m}">${STORY_MOOD_LABELS[m]}</option>`).join('')}</select>
      <button class="btn" onclick="previewBgmMood(document.getElementById('bgm-preview-mood').value)">▶</button>
      <button class="btn" onclick="bgmStop()">■</button></div></div>
    <div class="bgm-status" data-bgm-status style="margin-top: 4px;">${escapeHtml(bgmStatusText())}</div>
    <div class="bgm-files" style="font-size: 11px; opacity: 0.7; margin-top: 4px;">กำลังตรวจไฟล์เพลง...</div>`;
  const a = await scanBgmAvailability(genre);
  const files = box.querySelector('.bgm-files');
  if (files) {
    files.textContent = `ไฟล์เพลง: ${a.genreCount !== null ? `แนว ${getGenreThaiName(genre)} ${a.genreCount}/9 · ` : ''}ชุดกลาง (general) ${a.generalCount}/9` +
      (a.genreCount === 0 ? ' — แนวนี้ยังไม่มีเพลงของตัวเอง ใช้ชุดกลางแทน' : '');
  }
}
