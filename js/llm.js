// ==================== LLM PROVIDER LAYER ====================
// จุดเดียวที่คุยกับ AI ทุกเจ้า: เลือก provider, หมุนคีย์, retry, ตรวจผลถูกตัด และยกเลิกงาน

const LLM_PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    keyHint: 'AIzaSy...',
    defaultModel: 'gemini-3.5-flash-lite',
    suggestedModels: ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-2.5-flash']
  },
  anthropic: {
    label: 'Anthropic Claude',
    keyHint: 'sk-ant-...',
    defaultModel: 'claude-opus-5-5',
    suggestedModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-fable-5-1']
  },
  openai: {
    label: 'OpenAI / OpenAI-compatible',
    keyHint: 'sk-...',
    defaultModel: '',
    defaultBaseUrl: 'https://api.openai.com/v1',
    suggestedModels: []
  }
};

// โมเดล Claude ที่รองรับ server-side fallback เมื่อ safety classifier ปฏิเสธคำขอ
const ANTHROPIC_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

const keyIndexByProvider = {};

class LLMError extends Error {
  // kind: auth | rate | server | network | truncated | blocked | bad_request | empty | abort | config | model | budget
  constructor(message, kind, status = 0) {
    super(message);
    this.name = 'LLMError';
    this.kind = kind;
    this.status = status;
  }
}

function isAbortError(err) {
  return err?.name === 'AbortError' || err?.kind === 'abort';
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new LLMError('ผู้ใช้สั่งหยุดการทำงาน', 'abort');
}

function sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LLMError('ผู้ใช้สั่งหยุดการทำงาน', 'abort'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LLMError('ผู้ใช้สั่งหยุดการทำงาน', 'abort'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------- Task registry: แต่ละงานมี AbortController ของตัวเอง ----------
const runningTasks = new Map();

function beginTask(name) {
  abortTask(name);
  const controller = new AbortController();
  runningTasks.set(name, controller);
  if (typeof tagTask === 'function') tagTask(controller.signal, { task: name });
  return controller;
}

function endTask(name, controller) {
  if (runningTasks.get(name) === controller) runningTasks.delete(name);
}

function abortTask(name) {
  const controller = runningTasks.get(name);
  if (controller) {
    controller.abort();
    runningTasks.delete(name);
  }
}

function abortAllTasks() {
  runningTasks.forEach(controller => controller.abort());
  runningTasks.clear();
}

function isTaskRunning(name) {
  return runningTasks.has(name);
}

// ---------- ใช้โมเดลอื่นเฉพาะงานหนึ่ง (เทียบโมเดล) ----------
// ผูกกับ signal ของงาน: ทุกคำขอในงานนั้น (แปล/ตรวจทาน/เกลา) ใช้ผู้ให้บริการ+โมเดลนี้ ไม่แตะการตั้งค่าหลัก
const modelOverrides = new WeakMap();

function setModelOverride(signal, override) {
  if (signal && override?.provider && override?.model) modelOverrides.set(signal, override);
}

function getModelOverride(signal) {
  return signal ? modelOverrides.get(signal) || null : null;
}

// ---------- Settings ----------
function migrateLegacyLlmSettings() {
  if (localStorage.getItem('nov_llm_provider')) return;
  try {
    const legacyPool = JSON.parse(localStorage.getItem('nov_gemini_keys_pool') || 'null');
    const legacySingle = (localStorage.getItem('nov_gemini_key') || '').trim();
    const keys = Array.isArray(legacyPool) && legacyPool.length ? legacyPool : (legacySingle ? [legacySingle] : []);
    if (keys.length) setSecret('nov_llm_keys_gemini', JSON.stringify(keys));
    localStorage.removeItem('nov_gemini_keys_pool');
    localStorage.removeItem('nov_gemini_key');
  } catch (e) {}
  const legacyModel = localStorage.getItem('nov_primary_model');
  if (legacyModel) localStorage.setItem('nov_llm_model_gemini', legacyModel);
  localStorage.setItem('nov_llm_provider', 'gemini');
}

function getActiveProvider() {
  const p = localStorage.getItem('nov_llm_provider');
  return LLM_PROVIDERS[p] ? p : 'gemini';
}

function getProviderKeys(provider) {
  try {
    const keys = JSON.parse(getSecret(`nov_llm_keys_${provider}`) || '[]');
    return Array.isArray(keys) ? keys.filter(k => typeof k === 'string' && k.trim().length > 5).map(k => k.trim()) : [];
  } catch (e) {
    return [];
  }
}

function getProviderModel(provider) {
  return (localStorage.getItem(`nov_llm_model_${provider}`) || LLM_PROVIDERS[provider].defaultModel || '').trim();
}

function getProviderBaseUrl(provider) {
  const raw = (localStorage.getItem(`nov_llm_baseurl_${provider}`) || LLM_PROVIDERS[provider].defaultBaseUrl || '').trim();
  return raw.replace(/\/+$/, '');
}

// โมเดลสำหรับงานรอง (สแกนคำศัพท์/ตรวจทาน/ตรวจความหมาย) ว่างไว้ = ใช้โมเดลหลัก
function getProviderAuxModel(provider) {
  return (localStorage.getItem(`nov_llm_aux_model_${provider}`) || '').trim();
}

/** ผู้ให้บริการสำรองเมื่อ AI หลักปฏิเสธเนื้อหา (ว่าง = ไม่ใช้) */
function getFallbackProvider() {
  const p = localStorage.getItem('nov_llm_fallback_provider');
  return LLM_PROVIDERS[p] ? p : '';
}

/**
 * @param {'main'|'aux'} role งานแปล/เกลาใช้ main, งานตรวจและสกัดข้อมูลใช้ aux
 * @param {string} [providerOverride] ใช้ผู้ให้บริการอื่นแทนตัวหลัก (ใช้ตอนส่งต่อให้ผู้ให้บริการสำรอง)
 */
function getActiveLlmConfig(role = 'main', providerOverride = '') {
  const provider = LLM_PROVIDERS[providerOverride] ? providerOverride : getActiveProvider();
  const mainModel = getProviderModel(provider);
  const auxModel = getProviderAuxModel(provider);
  return {
    provider,
    keys: getProviderKeys(provider),
    model: role === 'aux' && auxModel ? auxModel : mainModel,
    mainModel,
    auxModel,
    baseUrl: getProviderBaseUrl(provider)
  };
}

function hasActiveApiKey() {
  return getActiveLlmConfig().keys.length > 0;
}

function currentKeyLabel(cfg) {
  if (cfg.keys.length <= 1) return '';
  return ` (คีย์ #${(keyIndexByProvider[cfg.provider] || 0) + 1}/${cfg.keys.length})`;
}

function pickKey(cfg) {
  const idx = (keyIndexByProvider[cfg.provider] || 0) % cfg.keys.length;
  return cfg.keys[idx];
}

function rotateKey(cfg) {
  if (cfg.keys.length > 1) {
    keyIndexByProvider[cfg.provider] = ((keyIndexByProvider[cfg.provider] || 0) + 1) % cfg.keys.length;
    console.log(`[KeyPool] ${cfg.provider} rotated to key #${keyIndexByProvider[cfg.provider] + 1}/${cfg.keys.length}`);
  }
}

function getRetryLimit() {
  const configured = parseInt(localStorage.getItem('nov_retry_limit') || '10', 10);
  return Number.isFinite(configured) ? Math.min(50, Math.max(1, configured)) : 10;
}

// ---------- HTTP helpers ----------
async function readJsonSafe(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { _raw: text }; }
}

function errorFromStatus(status, message) {
  const msg = message || `HTTP ${status}`;
  if (status === 401 || status === 403) return new LLMError(`API Key ไม่ถูกต้องหรือไม่มีสิทธิ์: ${msg}`, 'auth', status);
  if (status === 429) return new LLMError(`โควต้าเต็ม / ติด Rate Limit: ${msg}`, 'rate', status);
  if (status === 408 || status === 409 || status >= 500) return new LLMError(`เซิร์ฟเวอร์ AI ไม่พร้อม (${status}): ${msg}`, 'server', status);
  return new LLMError(`คำขอไม่ถูกต้อง (${status}): ${msg}`, 'bad_request', status);
}

/**
 * โมเดลไม่มีอยู่/ถูกยกเลิก (เช่นผู้ให้บริการปลดโมเดลรุ่นเก่า): แยกออกมาให้ผู้ใช้รู้ว่าต้องเลือกโมเดลใหม่ ไม่ใช่ลองซ้ำ
 * Gemini: 404 "models/x is not found" | Claude: 404 not_found_error "model: x" | OpenAI: 404 "The model `x` does not exist"
 */
function classifyModelError(err, model) {
  if (!(err instanceof LLMError)) return err;
  const msg = err.message || '';
  const mentionsModel = /model/i.test(msg);
  const retired = /deprecat|decommission|no longer (available|supported)|has been (retired|shut down)|retired/i.test(msg);
  if ((err.status === 404 && mentionsModel) || (mentionsModel && retired && [400, 404, 410].includes(err.status))) {
    return new LLMError(`ไม่พบโมเดล "${model}" หรือโมเดลนี้ถูกยกเลิกแล้ว กรุณากด "ตรวจเช็กโมเดล" ในหน้าตั้งค่าแล้วเลือกโมเดลใหม่ (${msg.slice(0, 160)})`, 'model', err.status);
  }
  return err;
}

async function guardedFetch(url, options) {
  // CSP (csp.js) อนุญาตเฉพาะปลายทางที่ตั้งไว้ตอนเปิดหน้า ถ้าเพิ่งเปลี่ยน Base URL ต้องรีโหลดก่อน
  if (typeof isConnectAllowedByCsp === 'function' && !isConnectAllowedByCsp(url)) {
    throw new LLMError('ปลายทาง API นี้ยังไม่ได้รับอนุญาตในหน้านี้ (เพิ่งเปลี่ยน Base URL) กรุณารีโหลดหน้าแล้วลองใหม่', 'config');
  }
  try {
    return await fetch(url, options);
  } catch (err) {
    if (err?.name === 'AbortError') throw new LLMError('ผู้ใช้สั่งหยุดการทำงาน', 'abort');
    throw new LLMError(`เชื่อมต่อ AI ไม่ได้: ${err.message}`, 'network');
  }
}

// ---------- Structured output schemas ----------
// schema เขียนเป็น JSON Schema มาตรฐาน (object ต้องมี additionalProperties:false และ required ครบ)
// แล้วแปลงให้เข้ากับรูปแบบของแต่ละ provider; ถ้า provider ปฏิเสธ schema จะลองใหม่แบบไม่มี schema

function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  if (schema.type) out.type = String(schema.type).toUpperCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties) {
    out.properties = {};
    Object.entries(schema.properties).forEach(([k, v]) => { out.properties[k] = toGeminiSchema(v); });
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.required) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  return out;
}

