const input = document.getElementById('input');
const btn = document.getElementById('send-btn');
const welcome = document.getElementById('welcome');
const messages = document.getElementById('messages');
let busy = false;
let chatHistory = [];
let nextMessageSource = 'typed';
let suggestionCategory = '';
let currentAskSource = 'typed';
let currentAskCategory = 'none';

function trackEvent(event, properties = {}) {
  if (!event || typeof event !== 'string') return;
  const safeProperties = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    safeProperties[key] = String(value).slice(0, 80);
  }
  const body = JSON.stringify({ event, properties: safeProperties, at: new Date().toISOString() });
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

trackEvent('app_opened', { route: '/app' });

// Add event listeners for suggestion buttons
document.querySelectorAll('.suggestion').forEach(button => {
  button.addEventListener('click', () => {
    suggestionCategory = button.dataset.suggestionCategory || 'unknown';
    nextMessageSource = 'suggestion';
    trackEvent('onboarding_prompt_selected', { route: '/app', category: suggestionCategory });
    send(button.dataset.suggestion);
  });
});

// Add event listener for send button
btn.addEventListener('click', () => send());

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !busy) {
    e.preventDefault();
    send();
  }
});

function send(text) {
  const val = (text || input.value).trim();
  if (!val || busy) return;
  const source = text ? nextMessageSource : 'typed';
  currentAskSource = text ? source : 'typed';
  currentAskCategory = suggestionCategory || 'none';
  trackEvent('ask_started', { route: '/app', source: text ? source : 'typed', category: currentAskCategory, hasHistory: chatHistory.length > 0 });
  nextMessageSource = 'typed';
  suggestionCategory = '';
  input.value = '';

  welcome.classList.add('hide');
  messages.classList.add('active');

  addMsg('user', val);
  const aiEl = addMsg('ai', '<div class="typing"><span></span><span></span><span></span></div>');

  busy = true;
  btn.disabled = true;

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

  fetch('/ask', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: val, history: chatHistory }),
  })
  .then(async res => {
    if (!res.ok) throw new Error(await explainHttpError(res));
    return streamResponse(res, aiEl, val);
  })
  .catch(err => {
    const reason = err.message.includes('Rate limit') ? 'rate_limited' : err.message.includes('Authentication') ? 'auth' : 'request';
    trackEvent('ask_failed', { route: '/app', source: currentAskSource, category: currentAskCategory, reason });
    aiEl.textContent = err.message.includes('fetch')
      ? 'Server not running. Start it with node dist/http-server.js.'
      : err.message;
  })
  .finally(() => { busy = false; btn.disabled = false; input.focus(); });
}

async function explainHttpError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error || body?.message || body?.error?.message || '';
  } catch {
    detail = 'Could not parse server response';
  }

  if (res.status === 401) return `Authentication required. Enter your API key or demo password. ${detail}`.trim();
  if (res.status === 429) return `Rate limit exceeded. ${detail}`.trim();
  if (res.status === 413) return `Message is too large. ${detail}`.trim();
  if (res.status === 415) return `Server expected JSON but received a different content type. ${detail}`.trim();
  return `Server error ${res.status}. ${detail || 'Could not parse server response'}`.trim();
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
  const trace = document.createElement('div');
  trace.className = 'trace-panel';
  trace.style.cssText = 'margin-top:8px;padding:10px 12px;background:#f6f3ef;border-radius:8px;font-size:12px;color:#6b5e51;border:1px solid #e8e0d8;max-height:200px;overflow-y:auto;';
  aiEl.appendChild(trace);
  return trace;
}

function addTraceItem(trace, type, data) {
  const item = document.createElement('div');
  item.style.cssText = 'margin-bottom:6px;padding:4px 0;border-bottom:1px dashed #e8e0d8;';
  const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (type === 'status') {
    const stageLabel = data.stage === 'calling_tools' ? `Step ${data.iteration}: calling tools` : `Step ${data.iteration}: thinking...`;
    const tools = data.tools ? ` (${data.tools.join(', ')})` : '';
    item.innerHTML = `<span style="color:#b5451b;font-weight:600;">[${time}]</span> ${stageLabel}${tools}`;
  } else if (type === 'tool_call') {
    const inputSummary = summarizeInput(data.input);
    item.innerHTML = `<span style="color:#b5451b;font-weight:600;">[${time}]</span> → <strong>${data.name}</strong> <span style="color:#888;font-size:11px;">${inputSummary}</span>`;
  } else if (type === 'tool_result') {
    const resultSummary = summarizeResult(data.name, data.result);
    item.innerHTML = `<span style="color:#2a8a3e;font-weight:600;">[${time}]</span> ← <strong>${data.name}</strong> <span style="color:#888;font-size:11px;">${resultSummary}</span>`;
  } else if (type === 'error') {
    item.innerHTML = `<span style="color:#c0392b;font-weight:600;">[${time}]</span> ⚠️ ${data.message || data}`;
  }

  trace.appendChild(item);
  trace.scrollTop = 1e6;
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });

    const lines = pending.split('\n');
    pending = lines.pop() ?? '';

    let eventType = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith('data: ')) {
        try {
          const d = JSON.parse(line.slice(6));
          if (eventType === 'error') {
            hasError = true;
            text += d.message || d.error || JSON.stringify(d);
            if (trace) addTraceItem(trace, 'error', d);
          } else if (eventType === 'text') {
            if (typeof d === 'string') text += d;
            else text += d.message || d.text || JSON.stringify(d);
          } else if (eventType === 'done') {
            if (text) {
              chatHistory.push({ role: 'user', content: userMessage });
              chatHistory.push({ role: 'assistant', content: text });
              // Keep history bounded to last 10 turns to avoid token bloat
              if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
              if (hasError) {
                trackEvent('ask_failed', { route: '/app', source: currentAskSource, category: currentAskCategory, reason: 'model_or_tool' });
              } else {
                trackEvent('ask_succeeded', { route: '/app', source: currentAskSource, category: currentAskCategory });
                addFeedback(el);
              }
            }
          } else if (eventType === 'tool_call') {
            if (!trace) trace = createTracePanel(el);
            addTraceItem(trace, 'tool_call', d);
          } else if (eventType === 'tool_result') {
            if (!trace) trace = createTracePanel(el);
            addTraceItem(trace, 'tool_result', d);
          } else if (eventType === 'status') {
            if (!trace) trace = createTracePanel(el);
            addTraceItem(trace, 'status', d);
          }
        } catch (err) {
          console.warn('Skipping malformed SSE event', err);
          if (trace) addTraceItem(trace, 'error', { message: 'Skipped malformed server event' });
        }
      }
    }
    if (text) el.innerHTML = formatMd(text);
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
    '<button type="button" data-feedback="feedback_helpful">Helpful</button>',
    '<button type="button" data-feedback="feedback_generic">Too generic</button>',
    '<button type="button" data-feedback="feedback_wrong_region">Wrong region</button>',
    '<button type="button" data-feedback="feedback_unsafe">Safety issue</button>',
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
