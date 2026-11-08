








import{h,clear}from'./dom.js';
import*as C from'./components.js';
import{t,plural}from'../i18n/index.js';
import{fmtMetric,metricKind,normalizeUnits,convert,unitLabel}from'../i18n/units.js';
import{saveSettings}from'../session/settings.js';
import{clubName,viewName,metricName}from'./glossary.js';
import{historySeg,loadedShots,shotOps}from'./history.js';
import{noteText}from'./compare.js';
import{summarize,mishitMask,compareSessions,byClub}from'../store/stats.js';

export const STATS_METRICS=Object.freeze(['carry_m','total_m','ball_speed_mps','club_speed_mps','launch_v_deg','spin_rate_rpm']);
const PERIODS={session:0,d7:7,d30:30,all:Infinity};
const DAY=86400000;
const val=(m)=>(m&&Number.isFinite(m.value)?m.value:null);
const latest=(list)=>list.reduce((a,s)=>(String(s.created_at)>a?String(s.created_at):a),'');


export function filterShots(shots,f,now=Date.now()){
const base=shots.filter((s)=>(!f.view||s.capture?.view===f.view)&&(!f.club||s.club?.type===f.club)&&(!f.preset||s.preset_id===f.preset));
if(f.period==='session'){
const last=base.reduce((a,s)=>(!a||String(s.created_at)>String(a.created_at)?s:a),null);
return{base,shots:last?base.filter((s)=>s.session_id===last.session_id):[]};
}
const days=PERIODS[f.period]??Infinity;
return{base,shots:days===Infinity?base:base.filter((s)=>now-Date.parse(s.created_at)<=days*DAY)};
}


function clean(list,id,on){
if(!on)return list;
const groups=new Map();
for(const s of list){
if(val(s.metrics?.[id])===null)continue;
const k=`${s.club?.type}|${s.capture?.view}`;
if(!groups.has(k))groups.set(k,[]);
groups.get(k).push(s);
}
const out=new Set(list);
for(const g of groups.values())mishitMask(g.map((s)=>s.metrics[id].value)).forEach((bad,i)=>{if(bad)out.delete(g[i]);});
return list.filter((s)=>out.has(s));
}

function bySession(list){
const m=new Map();
for(const s of list){const k=s.session_id??String(s.created_at).slice(0,10);if(!m.has(k))m.set(k,[]);m.get(k).push(s);}
return[...m.values()].sort((a,b)=>latest(b).localeCompare(latest(a)));
}


export function clubCards(shots,base,id,excludeMishits){
const clubs=[...new Set(shots.filter((s)=>val(s.metrics?.[id])!==null).map((s)=>s.club?.type??null))].sort(byClub);
return clubs.map((club)=>{
const all=shots.filter((s)=>(s.club?.type??null)===club&&val(s.metrics?.[id])!==null);
const kept=clean(all,id,excludeMishits);
const stat=summarize(kept.map((s)=>s.metrics[id].value),kept.map((s)=>s.metrics[id].sigma));
const sessions=bySession(clean(base.filter((s)=>(s.club?.type??null)===club&&val(s.metrics?.[id])!==null),id,excludeMishits));
const r=sessions.length>=2?compareSessions(sessions[1],sessions[0],[id]):null;
return{
club,stat,excluded:all.length-kept.length,unit:all[0]?.metrics[id].unit,
views:[...new Set(kept.map((s)=>s.capture?.view))],
inferred:kept.some((s)=>C.isInferred(s.metrics[id])||s.metrics[id].validity!=='valid'),
last:r?.metrics[id]??null,lastResult:r,
};
});
}






export function topPoints(shots){
return shots.filter((s)=>val(s.metrics?.carry_m)!==null).map((s)=>{
const side=val(s.metrics.carry_side_m);
return{
x:s.metrics.carry_m.value,
y:side===null?null:(s.handedness==='left'?side:-side),
sx:s.metrics.carry_m.sigma??null,
sy:side===null?null:s.metrics.carry_side_m.sigma??null,
club:s.club?.type??null,
validity:s.metrics.carry_m.validity,
view:s.capture?.view??null,
};
});
}
const MIN_SPREAD_N=3;

