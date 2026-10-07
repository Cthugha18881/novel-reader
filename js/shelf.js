// ==================== BOOKSHELF DATA & BATCH ENGINE ====================
// หน้าตาชั้นหนังสืออยู่ใน home.js ไฟล์นี้เป็นงานแปลล่วงหน้า (คิวหลายเรื่อง) และรายการตอนของแต่ละเรื่อง
let isBatchRunning = false;
let bookSortModes = {};

// คิวแปลล่วงหน้า: แปลทีละเรื่อง เรื่องที่กดทีหลังรอคิว (ยืนยันจำนวน token ตอนกดแล้ว จึงเริ่มต่อได้เลย)
let batchQueue = [];          // [{ bookId, count, title }]
let batchCurrent = null;      // { bookId, count, done, desc, title }
const batchResults = {};      // bookId -> { kind: 'done' | 'stopped' | 'error' | 'locked', desc, count, done }

function getGenreThaiName(g) {
  switch(g) {
    case 'xianxia': return 'เซียนเซีย';
    case 'wuxia': return 'กำลังภายใน';
    case 'western_fantasy': return 'แฟนตาซีตะวันตก';
    case 'system_game': return 'ระบบ/เกม';
    case 'scifi': return 'ไซไฟ';
    case 'horror': return 'สยองขวัญ';
    case 'historical': return 'ย้อนยุค/ราชสำนัก';
    case 'urban_life': return 'สังคมเมือง';
    case 'modern_romance': return 'โรแมนติก';
    case 'fanfic': return 'แฟนฟิค';
    case 'light_novel': return 'ไลท์โนเวล';
    case 'kr_fantasy': return 'เว็บโนเวลเกาหลี';
    case 'mystery': return 'สืบสวน/ลึกลับ';
    case 'apocalypse': return 'วันสิ้นโลก';
    default: return 'วรรณกรรมทั่วไป';
  }
}

/** หยุดเรื่องที่กำลังแปล หรือเอาเรื่องที่รอคิวออก (ไม่ระบุ = หยุดเรื่องที่กำลังแปล) */
function cancelBatchTranslate(bookId) {
  if (bookId && batchQueue.some(j => j.bookId === bookId)) {
    batchQueue = batchQueue.filter(j => j.bookId !== bookId);
    renderBatchProgress(bookId);
    batchQueue.forEach(j => renderBatchProgress(j.bookId));
    return;
  }
  if (batchCurrent && (!bookId || batchCurrent.bookId === bookId)) {
    abortTask('batch');
    batchCurrent.desc = 'กำลังสั่งหยุด...';
    renderBatchProgress(batchCurrent.bookId);
  }
}

function dismissBatchResult(bookId) {
  delete batchResults[bookId];
  renderBatchProgress(bookId);
}

function setBatchProgress(patch) {
  if (!batchCurrent) return;
  Object.assign(batchCurrent, patch);
  renderBatchProgress(batchCurrent.bookId);
}

/** สถานะแปลล่วงหน้าของเรื่องนี้ (ใช้วาดแถบบนการ์ดและหน้ารายละเอียด) */
function getBatchStatus(bookId) {
  if (batchCurrent?.bookId === bookId) return { kind: 'running', ...batchCurrent };
  const qi = batchQueue.findIndex(j => j.bookId === bookId);
  if (qi >= 0) return { kind: 'queued', position: qi + 1, ...batchQueue[qi] };
  if (batchResults[bookId]) return { ...batchResults[bookId] };
  return null;
}

function batchProgressHtml(bookId, { compact = false } = {}) {
  const s = getBatchStatus(bookId);
  if (!s) return '';
  const id = jsArg(bookId);
  const desc = s.desc ? `<div class="bp-desc">${escapeHtml(compact ? s.desc.split('\n')[0] : s.desc)}</div>` : '';
  if (s.kind === 'running') {
    const pct = s.count ? Math.round(100 * s.done / s.count) : 0;
    return `<div class="batch-progress running">
      <div class="bp-top"><b>⚡ กำลังแปล ${s.done}/${s.count} ตอน</b><button class="btn bp-btn" onclick="event.stopPropagation(); cancelBatchTranslate(${id})">หยุด</button></div>
      <div class="bp-bar" role="progressbar" aria-label="แปลล่วงหน้า" aria-valuemin="0" aria-valuemax="${s.count}" aria-valuenow="${s.done}"><span style="width: ${Math.max(4, pct)}%"></span></div>
      ${desc}</div>`;
  }
  if (s.kind === 'queued') {
    return `<div class="batch-progress queued">
      <div class="bp-top"><b>⏳ รอคิวแปล ${s.count} ตอน${s.position > 1 ? ` (คิวที่ ${s.position})` : ''}</b><button class="btn bp-btn" onclick="event.stopPropagation(); cancelBatchTranslate(${id})">ยกเลิก</button></div>
      <div class="bp-bar"><span style="width: 0;"></span></div></div>`;
  }
  const head = { done: `✓ แปลเสร็จ ${s.done} ตอน`, partial: `⚠️ แปลเสร็จ ${s.done} ตอน · ข้าม ${s.skipped || 0} ตอนที่ถูกบล็อก`, stopped: `หยุดแล้ว (แปลไป ${s.done} ตอน)`, locked: '🔒 หยุดที่ตอนที่ต้องซื้อ', error: `⚠️ หยุดกลางคัน (แปลไป ${s.done} ตอน)` }[s.kind] || '';
  return `<div class="batch-progress ${s.kind}">
    <div class="bp-top"><b>${head}</b><button class="btn bp-btn" onclick="event.stopPropagation(); dismissBatchResult(${id})" aria-label="ปิดข้อความนี้">✕</button></div>
    ${desc}</div>`;
}

