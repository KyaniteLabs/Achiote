const input = document.getElementById('input');
const btn = document.getElementById('send-btn');
const welcome = document.getElementById('welcome');
const messages = document.getElementById('messages');
let busy = false;

// Add event listeners for suggestion buttons
document.querySelectorAll('.suggestion').forEach(button => {
  button.addEventListener('click', () => send(button.dataset.suggestion));
});

// Add event listener for send button
btn.addEventListener('click', () => send());

input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !busy) send(); });

function send(text) {
  const val = (text || input.value).trim();
  if (!val || busy) return;
  input.value = '';

  welcome.classList.add('hide');
  messages.classList.add('active');

  addMsg('user', val);
  const aiEl = addMsg('ai', '<div class="typing"><span></span><span></span><span></span></div>');

  busy = true;
  btn.disabled = true;

  const apiKey = document.getElementById('api-key')?.value || '';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  fetch('/ask', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: val }),
  })
  .then(res => {
    if (!res.ok) throw new Error(`Server ${res.status}`);
    return streamResponse(res, aiEl);
  })
  .catch(err => {
    const safeMsg = escapeHtml(err.message);
    aiEl.textContent = err.message.includes('fetch')
      ? 'Server not running. Start it with npm run demo.'
      : `Error: ${safeMsg}`;
  })
  .finally(() => { busy = false; btn.disabled = false; input.focus(); });
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

async function streamResponse(res, el) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';
  let hasError = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });

    const lines = pending.split('\n');
    pending = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('event: error')) {
        hasError = true;
      } else if (line.startsWith('data: ')) {
        try {
          const d = JSON.parse(line.slice(6));
          if (typeof d === 'string') text += d;
          else if (hasError) text += d.message || d.error || JSON.stringify(d);
        } catch { /* skip */ }
      }
    }
    if (text) el.innerHTML = formatMd(text);
    el.closest('main').scrollTop = 1e6;
  }
  if (!text) el.textContent = 'No response. Try rephrasing.';
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
