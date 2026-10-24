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

  let job = null, running = false, opener, generation = 0, inputLabel = '', activeDoc = 'mission', activeLead = 0, activeView = 'discovery';
  let setupError = '', alertMessage = '', contactAvailable = false, contactRunning = false, contactState = {}, healthChecked = false;
  let lastInput = null, lastResumeId = '', requalifying = false, contactTimer = null;
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
  // Frames illustrate the current server phase. They never advance the progress value.
  // The celebration frame (11) is reserved for completed research.
  const phaseFrames = [[0, 1], [2], [3, 4], [5], [6], [7], [8, 9], [7, 9]];
  const frameUrl = index => '/assets/research-frames/frame-' + String(index + 1).padStart(2, '0') + '.webp';
  const frameCache = new Map();
  let frameTimer = null, framePhase = -1, framePosition = 0, frameToken = 0;

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
    if (token !== frameToken || run !== generation || !modal.open || activeView !== 'discovery' || job?.status === 'complete') return;
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
  function updateFrames(stage) {
    if (!modal.open || document.hidden || activeView !== 'discovery' || !modal.querySelector('.rf-loading')) { clearTimeout(frameTimer); frameTimer = null; return; }
    const sequence = phaseFrames[stage];
    if (framePhase !== stage) {
      clearTimeout(frameTimer); frameTimer = null; framePhase = stage; framePosition = 0;
      displayFrame(sequence[0]);
      sequence.slice(1).forEach(readyFrame);
      if (stage < 7) readyFrame(phaseFrames[stage + 1][0]);
      if (stage === 7) readyFrame(10);
    }
    if (!frameTimer && sequence.length > 1 && !reducedMotion()) {
      frameTimer = setTimeout(() => {
        frameTimer = null;
        if (framePhase !== stage || !modal.open || document.hidden || activeView !== 'discovery') return;
        framePosition = (framePosition + 1) % sequence.length;
        displayFrame(sequence[framePosition]);
        updateFrames(stage);
      }, 5800);
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
    const count = modal.querySelector('.rf-loading-count');
    if (count) count.textContent = stage + '/8 steps complete';
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
    modal.innerHTML = '<header class="research-header"><a class="research-brand" href="/"><img src="/assets/swan.svg" alt="">ClientFlock</a><button class="research-close" data-focus="close" aria-label="Close research">×</button></header><main class="rf-main' + (loading ? ' rf-main-loading' : '') + '">' + (alertMessage ? '<div class="research-alert" role="alert">' + esc(alertMessage) + '</div>' : '') + content + '</main>';
    bind(); modal.scrollTop = scroll;
    if (focus) modal.querySelector(focus)?.focus({ preventScroll: true });
    if (loading) updateLoading();
    if (done && !needsRecheck()) checkContacts();
  }

  function loadingView() {
    const stage = currentStage();
    return '<section class="rf-loading" aria-label="Customer research in progress"><div class="rf-loading-art" aria-hidden="true"><img class="rf-loading-frame is-visible" src="/assets/swan.svg" alt="" decoding="async"><img class="rf-loading-frame rf-loading-next" alt="" decoding="async"></div><h1>Finding your next customers.</h1><p class="rf-loading-stage" role="status" aria-live="polite">' + (job ? phaseCopy[stage] : 'Opening your research.') + '</p><div class="rf-loading-progress"><progress max="8" value="' + stage + '" aria-label="Research steps completed" aria-valuetext="' + stage + ' of 8 research steps completed"></progress><span class="rf-loading-count">' + stage + '/8 steps complete</span></div><button class="rf-playbook-link" data-view="playbook" data-focus="view-playbook">View your business playbook <span>' + readyDocs() + '/3</span></button></section>';
  }

  function completeHero() {
    if (needsRecheck()) return '<section class="rf-complete-hero rf-complete-review"><div><h1>Your saved research.</h1><p>One more check before you reach out.</p></div></section>';
    const count = job?.data?.leads?.length || 0;
    return '<section class="rf-complete-hero"><div><h1>' + count + ' potential customer' + (count === 1 ? '' : 's') + '.</h1><p>A reason to reach out. A personal first email.</p></div><img class="rf-complete-mark" src="' + frameUrl(10) + '" alt="Your swan has finished the search" decoding="async"></section>';
  }

  function paused() {
    return '<section class="rf-paused"><img src="/assets/swan.svg" alt=""><h1>Your search is paused.</h1><p>' + esc(setupError || job?.error || 'We couldn’t finish this step just yet.') + '</p>' + (job?.id ? '<button class="research-button" data-retry data-focus="retry-research">Continue this research ↗</button>' : '<button class="research-button" data-restart data-focus="restart-research">Try again ↗</button>') + '<small>Completed research is saved.</small><button class="rf-playbook-link" data-view="playbook" data-focus="view-playbook">View your business playbook <span>' + readyDocs() + '/3</span></button></section>';
  }

  function documents() { return window.ClientFlockDocuments?.render(job?.data || {}, activeDoc) || '<p>Your business playbook is taking shape.</p>'; }

  function recheckNotice() {
    return '<section class="rf-requalification" role="status"><span aria-hidden="true">↻</span><h2>These results need a fresh check.</h2><p>' + esc(qualification()?.message || 'This saved search predates website and platform verification. Recheck it before using the shortlist.') + '</p><button class="research-button" data-requalify data-focus="requalify"' + (requalifying ? ' disabled' : '') + '>' + (requalifying ? 'Starting the check…' : 'Recheck this search ↗') + '</button><small>Your business playbook remains available.</small></section>';
  }

  function platformMarkup(lead) {
    const platform = lead.platform || {}, checked = platform.status === 'verified' && typeof platform.name === 'string' && platform.name.trim();
    const required = qualification()?.requiredPlatforms || [];
    const unavailable = platform.status === 'unavailable';
    const label = checked ? platform.name + ' verified' : unavailable ? 'Platform check unavailable' : required.includes('Shopify') ? 'Shopify not confirmed' : 'Platform not confirmed';
    const status = checked ? 'verified' : unavailable ? 'unavailable' : 'unknown';
    const evidence = Array.isArray(platform.evidence) ? platform.evidence.filter(value => typeof value === 'string' && value.trim()) : [];
    const proofUrl = safeUrl(platform.url || lead.websiteCheck?.url || lead.website);
    return '<details class="rf-platform-evidence"><summary data-focus="platform-proof"><span class="rf-platform-status" data-status="' + status + '">' + (checked ? '✓ ' : '') + esc(label) + '</span><span>View check <b>+</b></span></summary><div>' + (evidence.length ? '<ul>' + evidence.map(value => '<li>' + esc(value) + '</li>').join('') + '</ul>' : '<p>' + (unavailable ? 'The website could not be checked reliably. No platform has been confirmed.' : 'No conclusive platform evidence was found. This does not mean the company does not use Shopify.') + '</p>') + (proofUrl !== '#' ? '<a href="' + esc(proofUrl) + '" target="_blank" rel="noopener noreferrer">Open the checked page ↗</a>' : '') + (platform.checkedAt ? '<small>Checked ' + esc(date(platform.checkedAt)) + '</small>' : '') + '</div></details>';
  }

  function websiteMarkup(lead) {
    const url = safeUrl(lead.website), check = lead.websiteCheck;
    const label = check?.status === 'checked' ? 'Website checked' + (check.checkedAt ? ' ' + date(check.checkedAt) : '') : check?.status === 'unavailable' ? 'Website check unavailable' : 'Website not checked';
    return '<div class="rf-company-website-row">' + (url !== '#' ? '<a class="rf-company-website" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(domain(url)) + '<span aria-hidden="true"> ↗</span></a>' : '<span class="rf-company-website">Website unavailable</span>') + '<span class="rf-website-state">' + esc(label) + '</span></div>' + platformMarkup(lead);
  }

  const logo = lead => '<span class="rf-company-logo"><span>' + esc((lead.name || '?').slice(0, 1)) + '</span>' + (safeUrl(lead.website) !== '#' ? '<img src="' + esc(new URL('/favicon.ico', lead.website).href) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span>';
  function results() {
    if (needsRecheck()) return recheckNotice();
    const leads = job?.data?.leads || [];
    if (!leads.length) return '<p>Your shortlist is being prepared.</p>';
    activeLead = Math.min(activeLead, leads.length - 1);
    const lead = leads[activeLead], contact = contactState[activeLead] || job?.data?.contacts?.[activeLead];
    return '<section class="rf-results"><div class="rf-section-heading"><h2>Your shortlist.</h2><span class="rf-source-note">Research-backed prospects. Buying interest to explore.</span></div><div class="rf-prospect-tabs" role="tablist" aria-label="Potential customers">' + leads.map((item, index) => '<button role="tab" id="rf-lead-tab-' + index + '" aria-controls="rf-lead-panel" aria-selected="' + (index === activeLead) + '" tabindex="' + (index === activeLead ? '0' : '-1') + '" class="rf-prospect-tab ' + (index === activeLead ? 'selected' : '') + '" data-lead="' + index + '" data-focus="lead-' + index + '">' + logo(item) + '<span><small>COMPANY ' + String(index + 1).padStart(2, '0') + '</small><strong>' + esc(item.name) + '</strong><span>' + esc(domain(item.website)) + '</span></span><i>↗</i></button>').join('') + '</div><div id="rf-lead-panel" role="tabpanel" aria-labelledby="rf-lead-tab-' + activeLead + '" class="rf-lead-panel" tabindex="0"><div class="rf-opportunity"><h3>' + esc(lead.name) + '</h3>' + websiteMarkup(lead) + '<div class="rf-value-row"><span class="rf-value-icon">◎</span><div><h4>Why reach out now</h4><p>' + esc(lead.whyNow) + '</p></div></div><div class="rf-pitch-pair"><section><span>01 / YOUR OFFER</span><h4>What you could offer</h4><p>' + esc(lead.whatToSell) + '</p></section><section><span>02 / THEIR BENEFIT</span><h4>What they gain</h4><p>' + esc(lead.benefit) + '</p></section></div><details class="rf-evidence"><summary data-focus="source-proof"><span>↗</span> The detail behind your first line <b>+</b></summary><blockquote>' + esc(lead.evidenceQuote) + '</blockquote><a href="' + esc(safeUrl(lead.sourceUrl)) + '" target="_blank" rel="noopener noreferrer">' + esc(lead.sourceTitle || 'Read the source') + ' ↗</a><small>Source checked ' + esc(date(lead.verifiedAt)) + (lead.sourceDate ? ' · Published ' + esc(lead.sourceDate) : '') + '</small></details></div><aside class="rf-email-card"><div class="rf-email-ribbon">YOUR FIRST EMAIL</div><div class="rf-email-paper"><div class="rf-email-meta"><span>Draft</span><span>Review before sending</span></div><div class="rf-to-row"><span>To</span><strong>' + esc(contact?.person?.name || contact?.person?.fullName || lead.roleToContact) + '</strong></div><div class="rf-contact-slot">' + contactMarkup(contact, lead) + '</div><h4>' + esc(lead.subject) + '</h4><div class="rf-email-body">' + String(lead.email || '').split(/\n+/).filter(Boolean).map(text => '<p>' + esc(text) + '</p>').join('') + '</div><div class="rf-email-footer"><button class="research-button" data-copy="' + activeLead + '" data-focus="copy-email">Copy email <span>↗</span></button></div></div></aside></div></section>';
  }

  function contactMarkup(contact, lead) {
    if (contact?.email) {
      const verified = contact.status === 'found';
      return '<div class="rf-contact-result"><a href="mailto:' + encodeURIComponent(String(contact.email)) + '">' + esc(contact.email) + '</a><span class="' + (verified ? 'verified' : 'risky') + '">' + (verified ? '✓ Verified by Icypeas' : 'Review before using · ' + esc(contact.certainty || 'uncertain')) + '</span></div>';
    }
    if (contact?.status === 'working') return '<span class="rf-contact-working" role="status"><i></i> ' + (contactRunning ? 'Finding and checking their email…' : 'Your email search is saved.') + '</span>' + (!contactRunning ? '<button class="rf-find-contact" data-contact="' + activeLead + '">Continue email search ↗</button>' : '');
    if (contact && ['not_found', 'error', 'unknown', 'unavailable', 'risky', 'skipped'].includes(contact.status)) {
      const retryable = contact.errorCode === 'auth_configuration' && contact.retryable === true;
      const wait = Math.max(0, Math.ceil(((contact.retryAt || 0) - Date.now()) / 1000));
      return '<span class="rf-contact-empty">' + esc(contact.message || 'No verified email found for this company.') + '</span>' + (retryable ? '<button class="rf-find-contact" data-contact-retry="' + activeLead + '"' + (wait ? ' disabled' : '') + '>Retry email search ↗</button>' + (wait ? '<small class="rf-contact-cooldown" role="status">Try again in ' + wait + ' seconds.</small>' : '') : '') + '<a class="rf-company-contact" href="' + esc(safeUrl(lead.contactUrl || lead.website)) + '" target="_blank" rel="noopener noreferrer">Company contact page ↗</a>';
    }
    return '<span class="rf-contact-empty">Email address not researched yet.</span>' + (contactAvailable ? '<button class="rf-find-contact" data-contact="' + activeLead + '">Find a verified email ↗</button>' : '<a class="rf-company-contact" href="' + esc(safeUrl(lead.contactUrl || lead.website)) + '" target="_blank" rel="noopener noreferrer">Company contact page ↗</a>');
  }

  function bindContactButtons() {
    modal.querySelector('[data-contact]')?.addEventListener('click', event => enrich(Number(event.currentTarget.dataset.contact)));
    modal.querySelector('[data-contact-retry]')?.addEventListener('click', event => enrich(Number(event.currentTarget.dataset.contactRetry), true));
  }
  function refreshContact() {
    clearTimeout(contactTimer); contactTimer = null;
    const slot = modal.querySelector('.rf-contact-slot'), lead = job?.data?.leads?.[activeLead];
    if (!slot || !lead || !modal.open) return;
    const hadFocus = slot.contains(document.activeElement), contact = contactState[activeLead] || job?.data?.contacts?.[activeLead];
    slot.innerHTML = contactMarkup(contact, lead); bindContactButtons();
    const name = modal.querySelector('.rf-to-row strong');
    if (name) name.textContent = contact?.person?.name || contact?.person?.fullName || lead.roleToContact || 'Company contact';
    if (hadFocus) slot.querySelector('button:not(:disabled), a')?.focus({ preventScroll: true });
    const remaining = (contact?.retryAt || 0) - Date.now();
    if (remaining > 0) contactTimer = setTimeout(refreshContact, remaining + 50);
  }

  async function checkContacts() {
    if (healthChecked) return;
    healthChecked = true; const run = generation;
    try { const health = await request('/api/health'); if (run !== generation) return; contactAvailable = health.contacts === true; refreshContact(); } catch {}
  }

  function bind() {
    modal.querySelector('.research-close').onclick = () => modal.close();
    modal.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { activeView = button.dataset.view; render(); });
    modal.querySelectorAll('[data-lead]').forEach(button => {
      button.onclick = () => { activeLead = Number(button.dataset.lead); render(); };
      button.onkeydown = event => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const count = job.data.leads.length;
        activeLead = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (activeLead + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
        render(); modal.querySelector('[data-lead="' + activeLead + '"]')?.focus({ preventScroll: true });
      };
    });
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
    if (contactRunning || !job?.id) return;
    const oldContact = contactState[index] || job?.data?.contacts?.[index];
    if (retry && (oldContact?.retryAt || 0) > Date.now()) { refreshContact(); return; }
    contactRunning = true; const id = job.id, run = generation;
    contactState[index] = { status: 'working' }; refreshContact();
    try {
      let count = 0;
      while (modal.open && run === generation && count++ < 35) {
        const response = await request('/api/search/' + id + '/contacts', { leadIndex: index, ...(retry && count === 1 ? { retry: true } : {}) });
        if (run !== generation) return;
        contactState[index] = { ...response.contact, ...(response.contact?.errorCode === 'auth_configuration' && response.retryAfterMs > 0 ? { retryAt: Date.now() + response.retryAfterMs } : {}) };
        refreshContact();
        if (response.contact?.status !== 'working') break;
        await new Promise(resolve => setTimeout(resolve, Math.max(7000, Math.min(Number(response.retryAfterMs) || 0, 60000))));
      }
    } catch (error) { if (run === generation) contactState[index] = { status: 'error', message: error.message }; }
    finally { if (run === generation) { contactRunning = false; refreshContact(); } }
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
    generation++; running = false; contactRunning = false; contactState = {}; activeLead = 0; activeDoc = 'mission'; activeView = 'discovery';
    setupError = ''; alertMessage = ''; healthChecked = false; contactAvailable = false; requalifying = false;
    clearTimeout(contactTimer); contactTimer = null; stopFrames();
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

  modal.addEventListener('close', () => { if (modal.open) return; generation++; running = false; contactRunning = false; stopFrames(); clearTimeout(contactTimer); contactTimer = null; document.body.style.overflow = ''; opener?.focus(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(frameTimer); frameTimer = null; } else if (modal.open && modal.querySelector('.rf-loading')) updateLoading(); });
  function resumeButton() {
    let id; try { id = localStorage.getItem('clientflock-search-id'); } catch {} if (!id) return;
    let button = document.querySelector('.resume-research');
    if (!button) { button = document.createElement('button'); button.className = 'resume-research'; button.textContent = '↗ Return to your research'; document.querySelector('.reassurance')?.after(button); }
    button.onclick = () => window.ClientFlockResearch.resume(id);
  }
  resumeButton();
})();