function isSchemaRejection(err) {
  return err?.kind === 'bad_request' && /schema|response_format|output_config|responseSchema|json_schema|propertyOrdering|format/i.test(err.message || '');
}

// ---------- Providers ----------
async function callGeminiOnce(cfg, key, prompt, opts, signal) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const generationConfig = {};
  if (opts.json) generationConfig.response_mime_type = 'application/json';
  if (opts.json && opts.schema) generationConfig.responseSchema = toGeminiSchema(opts.schema);
  const res = await guardedFetch(endpoint, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig
    })
  });
  const data = await readJsonSafe(res);
  if (!res.ok) {
    const err = classifyModelError(errorFromStatus(res.status, data.error?.message || data._raw?.slice(0, 200)), cfg.model);
    if (opts.schema && isSchemaRejection(err)) return callGeminiOnce(cfg, key, prompt, { ...opts, schema: null }, signal);
    throw err;
  }

  // Gemini: promptTokenCount รวมส่วนที่อ่านจาก cache แล้ว, token ที่ใช้คิด (thoughts) คิดเงินแบบ output
  const um = data.usageMetadata;
  if (um && opts.onUsage) opts.onUsage({ input: um.promptTokenCount || 0, output: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0), cacheRead: um.cachedContentTokenCount || 0, raw: um });

  const blockReason = data.promptFeedback?.blockReason;
  if (blockReason) throw new LLMError(`คำขอถูกบล็อกโดยระบบความปลอดภัย (${blockReason})`, 'blocked');

  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
  const reason = candidate?.finishReason || '';
  if (reason === 'MAX_TOKENS') throw new LLMError('ผลลัพธ์ยาวเกินขีดจำกัดของโมเดลและถูกตัดกลางคัน', 'truncated');
  if (['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(reason)) {
    throw new LLMError(`โมเดลปฏิเสธการตอบ (${reason})`, 'blocked');
  }
  if (!text) throw new LLMError(reason ? `โมเดลไม่ส่งข้อความกลับมา (${reason})` : 'โมเดลไม่ส่งข้อความกลับมา', 'empty');
  return text;
}

