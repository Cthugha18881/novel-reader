// ==================== สำรอง/นำเข้าข้อมูล และความปลอดภัยของข้อมูล (แยกจาก app.js; ตัวจัดการอยู่ใน safety.js / db.js) ====================
// โหลดหลัง app.js (ดู index.html) ทุกอย่างในไฟล์นี้ถูกเรียกหลังหน้าโหลดเสร็จ จึงใช้ตัวแปรของ app.js ได้ตามปกติ

// ==================== BACKUP ====================
async function exportBackup() {
  try {
    await downloadBackupFile();
    renderSafetyBanner();
    renderBookshelfBackupNote();
  } catch (err) {
    appAlert(`สำรองข้อมูลไม่สำเร็จ: ${err.message}`);
  }
}

function triggerBackupImport() {
  document.getElementById('backup-file-input').click();
}

let pendingBackupImport = null;

async function handleBackupFileSelected(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (e) {
    return appAlert('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูล JSON ที่ถูกต้อง');
  }
  if (!isValidBackup(raw)) return appAlert('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของ Dusktale (หรือ NovelTranslate เดิม) หรือมาจากแอพรุ่นที่ใหม่กว่า');

  const data = upgradeBackup(raw);
  pendingBackupImport = { raw, data, settings: splitImportedSettings(data.settings), fileName: file.name };
  renderBackupImportModal(await dbCountAll());
  openModal('backup-import-modal');
}

function renderBackupImportModal(current) {
  const { data, settings, fileName } = pendingBackupImport;
  const dropped = Object.values(data.dropped).reduce((a, b) => a + b, 0);
  const exportedAt = data.exportedAt && !isNaN(new Date(data.exportedAt)) ? new Date(data.exportedAt).toLocaleString('th-TH') : '';
  const row = (label, name) => `<tr><td>${label}</td><td>${(current[name] || 0).toLocaleString()}</td><td>${data[name].length.toLocaleString()}</td></tr>`;
  document.getElementById('backup-import-summary').innerHTML = `
    <div style="margin-bottom: 6px;">ไฟล์: <b>${escapeHtml(fileName)}</b>${exportedAt ? ` · สำรองเมื่อ ${escapeHtml(exportedAt)}` : ''}</div>
    <table class="backup-compare-table">
      <thead><tr><th></th><th>ในเครื่องนี้</th><th>ในไฟล์</th></tr></thead>
      <tbody>${row('นิยาย (เรื่อง)', 'books')}${row('ตอน', 'chapters')}${row('คำศัพท์', 'glossaries')}${row('คู่มือเรื่อง / สารบัญ', 'bookData')}${row('สถิติการใช้ AI', 'usage')}${row('ฉบับแปลก่อนหน้า (ประวัติเวอร์ชัน)', 'chapterVersions')}</tbody>
    </table>
    ${dropped ? `<div style="color: var(--warning); margin-top: 6px;">⚠️ จะข้ามข้อมูลที่เสียหรือรูปแบบไม่ถูกต้อง ${dropped.toLocaleString()} รายการ</div>` : ''}`;

  const settingsCount = Object.keys(settings.safe).length;
  document.getElementById('backup-import-settings-row').style.display = settingsCount ? 'flex' : 'none';
  document.getElementById('backup-import-settings').checked = settingsCount > 0;
  document.getElementById('backup-import-settings-count').innerText = settingsCount;
  document.getElementById('backup-import-baseurl-row').style.display = settings.baseUrl ? 'flex' : 'none';
  document.getElementById('backup-import-baseurl').checked = false;
  document.getElementById('backup-import-baseurl-value').innerText = settings.baseUrl || '';
  document.getElementById('backup-import-proxies-row').style.display = settings.proxies ? 'flex' : 'none';
  document.getElementById('backup-import-proxies').checked = false;
  document.getElementById('backup-import-proxies-value').innerText = (settings.proxies || []).map(p => p.url).join(', ');
  document.querySelector('input[name="backup-import-mode"][value="merge"]').checked = true;
  document.getElementById('backup-import-safety').checked = true;
  onBackupImportModeChange();
}

function getBackupImportMode() {
  return document.querySelector('input[name="backup-import-mode"]:checked')?.value === 'replace' ? 'replace' : 'merge';
}

function onBackupImportModeChange() {
  document.getElementById('backup-import-replace-box').style.display = getBackupImportMode() === 'replace' ? 'block' : 'none';
}

