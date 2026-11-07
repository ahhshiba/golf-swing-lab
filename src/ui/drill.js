











import{h,clear}from'./dom.js';
import*as C from'./components.js';
import{t,fmtNum,fmtDate}from'../i18n/index.js';
import{convert,unitLabel,fmtQuantity}from'../i18n/units.js';
import{nowIso}from'../session/ids.js';
import{mulberry32,gauss}from'../geom/rng.js';
import{clubName,viewName}from'./glossary.js';
import{makeDrill,recordShot,practiceOf,progressOf,summaryOf,comparable,templateOf}from'../practice/drills.js';
import{assignClips}from'../practice/assign.js';
import{RC}from'../contract/reason-codes.js';
import{listDrills,templateTitle}from'./drills.js';

const fin=(x)=>typeof x==='number'&&Number.isFinite(x);

function distText(app,m){return fmtQuantity(m,'distance',app.units()).text;}
function missText(app,m){
if(!fin(m))return'—';
const u=app.units().distance;
return`${fmtNum(convert(m,'m',u),{digits:0,sign:true})} ${unitLabel(u)}`;
}

function missPm(app,s){
if(!fin(s.miss_m))return'—';
const u=app.units().distance;
const half=fin(s.carry_sigma)&&s.carry_sigma>0?convert(1.96*s.carry_sigma,'m',u):null;
const v=fmtNum(convert(s.miss_m,'m',u),{digits:0,sign:true});
return half===null?`${v} ${unitLabel(u)}`:`${v} ± ${fmtNum(half,{digits:0})} ${unitLabel(u)}`;
}
const scoreText=(s)=>(fin(s?.score)?t('drill.score_pm',{s:fmtNum(s.score),e:fmtNum(s.score_sigma??0)}):'—');
const estTag=()=>C.validityTag('estimated');

function targetLine(app,s){
return t(s.club?'drill.target_club':'drill.target',{n:s.slot,target:distText(app,s.target_m),club:s.club?clubName(s.club):''});
}


export function drillImportPanel(app,items,{onChange}={}){
const drill=app.drill.current();
if(!drill||drill.status!=='active')return null;
const pending=items.filter((it)=>!['done','error','cancelled'].includes(it.status));
const manual=pending.filter((it)=>it.slotManual);
const auto=pending.filter((it)=>!it.slotManual);
const taken=new Set(manual.map((it)=>it.drillSlot).filter(fin));
const view={...drill,slots:drill.slots.map((s)=>(taken.has(s.slot)?{...s,shot_id:s.shot_id??'taken'}:s))};
for(const a of assignClips(view,auto.map((it)=>({started_at:it.file?.lastModified??null}))))auto[a.clipIndex].drillSlot=a.slot;
const slots=pending.map((it)=>it.drillSlot).filter(fin).sort((a,b)=>a-b);
const extra=pending.filter((it)=>!fin(it.drillSlot)).length;
const contiguous=slots.length>1&&slots.every((x,i)=>i===0||x===slots[i-1]+1);
const what=!slots.length?t('drill.import.maps_none')
:t('drill.import.maps',{slots:contiguous?t('drill.import.range',{a:slots[0],b:slots[slots.length-1]}):slots.join(t('drill.import.sep'))});
const rows=pending.map((it)=>{
const id=`import-slot-${it.id}`;
const sel=h('select',{id,'data-testid':'import-slot'},
h('option',{value:''},t('drill.import.none')),
drill.slots.map((s)=>h('option',{value:String(s.slot),selected:s.slot===it.drillSlot},t('drill.import.slot_opt',{n:s.slot,target:distText(app,s.target_m)}))));
sel.value=fin(it.drillSlot)?String(it.drillSlot):'';
sel.addEventListener('change',()=>{it.drillSlot=sel.value?Number(sel.value):null;it.slotManual=true;onChange?.();});
return h('div.drill-map-row',{},h('label',{for:id},String(it.file?.name??'').slice(0,40)),sel);
});
return h('section.card.drill-map',{'data-testid':'import-drill'},
h('h2',templateTitle(drill.template)),
h('p.dm-what',what),
extra?h('p.hint.bad',t('drill.import.extra',{n:extra})):null,
rows.length?h('div.drill-map-rows',{},rows):h('p.hint',t('drill.import.how')),
C.button({label:t('drill.import.back'),variant:'plain',size:'md',icon:'target',testid:'import-drill-back',onClick:()=>app.nav.go('drill',{drill_id:drill.drill_id})}));
}