/** วาดแถบความคืบหน้าใหม่ทุกที่ที่แสดงเรื่องนี้ (การ์ดบนหน้าแรก + หน้ารายละเอียด) */
function renderBatchProgress(bookId) {
  document.querySelectorAll('[data-batch-for]').forEach(el => {
    if (el.dataset.batchFor !== bookId) return;
    el.innerHTML = batchProgressHtml(bookId, { compact: el.dataset.compact === '1' });
    el.closest('.home-card')?.classList.toggle('is-batching', !!getBatchStatus(bookId) && ['running', 'queued'].includes(getBatchStatus(bookId).kind));
  });
}

// ---------- Token estimate ----------
// ค่าประมาณคร่าวๆ ต่อ 1 ตัวอักษรต้นฉบับ (input) และ token ของคำแปลไทย (output)
const TOKENS_PER_SRC_CHAR = { zh: 1.1, ja: 1.1, ko: 0.9, en: 0.3, other: 0.6 };
const OUTPUT_TOKENS_PER_SRC_CHAR = { zh: 1.6, ja: 1.3, ko: 1.2, en: 0.45, other: 0.9 };
const PROMPT_OVERHEAD_TOKENS = 2500;

/** token ที่ใช้ต่อ 1 ตอนตามโหมดคุณภาพ จากความยาวเฉลี่ยของตอนล่าสุดในเรื่องนี้ */
function estimateChapterTokens(bookChaps, lang) {
  const sample = bookChaps.filter(c => c.paragraphs?.some(p => p.src)).slice(-3);
  const avgChars = sample.length
    ? sample.reduce((n, c) => n + c.paragraphs.reduce((m, p) => m + (p.src || '').length, 0), 0) / sample.length
    : 3000;
  const code = normalizeLang(lang);
  const src = avgChars * TOKENS_PER_SRC_CHAR[code];
  const out = avgChars * OUTPUT_TOKENS_PER_SRC_CHAR[code];
  // สแกนก่อนแปล + แปล (ทุกโหมด)
  let input = (src + 1500) + (src + PROMPT_OVERHEAD_TOKENS);
  let output = 600 + out;
  const mode = getQualityMode();
  if (mode === 'balanced') { input += 0.3 * (src + out) + 1000; output += 0.3 * out; }
  if (mode === 'thorough') { input += src + out + 1000; output += out; }
  if (mode === 'best') {
    input += 0.3 * (src + out) + 1000 + (src + out + 1500) + (src + 2 * out + 800);
    output += 0.3 * out + out + 400;
  }
  return { input: Math.round(input), output: Math.round(output), avgChars: Math.round(avgChars) };
}

function formatTokenCount(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
}

function formatBatchEstimate(est, count) {
  const labels = { fast: 'เร็ว', balanced: 'สมดุล', thorough: 'ละเอียด', best: 'ดีที่สุด' };
  const basis = est.fromHistory
    ? `คิดจากที่ใช้จริงเฉลี่ย ${est.fromHistory} ตอนล่าสุดของเรื่องนี้`
    : `ตอนละประมาณ ${est.avgChars.toLocaleString()} ตัวอักษรต้นฉบับ`;
  // บอกแค่จำนวน token: ราคาจริงขึ้นกับผู้ให้บริการ/โควตาฟรี/แพ็กเกจ ตัวเลขเงินโดยประมาณทำให้เข้าใจผิดได้
  return `จะแปล ${count} ตอน (โหมด "${labels[getQualityMode()]}", ${basis})\n\n` +
    `ใช้ประมาณ ${formatTokenCount(est.input * count)} input token + ${formatTokenCount(est.output * count)} output token\n` +
    `(ตอนละ ~${formatTokenCount(est.input)} + ${formatTokenCount(est.output)})\n\n` +
    `* เป็นค่าประมาณ ยอดที่ใช้จริงอาจสูงกว่านี้ ต้องการเริ่มแปลหรือไม่?`;
}

/** ใช้ค่าเฉลี่ย token ที่ใช้จริงของเรื่องนี้ (ถ้ามีอย่างน้อย 2 ตอน) แทนการประมาณจากความยาว */
async function estimateBatchTokens(bookId, bookChaps, lang) {
  const est = estimateChapterTokens(bookChaps, lang);
  const avg = await getChapterAverage(bookId, getQualityMode());
  return avg ? { ...est, input: avg.input, output: avg.output, fromHistory: avg.chapters } : est;
}