export function mountStats(root,app){
let shots=[];
let presets=[];
let f={period:'all',view:'',club:'',preset:'',metric:'carry_m'};
let seq=0;
const units=()=>app.units?.()??undefined;
const excl=()=>app.settings?.()?.lm?.excludeMishits!==false;
const ops=shotOps(app);

async function load(){
const all=app.repo?await app.repo.queryShots({reverse:true}):[];
shots=all.filter((s)=>!ops.isDeleted(s));
try{presets=app.repo?await app.repo.presets.list():[];}catch(_){presets=[];}
}

const fmt=(v,unit,ci)=>fmtMetric({value:v,unit,ci95:ci??null},units(),{id:f.metric}).text;
const signed=(v,unit,ci)=>{
const a=Math.abs(v);
const half=ci?(ci[1]-ci[0])/2:null;
return`${v>0?'+':v<0?'−':''}${fmt(a,unit,half===null?null:[a-half,a+half])}`;
};

function chips(key,items,label){
const row=C.chipRow({items,value:f[key],label,onChange:(v)=>{f={...f,[key]:v};render();}});
Object.assign(row.dataset,{testid:'stats-filter',filter:key});
return h('div.stats-frow',{},h('p.stats-flabel',label),row);
}

function filters(){
const views=['face_on','high_behind','dtl'].filter((v)=>shots.some((s)=>s.capture?.view===v));
const clubs=[...new Set(shots.map((s)=>s.club?.type).filter(Boolean))].sort(byClub);
const pids=[...new Set(shots.map((s)=>s.preset_id).filter(Boolean))];
const pname=(id,i)=>presets.find((p)=>p.preset_id===id)?.name||t('stats.filter.preset_n',{n:i+1});
const mis=C.switchRow({label:t('stats.filter.mishits'),hint:t('stats.filter.mishits_hint'),checked:excl(),testid:'stats-mishits',
onChange:(on)=>{app.updateSettings?.(saveSettings({lm:{excludeMishits:on}}));render();}});
mis.dataset.filter='mishits';
return h('section.card.stats-filters',{},
chips('period',Object.keys(PERIODS).map((k)=>[k,t(`stats.period.${k}`)]),t('stats.filter.period')),
views.length>1?chips('view',[['',t('stats.filter.all')],...views.map((v)=>[v,viewName(v)])],t('stats.filter.view')):null,
clubs.length>1?chips('club',[['',t('stats.filter.all_clubs')],...clubs.map((c)=>[c,clubName(c)])],t('stats.filter.club')):null,
pids.length>1?chips('preset',[['',t('stats.filter.all')],...pids.map((p,i)=>[p,pname(p,i)])],t('stats.filter.preset')):null,
chips('metric',STATS_METRICS.map((id)=>[id,metricName(id)]),t('stats.filter.metric')),
mis);
}

const kv=(k,v)=>h('div.stats-kv',{},h('dt',k),h('dd.nowrap',v));

function card(c){
const s=c.stat;
const u=c.unit;
const head=h('div.stats-chead',{},h('h2',clubName(c.club)),
h('span.stats-n',[plural('stats.card.n',s.n),c.excluded?t('stats.card.excluded',{n:c.excluded}):null].filter(Boolean).join(' · ')));

const pill=c.inferred?C.validityTag('estimated'):null;
pill?.classList.add('dt-est');
const mean=h('p.stats-mean',{},h('span.mt-num',fmt(s.mean,u)),' ',pill);

const few=s.n<MIN_SPREAD_N;

const ci=s.ci95_mean&&!few&&fmt(s.ci95_mean[0],u)!==fmt(s.ci95_mean[1],u)?h('p.stats-ci',t('stats.card.ci',{lo:fmt(s.ci95_mean[0],u),hi:fmt(s.ci95_mean[1],u)})):null;
const dl=h('dl.stats-dl',{},kv(t('stats.card.median'),fmt(s.median,u)),
few?null:kv(t('stats.card.sd'),s.sd_obs===null?'—':fmt(s.sd_obs,u)),
few||fmt(s.p10,u)===fmt(s.p90,u)?null:kv(t('stats.card.range'),`${fmt(s.p10,u)} – ${fmt(s.p90,u)}`));
let cons;
if(few)cons=h('p.hint',t('stats.card.few'));
else if(s.sd_obs===null)cons=h('p.hint',t('stats.cons.few'));
else if(s.sigma_noise===null)cons=h('p.hint',t('stats.cons.unknown'));
else if(s.indistinguishable)cons=h('p.stats-indist',t('stats.cons.indist',{sd:fmt(s.sd_obs,u),noise:fmt(s.sigma_noise,u)}));
else cons=h('p',t('stats.cons.line',{sd:fmt(s.sd_obs,u),noise:fmt(s.sigma_noise,u),est:fmt(s.sd_est,u)}));
const consBox=h('div.stats-cons',{'data-testid':'stats-consistency','data-indistinguishable':String(s.indistinguishable)},h('h3',t('stats.cons.title')),cons);
let last;
if(!c.last||c.last.status!=='compared')last=h('p.hint',t('stats.last.none'));
else{
const m=c.last;
const verdict=m.significant?t('stats.last.sig'):(c.lastResult.like_for_like?t('stats.last.nosig'):t('stats.last.cannot'));
const notes=c.lastResult.warnings.length||c.lastResult.notes.length
?[...c.lastResult.warnings.map((w)=>t(`reason.${w}.short`)),...c.lastResult.notes.map(noteText)]:[];

const line=m.significant||c.lastResult.like_for_like
?h('p',{},h('span.nowrap',t('stats.last.delta',{d:signed(m.delta,u,m.delta_ci95)})),' · ',verdict):h('p',verdict);
last=h('div',{},line,notes.length?h('p.hint',notes.join(' · ')):null);
}
const lastBox=h('div.stats-last',{'data-significant':String(Boolean(c.last?.significant))},h('h3',t('stats.last.title')),last);
const mixed=c.views.length>1?h('p.hint',t('stats.card.mixed_views')):null;
return h('section.card.stats-card',{'data-testid':'stats-club-card','data-club':c.club??''},head,mean,ci,dl,mixed,consBox,lastBox);
}


function canvas(kind){
return h('canvas.stats-canvas',{role:'img','data-testid':`stats-viz-${kind}`,'aria-label':t('stats.charts.loading')});
}
function labelled(cv,r){
if(!r)return;
cv.dataset.vizA11y=r.a11y??'';
try{cv.dataset.vizParams=JSON.stringify(r.params??{});}catch(_){ }
cv.setAttribute('aria-label',r.a11y?t(r.a11y,r.params??{}):t('stats.charts.title'));
}

async function drawCharts(box,list,cards,my){
let V;
try{V=await import('../viz/index.js');}catch(_){V=null;}
if(my!==seq||!box.isConnected)return;
const fail=()=>clear(box,h('h2',t('stats.charts.title')),h('p.hint',t('stats.charts.unavailable')));
if(!V){fail();return;}
const withCarry=list.filter((s)=>val(s.metrics?.carry_m)!==null);
const top=canvas('top');
const side=canvas('side');
const box2=canvas('box');
const flights=list.filter((s)=>s.flight?.samples?.length).slice(0,40)
.map((s)=>({samples:s.flight.samples,club:s.club?.type,validity:s.metrics?.carry_m?.validity,band:s.flight.band}));
clear(box,h('h2',t('stats.charts.title')),
h('h3',t('stats.charts.top')),h('p.hint',t('stats.charts.strip')),top,
flights.length?[h('h3',t('stats.charts.side')),side]:null,
h('h3',t('stats.charts.box',{metric:metricName(f.metric)})),box2);
let palette;
try{palette=V.vizPalette(box);}catch(_){fail();return;}
const draw=(cv,fn)=>{
try{labelled(cv,fn());}catch(e){
app.errors?.report?.(e,{where:'stats.charts',silent:true});
cv.replaceWith(h('p.hint',t('stats.charts.unavailable')));
}
};
const points=topPoints(withCarry);

if(!points.some((p)=>p.y!==null))Object.assign(top.style,{aspectRatio:'auto',height:'11rem',minHeight:'0'});
const nv=(v)=>String(points.filter((p)=>p.view===v).length);
Object.assign(top.dataset,{inputFaceOn:nv('face_on'),inputHighBehind:nv('high_behind')});
draw(top,()=>V.drawTop(top,{points,units:units(),palette}));
if(flights.length)draw(side,()=>V.drawSide(side,{flights,units:units(),palette}));

const unit=cards[0]?.unit??null;
const kind=metricKind(f.metric,unit);
const U=normalizeUnits(units());
const k=kind==='speed'?(x)=>convert(x,'m/s',U.speed):(x)=>x;
const groups=cards.filter((c)=>c.stat.n).map((c)=>({club:c.club,label:clubName(c.club),
values:clean(list.filter((s)=>(s.club?.type??null)===c.club&&val(s.metrics?.[f.metric])!==null),f.metric,excl()).map((s)=>k(s.metrics[f.metric].value))}));

const axisTitle=(u)=>(u?t('viz.axis.value',{metric:metricName(f.metric),unit:u}):metricName(f.metric));
draw(box2,()=>V.drawBox(box2,{groups,kind:kind==='distance'?'distance':undefined,unit:unitLabel(kind==='speed'?U.speed:unit),axisTitle,units:units(),palette}));
}

function render(){
const my=++seq;
const{base,shots:list}=filterShots(shots,f);
const cards=clubCards(list,base,f.metric,excl());
const head=C.screenHeader({title:app.screenTitle('stats'),back:true,onBack:()=>app.nav.back()});
if(!shots.length){
clear(root,head,historySeg(app,'stats'),C.emptyState({icon:'history',title:t('stats.empty.title'),body:t('stats.empty.body'),testid:'stats-empty'}));
return;
}
const charts=h('section.card.stats-charts',{'aria-live':'off'},h('h2',t('stats.charts.title')),h('p.hint',t('stats.charts.loading')));
clear(root,head,historySeg(app,'stats'),filters(),
cards.length?h('div.stats-cards',{},cards.map(card)):h('p.hint',{'data-testid':'stats-none'},t('stats.none',{metric:metricName(f.metric)})),
cards.length?charts:null);
redraw=cards.length?()=>drawCharts(charts,list,cards,my):null;
if(redraw)requestAnimationFrame(redraw);
}


let redraw=null;
let timer=0;
const again=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(redraw&&!root.hidden)redraw();},150);};

new MutationObserver(again).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style']});
new MutationObserver(again).observe(root,{attributes:true,attributeFilter:['data-live-theme']});
globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',again);
let lastW=globalThis.innerWidth;
globalThis.addEventListener('resize',()=>{if(globalThis.innerWidth!==lastW){lastW=globalThis.innerWidth;again();}});

app.e2e?.registerState?.('stats','session',async()=>{f={...f,period:'session'};render();});

let sig=null;
const sigOf=(list)=>`${list.length}:${list[0]?.shot_id??''}:${list.at(-1)?.shot_id??''}`;
return{
async show(){
const cached=loadedShots();
if(cached){
shots=cached;
sig=sigOf(shots);
render();

setTimeout(()=>load().then(()=>{if(sigOf(shots)!==sig){sig=sigOf(shots);render();}},(e)=>app.errors?.report?.(e,{where:'stats.load'})),2000);
return;
}
clear(root,C.screenHeader({title:app.screenTitle('stats'),back:true,onBack:()=>app.nav.back()}),h('p.hint',t('common.loading')));
try{await load();}catch(e){app.errors?.report?.(e,{where:'stats.load'});}
sig=sigOf(shots);
render();
},
};
}
