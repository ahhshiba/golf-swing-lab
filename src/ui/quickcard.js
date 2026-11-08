





























import{h,clear}from'./dom.js';
import{validityTag}from'./components.js';
import{t,list,fmtNum}from'../i18n/index.js';
import{fmtMetric}from'../i18n/units.js';
import{RC}from'../contract/reason-codes.js';

const QUICK_IDS=Object.freeze(['tempo_ratio','backswing_s','downswing_s','club_speed_mps','carry_m']);
const CHANGE_MS=2000;
const HERO_N=2;
const RANGE_REL=0.3;





export function honest(metric,units,id){
const f=fmtMetric(metric??null,units,{id});
if(f.value==='—'||!f.ci)return{...f,range:false};
const n=(x)=>Number(String(x).replace(/[^\d.]/g,''))*(/^[−-]/.test(x)?-1:1);
const v=n(f.value),hd=n(f.ci);
if(!Number.isFinite(v)||!(hd>0))return{...f,range:false};
const min=10**-(Number.isInteger(f.digits)?f.digits:2);
const fmt=(x,step,r=Math.round)=>fmtNum(r(x/step)*step,{digits:Math.max(0,Math.round(-Math.log10(step)))});
const st=Math.max(min,10**(Math.floor(Math.log10(hd))-1));

if(hd>RANGE_REL*Math.abs(v))return{...f,range:true,value:fmt(v,st),ci:fmt(hd,st),lo:fmt(v>0?Math.max(0,v-hd):v-hd,st,Math.floor),hi:fmt(v+hd,st,Math.ceil)};
const value=fmt(v,st),ci=fmt(Math.max(st,hd),st);
return{...f,range:false,value,ci,text:f.text.replace(f.value,value).replace(f.ci,ci)};
}


export function quickIds(settingsLive){
const want=Array.isArray(settingsLive?.metrics)&&settingsLive.metrics.length?settingsLive.metrics:['tempo_ratio','club_speed_mps','carry_m'];
const ids=want.filter((id)=>QUICK_IDS.includes(id)).slice(0,3);
return ids.length?ids:['tempo_ratio'];
}

const reduced=()=>{try{return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;}catch(_){return false;}};

export async function attachQuick(el,app,live=()=>({})){
const[{quickEstimate},{createQuickTap}]=await Promise.all([import('../quick/estimate.js'),import('../quick/live.js'),
app.loadStyles?.('quick')?.catch?.(()=>null)]);

const clip=()=>live().clip??{};
const banner=()=>live().banner;

let was=null;
const onQuick=(st,r,n)=>{
const{els:e,n:saved=0}=live();
if(!e?.count||!e?.last)return;
if(st==='drop'){if(was){e.count.textContent=was.count;e.last.textContent=was.last;e.last.classList.toggle('has-shot',was.has);was=null;}return;}
if(st==='provisional'){
was??={count:e.count.textContent,last:e.last.textContent,has:e.last.classList.contains('has-shot')};
e.count.textContent=t('live.count',{n:saved+1});
e.last.textContent=t('quick.pending',{n:saved+1});
}else{
was=null;
e.count.textContent=t('live.count',{n:Math.max(saved,1)});
e.last.textContent=t('live.last.line',{n:Math.max(saved,1),items:n||t('live.last.no_numbers')});
}
e.last.classList.add('has-shot');
};
const card=mountQuickCard(el,app,{focus:()=>live().focus,onQuick});
const paint=(r)=>{
card.provisional(r);
try{banner?.()?.quick(r);}catch(_){ }
return new Promise((res)=>requestAnimationFrame(()=>setTimeout(()=>res(performance.now()),0)));
};
card.tap=createQuickTap({
estimate:quickEstimate,
input:()=>{
const c=clip?.()??{};
return{view:c.view??'face_on',club:c.club??null,handedness:c.handedness??'right',calibration:c.calibration??null,gappingRow:card.gappingRow(c.club),settings:app.settings?.()??{},fps:30};
},
geom:()=>{const c=clip?.()??{};return{calibration:c.calibration??null,handedness:c.handedness??'right'};},
onProvisional:paint,
onDrop:(r)=>{if(card.drop(r))live().empty?.(null);},
mediaNow:()=>live().video?.currentTime,
});
return card;
}

