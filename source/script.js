'use strict';

// ═══════════════════════════════════════════════════════════
// TRANSFORM LAYER
// buildTransformSpec — API仕様を知らない。mode→specへの変換のみ。
// ═══════════════════════════════════════════════════════════

const MODE_CONFIG = {
  // structural
  summarize:           { instruction: '主要な情報のみを抽出し、短縮して出力する',          outputFormat: 'text' },
  expand:              { instruction: '各要素を詳細に展開して出力する',                    outputFormat: 'text' },
  outline:             { instruction: '階層的なアウトライン構造として出力する',              outputFormat: 'text' },
  bulletize:           { instruction: '箇条書き形式として出力する（評価語なし）',            outputFormat: 'text' },
  compress:            { instruction: '最小の語数で意味を保持して出力する',                 outputFormat: 'text' },
  formalize:           { instruction: '形式的・公式な文体に変換して出力する',               outputFormat: 'text' },
  simplify:            { instruction: '平易な語彙と構造に変換して出力する',                 outputFormat: 'text' },
  abstract:            { instruction: '具体的な詳細を除去し、抽象的な記述として出力する',   outputFormat: 'text' },
  // semantic
  extract_claims:      { instruction: '明示的・暗示的な主張のみを列挙する',                 outputFormat: 'text' },
  extract_assumptions: { instruction: '前提として置かれている事柄を列挙する',               outputFormat: 'text' },
  extract_structure:   { instruction: '論理構造・関係性を記述する',                        outputFormat: 'text' },
  remove_evaluation:   { instruction: '評価語・感情語を除去し、事実記述のみを残す',         outputFormat: 'text' },
  neutralize:          { instruction: '立場・価値判断を除去し、中立的な記述に変換する',     outputFormat: 'text' },
  invert:              { instruction: '論旨・立場を反転して出力する',                       outputFormat: 'text' },
  // format
  json:                { instruction: 'JSON形式として出力する',                            outputFormat: 'json' },
  yaml:                { instruction: 'YAML形式として出力する',                            outputFormat: 'text' },
  table:               { instruction: 'テーブル形式（マークダウン）として出力する',          outputFormat: 'text' },
  pseudo_code:         { instruction: '疑似コード形式として出力する',                       outputFormat: 'text' },
  markdown:            { instruction: 'Markdown形式として出力する',                          outputFormat: 'text' },
  // language
  translate:           { instruction: '入力テキストを指定言語に翻訳する。意味・ニュアンスを保持する。', outputFormat: 'text' },
};

/**
 * @returns {TransformSpec}
 * {
 *   mode: string,
 *   instruction: string,
 *   outputLanguage: string,
 *   outputFormat: "text" | "json",
 *   generation: { temperature: number, maxTokens: number }
 * }
 */
function buildTransformSpec(preset) {
  const mode     = preset.transformMode || 'bulletize';
  const language = preset.language || 'ja';
  const config   = MODE_CONFIG[mode] || { instruction: mode, outputFormat: 'text' };

  const langLine = language === 'en'
    ? 'Output in English.'
    : '出力は日本語で行う。';

  const jsonLine = config.outputFormat === 'json'
    ? '\nOutput must be valid JSON only. No markdown fences. No explanation.'
    : '';

  const instruction = [
    '非人格的変換器として機能する。',
    `transform_mode: ${mode}`,
    `instruction: ${config.instruction}を実行する。`,
    langLine,
    '禁止: 一人称・評価語・感情語・末尾質問・対話継続誘導・共感表現。',
    '原則: 入力の意味領域を超えない。新規主張を追加しない。出力のみを返す。',
    jsonLine,
  ].filter(Boolean).join('\n');

  return {
    mode,
    instruction,
    outputLanguage: language,
    outputFormat:   config.outputFormat,
    generation: {
      temperature: Math.min(Math.max(preset.temperature ?? 0.7, 0.0), 1.0),
      maxTokens:   preset.maxTokens ?? 1000,
    },
  };
}


// ═══════════════════════════════════════════════════════════
// ADAPTER LAYER
// 各Adapterの責務: spec を各社APIのネイティブ構造に射影する
// ═══════════════════════════════════════════════════════════

