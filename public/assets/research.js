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
  const detail = document.createElement('dialog');
  detail.className = 'research-detail';
  detail.setAttribute('aria-labelledby', 'rf-detail-title');
  document.body.append(detail);
  let detailView = null, detailOpener = null;
  let progressTimer = null, observedStage = -1, stageStartedAt = Date.now(), stageDurations = [];
  const estimatedStageSeconds = [25, 25, 40, 45, 60, 45, 30, 20];
  const icons = {
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></svg>'
  };

  let job = null, running = false, opener, generation = 0, inputLabel = '', activeDoc = 'mission', activeView = 'discovery';
  let setupError = '', alertMessage = '', contactAvailable = false, contactRunning = new Set(), contactState = {}, healthChecked = false;
  let lastInput = null, lastResumeId = '', requalifying = false;
  const contactTimers = new Map();
  const draftCache = new Map(), celebrations = new Set(), effectTimers = new Set();
  const rainbowLabel = text => '<span class="rainbow-word" aria-hidden="true">' + [...text].map(letter => letter === ' ' ? ' ' : '<span>' + esc(letter) + '</span>').join('') + '</span>';
  const brand = '<a class="wordmark research-brand" href="/" aria-label="ClientFlock home"><img src="/assets/swan.svg" alt="" width="42" height="42"><span class="wordmark-name">Client<span class="rainbow-word flock"><span>F</span><span>l</span><span>o</span><span>c</span><span>k</span></span></span></a>';
  const validFoundEmail = contact => contact?.status === 'found' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(contact.email || ''));
  const draftKey = index => 'clientflock-draft-v1:' + job.id + ':' + (job.data.leads[index].website || job.data.leads[index].name || index);
  function emailDraft(index) {
    const key = draftKey(index), lead = job.data.leads[index];
    if (!draftCache.has(key)) {
      let saved; try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
      draftCache.set(key, { subject: typeof saved?.subject === 'string' ? saved.subject : String(lead.subject || ''), body: typeof saved?.body === 'string' ? saved.body : String(lead.email || '') });
    }
    return draftCache.get(key);
  }
  function saveDraft(index, field, value) {
    const key = draftKey(index), draft = { ...emailDraft(index), [field]: value }; draftCache.set(key, draft);
    let persisted = true; try { localStorage.setItem(key, JSON.stringify(draft)); } catch { persisted = false; }
    detail.querySelector('[data-draft-save]')?.replaceChildren(document.createTextNode(persisted ? 'Changes saved on this device.' : 'Changes saved for this visit.'));
    updateComposeLinks(index);
  }
  function composeUrl(contact, index) {
    const draft = emailDraft(index);
    return 'mailto:' + encodeURIComponent(String(contact?.email || '')) + '?subject=' + encodeURIComponent(draft.subject) + '&body=' + encodeURIComponent(draft.body);
  }
  function updateComposeLinks(index) {
    const contact = contactState[index] || job?.data?.contacts?.[index];
    [modal, detail].forEach(container => container.querySelectorAll('[data-compose="' + index + '"],[data-open-email="' + index + '"]').forEach(link => { link.href = composeUrl(contact, index); }));
  }
  function removeEffects() {
    effectTimers.forEach(clearTimeout); effectTimers.clear();
    [modal, detail].forEach(container => container.querySelectorAll('.rf-celebration,.rf-flight').forEach(element => element.remove()));
  }
  function temporaryEffect(element, container, duration) {
    container.append(element);
    const timer = setTimeout(() => { element.remove(); effectTimers.delete(timer); }, duration);
    effectTimers.add(timer);
  }
  function celebrateEmail(index) {
    const key = job.id + ':' + index;
    if (celebrations.has(key)) return; celebrations.add(key);
    if (reducedMotion() || !modal.open || document.hidden) return;
    const layer = document.createElement('div'); layer.className = 'rf-celebration'; layer.setAttribute('aria-hidden', 'true');
    const colors = ['#ff2d83', '#ff7847', '#ffd640', '#9b36ef', '#5068f7'];
    layer.innerHTML = Array.from({ length: 42 }, (_, i) => '<i style="--confetti-x:' + ((Math.random() - .5) * 650).toFixed(0) + 'px;--confetti-y:' + (-100 - Math.random() * 220).toFixed(0) + 'px;--confetti-turn:' + (Math.random() * 900 - 450).toFixed(0) + 'deg;--confetti-delay:' + (Math.random() * .16).toFixed(2) + 's;--confetti-color:' + colors[i % colors.length] + '"></i>').join('');
    temporaryEffect(layer, detail.open ? detail : modal, 2400);
  }
  function flyFlock() {
    if (reducedMotion() || !modal.open || document.hidden) return;
    const flock = document.createElement('div'); flock.className = 'rf-flight'; flock.setAttribute('aria-hidden', 'true');
    flock.innerHTML = Array.from({ length: 7 }, (_, i) => '<span class="rf-flying-bird" style="--bird-delay:' + (i * .15) + 's;--bird-y:' + (35 + (i % 3) * 8) + 'vh;--bird-size:' + (25 + (i % 3) * 6) + 'px"><svg viewBox="0 0 64 40"><path class="rf-wing-left" d="M32 23C25 9 13 8 1 13c13 0 19 8 29 14Z"/><path class="rf-wing-right" d="M32 23C38 8 49 3 63 4c-12 5-17 12-29 23Z"/><path d="m29 22 7-1 3 7 7 3-9 1-5-4-8 4 5-10Z"/></svg></span>').join('');
    temporaryEffect(flock, modal, 4800);
  }

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
  const sceneCount = 30;
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
    updateProgress();
    const rows = modal.querySelector('.rf-loading-docs');
    if (rows && rows.dataset.ready !== String(readyDocs())) { rows.dataset.ready = String(readyDocs()); rows.innerHTML = documentRows(); bindDocumentButtons(rows); }
    if (detail.open && detailView?.kind === 'document' && detail.dataset.ready !== String(readyDocs())) renderDetail();
    updateFrames(stage);
  }

  function progressEstimate() {
    const stage = currentStage();
    if (stage !== observedStage) {
      if (observedStage >= 0 && stage === observedStage + 1) stageDurations.push({ actual: (Date.now() - stageStartedAt) / 1000, expected: estimatedStageSeconds[observedStage] });
      observedStage = stage; stageStartedAt = Date.now();
    }
    const samples = stageDurations.filter(item => item.actual > 4);
    const speed = samples.length ? Math.max(.7, Math.min(3, samples.reduce((sum, item) => sum + item.actual, 0) / samples.reduce((sum, item) => sum + item.expected, 0))) : 1;
    const phase = estimatedStageSeconds[stage] * speed;
    const elapsed = (Date.now() - stageStartedAt) / 1000;
    const seconds = estimatedStageSeconds.slice(stage + 1).reduce((sum, value) => sum + value * speed, 0) + Math.max(phase * .35, phase - elapsed);
    const low = Math.max(1, Math.round(seconds * .8 / 60)), high = Math.max(low, Math.ceil(seconds * 1.3 / 60));
    const remaining = elapsed > Math.max(75, phase * 2) ? 'Taking longer than usual' : seconds < 45 ? 'About 1 min left' : 'About ' + low + (high > low ? '–' + high : '') + ' min left';
    return { percent: Math.round(stage / 8 * 100), remaining };
  }
  function updateProgress() {
    const estimate = progressEstimate();
    const progress = modal.querySelector('.rf-loading-progress progress');
    if (progress) { progress.value = estimate.percent; progress.setAttribute('aria-valuetext', estimate.percent + '% of research steps completed'); }
    const percent = modal.querySelector('[data-progress-percent]'), time = modal.querySelector('[data-progress-time]');
    if (percent) percent.textContent = estimate.percent + '%';
    if (time) time.textContent = estimate.remaining;
    const ribbon = modal.querySelector('.rf-rainbow-ribbon');
    if (ribbon) ribbon.style.setProperty('--rf-progress', Math.max(4, estimate.percent) + '%');
    clearTimeout(progressTimer);
    if (modal.open && job?.status !== 'complete' && !document.hidden && modal.querySelector('.rf-loading')) progressTimer = setTimeout(updateProgress, 1000);
  }

  function render() {
    const done = job?.status === 'complete', failed = job?.status === 'failed' || !!setupError, review = needsRecheck();
    if (!done && !failed && !review && modal.dataset.state === 'working' && modal.querySelector('.rf-loading')) { updateLoading(); return; }
    const focus = focusSelector(), scroll = modal.scrollTop, previousState = modal.dataset.state;
    stopFrames(); clearTimeout(progressTimer);
    modal.dataset.state = review ? 'review' : done ? 'complete' : failed ? 'paused' : 'working';
    const loading = !done && !failed && !review;
    let content;
    if (loading) content = loadingView();
    else if (failed && !review) content = paused() + documentRows();
    else content = '<div class="rf-project"><span>' + esc(projectName()) + '</span>' + (job?.cached ? '<span class="rf-saved">Saved ' + esc(date(job.updatedAt)) + '</span>' : '') + '</div>' + completeHero() + '<div class="rf-view-content">' + results() + documentRows() + '</div>';
    modal.innerHTML = '<div class="rf-sky" aria-hidden="true"><i></i><i></i><i></i></div><header class="research-header">' + brand + '<button class="research-close" data-focus="close" aria-label="Close research">×</button></header><main class="rf-main' + (loading ? ' rf-main-loading' : ' rf-main-results') + '">' + (alertMessage ? '<div class="research-alert" role="alert">' + esc(alertMessage) + '</div>' : '') + content + '</main>';
    bind(); modal.scrollTop = scroll;
    if (focus && !detail.open) modal.querySelector(focus)?.focus({ preventScroll: true });
    if (loading) updateLoading();
    if (done && !needsRecheck()) { refreshContact(); checkContacts(); if (previousState === 'working') flyFlock(); }
    if (detail.open && detailView?.kind === 'document' && detail.dataset.ready !== String(readyDocs())) renderDetail();
  }

  function loadingView() {
    const stage = currentStage(), estimate = progressEstimate();
    return '<section class="rf-loading" aria-label="Customer research in progress"><div class="rf-loading-art" aria-hidden="true"><img class="rf-loading-frame is-visible" src="/assets/swan.svg" alt="" decoding="async"><img class="rf-loading-frame rf-loading-next" alt="" decoding="async"></div><h1>Finding your next customers.</h1><p class="rf-loading-stage" role="status" aria-live="polite">' + (job ? phaseCopy[stage] : 'Opening your research.') + '</p><div class="rf-loading-progress"><span class="rf-rainbow-ribbon" aria-hidden="true"><i></i></span><div class="rf-progress-labels"><strong data-progress-percent>' + estimate.percent + '%</strong><span data-progress-time title="Approximate time, based on the remaining research steps. It may vary as websites are checked.">' + estimate.remaining + '</span></div><progress class="rf-visually-hidden" max="100" value="' + estimate.percent + '" aria-label="Research progress"></progress></div><div class="rf-loading-docs" data-ready="' + readyDocs() + '">' + documentRows() + '</div></section>';
  }

  const emailApps = [
    ['Gmail', 'gmail.com'], ['Outlook', 'outlook.com'], ['Apple Mail', 'icloud.com'],
    ['Spark', 'sparkmailapp.com'], ['Thunderbird', 'thunderbird.net'], ['Yahoo Mail', 'mail.yahoo.com'],
    ['Proton Mail', 'proton.me'], ['Fastmail', 'fastmail.com'], ['Zoho Mail', 'zoho.com'], ['Superhuman', 'superhuman.com']
  ];
  const faviconUrl = website => 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain(website)) + '&sz=64';
  function compatibleApps() {
    return '<aside class="rf-compatible" aria-label="Your drafts work with your email app"><span>Compatible with</span><div class="rf-email-apps">' + emailApps.map(([name, host]) => '<span class="rf-email-app" title="' + name + '" aria-label="' + name + '"><span class="rf-app-fallback" aria-hidden="true">' + icons.mail + '</span><img src="' + esc(faviconUrl('https://' + host)) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></span>').join('') + '<small>…and more</small></div><p>Copy your draft into the app you love.</p></aside>';
  }
  function completeHero() {
    if (needsRecheck()) return '<section class="rf-complete-hero rf-complete-review"><div><h1>Your saved research.</h1><p>One more check before you reach out.</p></div></section>';
    const count = job?.data?.leads?.length || 0;
    return '<section class="rf-complete-hero">' + (job?.data?.pagination?.previousId ? '<button class="rf-previous" data-previous>← Previous 3 customers</button>' : '') + '<div class="rf-complete-heading"><h1>' + count + ' potential customer' + (count === 1 ? '' : 's') + '.</h1><p>A reason to reach out. A personal first email.</p></div>' + compatibleApps() + '</section>';
  }

  function paused() {
    return '<section class="rf-paused"><img src="/assets/swan.svg" alt=""><h1>Your search is paused.</h1><p>' + esc(setupError || job?.error || 'We couldn’t finish this step just yet.') + '</p>' + (job?.id ? '<button class="research-button" data-retry data-focus="retry-research">Continue this research ↗</button>' : '<button class="research-button" data-restart data-focus="restart-research">Try again ↗</button>') + '<small>Completed research is saved.</small></section>';
  }

  function documentRows() { return window.ClientFlockDocuments?.renderRows(job?.data || {}) || ''; }
  function bindDocumentButtons(container) { container.querySelectorAll('[data-document]').forEach(button => button.onclick = () => openDetail({ kind: 'document', key: button.dataset.document }, button)); }


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

  const logo = lead => '<span class="rf-company-logo" aria-label="' + esc(lead.name || 'Company') + ' website icon"><span>' + icons.globe + '</span>' + (safeUrl(lead.website) !== '#' ? '<img src="' + esc(faviconUrl(lead.website)) + '" data-favicon-fallback="' + esc(new URL('/favicon.ico', lead.website).href) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span>';
  function results() {
    if (needsRecheck()) return recheckNotice();
    const leads = job?.data?.leads || [];
    if (!leads.length) return '<p>Your shortlist is being prepared.</p>';
    const canFindMore = Number(job?.data?.pagination?.page || 1) < 3;
    const locked = '<div class="rf-more-preview"><div class="rf-locked-rows" aria-label="Preview of the next shortlist">' + [1, 2].map((number) => '<div class="rf-locked-row"><div class="rf-locked-profile" aria-hidden="true"><span class="rf-blur-logo"></span><span class="rf-locked-lines"><i></i><i></i></span></div><div class="rf-locked-actions"><button class="rf-locked-email" data-more aria-label="Unlock the next customers">' + icons.lock + '<span>Unlock</span></button></div></div>').join('') + '</div><div class="rf-next-action"><button class="rf-unlock" data-more data-focus="more-preview">' + icons.spark + ' Find the next ones</button><small>Unlock a fresh shortlist. We’ll research 3 new companies.</small></div></div>';
    return '<section class="rf-shortlist" aria-label="Companies and people to contact"><header class="rf-shortlist-header"><span class="rf-section-icon">' + icons.mail + '</span><h2>People to contact</h2><span class="rf-ready-count">' + leads.length + ' ready</span></header><div class="rf-results">' + leads.map(customerRow).join('') + '</div>' + (canFindMore ? locked : '<p class="rf-shortlist-end">You’ve reached the end of this research. Your earlier shortlists are saved above.</p>') + '</section>';
  }
  function emailUnlock(contact, index, className) {
    const retryable = ['auth_configuration', 'people_response', 'people_no_match', 'daily_limit'].includes(contact?.errorCode) && contact?.retryable === true;
    const wait = retryable && (contact.retryAt || 0) > Date.now();
    return '<button class="' + className + '" ' + (retryable ? 'data-contact-retry' : 'data-contact') + '="' + index + '"' + (wait ? ' disabled' : '') + '>' + icons.lock + '<span>Unlock email address <b>for free</b></span></button>';
  }
  function rowContactMarkup(contact, lead, index) {
    if (contact?.email) return '<a class="rf-row-address" data-compose="' + index + '" href="' + esc(composeUrl(contact, index)) + '">' + esc(contact.email) + '</a><span class="rf-row-address-state">' + (validFoundEmail(contact) ? '✓ Verified' : 'Review before using') + '</span>';
    if (contact?.status === 'working') return contactRunning.has(index) ? '<span class="rf-contact-working" role="status"><i></i> Finding their email…</span>' : '<button class="rf-row-unlock" data-contact="' + index + '">' + icons.lock + ' Continue email search</button>';
    const message = contact?.status === 'unavailable' || contact?.errorCode === 'auth_configuration' ? 'Email search needs to be connected.' : contact && ['not_found', 'error', 'unknown', 'risky', 'skipped'].includes(contact.status) ? 'No verified address yet. Open the draft for details.' : '';
    return emailUnlock(contact, index, 'rf-row-unlock') + (message ? '<span class="rf-row-contact-note">' + message + '</span>' : '');
  }
  function customerRow(lead, index) {
    const contact = contactState[index] || job?.data?.contacts?.[index];
    const name = (contact?.contactKind === 'company_mailbox' ? 'Company team' : contact?.person?.name || contact?.person?.fullName || lead.roleToContact);
    return '<article class="rf-customer-row" data-customer="' + index + '">' + logo(lead) + '<div class="rf-row-name"><h3>' + esc(lead.name) + '</h3><p data-person-name="' + index + '">' + esc(name) + '</p><div class="rf-row-contact" data-row-contact="' + index + '">' + rowContactMarkup(contact, lead, index) + '</div></div><div class="rf-row-actions"><button class="rf-row-view" data-lead="' + index + '" data-focus="view-lead-' + index + '" aria-label="Why contact ' + esc(lead.name) + '?">' + rainbowLabel('Why contact them?') + '</button><button class="rf-row-email" data-email="' + index + '" data-focus="email-lead-' + index + '" aria-label="Email draft for ' + esc(lead.name) + '">' + icons.mail + '<span>Email draft</span></button></div></article>';
  }
  function customerResearch(lead, index) {
    return '<div class="rf-customer-research">' + websiteMarkup(lead, index) + '<div class="rf-customer-story"><section><h3>Why reach out now</h3><p>' + esc(lead.whyNow) + '</p></section><section><h3>What you could offer</h3><p>' + esc(lead.whatToSell) + '</p></section><section><h3>What they gain</h3><p>' + esc(lead.benefit) + '</p></section></div><details class="rf-evidence"><summary data-focus="source-proof-' + index + '"><span>↗</span> The source behind your first line <b>+</b></summary><blockquote>' + esc(lead.evidenceQuote) + '</blockquote><a href="' + esc(safeUrl(lead.sourceUrl)) + '" target="_blank" rel="noopener noreferrer">' + esc(lead.sourceTitle || 'Read the source') + ' ↗</a><small>Source checked ' + esc(date(lead.verifiedAt)) + (lead.sourceDate ? ' · Published ' + esc(lead.sourceDate) : '') + '</small></details><div class="rf-detail-footer"><button class="research-button" data-email="' + index + '">' + icons.mail + ' Read your email draft</button></div></div>';
  }
  function customerEmail(lead, index) {
    const contact = contactState[index] || job?.data?.contacts?.[index], draft = emailDraft(index);
    return '<section class="rf-email-card" data-customer="' + index + '" aria-label="Email draft for ' + esc(lead.name) + '"><div class="rf-email-paper"><div class="rf-to-row"><span>To</span><strong data-person-name="' + index + '">' + esc((contact?.contactKind === 'company_mailbox' ? 'Company team' : contact?.person?.name || contact?.person?.fullName || lead.roleToContact)) + '</strong></div><div class="rf-contact-slot" data-contact-slot="' + index + '">' + contactMarkup(contact, lead, index) + '</div><div class="rf-draft-heading"><span>Edit your draft</span><small data-draft-save>Change the subject or message below</small></div><label class="rf-draft-field"><span>Subject</span><input data-draft-field="subject" data-draft-index="' + index + '" maxlength="200" value="' + esc(draft.subject) + '" autocomplete="off"></label><label class="rf-draft-field rf-draft-message"><span>Message</span><textarea data-draft-field="body" data-draft-index="' + index + '" rows="8" maxlength="20000">' + esc(draft.body) + '</textarea></label><div class="rf-email-footer rf-send-options"><button class="research-button rf-copy-send" data-copy="' + index + '">' + icons.mail + ' Copy and send email myself</button><p class="rf-send-guidance">Start small. We recommend a maximum of 3 thoughtful emails a day.</p><div class="rf-copy-feedback" data-copy-feedback role="status" hidden><span data-copy-message></span><a data-open-email="' + index + '" href="' + esc(composeUrl(contact, index)) + '">Open my email app ↗</a></div><div class="rf-connected-send"><div><button type="button" disabled aria-describedby="rf-send-capacity">Send it with ClientFlock</button><small id="rf-send-capacity">At capacity for now. Coming back soon.</small></div><button type="button" data-send-mcp="' + index + '">Send it with our MCP ' + icons.arrow + '</button></div></div><p class="rf-draft-note">Your changes stay in this browser. You review every email before sending.</p></div></section>';
  }
  function openDetail(view, trigger) {
    detailView = view; if (!detail.open) detailOpener = trigger || document.activeElement;
    renderDetail(false);
    if (!detail.open) detail.showModal();
    detail.querySelector('[data-detail-close]')?.focus({ preventScroll: true });
  }
  function renderDetail(preserveScroll = true) {
    if (!detailView) return;
    const titles = { mission: ['Mission', 'What you sell and why it matters'], market: ['Market', 'The market around your business'], idealClients: ['Ideal customers', 'Who to prioritize and where to begin'] };
    const { kind, index, key } = detailView;
    const lead = job?.data?.leads?.[index];
    let title = '', subtitle = '', content = '';
    if (kind === 'document') {
      [title, subtitle] = titles[key] || titles.mission;
      content = window.ClientFlockDocuments?.renderSingle(job?.data || {}, key) || '';
    } else if ((kind === 'lead' || kind === 'email') && lead) {
      title = lead.name;
      const contact = contactState[index] || job?.data?.contacts?.[index], person = contact?.person;
      subtitle = (contact?.contactKind === 'company_mailbox' ? 'Company team' : person?.fullName || person?.name || lead.roleToContact || '') + (kind === 'email' ? ' · Your first email' : ' · Why they could be a good fit');
      content = kind === 'lead' ? customerResearch(lead, index) : customerEmail(lead, index);
    } else if (kind === 'more') {
      title = 'Your next three.';
      subtitle = 'Keep exploring the people who could need what you sell.';
      content = '<div class="rf-more-dialog"><span class="rf-more-dialog-art">' + icons.spark + '</span><p>We’ll use your mission, market and ideal customers to research a fresh shortlist, and keep these companies out of it.</p><button class="research-button" data-find-more>Find the next ones ' + icons.arrow + '</button><small>The same strategy, a fresh shortlist. Your first three stay saved.</small><p class="rf-more-feedback" role="status"></p></div>';
    }
    detail.dataset.kind = kind; detail.dataset.ready = String(readyDocs());
    const scroll = preserveScroll ? detail.querySelector('.rf-detail-body')?.scrollTop || 0 : 0;
    detail.innerHTML = '<header class="rf-detail-header"><div><h2 id="rf-detail-title">' + esc(title) + '</h2><p data-detail-subtitle>' + esc(subtitle) + '</p></div><button class="research-close" data-detail-close aria-label="Close details">×</button></header><div class="rf-detail-body">' + content + '</div>';
    bindDetails(detail); detail.querySelector('[data-detail-close]').onclick = () => detail.close();
    if (kind === 'document') window.ClientFlockDocuments?.bind(detail.querySelector('.rf-detail-body'), job?.data || {});
    detail.querySelector('.rf-detail-body').scrollTop = scroll;
    refreshContact(index);
  }

  function contactMarkup(contact, lead, index) {
    if (contact?.email) {
      const verified = contact.status === 'found';
      return '<div class="rf-contact-result"><a data-compose="' + index + '" href="' + esc(composeUrl(contact, index)) + '">' + esc(contact.email) + '</a><span class="' + (verified ? 'verified' : 'risky') + '">' + (verified ? (contact.contactKind === 'company_mailbox' ? '✓ Verified company inbox' : '✓ Verified by Icypeas') : 'Review before using · ' + esc(contact.certainty || 'uncertain')) + '</span>' + (contact.sourceUrl && safeUrl(contact.sourceUrl) !== '#' ? '<a class="rf-contact-source" href="' + esc(safeUrl(contact.sourceUrl)) + '" target="_blank" rel="noopener noreferrer">Published on the company website ↗</a>' : '') + '</div>';
    }
    const busy = contactRunning.has(index);
    if (contact?.status === 'working') return '<span class="rf-contact-working" role="status"><i></i> ' + (busy ? esc(contact.message || 'Finding and checking their email…') : 'Your email search is saved.') + '</span>' + (!busy ? '<button class="rf-find-contact" data-contact="' + index + '">Continue email search ↗</button>' : '');
    const retryable = ['auth_configuration', 'people_response', 'people_no_match', 'daily_limit'].includes(contact?.errorCode) && contact?.retryable === true;
    const wait = retryable ? Math.max(0, Math.ceil(((contact.retryAt || 0) - Date.now()) / 1000)) : 0;
    const state = contact?.message || (contact ? 'We haven’t found a verified address for this company yet.' : 'Find the right person and check their email address.');
    return '<div class="rf-unlock-contact">' + emailUnlock(contact, index, 'rf-find-contact') + '<span class="rf-contact-empty">' + esc(state) + '</span>' + (retryable && contact.requiresNewLookup === true ? '<small class="rf-contact-credit-note">We’ll try a broader lookup. This may use the site’s Icypeas credits.</small>' : '') + (wait ? '<small class="rf-contact-cooldown" role="status">' + (wait >= 3600 ? 'Daily limit reached. Try again tomorrow.' : 'Try again in ' + wait + ' seconds.') + '</small>' : '') + '</div>';
  }

  function bindContactButtons(container = detail) {
    container.querySelectorAll('[data-contact]').forEach(button => button.onclick = () => enrich(Number(button.dataset.contact)));
    container.querySelectorAll('[data-contact-retry]').forEach(button => button.onclick = () => enrich(Number(button.dataset.contactRetry), true));
  }
  function refreshContact(index) {
    const indices = Number.isInteger(index) ? [index] : (job?.data?.leads || []).map((_, i) => i);
    indices.forEach(i => {
      clearTimeout(contactTimers.get(i)); contactTimers.delete(i);
      const lead = job?.data?.leads?.[i];
      if (!lead || !modal.open) return;
      const contact = contactState[i] || job?.data?.contacts?.[i];
      const name = (contact?.contactKind === 'company_mailbox' ? 'Company team' : contact?.person?.name || contact?.person?.fullName || lead.roleToContact) || 'Company contact';
      [modal, detail].forEach(container => container.querySelectorAll('[data-person-name="' + i + '"]').forEach(element => { element.textContent = name; }));
      if (detailView?.index === i && ['lead', 'email'].includes(detailView.kind)) { const subtitle = detail.querySelector('[data-detail-subtitle]'); if (subtitle) subtitle.textContent = name + (detailView.kind === 'email' ? ' · Your first email' : ' · Why they could be a good fit'); }
      const rowSlot = modal.querySelector('[data-row-contact="' + i + '"]');
      if (rowSlot) {
        const hadFocus = rowSlot.contains(document.activeElement);
        rowSlot.innerHTML = rowContactMarkup(contact, lead, i); bindContactButtons(rowSlot);
        rowSlot.querySelectorAll('[data-email]').forEach(button => button.onclick = () => openDetail({ kind: 'email', index: i }, button));
        if (hadFocus) rowSlot.querySelector('button:not(:disabled),a')?.focus({ preventScroll: true });
      }
      const slot = detail.querySelector('[data-contact-slot="' + i + '"]');
      if (slot) {
        const hadFocus = slot.contains(document.activeElement);
        slot.innerHTML = contactMarkup(contact, lead, i); bindContactButtons(slot);
        if (hadFocus) slot.querySelector('button:not(:disabled), a')?.focus({ preventScroll: true });
      }
      updateComposeLinks(i);
      const remaining = (contact?.retryAt || 0) - Date.now();
      if (remaining > 0) contactTimers.set(i, setTimeout(() => refreshContact(i), remaining + 50));
    });
  }

  async function checkContacts() {
    if (healthChecked) return;
    healthChecked = true; const run = generation;
    try { const health = await request('/api/health'); if (run !== generation) return; contactAvailable = health.contacts === true; refreshContact(); } catch { if (run === generation) refreshContact(); }
  }

  function bindDetails(container) {
    container.querySelectorAll('[data-lead]').forEach(button => button.onclick = () => openDetail({ kind: 'lead', index: Number(button.dataset.lead) }, button));
    container.querySelectorAll('[data-email]').forEach(button => button.onclick = () => openDetail({ kind: 'email', index: Number(button.dataset.email) }, button));
    container.querySelectorAll('[data-copy]').forEach(button => button.onclick = async () => {
      const index = Number(button.dataset.copy), draft = emailDraft(index), feedback = container.querySelector('[data-copy-feedback]');
      const contact = contactState[index] || job?.data?.contacts?.[index];
      const link = feedback?.querySelector('[data-open-email]'); if (link) link.href = composeUrl(contact, index);
      try {
        await navigator.clipboard.writeText('Subject: ' + draft.subject + '\n\n' + draft.body);
        button.textContent = 'Copied ✓';
        if (feedback) { feedback.hidden = false; feedback.querySelector('[data-copy-message]').textContent = 'Paste it into your email app, or open a ready-to-edit draft.'; }
        setTimeout(() => { if (button.isConnected) button.innerHTML = icons.mail + ' Copy and send email myself'; }, 2500);
      } catch {
        if (feedback) { feedback.hidden = false; feedback.querySelector('[data-copy-message]').textContent = 'Clipboard access is unavailable. You can open the draft in your email app instead.'; }
      }
    });
    container.querySelectorAll('[data-send-mcp]').forEach(button => button.onclick = () => {
      const index = Number(button.dataset.sendMcp), draft = emailDraft(index), contact = contactState[index] || job?.data?.contacts?.[index];
      if (window.ClientFlockMail?.open) window.ClientFlockMail.open({ jobId: job.id, leadIndex: index, recipient: contact?.email || '', subject: draft.subject, body: draft.body, company: job.data.leads[index].name });
      else { const note = container.querySelector('.rf-draft-note'); if (note) note.textContent = 'The email connection is not available yet. Copy the draft to your email app in the meantime.'; }
    });
    container.querySelectorAll('[data-draft-field]').forEach(field => {
      const fit = () => { if (field.tagName === 'TEXTAREA') { field.style.height = 'auto'; field.style.height = Math.max(190, field.scrollHeight) + 'px'; } };
      field.addEventListener('input', () => { saveDraft(Number(field.dataset.draftIndex), field.dataset.draftField, field.value); fit(); });
      requestAnimationFrame(fit);
    });
    container.querySelectorAll('[data-more]').forEach(button => button.onclick = () => {
      const id = job?.id, run = generation;
      if (window.ClientFlockCheckout?.open) window.ClientFlockCheckout.open({ jobId: id, onUnlocked: () => { if (run === generation && job?.id === id && modal.open) openDetail({ kind: 'more' }, button); } });
      else notice('Checkout is not available yet. Please try again shortly.');
    });
    container.querySelector('[data-find-more]')?.addEventListener('click', findMore);
    bindDocumentButtons(container); bindContactButtons(container);
  }
  function bind() {
    modal.querySelector('.research-close').onclick = () => modal.close();
    modal.querySelectorAll('.rf-company-logo img,.rf-email-app img').forEach(image => {
      const failed = () => { if (image.dataset.faviconFallback) { const fallback = image.dataset.faviconFallback; delete image.dataset.faviconFallback; image.src = fallback; } else image.remove(); };
      image.addEventListener('error', failed);
      image.addEventListener('load', () => image.parentElement.classList.add('has-logo'));
      if (image.complete) { if (image.naturalWidth) image.parentElement.classList.add('has-logo'); else failed(); }
    });
    modal.querySelector('[data-retry]')?.addEventListener('click', async event => { const run = generation, id = job.id, button = event.currentTarget; button.disabled = true; try { const next = await request('/api/search/' + id + '/retry', {}); if (run !== generation) return; job = next; alertMessage = ''; render(); loop(); } catch (error) { if (run === generation) notice(error.message); } finally { if (run === generation && button.isConnected) button.disabled = false; } });
    modal.querySelector('[data-restart]')?.addEventListener('click', () => { if (lastInput) window.ClientFlockResearch.start(lastInput); else if (lastResumeId) window.ClientFlockResearch.resume(lastResumeId); else modal.close(); });
    modal.querySelector('[data-requalify]')?.addEventListener('click', requalify);
    modal.querySelector('[data-previous]')?.addEventListener('click', () => window.ClientFlockResearch.resume(job.data.pagination.previousId));
    bindDetails(modal);
  }
  async function findMore(event) {
    const button = event.currentTarget, run = generation, id = job?.id;
    if (!id || button.disabled) return;
    button.disabled = true; button.textContent = 'Opening your next search…';
    try {
      const next = await request('/api/search/' + id + '/more', {});
      if (run !== generation) return;
      reset(); job = next;
      try { localStorage.setItem('clientflock-search-id', job.id); } catch {}
      render(); loop();
    } catch (error) {
      if (run !== generation) return;
      const feedback = detail.querySelector('.rf-more-feedback'); if (feedback) feedback.textContent = error.message;
      button.disabled = false; button.innerHTML = 'Find the next ones ' + icons.arrow;
    }
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
        const response = await request('/api/search/' + id + '/contacts', { leadIndex: index, ...(retry && count === 1 ? { retry: true, ...(oldContact?.requiresNewLookup === true ? { allowNewLookup: true } : {}) } : {}) });
        if (run !== generation) return;
        contactState[index] = { ...response.contact, ...(response.contact?.retryable === true && response.retryAfterMs > 0 ? { retryAt: Date.now() + response.retryAfterMs } : {}) };
        refreshContact(index);
        if (!validFoundEmail(oldContact) && validFoundEmail(response.contact)) celebrateEmail(index);
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
    removeEffects(); generation++; running = false; contactRunning = new Set(); contactState = {}; activeDoc = 'mission'; activeView = 'discovery';
    setupError = ''; alertMessage = ''; healthChecked = false; contactAvailable = false; requalifying = false;
    contactTimers.forEach(clearTimeout); contactTimers.clear(); stopFrames(); framePosition = Math.floor(Math.random() * sceneCount); clearTimeout(progressTimer); observedStage = -1; stageDurations = []; stageStartedAt = Date.now(); detailView = null; if (detail.open) detail.close();
  }
  function open() { const fresh = !modal.open; if (fresh) modal.showModal(); document.body.style.overflow = 'hidden'; modal.scrollTop = 0; modal.querySelector('.research-close')?.focus({ preventScroll: true }); if (modal.querySelector('.rf-loading')) { updateLoading(); if (fresh) flyFlock(); } }

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

  detail.addEventListener('close', () => { if (detail.open) return; const trigger = detailOpener, previous = detailView; detailView = null; if (!modal.open) return; const fallback = previous?.kind === 'document' ? modal.querySelector('[data-document="' + CSS.escape(previous.key) + '"]') : Number.isInteger(previous?.index) ? modal.querySelector('[data-email="' + previous.index + '"]') : modal.querySelector('[data-more]'); (trigger?.isConnected ? trigger : fallback || modal.querySelector('.research-close'))?.focus({ preventScroll: true }); });
  detail.addEventListener('click', event => { if (event.target !== detail) return; const rect = detail.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) detail.close(); });
  modal.addEventListener('close', () => { if (modal.open) return; if (detail.open) detail.close(); removeEffects(); clearTimeout(progressTimer); generation++; running = false; contactRunning = new Set(); stopFrames(); contactTimers.forEach(clearTimeout); contactTimers.clear(); document.body.style.overflow = ''; opener?.focus(); });
  document.addEventListener('visibilitychange', () => { modal.dataset.hidden = String(document.hidden); if (document.hidden) { removeEffects(); clearTimeout(frameTimer); frameTimer = null; clearTimeout(progressTimer); } else if (modal.open && modal.querySelector('.rf-loading')) updateLoading(); });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { if (reducedMotion()) removeEffects(); clearTimeout(frameTimer); frameTimer = null; if (modal.open && modal.querySelector('.rf-loading')) updateFrames(currentStage()); });
  function resumeButton() {
    let id; try { id = localStorage.getItem('clientflock-search-id'); } catch {} if (!id) return;
    let button = document.querySelector('.resume-research');
    if (!button) { button = document.createElement('button'); button.className = 'resume-research'; button.textContent = '↗ Return to your research'; document.querySelector('.reassurance')?.after(button); }
    button.onclick = () => window.ClientFlockResearch.resume(id);
  }
  resumeButton();
})();
