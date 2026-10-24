// Icypeas is optional. Only provider-returned professional identities and mailboxes are used.
const API = 'https://app.icypeas.com/api/';
const FINAL = new Set(['skipped', 'not_found', 'risky', 'found', 'error']);
const WAITING = new Set(['NONE', 'SCHEDULED', 'IN_PROGRESS']);
const COOLDOWN = 3000;
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
const publicContact = entry => Object.fromEntries(['status','person','email','certainty','message'].filter(k => entry?.[k] !== undefined).map(k => [k, entry[k]]));
function publicProfile(value) {
 try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/in\/[\w%-]+\/?$/i.test(u.pathname) ? u.href : null; }
 catch { return null; }
}
const titlesFor = role => {
 const text = clean(role, 160).toLowerCase();
 if (/market|growth|commercial|sales/.test(text)) return ['Head of Marketing','Head of Growth','Marketing Director'];
 if (/operat|directeur|manager/.test(text)) return ['Head of Operations','Operations Director','Founder'];
 if (/tech|develop|engineer|cto/.test(text)) return ['CTO','Head of Engineering','Founder'];
 return ['Founder','CEO','Head of Operations'];
};

export function selectPerson(payload, companyDomain, desiredRole = '') {
 // Accept explicit person lists, never arbitrary nested data or scalar values.
 const list = [payload?.people, payload?.items, payload?.results, payload?.data?.people, payload?.data?.items, payload?.data?.results].find(Array.isArray);
 if (!list) throw Error('Icypeas returned an unsupported people response. No email search was started.');
 const desired = titlesFor(desiredRole).map(x => x.toLowerCase().split(/\W+/).filter(x => x.length > 2 && !['head','director','chief','officer','the'].includes(x)));
 const candidates = [];
 for (const item of list.slice(0, 3)) {
  if (!item || typeof item !== 'object') continue;
  const firstName = clean(item.firstname || item.firstName || item.first_name, 80);
  const lastName = clean(item.lastname || item.lastName || item.last_name, 80);
  const title = clean(item.currentJobTitle || item.jobTitle || item.title);
  const company = domain(item.currentCompanyWebsite || item.companyWebsite || item.currentCompany?.website || '');
  const profileUrl = publicProfile(item.linkedinUrl || item.linkedin_url || item.profileUrl || item.linkedin || '');
  if (!firstName || !lastName || !title || !company || company !== companyDomain || !profileUrl || item.isCurrent === false || item.current === false) continue;
  if (![firstName,lastName].every(x => /^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]{0,79}$/u.test(x))) continue;
  const normalized = title.toLowerCase();
  const score = Math.max(...desired.map(words => words.filter(word => normalized.includes(word)).length));
  if (!score) continue;
  candidates.push({firstName,lastName,fullName:firstName+' '+lastName,title,profileUrl,score});
 }
 if (!candidates.length && list.length) throw Error('No current decision maker could be safely matched to this company’s domain and public profile.');
 return candidates.sort((a,b) => b.score-a.score)[0] || null;
}