async function callAnthropicOnce(cfg, key, prompt, opts, signal, useFallbacks = true) {
  const withFallbacks = useFallbacks && ANTHROPIC_FALLBACK_MODELS.has(cfg.model);
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  };
  if (withFallbacks) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';

  const body = {
    model: cfg.model,
    max_tokens: 64000,
    stream: true,
    messages: [{ role: 'user', content: prompt }]
  };
  // ส่วนคำสั่งที่ไม่เปลี่ยนระหว่างส่วนของตอน/ระหว่างตอน: ให้ Claude cache ไว้ (คิดราคาถูกลงมากเมื่ออ่านซ้ำภายในไม่กี่นาที)
  if (opts.system) body.system = [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }];
  if (withFallbacks) body.fallbacks = 'default';
  if (opts.json && opts.schema) body.output_config = { format: { type: 'json_schema', schema: opts.schema } };

  const res = await guardedFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal, headers, body: JSON.stringify(body)
  });
  if (!res.ok) {
    const data = await readJsonSafe(res);
    const msg = data.error?.message || data._raw?.slice(0, 200);
    if (withFallbacks && res.status === 400 && /fallback/i.test(msg || '')) {
      return callAnthropicOnce(cfg, key, prompt, opts, signal, false);
    }
    if (data.error?.type === 'overloaded_error') throw new LLMError(`เซิร์ฟเวอร์ Claude หนาแน่น: ${msg}`, 'server', res.status);
    const err = classifyModelError(errorFromStatus(res.status, msg), cfg.model);
    if (opts.schema && isSchemaRejection(err)) return callAnthropicOnce(cfg, key, prompt, { ...opts, schema: null }, signal, useFallbacks);
    throw err;
  }

  // อ่าน SSE stream: ข้อความอาจมาหลาย text block (เช่นหลัง fallback) จึงต่อกันทั้งหมด
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stopReason = '';
  // Claude: input_tokens ไม่รวม token ที่อ่าน/เขียน cache จึงต้องบวกเพิ่ม, output_tokens ใน message_delta เป็นยอดสะสม
  const rawUsage = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 };
  let servedModel = '';
  const takeUsage = (u) => {
    if (!u) return;
    Object.keys(rawUsage).forEach(k => { if (Number.isFinite(u[k])) rawUsage[k] = u[k]; });
  };
  const buildUsage = () => ({
    input: rawUsage.input_tokens + rawUsage.cache_read_input_tokens + rawUsage.cache_creation_input_tokens,
    output: rawUsage.output_tokens,
    cacheRead: rawUsage.cache_read_input_tokens,
    cacheWrite: rawUsage.cache_creation_input_tokens,
    model: servedModel,
    raw: { ...rawUsage }
  });
  const handleEvent = (raw) => {
    const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
    if (!dataLine) return;
    let evt;
    try { evt = JSON.parse(dataLine.slice(5).trim()); } catch (e) { return; }
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') text += evt.delta.text;
    else if (evt.type === 'message_start') {
      takeUsage(evt.message?.usage);
      if (evt.message?.model) servedModel = evt.message.model;
    } else if (evt.type === 'message_delta') {
      if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
      takeUsage(evt.usage);
    }
    else if (evt.type === 'error') {
      const t = evt.error?.type;
      const m = evt.error?.message || t || 'stream error';
      if (t === 'overloaded_error' || t === 'api_error') throw new LLMError(`เซิร์ฟเวอร์ Claude หนาแน่น: ${m}`, 'server');
      if (t === 'rate_limit_error') throw new LLMError(`โควต้าเต็ม: ${m}`, 'rate');
      throw new LLMError(m, 'bad_request');
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        handleEvent(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
      }
    }
    if (buffer.trim()) handleEvent(buffer);
  } catch (err) {
    if (err?.name === 'AbortError') throw new LLMError('ผู้ใช้สั่งหยุดการทำงาน', 'abort');
    if (err instanceof LLMError) throw err;
    throw new LLMError(`การเชื่อมต่อหลุดระหว่างรับผล: ${err.message}`, 'network');
  } finally {
    // คิดเงินตาม token ที่ส่ง/รับไปแล้ว แม้ stream จะหลุดหรือถูกตัดกลางคัน
    const usage = buildUsage();
    if (opts.onUsage && (usage.input || usage.output)) opts.onUsage(usage);
  }

  if (stopReason === 'refusal') throw new LLMError('Claude ปฏิเสธคำขอนี้ (refusal)', 'blocked');
  if (stopReason === 'max_tokens') throw new LLMError('ผลลัพธ์ยาวเกินขีดจำกัดของโมเดลและถูกตัดกลางคัน', 'truncated');
  if (!text) throw new LLMError('โมเดลไม่ส่งข้อความกลับมา', 'empty');
  return text;
}

