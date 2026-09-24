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

const waitlistForm = document.getElementById('waitlist-form');
if (waitlistForm) {
  waitlistForm.addEventListener('submit', () => {
    const input = document.getElementById('waitlist-email');
    const email = input instanceof HTMLInputElement ? input.value.trim() : '';
    const domain = email.includes('@') ? email.split('@').pop().toLowerCase() : 'unknown';
    trackEvent('waitlist_submitted', { route: '/', source: 'hero', emailDomain: domain });
    const note = document.getElementById('waitlist-note');
    if (note) note.textContent = 'Thanks. Your email app will open so you can send the launch request.';
  });
}

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
    // Stripe unconfigured/unavailable: fall back to direct-to-wallet crypto when enabled.
    const cryptoOn = await cryptoConfigured();
    if (cryptoOn) {
      trackEvent('checkout_fallback_crypto', { route: '/', tier, mode, billing });
      btn.textContent = original;
      btn.disabled = false;
      openCryptoCheckout(tier, mode);
      return;
    }
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

// ── Crypto checkout (direct-to-wallet Solana: SOL + USDC) ────────────────────
// Crypto stays hidden until the server reports it configured (ACHIOTE_CRYPTO_SOL_ADDRESS
// set); when Stripe billing is unconfigured, the primary tier buttons fall back here.

let cryptoConfiguredPromise = null;
function cryptoConfigured() {
  if (!cryptoConfiguredPromise) {
    cryptoConfiguredPromise = fetch('/health')
      .then(res => (res.ok ? res.json() : {}))
      .then(body => Boolean(body.cryptoEnabled))
      .catch(() => false);
  }
  return cryptoConfiguredPromise;
}

cryptoConfigured().then(enabled => {
  if (enabled) {
    document.querySelectorAll('.crypto-pay-link').forEach(link => { link.hidden = false; });
  }
});

document.querySelectorAll('.crypto-pay-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    openCryptoCheckout(link.dataset.cryptoTier, link.dataset.cryptoMode || 'subscription');
  });
});

// When Stripe is down/unconfigured, primary buttons route to crypto via startCheckout's
// catch block above; the helpers below stay inert until crypto is configured.

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function injectCryptoStyles() {
  if (document.getElementById('crypto-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'crypto-modal-styles';
  style.textContent = `
.crypto-backdrop { position: fixed; inset: 0; background: rgba(42,24,16,0.55); display: flex; align-items: center; justify-content: center; padding: 1.25rem; z-index: 200; }
.crypto-modal { background: var(--cream, #FFF7E8); color: var(--ink, #2A1810); border-radius: 16px; box-shadow: 0 8px 32px rgba(42,24,16,0.18); max-width: 26rem; width: 100%; padding: 1.75rem; max-height: 92vh; overflow-y: auto; }
.crypto-modal h2 { margin: 0 0 0.25rem; font-size: 1.35rem; }
.crypto-modal .crypto-sub { color: var(--muted, #8B7355); font-size: 0.9rem; margin: 0 0 1rem; }
.crypto-qr { display: flex; justify-content: center; margin: 0.75rem 0 1rem; background: #fff; border-radius: 12px; padding: 0.75rem; }
.crypto-qr svg { width: 13rem; height: 13rem; }
.crypto-row { display: flex; align-items: center; gap: 0.5rem; margin: 0.5rem 0; }
.crypto-row label { flex: 0 0 4.5rem; color: var(--muted, #8B7355); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
.crypto-row code { flex: 1; word-break: break-all; font-size: 0.8rem; background: rgba(42,24,16,0.05); border-radius: 8px; padding: 0.4rem 0.5rem; }
.crypto-copy { border: none; background: var(--achiote, #C75B3A); color: #fff; border-radius: 8px; padding: 0.35rem 0.7rem; font-size: 0.75rem; cursor: pointer; }
.crypto-copy:hover { opacity: 0.85; }
.crypto-copy.copied { background: #2D8A4E; }
.crypto-asset-toggle { display: flex; gap: 0.5rem; margin: 0.75rem 0; }
.crypto-asset-btn { flex: 1; border: 1px solid var(--achiote, #C75B3A); background: transparent; color: var(--achiote, #C75B3A); border-radius: 10px; padding: 0.5rem; font-size: 0.9rem; cursor: pointer; }
.crypto-asset-btn.active { background: var(--achiote, #C75B3A); color: #fff; }
.crypto-countdown { text-align: center; color: var(--muted, #8B7355); font-size: 0.8rem; margin: 0.75rem 0; }
.crypto-status { text-align: center; font-size: 0.9rem; margin: 0.5rem 0 0; min-height: 1.25rem; }
.crypto-primary { display: block; width: 100%; border: none; background: var(--achiote, #C75B3A); color: #fff; border-radius: 12px; padding: 0.75rem; font-size: 1rem; cursor: pointer; margin-top: 0.75rem; }
.crypto-primary:hover { opacity: 0.9; }
.crypto-primary:disabled { opacity: 0.5; cursor: default; }
.crypto-close { border: none; background: transparent; color: var(--muted, #8B7355); font-size: 0.85rem; cursor: pointer; display: block; margin: 0.5rem auto 0; }
  `;
  document.head.appendChild(style);
}

function copyText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}

function cryptoModalShell() {
  injectCryptoStyles();
  const backdrop = document.createElement('div');
  backdrop.className = 'crypto-backdrop';
  const modal = document.createElement('div');
  modal.className = 'crypto-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Pay with crypto');
  backdrop.appendChild(modal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeCryptoModal(backdrop); });
  document.body.appendChild(backdrop);
  const close = document.createElement('button');
  close.className = 'crypto-close';
  close.textContent = 'Close';
  close.addEventListener('click', () => closeCryptoModal(backdrop));
  return { backdrop, modal, close };
}

