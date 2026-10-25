// First-party evidence only: no generated addresses, people guesses or third-party crawling.
const MAX_PAGES = 4;
const MAX_BYTES = 450000;
const MAX_TIME = 28000;
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const host = value => value.toLowerCase().replace(/^www\./, '');

function companyUrl(value, companyDomain) {
 try {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2048 ||
      !/^([a-z0-9-]+\.)+[a-z]{2,63}$/i.test(url.hostname) || /\.(local|internal|localhost|test|invalid)$/i.test(url.hostname) ||
      (companyDomain && host(url.hostname) !== companyDomain)) return null;
  url.hash = '';
  return url;
 } catch { return null; }
}

function publicIP(ip) {
 if (typeof ip !== 'string') return false;
 // Conservatively allow global unicast IPv6 only, excluding documentation, Teredo and 6to4.
 if (ip.includes(':')) {
  if (!/^[23][0-9a-f]{3}:/i.test(ip)) return false;
  const [first,second] = ip.split(':').map(part => parseInt(part,16));
  return first !== 0x2002 && !(first === 0x2001 && [0,2,0x10,0x20,0xdb8].includes(second));
 }
 if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return false;
 const n = ip.split('.').map(Number);
 return n.every(x => x <= 255) && ![0,10,127].includes(n[0]) && n[0] < 224 &&
  !(n[0] === 169 && n[1] === 254) && !(n[0] === 172 && n[1] >= 16 && n[1] <= 31) &&
  !(n[0] === 192 && [0,2,168].includes(n[1])) && !(n[0] === 100 && n[1] >= 64 && n[1] <= 127) &&
  !(n[0] === 198 && [18,19,51].includes(n[1])) && !(n[0] === 203 && n[1] === 0);
}

const signal = (deadline, max) => {
 const remaining = deadline - Date.now();
 if (remaining <= 0) throw Error('Company contact check timed out.');
 return AbortSignal.timeout(Math.max(1, Math.min(remaining, max)));
};

async function page(value, companyDomain, deadline) {
 let url = companyUrl(value, companyDomain);
 for (let redirects = 0; redirects < 3; redirects++) {
  if (!url) throw Error('Only this company’s public HTTPS pages can be checked.');
  const answers = await Promise.all(['A','AAAA'].map(async type => {
   const response = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(url.hostname) + '&type=' + type,
    {headers:{Accept:'application/dns-json'},signal:signal(deadline,4500)});
   if (!response.ok) throw Error('Company DNS unavailable.');
   const result = await response.json();
   if (result.Status !== undefined && result.Status !== 0) throw Error('Company DNS unavailable.');
   return (result.Answer || []).filter(answer => [1,28].includes(answer.type)).map(answer => answer.data);
  }));
  const ips = answers.flat();
  if (!ips.length || !ips.every(publicIP)) throw Error('Company page is not on a public address.');
  const response = await fetch(url.href,{redirect:'manual',headers:{Accept:'text/html','User-Agent':'ClientFlock/1.0 (+public business research)'},signal:signal(deadline,7000)});
  if (response.status >= 300 && response.status < 400) {
   const location = response.headers.get('location');
   if (!location) throw Error('Company redirect is unavailable.');
   url = companyUrl(new URL(location,url).href,companyDomain); continue;
  }
  if (!response.ok || !/\btext\/html\b/i.test(response.headers.get('content-type') || '') || !response.body) throw Error('Company page unavailable.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
   while (true) {
    const {done,value:chunk} = await reader.read(); if (done) break;
    size += chunk.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw Error('Company page exceeds the contact check limit.'); }
    chunks.push(chunk);
   }
  } finally { reader.releaseLock(); }
  const decoder = new TextDecoder();
  return {url:url.href, html:chunks.map(chunk => decoder.decode(chunk,{stream:true})).join('') + decoder.decode()};
 }
 throw Error('Too many company page redirects.');
}

