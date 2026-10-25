import {findCompanyContacts} from './company-contacts.mjs';
// Icypeas is optional. Only provider-returned professional identities and mailboxes are used.
const API = 'https://app.icypeas.com/api/';
const FINAL = new Set(['skipped', 'not_found', 'risky', 'found', 'error']);
const WAITING = new Set(['NONE', 'SCHEDULED', 'IN_PROGRESS']);
const COOLDOWN = 3000;
const AUTH_COOLDOWN = 30000;
const AUTH_MESSAGE = 'Icypeas authentication was rejected. Use the API Key, not the API Secret, in the Cloudflare runtime secret ICYPEAS_API_KEY, deploy it, then retry.';
const LEGACY_AUTH_MESSAGE = 'Icypeas authentication was rejected. Check the server API key.';
const PEOPLE_MESSAGE = 'Icypeas returned an unsupported people response. No email search was started.';
const PEOPLE_PARSER_VERSION = 3;
const DISCOVERY_STRATEGY_VERSION = 3;
const NO_MATCH_MESSAGE = 'No matching current decision maker was found.';
const UNSAFE_MATCH_MESSAGE = 'No current decision maker could be safely matched to this company’s domain and public profile.';
const RESUME_PHASE = {discover:'discover',create:'person_ready',verify:'email_ready',poll:'poll'};
const retryableAuth = entry => entry?.status === 'error' && !!RESUME_PHASE[entry.lastOperation] && (entry.errorCode === 'auth_configuration' || entry.message === LEGACY_AUTH_MESSAGE);
const hasDiscovery = entry => !!entry && Object.hasOwn(entry,'discoveryPayload');
const retryablePeople = entry => entry?.status === 'error' && entry.lastOperation === 'discover' && !entry.providerId && entry.phase !== 'requesting' && (entry.errorCode === 'people_response' || entry.message === PEOPLE_MESSAGE);
const retryableNoMatch = entry => !!entry && !entry.providerId && !entry.noMatchRecoveryCount && ((entry.discoveryStrategyVersion || 0) < DISCOVERY_STRATEGY_VERSION || entry.broaderDiscoveryConsentRequired === true) && (entry.status === 'not_found' && entry.message === NO_MATCH_MESSAGE || entry.status === 'error' && entry.message === UNSAFE_MATCH_MESSAGE);
const retryableBudget = entry => entry?.status === 'error' && entry.errorCode === 'daily_limit' && ['discover','email_ready'].includes(entry.phase);
const canRetry = (entry,body) => body.retry === true && (retryableAuth(entry) || (retryableBudget(entry) && Date.now() >= (entry.budgetRetryAt || 0)) || (retryableNoMatch(entry) && body.allowNewLookup === true) || (retryablePeople(entry) && (hasDiscovery(entry) || (body.allowNewLookup === true && !entry.peopleRecoveryCount))));
const response = (contact, status = 200, retryAfterMs) => Response.json({contact, ...(retryAfterMs ? {retryAfterMs} : {})}, {
 status, headers: {'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...(retryAfterMs ? {'Retry-After':String(Math.ceil(retryAfterMs / 1000))} : {})}
});
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function domain(value) {
 try { const u = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
  if (!['https:','http:'].includes(u.protocol) || u.username || u.password || u.port || !/^([a-z0-9-]+\.)+[a-z]{2,63}$/i.test(u.hostname)) return null;
  return u.hostname.toLowerCase().replace(/^www\./, '');
 } catch { return null; }
}
const sameDomain = (a,b) => a === b || a?.endsWith('.' + b);
export function publicContact(entry) {
 const result=Object.fromEntries(['status','person','email','certainty','message','retryable','errorCode','contactKind','sourceUrl'].filter(k => entry?.[k] !== undefined).map(k => [k, entry[k]]));
 if(result.person&&typeof result.person==='object')result.person=Object.fromEntries(['firstName','lastName','fullName','title','profileUrl','sourceUrl'].filter(k=>typeof result.person[k]==='string').map(k=>[k,result.person[k]]));
 if(retryableBudget(entry))Object.assign(result,{retryable:true,requiresNewLookup:true});
 if(retryableNoMatch(entry))Object.assign(result,{errorCode:'people_no_match',retryable:true,requiresNewLookup:true,message:'Icypeas connected, but the earlier narrow search found no matching person. Search more broadly and check the company’s own contact pages. This may use credits.'});
 // Project the exact legacy 401/403 error into the new retry contract as well.
 if(retryableAuth(entry))Object.assign(result,{errorCode:'auth_configuration',retryable:true,message:AUTH_MESSAGE});
 if(retryablePeople(entry))Object.assign(result,{errorCode:'people_response',retryable:hasDiscovery(entry)||!entry.peopleRecoveryCount,requiresNewLookup:!hasDiscovery(entry),message:hasDiscovery(entry)
  ? 'Icypeas returned a people response that could not be read. The saved response can be retried without another Icypeas lookup.'
  : 'The earlier Icypeas people response could not be read and was not saved. Retrying runs a new Icypeas lookup and may use credits. No email search was started.'});
 return result;
}
function publicProfile(value) {
 try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/in\/[\w%-]+\/?$/i.test(u.pathname) ? u.href : null; }
 catch { return null; }
}
const normalizedText = value => clean(value,200).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const ownerTitles=['Owner','Business Owner','Founder','Co-Founder','CEO','Chief Executive Officer','Proprietor','President','Managing Director','Fondateur','Fondatrice','Gérant','Gérante','Dirigeant','Président','Fundador','Fundadora','Proprietário','Sócio','Gerente','Geschäftsführer','Inhaber'];
const operationsTitles=['General Manager','Operations Manager','Head of Operations','Operations Director','Directeur des opérations','Responsable des opérations','Directeur général','Gerente de operações','Gerente geral'];
const marketingTitles=['Head of Marketing','Head of Growth','Marketing Director','Marketing Manager','Sales Director','Head of Sales','Commercial Director','Ecommerce Manager','E-commerce Manager','Responsable marketing','Directeur commercial','Gerente de marketing'];
const technologyTitles=['CTO','Chief Technology Officer','Chief Technical Officer','Head of Engineering','Technical Director','Directeur technique','Responsable informatique'];
const ownership = title => /\b(owner|founder|cofounder|ceo|chief executive|proprietor|president|managing director|fondateur|fondatrice|gerant|gerante|dirigeant|fundador|fundadora|proprietario|proprietaria|socio|socia|geschäftsführer|geschaftsfuhrer|inhaber)\b/.test(normalizedText(title));
const department = title => {
 const text=normalizedText(title);
 if(/operat|operations|operacoes|workshop|atelier|general manager|directeur general|gerente geral/.test(text))return 'operations';
 if(/market|growth|commercial|sales|e.?commerce|ventes|vendas/.test(text))return 'marketing';
 if(/tech|develop|engineer|cto|informatique|engenharia/.test(text))return 'technology';
 return '';
};
const titlesFor = role => {
 const group=department(role),specific=group==='operations'?operationsTitles:group==='marketing'?marketingTitles:group==='technology'?technologyTitles:[];
 return [...new Set([...specific,...ownerTitles,...(!specific.length?operationsTitles:[])])];
};
function roleScore(title,desiredRole='') {
 const text=normalizedText(title);
 // A personal/assistant title containing the CEO's title is not the CEO.
 if(/\b(assistant|assistante|assistant(e)? to|intern|stagiaire|student|estagiario|estagiaria|former|ex)\b/.test(text))return 0;
 const owns=ownership(title),desired=department(desiredRole),actual=department(title);
 const senior=/\b(head|director|directeur|directrice|manager|responsable|gerente|leiter|chief|lead|cto|cmo|coo)\b/.test(text);
 if(desired&&actual===desired&&senior)return 100+(owns?10:0);
 if(owns)return ownership(desiredRole)||!desired?100:70;
 if(!desired&&actual==='operations'&&senior)return 65;
 return 0;
}
function peopleList(payload) {
 const list=[payload?.leads,payload?.people,payload?.items,payload?.results,payload?.data?.leads,payload?.data?.people,payload?.data?.items,payload?.data?.results].find(Array.isArray);
 if(!list)throw Object.assign(Error(PEOPLE_MESSAGE),{code:'people_response'});
 return list;
}
export function selectPerson(payload,companyDomain,desiredRole='',options={}) {
 // Official /find-people fields describe the current-company-filtered job. Keep
 // full names, same-company domain and a public professional profile as evidence.
 const list=peopleList(payload),candidates=[];
 for(const item of list.slice(0,20)) {
  if(!item||typeof item!=='object')continue;
  const firstName=clean(item.firstname||item.firstName||item.first_name,80),lastName=clean(item.lastname||item.lastName||item.last_name,80);
  const title=clean(item.lastJobTitle||item.currentJobTitle||item.jobTitle||item.title);
  const company=domain(item.lastCompanyWebsite||item.currentCompanyWebsite||item.companyWebsite||item.currentCompany?.website||'');
  const profileUrl=publicProfile(item.linkedinUrl||item.linkedin_url||item.profileUrl||item.linkedin||'');
  if(!firstName||!lastName||!title||!company||company!==companyDomain||!profileUrl||item.isCurrent===false||item.current===false)continue;
  if(![firstName,lastName].every(x=>/^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]{0,79}$/u.test(x)))continue;
  const score=roleScore(title,desiredRole);
  if(score)candidates.push({firstName,lastName,fullName:firstName+' '+lastName,title,profileUrl,score});
 }
 if(!candidates.length&&list.length&&options.strict!==false)throw Error(UNSAFE_MATCH_MESSAGE);
 return candidates.sort((a,b)=>b.score-a.score)[0]||null;
}

