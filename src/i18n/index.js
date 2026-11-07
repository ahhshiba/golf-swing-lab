

















export const LOCALES=Object.freeze(['zh-Hant','en']);
export const FALLBACK_LOCALE='zh-Hant';
const INTL=Object.freeze({'zh-Hant':'zh-Hant-TW',en:'en-US'});
const MINUS='−';

const catalogs=new Map();
let active=FALLBACK_LOCALE;
let loader=null;
const listeners=new Set();
const missingSeen=new Set();
const missingFns=new Set();


function defaultBase(){
try{return new URL('../../i18n/namespaces.json',import.meta.url).href.replace(/namespaces\.json$/,'');}catch(_){return'i18n/';}
}


export function resolveLocale(pref,languages=globalThis.navigator?.languages??[]){
if(pref&&pref!=='auto'&&LOCALES.includes(pref))return pref;
const list=Array.isArray(languages)?languages:[languages];
for(const raw of list){
const l=String(raw??'').toLowerCase();
if(!l)continue;
if(/^zh(-|$)/.test(l))return'zh-Hant';
if(/^en(-|$)/.test(l))return'en';
}
return'en';
}


export function flattenNamespace(ns,obj,out=new Map()){
const walk=(prefix,o)=>{
for(const[k,v]of Object.entries(o??{})){
const key=prefix?`${prefix}.${k}`:k;
if(v&&typeof v==='object'&&!Array.isArray(v)&&!isPluralObject(v))walk(key,v);
else out.set(key,v);
}
};
walk(ns,obj);
return out;
}

const PLURAL_CATS=['zero','one','two','few','many','other'];
function isPluralObject(v){
return v&&typeof v==='object'&&typeof v.other==='string'&&Object.keys(v).every((k)=>PLURAL_CATS.includes(k)||k==='_context');
}


export function setCatalog(locale,flat){
const m=new Map(flat instanceof Map?flat:Object.entries(flat??{}));
for(const k of[...m.keys()])if(k.endsWith('._context')||k==='_context')m.delete(k);
catalogs.set(locale,m);
}






export function expandCatalog(merged){
if(!merged||typeof merged!=='object'||merged.$tree!==1)return merged;
const out={};
const walk=(prefix,node)=>{
for(const[k,v]of Object.entries(node)){
if(!prefix&&k.startsWith('$'))continue;
const key=k===''?prefix:prefix?`${prefix}.${k}`:k;
if(k!==''&&v&&typeof v==='object'&&!Array.isArray(v)&&!isPluralObject(v))walk(key,v);
else out[key]=v;
}
};
walk('',merged);
return out;
}

async function fetchJson(fetchImpl,url){
try{
const r=await fetchImpl(url);
if(!r||r.ok===false)return null;
return await r.json();
}catch(_){
return null;
}
}

const lazyParts=new Map();

async function loadCatalog(locale){
if(!loader)return catalogs.get(locale)??new Map();
const{fetchImpl,base}=loader;
const merged=await fetchJson(fetchImpl,`${base}${locale}.json`);
if(merged&&typeof merged==='object'){
setCatalog(locale,expandCatalog(merged));
const cat=catalogs.get(locale);
if(typeof merged.$lazy==='string'&&/^[\w.-]+\.json$/.test(merged.$lazy)){

lazyParts.set(locale,fetchJson(fetchImpl,`${base}${merged.$lazy}`).then((more)=>{
if(!more||typeof more!=='object')return;
for(const[k,v]of Object.entries(expandCatalog(more)))if(!k.endsWith('._context'))cat.set(k,v);
}));
}else lazyParts.delete(locale);
return cat;
}
lazyParts.delete(locale);
const index=await fetchJson(fetchImpl,`${base}namespaces.json`);
const names=Array.isArray(index?.namespaces)?index.namespaces:[];
const out=new Map();
const files=await Promise.all(names.map((ns)=>fetchJson(fetchImpl,`${base}${locale}/${ns}.json`).then((obj)=>[ns,obj])));
for(const[ns,obj]of files)if(obj&&typeof obj==='object')flattenNamespace(ns,obj,out);
setCatalog(locale,out);
return catalogs.get(locale);
}


