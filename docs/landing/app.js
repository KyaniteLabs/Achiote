const input = document.getElementById('input');
const btn = document.getElementById('send-btn');
const welcome = document.getElementById('welcome');
const messages = document.getElementById('messages');
const voiceStrip = document.getElementById('voice-strip');
const voiceStatusEl = document.getElementById('voice-status');
const voiceLanguage = document.getElementById('voice-language');
const micBtn = document.getElementById('mic-btn');
const readBtn = document.getElementById('read-btn');
const CONSENT_ANALYTICS_KEY = 'achiote-consent-analytics';
const CONSENT_QUALITY_KEY = 'achiote-consent-quality';
const ProductApp = window.AchioteProductApp;
let busy = false;
let chatHistory = [];
let currentAskSource = 'typed';
let currentAskCategory = 'none';
let voiceConfig = null;
let recorder = null;
let recordedChunks = [];
let lastAssistantText = '';
let lastReceipt = null;

function readBooleanSetting(key) {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeBooleanSetting(key, enabled) {
  try {
    localStorage.setItem(key, enabled ? 'true' : 'false');
  } catch {
    // Consent controls are optional; reconstruction must keep working.
  }
}

function isAnalyticsConsentEnabled() {
  return readBooleanSetting(CONSENT_ANALYTICS_KEY);
}

function isQualitySignalsConsentEnabled() {
  return readBooleanSetting(CONSENT_QUALITY_KEY);
}

function initConsentControls() {
  const analytics = document.getElementById('consent-analytics');
  const quality = document.getElementById('consent-quality');
  const status = document.getElementById('consent-status');

  const syncStatus = () => {
    if (!status) return;
    const enabled = [
      analytics instanceof HTMLInputElement && analytics.checked ? 'analytics' : '',
      quality instanceof HTMLInputElement && quality.checked ? 'quality signals' : '',
    ].filter(Boolean);
    status.textContent = enabled.length
      ? `Optional sharing on: ${enabled.join(', ')}.`
      : 'Optional sharing is off. Achiote still works normally.';
  };

  if (analytics instanceof HTMLInputElement) {
    analytics.checked = isAnalyticsConsentEnabled();
    analytics.addEventListener('change', () => {
      writeBooleanSetting(CONSENT_ANALYTICS_KEY, analytics.checked);
      syncStatus();
    });
  }
  if (quality instanceof HTMLInputElement) {
    quality.checked = isQualitySignalsConsentEnabled();
    quality.addEventListener('change', () => {
      writeBooleanSetting(CONSENT_QUALITY_KEY, quality.checked);
      syncStatus();
    });
  }
  syncStatus();
}

function trackEvent(event, properties = {}) {
  if (!isAnalyticsConsentEnabled()) return;
  if (!event || typeof event !== 'string') return;
  const safeProperties = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    safeProperties[key] = String(value).slice(0, 80);
  }
  const body = JSON.stringify({ event, properties: safeProperties, consent: { analytics: true }, at: new Date().toISOString() });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/events', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    // Telemetry must never interrupt reconstruction.
  }
}

initConsentControls();
trackEvent('app_opened', { route: '/app' });
initVoice();

// Add event listeners for suggestion buttons
document.querySelectorAll('.suggestion').forEach(button => {
  button.addEventListener('click', () => {
    const suggestionCategory = button.dataset.suggestionCategory || 'unknown';
    if (send(button.dataset.suggestion, { source: 'suggestion', category: suggestionCategory })) {
      trackEvent('onboarding_prompt_selected', { route: '/app', category: suggestionCategory });
    }
  });
});

// Add event listener for send button
btn.addEventListener('click', () => send());
micBtn?.addEventListener('click', () => toggleRecording());
readBtn?.addEventListener('click', () => readLatestAnswer());

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !busy) {
    e.preventDefault();
    send();
  }
});

