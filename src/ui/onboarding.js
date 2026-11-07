











import{h,clear}from'./dom.js';
import{button,segmented,chipRow,icon,notice}from'./components.js';
import{t,setLocale,getLocale}from'../i18n/index.js';
import{parseInput,fmtQuantity}from'../i18n/units.js';
import{CLUBS,saveSettings}from'../session/settings.js';

export const ONBOARDING_VERSION=1;
export const ONB_STEPS=Object.freeze(['welcome','need','install','you','permissions','first']);

export function onboardingSteps({standalone=false}={}){
return ONB_STEPS.filter((s)=>!(s==='install'&&standalone));
}

export function needsOnboarding(settings,{webdriver=false,seam=false,force=false}={}){
if(force)return true;
if(webdriver&&!seam)return false;
return!((settings?.onboarding?.done_v??0)>=ONBOARDING_VERSION);
}

export function classifyCameraError(name){
const n=String(name??'');
if(/NotAllowed|Security|Permission/i.test(n))return'denied';
if(/NotReadable|TrackStart|Abort|InUse|Busy/i.test(n))return'busy';
if(/NotFound|DevicesNotFound|Overconstrained|NotSupported|NoCamera|Missing/i.test(n))return'missing';
return n?'denied':'unsupported';
}

export function isStandalone(env=globalThis){
try{return Boolean(env.matchMedia?.('(display-mode: standalone)')?.matches||env.navigator?.standalone);}catch(_){return false;}
}

export function isIOS(env=globalThis){
const n=env.navigator??{};
return/iPhone|iPad|iPod/.test(n.userAgent??'')||(n.platform==='MacIntel'&&n.maxTouchPoints>1);
}

const settle=(p)=>Promise.resolve(p).then((value)=>({ok:true,value}),(reason)=>({ok:false,reason}));

export function requestPermissionsOnce(env=globalThis){
const nav=env.navigator;
const D=env.DeviceMotionEvent;
let motionP;
try{motionP=typeof D?.requestPermission==='function'?D.requestPermission():Promise.resolve(D?'granted':'unsupported');}catch(e){motionP=Promise.reject(e);}
const md=nav?.mediaDevices;
let camP;
try{camP=md?.getUserMedia?md.getUserMedia({video:{facingMode:'environment'},audio:true}):Promise.reject(Object.assign(new Error('no camera API'),{name:'NotFoundError'}));}catch(e){camP=Promise.reject(e);}
const stop=(s)=>{try{for(const tr of s?.getTracks?.()??[])tr.stop();}catch(_){ }};
return Promise.all([settle(motionP),settle(camP)]).then(async([m,c])=>{
const motion=!m.ok?'denied':m.value==='granted'?'granted':m.value==='unsupported'?'unsupported':'denied';
if(c.ok){
const mic=(c.value?.getAudioTracks?.()??[]).length?'granted':'denied';
stop(c.value);
return{camera:'granted',microphone:mic,motion};
}
const camera=md?.getUserMedia?classifyCameraError(c.reason?.name):'unsupported';

if(camera==='denied'&&md?.getUserMedia){
const v=await settle(md.getUserMedia({video:true}));
if(v.ok){stop(v.value);return{camera:'granted',microphone:'denied',motion};}
}
return{camera,microphone:camera==='granted'?'denied':camera,motion};
});
}