export async function initI18n({locale='auto',fetchImpl=globalThis.fetch?.bind(globalThis),base,languages}={}){
loader=typeof fetchImpl==='function'?{fetchImpl,base:base??defaultBase()}:null;
const want=resolveLocale(locale,languages??globalThis.navigator?.languages??[]);
await loadCatalog(FALLBACK_LOCALE);
if(want!==FALLBACK_LOCALE)await loadCatalog(want);
active=want;
setHtmlLang();
return active;
}

function setHtmlLang(){
try{if(globalThis.document?.documentElement)globalThis.document.documentElement.lang=active;}catch(_){ }
}

export function getLocale(){return active;}

export function i18nComplete(){return Promise.all([...lazyParts.values()]).then(()=>undefined,()=>undefined);}

export function intlLocale(){return INTL[active]??active;}

export async function setLocale(locale){
const want=resolveLocale(locale);
if(!catalogs.has(want)||loader)await loadCatalog(want);
await lazyParts.get(want);
const prev=active;
active=want;
setHtmlLang();
for(const fn of[...listeners]){try{fn(active,prev);}catch(_){ }}
return active;
}

export function onLocaleChange(fn){
listeners.add(fn);
return()=>listeners.delete(fn);
}

function lookup(key){
const a=catalogs.get(active);
if(a&&a.has(key))return a.get(key);
const f=catalogs.get(FALLBACK_LOCALE);
if(f&&f.has(key))return f.get(key);
return undefined;
}

export function has(key){return lookup(key)!==undefined;}

function reportMissing(key){
if(missingSeen.has(key))return;
missingSeen.add(key);
for(const fn of[...missingFns]){try{fn(key,active);}catch(_){ }}
}

export function missingKeys(){return[...missingSeen];}

export function onMissing(fn){missingFns.add(fn);return()=>missingFns.delete(fn);}

function interpolate(s,params){
return String(s).replace(/\{(\w+)\}/g,(m,name)=>{
if(!Object.prototype.hasOwnProperty.call(params,name))return m;
const v=params[name];
if(typeof v==='number')return fmtNum(v,{digits:Number.isInteger(v)?0:null});
return v===null||v===undefined?'':String(v);
});
}


export function t(key,params={}){
const p=params??{};
let v=lookup(key);
if(v===undefined){reportMissing(key);return String(key);}
if(v&&typeof v==='object'){
let cat='other';
if(typeof p.n==='number'){try{cat=new Intl.PluralRules(intlLocale()).select(p.n);}catch(_){cat='other';}}
v=v[cat]??v.other??'';
}
return interpolate(v,p);
}

export function plural(key,n,params={}){return t(key,{...params,n});}


export function msg(m){
if(m===null||m===undefined)return'';
if(typeof m==='string')return m;
return t(m.code,m.params??{});
}

export function list(items,type='conjunction'){
const arr=(items??[]).map(String);
try{return new Intl.ListFormat(intlLocale(),{style:'long',type}).format(arr);}catch(_){return arr.join(', ');}
}


export function fmtNum(x,{digits=0,sign=false}={}){
if(typeof x!=='number'||!Number.isFinite(x))return'—';
const o={useGrouping:true};
if(digits===null)o.maximumFractionDigits=3;
else{o.minimumFractionDigits=digits;o.maximumFractionDigits=digits;}
if(sign)o.signDisplay='exceptZero';
let s;
try{s=new Intl.NumberFormat(intlLocale(),o).format(x);}catch(_){s=digits===null?String(x):x.toFixed(digits);}
s=s.replace(/-/g,MINUS);
if(/^[−]0([.,]0+)?$/.test(s))s=s.slice(1);
return s;
}

function toDate(iso){
const d=iso instanceof Date?iso:new Date(iso);
return Number.isFinite(d.getTime())?d:null;
}


export function fmtDateTime(iso,{date=true,time=true}={}){
const d=toDate(iso);
if(!d)return'—';
const o={};
if(date)o.dateStyle='medium';
if(time)o.timeStyle='short';
if(!date&&!time)return'';
try{return new Intl.DateTimeFormat(intlLocale(),o).format(d);}catch(_){return d.toISOString();}
}
export function fmtDate(iso){return fmtDateTime(iso,{date:true,time:false});}
export function fmtTime(iso){return fmtDateTime(iso,{date:false,time:true});}
export function fmtRelativeDays(n){
if(!Number.isFinite(n))return'—';
try{return new Intl.RelativeTimeFormat(intlLocale(),{numeric:'auto'}).format(Math.round(n),'day');}catch(_){return String(n);}
}
