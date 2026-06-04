/* Achiote — subtle scroll-reveal. CSP-safe (script-src 'self'), no inline handlers.
   Sections fade/rise gently as they enter the viewport. Fully opt-out under
   prefers-reduced-motion (no class added → content is simply visible). */
(function () {
  'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;

  var els = document.querySelectorAll('main > section');
  if (!els.length) return;

  // Only hide once JS is confirmed running — no-JS users see everything.
  for (var i = 0; i < els.length; i++) els[i].classList.add('reveal');

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

  for (var j = 0; j < els.length; j++) io.observe(els[j]);
})();