/** ปุ่ม "⚡ แปลล่วงหน้า": เลือกจำนวนตอนก่อน */
async function chooseBatchCount(bookId) {
  const status = getBatchStatus(bookId);
  if (status && ['running', 'queued'].includes(status.kind)) return appAlert(status.kind === 'running' ? 'เรื่องนี้กำลังแปลล่วงหน้าอยู่' : 'เรื่องนี้อยู่ในคิวแปลแล้ว');
  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  const pending = (await dbGetChaptersByBook(bookId)).filter(isPendingChapter).length;
  const max = getBatchMax();
  const options = [3, 5, 10, 20].filter(n => n <= max);
  if (!options.includes(max)) options.push(max);
  const pick = await appChoose(
    `แปลต่อจากตอนล่าสุดที่มีในเครื่อง${pending ? ` (มีตอนที่รอแปล ${pending} ตอน จะแปลก่อน)` : ''}\nใช้โควตา AI · จะบอกจำนวน token โดยประมาณก่อนเริ่ม${max < BATCH_HARD_MAX ? `\nแพ็กเกจของคุณแปลล่วงหน้าได้ครั้งละไม่เกิน ${max} ตอน` : ''}`,
    [
      ...options.map(n => ({ label: `${n} ตอน`, value: n, variant: n === Math.min(5, max) ? 'primary' : undefined })),
      ...(max > 20 ? [{ label: 'กำหนดเอง…', value: 'custom' }] : [])
    ],
    { title: `แปลล่วงหน้า: ${book?.title || 'นิยาย'}` });
  if (pick === null) return;
  let count = pick;
  if (pick === 'custom') {
    const raw = await appPrompt(`จำนวนตอน (1-${max})`, '5', { title: 'แปลล่วงหน้ากี่ตอน', confirmLabel: 'ต่อไป' });
    if (raw === null) return;
    count = parseInt(raw, 10);
  }
  await startBatchTranslateForBook(bookId, count);
}

// เพดานของเครื่องเอง (แพ็กเกจ Pro) แต่ละแพ็กเกจกำหนดต่ำกว่านี้ได้
const BATCH_HARD_MAX = 100;

/** จำนวนตอนสูงสุดต่อครั้งของการแปลล่วงหน้า (ตามแพ็กเกจ ไม่เกิน BATCH_HARD_MAX) */
function getBatchMax() {
  const planMax = typeof getEntitlements === 'function' ? getEntitlements().batchMax : null;
  return Math.min(BATCH_HARD_MAX, planMax ?? BATCH_HARD_MAX);
}

async function startBatchTranslateForBook(bookId, count) {
  const max = getBatchMax();
  if (Number.isInteger(count) && count > max && max < BATCH_HARD_MAX && typeof showPlanLimit === 'function') return showPlanLimit('batch');
  if (!Number.isInteger(count) || count < 1 || count > max) return appAlert(`กรุณาระบุจำนวนตอนระหว่าง 1 ถึง ${max}`);
  if (batchCurrent?.bookId === bookId || batchQueue.some(j => j.bookId === bookId)) return appAlert('เรื่องนี้กำลังแปลล่วงหน้าหรืออยู่ในคิวแล้ว');
  if (!hasActiveApiKey()) return appAlert("กรุณาใส่ API Key ในเมนู 'ตั้งค่า' ก่อนใช้งาน");

  const bookChaps = (await dbGetChaptersByBook(bookId)).sort((a, b) => a.order - b.order);
  if (bookChaps.length === 0) return appAlert("ไม่พบตอนตั้งต้นของนิยายเรื่องนี้");

  const lastChap = bookChaps[bookChaps.length - 1];
  if (!lastChap.nextUrl && !bookChaps.some(isPendingChapter)) {
    const inputUrl = await appPrompt(`ไม่พบลิงก์ตอนถัดไปของ "${lastChap.title}" วางลิงก์ของตอนถัดไปเพื่อแปลต่อ`, '', { title: 'วาง URL ตอนถัดไป', confirmLabel: 'ใช้ลิงก์นี้', placeholder: 'https://...' });
    if (!inputUrl || !inputUrl.trim()) return;
    lastChap.nextUrl = inputUrl.trim();
    await dbSaveChapter(lastChap);
  }

  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId) || { bookId };
  if (count >= 3 && !(await appConfirm(formatBatchEstimate(await estimateBatchTokens(bookId, bookChaps, getBookSourceLang(book)), count), { title: `แปลล่วงหน้า ${count} ตอน`, confirmLabel: `เริ่มแปล ${count} ตอน` }))) return;

  delete batchResults[bookId];
  const job = { bookId, count, title: book.title || 'นิยาย' };
  if (batchCurrent) {
    batchQueue.push(job);
    renderBatchProgress(bookId);
    showGlobalToast(`"${job.title}" เข้าคิวแล้ว จะเริ่มแปลเมื่อเรื่องก่อนหน้าเสร็จ`);
    setTimeout(hideGlobalToast, 2500);
    return;
  }
  runBatchQueue(job);
}

