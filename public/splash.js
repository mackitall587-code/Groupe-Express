(() => {
  'use strict';
  const start = () => {
    const screen = document.getElementById('gxStartup');
    if (!screen) return;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      screen.classList.add('gx-startup-hidden');
      screen.setAttribute('aria-hidden', 'true');
      window.setTimeout(() => screen.remove(), 550);
    };
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(close, reduced ? 250 : 2650);
    window.setTimeout(close, 6500); // sécurité anti-blocage
    window.addEventListener('pageshow', () => { if (screen.isConnected && !closed) window.setTimeout(close, 2650); }, { once: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