export function tagShot(app,it,shot){
const d=app.drill.current();
if(!d||!fin(it?.drillSlot)||!shot)return;
shot.practice=practiceOf(d,it.drillSlot);
}

export async function recordImported(app,it,shot){
const cur=app.drill.current();
if(!cur||!fin(it?.drillSlot)||shot?.practice?.drill_id!==cur.drill_id)return;
let d=cur;
try{d=(await app.repo?.drills?.get(cur.drill_id))??cur;}catch(_){ }
d=recordShot(d,it.drillSlot,shot,{now:nowIso()});
try{await app.repo?.drills?.put(d);}catch(e){app.errors?.report?.(e,{where:'drill.record',silent:true});}
app.drill.set(d);
}


function demoDrill(filled){
let d=makeDrill('distance18',{seed:7,drill_id:'drill-demo',created_at:'2026-11-06T09:00:00.000Z'});
const rng=mulberry32(11);
for(const s of d.slots.slice(0,filled)){
const c=s.target_m+gauss(rng,0,7);
const shot={shot_id:`demo-${s.slot}`,capture:{view:'face_on'},metrics:{carry_m:{value:c,sigma:4,validity:'estimated',value_origin:'ballistics',reason_codes:[RC.FLIGHT_MODELLED]},carry_side_m:null}};
d=recordShot(d,s.slot,shot,{now:'2026-11-06T09:30:00.000Z'});
}
return d;
}