// ผู้ให้บริการ AI บล็อกเนื้อหาหลายตอนติดกัน: น่าจะบล็อกทั้งเรื่อง หยุดก่อน ไม่ดึงหน้าเว็บต่อเปล่าๆ
const BATCH_MAX_CONSECUTIVE_BLOCKS = 3;

function chapterBlockInfo(err) {
  return { provider: err?.provider || '', code: err?.blockCode || '', at: Date.now() };
}

/** ตอนที่รอแปลถูกผู้ให้บริการบล็อก: ติดป้ายไว้ (ยังเป็นตอนที่รอแปล แปลใหม่ด้วยผู้ให้บริการอื่นได้) */
async function markPendingChapterBlocked(chap, err) {
  const fresh = (await dbGetChaptersByBook(chap.bookId)).find(c => c.id === chap.id);
  if (!fresh || !isPendingChapter(fresh)) return;
  fresh.blockInfo = chapterBlockInfo(err);
  await dbSaveChapter(fresh);
  const mem = chapters.find(c => c.id === chap.id);
  if (mem) mem.blockInfo = fresh.blockInfo;
}

/** ตอนจาก URL ถูกบล็อก: เก็บต้นฉบับที่ดึงมาแล้วเป็นตอนที่รอแปล เพื่อไล่ตอนถัดไปต่อได้ */
async function saveBlockedChapterAsPending(bookId, url, page, err) {
  const all = await dbGetChaptersByBook(bookId);
  const existing = all.find(c => sameSourceUrl(c.sourceUrl, url));
  if (existing) return existing;
  const order = all.reduce((max, c) => Math.max(max, c.order || 0), 0) + 1;
  const record = {
    id: typeof newChapterIdFor === 'function' ? newChapterIdFor(bookId, url) : `${bookId}_chap_${Date.now()}_b`,
    bookId,
    order,
    title: page.rawChapTitle || `ตอนที่ ${order}`,
    chapterType: 'story',
    status: 'pending',
    paragraphs: splitSourceParagraphs(page.text).map(src => ({ th: '', src })),
    summary: '',
    sourceUrl: url,
    nextUrl: page.nextUrl || null,
    ...(page.lockInfo ? { pendingLockInfo: page.lockInfo } : {}),
    blockInfo: chapterBlockInfo(err)
  };
  await dbSaveChapter(record);
  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  if (book) await dbSaveBook({ ...book, totalChapters: order, lastUrl: url, updatedAt: Date.now() });
  if (currentBookId === bookId && !chapters.some(c => c.id === record.id)) {
    chapters.push(record);
    nextUrlCalculated = record.nextUrl;
    checkAndRefreshBottomStatus();
  }
  return record;
}

function describeBatchSkipped(skipped, lastBlockErr) {
  if (!skipped.length) return '';
  const names = skipped.slice(0, 3).map(t => `"${t}"`).join(', ') + (skipped.length > 3 ? ` และอีก ${skipped.length - 3} ตอน` : '');
  return `ข้าม ${skipped.length} ตอนที่ถูกบล็อก: ${names} (ยังอยู่ในรายการเป็น "ถูกบล็อก")\n${lastBlockErr?.message || ''}`;
}

/** แปลงานแรก แล้วทำงานในคิวต่อจนหมด */
async function runBatchQueue(firstJob) {
  let job = firstJob;
  while (job) {
    await runBatchJob(job);
    // แปลตอนใหม่ที่ติดตามไว้แล้ว: ลด/ล้างป้าย "เพิ่ม N ตอนใหม่เข้าคิวแล้ว"
    if (typeof syncFollowBadgeWithPending === 'function') await syncFollowBadgeWithPending(job.bookId).catch(() => {});
    job = batchQueue.shift() || null;
  }
  checkAndRefreshBottomStatus();
  // แปลเสร็จหลายตอน: สำรองลงโฟลเดอร์อัตโนมัติ (ถ้าตั้งไว้และได้รับอนุญาตแล้ว)
  maybeRunAutoBackup().then(() => { renderSafetyBanner(); renderBookshelfBackupNote(); });
}