// Retain a bounded server-only response until the search expires (the normal search TTL).
// It is saved before parsing so parser changes never need to repeat a paid discovery call.
function discoverySnapshot(payload) {
 let remaining=48000,nodes=1600;
 const copy=(value,depth=0)=>{
  if(--nodes<0||depth>5||remaining<=0)return null;
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string'){const result=value.slice(0,Math.min(1500,remaining));remaining-=result.length;return result;}
  if(Array.isArray(value))return value.slice(0,20).map(item=>copy(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,40).filter(([key])=>!/(?:authorization|secret|password|token|api[_-]?key)/i.test(key)).map(([key,item])=>[key.slice(0,80),copy(item,depth+1)]));
  return null;
 };
 return copy(payload);
}
function completeNoMatch(entry) {
 Object.assign(entry,{status:'not_found',phase:'done',retryable:false,errorCode:'people_no_match',message:'Icypeas is connected. We checked matching roles, a broader company search and the company’s website, but could not verify a suitable contact. Use the company contact page below.'});
}
function nextDiscoveryFallback(entry) {
 if(!entry.websiteChecked)Object.assign(entry,{status:'working',phase:'website',message:'Checking the company’s own contact and team pages.'});
 else if(entry.discoveryMode!=='broad') {
  if(entry.allowBroaderDiscovery===false)Object.assign(entry,{status:'not_found',phase:'done',broaderDiscoveryConsentRequired:true,message:NO_MATCH_MESSAGE});
  else Object.assign(entry,{status:'working',phase:'discover',discoveryMode:'broad',discoveryBudgetReady:false,message:'Broadening the search to the company’s current team, including local job titles.'});
 }
 else completeNoMatch(entry);
}
function noWebsiteContact(entry) {
 if(entry.namedLookupFinished)Object.assign(entry,{status:'not_found',phase:'done',message:'We found a relevant person, but neither a verified personal email nor a published company inbox. Use the company’s contact page below.'});
 else nextDiscoveryFallback(entry);
}
function applyDiscovery(entry,companyDomain,desiredRole) {
 const person=selectPerson(entry.discoveryPayload,companyDomain,desiredRole,{strict:false});
 entry.discoveryParserVersion=PEOPLE_PARSER_VERSION;
 entry.discoveryStrategyVersion=DISCOVERY_STRATEGY_VERSION;
 delete entry.errorCode;delete entry.retryable;
 if(!person)nextDiscoveryFallback(entry);
 else {const {score,...identity}=person;Object.assign(entry,{status:'working',person:identity,phase:'person_ready',contactKind:'person',message:'A relevant current decision maker was found. Preparing their professional email lookup.'});}
}
function validPublishedMailbox(mailbox,companyDomain) {
 return mailbox&&mailbox.published===true&&domain(mailbox.sourceUrl)===companyDomain&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox.email||'')&&sameDomain(domain(mailbox.email.split('@')[1]),companyDomain);
}
function preparePublishedMailbox(entry,mailbox) {
 // A published inbox proves ownership, not deliverability. Only a completed
 // verification may expose this mailbox to the user as an email result.
 if(entry.person)entry.previousPerson=entry.person;
 delete entry.person;
 Object.assign(entry,{status:'working',phase:'email_ready',pendingEmail:mailbox.email,sourceUrl:mailbox.sourceUrl,contactKind:'company_mailbox',message:'Found a company inbox on their website. Icypeas will now verify it.'});
}
async function applyWebsite(entry,lead,companyDomain,loadContacts) {
 const found=await loadContacts(lead.website,{contactUrl:lead.contactUrl,desiredRole:lead.roleToContact});
 entry.websiteChecked=true;entry.websiteCheckedAt=found.checkedAt;
 const mailbox=validPublishedMailbox(found.email,companyDomain)?found.email:null;
 if(mailbox)entry.websiteMailbox={email:mailbox.email,sourceUrl:mailbox.sourceUrl,published:true};
 const person=found.person;
 if(person&&!entry.namedLookupFinished&&domain(person.sourceUrl)===companyDomain) {
  const match=selectPerson({leads:[{...person,lastCompanyWebsite:companyDomain}]},companyDomain,lead.roleToContact,{strict:false});
  if(match){const {score,...identity}=match;Object.assign(entry,{status:'working',phase:'person_ready',person:{...identity,sourceUrl:person.sourceUrl},contactKind:'person',sourceUrl:person.sourceUrl,message:'A relevant person is named on the company’s own website. Finding their professional email.'});return;}
 }
 if(mailbox){preparePublishedMailbox(entry,mailbox);return;}
 noWebsiteContact(entry);
}