export function createOnboarding(app,{onDone=()=>{}}={}){
let idx=0;
let perms=null;
let asking=false;
let offOffline=null;
const standalone=isStandalone();
const steps=onboardingSteps({standalone});
const save=(patch)=>{const s=saveSettings(patch);app.updateSettings?.(s);return s;};

function finish(mode,dest='home'){
offOffline?.();
offOffline=null;
save({onboarding:{done_v:ONBOARDING_VERSION},...(mode?{mode}:{})});
app.record?.('onboarding.done',{v:ONBOARDING_VERSION,step:steps[idx],mode:mode??null});
idx=0;
onDone(mode,dest);
}

function go(d,root){
idx=Math.max(0,Math.min(steps.length-1,idx+d));
render(root);
root.querySelector('h1')?.focus?.({preventScroll:true});
globalThis.scrollTo?.(0,0);
}

function frame(root,step,{title,body,content,primary,secondary,iconName}){
const n=steps.indexOf(step)+1;
const dots=h('ol.onb-dots',{'aria-label':t('onboarding.progress',{n,total:steps.length})},
steps.map((s,i)=>h('li',{class:i<n-1?'done':i===n-1?'current':''})));
const skip=step==='first'?null:button({label:t('onboarding.skip'),variant:'plain',size:'md',testid:'onb-skip',onClick:()=>finish(null)});
const back=idx>0?button({label:t('common.back'),variant:'plain',size:'md',icon:'chevron-left',onClick:()=>go(-1,root)}):h('span');
clear(root,
h('div.onboarding',{'data-step':step},
h('div.onb-top',{},back,dots,skip??h('span')),
h('div.onb-body',{},
iconName?h('div.onb-icon',{},icon(iconName)):null,
h('h1',{tabindex:'-1'},title),
body?h('p.onb-lead',body):null,
content),
h('div.onb-actions',{},primary,secondary)));
}

function next(label,root,testid='onb-next'){
return button({label:label??t('common.next'),variant:'primary',size:'lg',block:true,testid,onClick:()=>go(1,root)});
}

function bullets(keys){
return h('ul.onb-list',{},keys.map(([ic,k])=>h('li',{},h('span.onb-li-icon',{},icon(ic)),h('span',t(k)))));
}

function renderWelcome(root){
frame(root,'welcome',{
iconName:'target',title:t('onboarding.welcome.title'),body:t('onboarding.welcome.body'),
content:bullets([['play','onboarding.welcome.p1'],['film','onboarding.welcome.p2'],['shield','onboarding.welcome.p3']]),
primary:next(t('onboarding.welcome.cta'),root),
});
}

function renderNeed(root){
frame(root,'need',{
iconName:'tripod',title:t('onboarding.need.title'),body:t('onboarding.need.body'),
content:h('div',{},
bullets([['tripod','onboarding.need.tripod'],['ruler','onboarding.need.tape'],['phone-landscape','onboarding.need.remote']]),
button({label:t('onboarding.need.no_tripod'),variant:'plain',size:'md',icon:'film',testid:'onb-no-tripod',onClick:()=>finish('highspeed','import')})),
primary:next(null,root),
});
}

function renderInstall(root){
const off=app.offline??{ready:()=>false,progress:()=>({done:0,total:0,bytes:0})};
const bar=h('progress.onb-progress',{max:1,value:0,'aria-label':t('onboarding.install.offline_label')});
const line=h('p.onb-meta',{'aria-live':'polite'});
const paint=()=>{
const p=off.progress?.()??{done:0,total:0};
const ready=off.ready?.()===true;
bar.value=ready?1:p.total?p.done/p.total:0;
bar.hidden=!ready&&!p.total;
line.textContent=ready?t('onboarding.install.offline_ready'):p.total?t('onboarding.install.offline_progress',{pct:Math.round((100*p.done)/p.total)}):t('onboarding.install.offline_unknown');
};
paint();
offOffline?.();
offOffline=off.onProgress?.(paint)??null;
const ios=isIOS();
const stepsList=ios
?h('ol.onb-steps',{},h('li',{},h('span.onb-li-icon',{},icon('share')),h('span',t('onboarding.install.ios1'))),h('li',{},h('span.onb-li-icon',{},icon('download')),h('span',t('onboarding.install.ios2'))),h('li',{},h('span.onb-li-icon',{},icon('check')),h('span',t('onboarding.install.ios3'))))
:h('ol.onb-steps',{},h('li',{},h('span.onb-li-icon',{},icon('download')),h('span',t('onboarding.install.other1'))),h('li',{},h('span.onb-li-icon',{},icon('check')),h('span',t('onboarding.install.other2'))));
frame(root,'install',{
iconName:'download',title:t('onboarding.install.title'),body:t('onboarding.install.body'),
content:h('div',{},stepsList,notice({variant:'caution',title:t('onboarding.install.evict_title'),body:t('onboarding.install.evict_body')}),h('div.onb-offline',{},bar,line)),
primary:next(null,root),
});
}

function renderYou(root){
const st=app.settings();
const units=st.units??{};
const hand=segmented({label:t('onboarding.you.hand'),options:[['right',t('onboarding.you.hand_right')],['left',t('onboarding.you.hand_left')]],value:st.handedness,onChange:(v)=>save({handedness:v})});
const hUnit=units.height==='ftin'?'ftin':'cm';
const cur=fmtQuantity(st.height_m,'height',units,{digits:0}).value;
const heightIn=h('input',{type:'text',inputmode:hUnit==='cm'?'numeric':'text',id:'onb-height',value:hUnit==='cm'?String(Math.round(st.height_m*100)):cur,autocomplete:'off','aria-describedby':'onb-height-hint'});
const hHint=h('span.hint',{id:'onb-height-hint'},t(hUnit==='cm'?'onboarding.you.height_hint_cm':'onboarding.you.height_hint_ftin'));
heightIn.addEventListener('change',()=>{
const si=parseInput(heightIn.value,hUnit==='cm'?'cm':'ftin');
if(Number.isFinite(si)&&si>1.0&&si<2.3){save({height_m:+si.toFixed(3)});hHint.textContent=t(hUnit==='cm'?'onboarding.you.height_hint_cm':'onboarding.you.height_hint_ftin');hHint.classList.remove('bad');}else{hHint.textContent=t('onboarding.you.height_bad');hHint.classList.add('bad');}
});
const club=chipRow({label:t('onboarding.you.club'),items:CLUBS.map(([c])=>[c,t(`club.${c}`)]),value:st.club_type,onChange:(v)=>{const c=CLUBS.find((x)=>x[0]===v);save({club_type:v,club_length_m:c[1]});}});
const sys=units.distance==='m'?'metric':'imperial';
const unitSeg=segmented({label:t('onboarding.you.units'),options:[['imperial',t('onboarding.you.units_imperial')],['metric',t('onboarding.you.units_metric')]],value:sys,onChange:(v)=>save({units:v==='metric'?{distance:'m',speed:'m/s'}:{distance:'yd',speed:'mph'}})});
const lang=segmented({label:t('onboarding.you.language'),options:[['zh-Hant',t('onboarding.you.lang_zh')],['en',t('onboarding.you.lang_en')]],value:getLocale(),onChange:(v)=>{save({locale:v});setLocale(v).catch(()=>{});}});
const group=(labelKey,ctl,extra)=>h('div.onb-field',{},h('span.field-label',t(labelKey)),ctl,extra);
globalThis.requestAnimationFrame?.(()=>{
const on=club.querySelector?.('[aria-checked="true"]');
if(!on||!club.scrollTo)return;
const dx=on.getBoundingClientRect().left-club.getBoundingClientRect().left;
club.scrollTo({left:Math.max(0,club.scrollLeft+dx-(club.clientWidth-on.offsetWidth)/2)});
});
frame(root,'you',{
iconName:'club',title:t('onboarding.you.title'),body:t('onboarding.you.body'),
content:h('div.onb-form',{},
group('onboarding.you.hand',hand),
h('label.onb-field',{for:'onb-height'},h('span.field-label',t('onboarding.you.height')),heightIn,hHint),
group('onboarding.you.club',club),
group('onboarding.you.units',unitSeg),
group('onboarding.you.language',lang)),
primary:next(null,root),
});
}

function permRow(kind,state){
const s=state??'unknown';
const glyph={granted:'check',unknown:kind==='camera'?'camera':kind==='microphone'?'mic-off':'level'}[s]??'alert';
const what=h('span.perm-text',{},
h('span.perm-title',t(`onboarding.perm.${kind}`)),
h('span.perm-why',t(`onboarding.perm.${kind}_why`)),
s==='unknown'?null:h('span',{class:`perm-state perm-${s==='granted'?'ok':'bad'}`,'data-state':s},t(`onboarding.perm.state_${s}`)),
s!=='unknown'&&s!=='granted'?h('span.perm-fix',t(`onboarding.perm.${kind}_fix_${s==='unsupported'?'unsupported':s==='denied'?'denied':'busy'}`)):null);
return h('li',{class:'perm-row','data-perm':kind,'data-state':s},h('span',{class:`perm-icon perm-${s}`},icon(glyph)),what);
}

function renderPermissions(root){
const rows=h('ul.perm-list',{},['camera','microphone','motion'].map((k)=>permRow(k,perms?.[k])));
const allow=button({
label:perms?t('onboarding.perm.again'):t('onboarding.perm.allow'),variant:perms?'secondary':'primary',size:'lg',block:true,testid:'onb-allow',icon:'camera',
onClick:()=>{
if(asking)return;
asking=true;

const p=typeof app.controller?.requestPermissions==='function'?app.controller.requestPermissions():requestPermissionsOnce();
allow.setLabel(t('onboarding.perm.asking'));
Promise.resolve(p).then((r)=>{
perms={camera:r?.camera??'unknown',microphone:r?.microphone??'unknown',motion:r?.motion==='unavailable'?'unsupported':(r?.motion??'unknown')};
app.record?.('onboarding.permissions',perms);
},()=>{perms={camera:'denied',microphone:'denied',motion:'denied'};}).finally(()=>{asking=false;render(root);});
},
});
const cont=perms?next(t('common.continue'),root):button({label:t('onboarding.perm.later'),variant:'plain',size:'lg',block:true,testid:'onb-next',onClick:()=>go(1,root)});
frame(root,'permissions',{
iconName:'lock',title:t('onboarding.perm.title'),body:t('onboarding.perm.body'),
content:h('div',{},rows,perms?h('p.onb-meta',{role:'status'},t(perms.camera==='granted'?'onboarding.perm.result_ok':'onboarding.perm.result_camera_off')):null),
primary:perms?cont:allow,
secondary:perms?allow:cont,
});
}

function choice(mode,root){
const b=h('button.onb-choice',{type:'button','data-testid':`onb-mode-${mode}`,'data-mode':mode,onclick:()=>finish(mode)},
h('span.onb-choice-icon',{},icon(mode==='live'?'play':'film')),
h('span.onb-choice-text',{},
h('span.onb-choice-title',t(`onboarding.first.${mode}_title`)),
h('span.onb-choice-body',t(`onboarding.first.${mode}_body`)),
h('span.onb-choice-gets',t(`onboarding.first.${mode}_gets`))),
h('span.lr-chevron',{},icon('chevron-right')));
return b;
}

function renderFirst(root){
frame(root,'first',{
iconName:'flag',title:t('onboarding.first.title'),body:t('onboarding.first.body'),
content:h('div.onb-choices',{},choice('live',root),choice('highspeed',root)),
primary:button({label:t('onboarding.first.later'),variant:'plain',size:'lg',block:true,testid:'onb-next',onClick:()=>finish(null)}),
});
}

function render(root){
const step=steps[idx];
if(step!=='install'){offOffline?.();offOffline=null;}
({welcome:renderWelcome,need:renderNeed,install:renderInstall,you:renderYou,permissions:renderPermissions,first:renderFirst})[step](root);
}

return{render,reset(){idx=0;perms=null;},step:()=>steps[idx],steps};
}
