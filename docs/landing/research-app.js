/* Achiote: conversational food-memory researcher.
   External, CSP-safe (script-src 'self'); no inline handlers.
   Restores: threaded conversation (asks questions, you reply), one continuous
   Memory Receipt, live progress trace, well-formatted results, and voice-to-TEXT
   input (transcription only, no talk-back). */
(function () {
  'use strict';

  var ASK = '/ask';
  function $(id) { return document.getElementById(id); }

  var thread   = $('thread');
  var welcome  = $('welcome');
  var input    = $('composer-input');
  var sendBtn  = $('send-btn');
  var micBtn   = $('mic-btn');
  var vstatus  = $('voice-status');

  var history = [];            // full conversation, sent on every /ask  -> continuity
  var busy = false;
  var recorder = null, chunks = [], voiceReady = false;

  /* ----------------------------- helpers ----------------------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // Inline markdown (escape first, then format), XSS-safe.
  function inlineMd(t) {
    return esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\*])\*([^\*\n]+)\*/g, '$1<em>$2</em>');
  }
  function shapeAssistantText(s) {
    return String(s == null ? '' : s)
      .replace(/\r\n/g, '\n')
      .replace(/:\s+(1[.)]\s+)/g, ':\n\n$1')
      .replace(/([.!?])\s+(1[.)]\s+)/g, '$1\n\n$2')
      .replace(/(\S)\s+([2-9][.)]\s+)/g, '$1\n$2');
  }
  // Block-level markdown -> proper <p>/<ul>/<ol>/<h3>/<h4> so prose reads as typographic blocks.
  function md(s) {
    var blocks = shapeAssistantText(s).split(/\n{2,}/);
    var out = '';
    blocks.forEach(function (b) {
      var t = b.trim();
      if (!t) return;
      var lines = b.split('\n');
      if (/^###\s+/.test(t)) { out += '<h4>' + inlineMd(t.replace(/^###\s+/, '')) + '</h4>'; return; }
      if (/^##\s+/.test(t))  { out += '<h3>' + inlineMd(t.replace(/^##\s+/, '')) + '</h3>'; return; }
      if (lines.every(function (l) { return !l.trim() || /^\s*[-•*]\s+/.test(l); })) {
        out += '<ul>' + lines.filter(function (l) { return l.trim(); })
          .map(function (l) { return '<li>' + inlineMd(l.replace(/^\s*[-•*]\s+/, '')) + '</li>'; }).join('') + '</ul>';
        return;
      }
      if (lines.every(function (l) { return !l.trim() || /^\s*\d+[.)]\s+/.test(l); })) {
        out += '<ol>' + lines.filter(function (l) { return l.trim(); })
          .map(function (l) { return '<li>' + inlineMd(l.replace(/^\s*\d+[.)]\s+/, '')) + '</li>'; }).join('') + '</ol>';
        return;
      }
      out += '<p>' + inlineMd(t).replace(/\n/g, '<br>') + '</p>';
    });
    return out;
  }
  // The model streams the conversational reply as one run-on paragraph. Format it for
  // humans: break at clear transitions into paragraphs, and pull "- X" conditionals into
  // a bullet list. Splits only on " - " before a capital (never em-dashes or hyphenated
  // words), so it degrades gracefully on replies without that structure.
  function formatConversation(t) {
    var s = String(t == null ? '' : t).trim();
    if (!s) return '';
    // Inline " - X" conditionals become their own bullet lines.
    s = s.replace(/\s-\s(?=[A-Z])/g, '\n- ');
    // Break run-on text before clear structural transitions onto their own lines.
    // Break before any inline "Short Label:" intro (e.g. "First tiny check:", "What to
    // notice first:", "One question to narrow it down:") so each becomes its own block.
    s = s.replace(/([.!?])\s+(?=[A-Z][\w'’-]+(?: [\w'’-]+){0,6}:\s)/g, '$1\n');
    // Also break before BOLD labels ("**What you're checking:**") the model now emits.
    s = s.replace(/([.!?])\s+(?=\*\*[^*]{2,48}:\*\*)/g, '$1\n');
    // Render a text block as short, grouped paragraphs (~2 sentences) so nothing is a wall.
    function paragraphs(text, leadLabel) {
      var SEP = String.fromCharCode(1);
      var sents = text.replace(/([.!?…])\s+(?=[A-Z“"])/g, '$1' + SEP).split(SEP);
      var groups = [], cur = '';
      sents.forEach(function (sn) {
        sn = sn.trim(); if (!sn) return;
        if (cur && (cur.length + 1 + sn.length) <= 170) cur += ' ' + sn;
        else { if (cur) groups.push(cur); cur = sn; }
      });
      if (cur) groups.push(cur);
      return groups.map(function (g, i) {
        return (i === 0 && leadLabel)
          ? '<p><strong>' + inlineMd(leadLabel) + ':</strong> ' + inlineMd(g) + '</p>'
          : '<p>' + inlineMd(g) + '</p>';
      }).join('');
    }
    var lines = s.split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
    var html = '', inList = false;
    function closeList() { if (inList) { html += '</ul>'; inList = false; } }
    lines.forEach(function (line) {
      if (/^[-•]\s+/.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inlineMd(line.replace(/^[-•]\s+/, '')) + '</li>';
        return;
      }
      closeList();
      // "Short Label: rest" -> bold the label; everything renders as grouped paragraphs.
      var m = line.match(/^([A-Z][^:.!?]{2,40}):\s+([\s\S]+)$/);
      html += m ? paragraphs(m[2], m[1]) : paragraphs(line, '');
    });
    closeList();
    return html;
  }
  // Detect the dominant non-Latin script so the chat can render the assistant's reply
  // in the right font (and RTL) when it answers in the user's language.
  function detectLang(s) {
    if (/[一-鿿]/.test(s)) return 'zh';
    if (/[぀-ヿ]/.test(s)) return 'ja';
    if (/[가-힯]/.test(s)) return 'ko';
    if (/[؀-ۿ]/.test(s)) return 'ar';
    if (/[֐-׿]/.test(s)) return 'he';
    if (/[ऀ-ॿ]/.test(s)) return 'hi';
    if (/[ঀ-৿]/.test(s)) return 'bn';
    if (/[฀-๿]/.test(s)) return 'th';
    if (/[஀-௿]/.test(s)) return 'ta';
    if (/[Ѐ-ӿ]/.test(s)) return 'ru';
    return null;
  }
  function scrollDown() {
    if (!thread) return;
    var target = thread.lastElementChild || thread;
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'end', inline: 'nearest' });
  }
  function track(event, props) {
    if (window.AchioteTelemetry && typeof window.AchioteTelemetry.track === 'function') {
      window.AchioteTelemetry.track(event, props || {});
    }
  }

  /* --------------------------- chat messages ------------------------- */
  function addUser(text) {
    var el = document.createElement('div');
    el.className = 'msg user';
    el.textContent = text;          // user content is never HTML
    thread.appendChild(el);
    return el;
  }
  function addAI() {
    var el = document.createElement('div');
    el.className = 'msg ai';
    el.innerHTML = '<div class="typing" aria-label="Achiote is thinking"><span></span><span></span><span></span></div>';
    thread.appendChild(el);
    return el;
  }
  function clearTyping(aiEl) {
    var t = aiEl.querySelector('.typing');
    if (t) t.remove();
  }

  /* ------------------------------ trace ------------------------------ */
  function phaseLabel(d) {
    var tools = Array.isArray(d.tools) ? d.tools : [];
    function has(t) { return tools.indexOf(t) >= 0; }
    if (d.stage === 'thinking') return 'Weighing the evidence';
    if (has('collect_food_memory')) return 'Reading your memory';
    if (has('resolve_dish_name')) return 'Correcting the likely name';
    if (has('search_web') || has('build_research_record') || has('extract_research_findings')) return 'Researching sources';
    if (has('build_reconstruction_dossier')) return 'Separating evidence from inference';
    if (has('generate_minimum_viable_nostalgia')) return 'Building your first taste';
    if (d.stage === 'model') return d.retry ? 'Retrying the model' : 'Thinking';
    if (d.stage === 'calling_tools') return 'Checking which tools to use';
    return 'Working';
  }
  function ensureTrace(aiEl) {
    var trace = aiEl.querySelector('.trace');
    if (!trace) {
      clearTyping(aiEl);
      trace = document.createElement('div');
      trace.className = 'trace';
      var head = document.createElement('div');
      head.className = 'trace-head';
      head.textContent = 'What Achiote is doing';
      var list = document.createElement('div');
      list.className = 'trace-list';
      trace.appendChild(head);
      trace.appendChild(list);
      aiEl.appendChild(trace);
    }
    return trace.querySelector('.trace-list');
  }
  function addTrace(list, type, d) {
    var item = document.createElement('div');
    item.className = 'trace-item ' + type;
    var label;
    if (type === 'status') label = phaseLabel(d);
    else if (type === 'tool_call') label = 'Calling ' + (d.name || 'tool');
    else if (type === 'tool_result') label = 'Finished ' + (d.name || 'tool');
    else label = 'Note: ' + (d.message || d.error || 'issue');
    item.textContent = label;
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
  }

  /* --------------------------- the receipt --------------------------- */
  function group(label, items) {
    if (!Array.isArray(items) || !items.length) return '';
    return '<div class="r-group"><span class="r-label">' + esc(label) + '</span><ul>' +
      items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>';
  }
  function renderReceipt(aiEl, r, hasText) {
    if (!r) return;
    var ev = r.evidence || {};
    var qs = Array.isArray(r.nextBestQuestions) ? r.nextBestQuestions : [];
    var taste = r.firstTinyTasteTest;
    var hyps = Array.isArray(r.hypotheses) ? r.hypotheses : [];
    var conf = (hyps[0] && hyps[0].confidence) || 'Low';
    var hasResearch = Array.isArray(ev.researched) && ev.researched.length > 0;
    // Confidence gate: only graduate to a receipt once there is a real answer — a
    // Medium/High hypothesis backed by an actual research finding. Until then, stay in
    // conversation and ask the questions in chat, so the user reads them instead of
    // jumping to a receipt that should not exist yet.
    var confident = /high|medium/i.test(conf) && hasResearch;
    if (!confident) {
      if (hasText || !qs.length) return;   // the streamed prose already carries the ask
      var cw = document.createElement('div');
      cw.className = 'ai-text';
      cw.innerHTML = '<strong>To narrow this down, a few questions:</strong><ol>' +
        qs.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol>';
      aiEl.appendChild(cw);
      return;
    }
    var html = '<div class="receipt-paper" role="group" aria-label="Memory Receipt">';
    html += '<h3>Memory Receipt</h3>';
    html += '<p class="r-meta">' + esc(r.status ? String(r.status) : 'Generated from your memory') + '</p>';
    // The receipt is the final answer. Lead with the identification + why, then a
    // clearly separated "first taste". Split the synthesized summary at the bite marker
    // so neither becomes one giant block.
    var hasSummary = r.assistantSummary && String(r.assistantSummary).trim();
    if (hasSummary) {
      var sum = String(r.assistantSummary).trim();
      var parts = sum.split(/\*\*\s*first[-\s]?pass verification bite:?\s*\*\*/i);
      var lead = parts[0].trim();
      var bite = parts.length > 1 ? parts.slice(1).join(' ').trim() : '';
      if (lead) {
        html += '<div class="r-answer"><span class="r-label">Most likely</span>' +
          '<div class="r-answer-body">' + md(lead) + '</div></div>';
      }
      if (bite) {
        html += '<div class="r-taste"><span class="r-label">First taste to try</span>' +
          '<div class="r-taste-body">' + md(bite) + '</div></div>';
      }
    }
    html += group('You said', ev.userSaid);
    html += group('Researched', ev.researched);
    html += group('Inferred', ev.inferred);
    html += group('Still unknown', ev.unknown);
    if (qs.length) {
      html += '<div class="r-questions"><span class="r-label">To confirm, ask family or your next source</span><ol>' +
        qs.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol></div>';
    }
    if (!hasSummary && taste && (taste.cue || taste.title)) {
      html += '<div class="r-taste"><span class="r-label">First taste' +
        (taste.estimatedTime ? ' · ' + esc(taste.estimatedTime) : '') + '</span>' +
        '<p class="cue">' + esc(taste.cue || taste.title) + '</p></div>';
    }
    html += '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    aiEl.appendChild(wrap.firstChild);
    return true;
  }

  /* ------------------------- SSE stream parse ------------------------ */
  function parseBlock(block) {
    var type = 'message', dataLines = [];
    var lines = block.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf(':') === 0) continue;                 // comment
      if (line.indexOf('event:') === 0) type = line.slice(6).trim();
      else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    return { type: type, data: dataLines.join('\n') };
  }

  function streamInto(res, aiEl, userText) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '', text = '', receipt = null, contentEl = null;

    function content() {
      if (!contentEl) {
        clearTyping(aiEl);
        contentEl = document.createElement('div');
        contentEl.className = 'ai-text';
        aiEl.appendChild(contentEl);   // prose sits after the live trace (trace -> text -> receipt)
      }
      return contentEl;
    }
    function handle(block) {
      if (!block.trim()) return;
      var ev = parseBlock(block);
      if (!ev.data) return;
      var d;
      try { d = JSON.parse(ev.data); } catch (_) { return; }
      if (ev.type === 'status' || ev.type === 'tool_call' || ev.type === 'tool_result') {
        addTrace(ensureTrace(aiEl), ev.type, d);
      } else if (ev.type === 'text') {
        text += (typeof d === 'string') ? d : (d.message || d.text || '');
        content().innerHTML = formatConversation(text);
      } else if (ev.type === 'receipt') {
        receipt = d;
      } else if (ev.type === 'error') {
        addTrace(ensureTrace(aiEl), 'error', d);
      }
    }

    return (function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          if (buf.trim()) handle(buf);
          clearTyping(aiEl);
          aiEl.classList.add('complete');
          // App meets you in your language: tag the reply's script so it gets the right font + RTL.
          var lg = detectLang(text);
          if (lg) { aiEl.setAttribute('lang', lg); if (lg === 'ar' || lg === 'he') aiEl.setAttribute('dir', 'rtl'); }
          var didReceipt = receipt ? renderReceipt(aiEl, receipt, !!text) : false;
          // When a receipt is shown it carries the answer, so the streamed prose just
          // repeats it — remove the prose. On conversation turns (no receipt) keep the
          // prose: it is the agent's reply.
          if (didReceipt && contentEl) {
            if (contentEl.parentNode) contentEl.parentNode.removeChild(contentEl);
            contentEl = null;
          }
          if (!text && !receipt) {
            content().textContent = 'No response came back. Try rephrasing the memory.';
          }
          // continuity: extend the single ongoing conversation
          history = history.concat([
            { role: 'user', content: userText },
            { role: 'assistant', content: text || '(memory receipt)' }
          ]).slice(-20);
          scrollDown();
          return;
        }
        buf += dec.decode(r.value, { stream: true });
        var parts = buf.split(/\r?\n\r?\n/);
        buf = parts.pop();
        for (var i = 0; i < parts.length; i++) handle(parts[i]);
        scrollDown();
        return pump();
      });
    })();
  }

  /* ------------------------------ auth ------------------------------- */
  function headers() {
    return { 'Content-Type': 'application/json' };
  }

  /* --------------------------- send / run ---------------------------- */
  function run(aiEl, message, metadata) {
    busy = true; sendBtn.disabled = true;
    track('ask_started', {
      source: metadata && metadata.source || 'typed',
      category: metadata && metadata.category || 'none',
      hasHistory: history.length > 0
    });
    return fetch(ASK, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ message: message, history: history, consent: { qualitySignals: false } })
    }).then(function (res) {
      if (!res.ok) throw new Error('status ' + res.status);
      return streamInto(res, aiEl, message).then(function () {
        track('ask_succeeded', {
          source: metadata && metadata.source || 'typed',
          category: metadata && metadata.category || 'none',
          hasHistory: history.length > 0
        });
      });
    }).catch(function (err) {
      clearTyping(aiEl);
      var e = document.createElement('div');
      e.className = 'ai-text err';
      e.textContent = 'Something interrupted the researcher. Give it another try in a moment.';
      aiEl.appendChild(e);
      track('ask_failed', {
        source: metadata && metadata.source || 'typed',
        category: metadata && metadata.category || 'none',
        hasHistory: history.length > 0,
        reason: 'request_failed'
      });
    }).then(function () {
      busy = false; sendBtn.disabled = false; input.focus();
    });
  }

  function send(text, metadata) {
    var val = (text != null ? text : input.value).trim();
    if (!val || busy) return;
    input.value = '';
    if (welcome) welcome.classList.add('hide');
    thread.classList.add('active');
    addUser(val);
    var aiEl = addAI();
    scrollDown();
    run(aiEl, val, metadata || { source: 'typed', category: 'none' });
  }

  /* --------------------------- voice (STT) --------------------------- */
  function initVoice() {
    if (!micBtn) return;
    micBtn.hidden = true;
    fetch('/voice/status').then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
      var ready = cfg && cfg.stt && cfg.stt.ready;
      var canRecord = navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof MediaRecorder !== 'undefined';
      if (!ready || !canRecord) return;            // progressive enhancement
      voiceReady = true;
      micBtn.hidden = false;
    }).catch(function () { /* mic stays hidden; chat works */ });
  }
  function b64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '').split(',')[1] || ''); };
      fr.onerror = function () { reject(new Error('read')); };
      fr.readAsDataURL(blob);
    });
  }
  function toggleMic() {
    if (!voiceReady) return;
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    track('voice_started', { source: 'mic' });
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.addEventListener('dataavailable', function (e) { if (e.data.size > 0) chunks.push(e.data); });
      recorder.addEventListener('stop', function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        micBtn.classList.remove('recording');
        micBtn.setAttribute('aria-pressed', 'false');
        transcribe(new Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' }));
      });
      micBtn.classList.add('recording');
      micBtn.setAttribute('aria-pressed', 'true');
      if (vstatus) vstatus.textContent = 'Listening… tap the mic again to stop.';
      recorder.start();
    }).catch(function () {
      if (vstatus) vstatus.textContent = 'Microphone permission is needed for voice input.';
      track('voice_failed', { source: 'mic', reason: 'permission' });
    });
  }
  function transcribe(blob) {
    if (vstatus) vstatus.textContent = 'Transcribing…';
    b64(blob).then(function (audioBase64) {
      return fetch('/voice/transcribe', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ audioBase64: audioBase64, mediaType: blob.type || 'audio/webm', language: 'auto' })
      });
    }).then(function (r) { if (!r.ok) throw new Error('stt'); return r.json(); })
      .then(function (body) {
        input.value = (input.value ? input.value + ' ' : '') + (body.text || '');
        input.focus();
        if (vstatus) vstatus.textContent = 'Transcript ready. Fix any names or spelling, then send.';
        track('voice_transcribed', { source: 'mic' });
      })
      .catch(function () {
        if (vstatus) vstatus.textContent = 'Could not transcribe that. Try typing instead.';
        track('voice_failed', { source: 'mic', reason: 'transcription' });
      });
  }

  /* ----------------------------- wire up ----------------------------- */
  sendBtn.addEventListener('click', function () { send(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !busy) { e.preventDefault(); send(); }
  });
  if (micBtn) micBtn.addEventListener('click', toggleMic);
  Array.prototype.forEach.call(document.querySelectorAll('.suggestion'), function (b) {
    b.addEventListener('click', function () {
      var category = b.getAttribute('data-category') || 'demo';
      track('onboarding_prompt_selected', { source: 'suggestion', category: category });
      send(b.getAttribute('data-fill') || b.textContent, { source: 'suggestion', category: category });
    });
  });

  initVoice();
})();