function closeCryptoModal(backdrop) {
  backdrop.remove();
  if (cryptoPollState.timer) { clearInterval(cryptoPollState.timer); cryptoPollState.timer = null; }
}

const cryptoPollState = { timer: null };

function fmtCountdown(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

async function openCryptoCheckout(tier, mode, asset) {
  trackEvent('crypto_checkout_started', { route: '/', tier, mode, asset: asset || 'sol' });
  const { backdrop, modal, close } = cryptoModalShell();
  modal.innerHTML = '<h2>Pay with crypto</h2><p class="crypto-sub">Creating your order…</p>';
  modal.appendChild(close);

  let order;
  try {
    const res = await fetch('/billing/crypto-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, mode, asset: asset || 'sol' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Crypto checkout failed');
    order = data;
  } catch (err) {
    trackEvent('crypto_checkout_failed', { route: '/', tier, mode });
    modal.innerHTML = '<h2>Pay with crypto</h2><p class="crypto-sub">' + escapeHtml(err.message) + '</p>';
    modal.appendChild(close);
    return;
  }

  const isUsdc = order.asset === 'usdc';
  modal.innerHTML = ''
    + '<h2>Pay with crypto</h2>'
    + '<p class="crypto-sub">Scan with any Solana wallet (Phantom, Solflare, Backpack). The payment reference tells the server it is yours.</p>'
    + '<p class="crypto-sub">Sending manually instead of scanning? Include the Reference above as your transaction memo — without it, your payment cannot be matched to your order.</p>'
    + '<div class="crypto-asset-toggle">'
    + '<button type="button" class="crypto-asset-btn' + (isUsdc ? '' : ' active') + '" data-asset="sol">SOL</button>'
    + '<button type="button" class="crypto-asset-btn' + (isUsdc ? ' active' : '') + '" data-asset="usdc">USDC</button>'
    + '</div>'
    + '<div class="crypto-qr" id="crypto-qr"></div>'
    + '<div class="crypto-row"><label>Amount</label><code id="crypto-amount"></code><button type="button" class="crypto-copy" id="crypto-copy-amount">Copy</button></div>'
    + '<div class="crypto-row"><label>Address</label><code id="crypto-address"></code><button type="button" class="crypto-copy" id="crypto-copy-address">Copy</button></div>'
    + '<div class="crypto-row"><label>Reference</label><code id="crypto-ref"></code><button type="button" class="crypto-copy" id="crypto-copy-ref">Copy</button></div>'
    + '<p class="crypto-countdown" id="crypto-countdown"></p>'
    + '<button type="button" class="crypto-primary" id="crypto-sent">I have sent the payment</button>'
    + '<p class="crypto-status" id="crypto-status"></p>';
  modal.appendChild(close);

  modal.querySelector('#crypto-amount').textContent = order.amount + ' ' + order.asset.toUpperCase();
  modal.querySelector('#crypto-address').textContent = order.address;
  modal.querySelector('#crypto-ref').textContent = order.ref;
  modal.querySelector('#crypto-copy-amount').addEventListener('click', (e) => copyText(e.currentTarget, order.amount));
  modal.querySelector('#crypto-copy-address').addEventListener('click', (e) => copyText(e.currentTarget, order.address));
  modal.querySelector('#crypto-copy-ref').addEventListener('click', (e) => copyText(e.currentTarget, order.ref));

  try {
    if (typeof qrcode === 'function') {
      const qr = qrcode(0, 'M');
      qr.addData(order.uri);
      qr.make();
      modal.querySelector('#crypto-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    }
  } catch (err) {
    modal.querySelector('#crypto-qr').textContent = '';
  }

  modal.querySelectorAll('.crypto-asset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      closeCryptoModal(backdrop);
      openCryptoCheckout(tier, mode, btn.dataset.asset);
    });
  });

  const countdownEl = modal.querySelector('#crypto-countdown');
  const statusEl = modal.querySelector('#crypto-status');
  const sentBtn = modal.querySelector('#crypto-sent');
  const expiresAtMs = order.expiresAtMs || (Date.now() + 60 * 60 * 1000);

  const countdownTimer = setInterval(() => {
    if (!backdrop.isConnected) { clearInterval(countdownTimer); return; }
    countdownEl.textContent = 'Order expires in ' + fmtCountdown(expiresAtMs - Date.now());
    if (Date.now() >= expiresAtMs) clearInterval(countdownTimer);
  }, 1000);
  countdownEl.textContent = 'Order expires in ' + fmtCountdown(expiresAtMs - Date.now());

  function stopAll() {
    clearInterval(countdownTimer);
    if (cryptoPollState.timer) { clearInterval(cryptoPollState.timer); cryptoPollState.timer = null; }
  }

  function pollOnce() {
    return fetch('/billing/crypto-status?ref=' + encodeURIComponent(order.ref))
      .then(res => res.json().then(body => ({ res, body })))
      .then(({ res, body }) => {
        if (res.ok && body.status === 'paid') {
          stopAll();
          statusEl.textContent = 'Payment confirmed. Opening your API key…';
          trackEvent('crypto_checkout_paid', { route: '/', tier, mode, asset: order.asset });
          window.location.href = '/billing/success?session_id=' + encodeURIComponent(body.sessionId || ('crypto:' + order.ref));
          return;
        }
        if (res.ok && body.status === 'expired') {
          stopAll();
          sentBtn.disabled = true;
          statusEl.textContent = 'This order expired. Close and start a new one.';
          return;
        }
        statusEl.textContent = 'Waiting for your payment on-chain…';
      })
      .catch(() => {
        statusEl.textContent = 'Still checking…';
      });
  }

  sentBtn.addEventListener('click', () => {
    sentBtn.disabled = true;
    sentBtn.textContent = 'Checking…';
    void pollOnce();
    if (cryptoPollState.timer) clearInterval(cryptoPollState.timer);
    cryptoPollState.timer = setInterval(() => {
      if (Date.now() >= expiresAtMs) { stopAll(); sentBtn.disabled = true; statusEl.textContent = 'This order expired. Close and start a new one.'; return; }
      void pollOnce();
    }, 5000);
  });

  document.addEventListener('visibilitychange', function onVisible() {
    if (!document.hidden && cryptoPollState.timer) void pollOnce();
    if (backdrop.isConnected === false) document.removeEventListener('visibilitychange', onVisible);
  });
}
