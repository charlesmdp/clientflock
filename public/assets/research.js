(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const safeUrl = value => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '#'; }
    catch { return '#'; }
  };
  const date = value => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
  const domain = value => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const modal = document.createElement('dialog');
  modal.className = 'research-room';
  modal.setAttribute('aria-label', 'Your customer discovery');
  document.body.append(modal);

  let job = null, running = false, opener, generation = 0, inputLabel = '', activeDoc = 'mission', activeView = 'discovery';
  let setupError = '', alertMessage = '', contactAvailable = false, contactRunning = new Set(), contactState = {}, healthChecked = false;
  let lastInput = null, lastResumeId = '', requalifying = false;
  const contactTimers = new Map();
  const phaseCopy = [
    'Understanding your business.',
    'Defining what you offer.',
    'Understanding your market.',
    'Identifying your ideal customers.',
    'Finding relevant companies.',
    'Checking websites and requirements.',
    'Writing your personal emails.',
    'Reviewing your shortlist.'
  ];
  // The scenes keep the wait alive. Only the server controls research progress.
  const sceneCount = 20;
  const frameUrl = index => '/assets/research-scenes/scene-' + String(index + 1).padStart(2, '0') + '.webp';
  const frameCache = new Map();
  let frameTimer = null, framePhase = -1, framePosition = -1, frameToken = 0;

  async function request(path, body) {
    const response = await fetch(path, { ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    let data;
    try { data = await response.json(); } catch { throw Error('We couldn’t reach the research service. Please try again.'); }
    if (!response.ok && !data.contact) throw Error(data.error || 'Research is temporarily unavailable.');
    return data;
  }

  function readyFrame(index) {
    if (!frameCache.has(index)) {
      frameCache.set(index, new Promise(resolve => {
        const image = new Image(); image.decoding = 'async';
        image.onload = async () => { try { await image.decode(); } catch {} resolve(image.src); };
        image.onerror = () => resolve('/assets/swan.svg');
        image.src = frameUrl(index);
      }));
    }
    return frameCache.get(index);
  }

  async function displayFrame(index) {
    const token = ++frameToken, run = generation;
    const source = await readyFrame(index);
    if (token !== frameToken || run !== generation || !modal.open || document.hidden || activeView !== 'discovery' || job?.status === 'complete') return;
    const art = modal.querySelector('.rf-loading-art');
    if (!art) return;
    const frames = [...art.querySelectorAll('.rf-loading-frame')];
    const current = frames.find(image => image.classList.contains('is-visible')) || frames[0];
    if (current?.getAttribute('src') === source || current?.src === source) return;
    const next = frames.find(image => image !== current);
    if (!next) return;
    next.src = source;
    next.dataset.frame = String(index + 1);
    if (reducedMotion()) { current.classList.remove('is-visible'); next.classList.add('is-visible'); }
    else requestAnimationFrame(() => { if (token === frameToken && art.isConnected) { next.classList.add('is-visible'); current.classList.remove('is-visible'); } });
  }

  function stopFrames() { clearTimeout(frameTimer); frameTimer = null; framePhase = -1; frameToken++; }
  function advanceScene() {
    framePosition = (framePosition + 1) % sceneCount;
    displayFrame(framePosition);
    readyFrame((framePosition + 1) % sceneCount);
    readyFrame((framePosition + 2) % sceneCount);
  }
  function updateFrames(stage) {
    if (!modal.open || document.hidden || activeView !== 'discovery' || !modal.querySelector('.rf-loading')) { clearTimeout(frameTimer); frameTimer = null; return; }
    if (framePhase !== stage) {
      clearTimeout(frameTimer); frameTimer = null; framePhase = stage;
      advanceScene();
    }
    if (!frameTimer && !reducedMotion()) {
      frameTimer = setTimeout(() => {
        frameTimer = null;
        if (!modal.open || document.hidden || activeView !== 'discovery' || !modal.querySelector('.rf-loading')) return;
        advanceScene();
        updateFrames(currentStage());
      }, 6000);
    }
  }

  const currentStage = () => Math.min(7, Math.max(0, Number(job?.stage) || 0));
  const readyDocs = () => ['mission', 'market', 'idealClients'].filter(key => job?.data?.[key]?.document).length;
  const projectName = () => job?.data?.understanding?.profile?.name || inputLabel || 'Your business';
  const qualification = () => job?.data?.qualification;
  function needsRecheck() {
    const value = qualification(), leads = job?.data?.leads || [];
    if (!job) return false;
    if (value?.status === 'requalification-required' || value?.version === 0) return true;
    return job.status === 'complete' && (!value || Number(value.version) < 1 || leads.some(lead => !lead.websiteCheck));
  }

  function focusSelector() {
    const element = document.activeElement;
    if (!modal.contains(element)) return null;
    for (const attribute of ['data-focus', 'data-cf-doc-select', 'data-cf-doc-download', 'data-contact-retry', 'data-contact']) {
      if (element.hasAttribute?.(attribute)) return '[' + attribute + '="' + CSS.escape(element.getAttribute(attribute)) + '"]';
    }
    return element.id ? '#' + CSS.escape(element.id) : null;
  }

  function updateLoading() {
    const stage = currentStage(), status = modal.querySelector('.rf-loading-stage');
    if (status) status.textContent = job ? phaseCopy[stage] : 'Opening your research.';
    const progress = modal.querySelector('.rf-loading-progress progress');
    if (progress) { progress.value = stage; progress.setAttribute('aria-valuetext', stage + ' of 8 research steps completed'); }
    const playbook = modal.querySelector('.rf-playbook-link');
    if (playbook) playbook.innerHTML = 'View your business playbook <span>' + readyDocs() + '/3</span>';
    updateFrames(stage);
  }

  function render() {
    const done = job?.status === 'complete', failed = job?.status === 'failed' || !!setupError, review = needsRecheck();
    if (!done && !failed && !review && activeView === 'discovery' && modal.dataset.state === 'working' && modal.querySelector('.rf-loading')) {
      updateLoading(); return;
    }
    const focus = focusSelector(), scroll = modal.scrollTop;
    stopFrames();
    modal.dataset.state = review ? 'review' : done ? 'complete' : failed ? 'paused' : 'working';
    const loading = !done && !failed && !review && activeView === 'discovery';
    let content;
    if (activeView === 'playbook') {
      content = '<div class="rf-playbook-heading"><button class="rf-playbook-back" data-view="discovery" data-focus="view-discovery">← ' + (done ? 'Back to your customers' : 'Back to your search') + '</button><span>' + esc(projectName()) + '</span></div><div class="rf-view-content">' + documents() + '</div>';
    } else if (loading) content = loadingView();
    else if (failed && !review) content = paused();
    else content = '<div class="rf-project"><span>' + esc(projectName()) + '</span>' + (job?.cached ? '<span class="rf-saved">Saved ' + esc(date(job.updatedAt)) + '</span>' : '') + '</div>' + completeHero() + '<nav class="rf-view-nav" aria-label="Research views"><button data-view="discovery" data-focus="view-discovery" class="selected">Your customers <span>' + (job?.data?.leads?.length || 0) + '</span></button><button data-view="playbook" data-focus="view-playbook">Your business playbook <span>' + readyDocs() + '/3</span></button></nav><div class="rf-view-content">' + results() + '</div>';
    modal.innerHTML = '<header class="research-header"><a class="research-brand" href="/"><img src="/assets/swan.svg" alt="">ClientFlock</a><button class="research-close" data-focus="close" aria-label="Close research">×</button></header><main class="rf-main' + (loading ? ' rf-main-loading' : activeView === 'playbook' ? ' rf-main-playbook' : ' rf-main-results') + '">' + (alertMessage ? '<div class="research-alert" role="alert">' + esc(alertMessage) + '</div>' : '') + content + '</main>';
    bind(); modal.scrollTop = scroll;
    if (focus) modal.querySelector(focus)?.focus({ preventScroll: true });
    if (loading) updateLoading();
    if (done && !needsRecheck()) { refreshContact(); checkContacts(); }
  }

  function loadingView() {
    const stage = currentStage();
    return '<section class="rf-loading" aria-label="Customer research in progress"><div class="rf-loading-art" aria-hidden="true"><img class="rf-loading-frame is-visible" src="/assets/swan.svg" alt="" decoding="async"><img class="rf-loading-frame rf-loading-next" alt="" decoding="async"></div><h1>Finding your next customers.</h1><p class="rf-loading-stage" role="status" aria-live="polite">' + (job ? phaseCopy[stage] : 'Opening your research.') + '</p><div class="rf-loading-progress"><span class="rf-rainbow-ribbon" aria-hidden="true"><i></i></span><progress class="rf-visually-hidden" max="8" value="' + stage + '" aria-label="Research steps completed" aria-valuetext="' + stage + ' of 8 research steps completed"></progress></div><button class="rf-playbook-link" data-view="playbook" data-focus="view-playbook">View your business playbook <span>' + readyDocs() + '/3</span></button></section>';
  }

  function completeHero() {
    if (needsRecheck()) return '<section class="rf-complete-hero rf-complete-review"><div><h1>Your saved research.</h1><p>One more check before you reach out.</p></div></section>';
    const count = job?.data?.leads?.length || 0;
    return '<section class="rf-complete-hero"><div><h1>' + count + ' potential customer' + (count === 1 ? '' : 's') + '.</h1><p>A reason to reach out. A personal first email.</p></div></section>';
  }

  function paused() {
    return '<section class="rf-paused"><img src="/assets/swan.svg" alt=""><h1>Your search is paused.</h1><p>' + esc(setupError || job?.error || 'We couldn’t finish this step just yet.') + '</p>' + (job?.id ? '<button class="research-button" data-retry data-focus="retry-research">Continue this research ↗</button>' : '<button class="research-button" data-restart data-focus="restart-research">Try again ↗</button>') + '<small>Completed research is saved.</small><button class="rf-playbook-link" data-view="playbook" data-focus="view-playbook">View your business playbook <span>' + readyDocs() + '/3</span></button></section>';
  }

  function documents() { return window.ClientFlockDocuments?.render(job?.data || {}, activeDoc) || '<p>Your business playbook is taking shape.</p>'; }

  function recheckNotice() {
    return '<section class="rf-requalification" role="status"><span aria-hidden="true">↻</span><h2>These results need a fresh check.</h2><p>' + esc(qualification()?.message || 'This saved search predates website and platform verification. Recheck it before using the shortlist.') + '</p><button class="research-button" data-requalify data-focus="requalify"' + (requalifying ? ' disabled' : '') + '>' + (requalifying ? 'Starting the check…' : 'Recheck this search ↗') + '</button><small>Your business playbook remains available.</small></section>';
  }

  function platformMarkup(lead, index) {
    const platform = lead.platform || {}, checked = platform.status === 'verified' && typeof platform.name === 'string' && platform.name.trim();
    const required = qualification()?.requiredPlatforms || [];
    const unavailable = platform.status === 'unavailable';
    const label = checked ? platform.name + ' verified' : unavailable ? 'Platform check unavailable' : required.includes('Shopify') ? 'Shopify not confirmed' : 'Platform not confirmed';
    const status = checked ? 'verified' : unavailable ? 'unavailable' : 'unknown';
    const evidence = Array.isArray(platform.evidence) ? platform.evidence.filter(value => typeof value === 'string' && value.trim()) : [];
    const proofUrl = safeUrl(platform.url || lead.websiteCheck?.url || lead.website);
    return '<details class="rf-platform-evidence"><summary data-focus="platform-proof-' + index + '"><span class="rf-platform-status" data-status="' + status + '">' + (checked ? '✓ ' : '') + esc(label) + '</span><span>View check <b>+</b></span></summary><div>' + (evidence.length ? '<ul>' + evidence.map(value => '<li>' + esc(value) + '</li>').join('') + '</ul>' : '<p>' + (unavailable ? 'The website could not be checked reliably. No platform has been confirmed.' : 'No conclusive platform evidence was found. This does not mean the company does not use Shopify.') + '</p>') + (proofUrl !== '#' ? '<a href="' + esc(proofUrl) + '" target="_blank" rel="noopener noreferrer">Open the checked page ↗</a>' : '') + (platform.checkedAt ? '<small>Checked ' + esc(date(platform.checkedAt)) + '</small>' : '') + '</div></details>';
  }

  function websiteMarkup(lead, index) {
    const url = safeUrl(lead.website), check = lead.websiteCheck;
    const label = check?.status === 'checked' ? 'Website checked' + (check.checkedAt ? ' ' + date(check.checkedAt) : '') : check?.status === 'unavailable' ? 'Website check unavailable' : 'Website not checked';
    return '<div class="rf-company-website-row">' + (url !== '#' ? '<a class="rf-company-website" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(domain(url)) + '<span aria-hidden="true"> ↗</span></a>' : '<span class="rf-company-website">Website unavailable</span>') + '<span class="rf-website-state">' + esc(label) + '</span></div>' + platformMarkup(lead, index);
  }

  const logo = lead => '<span class="rf-company-logo"><span>' + esc((lead.name || '?').slice(0, 1)) + '</span>' + (safeUrl(lead.website) !== '#' ? '<img src="' + esc(new URL('/favicon.ico', lead.website).href) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span>';
  function results() {
    if (needsRecheck()) return recheckNotice();
    const leads = job?.data?.leads || [];
    if (!leads.length) return '<p>Your shortlist is being prepared.</p>';
    return '<section class="rf-results" aria-label="Potential customers">' + leads.map(customerCard).join('') + '</section>';
  }

  function customerCard(lead, index) {
    const contact = contactState[index] || job?.data?.contacts?.[index];
    return '<article class="rf-customer-card" data-customer="' + index + '" aria-labelledby="rf-company-' + index + '"><div class="rf-customer-research"><header class="rf-customer-heading">' + logo(lead) + '<div><span class="rf-customer-number">Potential customer ' + String(index + 1).padStart(2, '0') + '</span><h2 id="rf-company-' + index + '">' + esc(lead.name) + '</h2></div></header>' + websiteMarkup(lead, index) + '<div class="rf-customer-story"><section><h3>Why reach out now</h3><p>' + esc(lead.whyNow) + '</p></section><section><h3>What you could offer</h3><p>' + esc(lead.whatToSell) + '</p></section><section><h3>What they gain</h3><p>' + esc(lead.benefit) + '</p></section></div><details class="rf-evidence"><summary data-focus="source-proof-' + index + '"><span>↗</span> The source behind your first line <b>+</b></summary><blockquote>' + esc(lead.evidenceQuote) + '</blockquote><a href="' + esc(safeUrl(lead.sourceUrl)) + '" target="_blank" rel="noopener noreferrer">' + esc(lead.sourceTitle || 'Read the source') + ' ↗</a><small>Source checked ' + esc(date(lead.verifiedAt)) + (lead.sourceDate ? ' · Published ' + esc(lead.sourceDate) : '') + '</small></details></div><section class="rf-email-card" aria-label="Email draft for ' + esc(lead.name) + '"><div class="rf-email-paper"><div class="rf-email-meta"><h3>Your first email</h3><span>Draft · Review before sending</span></div><div class="rf-to-row"><span>To</span><strong>' + esc(contact?.person?.name || contact?.person?.fullName || lead.roleToContact) + '</strong></div><div class="rf-contact-slot" data-contact-slot="' + index + '">' + contactMarkup(contact, lead, index) + '</div><h4><span>Subject</span>' + esc(lead.subject) + '</h4><div class="rf-email-body">' + String(lead.email || '').split(/\n+/).filter(Boolean).map(text => '<p>' + esc(text) + '</p>').join('') + '</div><div class="rf-email-footer"><button class="research-button" data-copy="' + index + '" data-focus="copy-email-' + index + '">Copy email <span>↗</span></button></div></div></section></article>';
  }

  function contactMarkup(contact, lead, index) {
    if (contact?.email) {
      const verified = contact.status === 'found';
      return '<div class="rf-contact-result"><a href="mailto:' + encodeURIComponent(String(contact.email)) + '">' + esc(contact.email) + '</a><span class="' + (verified ? 'verified' : 'risky') + '">' + (verified ? '✓ Verified by Icypeas' : 'Review before using · ' + esc(contact.certainty || 'uncertain')) + '</span></div>';
    }
    const busy = contactRunning.has(index);
    if (contact?.status === 'working') return '<span class="rf-contact-working" role="status"><i></i> ' + (busy ? 'Finding and checking their email…' : 'Your email search is saved.') + '</span>' + (!busy ? '<button class="rf-find-contact" data-contact="' + index + '">Continue email search ↗</button>' : '');
    if (contact && ['not_found', 'error', 'unknown', 'unavailable', 'risky', 'skipped'].includes(contact.status)) {
      const retryable = ['auth_configuration', 'people_response'].includes(contact.errorCode) && contact.retryable === true;
      const newLookup = retryable && contact.errorCode === 'people_response' && contact.requiresNewLookup === true;
      const wait = Math.max(0, Math.ceil(((contact.retryAt || 0) - Date.now()) / 1000));
      return '<span class="rf-contact-empty">' + esc(contact.message || 'No verified email found for this company.') + '</span>' + (retryable ? (newLookup ? '<small class="rf-contact-credit-note">This runs a new Icypeas lookup and may use credits.</small>' : contact.errorCode === 'people_response' ? '<small class="rf-contact-credit-note">Retry checks the saved response without a new lookup.</small>' : '') + '<button class="rf-find-contact" data-contact-retry="' + index + '"' + (wait ? ' disabled' : '') + '>' + (contact.errorCode === 'people_response' ? 'Retry contact search' : 'Retry email search') + ' ↗</button>' + (wait ? '<small class="rf-contact-cooldown" role="status">Try again in ' + wait + ' seconds.</small>' : '') : '') + '<a class="rf-company-contact" href="' + esc(safeUrl(lead.contactUrl || lead.website)) + '" target="_blank" rel="noopener noreferrer">Company contact page ↗</a>';
    }
    return '<span class="rf-contact-empty">Email address not researched yet.</span>' + (contactAvailable ? '<button class="rf-find-contact" data-contact="' + index + '">Find a verified email ↗</button>' : '<a class="rf-company-contact" href="' + esc(safeUrl(lead.contactUrl || lead.website)) + '" target="_blank" rel="noopener noreferrer">Company contact page ↗</a>');
  }

  function bindContactButtons(container = modal) {
    container.querySelectorAll('[data-contact]').forEach(button => button.onclick = () => enrich(Number(button.dataset.contact)));
    container.querySelectorAll('[data-contact-retry]').forEach(button => button.onclick = () => enrich(Number(button.dataset.contactRetry), true));
  }
  function refreshContact(index) {
    const indices = Number.isInteger(index) ? [index] : (job?.data?.leads || []).map((_, i) => i);
    indices.forEach(i => {
      clearTimeout(contactTimers.get(i)); contactTimers.delete(i);
      const slot = modal.querySelector('[data-contact-slot="' + i + '"]'), lead = job?.data?.leads?.[i];
      if (!slot || !lead || !modal.open) return;
      const hadFocus = slot.contains(document.activeElement), contact = contactState[i] || job?.data?.contacts?.[i];
      slot.innerHTML = contactMarkup(contact, lead, i); bindContactButtons(slot);
      const name = slot.closest('.rf-customer-card')?.querySelector('.rf-to-row strong');
      if (name) name.textContent = contact?.person?.name || contact?.person?.fullName || lead.roleToContact || 'Company contact';
      if (hadFocus) slot.querySelector('button:not(:disabled), a')?.focus({ preventScroll: true });
      const remaining = (contact?.retryAt || 0) - Date.now();
      if (remaining > 0) contactTimers.set(i, setTimeout(() => refreshContact(i), remaining + 50));
    });
  }

  async function checkContacts() {
    if (healthChecked) return;
    healthChecked = true; const run = generation;
    try { const health = await request('/api/health'); if (run !== generation) return; contactAvailable = health.contacts === true; refreshContact(); } catch {}
  }

  function bind() {
    modal.querySelector('.research-close').onclick = () => modal.close();
    modal.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { activeView = button.dataset.view; render(); });
    modal.querySelectorAll('.rf-company-logo img').forEach(image => { image.addEventListener('error', () => image.remove()); image.addEventListener('load', () => image.parentElement.classList.add('has-logo')); });
    modal.querySelector('[data-retry]')?.addEventListener('click', async event => { const run = generation, id = job.id, button = event.currentTarget; button.disabled = true; try { const next = await request('/api/search/' + id + '/retry', {}); if (run !== generation) return; job = next; alertMessage = ''; render(); loop(); } catch (error) { if (run === generation) notice(error.message); } finally { if (run === generation && button.isConnected) button.disabled = false; } });
    modal.querySelector('[data-restart]')?.addEventListener('click', () => { if (lastInput) window.ClientFlockResearch.start(lastInput); else if (lastResumeId) window.ClientFlockResearch.resume(lastResumeId); else modal.close(); });
    modal.querySelector('[data-requalify]')?.addEventListener('click', requalify);
    modal.querySelectorAll('[data-copy]').forEach(button => button.onclick = async () => {
      const lead = job.data.leads[Number(button.dataset.copy)];
      try { await navigator.clipboard.writeText('Subject: ' + lead.subject + '\n\n' + lead.email); button.textContent = 'Copied ✓'; setTimeout(() => { if (button.isConnected) button.innerHTML = 'Copy email <span>↗</span>'; }, 2500); }
      catch { button.textContent = 'Select the text to copy'; }
    });
    bindContactButtons();
    if (activeView === 'playbook') window.ClientFlockDocuments?.bind(modal.querySelector('.rf-view-content'), job?.data || {}, key => { activeDoc = key; render(); });
  }

  async function requalify() {
    if (requalifying || !job?.id) return;
    requalifying = true; const id = job.id, run = generation;
    const button = modal.querySelector('[data-requalify]'); if (button) { button.disabled = true; button.textContent = 'Starting the check…'; }
    try {
      const next = await request('/api/search/' + id + '/requalify', {});
      if (run !== generation) return;
      reset(); job = next; render(); loop();
    } catch (error) { if (run === generation) { notice(error.message); if (button?.isConnected) { button.disabled = false; button.textContent = 'Recheck this search ↗'; } } }
    finally { requalifying = false; }
  }

  async function enrich(index, retry = false) {
    if (contactRunning.has(index) || !job?.id) return;
    const oldContact = contactState[index] || job?.data?.contacts?.[index];
    if (retry && (oldContact?.retryAt || 0) > Date.now()) { refreshContact(index); return; }
    contactRunning.add(index); const id = job.id, run = generation;
    contactState[index] = { status: 'working' }; refreshContact(index);
    try {
      let count = 0;
      while (modal.open && run === generation && count++ < 35) {
        const response = await request('/api/search/' + id + '/contacts', { leadIndex: index, ...(retry && count === 1 ? { retry: true, ...(oldContact?.errorCode === 'people_response' && oldContact.requiresNewLookup === true ? { allowNewLookup: true } : {}) } : {}) });
        if (run !== generation) return;
        contactState[index] = { ...response.contact, ...(response.contact?.retryable === true && response.retryAfterMs > 0 ? { retryAt: Date.now() + response.retryAfterMs } : {}) };
        refreshContact(index);
        if (response.contact?.status !== 'working') break;
        await new Promise(resolve => setTimeout(resolve, Math.max(7000, Math.min(Number(response.retryAfterMs) || 0, 60000))));
      }
    } catch (error) { if (run === generation) contactState[index] = { status: 'error', message: error.message }; }
    finally { if (run === generation) { contactRunning.delete(index); refreshContact(index); } }
  }

  function notice(message) {
    alertMessage = message;
    const old = modal.querySelector('.research-alert');
    if (old) old.textContent = message;
    else { const paragraph = document.createElement('p'); paragraph.className = 'research-alert'; paragraph.setAttribute('role', 'alert'); paragraph.textContent = message; modal.querySelector('.rf-main')?.prepend(paragraph); }
  }

  async function loop() {
    if (running || !job || needsRecheck()) return;
    running = true; const run = generation, id = job.id;
    try {
      while (modal.open && job.status === 'working' && run === generation && !needsRecheck()) {
        const previous = [job.stage, job.status, readyDocs(), qualification()?.status].join('|');
        const next = await request('/api/search/' + id + '/advance', {});
        if (run !== generation) return;
        const cached = job.cached; job = next; job.cached = cached;
        if ([job.stage, job.status, readyDocs(), qualification()?.status].join('|') !== previous) render();
        if (needsRecheck()) break;
        if (job.status === 'working') await new Promise(resolve => setTimeout(resolve, 3500));
      }
    } catch (error) { if (run === generation) notice(error.message + ' Close and resume to try again.'); }
    finally { if (run === generation) running = false; }
  }

  function reset() {
    generation++; running = false; contactRunning = new Set(); contactState = {}; activeDoc = 'mission'; activeView = 'discovery';
    setupError = ''; alertMessage = ''; healthChecked = false; contactAvailable = false; requalifying = false;
    contactTimers.forEach(clearTimeout); contactTimers.clear(); stopFrames(); framePosition = -1;
  }
  function open() { if (!modal.open) modal.showModal(); document.body.style.overflow = 'hidden'; modal.scrollTop = 0; modal.querySelector('.research-close')?.focus({ preventScroll: true }); if (modal.querySelector('.rf-loading')) updateLoading(); }

  window.ClientFlockResearch = {
    async start(input) {
      reset(); const run = generation; lastInput = input; lastResumeId = ''; opener = document.activeElement; job = null; inputLabel = input.website || 'Your business idea'; render(); open();
      try {
        const next = await request('/api/search', input); if (run !== generation) return; job = next;
        try { localStorage.setItem('clientflock-search-id', job.id); } catch {}
        render(); loop(); resumeButton();
      } catch (error) { if (run === generation) { setupError = error.message; render(); } }
    },
    async resume(id) {
      reset(); const run = generation; lastInput = null; lastResumeId = id; opener = document.activeElement; job = null; inputLabel = 'Saved research'; render(); open();
      try { const next = await request('/api/search/' + id); if (run !== generation) return; job = next; render(); loop(); }
      catch (error) { if (run === generation) { setupError = error.message; render(); } }
    }
  };

  modal.addEventListener('close', () => { if (modal.open) return; generation++; running = false; contactRunning = new Set(); stopFrames(); contactTimers.forEach(clearTimeout); contactTimers.clear(); document.body.style.overflow = ''; opener?.focus(); });
  document.addEventListener('visibilitychange', () => { modal.dataset.hidden = String(document.hidden); if (document.hidden) { clearTimeout(frameTimer); frameTimer = null; } else if (modal.open && modal.querySelector('.rf-loading')) updateLoading(); });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { clearTimeout(frameTimer); frameTimer = null; if (modal.open && modal.querySelector('.rf-loading')) updateFrames(currentStage()); });
  function resumeButton() {
    let id; try { id = localStorage.getItem('clientflock-search-id'); } catch {} if (!id) return;
    let button = document.querySelector('.resume-research');
    if (!button) { button = document.createElement('button'); button.className = 'resume-research'; button.textContent = '↗ Return to your research'; document.querySelector('.reassurance')?.after(button); }
    button.onclick = () => window.ClientFlockResearch.resume(id);
  }
  resumeButton();
})();