// jsonMode: 'schema' -> 'object' -> 'none' (ลดระดับเมื่อ provider ที่เข้ากันได้กับ OpenAI ไม่รองรับ)
async function callOpenAIOnce(cfg, key, prompt, opts, signal, jsonMode = null) {
  if (!cfg.baseUrl) throw new LLMError('กรุณาระบุ Base URL ของ API', 'config');
  const mode = jsonMode || (!opts.json ? 'none' : (opts.schema ? 'schema' : 'object'));
  const body = {
    model: cfg.model,
    messages: opts.system
      ? [{ role: 'system', content: opts.system }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }]
  };
  if (mode === 'schema') body.response_format = { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: opts.schema } };
  else if (mode === 'object') body.response_format = { type: 'json_object' };

  const res = await guardedFetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const data = await readJsonSafe(res);
  if (!res.ok) {
    const msg = data.error?.message || data._raw?.slice(0, 200);
    // บาง provider ที่เข้ากันได้กับ OpenAI ไม่รองรับ response_format บางแบบ
    if (body.response_format && res.status === 400 && /response_format|json|schema/i.test(msg || '')) {
      return callOpenAIOnce(cfg, key, prompt, opts, signal, mode === 'schema' ? 'object' : 'none');
    }
    throw classifyModelError(errorFromStatus(res.status, msg), cfg.model);
  }
  // OpenAI: prompt_tokens รวมส่วนที่อ่านจาก cache แล้ว
  if (data.usage && opts.onUsage) {
    opts.onUsage({
      input: data.usage.prompt_tokens || 0,
      output: data.usage.completion_tokens || 0,
      cacheRead: data.usage.prompt_tokens_details?.cached_tokens || 0,
      raw: data.usage
    });
  }
  const choice = data.choices?.[0];
  const text = choice?.message?.content || '';
  const reason = choice?.finish_reason || '';
  if (reason === 'length') throw new LLMError('ผลลัพธ์ยาวเกินขีดจำกัดของโมเดลและถูกตัดกลางคัน', 'truncated');
  if (reason === 'content_filter') throw new LLMError('โมเดลปฏิเสธการตอบ (content_filter)', 'blocked');
  if (!text) throw new LLMError('โมเดลไม่ส่งข้อความกลับมา', 'empty');
  return text;
}

