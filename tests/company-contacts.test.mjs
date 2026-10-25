import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findCompanyContacts} from '../server/company-contacts.mjs';

const html = body => new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8'}});
function mock(pages, {ipv4='93.184.215.14',ipv6}={}) {
 const original = globalThis.fetch, calls = [];
 globalThis.fetch = async (value,options) => {
  const url = String(value); calls.push({url,options});
  if (url.startsWith('https://cloudflare-dns.com/')) {
   const type = new URL(url).searchParams.get('type');
   return Response.json({Status:0,Answer:type === 'A' ? [{type:1,data:ipv4}] : ipv6 ? [{type:28,data:ipv6}] : []});
  }
  const response = pages[url];
  return typeof response === 'function' ? response(options) : typeof response === 'string' ? html(response) : response?.clone() || new Response('not found',{status:404});
 };
 return {calls,restore:()=>globalThis.fetch=original,webCalls:()=>calls.filter(call=>!call.url.startsWith('https://cloudflare-dns.com/'))};
}

test('a linked company contact page yields an exact published mailbox and its source, never a verification claim',async()=>{
 const fake = mock({'https://acme.com/':'<a href="/contact">Contact us</a>','https://acme.com/contact':'<a href="mailto:hello%40acme.com?subject=hello">Email our team</a>'});
 try {
  const result = await findCompanyContacts('https://acme.com/');
  assert.equal(result.status,'found');assert.equal(result.email.email,'hello@acme.com');assert.equal(result.email.sourceUrl,'https://acme.com/contact');
  assert.equal(result.email.kind,'company_mailbox');assert.equal(result.email.published,true);assert.equal(result.email.verified,false);assert.equal(result.pagesChecked,2);assert.equal(result.person,undefined);
  assert.deepEqual(fake.webCalls().map(call=>call.url),['https://acme.com/','https://acme.com/contact']);
 } finally {fake.restore();}
});

test('first-party visible addresses are allowed, excluded-purpose, foreign and script-only addresses are not',async()=>{
 const fake = mock({'https://acme.com/':'<script>const email="founder@acme.com"</script><!--sales@acme.com--><p>privacy@acme.com jobs@acme.com press@acme.com owner@gmail.com hello@evilacme.com hello@acme.com.evil.com</p><p>info&#64;acme.com</p>'});
 try {const result = await findCompanyContacts('https://acme.com/');assert.equal(result.email.email,'info@acme.com');assert.equal(result.person,undefined);} finally {fake.restore();}
});

test('never guesses a person or email from a team page with only prose',async()=>{
 const fake = mock({'https://acme.com/':'<a href="/team">Our team</a>','https://acme.com/team':'<h1>Alex Miller, Founder</h1><p>Reach out to Alex using our form.</p>'});
 try {const result = await findCompanyContacts('https://acme.com/');assert.equal(result.status,'not_found');assert.equal(result.email,undefined);assert.equal(result.person,undefined);} finally {fake.restore();}
});

test('JSON-LD person requires explicit names, current company relation, relevant title and professional profile',async()=>{
 const own = {'@type':'Organization',url:'https://acme.com',founder:{'@type':'Person',givenName:'Alex',familyName:'Miller',jobTitle:'Founder',sameAs:['https://linkedin.com/in/alex-miller/']}};
 const fake = mock({'https://acme.com/':'<script type="application/ld+json">'+JSON.stringify(own)+'</script>'});
 try {const result = await findCompanyContacts('https://acme.com/');assert.equal(result.person.fullName,'Alex Miller');assert.equal(result.person.sourceUrl,'https://acme.com/');assert.equal(result.person.title,'Founder');assert.equal(result.email,undefined);} finally {fake.restore();}
 const ungrounded = {'@type':'Person',givenName:'Alex',familyName:'Miller',jobTitle:'Founder',sameAs:['https://linkedin.com/in/alex-miller/'],worksFor:{url:'https://other.com'}};
 const wrong = mock({'https://acme.com/':'<script type="application/ld+json">'+JSON.stringify(ungrounded)+'</script>'});
 try {assert.equal((await findCompanyContacts('https://acme.com/')).person,undefined);} finally {wrong.restore();}
});

test('organization contactPoint email is grounded in the company schema, unrelated schema is ignored',async()=>{
 const nodes = [{'@type':'Organization',url:'https://other.com',email:'founder@acme.com'},{'@type':'Organization',url:'https://acme.com',contactPoint:{'@type':'ContactPoint',email:'sales@acme.com'}}];
 const fake = mock({'https://acme.com/':'<script type="application/ld+json">'+JSON.stringify({'@graph':nodes})+'</script>'});
 try {const result=await findCompanyContacts('https://acme.com/');assert.equal(result.email.email,'sales@acme.com');} finally {fake.restore();}
});

