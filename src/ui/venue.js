




import{h,clear}from'./dom.js';
import{button,screenHeader,notice,segmented}from'./components.js';
import{t,fmtNum}from'../i18n/index.js';
import{parseInput,convert,unitLabel}from'../i18n/units.js';
import{bayAdvice,twoMeasureCheck}from'../session/bay.js';
import{flatSlope,lowPassStep}from'../calib/gravity.js';
import{newId,nowIso}from'../session/ids.js';
import{startMotion}from'./sensors.js';
import{mountVenues}from'./venues.js';

const TOL_MM=3;

export const VENUE_STEPS=Object.freeze(['length','width','ball','bay','finish']);
const SVGNS='http://www.w3.org/2000/svg';


function stepDiagram(step){
const el=(tag,a={})=>{const e=document.createElementNS(SVGNS,tag);for(const[k,v]of Object.entries(a))e.setAttribute(k,String(v));return e;};
const svg=el('svg',{viewBox:'0 0 240 120',class:'venue-diagram','aria-hidden':'true'});
svg.append(el('rect',{x:60,y:22,width:120,height:70,rx:3,class:'vd-mat'}));
svg.append(el('circle',{cx:120,cy:74,r:4,class:'vd-ball'}));
const dim=(x1,y1,x2,y2)=>{svg.append(el('line',{x1,y1,x2,y2,class:'vd-dim'}));for(const[x,y]of[[x1,y1],[x2,y2]])svg.append(el('circle',{cx:x,cy:y,r:3,class:'vd-end'}));};
if(step==='length')dim(60,104,180,104);
if(step==='width')dim(196,22,196,92);
if(step==='ball')dim(120,74,120,92);
if(step==='bay'){svg.append(el('rect',{x:210,y:8,width:6,height:100,class:'vd-wall'}));dim(124,74,210,74);}
if(step==='finish'){svg.append(el('rect',{x:100,y:46,width:26,height:44,rx:4,class:'vd-phone'}));svg.append(el('line',{x1:92,y1:98,x2:148,y2:88,class:'vd-dim'}));}
svg.append(el('path',{d:'M196 112 l14 0 m-5 -4 l5 4 l-5 4',class:'vd-target'}));
return svg;
}

