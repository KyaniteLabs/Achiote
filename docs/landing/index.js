document.documentElement.classList.add('js');

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
    // Telemetry should never interrupt the marketing page.
  }
}

trackEvent('page_view', { route: '/' });

// Dark mode
const themeToggle = document.getElementById('theme-toggle');
const html = document.documentElement;
const stored = localStorage.getItem('achiote-theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
if (stored) { html.setAttribute('data-theme', stored); }
else if (prefersDark) { html.setAttribute('data-theme', 'dark'); }
themeToggle.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('achiote-theme', next);
});

// Scroll reveal
const reveals = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
reveals.forEach(el => observer.observe(el));

const pricing = document.getElementById('pricing');
if (pricing) {
  let pricingTracked = false;
  const pricingObserver = new IntersectionObserver((entries) => {
    if (pricingTracked) return;
    if (entries.some(entry => entry.isIntersecting)) {
      pricingTracked = true;
      trackEvent('pricing_viewed', { route: '/' });
      pricingObserver.disconnect();
    }
  }, { threshold: 0.35 });
  pricingObserver.observe(pricing);
}

// Copy terminal
async function copyTerminal(btn) {
  const pre = btn.nextElementSibling;
  const text = pre.innerText;
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = 'Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 2000);
  } catch (e) {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  }
}

// Wire up copy buttons via addEventListener (CSP blocks inline onclick)
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', () => copyTerminal(btn));
});

// Try-it widget
function runTryIt() {
  const input = document.getElementById('tryit-input');
  const output = document.getElementById('tryit-output');
  const val = input.value.trim();
  if (!val) return;
  const responses = [
    `<p><strong>Memory fragment captured.</strong></p><p>Possible clues: region (family recipe), texture (wrapped/fried), phonetic similarity to "pasteles." Next step: ask about the leaf, the masa texture, and whether it was boiled or steamed.</p>`,
    `<p><strong>Sensory decomposition:</strong></p><p>Smell → toast/herb/sesame. Texture → soft interior, maybe starchy carrier. Sound → "everyone got quiet" suggests ritual significance. Recommended first test: one bite of toasted sesame oil on warm rice.</p>`,
    `<p><strong>Pattern match:</strong></p><p>Input matches "sour + pale + dill + dairy" profile. Likely Eastern European or Central Asian soup family. Acid source unknown — could be fermented dairy, vinegar, or lemon. Test: a warm sip with dill and a spoonful of yogurt.</p>`
  ];
  const pick = responses[Math.floor(Math.random() * responses.length)];
  output.innerHTML = '';
  const parsed = new DOMParser().parseFromString(pick, 'text/html');
  output.replaceChildren(...parsed.body.childNodes);
  output.classList.add('active');
}
const tryitInput = document.getElementById('tryit-input');
if (tryitInput) {
  tryitInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runTryIt();
  });
}

// ── Checkout ────────────────────────────────────────────────────────────────

async function startCheckout(tier, mode, billing = 'monthly', trigger) {
  trackEvent('checkout_started', { route: '/', tier, mode, billing });
  const btn = trigger;
  const original = btn.textContent;
  btn.textContent = 'Redirecting…';
  btn.disabled = true;
  try {
    const res = await fetch('/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, mode, billing }),
    });
    const data = await res.json();
    if (res.ok && data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Checkout failed');
    }
  } catch (err) {
    trackEvent('checkout_failed', { route: '/', tier, mode, billing });
    alert('Checkout error: ' + err.message);
    btn.textContent = original;
    btn.disabled = false;
  }
}

// Wire up checkout buttons (CSP blocks inline onclick)
document.querySelectorAll('[data-checkout-tier]').forEach(btn => {
  const tier = btn.dataset.checkoutTier;
  const mode = btn.dataset.checkoutMode || 'subscription';
  const billing = btn.dataset.checkoutBilling || 'monthly';
  btn.addEventListener('click', () => startCheckout(tier, mode, billing, btn));
});

const creditPackLink = document.getElementById('credit-pack-link');
if (creditPackLink) {
  creditPackLink.addEventListener('click', (e) => {
    e.preventDefault();
    startCheckout('memory-pack', 'payment', 'monthly', creditPackLink);
  });
}