test('specific business schema classes expose only their own company contactPoint',async()=>{
 for (const type of ['Store','LegalService','ProfessionalService','Restaurant','https://schema.org/MedicalBusiness','HealthAndBeautyBusiness','SportsActivityLocation','LodgingBusiness','EntertainmentBusiness','EducationalOrganization']) {
  const data = {'@graph':[
   {'@type':type,url:'https://another-company.com',contactPoint:{email:'sales@acme.com'}},
   {'@type':'WebPage',url:'https://acme.com',contactPoint:{email:'hello@acme.com'}},
   {'@type':type,url:'https://acme.com',contactPoint:{email:'contact@acme.com'}}
  ]};
  const fake=mock({'https://acme.com/':'<script type="application/ld+json">'+JSON.stringify(data)+'</script>'});
  try {const result=await findCompanyContacts('https://acme.com/');assert.equal(result.email.email,'contact@acme.com',type);assert.equal(result.email.sourceUrl,'https://acme.com/');} finally {fake.restore();}
 }
});

test('crawl is limited to four linked company pages, including initial page, and prioritizes contact links',async()=>{
 const fake = mock({'https://acme.com/':'<a href="/news">News</a><a href="/about">About</a><a href="https://other.com/contact">Contact partner</a><a href="/team">Team</a><a href="/contact">Contact</a><a href="/about-us">About us</a>', 'https://acme.com/contact':'<p>Use our form.</p>','https://acme.com/team':'<a href="/team/contact">Contact a team member</a>','https://acme.com/about':'<p>Our business</p>'});
 try {const result=await findCompanyContacts('https://acme.com/');assert.equal(result.pagesChecked,4);assert.deepEqual(fake.webCalls().map(call=>call.url),['https://acme.com/','https://acme.com/contact','https://acme.com/team','https://acme.com/about']);} finally {fake.restore();}
});

test('unpublished supplied contact path, cross-company redirects and unsafe URLs never get followed',async()=>{
 const fake = mock({'https://acme.com/':'<p>No links.</p>'});
 try {
  assert.equal((await findCompanyContacts('https://acme.com/',{contactUrl:'https://acme.com/guessed-contact'})).status,'not_found');
  for (const url of ['http://acme.com','https://127.0.0.1','https://acme.com:8443','https://user:password@acme.com','https://service.local']) assert.equal((await findCompanyContacts(url)).status,'unavailable');
  assert.equal(fake.webCalls().length,1);
 } finally {fake.restore();}
 const redirect = mock({'https://acme.com/':new Response(null,{status:302,headers:{Location:'https://other.com/contact'}})});
 try {assert.equal((await findCompanyContacts('https://acme.com/')).status,'unavailable');assert.equal(redirect.webCalls().length,1);} finally {redirect.restore();}
});

test('private DNS answers, including AAAA mixed with public A, block all page requests',async()=>{
 for (const config of [{ipv4:'127.0.0.1'},{ipv4:'10.0.0.1'},{ipv4:'169.254.169.254'},{ipv6:'::1'},{ipv6:'fc00::1'},{ipv6:'2001:db8::1'}]) {
  const fake=mock({'https://acme.com/':'hello@acme.com'},config);
  try {assert.equal((await findCompanyContacts('https://acme.com/')).status,'unavailable');assert.equal(fake.webCalls().length,0);} finally {fake.restore();}
 }
});

test('same-company redirect to www is allowed and DNS checked again',async()=>{
 const fake=mock({'https://acme.com/':new Response(null,{status:301,headers:{Location:'https://www.acme.com/contact'}}),'https://www.acme.com/contact':'<p>Contact us: contact@acme.com</p>'});
 try {const result=await findCompanyContacts('https://acme.com/');assert.equal(result.email.sourceUrl,'https://www.acme.com/contact');assert.equal(fake.calls.filter(call=>call.url.startsWith('https://cloudflare-dns.com/')).length,4);} finally {fake.restore();}
});

test('oversized pages are stopped and do not become guessed contacts',async()=>{
 const fake=mock({'https://acme.com/':()=>html('<p>hello@acme.com</p>'+'x'.repeat(450001))});
 try {const result=await findCompanyContacts('https://acme.com/');assert.equal(result.status,'unavailable');assert.equal(result.email,undefined);} finally {fake.restore();}
});
