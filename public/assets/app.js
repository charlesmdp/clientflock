(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const escape = (text) => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const store = {get(){try{const v=JSON.parse(localStorage.getItem('clientflock-brief') || '{}');return v&&typeof v==='object'?v:{}}catch{return {}}},set(value){try{localStorage.setItem('clientflock-brief',JSON.stringify(value));return true}catch{return false}}};
  const scenarios = window.CLIENTFLOCK_SCENARIOS;
  let activeScenario='pool';
  let samples=scenarios[activeScenario].leads;
  const dialog = document.createElement('dialog');
  dialog.className='cf-modal'; dialog.setAttribute('aria-labelledby','modal-title'); document.body.append(dialog);
  let previousFocus, sampleIndex=0;
  function show(content){
    if(!dialog.open)previousFocus=document.activeElement;
    dialog.innerHTML='<button class="modal-close" aria-label="Close dialog">×</button>'+content;
    if(!dialog.open)dialog.showModal();
    document.body.style.overflow='hidden';
    $('.modal-close',dialog).addEventListener('click',()=>dialog.close());
  }
  dialog.addEventListener('close',()=>{document.body.style.overflow='';if(previousFocus?.isConnected)previousFocus.focus();});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  const eyebrow=t=>'<div class="modal-eyebrow"><img src="/assets/swan.svg" alt="">'+t+'</div>';
  function focusBusiness(){if(dialog.open)dialog.close();const input=$('[data-business-input]');input?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});input?.focus({preventScroll:true});}
  function how(){show(eyebrow('How it works')+'<h2 id="modal-title">From your business<br>to your next conversation.</h2><div class="modal-steps"><div class="modal-step"><span>1</span><div><h3>Tell us what you do</h3><p>Enter your website or describe your business in a few words.</p></div></div><div class="modal-step"><span>2</span><div><h3>Find relevant prospects</h3><p>Think beyond the obvious industries. Follow new projects, growing teams and changes that create a need for what you sell.</p></div></div><div class="modal-step"><span>3</span><div><h3>Make it personal</h3><p>Start your email with a precise detail about the prospect. Review it before reaching out.</p></div></div></div><button class="modal-button wide" data-action="start">Find my next 3 customers <span>→</span></button>');}
  function audience(){show(eyebrow('Who it’s for')+'<h2 id="modal-title">For people running<br>their own business.</h2><div class="modal-steps"><div class="modal-step"><span>↗</span><div><h3>Founders & small teams</h3><p>Find companies with a clear use for your software or service.</p></div></div><div class="modal-step"><span>✳</span><div><h3>Freelancers & agencies</h3><p>Look for businesses with a project, a launch, or a problem you can help with.</p></div></div><div class="modal-step"><span>⌂</span><div><h3>Independent businesses</h3><p>Explore potential buyers and partners who could need what you sell.</p></div></div></div><button class="modal-button wide" data-action="start">Find my next 3 customers <span>→</span></button>');}
  function domain(value){let candidate=value.trim();if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate))candidate='https://'+candidate;try{const u=new URL(candidate);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(u.hostname))return null;return u.origin;}catch{return null;}}
  const brandLogo=(s,className='')=>'<span class="brand-logo '+className+'" aria-hidden="true"><img src="'+escape(s.logo)+'" alt="" width="64" height="64"></span>';
  const sampleAvatar=s=>brandLogo(s);
  function detail(index=0){
    const s=samples[index]||samples[0];
    show(eyebrow('Sample prospect · Fictional business')+(s.photo?'<div class="detail-cover"><img class="detail-photo" src="'+s.photo+'" alt="Illustrative '+escape(s.type.toLowerCase())+' photograph">'+brandLogo(s,'detail-logo')+'</div>':brandLogo(s,'detail-standalone'))+'<h2 id="modal-title">'+s.name+'</h2><p class="modal-intro">'+s.type+'</p><div class="detail-contact"><strong>'+s.contact+' · '+s.role+'</strong><span>'+s.address+'</span><span>Illustrative contact for this demo.</span></div><p class="detail-label">Why contact them now?</p><p class="detail-reason">'+escape(s.whyNow)+'</p><p class="detail-label">What you could offer</p><p class="detail-reason">'+escape(s.sale)+'</p><button class="modal-button wide" style="margin-top:14px" data-action="demo" data-sample="'+index+'">Read their personalized email <span>→</span></button>');
  }
  function demo(index=0){
    sampleIndex=(index+samples.length)%samples.length;const s=samples[sampleIndex];
    show(eyebrow('Sample email · Fictional business')+'<h2 id="modal-title">An email with a reason.</h2><div class="sample-company"><div class="sample-avatar">'+sampleAvatar(s)+'</div><div><strong>'+s.name+'</strong><small>To '+s.contact+', '+s.role.toLowerCase()+'</small></div></div><div class="sample-reason"><strong>Why this email, now</strong>'+escape(s.whyNow)+'</div><div class="sample-email" lang="'+(activeScenario==='lawyer'?'pt-BR':'en')+'"><h3>Subject: '+s.subject+'</h3><p>'+escape(s.email).replace(/\n/g,'<br>')+'</p></div><div class="demo-controls"><span>Example '+(sampleIndex+1)+' of '+samples.length+'</span><div><button data-demo-prev aria-label="Previous example">←</button><button data-demo-next aria-label="Next example">→</button><button class="copy-email">Copy email</button></div></div><div class="modal-status" role="status"></div>');
    $('[data-demo-prev]',dialog).onclick=()=>demo(sampleIndex-1);$('[data-demo-next]',dialog).onclick=()=>demo(sampleIndex+1);
    $('.copy-email',dialog).onclick=async()=>{try{await navigator.clipboard.writeText('Subject: '+s.subject+'\n\n'+s.email);$('.modal-status',dialog).textContent='Example email copied.';}catch{$('.modal-status',dialog).textContent='Select the email text to copy it.';}};
  }
  document.addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;if(action==='start')focusBusiness();if(action==='how')how();if(action==='audience')audience();if(action==='demo')demo(Number(button.dataset.sample||0));if(action==='detail')detail(Number(button.dataset.sample||0));});
  $$('[data-lead-form]').forEach(form=>{
    const error=$('.form-error',form),toggle=$('#input-mode-toggle');
    const saved=store.get();let mode='website';
    const values={website:saved.website?saved.website.replace(/^https?:\/\//,''):'',description:saved.mode==='description'?saved.offering||'':''};
    const getInput=()=>$('[data-business-input]',form);
    function renderMode(focus=false){
      form.classList.toggle('mode-description',mode==='description');
      $('.input-slot',form).innerHTML=mode==='website'?'<input id="business-input" data-business-input type="text" name="website" inputmode="url" autocapitalize="none" autocomplete="url" placeholder="yourwebsite.com" required aria-label="Your website" aria-describedby="website-error">':'<textarea id="business-input" data-business-input name="business" rows="2" maxlength="1500" placeholder="e.g. I run a web design studio for independent hotels in Europe…" required aria-label="Describe your business" aria-describedby="website-error"></textarea>';
      getInput().value=values[mode];
      toggle.innerHTML=mode==='website'?'No website? <span>Describe your business <span aria-hidden="true">↗</span></span>':'Have a website? <span>Use its URL <span aria-hidden="true">↗</span></span>';
      toggle.setAttribute('aria-pressed',String(mode==='description'));
      error.textContent='';getInput().addEventListener('input',()=>{values[mode]=getInput().value;error.textContent='';getInput().removeAttribute('aria-invalid');});
      if(focus)getInput().focus();
    }
    toggle.addEventListener('click',()=>{values[mode]=getInput().value;mode=mode==='website'?'description':'website';renderMode(true);});
    form.addEventListener('submit',e=>{
      e.preventDefault();const input=getInput(),value=input.value.trim();
      if(mode==='website'){
        const website=domain(value);if(!website){error.textContent='Enter a website like yourbusiness.com';input.setAttribute('aria-invalid','true');input.focus();return;}
        error.textContent='';input.removeAttribute('aria-invalid');window.ClientFlockResearch.start({mode,website});
      }else{
        if(value.length<10){error.textContent='Add a little more detail about your business.';input.setAttribute('aria-invalid','true');input.focus();return;}
        error.textContent='';input.removeAttribute('aria-invalid');window.ClientFlockResearch.start({mode,offering:value});
      }
    });
    if(saved.mode==='description')mode='description';renderMode();
  });
  const plane='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-6.5 18-4-7.5L3 9.5 21 3ZM10.5 13.5 21 3"/></svg>';
  let animationTimer, swapTimer, dustFrame = 0, transitionToken = 0, switching = false;
  const scene = $('.scenario-scene'), list = $('#prospect-list');
  function renderCustomers(animate=false){
    const scenario=scenarios[activeScenario],list=$('#prospect-list');if(!list)return;
    samples=scenario.leads;
    $('#scenario-panel').setAttribute('aria-labelledby','tab-'+activeScenario);
    $$('[data-scenario]').forEach(tab=>{const selected=tab.dataset.scenario===activeScenario;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=tab.hasAttribute('data-scenario-clone')?-1:selected?0:-1;});
    list.innerHTML=samples.map((s,i)=>'<article class="lead-card"><div class="lead-head">'+brandLogo(s,'lead-logo')+'<div class="lead-info"><h4><button class="lead-details" data-action="detail" data-sample="'+i+'" aria-label="View '+escape(s.name)+'">'+escape(s.name)+'</button></h4><p class="lead-meta">'+escape(s.type)+'</p><p class="lead-contact">Contact: <strong>'+escape(s.contact)+'</strong> · '+escape(s.role)+'</p></div><button class="lead-email" data-action="demo" data-sample="'+i+'" aria-label="Read email for '+escape(s.name)+'">'+plane+'See email</button></div><dl class="lead-reasons"><div><dt>Why reach out now</dt><dd>'+escape(s.whyNow)+'</dd></div><div><dt><span class="offer-badge">What to offer <span aria-hidden="true">✦</span></span></dt><dd>'+escape(s.sale)+'</dd></div></dl><button class="lead-draft-peek" data-action="demo" data-sample="'+i+'" aria-label="Read email: '+escape(s.subject)+'"><span class="lead-draft-label">'+plane+' Draft</span><span class="lead-draft-subject">'+escape(s.subject)+'</span><span class="lead-draft-opening">'+escape(s.email.split('\n')[0])+'</span></button></article>').join('');
    if(animate){scene.classList.add('is-changing');clearTimeout(animationTimer);animationTimer=setTimeout(()=>{scene.classList.remove('is-changing');list.style.minHeight='';},800);}
  }
  // Small pieces start on the actual text and marks, then drift away with the old example.
  // This stays local to the preview: no screenshot library, network requests or layout-sized particle DOM.
  function scatterPreview(){
    scene.querySelector('.scenario-dust')?.remove();cancelAnimationFrame(dustFrame);
    if(!list || motion.matches)return;
    const bounds=list.getBoundingClientRect(), canvas=document.createElement('canvas');
    const width=Math.ceil(bounds.width), height=Math.ceil(bounds.height), scale=Math.min(devicePixelRatio||1,2);
    if(!width||!height)return;
    canvas.className='scenario-dust';canvas.setAttribute('aria-hidden','true');
    canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil((height+120)*scale);
    canvas.style.width=width+'px';canvas.style.height=(height+120)+'px';
    const context=canvas.getContext('2d');if(!context)return;
    const particles=[], characterStep=Math.max(2,Math.ceil(list.textContent.length/500));
    const walker=document.createTreeWalker(list,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())&&particles.length<640){
      if(!node.textContent.trim())continue;
      const style=getComputedStyle(node.parentElement), range=document.createRange();
      for(let offset=0;offset<node.length&&particles.length<640;offset+=characterStep){
        if(!node.textContent[offset].trim())continue;
        range.setStart(node,offset);range.setEnd(node,Math.min(offset+1,node.length));
        const r=range.getBoundingClientRect();
        if(r.width&&r.height)particles.push({x:r.left-bounds.left+Math.random()*r.width,y:r.top-bounds.top+Math.random()*r.height,color:style.color,size:.6+Math.random()*1.4,delay:(r.left-bounds.left)/width*.34,vx:45+Math.random()*105,vy:-18-Math.random()*70,spin:Math.random()*5});
      }
    }
    list.querySelectorAll('.brand-logo').forEach(mark=>{const r=mark.getBoundingClientRect();for(let i=0;i<14;i++)particles.push({x:r.left-bounds.left+Math.random()*r.width,y:r.top-bounds.top+Math.random()*r.height,color:'#777078',size:1+Math.random()*2,delay:(r.left-bounds.left)/width*.34,vx:50+Math.random()*130,vy:-20-Math.random()*80,spin:Math.random()*5});});
    canvas.style.left=list.offsetLeft+'px';canvas.style.top=(list.offsetTop-60)+'px';list.parentElement.append(canvas);
    context.scale(scale,scale);
    let start;
    function paint(now){
      if(!canvas.isConnected)return;
      start??=now;const time=(now-start)/1000;
      context.clearRect(0,0,width,height+120);
      for(const p of particles){const age=time-p.delay;if(age<0||age>1.05)continue;const progress=age/1.05;context.globalAlpha=Math.sin(Math.min(1,age*8)*Math.PI/2)*Math.pow(1-progress,1.7)*.7;context.fillStyle=p.color;context.fillRect(p.x+p.vx*age,p.y+60+p.vy*age+Math.sin(age*5+p.spin)*7,p.size,p.size);}
      context.globalAlpha=1;
      if(time<1.5&&!document.hidden&&!motion.matches)dustFrame=requestAnimationFrame(paint);else{canvas.remove();dustFrame=0;}
    }
    dustFrame=requestAnimationFrame(paint);
  }
  function changeScenario(key,animate=true){
    if(!scenarios[key]||key===activeScenario&&!switching)return;
    const token=++transitionToken;clearTimeout(swapTimer);clearTimeout(animationTimer);
    scene.classList.remove('is-changing','is-dissolving');
    list.inert=false;switching=false;
    if(!animate||motion.matches){activeScenario=key;renderCustomers();list.style.minHeight='';scene.querySelector('.scenario-dust')?.remove();return;}
    switching=true;list.style.minHeight=list.offsetHeight+'px';list.inert=true;
    scatterPreview();void list.offsetWidth;scene.classList.add('is-dissolving');
    swapTimer=setTimeout(()=>{
      if(token!==transitionToken)return;
      activeScenario=key;renderCustomers(true);scene.classList.remove('is-dissolving');list.inert=false;switching=false;revealActiveProfession();
    },470);
  }
  const roleOrder=['pool','saas','lawyer','photobooth','fintech','webdesign','recruiting','catering','video','cybersecurity','cleaning'].filter(key=>scenarios[key]);
  const tablist=$('.scenario-tabs');
  if(!tablist)return;
  const professionButton=(key,index,clone=false)=>'<button type="button" '+(clone?'aria-hidden="true" data-scenario-clone':'role="tab" id="tab-'+key+'" aria-controls="scenario-panel"')+' data-scenario="'+key+'" aria-selected="'+(index===0)+'" tabindex="'+(!clone&&index===0?'0':'-1')+'"><span class="profession-art"><img src="/assets/professions/'+key+'.webp" alt="" width="160" height="140" decoding="async"></span><span class="profession-label">'+escape(scenarios[key].label)+'</span></button>';
  tablist.innerHTML='<div class="profession-group" role="presentation">'+roleOrder.map((key,index)=>professionButton(key,index)).join('')+'</div><div class="profession-group profession-group-copy" role="presentation" aria-hidden="true">'+roleOrder.map((key,index)=>professionButton(key,index,true)).join('')+'</div>';
  const viewport=document.createElement('div');
  viewport.className='profession-marquee';
  tablist.before(viewport);viewport.append(tablist);
  const tabs=$$('[data-scenario]:not([data-scenario-clone])',tablist);
  const groups=$$('.profession-group',tablist);
  let position=0,lastWritten=0,lastTime=0,frame=0,visible=true,manualUntil=0,exampleTime=0,scrollTarget=null,exampleTimer=null,lastExampleTime=0;
  const exampleDuration=9000;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const canMove=()=>visible&&!document.hidden&&!motion.matches&&!viewport.matches(':hover')&&!viewport.contains(document.activeElement)&&!document.querySelector('dialog[open]')&&Date.now()>manualUntil;
  const canSwitch=()=>canMove()&&!switching&&!$('#scenario-panel').matches(':hover')&&!scene.contains(document.activeElement);
  function keepInView(tab){
    const bounds=viewport.getBoundingClientRect(),item=tab.getBoundingClientRect();
    if(item.left<bounds.left+14||item.right>bounds.right-14){
      viewport.scrollLeft+=item.left-bounds.left-(bounds.width-item.width)/2;
      position=viewport.scrollLeft;lastWritten=position;scrollTarget=null;
    }
  }
  function revealActiveProfession(){
    if(motion.matches)return;
    const bounds=viewport.getBoundingClientRect(),center=bounds.left+bounds.width/2;
    const candidates=$$('[data-scenario="'+activeScenario+'"]',tablist);
    const tab=candidates.sort((a,b)=>Math.abs(a.getBoundingClientRect().left+a.offsetWidth/2-center)-Math.abs(b.getBoundingClientRect().left+b.offsetWidth/2-center))[0];
    if(!tab)return;
    const item=tab.getBoundingClientRect();
    if(item.left<bounds.left+14||item.right>bounds.right-14){scrollTarget=viewport.scrollLeft+item.left-bounds.left-(bounds.width-item.width)/2;scrollTarget=Math.max(0,scrollTarget);}
  }
  function drift(now){
    const rawElapsed=lastTime?Math.max(0,now-lastTime):0;
    const elapsed=Math.min(rawElapsed,50);lastTime=now;
    if(canMove()){
      if(Math.abs(viewport.scrollLeft-lastWritten)>2)position=viewport.scrollLeft;
      const loop=groups[1].offsetLeft-groups[0].offsetLeft;
      if(loop>0){
        if(scrollTarget!==null){position+=(scrollTarget-position)*Math.min(elapsed/120,1);if(Math.abs(scrollTarget-position)<1){position=scrollTarget;scrollTarget=null;}}
        else position=(position+elapsed*.018)%loop;
        viewport.scrollLeft=position;lastWritten=viewport.scrollLeft;
      }
    }else{position=viewport.scrollLeft;lastWritten=position;}
    frame=requestAnimationFrame(drift);
  }
  function tickExample(){
    const now=Date.now(),viewingElapsed=Math.min(Math.max(0,now-lastExampleTime),1000);lastExampleTime=now;
    if(canSwitch()){
      exampleTime+=viewingElapsed;
      if(exampleTime>=exampleDuration){
        exampleTime=0;
        const next=roleOrder[(roleOrder.indexOf(activeScenario)+1)%roleOrder.length];
        changeScenario(next);
      }
    }
  }
  function resume(){if(!frame&&!document.hidden&&!motion.matches){lastTime=0;frame=requestAnimationFrame(drift);}if(!exampleTimer&&!document.hidden&&!motion.matches){lastExampleTime=Date.now();exampleTimer=setInterval(tickExample,250);}}
  function suspend(){cancelAnimationFrame(frame);frame=0;lastTime=0;clearInterval(exampleTimer);exampleTimer=null;lastExampleTime=0;}
  $$('[data-scenario]',tablist).forEach(tab=>{
    tab.addEventListener('click',()=>{
      exampleTime=0;manualUntil=Date.now()+12000;changeScenario(tab.dataset.scenario);
    });
    tab.addEventListener('focus',()=>keepInView(tab));
  });
  tabs.forEach((tab,index)=>tab.addEventListener('keydown',event=>{
    let next=index;
    if(event.key==='ArrowRight')next=(index+1)%tabs.length;
    else if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=tabs.length-1;
    else return;
    event.preventDefault();tabs[next].click();tabs[next].focus({preventScroll:true});keepInView(tabs[next]);
  }));
  viewport.addEventListener('touchstart',()=>{manualUntil=Date.now()+5000;scrollTarget=null;},{passive:true});
  viewport.addEventListener('wheel',()=>{manualUntil=Date.now()+3000;scrollTarget=null;},{passive:true});
  document.addEventListener('visibilitychange',()=>document.hidden?suspend():resume());
  if('IntersectionObserver' in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)resume();else suspend();},{threshold:.05}).observe(scene);
  motion.addEventListener('change',()=>{if(motion.matches){suspend();viewport.scrollLeft=0;cancelAnimationFrame(dustFrame);scene.querySelector('.scenario-dust')?.remove();scene.classList.remove('is-dissolving','is-changing');}else resume();});
  renderCustomers();if(!motion.matches)resume();
})();