export function mountDrill(root,app){
let drill=null;
let mode='active';
let history=[];

async function load(params){
if(params.drill)return params.drill;
let d=null;
if(params.drill_id&&app.repo?.drills){try{d=await app.repo.drills.get(params.drill_id);}catch(_){d=null;}}
const cur=app.drill.current();
if(!d&&cur&&(!params.drill_id||cur.drill_id===params.drill_id))d=cur;
if(!d&&!params.drill_id)d=history.find((x)=>x.status==='active')??null;
return d??null;
}

async function remove(){
const ok=await C.confirmSheet({title:t('drill.delete.title'),consequence:t('drill.delete.body'),confirmLabel:t('drill.delete.confirm'),destructive:true,testid:'drill-delete'});
if(!ok)return;
try{await app.repo?.drills?.delete(drill.drill_id);}catch(e){app.errors?.report?.(e,{where:'drill.delete'});}
if(app.drill.current()?.drill_id===drill.drill_id)app.drill.set(null);
app.nav.back();
}

function slotRow(s,nextSlot){
const filled=Boolean(s.shot_id);
const scored=fin(s.score);
const now=!filled&&s.slot===nextSlot;
return h('li.drill-slot',{'data-slot':s.slot,'data-state':filled?'done':now?'current':'open','aria-current':now?'step':null},
h('span.ds-n',{},fmtNum(s.slot),filled?C.icon('check'):null),
h('span.ds-main',{},
h('span.ds-target',[distText(app,s.target_m),s.club?clubName(s.club):null].filter(Boolean).join(t('drill.dot'))),
filled?h('span.ds-sub',fin(s.carry_m)?t('drill.carry_miss',{carry:distText(app,s.carry_m),miss:missText(app,s.miss_m)}):t('drill.no_carry')):null),
now?h('span.ds-now',t('drill.slot_now')):null,
filled&&scored?h('span.ds-score',{},h('span',{'data-testid':'drill-score'},scoreText(s)),s.estimated?estTag():null):null,
filled&&!scored?h('span.ds-score',{},h('span',{'data-testid':'drill-score'},'—')):null);
}

function renderActive(){
const p=progressOf(drill);
const next=p.next;
const pct=p.total?Math.round((100*p.done)/p.total):0;
return[
h('section.card.drill-now',{},
h('p.dn-template',templateTitle(drill.template)),
next?h('p.dn-target',{'data-testid':'drill-target'},targetLine(app,next)):h('p.dn-target',{'data-testid':'drill-target'},t('drill.all_done')),
h('div.drill-progress',{'data-testid':'drill-progress',role:'progressbar','aria-valuemin':'0','aria-valuemax':String(p.total),'aria-valuenow':String(p.done),'aria-valuetext':t('drill.progress',p)},
h('span.dp-track',{'aria-hidden':'true'},h('span.dp-fill',{style:{width:`${pct}%`}})),
h('span.dp-text',`${p.done}/${p.total}`)),
C.button({label:t('drill.go_import'),variant:'primary',size:'lg',block:true,icon:'film',testid:'drill-import',onClick:()=>{app.drill.set(drill);app.nav.go('import');}}),
h('p.hint',t('drill.how'))),
h('h2.section-title',t('drill.slots')),
h('ol.drill-slots',{},drill.slots.map((s)=>slotRow(s,next?.slot))),
h('div.drill-actions',{},
C.button({label:t('drill.finish'),variant:'secondary',size:'lg',block:true,icon:'check',testid:'drill-finish',reason:p.done?null:t('drill.finish_none'),onClick:()=>finish()}),
dangerButton()),
];
}


function dangerButton(){
const b=C.button({label:t('drill.delete.action'),variant:'plain',size:'md',testid:'drill-delete-btn',onClick:()=>remove()});
b.classList.add('drill-delete');
return b;
}

async function finish(){
if(drill.status!=='done'){
drill={...drill,status:'done',finished_at:nowIso(),updated_at:nowIso()};
try{await app.repo?.drills?.put(drill);}catch(e){app.errors?.report?.(e,{where:'drill.finish',silent:true});}
}
if(app.drill.current()?.drill_id===drill.drill_id)app.drill.set(null);
mode='result';
render();
root.querySelector('h1')?.focus?.({preventScroll:true});
}

function bars(){
const filled=drill.slots.filter((s)=>fin(s.miss_m));
if(!filled.length)return null;
const max=Math.max(...filled.map((s)=>Math.abs(s.miss_m)),1);

const canvas=h('canvas.drill-chart',{role:'img','aria-label':t('drill.result.bars'),'data-testid':'drill-chart',style:{height:`${Math.min(15,Math.max(11,6+filled.length*0.8))}rem`}});
chart={canvas,filled};
return[canvas,h('p.hint.drill-legend',{'data-testid':'drill-legend'},t('drill.result.legend')),h('ol.drill-bars',{'aria-label':t('drill.result.bars')},filled.map((s)=>{
const w=(50*Math.abs(s.miss_m))/max;
return h('li.db-row',{},
h('span.db-label',t('drill.result.bar_label',{n:s.slot,target:distText(app,s.target_m)})),
h('span.db-track',{'aria-hidden':'true'},h('span.db-bar',{'data-dir':s.miss_m>=0?'long':'short',style:{width:`${w}%`,left:s.miss_m>=0?'50%':`${50-w}%`}})),
h('span.db-val',{},h('span',missPm(app,s)),s.estimated?estTag():null));
}))];
}



let chart=null;
async function drawChart(){
const c=chart;
if(!c?.canvas?.isConnected)return;
try{
const[{drawBars},{vizPalette}]=await Promise.all([import('../viz/charts.js'),import('../viz/palette.js')]);
const bars=c.filled.map((s)=>({label:String(s.slot),value:s.miss_m,lo:s.miss_m-1.96*(s.carry_sigma??0),hi:s.miss_m+1.96*(s.carry_sigma??0),club:s.club??undefined,validity:s.estimated?'estimated':'valid'}));
const r=drawBars(c.canvas,{bars,palette:vizPalette(c.canvas),units:app.units(),kind:'distance',axisTitle:(u)=>t('viz.axis.miss',{unit:u}),xTitle:t('viz.axis.target')});
if(r?.a11y)c.canvas.setAttribute('aria-label',t(r.a11y,r.params??{}));
c.canvas.parentElement?.querySelector('.drill-bars')?.classList.add('has-chart');
}catch(_){
c.canvas.remove();
}
}

function clubTable(sum){
const rows=[...sum.clubs].map(([c,xs])=>{
const sorted=xs.slice().sort((a,b)=>a-b);
const m=sorted.length>>1;
const med=sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;
return C.listRow({icon:'club',title:c?clubName(c):t('drill.any_club'),subtitle:t('drill.result.club_line',{n:xs.length,lo:distText(app,sorted[0]),hi:distText(app,sorted[sorted.length-1])}),value:t('drill.result.median',{v:distText(app,med)})});
});
return rows.length?h('div.list-group',{},rows):null;
}

function renderResult(){
const sum=summaryOf(drill);
const tpl=templateOf(drill.template);
const sc=sum.score;
const prev=history.find((x)=>x.drill_id!==drill.drill_id&&x.status==='done'&&String(x.created_at)<String(drill.created_at)&&comparable(x,drill));
const ps=prev?summaryOf(prev).score:null;
const views=sum.views.map(viewName).join(t('drill.dot'));
const kids=[h('p.dn-template',[templateTitle(drill.template),fmtDate(drill.created_at),views].filter(Boolean).join(t('drill.dot')))];
if(tpl?.scored){
kids.push(h('section.card.drill-total',{},
h('p.drt-caption',t('drill.result.score')),
h('p.drt-big',{'data-testid':'drill-total'},sc?fmtNum(sc.mean):'—',sc?h('span.drt-pm',` ± ${fmtNum(1.96*sc.sigma)}`):null),
sc?h('p.hint',t('drill.result.interval',{lo:fmtNum(sc.ci95[0]),hi:fmtNum(sc.ci95[1]),n:sc.n})):h('p.hint',t('drill.result.no_score')),
sum.estimated?h('p.drt-est',{},estTag(),h('span',t('drill.result.estimated'))):null,
h('p.hint',prev&&ps&&sc?t('drill.result.prev',{s:fmtNum(ps.mean),d:fmtNum(sc.mean-ps.mean,{sign:true}),date:fmtDate(prev.created_at)}):t('drill.result.no_prev')),
h('p.hint',t('drill.compare_note'))));
kids.push(h('h2.section-title',t('drill.result.misses')),bars());
}else{
kids.push(C.notice({variant:'info',title:t('drill.result.gapping_title'),body:t('drill.result.gapping_body')}));
}
kids.push(h('h2.section-title',t('drill.result.by_club')),clubTable(sum));
kids.push(h('div.drill-actions',{},
C.button({label:t('drill.again'),variant:'primary',size:'lg',block:true,icon:'play',testid:'drill-again',onClick:()=>app.nav.go('drills')})));
return kids;
}

function render(){
const head=C.screenHeader({title:app.screenTitle('drill'),back:true,onBack:()=>app.nav.back()});
if(!drill){
clear(root,head,C.emptyState({icon:'target',title:t('drill.empty.title'),body:t('drill.empty.body'),action:{label:t('drill.empty.action'),onClick:()=>app.nav.go('drills'),testid:'drill-to-drills'}}));
return;
}
chart=null;
clear(root,head,...(mode==='result'?renderResult():renderActive()));
drawChart();
}

async function show(params={}){
history=await listDrills(app);
drill=await load(params??{});
mode=params?.view==='result'||drill?.status==='done'?'result':'active';
if(drill&&mode==='active'&&!params?.drill)app.drill.set(drill);
render();
}


try{new MutationObserver(()=>drawChart()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style']});}catch(_){ }
globalThis.addEventListener?.('resize',()=>drawChart());

app.e2e?.registerState?.('drill','active',()=>show({drill:demoDrill(2)}));
app.e2e?.registerState?.('drill','result',()=>show({drill:demoDrill(18),view:'result'}));

return{show};
}