function send(text, metadata = {}) {
  const val = (text || input.value).trim();
  if (!val || busy) return false;
  const source = typeof metadata.source === 'string' ? metadata.source : 'typed';
  const category = typeof metadata.category === 'string' ? metadata.category : 'none';
  currentAskSource = text ? source : 'typed';
  currentAskCategory = text ? category : 'none';
  trackEvent('ask_started', { route: '/app', source: text ? source : 'typed', category: currentAskCategory, hasHistory: chatHistory.length > 0 });
  input.value = '';

  welcome.classList.add('hide');
  messages.classList.add('active');

  addMsg('user', val);
  const aiEl = addMsg('ai', '<div class="typing"><span></span><span></span><span></span></div>');

  busy = true;
  btn.disabled = true;

  const headers = authHeaders();

  fetch('/ask', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: val, history: chatHistory, consent: { qualitySignals: isQualitySignalsConsentEnabled() } }),
  })
  .then(async res => {
    if (!res.ok) throw new Error(await explainHttpError(res));
    return streamResponse(res, aiEl, val);
  })
  .catch(err => {
    const reason = err.message.includes('Rate limit') ? 'rate_limited' : err.message.includes('Authentication') ? 'auth' : 'request';
    trackEvent('ask_failed', { route: '/app', source: currentAskSource, category: currentAskCategory, reason });
    if (err.message.includes('Authentication')) {
      const authWrap = document.getElementById('demo-auth-wrap');
      if (authWrap) { authWrap.open = true; authWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      const hint = document.getElementById('auth-hint');
      if (hint) hint.textContent = 'Required. Enter your demo password or API key to continue.';
    }
    aiEl.textContent = err.message.includes('fetch')
      ? 'Server not running. Start it with node dist/http-server.js.'
      : err.message;
  })
  .finally(() => { busy = false; btn.disabled = false; input.focus(); });
  return true;
}

function authHeaders() {
  const demoPassword = document.getElementById('demo-password')?.value || localStorage.getItem('achiote-demo-password') || '';
  const apiKey = document.getElementById('api-key')?.value || localStorage.getItem('achiote-api-key') || '';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
    localStorage.setItem('achiote-api-key', apiKey);
  } else if (demoPassword) {
    headers['x-demo-password'] = demoPassword;
    localStorage.setItem('achiote-demo-password', demoPassword);
  }
  return headers;
}

async function initVoice() {
  if (!voiceStrip || !voiceStatusEl || !voiceLanguage || !micBtn || !readBtn) return;
  try {
    const res = await fetch('/voice/status');
    if (!res.ok) return;
    voiceConfig = await res.json();
    const sttReady = Boolean(voiceConfig?.stt?.ready);
    const ttsReady = Boolean(voiceConfig?.tts?.ready);
    if (!sttReady && !ttsReady) return;

    voiceStrip.hidden = false;
    const languages = Array.isArray(voiceConfig.stt?.languages) && voiceConfig.stt.languages.length > 0
      ? voiceConfig.stt.languages
      : ['auto'];
    voiceLanguage.innerHTML = languages
      .map((language) => `<option value="${escapeHtml(language)}">${language === 'auto' ? 'Auto-detect' : escapeHtml(language)}</option>`)
      .join('');
    voiceLanguage.value = voiceConfig.stt?.language || 'auto';
    micBtn.disabled = !sttReady || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined';
    readBtn.disabled = !ttsReady;
    voiceStatusEl.textContent = sttReady
      ? 'Local OSS speech ready. Auto-detect is best for accents and code-switching; pick a hint only when you know the family language.'
      : 'Local OSS read-aloud ready. Speech input needs a configured local transcription engine.';
  } catch {
    // Voice is progressive enhancement; chat must stay usable.
  }
}

async function toggleRecording() {
  if (!micBtn || !voiceStatusEl) return;
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    recorder = new MediaRecorder(stream);
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    });
    recorder.addEventListener('stop', async () => {
      stream.getTracks().forEach((track) => track.stop());
      micBtn.classList.remove('recording');
      micBtn.textContent = '●';
      await transcribeRecording(new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' }));
    });
    micBtn.classList.add('recording');
    micBtn.textContent = '■';
    voiceStatusEl.textContent = 'Listening locally... stop when the memory is out.';
    recorder.start();
  } catch (err) {
    voiceStatusEl.textContent = err instanceof Error ? err.message : 'Microphone permission failed.';
  }
}

async function transcribeRecording(blob) {
  if (!voiceStatusEl) return;
  try {
    const audioBase64 = await blobToBase64(blob);
    const res = await fetch('/voice/transcribe', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        audioBase64,
        mediaType: blob.type || 'audio/webm',
        language: voiceLanguage?.value || 'auto',
      }),
    });
    if (!res.ok) throw new Error(await explainHttpError(res));
    const body = await res.json();
    input.value = body.text || '';
    input.focus();
    voiceStatusEl.textContent = 'Transcript ready. Edit the spelling if family names or dish names need it.';
  } catch (err) {
    voiceStatusEl.textContent = err instanceof Error ? err.message : 'Transcription failed.';
  }
}