const anthropicAdapter = {
  async send(spec, inputText, apiKey, model) {
    const body = {
      model,
      max_tokens:  spec.generation.maxTokens,
      temperature: spec.generation.temperature,
      system:      spec.instruction,
      messages:    [{ role: 'user', content: inputText }],
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(await parseHttpError(res));
    const data = await res.json();
    return data.content?.[0]?.text || '';
  },
};

const openaiAdapter = {
  async send(spec, inputText, apiKey, model) {
    const body = {
      model,
      temperature: spec.generation.temperature,
      max_tokens:  spec.generation.maxTokens,
      messages: [
        { role: 'system', content: spec.instruction },
        { role: 'user',   content: inputText },
      ],
    };

    if (spec.outputFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(await parseHttpError(res));
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  },
};

const geminiAdapter = {
  async send(spec, inputText, apiKey, model) {
    const generationConfig = {
      temperature:     spec.generation.temperature,
      maxOutputTokens: spec.generation.maxTokens,
    };

    if (spec.outputFormat === 'json') {
      generationConfig.responseMimeType = 'application/json';
    }

    const body = {
      systemInstruction: { parts: [{ text: spec.instruction }] },
      contents: [{ role: 'user', parts: [{ text: inputText }] }],
      generationConfig,
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(await parseHttpError(res));
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  },
};

const ADAPTERS = {
  anthropic: anthropicAdapter,
  openai:    openaiAdapter,
  gemini:    geminiAdapter,
};


// ═══════════════════════════════════════════════════════════
// RESPONSE LAYER
// ═══════════════════════════════════════════════════════════

async function parseHttpError(res) {
  const err = await res.json().catch(() => ({}));
  if (res.status === 401) return 'ERROR: 401 — API key invalid';
  if (res.status === 429) return 'ERROR: 429 — rate limit exceeded';
  const msg = err?.error?.message || err?.message || '';
  return `ERROR: ${res.status}${msg ? ' — ' + msg : ''}`;
}

function normalizeResponse(text, spec) {
  if (!text) return 'ERROR: empty response';
  const trimmed = text.trim();
  if (spec.outputFormat === 'json') {
    try {
      JSON.parse(trimmed);
    } catch {
      return 'ERROR: invalid JSON returned\n\n' + trimmed;
    }
  }
  return trimmed;
}


// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const PRESETS_KEY   = 'recast_presets';
const OAI_KEY_STORE = 'openai_api_key';
const ANT_KEY_STORE = 'anthropic_api_key';
const GEM_KEY_STORE = 'gemini_api_key';

const MODELS = {
  // anthropic: [  // CORS未解決 — 帰宅後にWorker設定で有効化
  //   'claude-opus-4-5',
  //   'claude-sonnet-4-5',
  //   'claude-haiku-4-5-20251001',
  // ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
  ],
  gemini: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    // 'gemini-1.5-pro',   // 404 — エンドポイント要確認
    // 'gemini-1.5-flash', // 404 — エンドポイント要確認
  ],
};


// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════

let presets        = [];
let currentPresetId = null;
let selectedMode   = 'bulletize';


// ═══════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════

function loadPresets() {
  try { presets = JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; }
  catch { presets = []; }
}

function savePresetsToStorage() {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function getApiKey(provider) {
  const keyMap = { openai: OAI_KEY_STORE, anthropic: ANT_KEY_STORE, gemini: GEM_KEY_STORE };
  const key = localStorage.getItem(keyMap[provider]);
  if (!key) throw new Error('API_KEY_MISSING');
  return key;
}


// ═══════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════

const $preset         = document.getElementById('preset-select');
const $input          = document.getElementById('input-text');
const $output         = document.getElementById('output-area');
const $convertBtn     = document.getElementById('convert-btn');
const $copyBtn        = document.getElementById('copy-btn');
const $settingsBtn    = document.getElementById('settings-btn');
const $settingsModal  = document.getElementById('settings-modal');
const $modalClose     = document.getElementById('modal-close');
const $statusChars    = document.getElementById('status-chars');
const $statusPreset   = document.getElementById('status-preset');
const $statusState    = document.getElementById('status-state');

const $oaiKey         = document.getElementById('oai-key');
const $antKey         = document.getElementById('ant-key');
const $gemKey         = document.getElementById('gem-key');
const $saveKeysBtn    = document.getElementById('save-keys-btn');

const $presetName     = document.getElementById('preset-name');
const $presetProvider = document.getElementById('preset-provider');
const $presetModel    = document.getElementById('preset-model');
const $presetLanguage = document.getElementById('preset-language');
const $presetTemp     = document.getElementById('preset-temp');
const $presetTempVal  = document.getElementById('preset-temp-val');
const $presetTokens   = document.getElementById('preset-tokens');
const $selectedModeLabel = document.getElementById('selected-mode-label');

const $saveNewBtn     = document.getElementById('preset-save-new');
const $overwriteBtn   = document.getElementById('preset-overwrite');
const $deleteBtn      = document.getElementById('preset-delete');


// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

function init() {
  loadPresets();
  updateModelOptions('anthropic');
  renderPresetDropdown();

  $oaiKey.value = localStorage.getItem(OAI_KEY_STORE) || '';
  $antKey.value = localStorage.getItem(ANT_KEY_STORE) || '';
  $gemKey.value = localStorage.getItem(GEM_KEY_STORE) || '';

  if (presets.length > 0) selectPreset(presets[0].id);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}


// ═══════════════════════════════════════════════════════════
// PRESET UI
// ═══════════════════════════════════════════════════════════

function renderPresetDropdown() {
  const current = $preset.value;
  $preset.innerHTML = '<option value="">— no preset —</option>';
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    $preset.appendChild(opt);
  });
  if (current && presets.find(p => p.id === current)) $preset.value = current;
  updateStatusPreset();
}