async function confirmBackupImport() {
  if (!pendingBackupImport) return;
  const mode = getBackupImportMode();
  if (mode === 'replace' && !(await appConfirm('นิยาย ตอน คลังศัพท์ และคู่มือเรื่องทั้งหมดในเครื่องนี้จะถูกลบ แล้วแทนด้วยข้อมูลจากไฟล์', { title: 'แทนที่ข้อมูลทั้งหมด', confirmLabel: 'ลบแล้วแทนที่', danger: true }))) return;

  const btn = document.getElementById('backup-import-confirm-btn');
  btn.disabled = true;
  try {
    abortAllRunningProcesses();
    if (mode === 'replace' && document.getElementById('backup-import-safety').checked) {
      await downloadBackupFile('dusktale-before-replace');
    }
    const { raw, settings } = pendingBackupImport;
    await dbImportAll(raw, { mode });

    const applySettings = document.getElementById('backup-import-settings').checked;
    const applyBaseUrl = !!settings.baseUrl && document.getElementById('backup-import-baseurl').checked;
    const applyProxies = !!settings.proxies && document.getElementById('backup-import-proxies').checked;
    applyImportedSettings(applySettings ? settings.safe : {}, { baseUrl: applyBaseUrl ? settings.baseUrl : null, proxies: applyProxies ? settings.proxies : null });
    if (applySettings) loadSettings();

    await refreshInMemoryGlossaryCache();
    pendingBackupImport = null;
    closeModal('backup-import-modal');

    const books = await dbGetAllBooks();
    const lastId = localStorage.getItem('nov_last_book_id');
    const targetBookId = books.some(b => b.bookId === lastId) ? lastId : books[0]?.bookId;
    if (targetBookId) await loadBookFromDB(targetBookId);
    else resetToGuideBook();
    homeCoverCache.clear();
    await openBookshelfModal();

    const needsReload = (applyBaseUrl && !isConnectAllowedByCsp(settings.baseUrl)) ||
      (applyProxies && settings.proxies.some(p => !isConnectAllowedByCsp(p.url)));
    appAlert(`✓ นำเข้าข้อมูลสำรองเรียบร้อยแล้ว (${mode === 'replace' ? 'แทนที่ทั้งหมด' : 'รวมกับของเดิม'})` +
      (needsReload ? '\n\nBase URL / proxy ใหม่จะใช้ได้หลังรีโหลดหน้า' : ''));
  } catch (err) {
    appAlert(`นำเข้าข้อมูลไม่สำเร็จ (ข้อมูลเดิมไม่ถูกแก้ไข): ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

function cancelBackupImport() {
  pendingBackupImport = null;
  closeModal('backup-import-modal');
}

// ==================== DATA SAFETY UI ====================
let dbOutdatedInThisTab = false;
let remoteReplacedData = false;

function formatAgo(ts) {
  if (!ts) return 'ยังไม่เคย';
  const days = Math.floor((Date.now() - ts) / DAY_MS);
  if (days >= 1) return `${days} วันที่แล้ว`;
  const hours = Math.floor((Date.now() - ts) / 3600000);
  return hours >= 1 ? `${hours} ชั่วโมงที่แล้ว` : 'เมื่อสักครู่';
}

/** แถบแจ้งเตือนด้านบนหน้าอ่าน: ฐานข้อมูลถูกอัปเกรดจากแท็บอื่น > ข้อมูลถูกแทนที่จากแท็บอื่น > เตือนสำรองข้อมูล */
async function renderSafetyBanner() {
  const banner = document.getElementById('safety-banner');
  if (!banner) return;
  let html = '';
  if (dbOutdatedInThisTab) {
    html = `<span>⚠️ มีแท็บอื่นเปิดแอพรุ่นใหม่กว่า แท็บนี้หยุดบันทึกข้อมูลแล้ว</span>
      <button class="btn btn-primary" onclick="location.reload()">รีโหลดหน้า</button>`;
  } else if (remoteReplacedData) {
    html = `<span>⚠️ ข้อมูลทั้งหมดถูกแทนที่จากไฟล์สำรองในอีกแท็บ</span>
      <button class="btn btn-primary" onclick="location.reload()">รีโหลดหน้า</button>`;
  } else if (profileWarningHost) {
    html = `<span>🌐 โปรไฟล์ของเว็บ <b>${escapeHtml(profileWarningHost)}</b> หาเนื้อหาไม่เจอติดกันหลายครั้ง เว็บอาจเปลี่ยนหน้าตา (ระบบใช้ตัวดึงแบบกลางแทนไปก่อน)</span>
      <button class="btn btn-primary" onclick="profileWarningHost = ''; renderSafetyBanner(); openSiteProfilesModal();">ตรวจโปรไฟล์</button>
      <button class="btn" onclick="profileWarningHost = ''; renderSafetyBanner();">ปิด</button>`;
  } else if (budgetBannerText) {
    html = `<span>📊 ${escapeHtml(budgetBannerText)}</span>
      <button class="btn btn-primary" onclick="openUsageModal()">ดูการใช้งาน</button>
      <button class="btn" onclick="dismissBudgetBanner()">ปิด</button>`;
  } else {
    const state = getBackupReminderState();
    if (state.shouldRemind && (await dbGetAllBooks()).length) {
      const hasFolder = !!(await getAutoBackupDir());
      const ios = isIosDevice() && !isInstalledApp() ? ' · บน iPhone/iPad ข้อมูลอาจถูกลบถ้าไม่ได้เปิดแอพ 7 วัน แนะนำให้ "เพิ่มลงหน้าจอโฮม"' : '';
      html = `<span>💾 ${state.lastBackup ? `ไม่ได้สำรองข้อมูลมา ${state.daysSinceBackup} วัน` : 'ยังไม่เคยสำรองข้อมูล'} และมีข้อมูลใหม่ที่ยังไม่ได้สำรอง${ios}</span>
        <button class="btn btn-primary" onclick="backupNowFromBanner()">${hasFolder ? '💾 สำรองลงโฟลเดอร์' : '⬇️ สำรองตอนนี้'}</button>
        <button class="btn" onclick="snoozeBackupReminder(1); renderSafetyBanner();">เตือนพรุ่งนี้</button>`;
    }
  }
  banner.innerHTML = html;
  banner.style.display = html ? 'flex' : 'none';
}

async function backupNowFromBanner() {
  try {
    if (await getAutoBackupDir()) {
      const result = await runAutoBackup({ interactive: true });
      if (result !== 'done') await downloadBackupFile();
    } else {
      await downloadBackupFile();
    }
    showGlobalToast('✓ สำรองข้อมูลแล้ว');
    setTimeout(hideGlobalToast, 1800);
  } catch (err) {
    appAlert(`สำรองข้อมูลไม่สำเร็จ: ${err.message}`);
  }
  renderSafetyBanner();
  renderBookshelfBackupNote();
}

function renderBookshelfBackupNote() {
  const el = document.getElementById('bookshelf-backup-note');
  if (!el) return;
  const state = getBackupReminderState();
  el.innerText = `สำรองครั้งล่าสุด: ${formatAgo(state.lastBackup)}${state.hasUnsaved ? ' · มีข้อมูลใหม่ที่ยังไม่ได้สำรอง' : ''}`;
  el.style.color = state.shouldRemind ? 'var(--warning)' : '';
}

/** ส่วน "ข้อมูลและความปลอดภัย" ในหน้าตั้งค่า */
async function renderSafetySettings() {
  const st = await getStorageStatus();
  const statusEl = document.getElementById('storage-status');
  const persistBtn = document.getElementById('persist-storage-btn');
  const lines = [];
  if (st.persisted === true) lines.push('✅ พื้นที่จัดเก็บแบบถาวร (เบราว์เซอร์จะไม่ลบข้อมูลเองเมื่อพื้นที่ใกล้เต็ม)');
  else if (st.persisted === false) lines.push('⚠️ พื้นที่จัดเก็บยังไม่ถาวร เบราว์เซอร์อาจลบข้อมูลเองเมื่อพื้นที่เครื่องใกล้เต็ม');
  else lines.push('เบราว์เซอร์นี้ไม่บอกสถานะพื้นที่จัดเก็บ');
  if (st.usage !== null) lines.push(`ใช้พื้นที่ไป ${formatBytes(st.usage)}${st.quota ? ` จากที่ใช้ได้ประมาณ ${formatBytes(st.quota)}` : ''}`);
  if (st.iosNotInstalled) lines.push('⚠️ บน iPhone/iPad ถ้าไม่ได้ "เพิ่มลงหน้าจอโฮม" Safari อาจลบข้อมูลเมื่อไม่ได้เปิดแอพ 7 วัน');
  lines.push(`สำรองครั้งล่าสุด: ${formatAgo(readTimestamp('nov_last_backup_at'))}`);
  statusEl.innerHTML = lines.map(l => `<div>${escapeHtml(l)}</div>`).join('');
  persistBtn.style.display = st.persisted === false ? 'inline-flex' : 'none';

  document.getElementById('backup-remind-days').value = String(getBackupRemindDays());
  document.getElementById('secrets-session-only').checked = isSessionOnlySecrets();
  await renderAutoBackupSettings();
}

async function renderAutoBackupSettings() {
  const statusEl = document.getElementById('auto-backup-status');
  const actionsEl = document.getElementById('auto-backup-actions');
  if (!isAutoBackupSupported()) {
    statusEl.innerText = 'เบราว์เซอร์นี้ไม่รองรับ (ใช้ได้กับ Chrome / Edge บนคอมพิวเตอร์) ใช้ปุ่ม "สำรองข้อมูลทั้งหมด" ที่ชั้นหนังสือแทน และระบบจะเตือนเมื่อถึงเวลาสำรอง';
    actionsEl.innerHTML = '';
    return;
  }
  const dir = await getAutoBackupDir();
  if (!dir) {
    statusEl.innerText = 'ยังไม่ได้เลือกโฟลเดอร์ เมื่อเลือกแล้ว ระบบจะบันทึกไฟล์สำรองลงโฟลเดอร์นั้นเองเมื่อมีข้อมูลใหม่ (เก็บไว้ 5 ไฟล์ล่าสุด)';
    actionsEl.innerHTML = `<button class="btn btn-secondary" onclick="setupAutoBackupFolder()">📁 เลือกโฟลเดอร์สำรอง</button>`;
    return;
  }
  statusEl.innerText = `โฟลเดอร์: ${dir.name} · สำรองอัตโนมัติครั้งล่าสุด: ${formatAgo(readTimestamp('nov_last_auto_backup_at'))} (เก็บไว้ 5 ไฟล์ล่าสุด หลังเปิดเบราว์เซอร์ใหม่อาจต้องกดอนุญาตอีกครั้ง)`;
  actionsEl.innerHTML = `
    <button class="btn btn-secondary" onclick="runAutoBackupFromSettings()">💾 สำรองตอนนี้</button>
    <button class="btn" onclick="setupAutoBackupFolder()">เปลี่ยนโฟลเดอร์</button>
    <button class="btn btn-danger" onclick="stopAutoBackup()">เลิกใช้</button>`;
}

async function setupAutoBackupFolder() {
  try {
    await chooseAutoBackupFolder();
    const result = await runAutoBackup({ interactive: true });
    if (result === 'done') appAlert('✓ ตั้งค่าโฟลเดอร์และสำรองข้อมูลครั้งแรกเรียบร้อย');
  } catch (err) {
    if (err?.name !== 'AbortError') appAlert(`ตั้งค่าโฟลเดอร์สำรองไม่สำเร็จ: ${err.message}`);
  }
  await renderAutoBackupSettings();
  renderSafetyBanner();
}

async function runAutoBackupFromSettings() {
  try {
    const result = await runAutoBackup({ interactive: true });
    if (result === 'needs-permission') appAlert('ยังไม่ได้รับอนุญาตให้เขียนโฟลเดอร์ กรุณากดอนุญาตเมื่อเบราว์เซอร์ถาม');
    else if (result === 'done') appAlert('✓ สำรองข้อมูลลงโฟลเดอร์แล้ว');
  } catch (err) {
    appAlert(`สำรองไม่สำเร็จ: ${err.message}`);
  }
  await renderAutoBackupSettings();
  renderSafetyBanner();
}

async function stopAutoBackup() {
  await disableAutoBackup();
  await renderAutoBackupSettings();
}

async function requestPersistFromSettings() {
  const ok = await requestPersistentStorage();
  if (!ok) appAlert('เบราว์เซอร์ยังไม่อนุญาตพื้นที่ถาวร (Chrome จะอนุญาตเองเมื่อใช้งานบ่อยหรือติดตั้งเป็นแอพ) แนะนำให้สำรองข้อมูลเป็นระยะ');
  await renderSafetySettings();
}

async function clearAllApiKeys() {
  if (!(await appConfirm('API Key ของผู้ให้บริการ AI ทุกเจ้าและ Jina Key จะถูกลบออกจากเบราว์เซอร์นี้ (นิยายและการตั้งค่าอื่นยังอยู่ครบ)', { title: 'ลบ API Key ทั้งหมด', confirmLabel: 'ลบ API Key', danger: true }))) return;
  clearAllSecrets();
  settingsDrafts = {};
  showSettingsForProvider(document.getElementById('llm-provider-select').value);
  appAlert('ลบ API Key ทั้งหมดแล้ว');
}