async function readLatestAnswer() {
  if (!lastAssistantText || !voiceStatusEl || !readBtn) return;
  try {
    readBtn.disabled = true;
    voiceStatusEl.textContent = 'Preparing local read-aloud...';
    const res = await fetch('/voice/synthesize', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        text: lastAssistantText,
        language: voiceLanguage?.value || 'auto',
      }),
    });
    if (!res.ok) throw new Error(await explainHttpError(res));
    const body = await res.json();
    const audio = new Audio(`data:${body.mediaType};base64,${body.audioBase64}`);
    await audio.play();
    voiceStatusEl.textContent = 'Playing the latest answer with local OSS speech.';
  } catch (err) {
    voiceStatusEl.textContent = err instanceof Error ? err.message : 'Read-aloud failed.';
  } finally {
    readBtn.disabled = !voiceConfig?.tts?.ready;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

async function explainHttpError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error || body?.message || body?.error?.message || '';
  } catch {
    detail = 'Could not parse server response';
  }

  return ProductApp.explainHttpStatus(res.status, detail);
}

function addMsg(role, html) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  // Only use innerHTML for trusted static HTML, not user content
  if (role === 'user') {
    el.textContent = html;
  } else {
    el.innerHTML = html;
  }
  messages.appendChild(el);
  el.closest('main').scrollTop = 1e6;
  return el;
}

function createTracePanel(aiEl) {
  let content = aiEl.querySelector('.assistant-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'assistant-content';
    content.innerHTML = aiEl.innerHTML;
    aiEl.innerHTML = '';
    aiEl.appendChild(content);
  }

  const trace = document.createElement('div');
  trace.className = 'trace-panel';
  const heading = document.createElement('div');
  heading.className = 'trace-heading';
  heading.innerHTML = '<span>What Achiote is doing</span><span class="trace-debug">runtime appears here</span>';
  const list = document.createElement('div');
  list.className = 'trace-list';
  trace.append(heading, list);
  aiEl.appendChild(trace);
  return list;
}

function renderTraceLine(item, time, contentNodes) {
  item.replaceChildren();
  const timeEl = document.createElement('span');
  timeEl.className = 'trace-time';
  timeEl.textContent = `[${time}]`;
  const textEl = document.createElement('span');
  textEl.className = 'trace-text';
  for (const node of contentNodes) textEl.appendChild(node);
  item.append(timeEl, textEl);
}