export function parseEmailResult(payload, providerId, companyDomain) {
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
 const safe = candidates.filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email) && sameDomain(domain(x.email.split('@')[1]),companyDomain));
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
async function provider(key,path,body) {
 const res = await fetch(API+path,{method:'POST',headers:{Authorization:key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if (!res.ok) throw Error(res.status === 401 || res.status === 403 ? 'Icypeas authentication was rejected. Check the server API key.' : 'Icypeas could not complete this request. No automatic resubmission will be made.');
 const payload = await res.json();
 if (payload?.success === false) throw Error('Icypeas rejected the request. No automatic resubmission will be made.');
 return payload;
}
async function save(env,row,lease,data,release=true) {
 const statement = release ? 'UPDATE searches SET data=?,updated_at=?,lease=NULL,lease_until=0 WHERE id=? AND lease=? RETURNING id' : 'UPDATE searches SET data=?,updated_at=? WHERE id=? AND lease=? RETURNING id';
 return !!await env.DB.prepare(statement).bind(JSON.stringify(data),Date.now(),row.id,lease).first();
}

export async function handleContacts(request,env,row) {
 if (request.method !== 'POST') return response({status:'error',message:'Use POST to request a contact.'},405);
 let body;
 try {const raw=await request.text();if(raw.length>200)throw Error();body=JSON.parse(raw);}catch{return response({status:'error',message:'Provide a valid lead index.'},400);}
 const index=body?.leadIndex;
 if (!Number.isInteger(index)||index<0||index>2) return response({status:'error',message:'Choose one of this search’s first three prospects.'},400);
 if (!env.DB) return response({status:'error',message:'Contact storage is unavailable.'},503);
 if (row.status!=='complete') return response({status:'skipped',message:'Finish the company research before looking up contacts.'},409);
 let data;
 try {data=JSON.parse(row.data);}catch{return response({status:'error',message:'This search could not be read.'},500);}
 if (FINAL.has(data.contacts?.[index]?.status)) return response(publicContact(data.contacts[index]));
 if (!env.ICYPEAS_API_KEY) return response({status:'skipped',message:'Professional email discovery is not connected yet.'},503);
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
  if (FINAL.has(entry?.status)) {await save(env,row,lease,data);return response(publicContact(entry));}
  const lead=data.leads?.[index];
  const companyDomain=domain(lead?.website || '');
  if (!lead||!companyDomain) {
   entry=data.contacts[index]={status:'skipped',message:'This prospect has no usable public company domain.'};
   await save(env,row,lease,data);return response(publicContact(entry));
  }
  if (entry?.phase==='requesting') {
   entry.status='error';entry.message='The previous provider request has an unknown outcome. It will not be resubmitted automatically, to avoid duplicate charges.';
   await save(env,row,lease,data);return response(publicContact(entry));
  }
  const wait=Math.max(0,(data.contactLookup.nextAt||0)-Date.now());
  if (wait) {await save(env,row,lease,data);return response(entry?publicContact(entry):{status:'working',message:'Please wait briefly before the next contact lookup.'},202,wait);}
  if (!entry) {
   const count=Object.values(data.contacts).filter(x=>x?.startedAt).length;
   if(count>=3){await save(env,row,lease,data);return response({status:'skipped',message:'This search has reached its three-contact lookup limit.'},429);}
   const day=new Date().toISOString().slice(0,10);
   const identity=await digest(request.headers.get('cf-connecting-ip')||request.headers.get('oai-authenticated-user-id')||'local');
   if (!await takeBudget(env.DB,'icypeas:user:'+day+':'+identity,limit(env.ICYPEAS_USER_DAILY_LIMIT,9,30)) ||
       !await takeBudget(env.DB,'icypeas:daily:'+day,limit(env.ICYPEAS_DAILY_CONTACT_LIMIT,30,100))) {
    await save(env,row,lease,data);return response({status:'skipped',message:'The daily contact lookup limit has been reached. Try again tomorrow.'},429);
   }
   entry=data.contacts[index]={status:'working',phase:'discover',domain:companyDomain,startedAt:Date.now(),message:'Looking for a relevant current decision maker.'};
  }
  operation=entry.phase==='discover'?'discover':entry.phase==='person_ready'?'create':entry.phase==='poll'?'poll':null;
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
  data.contactLookup.nextAt=Date.now()+COOLDOWN;
  entry.lastOperation=operation;
  if(operation!=='poll')entry.phase='requesting';
  if(operation==='poll')entry.polls=(entry.polls||0)+1;
  // A crash after this durable marker cannot cause another paid create request.
  if(!await save(env,row,lease,data,false))return response({status:'working',message:'This lookup is already being handled.'},202,COOLDOWN);
  if(operation==='discover') {
   const payload=await provider(env.ICYPEAS_API_KEY,'find-people',{query:{currentCompanyWebsite:{include:[companyDomain]},currentJobTitle:{include:titlesFor(lead.roleToContact)}},pagination:{size:3}});
   const person=selectPerson(payload,companyDomain,lead.roleToContact);
   if(!person){Object.assign(entry,{status:'not_found',phase:'done',message:'No matching current decision maker was found.'});}
   else {const {score,...identity}=person;Object.assign(entry,{person:identity,phase:'person_ready',message:'A relevant decision maker was found. Preparing their professional email lookup.'});}
  } else if(operation==='create') {
   const externalId='clientflock:'+row.id+':'+index;
   const payload=await provider(env.ICYPEAS_API_KEY,'email-search',{firstname:entry.person.firstName,lastname:entry.person.lastName,domainOrCompany:companyDomain,custom:{externalId}});
   const id=clean(payload?.item?._id,200);
   if(!id)throw Error('Icypeas did not return a search identifier. The request will not be repeated automatically.');
   Object.assign(entry,{providerId:id,phase:'poll',message:'Icypeas is finding and checking the professional email.'});
  } else {
   const payload=await provider(env.ICYPEAS_API_KEY,'bulk-single-searchs/read',{id:entry.providerId});
   Object.assign(entry,parseEmailResult(payload,entry.providerId,companyDomain));
   if(FINAL.has(entry.status))entry.phase='done';
  }
  data.contactLookup.nextAt=Date.now()+COOLDOWN;
  if(!await save(env,row,lease,data))return response({status:'error',message:'The provider result could not be saved. No new lookup will be submitted automatically.'},500);
  return response(publicContact(entry),entry.status==='working'?202:200,entry.status==='working'?COOLDOWN:undefined);
 } catch(error) {
  if(!entry)entry=data.contacts[index]={};
  entry.status='error';
  entry.message=error?.name==='AbortError'||error?.name==='TimeoutError'||error instanceof TypeError
   ? 'The provider request has an unknown outcome. It will not be repeated automatically, to avoid duplicate charges.'
   : clean(error?.message,300)||'Contact lookup is unavailable. No email address was assumed.';
  entry.phase='done';
  await save(env,row,lease,data).catch(()=>{});
  return response(publicContact(entry),502);
 }
}