function entities(value) {
 return value.replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (_,n) => {
  const point = /^x/i.test(n) ? parseInt(n.slice(1),16) : Number(n);
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
 }).replace(/&(amp|quot|apos|nbsp|lt|gt|commat);/gi,(_,name) => ({amp:'&',quot:'"',apos:"'",nbsp:' ',lt:'<',gt:'>',commat:'@'}[name.toLowerCase()]));
}
const attr = (tag,name) => {
 const match = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'));
 return match ? entities(match[1] ?? match[2] ?? match[3] ?? '') : '';
};
const sameMailboxDomain = (email,companyDomain) => {
 const value = email.toLowerCase();
 const emailDomain = value.split('@')[1];
 return emailDomain === companyDomain || emailDomain?.endsWith('.' + companyDomain);
};
const mailboxScore = email => {
 const local = email.split('@')[0].toLowerCase();
 if (/^(no.?reply|do.?not.?reply|noreplies|privacy|gdpr|dpo|legal|abuse|security|careers?|jobs?|recruit|press|media|webmaster|postmaster)([+._-]|$)/.test(local)) return -1;
 if (/^(sales|commercial|partnerships?|business|hello|contact|bookings?|reservations?|bonjour|ola|oi)([+._-]|$)/.test(local)) return 30;
 if (/^(info|enquiries|inquiries|office|team|welcome)([+._-]|$)/.test(local)) return 20;
 if (/^(support|help|service)([+._-]|$)/.test(local)) return 5;
 return 10;
};
function validEmail(value, companyDomain) {
 const email = clean(value.replace(/^mailto:/i,''),254).toLowerCase();
 if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email) || !sameMailboxDomain(email,companyDomain) || mailboxScore(email) < 0) return null;
 return email;
}
function profile(value) {
 try {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && /(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/in\/[\w%-]+\/?$/.test(url.pathname) ? url.href : null;
 } catch { return null; }
}
function name(value) {
 if (typeof value !== 'string' || value.trim().length > 80) return null;
 const text = clean(value,80);
 return /^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]{0,79}$/u.test(text) ? text : null;
}
const schemaType = (item,type) => [item?.['@type']].flat().some(value => typeof value === 'string' && value.split(/[\/#]/).at(-1) === type);
// Sites commonly publish only the most-specific Schema.org business class.
// Keep this allowlist explicit; a Person, Article or WebPage is not a company.
const businessTypes = new Set(['Organization','Corporation','LocalBusiness','Store','LegalService','ProfessionalService',
 'Restaurant','FoodEstablishment','MedicalBusiness','MedicalClinic','Dentist','HealthAndBeautyBusiness','BeautySalon','HairSalon','DaySpa',
 'SportsActivityLocation','HealthClub','SportsClub','LodgingBusiness','Hotel','EntertainmentBusiness','EducationalOrganization','School',
 'TravelAgency','TouristInformationCenter','HomeAndConstructionBusiness','GeneralContractor','FinancialService','InsuranceAgency','RealEstateAgent']);
const schemaBusiness = item => [item?.['@type']].flat().some(value => typeof value === 'string' && businessTypes.has(value.split(/[\/#]/).at(-1)));
const seniorRole = title => /owner|founder|co[-\s]?founder|ceo|chief|director|president|manager|head|propri[ée]taire|fondateur|fondatrice|g[ée]rant|directeur|directrice|pr[ée]sident|responsable|fundador|fundadora|s[oó]ci[oa]|propriet[aá]ri[oa]|gerente|diretor|diretora|dono|dona|geschäftsführer|inhaber/i.test(title);

function extract(pageData,companyDomain) {
 const emails = [], people = [], links = [];
 const pushEmail = value => { const email = validEmail(value,companyDomain); if (email) emails.push({email,kind:'company_mailbox',sourceUrl:pageData.url,published:true,verified:false}); };
 const withoutHidden = pageData.html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
 for (const match of withoutHidden.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
  const href = attr(match[1],'href');
  if (/^mailto:/i.test(href)) {
   try { const address = decodeURIComponent(href.slice(7).split('?')[0]); if (!/[,;]/.test(address)) pushEmail(address); } catch {}
   continue;
  }
  if (!href || /^javascript:|^data:|^tel:/i.test(href)) continue;
  let url; try {url = companyUrl(new URL(href,pageData.url).href,companyDomain);} catch {continue;}
  if (!url || /logout|signout|unsubscribe|delete|remove/i.test(url.pathname + url.search)) continue;
  const context = (url.pathname + ' ' + entities(match[2].replace(/<[^>]*>/g,' '))).toLowerCase();
  const score = /contact|get.in.touch|nous.joindre|contato|contatt|kontakt/.test(context) ? 3 : /team|[ée]quipe|people|equipe|staff|leadership/.test(context) ? 2 : /about|our.story|[àa].propos|quem.somos|sobre/.test(context) ? 1 : 0;
  if (score) links.push({url:url.href,score});
 }
 const visible = entities(withoutHidden.replace(/<[^>]*>/g,' '));
 for (const match of visible.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)) pushEmail(match[0]);
 let nodes = 0;
 const inspect = (item,depth=0,companyRelation=false) => {
  if (++nodes > 250 || depth > 7 || !item || typeof item !== 'object') return;
  if (Array.isArray(item)) { for (const child of item.slice(0,30)) inspect(child,depth+1,companyRelation); return; }
  const organization = schemaBusiness(item);
  const ownOrganization = organization && !!companyUrl(item.url || item['@id'],companyDomain);
  if (ownOrganization) {
   if (typeof item.email === 'string') pushEmail(item.email);
   for (const point of [item.contactPoint].flat().slice(0,10)) if (point && typeof point.email === 'string') pushEmail(point.email);
  }
  if (schemaType(item,'Person')) {
   const firstName = name(item.givenName), lastName = name(item.familyName), title = clean(item.jobTitle,160);
   const worksHere = companyRelation || [item.worksFor].flat().some(company => company && typeof company === 'object' && !!companyUrl(company.url || company['@id'],companyDomain));
   const profileUrl = [item.sameAs,item.url].flat(2).map(profile).find(Boolean);
   if (firstName && lastName && seniorRole(title) && profileUrl && worksHere) {
    people.push({firstName,lastName,fullName:firstName+' '+lastName,title,profileUrl,sourceUrl:pageData.url});
    if (typeof item.email === 'string') pushEmail(item.email);
   }
  }
  for (const [key,child] of Object.entries(item).slice(0,40)) if (child && typeof child === 'object') inspect(child,depth+1,ownOrganization && ['employee','founder','founders'].includes(key));
 };
 for (const match of pageData.html.replace(/<!--[\s\S]*?-->/g,' ').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (attr(match[1],'type').toLowerCase() !== 'application/ld+json' || match[2].length > 100000) continue;
  try { inspect(JSON.parse(match[2])); } catch {}
 }
 return {emails,people,links};
}

/** Public evidence, never email verification. Each returned identity includes its first-party source. */
export async function findCompanyContacts(website,{contactUrl}={}) {
 const checkedAt = new Date().toISOString(), initial = companyUrl(website);
 if (!initial) return {status:'unavailable',checkedAt,pagesChecked:0};
 const companyDomain = host(initial.hostname), queue = [initial.href], visited = new Set(), emails = [], people = [];
 const deadline = Date.now() + MAX_TIME;
 let pagesChecked = 0;
 while (queue.length && visited.size < MAX_PAGES && Date.now() < deadline) {
  const next = queue.shift(); if (visited.has(next)) continue; visited.add(next);
  try {
   const result = await page(next,companyDomain,deadline); pagesChecked++;
   const extracted = extract(result,companyDomain); emails.push(...extracted.emails); people.push(...extracted.people);
   if (pagesChecked === 1) {
    const ordered = extracted.links.sort((a,b) => (b.url === contactUrl ? 1 : 0) - (a.url === contactUrl ? 1 : 0) || b.score-a.score);
    for (const link of ordered) if (!visited.has(link.url) && !queue.includes(link.url) && queue.length < MAX_PAGES-1) queue.push(link.url);
   }
   // A clearly published sales/contact mailbox is a useful low-cost endpoint already.
   if (emails.some(item => mailboxScore(item.email) >= 20)) break;
  } catch { /* One blocked/inaccessible page does not authorize a different host. */ }
 }
 const email = emails.sort((a,b) => mailboxScore(b.email)-mailboxScore(a.email))[0];
 const person = people[0];
 return {status:email || person ? 'found' : pagesChecked ? 'not_found' : 'unavailable',...(email ? {email} : {}),...(person ? {person} : {}),checkedAt,pagesChecked};
}
