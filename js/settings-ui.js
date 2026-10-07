// ==================== หน้าตั้งค่า (แยกจาก app.js) ====================
// โหลดหลัง app.js (ดู index.html) ทุกอย่างในไฟล์นี้ถูกเรียกหลังหน้าโหลดเสร็จ จึงใช้ตัวแปรของ app.js ได้ตามปกติ

// ==================== SETTINGS ====================
// ฟอร์มตั้งค่าเก็บร่างของแต่ละ provider ไว้ สลับไปมาได้โดยค่าที่พิมพ์ไม่หาย
let settingsFormProvider = 'gemini';
let settingsDrafts = {};

function readProviderDraftFromStorage(provider) {
  return {
    keys: getProviderKeys(provider).join('\n'),
    model: getProviderModel(provider),
    auxModel: getProviderAuxModel(provider),
    baseUrl: getProviderBaseUrl(provider)
  };
}

function stashSettingsForm() {
  // บริการของ Dusktale ไม่มีคีย์/โมเดลให้กรอก
  if (settingsFormProvider === 'dusktale') return;
  settingsDrafts[settingsFormProvider] = {
    keys: document.getElementById('llm-keys-area').value,
    model: document.getElementById('llm-model-input').value.trim(),
    auxModel: document.getElementById('llm-aux-model-input').value.trim(),
    baseUrl: document.getElementById('llm-baseurl-input').value.trim()
  };
}

function getCachedModels(provider) {
  try {
    const cached = JSON.parse(localStorage.getItem(`nov_cached_models_${provider}`) || '[]');
    return Array.isArray(cached) ? cached : [];
  } catch (e) {
    return [];
  }
}

function populateModelSuggestions(provider, modelsList = null) {
  const list = document.getElementById('llm-model-list');
  const models = [...new Set([...(modelsList || getCachedModels(provider)), ...LLM_PROVIDERS[provider].suggestedModels])];
  list.innerHTML = '';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    list.appendChild(opt);
  });
}

function showSettingsForProvider(provider) {
  settingsFormProvider = provider;
  const meta = LLM_PROVIDERS[provider];
  // Dusktale: แสดงกล่องบัญชีแทนช่อง API Key / โมเดล
  const hosted = provider === 'dusktale';
  document.querySelectorAll('#settings-modal .byok-only').forEach(el => { el.hidden = hosted; });
  const hostedBox = document.getElementById('hosted-account-box');
  if (hostedBox) hostedBox.hidden = !hosted;
  if (hosted) {
    document.getElementById('llm-baseurl-group').style.display = 'none';
    if (typeof renderHostedAccountBox === 'function') renderHostedAccountBox();
    return;
  }
  const draft = settingsDrafts[provider] || readProviderDraftFromStorage(provider);

  document.getElementById('llm-keys-label').innerText = `${meta.label} API Keys (คลังคีย์หมุนเวียน)`;
  const keysArea = document.getElementById('llm-keys-area');
  keysArea.value = draft.keys;
  keysArea.placeholder = `วาง API Key (1 คีย์ต่อ 1 บรรทัด)\n${meta.keyHint}\n${meta.keyHint}`;
  const modelInput = document.getElementById('llm-model-input');
  modelInput.value = draft.model;
  document.getElementById('llm-aux-model-input').value = draft.auxModel || '';
  modelInput.placeholder = meta.defaultModel || 'ชื่อโมเดล เช่น ที่ได้จากปุ่มตรวจเช็กโมเดล';
  document.getElementById('llm-baseurl-input').value = draft.baseUrl || meta.defaultBaseUrl || '';
  document.getElementById('llm-baseurl-group').style.display = provider === 'openai' ? 'block' : 'none';
  const reasoningSelect = document.getElementById('llm-reasoning-select');
  if (reasoningSelect) {
    reasoningSelect.innerHTML = REASONING_LEVELS.map(l => `<option value="${l}">${REASONING_LABELS[l]}</option>`).join('');
    reasoningSelect.value = getProviderReasoning('openai');
  }
  document.getElementById('fetch-status-text').style.display = 'none';
  populateModelSuggestions(provider);
}

function onProviderSelectChange() {
  stashSettingsForm();
  showSettingsForProvider(document.getElementById('llm-provider-select').value);
}

function openSettingsModal(tab) {
  settingsDrafts = {};
  const provider = getActiveProvider();
  document.getElementById('llm-provider-select').value = provider;
  showSettingsForProvider(provider);
  // ยังไม่มี API Key: เปิดหมวด AI เสมอ / อื่นๆ เปิดหมวดล่าสุดที่ดู
  let last = null;
  try { last = localStorage.getItem('nov_settings_tab'); } catch (e) {}
  switchSettingsTab(tab || (!hasActiveApiKey() ? 'ai' : last) || 'ai', { remember: false });
  const startSel = document.getElementById('start-page-select');
  if (startSel) startSel.value = getStartPage();
  openModal('settings-modal');
  if (typeof renderPlanBox === 'function') renderPlanBox();
  if (typeof renderCloudSyncBox === 'function') renderCloudSyncBox(true);
  renderSafetySettings();
  renderBookshelfBackupNote();
}