async function runBatchJob({ bookId, count }) {
  const finish = (kind, desc, done) => {
    batchResults[bookId] = { kind, desc, count, done };
  };

  const knownBooks = await dbGetAllBooks();
  const bookRecord = knownBooks.find(b => b.bookId === bookId);
  if (!bookRecord) return; // ลบเรื่องไปแล้วระหว่างรอคิว

  let bookChaps = (await dbGetChaptersByBook(bookId)).sort((a, b) => a.order - b.order);
  let lastChap = bookChaps[bookChaps.length - 1];
  let targetUrl = lastChap?.nextUrl;
  // ตอนที่รอแปล (จากการวางข้อความ/ไฟล์ หรือสร้างจากสารบัญ) แปลก่อนตามลำดับ แล้วค่อยไล่ตอนถัดไปจาก URL
  const pendingQueue = bookChaps.filter(isPendingChapter);

  // context ของเรื่องที่แปลล่วงหน้า แยกจากเรื่องที่ผู้ใช้กำลังอ่านอยู่โดยสมบูรณ์
  const ctx = makeBookContext(bookRecord);

  // แปลล่วงหน้าเรื่องเดียวกันได้ทีละแท็บ
  const releaseBatch = await acquireLock(lockNames.batch(bookId), { ifAvailable: true });
  if (!releaseBatch) {
    finish('error', 'อีกแท็บกำลังแปลล่วงหน้าเรื่องนี้อยู่ กรุณารอให้เสร็จ หรือกดหยุดในแท็บนั้นก่อน', 0);
    renderBatchProgress(bookId);
    return;
  }

  const controller = beginTask('batch');
  const signal = controller.signal;
  isBatchRunning = true;
  batchCurrent = { bookId, count, done: 0, desc: 'เตรียมคิว...', title: bookRecord.title };
  renderBatchProgress(bookId);

  let successCount = 0;
  let finishedAll = false;
  let stoppedByLock = false;
  let stopDesc = '';
  const skipped = [];
  let lastBlockErr = null;
  let consecutiveBlocks = 0;
  const progress = (desc) => setBatchProgress({ desc, done: successCount });
  // ถูกบล็อก: จดไว้แล้วไปตอนถัดไป เว้นแต่บล็อกติดกันหลายตอน (true = ต้องหยุด)
  const noteBlocked = (title, err) => {
    skipped.push(title);
    lastBlockErr = err;
    consecutiveBlocks++;
    if (consecutiveBlocks >= BATCH_MAX_CONSECUTIVE_BLOCKS) {
      stopDesc = `หยุดแล้ว: ผู้ให้บริการ AI บล็อกเนื้อหา ${consecutiveBlocks} ตอนติดกัน`;
      return true;
    }
    progress(`"${title}" ถูกผู้ให้บริการบล็อก ข้ามไปตอนถัดไป...`);
    return false;
  };

  try {
    for (let i = 1; i <= count; i++) {
      if (signal.aborted) break;

      if (pendingQueue.length) {
        const pendingChap = pendingQueue.shift();
        progress(`กำลังแปลตอนที่รอแปล ${i}/${count}: ${pendingChap.title}`);
        try {
          await translatePendingChapterCore(pendingChap, ctx, {
            signal,
            onStatus: (msg) => progress(`[${i}/${count}] ${msg.substring(0, 60)}`)
          });
          successCount++;
          consecutiveBlocks = 0;
          if (i === count) finishedAll = true;
          if (i < count) await sleepAbortable(1500, signal);
        } catch (err) {
          if (isAbortError(err)) break;
          // อีกแท็บกำลังแปลตอนนี้อยู่: ข้ามไปตอนถัดไป
          if (err instanceof LockBusyError) continue;
          if (err?.kind === 'blocked') {
            await markPendingChapterBlocked(pendingChap, err).catch(e => console.warn('Mark blocked failed:', e));
            refreshShelfViewOnly(bookId);
            if (noteBlocked(pendingChap.title, err)) break;
            if (i === count) finishedAll = true;
            continue;
          }
          stopDesc = `หยุดที่ "${pendingChap.title}": ${err.message}`;
          break;
        }
        continue;
      }

      if (!targetUrl) {
        stopDesc = `แปลครบ ${successCount} ตอนแล้ว แต่ยังไม่มี URL ของตอนถัดไป กรุณากด "แก้ URL ถัดไป"`;
        break;
      }

      // ล็อกการเพิ่มตอนของเรื่องนี้ระหว่างแท็บ (ตอนถัดไป/prefetch ในแท็บอื่นจะรอ ไม่แปลตอนเดียวกันซ้ำ)
      let releaseAppend;
      try {
        releaseAppend = await acquireLock(lockNames.append(bookId), { signal });
      } catch (err) {
        break;
      }
      try {
        // ข้ามตอนที่มีอยู่แล้ว (เช่น prefetch แปลไปก่อนแล้ว)
        const existingAll = await dbGetChaptersByBook(bookId);
        const alreadySaved = existingAll.find(c => sameSourceUrl(c.sourceUrl, targetUrl));
        if (alreadySaved) {
          lastChap = alreadySaved;
          targetUrl = alreadySaved.nextUrl;
          successCount++;
          if (i === count) finishedAll = true;
          continue;
        }

        const urlSegment = targetUrl.substring(targetUrl.lastIndexOf('/'));
        progress(`กำลังดึงและแปลตอนที่ ${i}/${count}... (${urlSegment})`);

        let page = null;
        try {
          page = await scrapePage(targetUrl, signal, { bookId });
          const { text, nextUrl, rawChapTitle, rawBookTitle, author, lockInfo } = page;
          if (author) ctx.author = author;

          const result = await translateChapter(text, ctx, {
            signal,
            rawChapTitle,
            rawBookTitle,
            lockInfo,
            prevChapter: findPrevStoryChapter(existingAll),
            onStatus: (msg) => progress(`[${i}/${count}] ${msg.substring(0, 60)}`)
          });

          const currentAll = await dbGetChaptersByBook(bookId);
          const savedMeanwhile = currentAll.find(c => sameSourceUrl(c.sourceUrl, targetUrl));
          if (savedMeanwhile) {
            // งานอื่นบันทึกตอนนี้ไปแล้วระหว่างที่เรากำลังแปล
            lastChap = savedMeanwhile;
            targetUrl = lastChap.nextUrl;
            successCount++;
            if (i === count) finishedAll = true;
            continue;
          }
          const maxOrder = currentAll.reduce((max, c) => Math.max(max, c.order || 0), 0);
          const chapTitle = result.chapterTitle || rawChapTitle || `ตอนที่ ${maxOrder + 1}`;

          const newChap = buildChapterRecord({
            bookId,
            order: maxOrder + 1,
            title: chapTitle,
            result,
            sourceUrl: targetUrl,
            nextUrl,
            idSuffix: `_${i}`
          });

          await dbSaveChapter(newChap);
          successCount++;
          consecutiveBlocks = 0;
          lastChap = newChap;

          // อ่านเรคคอร์ดล่าสุดแล้วแก้เฉพาะฟิลด์ของ batch ตำแหน่งอ่านของผู้ใช้จะไม่ถูกแตะ
          const targetBook = (await dbGetAllBooks()).find(b => b.bookId === bookId);
          if (!targetBook) throw new Error('นิยายเรื่องนี้ถูกลบออกจากชั้นหนังสือระหว่างแปล');
          const finalBookTitle = targetBook.isUserCustomTitle ? targetBook.title : (result.bookTitle || targetBook.title);
          ctx.title = finalBookTitle;

          await dbSaveBook({
            ...targetBook,
            title: finalBookTitle,
            author: ctx.author,
            totalChapters: maxOrder + 1,
            lastUrl: targetUrl,
            updatedAt: Date.now()
          });

          if (currentBookId === bookId) {
            chapters.push(newChap);
            nextUrlCalculated = nextUrl;
            if (!isUserCustomTitle) currentBookTitle = finalBookTitle;
            currentAuthor = ctx.author;
            checkAndRefreshBottomStatus();
          }

          refreshShelfViewOnly(bookId);
          targetUrl = nextUrl;

          // ตอนที่ต้องซื้อ/อ่านต่อในแอพ: ตอนถัดจากนี้มักล็อกต่อกัน หยุดไว้ก่อน ไม่ดึงหน้าเว็บต่อเปล่าๆ
          if (result.lockInfo) {
            stopDesc = `หยุดที่ "${chapTitle}": ${describeLockInfo(result.lockInfo).short}\n(บันทึกตอนนี้ไว้แล้วโดยไม่แปลตัวอย่าง ดูรายละเอียดได้ในหน้าอ่าน)`;
            stoppedByLock = true;
            break;
          }
          if (i === count) finishedAll = true;

          if (i < count) {
            progress(`บันทึก "${chapTitle}" แล้ว พัก 2.5 วินาทีก่อนตอนถัดไป...`);
            await sleepAbortable(2500, signal);
          }
        } catch (err) {
          if (isAbortError(err)) break;
          // ผู้ให้บริการบล็อกเนื้อหา: เก็บต้นฉบับเป็นตอนที่รอแปล (ติดป้าย "ถูกบล็อก") แล้วไปตอนถัดไป
          if (err?.kind === 'blocked' && page?.text) {
            let saved = null;
            try {
              saved = await saveBlockedChapterAsPending(bookId, targetUrl, page, err);
            } catch (saveErr) {
              console.warn('Save blocked chapter failed:', saveErr);
            }
            if (saved) {
              lastChap = saved;
              targetUrl = saved.nextUrl;
              refreshShelfViewOnly(bookId);
              if (noteBlocked(saved.title, err)) break;
              if (i === count) finishedAll = true;
              continue;
            }
          }
          // ปัญหาจาก AI/เพดาน/การตั้งค่า ไม่เกี่ยวกับ URL จึงไม่ต้องแนะนำให้แก้ลิงก์
          const urlProblem = isMissingPageError(err) || !(err instanceof LLMError);
          stopDesc = `หยุดที่ตอนที่ ${i}: ${isMissingPageError(err) ? 'ไม่พบหน้านิยาย (เลข URL กระโดด)' : err.message}` +
            (urlProblem ? `\n(กดปุ่ม "แก้ URL ถัดไป" เพื่อใส่ลิงก์ใหม่)` : '');
          break;
        }
      } finally {
        releaseAppend();
      }
    }
  } finally {
    releaseBatch();
    endTask('batch', controller);
    isBatchRunning = false;
    batchCurrent = null;
  }

  const skippedNote = describeBatchSkipped(skipped, lastBlockErr);
  const withSkipped = (desc) => skippedNote ? `${desc}\n${skippedNote}` : desc;
  if (stoppedByLock) finish('locked', withSkipped(stopDesc), successCount);
  else if (signal.aborted) finish('stopped', withSkipped(`หยุดตามคำสั่งแล้ว (บันทึกไว้ ${successCount} ตอน)`), successCount);
  else if (finishedAll && skipped.length) finish('partial', withSkipped(`บันทึก ${successCount} ตอน`), successCount);
  else if (finishedAll) finish('done', `บันทึกครบ ${successCount} ตอน อ่านแบบออฟไลน์ได้`, successCount);
  else finish('error', withSkipped(stopDesc || 'หยุดก่อนครบจำนวนที่ตั้งไว้'), successCount);
  if (batchResults[bookId]) batchResults[bookId].skipped = skipped.length;
  renderBatchProgress(bookId);
  refreshShelfViewOnly(bookId);
}