export function mountVenue(root,app){
let idx=0;
let draft=null;
let stopMotion=null;
let list=null;

const bodyUnit=()=>(app.units().body==='in'?'in':'cm');
const bayUnit=()=>(app.units().body==='in'?'ft':'m');

const smallLen=(mm)=>{
const su=app.units().body==='in'?'in':'cm';
return`${fmtNum(convert(mm/1000,'m',su),{digits:su==='in'?2:1})} ${unitLabel(su)}`;
};
const toUnit=(si,u)=>(Number.isFinite(si)?fmtNum(convert(si,'m',u),{digits:u==='cm'||u==='in'?1:2}).replace(/[,\s]/g,''):'');

function fresh(v=null){
return v
?{venue_id:v.venue_id,name:v.name??'',L1:v.mat_L,L2:v.mat_L,W1:v.mat_W,W2:v.mat_W,edge:v.ball_edge_m??null,B:v.bay_B_m??null,slope:v.slope_deg??null,slopeDir:v.slope_dir_deg??null,tee:v.tee_lift_m??null,editing:v}
:{name:'',L1:null,L2:null,W1:null,W2:null,edge:null,B:null,slope:null,slopeDir:null,tee:null,editing:null};
}


function measure({id,label,unit,si,onValue,hint,placeholder}){
const input=h('input',{type:'text',inputmode:'decimal',id,autocomplete:'off',value:toUnit(si,unit),placeholder:placeholder??'','aria-describedby':hint?`${id}-hint`:null});
input.addEventListener('input',()=>onValue(parseInput(input.value,unit)));
return h('div.field.measure',{},
h('label.field-label',{for:id},label),
h('div.input-suffix',{},input,h('span.suffix',{'aria-hidden':'true'},unitLabel(unit))),
hint?h('span.hint',{id:`${id}-hint`},hint):null);
}

function pairCheck(a,b,out){
const r=twoMeasureCheck(a,b,TOL_MM);
if(r.diff_mm===null){out.className='check';out.textContent=Number.isFinite(a)?t('venue.pair.need_second'):t('venue.pair.need_two');return r;}
out.className=`check ${r.ok?'ok':'bad'}`;
out.textContent=t(r.ok?'venue.pair.ok':'venue.pair.bad',{d:smallLen(r.diff_mm),tol:smallLen(TOL_MM)});
return r;
}

function frame(step,content,{primaryLabel,reason,onPrimary,secondary}={}){
const n=idx+1;
const title=draft.editing?t('venue.title_edit'):t('venue.title_new');
const primary=button({label:primaryLabel??t('common.next'),variant:'primary',size:'lg',block:true,testid:'venue-primary',reason,onClick:onPrimary??(()=>go(1))});
clear(root,
screenHeader({title,back:true,onBack:()=>(idx>0?go(-1):app.nav.back())}),
h('div.venue-step',{'data-testid':'venue-step','data-step':step},
h('p.step-count',t('venue.step_count',{n,total:VENUE_STEPS.length})),
h('h2.step-title',t(`venue.${step}.title`)),
stepDiagram(step),
h('p.step-body',t(`venue.${step}.body`,{tol:smallLen(TOL_MM)})),
content),
h('div.step-cta',{},secondary??null,primary));
return primary;
}

function go(d){
stopMotion?.();
stopMotion=null;
idx=Math.max(0,Math.min(VENUE_STEPS.length-1,idx+d));
render();
root.querySelector('.step-title')?.focus?.();
}

function renderPair(step){
const isL=step==='length';
const k1=isL?'L1':'W1';
const k2=isL?'L2':'W2';
const out=h('p.check',{role:'status'});
let primary=null;
const update=()=>{
const r=pairCheck(draft[k1],draft[k2],out);
const bad=!(r.ok);
const range=r.mean!==null&&!(r.mean>0.5&&r.mean<4);
primary?.setReason(range?t('venue.reason.range'):bad?(r.diff_mm===null?t('venue.reason.two'):t('venue.reason.mismatch')):null);
};
const u=bodyUnit();
const content=h('div.grid2',{},
measure({id:`venue-${k1}`,label:t('venue.pair.first'),unit:u,si:draft[k1],onValue:(v)=>{draft[k1]=v;update();}}),
measure({id:`venue-${k2}`,label:t('venue.pair.second'),unit:u,si:draft[k2],onValue:(v)=>{draft[k2]=v;update();}}));
primary=frame(step,h('div',{},content,out));
update();
}

function renderBall(){
const u=bodyUnit();
let primary=null;
const update=()=>primary?.setReason(draft.edge!==null&&!(draft.edge>0.05&&draft.edge<Math.max(0.2,(draft.W1??2)-0.05))?t('venue.reason.edge'):null);
const content=measure({id:'venue-edge',label:t('venue.ball.label'),unit:u,si:draft.edge,placeholder:toUnit(0.3,u),hint:t('venue.ball.hint',{v:toUnit(0.3,u),unit:unitLabel(u)}),onValue:(v)=>{draft.edge=v;update();}});
primary=frame('ball',content);
update();
}

function renderBay(){
const u=bayUnit();
const out=h('div.bay-verdict',{role:'status'});
let primary=null;
const paint=()=>{
primary?.setLabel(draft.B===null?t('venue.bay.skip'):t('common.next'));
const a=bayAdvice(draft.B);
primary?.setReason(draft.B!==null&&!a.ok?t('venue.reason.bay'):null);
if(!a.ok){clear(out,draft.B===null?h('p.hint',t('venue.bay.skip_hint')):h('p.check.bad',t('venue.reason.bay')));return;}
const fmt=(m)=>`${toUnit(m,u)} ${unitLabel(u)}`;
clear(out,h('div',{class:`verdict-card verdict-${a.verdict}`},
h('p.verdict-title',t(`bay.verdict.${a.verdict}`)),
h('p.verdict-body',t(`bay.body.${a.verdict}`,{D:fmt(a.D_m),h:fmt(a.h_max_m),shift:fmt(a.shift_m)}))));
};
const content=h('div',{},
measure({id:'venue-B',label:t('venue.bay.label'),unit:u,si:draft.B,hint:t('venue.bay.hint'),onValue:(v)=>{draft.B=v;paint();}}),
out);
primary=frame('bay',content,{primaryLabel:draft.B===null?t('venue.bay.skip'):t('common.next')});
paint();
}

function slopeBlock(){

const out=h('span',{role:'status',class:Number.isFinite(draft.slope)?'badge ok':'badge','data-testid':'venue-slope-status'},Number.isFinite(draft.slope)?t('venue.slope.value',{deg:fmtNum(draft.slope,{digits:2})}):t('venue.slope.none'));
const manual=h('input',{type:'text',inputmode:'decimal',id:'venue-slope',value:Number.isFinite(draft.slope)?String(draft.slope):'',autocomplete:'off'});
manual.addEventListener('input',()=>{const x=parseInput(manual.value,'deg');draft.slope=Number.isFinite(x)&&Math.abs(x)<15?x:null;draft.slopeDir=null;});
const measureBtn=button({
label:t('venue.slope.measure'),variant:'tinted',size:'lg',block:true,icon:'level',
onClick:()=>{

let lp=null;
const hist=[];
out.className='badge';
out.textContent=t('venue.slope.measuring');
stopMotion?.();
stopMotion=startMotion(app,(acc,t_s)=>{
lp=lowPassStep(lp,acc,t_s,0.3);
const fs=flatSlope(lp.value);
if(!fs)return;
hist.push({t_s,...fs});
while(hist.length&&hist[0].t_s<t_s-3)hist.shift();
const span=hist.length?t_s-hist[0].t_s:0;
const vals=hist.map((x)=>x.slope_deg);
const spread=Math.max(...vals)-Math.min(...vals);
if(span>=2.9&&spread<=0.2){
draft.slope=fs.slope_deg;
draft.slopeDir=fs.dir_deg;
manual.value=fmtNum(fs.slope_deg,{digits:2});
out.className='badge ok';
out.textContent=t('venue.slope.done',{deg:fmtNum(fs.slope_deg,{digits:2}),pm:fmtNum(spread/2,{digits:2})});
stopMotion?.();
stopMotion=null;
}else{
out.textContent=t('venue.slope.progress',{deg:fmtNum(fs.slope_deg,{digits:2}),pm:fmtNum(spread/2,{digits:2})});
}
},()=>{out.className='badge warn';out.textContent=t('venue.slope.unavailable');});
},
});
return h('div.optional-block',{},
h('h3',t('venue.slope.title')),h('p.hint',t('venue.slope.hint')),measureBtn,h('p.slope-status',{},out),
h('div.field.measure',{},h('label.field-label',{for:'venue-slope'},t('venue.slope.manual')),h('div.input-suffix',{},manual,h('span.suffix',{'aria-hidden':'true'},'°'))));
}

function renderFinish(){
const name=h('input',{type:'text',id:'venue-name',value:draft.name,placeholder:t('venue.name.placeholder'),autocomplete:'off',maxlength:60});
name.addEventListener('input',()=>{draft.name=name.value;});
const teeU=app.units().body==='in'?'in':'cm';
const tee=segmented({label:t('venue.tee.title'),options:[['none',t('venue.tee.none')],['rubber',t('venue.tee.rubber')],['custom',t('venue.tee.custom')]],value:draft.tee===null?'none':Math.abs(draft.tee-0.03)<1e-6?'rubber':'custom',onChange:(v)=>{draft.tee=v==='none'?null:v==='rubber'?0.03:(draft.tee??0.03);paintTee();}});
const teeBox=h('div');
const paintTee=()=>{
const custom=draft.tee!==null&&Math.abs(draft.tee-0.03)>=1e-6;
clear(teeBox,custom||(draft.tee!==null&&tee.value==='custom')?measure({id:'venue-tee',label:t('venue.tee.height'),unit:teeU,si:draft.tee,onValue:(v)=>{draft.tee=Number.isFinite(v)&&v>=0&&v<0.1?v:null;}}):null);
};
paintTee();
const content=h('div',{},
h('div.field',{},h('label.field-label',{for:'venue-name'},t('venue.name.label')),name),
slopeBlock(),
h('div.optional-block',{},h('h3',t('venue.tee.title')),h('p.hint',t('venue.tee.hint')),tee,teeBox),
notice({variant:'info',title:t('venue.flock.title'),body:t('venue.flock.body')}));
frame('finish',content,{primaryLabel:t('venue.save'),onPrimary:()=>saveVenue()});
}

async function saveVenue(){
const l=twoMeasureCheck(draft.L1,draft.L2);
const w=twoMeasureCheck(draft.W1,draft.W2);
if(!l.ok||!w.ok){idx=l.ok?1:0;render();return;}
const adv=bayAdvice(draft.B);
const base=draft.editing??{venue_id:newId('venue'),created_at:nowIso(),f_locked:null,f_W:null,f_H:null,f_sd_pct:null,f_view:'face_on',f_solves:[]};
const matChanged=draft.editing&&(Math.abs(draft.editing.mat_L-l.mean)>1e-4||Math.abs(draft.editing.mat_W-w.mean)>1e-4);
const venue={
...base,
name:draft.name.trim()||t('venue.name.default'),
mat_L:+l.mean.toFixed(4),mat_W:+w.mean.toFixed(4),ball_edge_m:Number.isFinite(draft.edge)?+draft.edge.toFixed(4):0.3,ball_x_m:base.ball_x_m??0,
slope_deg:Number.isFinite(draft.slope)?draft.slope:null,slope_dir_deg:draft.slopeDir??null,
tee_lift_m:Number.isFinite(draft.tee)?draft.tee:null,
bay_B_m:adv.ok?adv.B_m:null,bay_verdict:adv.ok?adv.verdict:null,
updated_at:nowIso(),
};
if(matChanged)Object.assign(venue,{f_locked:null,f_W:null,f_H:null,f_sd_pct:null,f_solves:[]});
if(!app.repo){app.toast.error(t('venue.save_no_repo'));return;}
try{
await app.repo.venues.put(venue);
}catch(e){
app.errors.report(e,{where:'venue.save'});
return;
}
app.store.set({venueId:venue.venue_id,presetId:null});
app.toast.info(draft.editing?t('venue.saved_edit'):t('venue.saved'));
draft=null;
idx=0;
app.nav.back();
}

function render(){
if(!draft)draft=fresh();
const step=VENUE_STEPS[idx];
if(step==='length'||step==='width')renderPair(step);
else if(step==='ball')renderBall();
else if(step==='bay')renderBay();
else renderFinish();
}

return{
async show(params={}){
list?.hide?.();
list=null;
if(params.list){
list=mountVenues(root,app,{header:true});
await list.show();
return;
}
idx=0;
draft=fresh();
if(params.venue_id&&app.repo){
try{const v=await app.repo.venues.get(params.venue_id);if(v)draft=fresh(v);}catch(_){ }
}
render();
},
hide(){stopMotion?.();stopMotion=null;list?.hide?.();},
};
}
