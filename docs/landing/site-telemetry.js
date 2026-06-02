/* Achiote privacy-preserving product telemetry. No prompt text, no receipts. */
(function () {
  'use strict';

  function canonicalRoute() {
    var path = window.location.pathname.replace(/\/$/, '') || '/';
    if (path === '/app.html') return '/app';
    if (path === '/index.html') return '/';
    if (path === '/week6.html') return '/week6';
    if (path === '/meaning.html') return '/meaning';
    return path;
  }

  function cleanProps(props) {
    var out = {};
    var source = props && props.source;
    var category = props && props.category;
    var hasHistory = props && props.hasHistory;
    out.route = canonicalRoute();
    if (source != null) out.source = String(source).slice(0, 80);
    if (category != null) out.category = String(category).slice(0, 80);
    if (hasHistory != null) out.hasHistory = hasHistory ? 'true' : 'false';
    return out;
  }

  function track(event, props) {
    if (!event || typeof event !== 'string') return;
    var body = JSON.stringify({
      event: event,
      properties: cleanProps(props || {}),
      consent: { analytics: true }
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/events', new Blob([body], { type: 'application/json' }));
        return;
      }
      fetch('/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    } catch (_) {
      /* Telemetry must never affect the demo. */
    }
  }

  window.AchioteTelemetry = { track: track };

  document.addEventListener('DOMContentLoaded', function () {
    var route = canonicalRoute();
    track('page_view');
    if (route === '/app') track('app_opened');
  });
})();
