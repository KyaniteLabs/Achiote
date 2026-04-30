document.documentElement.classList.add('js');

const CONSENT_ANALYTICS_KEY = 'achiote-consent-analytics';

function isAnalyticsConsentEnabled() {
  try {
    return localStorage.getItem(CONSENT_ANALYTICS_KEY) === 'true';
  } catch {
    return false;
  }
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

// Animated counters — animate when scrolled into view
let countersAnimated = false;
function animateCounters() {
  if (countersAnimated) return;
  const socialSection = document.querySelector('.social-proof-grid');
  if (!socialSection) return;
  const counterObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      countersAnimated = true;
      document.querySelectorAll('.count-up').forEach(el => {
        const target = parseInt(el.dataset.target, 10);
        const from = parseInt(el.textContent, 10) || 0;
        const duration = 1200;
        const start = performance.now();
        function update(now) {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = Math.round(from + eased * (target - from));
          if (progress < 1) requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
      });
      counterObserver.disconnect();
    }
  }, { threshold: 0.4 });
  counterObserver.observe(socialSection);
}
animateCounters();

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