const SETTINGS_TABS = ['ai', 'translate', 'reading', 'data', 'tools'];

/** แถบหมวด (role=tablist): ลูกศรซ้าย/ขวา Home End เลื่อนหมวด แล้วโฟกัสปุ่มหมวดนั้น */
function onTabListKey(e) {
  const tabs = [...e.currentTarget.querySelectorAll('[role="tab"]')];
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const tab = tabs[(next + tabs.length) % tabs.length];
  tab.click();
  tab.focus();
}

function switchSettingsTab(tab, { remember = true } = {}) {
  if (!SETTINGS_TABS.includes(tab)) tab = 'ai';
  document.querySelectorAll('[data-settings-tab]').forEach(b => {
    const on = b.dataset.settingsTab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('[data-settings-panel]').forEach(p => { p.hidden = p.dataset.settingsPanel !== tab; });
  const body = document.querySelector('#settings-modal .settings-body');
  if (body) body.scrollTop = 0;
  if (remember) { try { localStorage.setItem('nov_settings_tab', tab); } catch (e) {} }
}

// รูปแบบคีย์ที่บอกได้ว่าเป็นของผู้ให้บริการไหน (ใช้เตือนเมื่อ Base URL ไม่ตรงกับคีย์)
const KEY_PREFIX_BASE_URLS = [
  { prefix: 'sk-or-', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { prefix: 'gsk_', name: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { prefix: 'xai-', name: 'xAI', url: 'https://api.x.ai/v1' }
];

/** คืน { name, url } ถ้าคีย์เป็นของผู้ให้บริการที่รู้จัก แต่ Base URL ชี้ไปที่อื่น ไม่งั้น null */
function suggestBaseUrlForKey(key, baseUrl) {
  const hit = KEY_PREFIX_BASE_URLS.find(k => String(key || '').startsWith(k.prefix));
  if (!hit) return null;
  try {
    return baseUrl && new URL(baseUrl).host === new URL(hit.url).host ? null : hit;
  } catch (e) {
    return hit;
  }
}

function applySuggestedBaseUrl(url) {
  document.getElementById('llm-baseurl-input').value = url;
  const statusText = document.getElementById('fetch-status-text');
  statusText.style.display = 'block';
  statusText.style.color = 'var(--accent-text)';
  statusText.innerText = 'ใส่ Base URL ให้แล้ว กด "บันทึกการตั้งค่า" แล้วรีโหลดหน้า (ระบบความปลอดภัยอนุญาตปลายทางใหม่ตอนเปิดหน้า) จากนั้นกด "ตรวจเช็กโมเดล" อีกครั้ง';
}

async function fetchLiveModels() {
  const provider = document.getElementById('llm-provider-select').value;
  const firstKey = document.getElementById('llm-keys-area').value.split('\n').map(k => k.trim()).find(k => k.length > 5);
  const baseUrl = document.getElementById('llm-baseurl-input').value.trim();
  const statusText = document.getElementById('fetch-status-text');
  const fetchBtn = document.getElementById('fetch-models-btn');

  if (!firstKey) return appAlert("กรุณากรอก API Key ก่อนกดตรวจเช็กโมเดล");
  // คีย์ของผู้ให้บริการที่รู้รูปแบบ (เช่น OpenRouter sk-or-) แต่ Base URL ยังชี้ไปที่อื่น: คีย์จะถูกส่งผิดที่และถูกปฏิเสธ
  const suggested = provider === 'openai' ? suggestBaseUrlForKey(firstKey, baseUrl) : null;
  if (suggested) {
    statusText.style.display = 'block';
    statusText.style.color = 'var(--warning)';
    statusText.innerHTML = `คีย์นี้เป็นของ <b>${escapeHtml(suggested.name)}</b> แต่ Base URL ยังเป็น ${escapeHtml(baseUrl || '(ว่าง)')} คีย์จะถูกส่งไปผิดที่
      <button class="btn btn-primary" style="padding: 2px 8px; font-size: 11px; margin-left: 4px;" onclick="applySuggestedBaseUrl(${jsArg(suggested.url)})">ใช้ ${escapeHtml(suggested.url)}</button>`;
    return;
  }
  if (provider === 'openai' && baseUrl && !isConnectAllowedByCsp(baseUrl)) {
    statusText.style.display = 'block';
    statusText.style.color = 'var(--warning)';
    statusText.innerText = 'Base URL ใหม่นี้ยังไม่ได้รับอนุญาตในหน้านี้ (ระบบความปลอดภัยจำกัดปลายทางที่ส่งข้อมูลได้) กด "บันทึกการตั้งค่า" แล้วรีโหลดหน้าก่อน จึงจะตรวจเช็กได้';
    return;
  }

  fetchBtn.disabled = true;
  fetchBtn.innerText = "กำลังตรวจเช็ก...";
  statusText.style.display = "block";
  statusText.style.color = 'var(--accent-text)';
  statusText.innerText = `กำลังเชื่อมต่อไปยัง ${LLM_PROVIDERS[provider].label}...`;

  try {
    const availableModels = await listProviderModels(provider, firstKey, baseUrl);
    if (availableModels.length === 0) throw new Error("ไม่พบโมเดลที่พร้อมใช้งานในบัญชีนี้");

    localStorage.setItem(`nov_cached_models_${provider}`, JSON.stringify(availableModels));
    populateModelSuggestions(provider, availableModels);
    const modelInput = document.getElementById('llm-model-input');
    if (!modelInput.value.trim()) modelInput.value = availableModels[0];

    statusText.style.color = 'var(--success)';
    statusText.innerText = `✓ คีย์ใช้งานได้ ตรวจพบโมเดล ${availableModels.length} รุ่น (เลือกได้จากช่องโมเดลด้านล่าง)`;
  } catch (err) {
    statusText.style.color = 'var(--danger)';
    statusText.innerText = "เกิดข้อผิดพลาด: " + err.message;
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.innerText = "ตรวจเช็กโมเดล";
  }
}

async function saveSettings() {
  stashSettingsForm();
  // ต้องเปลี่ยนที่เก็บ key ก่อนบันทึก key ใหม่
  setSessionOnlySecrets(document.getElementById('secrets-session-only').checked);
  localStorage.setItem('nov_backup_remind_days', document.getElementById('backup-remind-days').value);
  Object.entries(settingsDrafts).forEach(([provider, draft]) => {
    if (!LLM_PROVIDERS[provider] || provider === 'dusktale') return;
    const parsedKeys = draft.keys.split('\n').map(k => k.trim()).filter(k => k.length > 5);
    setSecret(`nov_llm_keys_${provider}`, parsedKeys.length ? JSON.stringify(parsedKeys) : '');
    localStorage.setItem(`nov_llm_model_${provider}`, draft.model);
    localStorage.setItem(`nov_llm_aux_model_${provider}`, draft.auxModel || '');
    if (provider === 'openai') localStorage.setItem(`nov_llm_baseurl_${provider}`, draft.baseUrl);
    keyIndexByProvider[provider] = 0;
  });
  const activeProvider = document.getElementById('llm-provider-select').value;
  localStorage.setItem('nov_llm_provider', activeProvider);

  localStorage.setItem('nov_retry_limit', document.getElementById('retry-limit').value || "10");
  localStorage.setItem('nov_enable_deep_ner', document.getElementById('enable-deep-ner-scan').checked ? 'true' : 'false');
  const qualityValue = document.getElementById('quality-mode-select').value;
  // โหมด "ดีที่สุด" ตามแพ็กเกจ: ยังไม่เปิดให้ก็ไม่บันทึกทับค่าเดิม แล้วบอกในข้อความด้านล่าง
  const bestBlocked = qualityValue === 'best' && typeof planAllows === 'function' && !planAllows('bestMode');
  if (!bestBlocked) localStorage.setItem('nov_quality_mode', qualityValue);
  localStorage.setItem('nov_llm_fallback_provider', document.getElementById('llm-fallback-provider').value);
  localStorage.setItem('nov_enable_infinite', document.getElementById('enable-infinite-scroll').checked ? 'true' : 'false');
  localStorage.setItem('nov_enable_prefetch', document.getElementById('enable-live-prefetch').checked ? 'true' : 'false');
  localStorage.setItem('nov_enable_auto_glossary', document.getElementById('enable-auto-glossary').checked ? 'true' : 'false');
  const showJunk = document.getElementById('show-junk-paras').checked;
  localStorage.setItem('nov_show_junk', showJunk ? 'true' : 'false');
  document.body.classList.toggle('show-junk', showJunk);
  localStorage.setItem('nov_export_notes', document.getElementById('export-include-notes').checked ? 'true' : 'false');

  lastPrefetchError = '';
  closeModal('settings-modal');
  renderVirtualWindow(currentChapterIndex, true);

  renderSafetyBanner();
  const cfg = getActiveLlmConfig();
  const mismatch = suggestBaseUrlForKey(getProviderKeys('openai')[0], getProviderBaseUrl('openai'));
  const warning = (bestBlocked ? `\n⚠️ ${describePlanLimit('bestMode')} ตอนนี้จึงแปลด้วยโหมด "สมดุล"` : '') +
    (cfg.model ? '' : '\n⚠️ ยังไม่ได้เลือกโมเดล กรุณากด "ตรวจเช็กโมเดล" แล้วเลือกโมเดลก่อนใช้งาน') +
    (mismatch ? `\n⚠️ คีย์ OpenAI-compatible เป็นของ ${mismatch.name} แต่ Base URL ไม่ใช่ ${mismatch.url} คีย์จะถูกส่งผิดที่ กรุณาแก้ Base URL` : '');
  const openaiBase = getProviderBaseUrl('openai');
  const needsReload = openaiBase && !isConnectAllowedByCsp(openaiBase);
  if (cfg.provider === 'dusktale') {
    appAlert(`บันทึกการตั้งค่าเรียบร้อยแล้ว\nใช้งาน ${LLM_PROVIDERS.dusktale.label}${bestBlocked ? `\n⚠️ ${describePlanLimit('bestMode')} ตอนนี้จึงแปลด้วยโหมด "สมดุล"` : ''}${cfg.keys.length ? '' : '\n⚠️ ยังไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบด้วยอีเมลที่ ตั้งค่า → 🤖 AI ก่อนแปล'}`);
    return;
  }
  appAlert(`บันทึกการตั้งค่าเรียบร้อยแล้ว\nใช้งาน ${LLM_PROVIDERS[cfg.provider].label} (${cfg.model || 'ยังไม่เลือกโมเดล'}) — คลัง API Key ${cfg.keys.length} ตัว${warning}`);
  if (needsReload && await appConfirm(`Base URL ใหม่ (${openaiBase}) จะใช้ได้หลังรีโหลดหน้า เพราะระบบความปลอดภัยอนุญาตปลายทางตอนเปิดหน้าเท่านั้น`, { title: 'รีโหลดหน้า', confirmLabel: 'รีโหลดตอนนี้', cancelLabel: 'ไว้ทีหลัง' })) {
    location.reload();
  }
}

function loadSettings() {
  migrateLegacyLlmSettings();

  if (localStorage.getItem('nov_theme')) {
    const storedTheme = localStorage.getItem('nov_theme');
    currentTheme = ['sepia', 'light', 'dark'].includes(storedTheme) ? storedTheme : 'sepia';
    const body = document.getElementById('app-body');
    ['theme-sepia', 'theme-light', 'theme-dark'].forEach(cls => body.classList.remove(cls));
    body.classList.add('theme-' + currentTheme);
    const themeText = currentTheme === 'sepia' ? 'ถนอมสายตา' : (currentTheme === 'light' ? 'สว่าง' : 'มืด');
    const mobileBtn = document.getElementById('mobile-theme-btn');
    const desktopBtn = document.getElementById('desktop-theme-btn');
    if (mobileBtn) mobileBtn.innerText = themeText;
    if (desktopBtn) desktopBtn.innerText = themeText;
    localStorage.setItem('nov_theme', currentTheme);
  }

  if (localStorage.getItem('nov_font_size')) {
    const storedSize = parseInt(localStorage.getItem('nov_font_size'), 10);
    currentFontSize = Number.isFinite(storedSize) ? Math.min(28, Math.max(14, storedSize)) : 18;
  }

  if (localStorage.getItem('nov_retry_limit')) document.getElementById('retry-limit').value = localStorage.getItem('nov_retry_limit');

  const deepNerChk = document.getElementById('enable-deep-ner-scan');
  if (deepNerChk) deepNerChk.checked = (localStorage.getItem('nov_enable_deep_ner') === 'true');

  const qualitySelect = document.getElementById('quality-mode-select');
  if (qualitySelect) qualitySelect.value = getQualityMode();
  const fallbackSelect = document.getElementById('llm-fallback-provider');
  if (fallbackSelect) fallbackSelect.value = getFallbackProvider();

  const prefetchChk = document.getElementById('enable-live-prefetch');
  if (prefetchChk) prefetchChk.checked = (localStorage.getItem('nov_enable_prefetch') !== 'false');

  const infiniteChk = document.getElementById('enable-infinite-scroll');
  if (infiniteChk) infiniteChk.checked = (localStorage.getItem('nov_enable_infinite') !== 'false');

  const autoGlossChk = document.getElementById('enable-auto-glossary');
  if (autoGlossChk) autoGlossChk.checked = (localStorage.getItem('nov_enable_auto_glossary') !== 'false');

  const showJunk = localStorage.getItem('nov_show_junk') === 'true';
  document.body.classList.toggle('show-junk', showJunk);
  const showJunkChk = document.getElementById('show-junk-paras');
  if (showJunkChk) showJunkChk.checked = showJunk;
  const exportNotesChk = document.getElementById('export-include-notes');
  if (exportNotesChk) exportNotesChk.checked = localStorage.getItem('nov_export_notes') === 'true';
}

