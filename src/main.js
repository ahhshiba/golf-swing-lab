









import{createStore,createNavigator,initialState,ALL_SCREENS,TABS,TABBAR_HIDDEN,DATA_SCREENS,tabOf}from'./state.js';
import{openRepository}from'./store/core.js';
import{idbBackend}from'./store/idb.js';
import{loadSettings}from'./session/settings.js';
import{createUpdater}from'./ui/update.js';
import{initI18n,t,msg,has,plural,onMissing,onLocaleChange,getLocale,i18nComplete}from'./i18n/index.js';
import{DEFAULT_UNITS}from'./i18n/units.js';
import{injectSprite,icon}from'./ui/icons.js';
import{toast}from'./ui/components.js';
import*as diagRecord from'./diag/record.js';
import*as build from'./version.js';


export const SCREEN_MODULES=Object.freeze({
home:['./ui/home.js','mountHome'],
venue:['./ui/venue.js','mountVenue'],
setup:['./ui/setup.js','mountSetup'],
live:['./ui/live.js','mountLive'],
import:['./ui/import.js','mountImport'],
shot:['./ui/shot.js','mountShot'],
history:['./ui/history.js','mountHistory'],
diag:['./ui/diag.js','mountDiag'],
settings:['./ui/settings.js','mountSettings'],
about:['./ui/about.js','mountAbout'],
venues:['./ui/venues.js','mountVenues'],
teach:['./ui/teach.js','mountTeach'],
privacy:['./ui/settings.js','mountPrivacy'],
help:['./ui/settings.js','mountHelp'],
licences:['./ui/settings.js','mountLicences'],
developer:['./ui/settings.js','mountDeveloper'],

drills:['./ui/drills.js','mountDrills'],
drill:['./ui/drill.js','mountDrill'],
stats:['./ui/stats.js','mountStats'],
gapping:['./ui/gapping.js','mountGapping'],
});

const MIGRATE_PAUSE_MS=400;

const NEEDS_DEPS=new Set(['setup','live','import','diag','teach','developer']);


const OPTIONAL=Object.freeze({
camera:'./capture/camera.js',
recorder:'./capture/recorder.js',
frametap:'./capture/frametap.js',
gravity:'./sensors/gravity.js',
onset:'./audio/onset.js',
probe:'./import/probe.js',
decode:'./import/decode.js',
landmarker:'./pose/landmarker.js',
clipPipeline:'./pipeline/clip.js',
livePipeline:'./pipeline/live.js',
diagReport:'./diag/report.js',
diagRecord:'./diag/record.js',
visionClient:'./workers/client.js',
});

export const REPO_TIMEOUT_MS=5000;
const UNSAVED_FLAG='gsl.boot.unsaved';
const ERROR_RING=200;