function selectPreset(id) {
  currentPresetId = id || null;
  $preset.value = id || '';
  updateStatusPreset();
  updatePresetActionBtns();
}

function updateStatusPreset() {
  const p = presets.find(p => p.id === currentPresetId);
  $statusPreset.textContent = p ? p.name : 'none';
}

function updatePresetActionBtns() {
  const has = !!currentPresetId;
  $overwriteBtn.style.display = has ? '' : 'none';
  $deleteBtn.style.display    = has ? '' : 'none';
}

function loadPresetIntoForm(id) {
  const p = presets.find(p => p.id === id);
  if (!p) { clearPresetForm(); return; }
  $presetName.value     = p.name;
  $presetProvider.value = p.provider;
  updateModelOptions(p.provider, p.model);
  $presetLanguage.value = p.language || 'ja';
  $presetTemp.value     = p.temperature;
  $presetTempVal.textContent = p.temperature.toFixed(1);
  $presetTokens.value   = p.maxTokens;
  setActiveMode(p.transformMode || 'bulletize');
}

function clearPresetForm() {
  $presetName.value     = '';
  $presetProvider.value = 'anthropic';
  updateModelOptions('anthropic');
  $presetLanguage.value = 'ja';
  $presetTemp.value     = 0.7;
  $presetTempVal.textContent = '0.7';
  $presetTokens.value   = 1000;
  setActiveMode('bulletize');
}

function updateModelOptions(provider, selectedModel) {
  const models = MODELS[provider] || [];
  if (!models.length) return; // provider未対応（コメントアウト中）
  $presetModel.innerHTML = '';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    $presetModel.appendChild(opt);
  });
  if (selectedModel && models.includes(selectedModel)) {
    $presetModel.value = selectedModel;
  }
}

function getFormData() {
  return {
    name:          $presetName.value.trim() || 'preset',
    provider:      $presetProvider.value,
    model:         $presetModel.value,
    transformMode: selectedMode,
    language:      $presetLanguage.value,
    temperature:   parseFloat($presetTemp.value),
    maxTokens:     parseInt($presetTokens.value) || 1000,
  };
}


// ═══════════════════════════════════════════════════════════
// MODE BUTTONS
// ═══════════════════════════════════════════════════════════

function setActiveMode(mode) {
  selectedMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  if ($selectedModeLabel) $selectedModeLabel.textContent = mode;
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => setActiveMode(btn.dataset.mode));
});


// ═══════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════

$preset.addEventListener('change', () => {
  selectPreset($preset.value);
  if ($preset.value) loadPresetIntoForm($preset.value);
});

$input.addEventListener('input', () => {
  $statusChars.textContent = $input.value.length;
});

