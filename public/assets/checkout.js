(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const dialog = document.createElement('dialog');
  dialog.className = 'cf-checkout'; dialog.setAttribute('aria-labelledby', 'cf-checkout-title'); document.body.append(dialog);
  let context, opener, version = 0, embedded, stripePromise, pollTimer;
  const wait = ms => new Promise(resolve => { pollTimer = setTimeout(resolve, ms); });
  async function api(path, body) {
    const response = await fetch(path, { credentials:'same-origin', ...(body === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'We couldn’t connect to checkout. Please try again.');
    return data;
  }
  function stripeReady() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (!stripePromise) stripePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://js.stripe.com/v3/'; script.async = true;
      const timeout = setTimeout(() => { script.remove(); stripePromise = null; reject(Error('The secure payment form could not load. Please try again.')); }, 15000);
      script.onload = () => { clearTimeout(timeout); if (window.Stripe) resolve(window.Stripe); else { stripePromise = null; reject(Error('The secure payment form could not load.')); } };
      script.onerror = () => { clearTimeout(timeout); script.remove(); stripePromise = null; reject(Error('The secure payment form could not load. Please try again.')); };
      document.head.append(script);
    });
    return stripePromise;
  }
  function message(text, error = false) {
    const el = dialog.querySelector('[data-checkout-message]');
    if (el) { el.textContent = text; el.classList.toggle('is-error', error); }
  }
  function destroyCheckout() { try { embedded?.destroy(); } catch {} embedded = null; }
  function finish() {
    const callback = context?.onUnlocked;
    dialog.close(); if (typeof callback === 'function') callback();
  }
  async function confirmPayment(sessionId, run) {
    message('Confirming your payment…');
    for (let attempt = 0; attempt < 12; attempt++) {
      if (run !== version || !dialog.open) return;
      try {
        const result = await api('/api/billing/status', { jobId:context.jobId, sessionId });
        if (run !== version || !dialog.open) return;
        if (result.unlocked && result.paid) { finish(); return; }
        if (['expired', 'revoked'].includes(result.status)) { message('This checkout is no longer active. Close this window and try again.', true); return; }
      } catch (error) { if (attempt === 11) { message(error.message, true); return; } }
      await wait(1800);
    }
    message('Your payment is still being confirmed. You can close this window; we’ll check again when you unlock.');
  }
  function priceText(price) {
    if (price?.formatted) return price.formatted;
    if (!Number.isFinite(price?.amount) || !price?.currency) return '';
    try { return new Intl.NumberFormat(undefined, { style:'currency', currency:price.currency.toUpperCase() }).format(price.amount / 100); }
    catch { return ''; }
  }
  function shell() {
    return '<button class="cf-checkout-close" data-checkout-close aria-label="Close checkout">×</button><div class="cf-checkout-story"><span class="cf-checkout-brand"><img src="/assets/swan.svg" alt="" width="30" height="30">ClientFlock</span><div class="cf-checkout-art"><img src="/assets/professions/saas.webp" alt="A black swan finding its next bright idea" width="240" height="240"><span>Keep your flock growing.</span></div><h2 id="cf-checkout-title">Your next customers<br>are closer than you think.</h2><p class="cf-checkout-intro">Let’s find the next people who could need what you sell.</p><ul class="cf-checkout-benefits"><li><b>Up to 6 more potential customers</b><span>Two new shortlists of three, researched for your business.</span></li><li><b>A real reason to reach out</b><span>Website checks, a relevant offer and the source behind the timing.</span></li><li><b>Personal emails, ready to make yours</b><span>Edit every draft. Unlock an email when we can find and verify it.</span></li><li><b>Your research comes with you</b><span>Keep your mission, market and ideal customer documents.</span></li></ul></div><div class="cf-checkout-panel"><div data-checkout-offer><span class="cf-checkout-eyebrow">THE NEXT CHAPTER</span><h3>Your next six.</h3><p class="cf-checkout-price" data-checkout-price><span class="cf-checkout-skeleton"></span></p><span class="cf-checkout-once">30-day access · One payment · This research</span><button class="cf-checkout-pay" data-checkout-pay disabled>Checking availability…</button><p class="cf-checkout-fine">Access stays in this browser. Your first 3 customers and their email unlocks stay free. Not every company has a discoverable email.</p></div><div id="cf-stripe-checkout" class="cf-stripe-checkout" hidden></div><p class="cf-checkout-message" data-checkout-message role="status" aria-live="polite"></p><span class="cf-checkout-secure"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Secure checkout by Stripe</span></div>';
  }
  async function open(options) {
    if (!options?.jobId) return;
    destroyCheckout(); clearTimeout(pollTimer); context = options; opener = document.activeElement; const run = ++version;
    dialog.innerHTML = shell();
    dialog.querySelector('[data-checkout-close]').onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
    const button = dialog.querySelector('[data-checkout-pay]');
    try {
      const config = await api('/api/billing/config?jobId=' + encodeURIComponent(options.jobId));
      if (run !== version || !dialog.open) return;
      if (config.unlocked) { finish(); return; }
      const price = priceText(config.price);
      dialog.querySelector('[data-checkout-price]').textContent = price || 'Coming soon';
      if (!config.ready || !price || !config.publishableKey) {
        button.textContent = 'Checkout is being connected';
        message(config.message || 'Payments aren’t available yet. Your first three customers and email unlocks are still free.');
        return;
      }
      button.disabled = false; button.textContent = 'Unlock up to 6 more for ' + price;
      button.onclick = async () => {
        if (button.disabled) return;
        button.disabled = true; button.textContent = 'Opening secure checkout…'; message('');
        try {
          const session = await api('/api/billing/checkout', { jobId:options.jobId });
          if (run !== version || !dialog.open) return;
          if (session.unlocked) { finish(); return; }
          if (!session.clientSecret || !session.sessionId) throw Error('Checkout is not ready. Please try again.');
          const Stripe = await stripeReady();
          if (run !== version || !dialog.open) return;
          const instance = await Stripe(session.publishableKey || config.publishableKey).initEmbeddedCheckout({ clientSecret:session.clientSecret, onComplete:() => confirmPayment(session.sessionId, run) });
          if (run !== version || !dialog.open) { instance.destroy(); return; }
          embedded = instance;
          dialog.querySelector('[data-checkout-offer]').hidden = true;
          dialog.querySelector('#cf-stripe-checkout').hidden = false;
          dialog.classList.add('has-payment');
          embedded.mount(dialog.querySelector('#cf-stripe-checkout'));
        } catch (error) {
          if (run !== version || !dialog.open) return;
          destroyCheckout(); dialog.querySelector('[data-checkout-offer]').hidden = false; dialog.querySelector('#cf-stripe-checkout').hidden = true; dialog.classList.remove('has-payment'); button.disabled = false; button.textContent = 'Try secure checkout again'; message(error.message, true);
        }
      };
    } catch (error) {
      if (run !== version || !dialog.open) return;
      dialog.querySelector('[data-checkout-price]').textContent = 'Not available yet'; button.textContent = 'Please try again later'; message(error.message, true);
    }
  }
  dialog.addEventListener('close', () => { version++; clearTimeout(pollTimer); destroyCheckout(); dialog.classList.remove('has-payment'); if (opener?.isConnected) opener.focus({ preventScroll:true }); });
  window.ClientFlockCheckout = Object.freeze({ open });
})();