function present(rel){
const list=build.PRESENT_MODULES;
if(!Array.isArray(list))return true;
return list.includes(rel.replace(/^\.\//,''));
}


async function loadOptional(deps){
await Promise.all(Object.entries(OPTIONAL).map(async([k,p])=>{
if(!present(p)){deps[k]=null;return;}
try{deps[k]=await import(p);}catch(_){deps[k]=null;}
}));
return deps;
}

function setPath(obj,path,value){
const parts=String(path).split('.');
let o=obj;
for(const p of parts.slice(0,-1))o=(o[p]=o[p]&&typeof o[p]==='object'?o[p]:{});
o[parts.at(-1)]=value;
}


function applyStatic(doc=document){
for(const el of doc.querySelectorAll('[data-i18n]'))if(has(el.dataset.i18n))el.textContent=t(el.dataset.i18n);
for(const el of doc.querySelectorAll('[data-i18n-aria-label]'))if(has(el.dataset.i18nAriaLabel))el.setAttribute('aria-label',t(el.dataset.i18nAriaLabel));
}

const THEME_META=[];

function applyTheme(theme){
const root=document.documentElement;
if(theme==='light'||theme==='dark'||theme==='sun')root.dataset.theme=theme;
else delete root.dataset.theme;

try{
if(!THEME_META.length)for(const m of document.querySelectorAll('meta[name="theme-color"]'))THEME_META.push([m,m.getAttribute('content')]);
const bg=root.dataset.theme?getComputedStyle(root).getPropertyValue('--bg').trim():'';
for(const[m,initial]of THEME_META)m.setAttribute('content',bg||initial);
}catch(_){ }
}





function applyDataTheme(theme,roots){
for(const id of DATA_SCREENS){
const el=roots?.[id];
if(!el)continue;
if((theme??'auto')==='auto')el.dataset.liveTheme='dark';
else delete el.dataset.liveTheme;
}
}


export function createDrillState(){
let cur=null;
const subs=new Set();
return{
current:()=>cur,
set(drill){
cur=drill??null;
for(const fn of[...subs]){try{fn(cur);}catch(_){ }}
return cur;
},
onChange(fn){subs.add(fn);return()=>subs.delete(fn);},
};
}





export function createE2EStates(){
const states=new Map();
return{
registerState(screen,name,fn){
if(typeof screen!=='string'||typeof name!=='string'||typeof fn!=='function')throw new TypeError('registerState(screen, name, async fn)');
states.set(`${screen}:${name}`,fn);
},
states:()=>[...states.keys()].sort(),
has:(screen,name)=>states.has(`${screen}:${name}`),
async runState(screen,name,...args){
const fn=states.get(`${screen}:${name}`);
if(!fn)throw Object.assign(new Error(`no e2e state ${screen}:${name}`),{code:'E2E_STATE_MISSING'});
return fn(...args);
},
};
}


export function normaliseError(err,ctx,screen){
let code='INTERNAL';
try{
const c=err?.code??err?.name;
if(typeof c==='string'&&/^[A-Z][A-Z0-9_]+$/.test(c))code=c;
else if(err?.name==='QuotaExceededError')code='QUOTA_EXCEEDED';
}catch(_){ }
let detail='';
try{detail=String(err?.message??err??'').slice(0,500);}catch(_){detail='';}
let stack;
try{stack=typeof err?.stack==='string'?err.stack.slice(0,2000):undefined;}catch(_){stack=undefined;}
let params={};
try{params=(err&&typeof err.params==='object'&&err.params)||{};}catch(_){params={};}
return{code,params,detail,stack,where:ctx?.where??'app',screen:screen??null,at:new Date().toISOString()};
}


const BENIGN_RE=/ResizeObserver loop|^Script error\.?$/;

function withTimeout(p,ms,code){
let timer;
return Promise.race([p,new Promise((_,rej)=>{timer=setTimeout(()=>rej(Object.assign(new Error(`${code} after ${ms} ms`),{code})),ms);})]).finally(()=>clearTimeout(timer));
}

function readUnsavedFlag(){
try{return sessionStorage.getItem(UNSAVED_FLAG)==='1';}catch(_){return false;}
}
function clearUnsavedFlag(){
try{sessionStorage.removeItem(UNSAVED_FLAG);}catch(_){ }
}

function fmtElapsed(ms){
const m=Math.max(0,Math.floor(ms/60000));
return m<60?plural('time.minutes',m):t('time.hours_minutes',{h:Math.floor(m/60),m:m%60});
}

async function boot(){
const store=createStore(initialState());
const nav=createNavigator(store);
const deps={};
const localDiag={};
const record=(path,value)=>{
setPath(localDiag,path,value);
try{diagRecord.record(path,value);}catch(_){ }
};


const errorLog=[];
const errorSinks=new Set();
const events=[];
const logEvent=(e)=>{
const ev={at:e.at,kind:'error',code:e.code,where:e.where,screen:e.screen,detail:e.detail};
try{
if(typeof diagRecord.logEvent==='function'){diagRecord.logEvent(ev);return;}
events.push(ev);
if(events.length>ERROR_RING)events.splice(0,events.length-ERROR_RING);
record('events',events);
}catch(_){ }
};
const errors={
log:()=>[...errorLog],

onReport:(fn)=>{errorSinks.add(fn);return()=>errorSinks.delete(fn);},

report(err,ctx={}){
try{
const e=normaliseError(err,ctx,store.get().screen);
errorLog.push(e);
if(errorLog.length>ERROR_RING)errorLog.splice(0,errorLog.length-ERROR_RING);
try{record('errors.last',{code:e.code,where:e.where,detail:e.detail,at:e.at,count:errorLog.length});}catch(_){ }
logEvent(e);
for(const fn of[...errorSinks]){try{fn(e);}catch(_){ }}
const benign=BENIGN_RE.test(e.detail);
if(!ctx.silent&&!benign)toast.error(has(`error.${e.code}`)?t(`error.${e.code}`,e.params):t('error.INTERNAL'),{slot:ctx.slot??currentErrorSlot()});
return e;
}catch(_){
return null;
}
},
};
window.addEventListener('error',(ev)=>{errors.report(ev.error??ev.message,{where:'global'});});
window.addEventListener('unhandledrejection',(ev)=>{errors.report(ev.reason,{where:'global'});});
const currentErrorSlot=()=>document.querySelector(`[data-screen="${store.get().screen}"] [data-error-slot]`)??undefined;

let settings=loadSettings();
applyTheme(settings.theme);
await initI18n({locale:settings.locale}).catch((e)=>{record('i18n.error',String(e?.message??e));return null;});
try{injectSprite(document);}catch(_){ }
applyStatic(document);
let swVersion=null;
const missing=[];
onMissing((key)=>{if(missing.length<200){missing.push(key);record('i18n.missing',[...missing]);}});


for(const e of window.__gslBoot?.errors??[])errors.report(Object.assign(new Error(e.message),{stack:e.stack}),{where:'boot',silent:true});

let depsP=null;
let controllerP=null;
let roots={};
const app={
store,nav,deps,record,localDiag,repo:null,current:null,updater:null,
version:()=>build.APP_VERSION??swVersion??'unbuilt',
build:Object.freeze({version:build.APP_VERSION,semver:build.APP_SEMVER,id:build.APP_BUILD,devResearch:build.DEV_RESEARCH,bundledEventModel:build.BUNDLED_EVENT_MODEL}),
settings:()=>settings,
updateSettings:(s)=>{settings=s;applyTheme(s?.theme);applyDataTheme(s?.theme,roots);},
drill:createDrillState(),
e2e:createE2EStates(),
vision:null,

t,
toast,
units:()=>settings?.units??DEFAULT_UNITS,
locale:()=>getLocale(),
screenTitle:(id)=>t(`screen.${id}.title`),
applyTheme,

offline:{ready:()=>false,progress:()=>({done:0,total:0,bytes:0}),onProgress:()=>()=>{}},
errors,

ready:()=>Promise.all([depsP??loadLate(),controllerP]).then(()=>app),
};


let vcReady=null;
async function pushEventModel(vc){
vcReady=vc;
if(typeof vc?.setModel!=='function')return;
try{
const{activeEventModel}=await import('./session/models.js');
const m=await activeEventModel(app.repo);
const r=await vc.setModel(m?m.json:null,m?m.bin:null);
record('events.model',{source:m?'imported':'default',version:m?.version??null,ok:r?.ok??null});
}catch(e){
record('events.model',{source:'error',error:String(e?.message??e)});
}
}
app.applyEventModel=async()=>{if(vcReady)await pushEventModel(vcReady);};
const bindVision=()=>{
if(!deps.visionClient?.createVisionClient||app.vision)return;
let vcP=null;
app.vision=()=>{
if(!vcP){
vcP=(async()=>{
const vc=deps.visionClient.createVisionClient({delegate:'GPU',models:['lite']});
await vc.init();
await pushEventModel(vc);
return vc;
})();
vcP.catch(()=>{vcP=null;});
}
return vcP;
};
};


if(globalThis.__GSL_E2E__&&typeof globalThis.__GSL_E2E__==='object')globalThis.__GSL_E2E__.app=app;


const unsaved=readUnsavedFlag();
if(unsaved){
record('store.error','unsaved mode (chosen on the start-up error screen)');
}else{
try{
app.repo=await withTimeout(openRepository(idbBackend()),REPO_TIMEOUT_MS,'REPO_UNAVAILABLE');
store.set({repoReady:true});
}catch(e){
app.repo=null;
record('store.error',String(e?.message??e));
errors.report(Object.assign(new Error(String(e?.message??e)),{code:'REPO_UNAVAILABLE'}),{where:'boot',silent:true});
}
}


const ctl={real:null};
let resolveCtl;
controllerP=new Promise((r)=>{resolveCtl=r;});
app.controller=new Proxy({},{
get(_,k){
if(ctl.real){const v=ctl.real[k];return typeof v==='function'?v.bind(ctl.real):v;}
if(k==='then')return undefined;
return(...a)=>controllerP.then((c)=>(typeof c[k]==='function'?c[k](...a):c[k]));
},
});
async function loadController(){
try{
const{createSessionController}=await import('./session/controller.js');
ctl.real=createSessionController({store,repo:app.repo,deps,record,appVersion:()=>app.version()});
}catch(e){
errors.report(e,{where:'boot.controller',silent:true});
ctl.real=null;
}
resolveCtl(ctl.real);
return ctl.real;
}
function loadLate(){
if(!depsP){
depsP=loadOptional(deps).then((d)=>{bindVision();return d;});
loadController();
}
return depsP;
}


roots=Object.fromEntries(ALL_SCREENS.map((id)=>[id,document.querySelector(`[data-screen="${id}"]`)]));
applyDataTheme(settings.theme,roots);
const screens={};
const mounting={};
function unavailable(root,id){
root.replaceChildren();
const h1=document.createElement('h1');
h1.tabIndex=-1;
h1.textContent=app.screenTitle(id);
const p=document.createElement('p');
p.className='hint';
p.textContent=t('app.screen.unavailable');
const back=document.createElement('button');
back.type='button';
back.className='back btn btn-secondary btn-md';
back.textContent=t('common.back');
back.addEventListener('click',()=>nav.back());
root.append(back,h1,p);
return{show(){}};
}
function ensureScreen(id){
if(screens[id])return Promise.resolve(screens[id]);
if(!mounting[id]){
mounting[id]=(async()=>{
const root=roots[id];
const spec=SCREEN_MODULES[id];
if(!root||!spec)return(screens[id]={show(){}});
if(NEEDS_DEPS.has(id))await app.ready();


if(id!=='home'&&id!=='onboarding')await i18nComplete();
let mod=null;
if(present(spec[0])){
try{mod=await import(spec[0]);}catch(e){errors.report(e,{where:`mount.${id}`,silent:true});}
}
const mount=mod?.[spec[1]]??mod?.default??null;
if(typeof mount!=='function')return(screens[id]=unavailable(root,id));
try{

screens[id]=mount(root,app,{header:true,onBack:()=>nav.back()})??{show(){}};
}catch(e){
errors.report(e,{where:`mount.${id}`});
screens[id]=unavailable(root,id);
}
return screens[id];
})();
}
return mounting[id];
}


let shown=null;
let showSeq=0;
const setTitle=(id)=>{document.title=`${app.screenTitle(id)} – ${t('app.name')}`;};
const openers=[];
const focusScreen=(s,back)=>{
const o=s.restoreFocus??(back?openers[s.stack.length]:null);
const target=o&&o.isConnected&&!o.closest?.('[hidden]')?o:roots[s.screen]?.querySelector('h1');
if(!target)return;
if(target.tagName==='H1'&&!target.hasAttribute('tabindex'))target.setAttribute('tabindex','-1');
try{target.focus({preventScroll:true});}catch(_){ }
};
let prevDepth=0;
let currentTab='practice';
const showScreen=(s)=>{
if(shown===s.screen)return Promise.resolve();
const seq=++showSeq;
const depth=s.stack?.length??0;
const back=depth<prevDepth;
if(depth>prevDepth)openers[depth-1]=document.activeElement;
prevDepth=depth;
screens[shown]?.hide?.();
for(const el of document.querySelectorAll('[data-screen]'))el.hidden=el.dataset.screen!==s.screen;
shown=s.screen;

const stack=document.getElementById('top-stack');
if(stack){if(s.screen==='live'&&settings?.theme!=='sun')stack.dataset.liveTheme='dark';else delete stack.dataset.liveTheme;}
currentTab=tabOf(s.screen,currentTab);
window.scrollTo(0,0);
setTitle(s.screen);
renderTabbar(s);
return ensureScreen(s.screen)
.then((scr)=>(seq===showSeq?scr?.show?.(s.params??{}):null))
.then(()=>{if(seq===showSeq)focusScreen(s,back);},(e)=>errors.report(e,{where:`show.${s.screen}`}));
};

const reshow=(id)=>Promise.resolve(screens[id]?.show?.(store.get().params??{})).then(()=>{
const a=document.activeElement;
if(id===shown&&(!a||a===document.body||!a.isConnected))focusScreen({screen:id,stack:store.get().stack??[],restoreFocus:null},false);
},(e)=>errors.report(e,{where:`show.${id}`}));
onLocaleChange(()=>{
applyStatic(document);
buildTabbar();
if(shown){
setTitle(shown);
reshow(shown);
}
renderBars(store.get());
});


const topStack=document.getElementById('top-stack');
const tabbar=document.getElementById('tabbar');
const rootStyle=document.documentElement.style;
const measure=()=>{
if(topStack){
const visible=[...topStack.children].some((c)=>!c.hidden);
topStack.classList.toggle('has-content',visible);
document.documentElement.classList.toggle('has-topstack',visible);
rootStyle.setProperty('--topbar-h',`${visible?Math.ceil(topStack.getBoundingClientRect().height):0}px`);
}
if(tabbar)rootStyle.setProperty('--tabbar-h',`${tabbar.hidden?0:Math.ceil(tabbar.getBoundingClientRect().height)}px`);
};
if(typeof ResizeObserver==='function'){
const ro=new ResizeObserver(()=>measure());
if(topStack)ro.observe(topStack);
if(tabbar)ro.observe(tabbar);
}


function buildTabbar(){
if(!tabbar)return;
tabbar.replaceChildren(...Object.keys(TABS).map((id)=>{
const b=document.createElement('button');
b.type='button';
b.className='tab';
b.dataset.tab=id;
b.dataset.testid=`tabbar-${id}`;
const label=document.createElement('span');
label.className='tab-label';
label.textContent=t(`nav.tab.${id}`);
b.append(icon(id==='practice'?'target':id),label);
b.addEventListener('click',()=>{
const root=TABS[id];
if(store.get().screen===root){window.scrollTo({top:0,behavior:'smooth'});return;}
nav.root(root);
});
return b;
}));
renderTabbar(store.get());
}
function renderTabbar(s){
if(!tabbar)return;
const onboarding=s.screen==='home'&&roots.home?.classList.contains('is-onboarding');
tabbar.hidden=TABBAR_HIDDEN.includes(s.screen)||!s.booted||Boolean(onboarding);
for(const b of tabbar.querySelectorAll('.tab')){
if(b.dataset.tab===currentTab)b.setAttribute('aria-current','page');
else b.removeAttribute('aria-current');
}
measure();
}


if(roots.home&&typeof MutationObserver==='function')new MutationObserver(()=>renderTabbar(store.get())).observe(roots.home,{attributes:true,attributeFilter:['class']});


const hp=document.getElementById('health-prompts');
const renderHealth=(s)=>{
if(!hp)return;
const list=Array.isArray(s.healthPrompts)?s.healthPrompts:[];
hp.hidden=list.length===0;
const ul=hp.querySelector('.hp-list');
if(ul)ul.replaceChildren(...list.map((p)=>{const li=document.createElement('li');li.className=p.level==='warn'?'warn':'';li.dataset.prompt=p.id;li.textContent=p.text??msg(p.msg??(p.code?p:''));return li;}));
measure();
};
hp?.querySelector('.hp-dismiss')?.addEventListener('click',()=>store.set({healthPrompts:[]}));


const bar=document.getElementById('session-bar');
const banner=document.getElementById('update-banner');
const repoBanner=document.getElementById('repo-banner');
let shotsThisSession=0;


const sessionText=(s)=>{
const own=s.screen==='setup'||s.cameraInterrupted;
if(own&&s.status&&typeof s.status==='object'&&s.status.code)return msg(s.status);
if(own&&typeof s.status==='string'&&s.status)return s.status;
const view=s.session?.view??s.view;
const started=Date.parse(s.session?.started_at??'');
const params={view:has(`view.${view}`)?t(`view.${view}`):'',n:shotsThisSession,elapsed:Number.isFinite(started)?fmtElapsed(Date.now()-started):''};
const text=shotsThisSession>0?t('app.session.practising_n',params):t('app.session.practising',params);
return text.split(' · ').map((x)=>x.trim()).filter(Boolean).join(' · ');
};
const renderBars=(s)=>{
if(bar){
bar.hidden=!s.sessionActive;
const txt=bar.querySelector('.bar-text');
if(txt&&s.sessionActive)txt.textContent=sessionText(s);
const re=bar.querySelector('.bar-reopen');
if(re)re.hidden=!s.cameraInterrupted;
}
if(banner){
banner.hidden=!s.updateAvailable;
banner.textContent=s.updatePending&&s.sessionActive?t('app.update.deferred'):t('app.update.available');
}
if(repoBanner)repoBanner.hidden=!s.booted||s.repoReady;
measure();
};
repoBanner?.querySelector('.repo-reload')?.addEventListener('click',()=>{clearUnsavedFlag();location.reload();});
bar?.querySelector('.bar-reopen')?.addEventListener('click',()=>{
app.controller.reopenCamera().then(()=>screens[shown]?.attachStream?.());
});
let elapsedTimer=null;
store.subscribe((s,prev)=>{
if(s.sessionActive&&!prev.sessionActive)shotsThisSession=0;
if(s.sessionActive&&s.lastShotId&&s.lastShotId!==prev.lastShotId)shotsThisSession++;
if(s.screen!==prev.screen)showScreen(s);
else if(s.params!==prev.params)reshow(s.screen);
renderBars(s);
if(s.healthPrompts!==prev.healthPrompts)renderHealth(s);
if(prev.sessionActive&&!s.sessionActive)app.updater?.sessionEnded();
if(s.sessionActive&&!elapsedTimer)elapsedTimer=setInterval(()=>renderBars(store.get()),15000);
if(!s.sessionActive&&elapsedTimer){clearInterval(elapsedTimer);elapsedTimer=null;}
});
for(const b of document.querySelectorAll('[data-go]'))b.addEventListener('click',()=>nav.go(b.dataset.go));


const sw=navigator.serviceWorker;
if(sw&&location.protocol!=='file:'){
app.updater=createUpdater({store,reload:()=>location.reload()});
if(app.updater.offline)app.offline=app.updater.offline;
banner?.addEventListener('click',()=>{
const r=app.updater.request();
if(r==='deferred')banner.textContent=t('app.update.deferred');
});
sw.addEventListener('message',(ev)=>{
if(ev.data?.type==='VERSION'){swVersion=ev.data.version;record('app_version',swVersion);record('precache_complete',ev.data.precache_complete??null);}
});
}
record('standalone',Boolean(matchMedia?.('(display-mode: standalone)').matches||navigator.standalone));
record('build',{version:build.APP_VERSION,dev_research:build.DEV_RESEARCH,bundled_event_model:build.BUNDLED_EVENT_MODEL});

store.set({booted:true});
buildTabbar();
await showScreen(store.get());
renderBars(store.get());
if(window.__gslBoot?.shown){
window.__gslBoot.recover?.();
for(const el of document.querySelectorAll('[data-screen]'))el.hidden=el.dataset.screen!==shown;
renderTabbar(store.get());
}
const ready=document.createElement('div');
ready.id='app-ready';
ready.hidden=true;
ready.dataset.repo=app.repo?'1':'0';
document.body.append(ready);


loadLate();

if(app.repo&&typeof app.repo.migrateBatch==='function'){
const step=()=>app.repo.migrateBatch().then((r)=>{
record('store.migrate',r);
if(r.migrated>0&&r.remaining>0)setTimeout(step,MIGRATE_PAUSE_MS);
}).catch((e)=>record('store.migrate_error',String(e?.message??e)));
setTimeout(step,MIGRATE_PAUSE_MS);
}
import('./store/quota.js').then(({requestPersist})=>requestPersist(navigator)).then((r)=>{
record('storage.persisted',r.persisted);
record('storage.usage',r.usage);
record('storage.quota',r.quota);
}).catch((e)=>record('storage.error',String(e?.message??e)));
if(app.updater){
sw.register('./sw.js',{scope:'./'}).then((reg)=>{
app.updater.attach(reg,sw);
record('sw_registered',true);
const ask=()=>sw.controller?.postMessage({type:'GET_VERSION'});
ask();
sw.addEventListener('controllerchange',ask);
}).catch((e)=>record('sw_error',String(e?.message??e)));
}
return app;
}

boot().catch((e)=>{
try{window.__gslBoot?.fail?.('error',e);}catch(_){ }
const el=document.getElementById('boot-error');
if(el&&el.hidden){el.hidden=false;el.textContent=`${has('app.boot.failed.title')?t('app.boot.failed.title'):'App'}: ${e?.code??'INTERNAL'}`;}
const ready=document.createElement('div');
ready.id='app-ready';
ready.hidden=true;
ready.dataset.error='1';
document.body.append(ready);
});
