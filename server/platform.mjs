export const QUALIFICATION_VERSION=1;

const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m=>[m[1].toLowerCase(),m[2]??m[3]??m[4]??'']));
const shopHost=host=>/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(host);
function assetURL(value,base){try{const url=new URL(value,base);return ['http:','https:'].includes(url.protocol)?url:null;}catch{return null;}}

// Inspect executable store markup, not visible prose or a copied code sample.
// Never expose checkout tokens or other script values in proof strings.
export function detectPlatform(html,url,checkedAt=new Date().toISOString()){
 const source=String(html||'').slice(0,750000).replace(/<!--[\s\S]*?-->/g,'').replace(/<(pre|code|template)\b[^>]*>[\s\S]*?<\/\1>/gi,''),evidence=[];
 for(const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  const attrs=attributes(match[1]),type=(attrs.type||'').toLowerCase();
  if(type&&!/^(?:text|application)\/javascript$|^module$/.test(type))continue;
  const shop=match[2].match(/\b(?:window\.)?Shopify\.shop\s*=\s*['"]([a-z0-9][a-z0-9-]*\.myshopify\.com)['"]/i);
  if(shop)evidence.push('Storefront script sets Shopify.shop to '+shop[1].toLowerCase()+'.');
 }
 for(const match of source.matchAll(/<(script|link|meta|img)\b[^>]*>/gi)){
  const tag=match[1].toLowerCase(),attrs=attributes(match[0]);
  if(tag==='script'||tag==='link'){
   if(tag==='script'&&attrs.type&&!/^(?:text|application)\/javascript$|^module$/i.test(attrs.type))continue;
   const asset=assetURL(tag==='script'?attrs.src:attrs.href,url);
   if(asset?.hostname==='cdn.shopify.com'&&/^\/(?:shopifycloud\/|s\/(?:files|assets)\/)/.test(asset.pathname)&&/\.(?:js|css)(?:$|\?)/i.test(asset.pathname))evidence.push('Loads Shopify storefront '+(tag==='script'?'JavaScript':'stylesheet')+' from cdn.shopify.com'+asset.pathname.slice(0,100)+'.');
  }
  if((tag==='link'&&(attrs.rel||'').toLowerCase().split(/\s+/).includes('canonical'))||(tag==='meta'&&(attrs.property||attrs.name||'').toLowerCase()==='og:url')){
   const canonical=assetURL(tag==='link'?attrs.href:attrs.content,url);if(canonical&&shopHost(canonical.hostname))evidence.push('Store metadata identifies '+canonical.hostname.toLowerCase()+'.');
  }
 }
 const unique=[...new Set(evidence)].slice(0,4);
 return {name:unique.length?'Shopify':null,status:unique.length?'verified':'unknown',url,evidence:unique,checkedAt};
}

export const unavailablePlatform=(url,checkedAt=new Date().toISOString())=>({name:null,status:'unavailable',url,evidence:[],checkedAt});
export function requiredPlatforms(profile){return [...new Set((Array.isArray(profile?.requirements)?profile.requirements:[]).filter(r=>r?.type==='platform'&&r.required===true&&typeof r.name==='string').map(r=>r.name))];}
export const requiresRequalification=data=>data?.qualification?.version!==QUALIFICATION_VERSION;
export function platformMatchesRequirements(profile,platform){return requiredPlatforms(profile).every(name=>platform?.status==='verified'&&platform.name?.toLowerCase()===name.toLowerCase());}

// A dependency is about the product being sold, never the seller's own stack
// or a passing mention that the seller works with Shopify merchants.
export function shopifyDependency(text){
 const normalized=String(text||'').replace(/\s+/g,' ');
 const match=normalized.match(/\b(?:shopify(?:\s+[\p{L}][\p{L}-]*){0,4}\s+(?:app|application|aplicativo)\b|(?:app|application|aplicativo|aplicação|aplicación)(?:\s+[\p{L}][\p{L}-]*){0,5}\s+(?:for|pour|para|für|per|voor)\s+shopify\b|(?:app|application|aplicativo|aplicação|aplicación)\s+shopify\b|requires?\s+(?:an?\s+)?shopify\s+(?:store|shop)\b|only\s+(?:works?|available|runs?)\s+(?:on|with|for)\s+shopify\b)/iu);
 return match?{index:match.index,text:match[0]}:null;
}
