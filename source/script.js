'use strict';

// ── CONSTANTS ────────────────────────────────────────────
const PRESETS_KEY   = 'recast_presets';
const OAI_KEY_STORE = 'openai_api_key';
const ANT_KEY_STORE = 'anthropic_api_key';
const GEM_KEY_STORE = 'gemini_api_key';

const MODELS = {
  anthropic: [
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-haiku-4-5-20251001',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
  ],
  gemini: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
};

// ── STATE ─────────────────────────────────────────────────
let presets = [];
let currentPresetId = null;
let selectedMode = 'bulletize';

// ── STORAGE ───────────────────────────────────────────────
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

// ── DOM ───────────────────────────────────────────────────
const $preset        = document.getElementById('preset-select');
const $input         = document.getElementById('input-text');
const $output        = document.getElementById('output-area');
const $convertBtn    = document.getElementById('convert-btn');
const $copyBtn       = document.getElementById('copy-btn');
const $settingsBtn   = document.getElementById('settings-btn');
const $settingsModal = document.getElementById('settings-modal');
const $modalClose    = document.getElementById('modal-close');
const $statusChars   = document.getElementById('status-chars');
const $statusPreset  = document.getElementById('status-preset');
const $statusState   = document.getElementById('status-state');

const $oaiKey        = document.getElementById('oai-key');
const $antKey        = document.getElementById('ant-key');
const $gemKey        = document.getElementById('gem-key');
const $saveKeysBtn   = document.getElementById('save-keys-btn');

const $presetName    = document.getElementById('preset-name');
const $presetProvider= document.getElementById('preset-provider');
const $presetModel   = document.getElementById('preset-model');
const $selectedModeLabel = document.getElementById('selected-mode-label');
const $presetLanguage  = document.getElementById('preset-language');
const $presetTemp    = document.getElementById('preset-temp');
const $presetTempVal = document.getElementById('preset-temp-val');
const $presetTokens  = document.getElementById('preset-tokens');

const $saveNewBtn    = document.getElementById('preset-save-new');
const $overwriteBtn  = document.getElementById('preset-overwrite');
const $deleteBtn     = document.getElementById('preset-delete');

// ── INIT ──────────────────────────────────────────────────
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

// ── PRESET DROPDOWN ───────────────────────────────────────
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

// ── PRESET FORM ───────────────────────────────────────────
function loadPresetIntoForm(id) {
  const p = presets.find(p => p.id === id);
  if (!p) { clearPresetForm(); return; }
  $presetName.value     = p.name;
  $presetProvider.value = p.provider;
  updateModelOptions(p.provider, p.model);
  setActiveMode(p.transformMode || 'bulletize');
  $presetLanguage.value = p.language || 'ja';
  $presetTemp.value     = p.temperature;
  $presetTempVal.textContent = p.temperature.toFixed(1);
  $presetTokens.value   = p.maxTokens;
}

function clearPresetForm() {
  $presetName.value     = '';
  $presetProvider.value = 'anthropic';
  updateModelOptions('anthropic');
  setActiveMode('bulletize');
  $presetLanguage.value = 'ja';
  $presetTemp.value     = 0.7;
  $presetTempVal.textContent = '0.7';
  $presetTokens.value   = 1000;
}

function updateModelOptions(provider, selectedModel) {
  const models = MODELS[provider] || [];
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
    name:        $presetName.value.trim() || 'preset',
    provider:    $presetProvider.value,
    model:       $presetModel.value,
    transformMode: selectedMode,
    language:      $presetLanguage.value,
    temperature: parseFloat($presetTemp.value),
    maxTokens:   parseInt($presetTokens.value) || 1000,
  };
}

// ── API ───────────────────────────────────────────────────
async function callApi(preset, inputText) {
  const key = getApiKey(preset.provider);

  switch (preset.provider) {
    case 'anthropic': return callAnthropic(key, preset, inputText);
    case 'openai':    return callOpenAI(key, preset, inputText);
    case 'gemini':    return callGemini(key, preset, inputText);
    default: throw new Error(`ERROR: unsupported provider: ${preset.provider}`);
  }
}