export function mountQuickCard(el,app,{focus,onQuick}={}){
let cur=null;
let stage=null;
let fadeTimer=0;
let rows=null;
const units=()=>app.units?.();

const cardIds=()=>{const f=focus?.();const q=quickIds(app.settings?.().live);return f?[f,...q.filter((x)=>x!==f)].slice(0,3):q;};


(async()=>{
try{
if(!app.repo?.queryShots)return;
const[{gapping},shots]=await Promise.all([import('../store/stats.js'),app.repo.queryShots({reverse:true})]);
rows=gapping((shots??[]).filter((s)=>!s.deleted_at),{});
}catch(_){rows=null;}
})();

function sourceText(r){
if(!r?.carry_source)return null;
return r.carry_source==='pose'&&r.carry_merge?`${t('quick.source.pose')} + ${t('quick.source.gapping')}`:t(`quick.source.${r.carry_source}`);
}



function tile(id,metric,tileStage,extra={},i=0){
const f=honest(metric,units(),id);

const rc=f.value==='—'?(metric?.reason_codes??[]).find((c)=>c!==RC.PROVISIONAL):null;

const none=!metric&&tileStage==='provisional';
const note=extra.note??(none?t('quick.not_quick'):rc?t(`reason.${rc}.short`):null);
const mini=i>=HERO_N;

const validity=metric?.validity??(tileStage==='provisional'?'low_confidence':'not_computed');


const pill=none?null:validityTag(validity);
pill?.setAttribute('aria-hidden','true');

return h('div',{class:mini?'qc-tile qc-mini':'hero-tile qc-tile','data-metric':id,'data-stage':none?'none':tileStage,'data-range':f.range?'1':'0'},
h('span.hero-label',{},h('span.qc-name',{},t(`metric.${id}.label`)),
none?null:h('span.qc-marks',{},pill,h('span.visually-hidden',{},pill.querySelector('.vtag-text')?.textContent??''),h(`span.qc-tag.qc-${tileStage}`,{},t(`quick.${tileStage}`)))),
h('span.hero-value',{},h(mini?'span.qc-num':'span.live-hero-num',{},f.range?`${f.lo}–${f.hi}`:f.value),f.unit&&f.value!=='—'?h('span.hero-unit',{},f.unit):null),
f.ci?h('span.mt-ci',{},f.range?t('quick.mid',{v:f.value}):`± ${f.ci}`):null,
note?h(extra.change?'span.qc-note.qc-change':'span.qc-note',{},note):null);
}
const said=(id,m)=>{const f=honest(m,units(),id);return`${t(`metric.${id}.label`)} ${f.range?t('quick.range_text',{lo:f.lo,hi:f.hi,unit:f.unit}):f.text}`;};



const screenEl=()=>el.closest?.('[data-screen="live"]');
const large=(on)=>screenEl()?.classList.toggle('qc-large',on);
let ro=null;
function checkLarge(){
const c=el.querySelector?.('.quick-card');
let on=false;
try{on=Boolean(c)&&getComputedStyle(c).getPropertyValue('--qc-large').trim()==='1';}catch(_){on=false;}
large(on);
}
function watchLarge(){
checkLarge();
const board=el.closest?.('.live-board');
if(!ro&&board&&typeof ResizeObserver==='function'){ro=new ResizeObserver(()=>checkLarge());ro.observe(board);}
}

function frame(st,r,tiles,summary){
stage=st;
const card=h('div',{
class:'quick-card','data-testid':'quick-card','data-stage':st,'data-t-impact':Number.isFinite(r?.t_impact)?r.t_impact.toFixed(3):'',
role:'group','aria-label':t('quick.name'),
},...tiles,h('span.visually-hidden',{role:'status'},summary));
clear(el,card);
el.closest?.('.live-board')?.classList.add('has-quick');
watchLarge();
return card;
}

function provisional(r){
clearTimeout(fadeTimer);
cur=r;
const ids=cardIds();
const parts=[];
const tiles=ids.map((id,i)=>{
const m=r?.metrics?.[id]??null;
if(Number.isFinite(m?.value))parts.push(said(id,m));
return tile(id,m,'provisional',{note:id==='carry_m'?sourceText(r):null},i);
});
frame('provisional',r,tiles,t('quick.summary',{items:parts.length?list(parts):t('quick.none')}));
onQuick?.('provisional',r);
}

function refined(shot,{quick=undefined,hold=false}={}){

if(quick!==undefined&&cur&&quick!==cur&&stage==='provisional')return false;
const q=quick===undefined?cur:quick;
clearTimeout(fadeTimer);

const ids=cardIds().filter((id)=>Number.isFinite(shot?.metrics?.[id]?.value)||Number.isFinite(q?.metrics?.[id]?.value)||id!=='carry_m');
let changed=0;
const tiles=ids.map((id,i)=>{
const fm=shot?.metrics?.[id]??null;
const qm=q?.metrics?.[id]??null;
if(!Number.isFinite(fm?.value)&&Number.isFinite(qm?.value)){

return tile(id,qm,'provisional',{note:id==='carry_m'?sourceText(q):null},i);
}
const a=Number.isFinite(qm?.value)?honest(qm,units(),id).value:null;
const b=honest(fm,units(),id).value;
const change=a!==null&&b!=='—'&&a!==b;
if(change)changed+=1;
return tile(id,fm,'refined',change?{note:t('quick.change',{from:a,to:b}),change:true}:{},i);
});
const items=list(ids.map((id)=>{const m=Number.isFinite(shot?.metrics?.[id]?.value)?shot.metrics[id]:q?.metrics?.[id];return Number.isFinite(m?.value)?said(id,m):null;}).filter(Boolean));
const card=frame('refined',q,tiles,items);
cur=null;
onQuick?.('refined',q,items);
if(changed&&!hold){
fadeTimer=setTimeout(()=>{
for(const n of card.querySelectorAll('.qc-change')){
if(reduced())n.remove();
else{n.classList.add('is-fading');n.addEventListener('transitionend',()=>n.remove(),{once:true});setTimeout(()=>n.remove(),1000);}
}
},CHANGE_MS);
}
return true;
}

return{
provisional,
refined,
clear(){clearTimeout(fadeTimer);cur=null;stage=null;clear(el);el.closest?.('.live-board')?.classList.remove('has-quick');large(false);},

drop(r){if(!r||r===cur){this.clear();onQuick?.('drop');return true;}return false;},
gappingRow(club){
const type=club&&typeof club==='object'?club.type:club;
const row=rows?.find((x)=>x.club===type);
return row&&row.n>=5?row:null;
},

demo(st){

const club=app.settings?.().club_type??'i7';
const drv=club==='driver';
const m=(value,half,unit,codes,origin='pose')=>({value,unit,ci95:[value-half,value+half],sigma:half/1.96,validity:'low_confidence',value_origin:origin,measured:false,reason_codes:[RC.PROVISIONAL,...codes]});
const r={
stage:'provisional',t_impact:12.345,carry_source:'pose',carry_merge:null,club,view:'face_on',events:null,timings_ms:{compute:0.1},
metrics:{
tempo_ratio:m(3.1,0.45,'ratio',[],'derived'),backswing_s:m(0.84,0.07,'s',[]),downswing_s:m(0.27,0.05,'s',[]),
club_speed_mps:drv?m(41.2,12.1,'m/s',[]):m(33.5,9.6,'m/s',[]),
carry_m:m(drv?188:132,drv?110:78,'m',[RC.SMASH_ASSUMED,RC.LAUNCH_V_ASSUMED,RC.FLIGHT_MODELLED],'flight_model'),
},
};
provisional(r);
if(st==='refined'){
const v=(value,half,unit,validity='valid')=>({value,unit,ci95:[value-half,value+half],sigma:null,validity,value_origin:'pose',measured:false,reason_codes:[]});
refined({metrics:{tempo_ratio:v(3.0,0.25,'ratio'),backswing_s:v(0.83,0.03,'s'),downswing_s:v(0.28,0.03,'s'),club_speed_mps:v(drv?43.4:35.1,drv?10.9:8.8,'m/s','low_confidence'),carry_m:{value:null,unit:'m',ci95:null,sigma:null,validity:'not_computed',value_origin:'ballistics',measured:false,reason_codes:[RC.DEPENDS_ON_NULL]}}},{quick:r,hold:true});
}
},
};
}
