(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const safeLink = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
  const dialog = document.createElement('dialog'); dialog.className = 'cf-mailbox'; dialog.setAttribute('aria-labelledby','cf-mailbox-title'); document.body.append(dialog);
  let context, originalContext, opener, status = {}, version = 0, oauthTimer, popup, editingId = null, mcpCredential;
  const submissionKeys = new Map();
  const draftStatus = item => item.status === 'queued' ? 'Queued for ' + dateLabel(item.scheduledFor) : item.status === 'created' ? item.instruction || 'Open Drafts in the email account you connected.' : ['check_mailbox','uncertain'].includes(item.status) ? 'Check your Drafts folder before trying again' : item.status === 'reconnect_required' ? 'Reconnect your mailbox to continue' : ['preparing','dispatching'].includes(item.status) ? 'Preparing your draft…' : item.status === 'cancelled' ? 'Removed from your queue' : 'Draft waiting for confirmation';
  const requestId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(24))].map(byte => byte.toString(16).padStart(2,'0')).join('');
  const providerName = provider => provider === 'gmail' ? 'Gmail' : 'Outlook';
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/></svg>';
  async function api(path, body, method) {
    const response = await fetch(path, { credentials:'same-origin', ...(body === undefined && !method ? {} : { method:method || 'POST', headers:{ 'Content-Type':'application/json' }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(result.error || 'We couldn’t connect to your mailbox. Please try again.');
    return result;
  }
  function message(text, error = false) {
    const el = dialog.querySelector('[data-mail-message]');
    if (el) { el.textContent = text; el.classList.toggle('is-error', error); }
  }
  function dailyTime() {
    const date = new Date(); date.setUTCDate(date.getUTCDate()+1); date.setUTCHours(9,0,0,0);
    return new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date);
  }
  function dateLabel(value) {
    const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }
  function formValues() {
    const form = dialog.querySelector('[data-mail-form]');
    return { to:form?.elements.to.value.trim() || '', subject:form?.elements.subject.value || '', body:form?.elements.body.value || '', company:context.company || '', delivery:form?.elements.delivery.value || 'now' };
  }
  function rememberForm() { if (dialog.querySelector('[data-mail-form]')) context = { ...context, ...formValues(), recipient:formValues().to }; }
  function render() {
    const connected = status.connected === true;
    const unavailable = !status.providers?.gmail && !status.providers?.outlook;
    dialog.innerHTML = '<button class="cf-mailbox-close" data-mail-close aria-label="Close mailbox options">×</button><header class="cf-mailbox-header"><span class="cf-mailbox-symbol">' + icon + '</span><span class="cf-mailbox-eyebrow">YOUR EMAIL. YOUR FINAL SAY.</span><h2 id="cf-mailbox-title">We draft. You press send.</h2><p>Put your ClientFlock emails in your own Drafts folder. Read, edit and send them when you’re ready.</p></header><div class="cf-mailbox-body">' + (connected ? connectedView() : '<div class="cf-mailbox-connect"><h3>Connect your mailbox</h3><div class="cf-mailbox-providers">' + ['gmail','outlook'].map(provider => '<button type="button" data-mail-connect="' + provider + '"' + (!status.providers?.[provider] ? ' disabled' : '') + '><img src="https://www.google.com/s2/favicons?domain=' + (provider === 'gmail' ? 'mail.google.com' : 'outlook.com') + '&sz=64" width="22" height="22" alt=""><span>' + providerName(provider) + '</span>' + (!status.providers?.[provider] ? '<small>Coming soon</small>' : '<span aria-hidden="true">↗</span>') + '</button>').join('') + '</div><p class="cf-mailbox-note">' + (unavailable ? 'Mailbox connections are being set up. You can still copy your email or open it in your email app from the draft.' : 'You’ll authorize your mailbox on Google or Microsoft. ClientFlock creates drafts; it never presses Send.') + '</p><div data-mail-connect-link></div></div>') + '<p class="cf-mailbox-message" data-mail-message role="status" aria-live="polite"></p></div>';
    dialog.querySelector('[data-mail-close]').onclick = () => dialog.close();
    dialog.querySelectorAll('[data-mail-connect]').forEach(button => { button.onclick = () => connect(button.dataset.mailConnect, button); });
    dialog.querySelector('[data-mail-form]')?.addEventListener('submit', submitDraft);
    dialog.querySelectorAll('[name="delivery"]').forEach(radio => radio.onchange = updateSubmit);
    dialog.querySelector('[data-mail-disconnect]')?.addEventListener('click', disconnect);
    dialog.querySelector('[data-mail-token]')?.addEventListener('click', generateToken);
    dialog.querySelectorAll('[data-mail-cancel]').forEach(button => button.onclick = () => cancelQueued(button));
    dialog.querySelectorAll('[data-mail-edit]').forEach(button => button.onclick = () => editQueued(button.dataset.mailEdit));
    dialog.querySelector('[data-mail-stop-edit]')?.addEventListener('click', () => { editingId = null; context = {...originalContext}; render(); });
    if (editingId) {
      dialog.querySelector('.cf-mailbox-delivery').hidden = true;
      const note = document.createElement('div'); note.className = 'cf-mailbox-editing'; note.innerHTML = 'Editing a queued draft <button type="button" data-mail-stop-edit>Back to current email</button>';
      dialog.querySelector('[data-mail-form]').prepend(note); note.querySelector('button').onclick = () => { editingId = null; context = {...originalContext}; render(); };
    }
    dialog.querySelectorAll('.cf-mailbox-providers img').forEach(img => img.onerror = () => { img.hidden = true; });
    updateSubmit();
  }
  function connectedView() {
    const queue = Array.isArray(status.queue) ? status.queue.slice(0,6) : [];
    return '<div class="cf-mailbox-connected"><span><i></i>' + providerName(status.provider) + ' connected</span><button type="button" data-mail-disconnect>Disconnect</button></div><form data-mail-form><div class="cf-mailbox-draft"><label>TO<input type="email" name="to" required autocomplete="off" maxlength="254" value="' + esc(context.recipient || '') + '" placeholder="Unlock the email address first"></label><label>SUBJECT<input name="subject" required maxlength="200" value="' + esc(context.subject) + '"></label><label>MESSAGE<textarea name="body" required maxlength="12000" rows="6">' + esc(context.body) + '</textarea></label></div><fieldset class="cf-mailbox-delivery"><legend>When should we prepare it?</legend><label><input type="radio" name="delivery" value="now"' + (context.delivery !== 'daily' ? ' checked' : '') + '><span><b>In my Drafts folder now</b><small>You can open it, edit it and press Send.</small></span></label><label><input type="radio" name="delivery" value="daily"' + (context.delivery === 'daily' ? ' checked' : '') + '><span><b>Add to my daily draft queue</b><small>Up to 3 drafts each morning at ' + esc(dailyTime()) + ', starting tomorrow.</small></span></label></fieldset><button class="cf-mailbox-primary" type="submit" data-mail-submit>Create draft in ' + providerName(status.provider) + '</button><p class="cf-mailbox-note">We recommend starting with no more than 3 thoughtful emails a day. Check your Drafts folder each morning; nothing is sent automatically.</p></form>' + (queue.length ? '<section class="cf-mailbox-queue"><h3>Your recent drafts</h3>' + queue.map(item => '<article><div><b>' + esc(item.company || item.to) + '</b><span>' + esc(item.subject) + '</span><small>' + esc(draftStatus(item)) + '</small></div>' + (safeLink(item.openUrl) ? '<a href="' + esc(safeLink(item.openUrl)) + '" target="_blank" rel="noopener noreferrer">Open ↗</a>' : item.status === 'queued' ? '<div class="cf-mailbox-queue-actions"><button type="button" data-mail-edit="' + esc(item.id) + '">Edit</button><button type="button" data-mail-cancel="' + esc(item.id) + '">Cancel</button></div>' : '') + '</article>').join('') + '</section>' : '') + '<details class="cf-mailbox-mcp"><summary>Connect through our MCP <span>+</span></summary><p>Let your AI assistant access this draft queue and prepare drafts in your connected mailbox. You still review and send from your email app.</p><button type="button" class="cf-mailbox-secondary" data-mail-token' + (!status.mcpReady ? ' disabled' : '') + '>' + (status.mcpReady ? 'Create my MCP connection' : 'MCP connection is being set up') + '</button><div data-mail-mcp-result></div></details>';
  }
  function updateSubmit() {
    const button = dialog.querySelector('[data-mail-submit]');
    if (!button) return;
    button.textContent = editingId ? 'Save changes to queued draft' : dialog.querySelector('[name="delivery"]:checked')?.value === 'daily' ? 'Add to my daily draft queue' : 'Create draft in ' + providerName(status.provider);
  }
  async function loadStatus(run, preserve = false) {
    const result = await api('/api/mail/status');
    if (run !== version || !dialog.open) return false;
    if (preserve) rememberForm(); status = result; render(); return result.connected === true;
  }
  async function connect(provider, button) {
    const run = version;
    popup = window.open('about:blank','clientflock-mail-connect','popup,width=620,height=740');
    if (popup) { try { popup.document.title = 'Connecting your mailbox'; popup.document.body.textContent = 'Opening your mailbox connection…'; popup.opener = null; } catch {} }
    button.disabled = true; message('Opening ' + providerName(provider) + '…');
    try {
      const data = await api('/api/mail/connect?provider=' + encodeURIComponent(provider));
      if (run !== version || !dialog.open) { popup?.close(); return; }
      const url = new URL(data.url);
      if (!['accounts.google.com','login.microsoftonline.com'].includes(url.hostname) || url.protocol !== 'https:') throw Error('The mailbox connection could not be opened.');
      if (popup && !popup.closed) popup.location.href = url.href;
      else {
        const slot = dialog.querySelector('[data-mail-connect-link]');
        slot.innerHTML = '<a class="cf-mailbox-primary" href="' + esc(url.href) + '" target="_blank" rel="noopener noreferrer">Continue to ' + providerName(provider) + ' ↗</a>';
      }
      message('Finish connecting in the new window. This page will update automatically.');
      let attempts = 0;
      const check = async () => {
        if (run !== version || !dialog.open) return;
        try {
          const latest = await api('/api/mail/status');
          if (run !== version || !dialog.open) return;
          if (latest.connected) { status = latest; render(); message('Connected. Your email is ready to become a draft.'); try { popup?.close(); } catch {} return; }
        } catch {}
        attempts++;
        if (attempts < 90) oauthTimer = setTimeout(check, 2000);
        else { button.disabled = false; message('Connection hasn’t finished yet. Close and reopen this window after authorizing your mailbox.'); }
      };
      clearTimeout(oauthTimer); oauthTimer = setTimeout(check, 1500);
    } catch (error) { try { popup?.close(); } catch {} if (run === version && dialog.open) { button.disabled = false; message(error.message,true); } }
  }
  async function submitDraft(event) {
    event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
    const button = form.querySelector('[data-mail-submit]'); if (button.disabled) return;
    const payload = formValues(), signature = JSON.stringify({jobId:context.jobId,leadIndex:context.leadIndex,...payload}), run = version, edit = editingId;
    button.disabled = true; button.textContent = edit ? 'Saving your changes…' : payload.delivery === 'daily' ? 'Adding to your queue…' : 'Creating your draft…'; message('');
    try {
      const digest = crypto.subtle ? [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature)))].map(byte=>byte.toString(16).padStart(2,'0')).join('') : null;
      const storageKey = digest ? 'clientflock-mail-request:' + digest : null;
      if (!submissionKeys.has(signature)) { let existing; try { if(storageKey)existing=sessionStorage.getItem(storageKey); } catch {} submissionKeys.set(signature,existing||requestId()); }
      const requestKey = submissionKeys.get(signature); try { if(storageKey)sessionStorage.setItem(storageKey,requestKey); } catch {}
      const result = edit ? await api('/api/mail/drafts/' + encodeURIComponent(edit),payload,'PATCH') : await api('/api/mail/drafts',{...payload,idempotencyKey:requestKey});
      if (run !== version || !dialog.open) return;
      context = edit ? {...originalContext} : {...context,...payload,recipient:payload.to}; editingId=null;
      await loadStatus(run);
      if (run !== version || !dialog.open) return;
      const draft = result.draft || {};
      message(edit ? 'Your queued draft has been updated.' : draft.status === 'queued' ? 'Added to your queue for ' + (dateLabel(draft.scheduledFor) || 'the next morning') + '. You’ll find it in your Drafts folder.' : ['check_mailbox','uncertain'].includes(draft.status) ? 'Your mailbox hasn’t confirmed this draft yet. Check your Drafts folder before creating another.' : draft.status === 'created' ? 'Your draft is ready. ' + (draft.instruction || 'Open Drafts in the email account you connected.') + ' Edit it there, then press Send.' : draft.status === 'reconnect_required' ? 'Your mailbox needs to be reconnected before this draft can be prepared.' : 'Your draft is being prepared. Check your Drafts folder in a moment.');
      const openUrl = safeLink(draft.openUrl);
      if (openUrl) { const link = document.createElement('a'); link.className='cf-mailbox-open-draft'; link.href=openUrl; link.target='_blank'; link.rel='noopener noreferrer'; link.textContent='Open my draft ↗'; dialog.querySelector('[data-mail-message]').after(link); }
    } catch (error) { if (run === version && dialog.open) { button.disabled = false; updateSubmit(); message(error.message,true); } }
  }
  function editQueued(id) {
    const item=status.queue?.find(draft=>draft.id===id&&draft.status==='queued'); if(!item)return;
    editingId=id; context={...originalContext,recipient:item.to,subject:item.subject,body:item.body,company:item.company,delivery:'daily'}; render(); dialog.querySelector('[name="subject"]')?.focus();
  }
  async function disconnect() {
    const run = version, button = dialog.querySelector('[data-mail-disconnect]'); button.disabled = true; rememberForm();
    try { await api('/api/mail/disconnect',{}); if (run !== version || !dialog.open) return; mcpCredential = null; await loadStatus(run); message('Mailbox disconnected. No new drafts will be created.'); }
    catch (error) { if (run === version && dialog.open) { button.disabled=false; message(error.message,true); } }
  }
  async function cancelQueued(button) {
    const run = version; button.disabled=true;
    try { await api('/api/mail/drafts/' + encodeURIComponent(button.dataset.mailCancel), undefined, 'DELETE'); if (run !== version || !dialog.open) return; await loadStatus(run,true); message('Draft removed from your queue.'); }
    catch (error) { if (run === version && dialog.open) { button.disabled=false; message(error.message,true); } }
  }
  async function copy(text, button, fallback) {
    try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; setTimeout(() => { if (button.isConnected) button.textContent = fallback; },2000); }
    catch { message('Clipboard access was blocked. Select the connection fields to copy them manually.',true); }
  }
  async function generateToken() {
    const run = version, button=dialog.querySelector('[data-mail-token]'); button.disabled=true; button.textContent='Preparing connection…';
    try {
      const data = await api('/api/mail/mcp-token',{});
      if (run !== version || !dialog.open) return;
      const url = safeLink(data.url); if (!url || !data.token) throw Error('Your MCP connection is not ready yet.');
      mcpCredential={url,token:data.token};
      const slot=dialog.querySelector('[data-mail-mcp-result]');
      slot.innerHTML='<div class="cf-mailbox-mcp-fields"><label>SERVER URL<input readonly data-mcp-url value="'+esc(url)+'"></label><label>BEARER TOKEN<input readonly type="password" data-mcp-token value="'+esc(data.token)+'"></label><div><button type="button" data-mcp-copy-url>Copy URL</button><button type="button" data-mcp-copy-token>Copy token</button><button type="button" data-mcp-show>Show token</button></div><button type="button" class="cf-mailbox-secondary" data-mcp-copy-config>Copy MCP configuration</button><small>Add this server and bearer token in an MCP client that supports HTTP servers. This private connection expires '+esc(dateLabel(data.expiresAt))+'. Copy it now; it isn’t saved in your browser.</small></div>';
      slot.querySelector('[data-mcp-copy-url]').onclick = event => copy(mcpCredential.url,event.currentTarget,'Copy URL');
      slot.querySelector('[data-mcp-copy-token]').onclick = event => copy(mcpCredential.token,event.currentTarget,'Copy token');
      slot.querySelector('[data-mcp-copy-config]').onclick = event => copy(JSON.stringify({mcpServers:{clientflock:{url:mcpCredential.url,headers:{Authorization:'Bearer '+mcpCredential.token}}}},null,2),event.currentTarget,'Copy MCP configuration');
      slot.querySelector('[data-mcp-show]').onclick = event => { const input=slot.querySelector('[data-mcp-token]'); input.type=input.type==='password'?'text':'password';event.currentTarget.textContent=input.type==='password'?'Show token':'Hide token'; };
      button.textContent='Connection created';
    } catch (error) { if (run===version && dialog.open) {button.disabled=false;button.textContent='Try creating the connection again';message(error.message,true);} }
  }
  async function open(options) {
    context={...options}; originalContext={...options}; opener=document.activeElement; status={}; editingId=null; mcpCredential=null; const run=++version; clearTimeout(oauthTimer);
    dialog.innerHTML='<button class="cf-mailbox-close" data-mail-close aria-label="Close mailbox options">×</button><header class="cf-mailbox-header"><span class="cf-mailbox-symbol">'+icon+'</span><h2 id="cf-mailbox-title">We draft. You press send.</h2><p role="status">Checking your mailbox connection…</p></header>';
    dialog.querySelector('[data-mail-close]').onclick=()=>dialog.close(); if (!dialog.open) dialog.showModal();
    try { await loadStatus(run); } catch (error) { if(run!==version||!dialog.open)return;render();message(error.message,true); }
  }
  dialog.addEventListener('close',()=>{version++;clearTimeout(oauthTimer);mcpCredential=null;dialog.querySelector('[data-mail-mcp-result]')?.replaceChildren();if(opener?.isConnected)opener.focus({preventScroll:true});});
  window.ClientFlockMail=Object.freeze({open});
})();