async function callAnthropic(key, preset, inputText) {
  const body = {
    model: preset.model,
    max_tokens: preset.maxTokens,
    temperature: preset.temperature,
    messages: [{ role: 'user', content: inputText }]
  };
  body.system = buildSystemPrompt(preset.transformMode || 'bulletize', preset.language || 'ja');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(await parseApiError(res));
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function callOpenAI(key, preset, inputText) {
  const messages = [];
  messages.push({ role: 'system', content: buildSystemPrompt(preset.transformMode || 'bulletize', preset.language || 'ja') });
  messages.push({ role: 'user', content: inputText });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: preset.model,
      messages,
      temperature: preset.temperature,
      max_tokens: preset.maxTokens,
    })
  });

  if (!res.ok) throw new Error(await parseApiError(res));
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(key, preset, inputText) {
  const combinedText = `${buildSystemPrompt(preset.transformMode || 'bulletize', preset.language || 'ja')}\n\n${inputText}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${preset.model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: combinedText }] }],
      generationConfig: {
        temperature: preset.temperature,
        maxOutputTokens: preset.maxTokens,
      }
    })
  });

  if (!res.ok) throw new Error(await parseApiError(res));
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function parseApiError(res) {
  const err = await res.json().catch(() => ({}));
  if (res.status === 401) return 'ERROR: 401 — API key invalid';
  if (res.status === 429) return 'ERROR: 429 — rate limit exceeded';
  const msg = err?.error?.message || err?.message || '';
  return `ERROR: ${res.status}${msg ? ' — ' + msg : ''}`;
}


// ── MODE BUTTONS ──────────────────────────────────────────
const MODE_INSTRUCTIONS = {
  summarize:           '主要な情報のみを抽出し、短縮して出力する',
  expand:              '各要素を詳細に展開して出力する',
  outline:             '階層的なアウトライン構造として出力する',
  bulletize:           '箇条書き形式として出力する（評価語なし）',
  compress:            '最小の語数で意味を保持して出力する',
  formalize:           '形式的・公式な文体に変換して出力する',
  simplify:            '平易な語彙と構造に変換して出力する',
  abstract:            '具体的な詳細を除去し、抽象的な記述として出力する',
  extract_claims:      '明示的・暗示的な主張のみを列挙する',
  extract_assumptions: '前提として置かれている事柄を列挙する',
  extract_structure:   '論理構造・関係性を記述する',
  remove_evaluation:   '評価語・感情語を除去し、事実記述のみを残す',
  neutralize:          '立場・価値判断を除去し、中立的な記述に変換する',
  invert:              '論旨・立場を反転して出力する',
  json:                'JSON形式として出力する',
  yaml:                'YAML形式として出力する',
  table:               'テーブル形式（マークダウン）として出力する',
  pseudo_code:         '疑似コード形式として出力する',
  translate:           '入力テキストを指定言語に翻訳する。意味・ニュアンスを保持する。',
};

function buildSystemPrompt(mode, language = 'ja') {
  const langInstruction = language === 'en'
    ? 'Output in English.'
    : '出力は日本語で行う。';
  return `非人格的変換器として機能する。
transform_mode: ${mode}
instruction: ${MODE_INSTRUCTIONS[mode] || mode}を実行する。
${langInstruction}
禁止: 一人称・評価語・感情語・末尾質問・対話継続誘導・共感表現。
原則: 入力の意味領域を超えない。新規主張を追加しない。出力のみを返す。`;
}

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

// ── EVENT HANDLERS ────────────────────────────────────────
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

  try { getApiKey(preset.provider); }
  catch { setOutput('ERROR: API key not set — open ⚙ settings', 'error'); return; }

  $convertBtn.disabled = true;
  $statusState.textContent = 'PROCESSING';
  $output.className = '';
  $output.innerHTML = '<span class="cursor"></span>';

  try {
    const result = await callApi(preset, text);
    setOutput(result, '');
    $statusState.textContent = 'DONE';
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
  const now = Date.now();
  const newPreset = { id: crypto.randomUUID(), ...data, createdAt: now, updatedAt: now };
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

// ── BOOT ──────────────────────────────────────────────────
init();