$convertBtn.addEventListener('click', async () => {
  const text = $input.value.trim();
  if (!text) { setOutput('ERROR: missing input text', 'error'); return; }

  const preset = presets.find(p => p.id === currentPresetId);
  if (!preset) { setOutput('ERROR: no preset selected', 'error'); return; }

  let apiKey;
  try { apiKey = getApiKey(preset.provider); }
  catch { setOutput('ERROR: API key not set — open ⚙ settings', 'error'); return; }

  const adapter = ADAPTERS[preset.provider];
  if (!adapter) { setOutput(`ERROR: unknown provider: ${preset.provider}`, 'error'); return; }

  $convertBtn.disabled = true;
  $statusState.textContent = 'PROCESSING';
  $output.className = '';
  $output.innerHTML = '<span class="cursor"></span>';

  try {
    const spec   = buildTransformSpec(preset);
    const raw    = await adapter.send(spec, text, apiKey, preset.model);
    const result = normalizeResponse(raw, spec);
    setOutput(result, '');
    $statusState.textContent = `DONE [${preset.provider}/${preset.model}]`;
  } catch (err) {
    setOutput(err.message, 'error');
    $statusState.textContent = 'ERROR';
  }

  $convertBtn.disabled = false;
});

function setOutput(text, cls) {
  $output.textContent = text;
  $output.className = cls || '';
  if (!text) $output.classList.add('empty');
}

$copyBtn.addEventListener('click', () => {
  const text = $output.textContent;
  if (!text || $output.classList.contains('empty')) return;
  navigator.clipboard.writeText(text).then(() => {
    $copyBtn.textContent = '✓ copied';
    $copyBtn.classList.add('copied');
    setTimeout(() => {
      $copyBtn.textContent = 'copy';
      $copyBtn.classList.remove('copied');
    }, 1800);
  }).catch(() => {});
});

$settingsBtn.addEventListener('click', () => {
  $oaiKey.value = localStorage.getItem(OAI_KEY_STORE) || '';
  $antKey.value = localStorage.getItem(ANT_KEY_STORE) || '';
  $gemKey.value = localStorage.getItem(GEM_KEY_STORE) || '';
  if (currentPresetId) loadPresetIntoForm(currentPresetId);
  else clearPresetForm();
  updatePresetActionBtns();
  $settingsModal.classList.add('open');
});

$modalClose.addEventListener('click', () => $settingsModal.classList.remove('open'));
$settingsModal.addEventListener('click', e => {
  if (e.target === $settingsModal) $settingsModal.classList.remove('open');
});

$saveKeysBtn.addEventListener('click', () => {
  if ($oaiKey.value.trim()) localStorage.setItem(OAI_KEY_STORE, $oaiKey.value.trim());
  if ($antKey.value.trim()) localStorage.setItem(ANT_KEY_STORE, $antKey.value.trim());
  if ($gemKey.value.trim()) localStorage.setItem(GEM_KEY_STORE, $gemKey.value.trim());
  $saveKeysBtn.textContent = '✓ saved';
  setTimeout(() => { $saveKeysBtn.textContent = 'save keys'; }, 1500);
});

$presetProvider.addEventListener('change', () => updateModelOptions($presetProvider.value));

$presetTemp.addEventListener('input', () => {
  $presetTempVal.textContent = parseFloat($presetTemp.value).toFixed(1);
});

$saveNewBtn.addEventListener('click', () => {
  const data = getFormData();
  const now  = Date.now();
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
  const newPreset = { id, ...data, createdAt: now, updatedAt: now };
  presets.push(newPreset);
  savePresetsToStorage();
  renderPresetDropdown();
  selectPreset(newPreset.id);
  $preset.value = newPreset.id;
  updatePresetActionBtns();
  $saveNewBtn.textContent = '✓ saved';
  setTimeout(() => { $saveNewBtn.textContent = 'save new'; }, 1500);
});

$overwriteBtn.addEventListener('click', () => {
  if (!currentPresetId) return;
  const idx = presets.findIndex(p => p.id === currentPresetId);
  if (idx === -1) return;
  presets[idx] = { ...presets[idx], ...getFormData(), updatedAt: Date.now() };
  savePresetsToStorage();
  renderPresetDropdown();
  $preset.value = currentPresetId;
  $overwriteBtn.textContent = '✓ saved';
  setTimeout(() => { $overwriteBtn.textContent = 'overwrite'; }, 1500);
});

$deleteBtn.addEventListener('click', () => {
  if (!currentPresetId) return;
  presets = presets.filter(p => p.id !== currentPresetId);
  savePresetsToStorage();
  currentPresetId = null;
  renderPresetDropdown();
  clearPresetForm();
  updatePresetActionBtns();
});


// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════

init();