const PROVIDER_CALLERS = {
  gemini: callGeminiOnce,
  anthropic: callAnthropicOnce,
  openai: callOpenAIOnce
};

/**
 * เรียก AI ตาม provider ที่ตั้งค่าไว้ พร้อม retry/หมุนคีย์/ยกเลิก
 * @returns {Promise<string>} ข้อความดิบจากโมเดล
 */
async function callLLM(prompt, options = {}) {
  try {
    return await callLLMWithProvider(prompt, options);
  } catch (err) {
    // AI ปฏิเสธเนื้อหา (เช่นฉากรุนแรง): ส่งต่อให้ผู้ให้บริการสำรองที่ตั้งไว้ 1 ครั้ง
    const fallback = getFallbackProvider();
    // งานที่กำหนดโมเดลเอง (เทียบโมเดล) ไม่ส่งต่อ ผลต้องมาจากโมเดลที่เลือกเท่านั้น
    if (err?.kind !== 'blocked' || options.providerOverride || getModelOverride(options.signal) || !fallback || fallback === getActiveProvider()) throw err;
    const fbCfg = getActiveLlmConfig(options.role || 'main', fallback);
    if (fbCfg.keys.length === 0 || !fbCfg.model) throw err;
    if (options.onStatus) options.onStatus(`${LLM_PROVIDERS[getActiveProvider()].label} ปฏิเสธเนื้อหา กำลังส่งต่อให้ ${LLM_PROVIDERS[fallback].label}...`);
    return callLLMWithProvider(prompt, { ...options, providerOverride: fallback });
  }
}