function traceText(text, className) {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

function addTraceItem(trace, type, data) {
  const item = document.createElement('div');
  item.className = `trace-item ${type}`;
  const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (type === 'status') {
    if (data.stage === 'model') {
      const heading = trace.closest('.trace-panel')?.querySelector('.trace-debug');
      if (heading) heading.textContent = 'Runtime trace';
      renderTraceLine(item, time, [
        traceText(data.retry ? 'Retrying model response' : 'Preparing model response', 'trace-phase'),
      ]);
    } else {
      const stageLabel = phaseForStatus(data);
      const tools = data.tools ? ` (${data.tools.join(', ')})` : '';
      renderTraceLine(item, time, [
        traceText(stageLabel, 'trace-phase'),
        traceText(tools),
      ]);
    }
  } else if (type === 'tool_call') {
    const inputSummary = summarizeInput(data.input);
    renderTraceLine(item, time, [
      traceText('Calling '),
      traceText(data.name, 'trace-tool-name'),
      traceText(inputSummary ? ` ${inputSummary}` : '', 'trace-summary'),
    ]);
  } else if (type === 'tool_result') {
    const resultSummary = summarizeResult(data.name, data.result);
    renderTraceLine(item, time, [
      traceText('Finished '),
      traceText(data.name, 'trace-tool-name'),
      traceText(` ${resultSummary}`, 'trace-summary'),
    ]);
  } else if (type === 'error') {
    renderTraceLine(item, time, [traceText(`Warning: ${data.message || data}`)]);
  }

  trace.appendChild(item);
  const panel = trace.closest('.trace-panel') || trace;
  panel.scrollTop = 1e6;
}

function phaseForStatus(data) {
  const tools = Array.isArray(data.tools) ? data.tools : [];
  if (data.stage === 'thinking') return `Step ${data.iteration}: Weighing evidence`;
  if (tools.includes('collect_food_memory')) return `Step ${data.iteration}: Reading memory`;
  if (tools.includes('resolve_dish_name')) return `Step ${data.iteration}: Correcting likely name`;
  if (tools.includes('search_web') || tools.includes('build_research_record') || tools.includes('extract_research_findings')) return `Step ${data.iteration}: Researching`;
  if (tools.includes('build_reconstruction_dossier')) return `Step ${data.iteration}: Separating evidence`;
  if (tools.includes('generate_minimum_viable_nostalgia')) return `Step ${data.iteration}: Building first test`;
  return data.stage === 'calling_tools' ? `Step ${data.iteration}: Checking tools` : `Step ${data.iteration}: Working`;
}

function summarizeInput(input) {
  if (!input || typeof input !== 'object') return '';
  const keys = Object.keys(input);
  if (keys.includes('query')) return `query: "${String(input.query).slice(0, 60)}"`;
  if (keys.includes('memoryText')) return `memory: "${String(input.memoryText).slice(0, 60)}"`;
  if (keys.includes('input')) return `name: "${String(input.input).slice(0, 60)}"`;
  if (keys.includes('description')) return `desc: "${String(input.description).slice(0, 60)}"`;
  if (keys.includes('ingredient')) return `ingredient: "${String(input.ingredient).slice(0, 60)}"`;
  return '';
}

function summarizeResult(name, result) {
  if (!result || typeof result !== 'object') return 'done';
  if (name === 'search_web' && result.results) return `${result.results.length} results`;
  if (name === 'collect_food_memory' && result.normalizedMemory) return `memory extracted`;
  if (name === 'plan_dish_research' && result.hypotheses) return `${result.hypotheses.length} hypotheses`;
  if (name === 'resolve_dish_name' && result.canonicalName) return result.canonicalName;
  if (name === 'build_reconstruction_dossier' && result.title) return 'dossier built';
  if (name === 'generate_minimum_viable_nostalgia' && result.cue) return 'cue generated';
  return 'done';
}

async function streamResponse(res, el, userMessage) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';
  let hasError = false;
  let trace = null;
  let contentEl = null;

  function ensureContentEl() {
    if (!contentEl) {
      contentEl = el.querySelector('.assistant-content');
      if (!contentEl) {
        contentEl = document.createElement('div');
        contentEl.className = 'assistant-content';
        contentEl.innerHTML = el.innerHTML;
        el.innerHTML = '';
        el.appendChild(contentEl);
      }
    }
    return contentEl;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const parsed = ProductApp.parseSseChunk(pending, decoder.decode(value, { stream: true }));
    pending = parsed.pending;

    for (const event of parsed.events) {
      try {
        const d = JSON.parse(event.data);
        if (event.type === 'error') {
          hasError = true;
          text += d.message || d.error || JSON.stringify(d);
          if (trace) addTraceItem(trace, 'error', d);
        } else if (event.type === 'text') {
          if (typeof d === 'string') text += d;
          else text += d.message || d.text || JSON.stringify(d);
        } else if (event.type === 'done') {
          if (text) {
            lastAssistantText = text;
            chatHistory = ProductApp.appendChatTurn(chatHistory, userMessage, text, 20);
            if (hasError) {
              trackEvent('ask_failed', { route: '/app', source: currentAskSource, category: currentAskCategory, reason: 'model_or_tool' });
            } else {
              trackEvent('ask_succeeded', { route: '/app', source: currentAskSource, category: currentAskCategory });
              addFeedback(el);
              addReceiptActions(el);
            }
          }
        } else if (event.type === 'receipt') {
          lastReceipt = d;
        } else if (event.type === 'tool_call') {
          if (!trace) trace = createTracePanel(el);
          addTraceItem(trace, 'tool_call', d);
        } else if (event.type === 'tool_result') {
          if (!trace) trace = createTracePanel(el);
          addTraceItem(trace, 'tool_result', d);
        } else if (event.type === 'status') {
          if (!trace) trace = createTracePanel(el);
          addTraceItem(trace, 'status', d);
        }
      } catch (err) {
        console.warn('Skipping malformed SSE event', err);
        if (trace) addTraceItem(trace, 'error', { message: 'Skipped malformed server event' });
      }
    }
    if (text) ensureContentEl().innerHTML = formatMd(text);
    el.closest('main').scrollTop = 1e6;
  }
  if (!text && !trace) el.textContent = 'No response. Try rephrasing.';
}