export function parseEmailResult(payload, providerId, companyDomain, expectedEmail) {
 const items = Array.isArray(payload?.items) ? payload.items : payload?.item && typeof payload.item === 'object' ? [payload.item] : [];
 const item = items.find(x => x?._id === providerId);
 if (!item) throw Error('Icypeas returned an unsupported search result. No email address was assumed.');
 const status = String(item.status || '').toUpperCase();
 if (WAITING.has(status)) return {status:'working',message:'Icypeas is checking this professional email.'};
 if (['NOT_FOUND','DEBITED_NOT_FOUND'].includes(status)) return {status:'not_found',message:'No professional email was found for this person.'};
 if (!['FOUND','DEBITED'].includes(status)) throw Error('Icypeas did not return a usable completed email search.');
 const emails = Array.isArray(item.results?.emails) ? item.results.emails : Array.isArray(item.emails) ? item.emails : null;
 if (!emails) throw Error('Icypeas returned an unsupported email result. No email address was assumed.');
 const candidates = emails.filter(x => x && typeof x === 'object').map(x => ({email:clean(x.email,254),certainty:clean(x.certainty,40).toLowerCase()}));
 const safe = candidates.filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email) && sameDomain(domain(x.email.split('@')[1]),companyDomain) && (!expectedEmail || x.email.toLowerCase()===expectedEmail.toLowerCase()));
 const found = safe.find(x => ['ultra_sure','very_sure'].includes(x.certainty));
 if (found) return {...found,status:'found',message:'Icypeas returned this professional email with high confidence.'};
 const risky = safe.find(x => x.certainty === 'probable');
 if (risky) return {...risky,status:'risky',message:'Icypeas considers this address probable. It is not a high-confidence result.'};
 if (candidates.some(x => ['not_found','undeliverable'].includes(x.certainty)) || !candidates.length) return {status:'not_found',message:'No usable professional email was found.'};
 throw Error('Icypeas returned an unrecognized certainty or a mailbox outside the company domain.');
}
async function digest(value) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function takeBudget(db,key,max) {
 return !!await db.prepare('INSERT INTO budgets(key,count) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count').bind(key,max).first();
}
const limit = (value, fallback, max) => Number.isFinite(Number(value)) && Number(value)>0 ? Math.min(max,Math.floor(Number(value))) : fallback;
async function dailyLookupBudget(request,env) {
 const day=new Date().toISOString().slice(0,10);
 const identity=await digest(request.headers.get('cf-connecting-ip')||request.headers.get('oai-authenticated-user-id')||'local');
 return await takeBudget(env.DB,'icypeas:user:'+day+':'+identity,limit(env.ICYPEAS_USER_DAILY_LIMIT,9,30)) &&
  await takeBudget(env.DB,'icypeas:daily:'+day,limit(env.ICYPEAS_DAILY_CONTACT_LIMIT,30,100));
}
async function provider(key,path,body) {
 const res = await fetch(API+path,{method:'POST',headers:{Authorization:key.trim(),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if (res.status === 401 || res.status === 403) throw Object.assign(Error(AUTH_MESSAGE),{code:'auth_configuration'});
 if (!res.ok) throw Error('Icypeas could not complete this request. No automatic resubmission will be made.');
 const payload = await res.json();
 if (payload?.success === false) throw Error('Icypeas rejected the request. No automatic resubmission will be made.');
 return payload;
}
async function save(env,row,lease,data,release=true) {
 const statement = release ? 'UPDATE searches SET data=?,updated_at=?,lease=NULL,lease_until=0 WHERE id=? AND lease=? RETURNING id' : 'UPDATE searches SET data=?,updated_at=? WHERE id=? AND lease=? RETURNING id';
 return !!await env.DB.prepare(statement).bind(JSON.stringify(data),Date.now(),row.id,lease).first();
}

export async function handleContacts(request,env,row,options={}) {
 if (request.method !== 'POST') return response({status:'error',message:'Use POST to request a contact.'},405);
 let body;
 try {const raw=await request.text();if(raw.length>200)throw Error();body=JSON.parse(raw);}catch{return response({status:'error',message:'Provide a valid lead index.'},400);}
 const index=body?.leadIndex;
 if (!Number.isInteger(index)||index<0||index>2) return response({status:'error',message:'Choose one of this search’s first three prospects.'},400);
 if (!env.DB) return response({status:'error',message:'Contact storage is unavailable.'},503);
 if (row.status!=='complete') return response({status:'skipped',message:'Finish the company research before looking up contacts.'},409);
 let data;
 try {data=JSON.parse(row.data);}catch{return response({status:'error',message:'This search could not be read.'},500);}
 const cached=data.contacts?.[index];
 if (FINAL.has(cached?.status) && !canRetry(cached,body)) return response(publicContact(cached),200,retryableAuth(cached)?Math.max(0,(cached.authRetryAt||0)-Date.now()):retryableBudget(cached)?Math.max(0,(cached.budgetRetryAt||0)-Date.now()):undefined);
 const apiKey=typeof env.ICYPEAS_API_KEY === 'string' ? env.ICYPEAS_API_KEY.trim() : '';
 if (!apiKey) return response({status:'skipped',message:'Professional email discovery is not connected yet. Add the Icypeas API Key as the runtime secret ICYPEAS_API_KEY.'},503);
 const now=Date.now(),lease=crypto.randomUUID();
 const claimed=await env.DB.prepare("UPDATE searches SET lease=?,lease_until=? WHERE id=? AND lease_until<? AND status='complete' RETURNING id").bind(lease,now+90000,row.id,now).first();
 if (!claimed) return response({status:'working',message:'Another contact lookup is in progress for this search.'},202,COOLDOWN);
 let entry,operation=null;
 try {
  row=await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(row.id).first();
  data=JSON.parse(row.data);
  if (!data.contacts || typeof data.contacts!=='object') data.contacts={};
  if (!data.contactLookup || typeof data.contactLookup!=='object') data.contactLookup={};
  entry=data.contacts[index];
  if (FINAL.has(entry?.status)) {
   if(!canRetry(entry,body)) {await save(env,row,lease,data);return response(publicContact(entry));}
   if(retryableAuth(entry)) {
    const currentKeyHash=await digest(apiKey);
    const authWait=entry.authKeyHash === currentKeyHash ? Math.max(0,(entry.authRetryAt||0)-Date.now()) : 0;
    if(authWait) {await save(env,row,lease,data);return response(publicContact(entry),429,authWait);}
    // Only a definite 401/403 may resume a previous operation. Unknown paid outcomes never enter this branch.
    entry.phase=RESUME_PHASE[entry.lastOperation];
    entry.message='Retrying Icypeas with the current API Key.';
   } else if(retryableBudget(entry)) {
    entry.message='Resuming the saved broader contact search.';delete entry.budgetRetryAt;
   } else if(retryableNoMatch(entry)) {
    entry.noMatchRecoveryCount=1;entry.allowBroaderDiscovery=true;delete entry.broaderDiscoveryConsentRequired;entry.discoveryStrategyVersion=DISCOVERY_STRATEGY_VERSION;entry.discoveryMode='targeted';
    entry.phase=hasDiscovery(entry)?'parse_people':'website';entry.message='Checking more routes to a genuine company contact.';
   } else if(hasDiscovery(entry)) {
    entry.allowBroaderDiscovery=body.allowNewLookup===true;
    entry.phase='parse_people';entry.message='Reading the saved Icypeas people response.';
   } else {
    // Old parser failures discarded the response. One explicitly acknowledged new discovery is allowed.
    if(!await dailyLookupBudget(request,env)) {await save(env,row,lease,data);return response({...publicContact(entry),message:'The daily contact lookup limit has been reached. Try again tomorrow.'},429);}
    entry.peopleRecoveryCount=(entry.peopleRecoveryCount||0)+1;entry.discoveryBudgetReady=true;
    entry.phase='discover';entry.message='Running the new Icypeas lookup you requested.';
   }
   entry.status='working';
   delete entry.retryable;delete entry.errorCode;delete entry.authRetryAt;delete entry.authKeyHash;
  }
  const lead=data.leads?.[index];
  const companyDomain=domain(lead?.website || '');
  if (!lead||!companyDomain) {
   entry=data.contacts[index]={status:'skipped',message:'This prospect has no usable public company domain.'};
   await save(env,row,lease,data);return response(publicContact(entry));
  }
  if (entry?.phase==='requesting') {
   entry.status='error';entry.retryable=false;delete entry.errorCode;
   entry.message='The previous provider request has an unknown outcome. It will not be resubmitted automatically, to avoid duplicate charges.';
   await save(env,row,lease,data);return response(publicContact(entry));
  }
  if(entry?.phase==='parse_people' && hasDiscovery(entry)) {
   operation='discover';entry.lastOperation='discover';
   applyDiscovery(entry,companyDomain,lead.roleToContact);
   if(!await save(env,row,lease,data))return response({status:'error',message:'The saved provider response could not be updated. No new lookup was submitted.'},500);
   return response(publicContact(entry),entry.status==='working'?202:200,entry.status==='working'?COOLDOWN:undefined);
  }
  if(entry?.phase==='website') {
   // First-party HTTP reads do not trigger provider charges; a saved marker avoids
   // an endless crawl loop if the worker stops during a request.
   entry.websiteChecked=true;entry.phase='website_in_progress';
   if(!await save(env,row,lease,data,false))return response({status:'working',message:'This website check is already being handled.'},202,COOLDOWN);
   try{await applyWebsite(entry,lead,companyDomain,options.findCompanyContacts||findCompanyContacts);}catch{noWebsiteContact(entry);}
   if(!await save(env,row,lease,data))return response({status:'error',message:'The company website check could not be saved.'},500);
   return response(publicContact(entry),entry.status==='working'?202:200,entry.status==='working'?COOLDOWN:undefined);
  }
  if(entry?.phase==='website_in_progress') {
   noWebsiteContact(entry);
   if(FINAL.has(entry.status)){await save(env,row,lease,data);return response(publicContact(entry));}
  }
  const wait=Math.max(0,(data.contactLookup.nextAt||0)-Date.now());
  if (wait) {await save(env,row,lease,data);return response(entry?publicContact(entry):{status:'working',message:'Please wait briefly before the next contact lookup.'},202,wait);}
  if (!entry) {
   const count=Object.values(data.contacts).filter(x=>x?.startedAt).length;
   if(count>=3){await save(env,row,lease,data);return response({status:'skipped',message:'This search has reached its three-contact lookup limit.'},429);}
   if (!await dailyLookupBudget(request,env)) {
    await save(env,row,lease,data);return response({status:'skipped',message:'The daily contact lookup limit has been reached. Try again tomorrow.'},429);
   }
   entry=data.contacts[index]={status:'working',phase:'discover',domain:companyDomain,startedAt:Date.now(),discoveryMode:'targeted',discoveryStrategyVersion:DISCOVERY_STRATEGY_VERSION,discoveryBudgetReady:true,message:'Looking for a relevant current decision maker.'};
  }
  operation=entry.phase==='discover'?'discover':entry.phase==='person_ready'?'create':entry.phase==='email_ready'?'verify':entry.phase==='poll'?'poll':null;
  if (!operation) throw Error('This contact lookup has an unsupported saved state.');
  if(operation==='poll' && (entry.polls||0)>=30) throw Error('Icypeas did not finish within the polling limit. The saved provider search will not be submitted again.');
  const minute=Math.floor(Date.now()/60000);
  const budgetKey='icypeas:'+(operation==='poll'?'reads:':'writes:')+minute;
  if (!await takeBudget(env.DB,budgetKey,20)) {
   data.contactLookup.nextAt=(minute+1)*60000;
   await save(env,row,lease,data);return response(publicContact(entry),202,Math.max(3000,data.contactLookup.nextAt-Date.now()));
  }
  // One account-wide read slot per three seconds also protects rolling-minute limits.
  if(operation==='poll' && !await takeBudget(env.DB,'icypeas:readslot:'+Math.floor(Date.now()/COOLDOWN),1)) {
   data.contactLookup.nextAt=Date.now()+COOLDOWN;
   await save(env,row,lease,data);return response(publicContact(entry),202,COOLDOWN);
  }
  if((operation==='discover' && entry.discoveryBudgetReady!==true && entry.discoveryMode==='broad') || (operation==='verify' && entry.verificationBudgetReady!==true)) {
   if(!await dailyLookupBudget(request,env)) {Object.assign(entry,{status:'error',errorCode:'daily_limit',retryable:true,budgetRetryAt:new Date(new Date().toISOString().slice(0,10)).getTime()+86400000,message:'The daily contact lookup limit has been reached. Resume this saved search tomorrow.'});await save(env,row,lease,data);return response(publicContact(entry),429,entry.budgetRetryAt-Date.now());}
   if(operation==='verify')entry.verificationBudgetReady=true;else entry.discoveryBudgetReady=true;
  }
  data.contactLookup.nextAt=Date.now()+COOLDOWN;
  entry.lastOperation=operation;
  if(operation!=='poll')entry.phase='requesting';
  if(operation==='poll')entry.polls=(entry.polls||0)+1;
  // A crash after this durable marker cannot cause another paid create request.
  if(!await save(env,row,lease,data,false))return response({status:'working',message:'This lookup is already being handled.'},202,COOLDOWN);
  if(operation==='discover') {
   const query={currentCompanyWebsite:{include:[companyDomain]},...(entry.discoveryMode==='broad'?{}:{currentJobTitle:{include:titlesFor(lead.roleToContact)}})};
   const payload=await provider(apiKey,'find-people',{query,pagination:{size:entry.discoveryMode==='broad'?20:10}});
   entry.discoveryPayload=discoverySnapshot(payload);entry.discoveryCapturedAt=Date.now();entry.phase='parse_people';
   if(!await save(env,row,lease,data,false))return response({status:'error',message:'The provider response could not be saved. No new lookup will be submitted automatically.'},500);
   applyDiscovery(entry,companyDomain,lead.roleToContact);
  } else if(operation==='create'||operation==='verify') {
   const externalId='clientflock:'+row.id+':'+index;
   const payload=operation==='verify'
    ? await provider(apiKey,'email-verification',{email:entry.pendingEmail,custom:{externalId:externalId+':published'}})
    : await provider(apiKey,'email-search',{firstname:entry.person.firstName,lastname:entry.person.lastName,domainOrCompany:companyDomain,custom:{externalId}});
   const id=clean(payload?.item?._id,200);
   if(!id)throw Error('Icypeas did not return a search identifier. The request will not be repeated automatically.');
   Object.assign(entry,{providerId:id,providerTask:operation==='verify'?'email-verification':'email-search',phase:'poll',message:operation==='verify'?'Icypeas is checking whether the published company inbox is deliverable.':'Icypeas is finding and checking the professional email.'});
  } else {
   const payload=await provider(apiKey,'bulk-single-searchs/read',{id:entry.providerId});
   Object.assign(entry,parseEmailResult(payload,entry.providerId,companyDomain,entry.providerTask==='email-verification'?entry.pendingEmail:undefined));
   if(FINAL.has(entry.status)) {
    entry.phase='done';
    if(entry.contactKind==='company_mailbox') {
     entry.publishedLookupFinished=true;
     entry.message=entry.status==='found'?'Icypeas verified the company inbox published on its website. This is a company inbox, not a named person’s address.':entry.status==='risky'?'The company publishes this inbox, but Icypeas could not confirm high deliverability. Review before using.':'The company’s published inbox could not be verified. Use their contact page instead.';
     if(entry.status==='not_found'&&!entry.namedLookupFinished&&entry.discoveryMode!=='broad'){
      entry.previousVerificationId=entry.providerId;delete entry.providerId;delete entry.providerTask;delete entry.contactKind;delete entry.sourceUrl;entry.polls=0;nextDiscoveryFallback(entry);
     }
    }
    else if(entry.status==='not_found'&&!entry.namedLookupFinished) {
     // A definite NOT_FOUND permits a different, source-backed route. Never
     // rerun the completed personal search or retry an ambiguous paid request.
     entry.namedLookupFinished=true;entry.previousProviderId=entry.providerId;
     if(!entry.publishedLookupFinished&&validPublishedMailbox(entry.websiteMailbox,companyDomain)){delete entry.providerId;delete entry.providerTask;entry.polls=0;preparePublishedMailbox(entry,entry.websiteMailbox);}
     else if(!entry.websiteChecked){delete entry.providerId;delete entry.providerTask;entry.polls=0;Object.assign(entry,{status:'working',phase:'website',message:'The personal email was not found. Checking the company’s published contact details.'});}
    }
   }
  }
  data.contactLookup.nextAt=Date.now()+COOLDOWN;
  if(!await save(env,row,lease,data))return response({status:'error',message:'The provider result could not be saved. No new lookup will be submitted automatically.'},500);
  return response(publicContact(entry),entry.status==='working'?202:200,entry.status==='working'?COOLDOWN:undefined);
 } catch(error) {
  if(!entry)entry=data.contacts[index]={};
  entry.status='error';
  if(error?.code==='auth_configuration' && RESUME_PHASE[operation]) {
   Object.assign(entry,{errorCode:'auth_configuration',retryable:true,message:AUTH_MESSAGE,phase:RESUME_PHASE[operation],authRetryAt:Date.now()+AUTH_COOLDOWN,authKeyHash:await digest(apiKey)});
   // A rejected poll did not consume a provider polling attempt.
   if(operation==='poll')entry.polls=Math.max(0,(entry.polls||1)-1);
   await save(env,row,lease,data).catch(()=>{});
   return response(publicContact(entry),502,AUTH_COOLDOWN);
  }
  if(error?.code==='people_response' && operation==='discover' && hasDiscovery(entry)) {
   Object.assign(entry,{errorCode:'people_response',retryable:true,message:PEOPLE_MESSAGE,phase:'parse_people'});
   await save(env,row,lease,data).catch(()=>{});
   return response(publicContact(entry),502);
  }
  entry.retryable=false;
  delete entry.errorCode;
  entry.message=error?.name==='AbortError'||error?.name==='TimeoutError'||error instanceof TypeError
   ? 'The provider request has an unknown outcome. It will not be repeated automatically, to avoid duplicate charges.'
   : clean(error?.message,300)||'Contact lookup is unavailable. No email address was assumed.';
  entry.phase='done';
  await save(env,row,lease,data).catch(()=>{});
  return response(publicContact(entry),502);
 }
}