// ---------- รายการตอนของเรื่อง (หน้ารายละเอียดในชั้นหนังสือ) ----------
const SHELF_SORT_LABELS = { time_desc: 'ตอนล่าสุดก่อน', time_asc: 'ตอนแรกก่อน', title_asc: 'ชื่อ ก-ฮ', title_desc: 'ชื่อ ฮ-ก' };

function renderChaptersHtml(bookId, bookChaps, readingChapId) {
  if (!bookChaps || bookChaps.length === 0) {
    return '<div class="shelf-empty">ยังไม่มีตอนในเครื่อง</div>';
  }
  const numberOf = computeChapterNumbers([...bookChaps].sort((a, b) => (a.order || 0) - (b.order || 0)));
  const activeId = bookId === currentBookId && chapters[currentChapterIndex] ? chapters[currentChapterIndex].id : readingChapId;

  return bookChaps.map((ch) => {
    const isActive = ch.id === activeId;
    const chapterType = ch.chapterType || 'story';
    const typeLabel = CHAPTER_TYPE_LABELS[chapterType] || CHAPTER_TYPE_LABELS.story;
    const typeIcon = chapterType !== 'story' ? `<span class="chap-type-icon" title="${escapeHtml(typeLabel)}">${escapeHtml(typeLabel.split(' ')[0])}</span>` : '';
    const label = numberOf.get(ch.id);
    const status = isPendingChapter(ch) && ch.blockInfo
      ? `<span class="chap-status blocked" title="${escapeHtml(describeProviderBlock(ch.blockInfo.provider, ch.blockInfo.code))}">ถูกบล็อก</span>`
      : isPendingChapter(ch) ? '<span class="chap-status pending">รอแปล</span>' : (isActive ? '<span class="chap-status reading">อ่านอยู่</span>' : '');
    return `
      <div class="chap-subitem${isActive ? ' active' : ''}${chapterType !== 'story' ? ' chap-nonstory' : ''}">
        <input type="checkbox" class="chap-chk" data-book-id="${escapeHtml(bookId)}" value="${escapeHtml(ch.id)}" onchange="updateSelectedDeleteBtn(${jsArg(bookId)})" aria-label="เลือก ${escapeHtml(ch.title)}">
        <button class="chap-name-btn" onclick="jumpToChapterById(${jsArg(bookId)}, ${jsArg(ch.id)})">
          ${label ? `<span class="chap-num">#${escapeHtml(label)}</span>` : ''}${typeIcon}<span class="chap-title-text">${escapeHtml(ch.title)}</span>
        </button>
        ${status}
        <button class="btn chap-more" onclick="openChapterRowMenu(this, ${jsArg(bookId)}, ${jsArg(ch.id)})" title="เมนูของตอนนี้">⋯</button>
      </div>`;
  }).join('');
}

async function openChapterRowMenu(anchor, bookId, chapId) {
  const chap = (await dbGetChaptersByBook(bookId)).find(c => c.id === chapId);
  if (!chap) return;
  openActionMenu(anchor, [
    { icon: '📖', label: 'อ่านตอนนี้', onSelect: () => jumpToChapterById(bookId, chapId) },
    { icon: '🔄', label: isPendingChapter(chap) ? 'แปลตอนนี้' : 'แปลตอนนี้ใหม่', hint: 'ใช้โควตา AI · ถามก่อนเริ่ม', onSelect: () => retranslateSpecificChapterDirect(chapId) },
    { icon: '🏷️', label: 'เปลี่ยนประเภทตอน', hint: CHAPTER_TYPE_LABELS[chap.chapterType || 'story'], onSelect: () => chooseChapterType(bookId, chap) },
    { icon: '🕘', label: 'ประวัติคำแปล', hidden: !chap.hasVersions, onSelect: () => openVersionHistory(chapId) }
  ], { title: chap.title });
}

async function chooseChapterType(bookId, chap) {
  const type = await appChoose('ประเภทตอนมีผลกับการต่อบริบทให้ AI และการส่งออก TXT / EPUB',
    CHAPTER_TYPES.map(t => ({ label: CHAPTER_TYPE_LABELS[t], value: t, variant: t === (chap.chapterType || 'story') ? 'primary' : '' })),
    { title: `ประเภทของ "${chap.title}"` });
  if (type) await setChapterType(bookId, chap.id, type);
}

async function setShelfSort(bookId, mode) {
  if (!SHELF_SORT_LABELS[mode]) return;
  bookSortModes[bookId] = mode;
  await refreshShelfViewOnly(bookId);
}

function applySortToChapters(chapsList, sortMode) {
  if (sortMode === 'time_desc') chapsList.sort((x, y) => y.order - x.order);
  else if (sortMode === 'time_asc') chapsList.sort((x, y) => x.order - y.order);
  else if (sortMode === 'title_asc') chapsList.sort((x, y) => x.title.localeCompare(y.title, 'th', { numeric: true }));
  else if (sortMode === 'title_desc') chapsList.sort((x, y) => y.title.localeCompare(x.title, 'th', { numeric: true }));
}

function updateSelectedDeleteBtn(bookId) {
  const chks = Array.from(document.querySelectorAll('.chap-chk:checked')).filter(c => c.dataset.bookId === bookId);
  const bar = document.getElementById(`shelf-select-bar-${bookId}`);
  const countEl = document.getElementById(`shelf-select-count-${bookId}`);
  if (bar) bar.hidden = chks.length === 0;
  if (countEl) countEl.textContent = `เลือกไว้ ${chks.length} ตอน`;
}

function toggleSelectAllChaps(bookId) {
  const chks = Array.from(document.querySelectorAll('.chap-chk')).filter(c => c.dataset.bookId === bookId);
  if (chks.length === 0) return;
  const allChecked = Array.from(chks).every(c => c.checked);
  chks.forEach(c => c.checked = !allChecked);
  updateSelectedDeleteBtn(bookId);
}

async function retranslateSpecificChapter(e, bookId, chapId) {
  e?.stopPropagation?.();
  await retranslateSpecificChapterDirect(chapId);
}

async function openGenrePickerModal(e, bookId) {
  e?.stopPropagation?.();
  bookIdForGenreEdit = bookId;
  const books = await dbGetAllBooks();
  const b = books.find(x => x.bookId === bookId);
  if (!b) return;

  document.getElementById('genre-picker-book-title').innerText = b.title || 'นิยาย';
  document.getElementById('genre-picker-select').value = b.genre || 'xianxia';
  document.getElementById('genre-picker-lang').value = getBookSourceLang(b);

  openModal('genre-picker-modal');
}

async function saveChosenBookGenre() {
  if (!bookIdForGenreEdit) return;
  const books = await dbGetAllBooks();
  const b = books.find(x => x.bookId === bookIdForGenreEdit);
  if (!b) return closeModal('genre-picker-modal');

  const selectedGenre = document.getElementById('genre-picker-select').value;
  const selectedLang = normalizeLang(document.getElementById('genre-picker-lang').value);
  b.genre = selectedGenre;
  b.sourceLang = selectedLang;
  b.updatedAt = Date.now();
  await dbSaveBook(b);

  if (currentBookId === bookIdForGenreEdit) {
    currentBookGenre = selectedGenre;
    currentSourceLang = selectedLang;
    renderVirtualWindow(currentChapterIndex);
  }

  closeModal('genre-picker-modal');
  refreshShelfViewOnly(bookIdForGenreEdit);
}

/** ข้อมูลของเรื่องเปลี่ยน: วาดการ์ดบนหน้าแรก และหน้ารายละเอียด (ถ้าเปิดเรื่องนี้อยู่) ใหม่ */
async function refreshShelfViewOnly(bookId) {
  if (typeof refreshHomeBook === 'function') await refreshHomeBook(bookId);
}

async function fixBookNextUrl(bookId) {
  const bookChaps = await dbGetChaptersByBook(bookId);
  bookChaps.sort((x, y) => x.order - y.order);
  if (bookChaps.length === 0) return;
  const lastChap = bookChaps[bookChaps.length - 1];

  const input = await appPrompt(`ลิงก์ของตอนถัดจาก "${lastChap.title}"`, lastChap.nextUrl || '', { title: 'แก้ URL ตอนถัดไป', placeholder: 'https://...' });
  if (input && input.trim()) {
    lastChap.nextUrl = input.trim();
    await dbSaveChapter(lastChap);
    if (currentBookId === bookId) {
      nextUrlCalculated = lastChap.nextUrl;
      lastPrefetchError = '';
    }
    appAlert('อัปเดต URL เรียบร้อยแล้ว กด "⚡ แปลล่วงหน้า" เพื่อแปลต่อได้เลย');
    checkAndRefreshBottomStatus();
  }
}

async function jumpToChapterById(bookId, chapId) {
  await loadBookFromDB(bookId, chapId);
  if (typeof closeHome === 'function') closeHome();
}

/** เปิดชั้นหนังสือ (ชื่อเดิมที่หลายไฟล์เรียกใช้) */
async function openBookshelfModal() {
  return openHome();
}