async function callLLMWithProvider(prompt, { json = true, schema = null, system = '', signal = null, onStatus = null, maxRetries = getRetryLimit(), role = 'main', providerOverride = '' } = {}) {
  const override = getModelOverride(signal);
  const cfg = override
    ? { ...getActiveLlmConfig(role, override.provider), model: override.model, mainModel: override.model, auxModel: override.model }
    : getActiveLlmConfig(role, providerOverride);
  if (cfg.keys.length === 0) throw new LLMError(`กรุณาใส่ API Key ของ ${LLM_PROVIDERS[cfg.provider].label} ในเมนู 'ตั้งค่า' ก่อน`, 'config');
  if (!cfg.model) throw new LLMError("กรุณาเลือกโมเดลในเมนู 'ตั้งค่า' ก่อน", 'config');

  // เพดานค่าใช้จ่ายและเพดานจำนวนครั้งต่อตอน (usage.js)
  if (typeof checkBudgetBeforeCall === 'function') await checkBudgetBeforeCall(signal);
  if (typeof countChapterCall === 'function') countChapterCall(signal);

  const caller = PROVIDER_CALLERS[cfg.provider];
  let reported = null;
  const onUsage = (u) => {
    reported = u;
    if (typeof recordUsage === 'function') recordUsage({ ...u, provider: cfg.provider, model: u.model || cfg.model }, signal);
  };
  // บันทึกรายคำขอ: ยอดดิบจากผู้ให้บริการ หรือบอกว่าไม่ได้ยอดกลับมา (ใช้หาว่าทำไมยอดในแอพต่างจากหน้าเว็บผู้ให้บริการ)
  const logAttempt = (attempt, extra) => {
    if (typeof logRequest !== 'function') return;
    logRequest({
      provider: cfg.provider, model: reported?.model || cfg.model, role,
      task: (typeof getTaskInfo === 'function' && getTaskInfo(signal).task) || '',
      attempt, promptChars: prompt.length, systemChars: system.length,
      usage: reported ? (reported.raw || { input: reported.input, output: reported.output }) : null,
      ...extra
    });
  };
  let rotationsSinceWait = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    throwIfAborted(signal);
    reported = null;
    try {
      const text = await caller(cfg, pickKey(cfg), prompt, { json, schema, system, onUsage }, signal);
      logAttempt(attempt, { ok: true });
      if (reported && typeof learnCharsPerToken === 'function') learnCharsPerToken(cfg.provider, prompt.length + system.length, reported.input);
      return text;
    } catch (err) {
      const failKind = isAbortError(err) || signal?.aborted ? 'abort' : (err.kind || 'error');
      logAttempt(attempt, { ok: false, kind: failKind, status: err.status || 0, error: err.message });
      // ส่งคำขอไปแล้วแต่ไม่ได้ยอดกลับมา: ผู้ให้บริการอาจคิดค่า token ขาเข้าแล้ว จึงบันทึกค่าประมาณไว้
      // (429 / 4xx ไม่ถูกคิดเงิน จึงไม่นับ)
      if (!reported && (failKind === 'abort' || failKind === 'network') && typeof recordEstimatedInput === 'function') {
        recordEstimatedInput(cfg.provider, cfg.model, prompt.length + system.length, signal);
      }
      if (isAbortError(err) || signal?.aborted) throw new LLMError('ผู้ใช้สั่งหยุดการทำงาน', 'abort');
      const retryable = ['rate', 'server', 'network'].includes(err.kind);
      if (!retryable || attempt === maxRetries) {
        if (typeof logDiagnostic === 'function') {
          logDiagnostic({
            source: 'llm', kind: err.kind || 'error', status: err.status, provider: cfg.provider, model: cfg.model,
            task: (typeof getTaskInfo === 'function' && getTaskInfo(signal).task) || '',
            message: `${err.message}${attempt > 1 ? ` (หลังลอง ${attempt} รอบ)` : ''}`
          });
        }
        throw err;
      }

      if (err.kind === 'rate' && cfg.keys.length > 1 && rotationsSinceWait < cfg.keys.length - 1) {
        rotateKey(cfg);
        rotationsSinceWait++;
        if (onStatus) onStatus(`โควต้าเต็ม! สลับใช้คีย์ #${keyIndexByProvider[cfg.provider] + 1}/${cfg.keys.length} ทันที...`);
        await sleepAbortable(800, signal);
        continue;
      }

      // ทุกคีย์เต็มหรือเซิร์ฟเวอร์หนาแน่น: รอแบบ backoff ก่อนลองใหม่
      rotationsSinceWait = 0;
      if (err.kind === 'rate') rotateKey(cfg);
      const waitSec = Math.min(30, 5 * attempt);
      for (let sec = waitSec; sec > 0; sec--) {
        if (onStatus) onStatus(`คิวแน่น! ลองใหม่รอบที่ ${attempt}/${maxRetries}${currentKeyLabel(cfg)} ใน ${sec} วิ...`);
        await sleepAbortable(1000, signal);
      }
    }
  }
  throw new LLMError('ลองใหม่ครบจำนวนรอบแล้วยังไม่สำเร็จ', 'server');
}

async function callLLMJson(prompt, options = {}) {
  const text = await callLLM(prompt, { ...options, json: true });
  return cleanAndParseJSON(text);
}

// ---------- Model listing (ใช้ค่าจากฟอร์มตั้งค่าที่ยังไม่บันทึกได้) ----------
async function listProviderModels(provider, key, baseUrl = '') {
  if (provider === 'gemini') {
    const res = await guardedFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      headers: { 'x-goog-api-key': key }
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throw errorFromStatus(res.status, data.error?.message);
    return (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(name => name.toLowerCase().includes('gemini'));
  }
  if (provider === 'anthropic') {
    const res = await guardedFetch('https://api.anthropic.com/v1/models?limit=1000', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      }
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throw errorFromStatus(res.status, data.error?.message);
    return (data.data || []).map(m => m.id);
  }
  const base = (baseUrl || LLM_PROVIDERS.openai.defaultBaseUrl).replace(/\/+$/, '');
  const res = await guardedFetch(`${base}/models`, { headers: { 'Authorization': `Bearer ${key}` } });
  const data = await readJsonSafe(res);
  if (!res.ok) throw errorFromStatus(res.status, data.error?.message);
  return (data.data || []).map(m => m.id).sort();
}
