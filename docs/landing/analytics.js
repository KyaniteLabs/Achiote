/*
 * Achiote web analytics (PostHog) — consent-gated, OFF by default.
 *
 * TWO gates before anything loads: (1) the visitor has explicitly opted in from
 * the app controls (localStorage flag "achiote-consent-analytics"; absent = OFF),
 * and (2) POSTHOG_KEY below is a real project key. Until both are true this file
 * is a NO-OP — the PostHog snippet never loads and nothing is stored on the
 * visitor's device (ePrivacy Art. 5(3)). Withdrawing consent stops capture.
 *
 * Note: the hosted site's Content-Security-Policy already allows https://*.posthog.com for
 * scripts and connections (see src/http-server.ts). If you self-host behind a different CSP,
 * allow your PostHog asset + ingestion hosts there too.
 */
(function () {
  'use strict';

  // ── Config (fill these two in to activate) ─────────────────────────────────
  var POSTHOG_KEY = 'PH_PROJECT_KEY_PLACEHOLDER';
  var POSTHOG_HOST = 'https://us.i.posthog.com';
  // ───────────────────────────────────────────────────────────────────────────

  // ── Consent gate (ePrivacy Art. 5(3)) ──────────────────────────────────────
  // PostHog must not load, run, or store anything until the visitor explicitly
  // opts in from the app controls. Default is OFF: no flag -> no PostHog at all.
  var CONSENT_KEY = 'achiote-consent-analytics';

  function hasConsent() {
    try { return localStorage.getItem(CONSENT_KEY) === 'true'; } catch (e) { return false; }
  }
  function setConsent(enabled) {
    try { localStorage.setItem(CONSENT_KEY, enabled ? 'true' : 'false'); } catch (e) { /* optional feature */ }
  }

  // Wire the in-app toggle (see app.html #consent-analytics). Runs before the
  // gating below so the control works whether or not PostHog is active.
  (function initConsentToggle() {
    var input = document.getElementById('consent-analytics');
    if (!(input instanceof HTMLInputElement)) return;
    input.checked = hasConsent();
    input.addEventListener('change', function () {
      setConsent(input.checked);
      window.dispatchEvent(new CustomEvent('achiote:consent-changed', { detail: { analytics: input.checked } }));
    });
  })();

  // Fail-closed: without explicit consent, do not even load the snippet.
  if (!hasConsent()) {
    // If consent is granted later (this tab or another), start clean via reload.
    var startIfGranted = function () { if (hasConsent()) window.location.reload(); };
    window.addEventListener('achiote:consent-changed', startIfGranted);
    window.addEventListener('storage', function (ev) {
      if (ev && ev.key === CONSENT_KEY) startIfGranted();
    });
    return;
  }

  // No-op until a real project key is set, so the un-keyed default ships safely.
  if (!POSTHOG_KEY || POSTHOG_KEY === 'PH_PROJECT_KEY_PLACEHOLDER') return;

  // Standard PostHog web snippet loader (https://posthog.com/docs/libraries/js).
  !(function (t, e) {
    var o, n, p, r;
    e.__SV ||
      ((window.posthog = e),
      (e._i = []),
      (e.init = function (i, s, a) {
        function g(t, e) {
          var o = e.split('.');
          2 == o.length && ((t = t[o[0]]), (e = o[1]));
          t[e] = function () {
            t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
          };
        }
        ((p = t.createElement('script')).type = 'text/javascript'),
          (p.crossOrigin = 'anonymous'),
          (p.async = !0),
          (p.src = s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js'),
          (r = t.getElementsByTagName('script')[0]).parentNode.insertBefore(p, r);
        var u = e;
        for (
          void 0 !== a ? (u = e[a] = []) : (a = 'posthog'),
            u.people = u.people || [],
            u.toString = function (t) {
              var e = 'posthog';
              return 'posthog' !== a && (e += '.' + a), t || (e += ' (stub)'), e;
            },
            u.people.toString = function () {
              return u.toString(1) + '.people (stub)';
            },
            o =
              'init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric'.split(
                ' '
              ),
            n = 0;
          n < o.length;
          n++
        )
          g(u, o[n]);
        e._i.push([i, s, a]);
      }),
      (e.__SV = 1));
  })(document, window.posthog || []);

  window.posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // Privacy posture: no anonymous person profiles, no session recordings, honor Do Not Track.
    person_profiles: 'identified_only',
    autocapture: true,
    disable_session_recording: true,
    respect_dnt: true,
    capture_pageview: true,
  });

  // Withdrawing consent stops capture immediately, without needing a reload.
  var stopIfRevoked = function () {
    if (!hasConsent() && window.posthog && typeof window.posthog.opt_out_capturing === 'function') {
      window.posthog.opt_out_capturing();
    }
  };
  window.addEventListener('achiote:consent-changed', stopIfRevoked);
  window.addEventListener('storage', function (ev) {
    if (ev && ev.key === CONSENT_KEY) stopIfRevoked();
  });
})();