function addFeedback(el) {
  if (el.querySelector('.feedback')) return;
  const feedback = document.createElement('div');
  feedback.className = 'feedback';
  feedback.setAttribute('aria-label', 'Rate this answer');
  feedback.innerHTML = [
    '<button type="button" data-feedback="feedback_closer">Feels close</button>',
    '<button type="button" data-feedback="feedback_wrong_region">Wrong region</button>',
    '<button type="button" data-feedback="feedback_wrong_acid">Wrong acid</button>',
    '<button type="button" data-feedback="feedback_wrong_texture">Wrong texture</button>',
    '<button type="button" data-feedback="feedback_too_generic">Too generic</button>',
    '<button type="button" data-feedback="feedback_too_hard">Too hard to make</button>',
    '<button type="button" data-feedback="feedback_missed_name_correction">Did not correct my wording</button>',
  ].join('');
  feedback.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    sendFeedback(target.dataset.feedback || '');
    feedback.textContent = 'Feedback recorded. Thank you.';
  });
  el.appendChild(feedback);
}

function sendFeedback(eventName) {
  trackEvent(eventName, { route: '/app', category: 'answer_quality' });
}

function addReceiptActions(el) {
  if (!lastReceipt || el.querySelector('.receipt-actions')) return;
  const actions = document.createElement('div');
  actions.className = 'receipt-actions';
  actions.innerHTML = [
    '<button type="button" data-receipt-action="download">Download Memory Receipt</button>',
    '<button type="button" data-receipt-action="questions">Copy Family Questions</button>',
    '<button type="button" data-receipt-action="share">Copy Share Link</button>',
  ].join('');
  actions.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.dataset.receiptAction === 'download') downloadMemoryReceipt(lastReceipt);
    if (target.dataset.receiptAction === 'questions') await copyFamilyQuestions(lastReceipt, target);
    if (target.dataset.receiptAction === 'share') await copyReceiptShareLink(lastReceipt, target);
  });
  el.appendChild(actions);
}

function formatReceiptMarkdown(receipt) {
  const list = (items) => Array.isArray(items) && items.length
    ? items.map((item) => `- ${item}`).join('\n')
    : '- None recorded yet.';
  return [
    '# Achiote Memory Receipt',
    '',
    `Created: ${receipt.createdAt || new Date().toISOString()}`,
    `Status: ${receipt.status || 'unknown'}`,
    '',
    '## User-Said Evidence',
    list(receipt.evidence?.userSaid),
    '',
    '## Inferred Context',
    list(receipt.evidence?.inferred),
    '',
    '## Researched Or Source-Backed Facts',
    list(receipt.evidence?.researched),
    '',
    '## Unknowns',
    list(receipt.evidence?.unknown),
    '',
    '## Family Questions',
    list(receipt.nextBestQuestions),
    '',
    '## First Tiny Taste Test',
    receipt.firstTinyTasteTest
      ? `- ${receipt.firstTinyTasteTest.title}: ${receipt.firstTinyTasteTest.cue} (${receipt.firstTinyTasteTest.estimatedTime})`
      : '- Not ready yet. Answer the family questions first.',
    '',
    '## Assistant Summary',
    receipt.assistantSummary || '- No final summary recorded.',
    '',
  ].join('\n');
}

function downloadMemoryReceipt(receipt) {
  const blob = new Blob([formatReceiptMarkdown(receipt)], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'achiote-memory-receipt.md';
  link.click();
  URL.revokeObjectURL(url);
  trackEvent('receipt_downloaded', { route: '/app' });
}

async function copyFamilyQuestions(receipt, button) {
  const questions = Array.isArray(receipt?.nextBestQuestions) ? receipt.nextBestQuestions : [];
  const text = questions.map((question, index) => `${index + 1}. ${question}`).join('\n');
  if (!text) return;
  await navigator.clipboard.writeText(text);
  button.textContent = 'Questions copied';
  trackEvent('family_questions_copied', { route: '/app' });
}

function encodeReceiptForShare(receipt) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(receipt))));
}

async function copyReceiptShareLink(receipt, button) {
  if (!receipt) return;
  const url = new URL('/receipt', window.location.origin);
  url.hash = `data=${encodeReceiptForShare(receipt)}`;
  await navigator.clipboard.writeText(url.toString());
  button.textContent = 'Share link copied';
  trackEvent('receipt_share_copied', { route: '/app' });
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatMd(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n- /g, '\n&#8226; ')
    .replace(/\n(\d+)\. /g, '\n$1. ')
    .replace(/\n/g, '<br>');
}

// Theme toggle
const html = document.documentElement;
const themeBtn = document.getElementById('theme-toggle');
const stored = localStorage.getItem('achiote-theme');
if (stored) html.setAttribute('data-theme', stored);
else if (window.matchMedia('(prefers-color-scheme: dark)').matches) html.setAttribute('data-theme', 'dark');
themeBtn.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('achiote-theme', next);
});
