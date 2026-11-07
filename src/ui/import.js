






import{h,clear}from'./dom.js';
import*as C from'./components.js';
import{t,has,plural,fmtNum,fmtDateTime}from'../i18n/index.js';
import{CLUBS,clubLength}from'../session/settings.js';
import{newId,nowIso}from'../session/ids.js';
import{fpsAtLeast}from'../geom/constants.js';
import{RC}from'../contract/reason-codes.js';
import{clubName,viewName}from'./glossary.js';

const STEPS=Object.freeze(['probe','pose','events','impact','assemble']);
const VIEWS=Object.freeze(['face_on','dtl','high_behind']);
const GUIDE_KEY='gsl-import-guide-seen';
const DEFAULT_MS_PER_FRAME=40;
let msPerFrame=null;

const cancelledErr=(e)=>e?.name==='AbortError'||e?.code==='CANCELLED';
const errCode=(e)=>(typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]+$/.test(e.code)?e.code:(e?.name==='QuotaExceededError'?'QUOTA_EXCEEDED':'INTERNAL'));

function guideSeen(){try{return globalThis.localStorage?.getItem(GUIDE_KEY)==='1';}catch(_){return false;}}
function markGuideSeen(){try{globalThis.localStorage?.setItem(GUIDE_KEY,'1');}catch(_){ }}

export function mountImport(root,app){
const items=[];
let calibs=[];
let running=false;
let cancelAll=false;
let prefs=null;
let dm=null;

async function loadCalibs(){
calibs=[];
const cur=app.current?.calibration;
if(cur)calibs.push({id:'current',label:t('import.calib.current'),calibration:cur,view:app.current.view,preset_id:app.current.preset?.preset_id??null,venue:app.current.venue});
if(app.repo){
try{
const ss=await app.repo.sessions.list({index:'created_at',reverse:true,limit:20});
for(const s of ss)if(s.calibration)calibs.push({id:s.session_id,label:t('import.calib.session',{when:fmtDateTime(s.created_at),view:viewName(s.view)}),calibration:s.calibration,view:s.view,preset_id:s.preset_id,venue_id:s.venue_id});
}catch(_){ }
}
}

function initPrefs(){
const st=app.settings?.()??{};
const mem=app.current?.importPrefs??null;
prefs={
view:mem?.view??app.current?.view??app.store?.get?.().view??'face_on',
calib:mem&&(mem.calib===''||calibs.some((c)=>c.id===mem.calib))?mem.calib:(calibs[0]?.id??''),
club:mem?.club??st.club_type??'7i',
};
}
function savePrefs(){if(app.current)app.current.importPrefs={...prefs};}


function settingsRow(){
const cal=calibs.find((c)=>c.id===prefs.calib);
const text=[viewName(prefs.view),cal?cal.label:t('import.calib.none_short'),clubName(prefs.club)].join(' · ');
return C.listRow({icon:'settings',title:t('import.settings.title'),subtitle:text,testid:'import-settings',onClick:()=>openSettings()});
}

function openSettings(){
const box=h('div.import-settings',{});
const view=C.segmented({options:VIEWS.map((v)=>[v,viewName(v)]),value:prefs.view,label:t('import.settings.view'),testid:'import-view',onChange:(v)=>{prefs.view=v;}});
const calItems=[...calibs.map((c)=>[c.id,c.label]),['',t('import.calib.none')]];
const cal=C.chipRow({items:calItems,value:prefs.calib,label:t('import.settings.calib'),testid:'import-calib',onChange:(v)=>{prefs.calib=v;}});
const club=C.chipRow({items:CLUBS.map(([c])=>[c,clubName(c)]),value:prefs.club,label:t('import.settings.club'),testid:'import-club',onChange:(v)=>{prefs.club=v;}});
box.append(
h('p.field-label',t('import.settings.view')),view,
h('p.field-label',t('import.settings.calib')),cal,h('p.hint',t('import.settings.calib_hint')),
h('p.field-label',t('import.settings.club')),club,
C.button({label:t('common.done'),variant:'primary',size:'lg',block:true,testid:'import-settings-done',onClick:()=>s.close()}));
const s=C.sheet({title:t('import.settings.title'),content:box,onClose:()=>{savePrefs();render();}});
s.open();
}


async function addFiles(files){
for(const file of files){
const it={id:newId('imp'),file,probe:null,low:false,allowLow:false,status:'probing',error:null,steps:null,shot:null};
items.push(it);
}
render();
for(const it of items.filter((x)=>x.status==='probing'))await probe(it);
render();
}

async function probe(it){
const fn=app.deps?.probe?.probeFile;
if(!fn){it.status='ready';return;}
try{
const p=await fn(it.file);
it.probe=p;
app.record?.('import.last',{effective_fps:p.effective_fps,sample_count:p.sample_count,hevc:/hvc1|hev1/i.test(p.codec??''),decoded:null});
it.low=!fpsAtLeast(p.effective_fps,200);
it.status=it.low?'low':'ready';
}catch(e){
app.errors?.report?.(e,{where:'import.probe',silent:true});
it.status='error';
it.error={code:errCode(e),params:e?.params??{}};
}
}


async function analyse(it,vc){
const st=app.settings?.()??{};
const cal=calibs.find((c)=>c.id===prefs.calib)??null;
const venue=cal?.venue??app.current?.venue??null;
const sess=app.store?.get?.().session;
const len=clubLength?.(prefs.club)??CLUBS.find((c)=>c[0]===prefs.club)?.[1]??null;
it.status='running';
it.t0=performance.now();
it.steps.reset();
it.steps.set('probe','done');
const frames=it.probe?.sample_count??null;
const eta=frames?(frames*(msPerFrame??DEFAULT_MS_PER_FRAME))/1000:null;
const tick=()=>{if(eta!==null)it.steps.eta(Math.max(1,eta-(performance.now()-it.t0)/1000));};
tick();
it.etaTimer=setInterval(tick,1000);
paintItem(it);
try{
const ids={shot_id:newId('shot'),session_id:sess?.session_id??newId('sess-import'),venue_id:venue?.venue_id??cal?.venue_id??null,preset_id:cal?.preset_id??null,created_at:nowIso(),app_version:app.version?.()??'unknown'};
let last='probe';
const job=vc.analyzeClip(it.file,{
view:prefs.view,calibration:it.noBall?null:(cal?.calibration??null),handedness:st.handedness,venue,ids,
club:{type:prefs.club,length_m:len,lie:app.current?.lie??st.lie,tee_lift_m:venue?.tee_lift_m??null,tee_lift_source:Number.isFinite(venue?.tee_lift_m)?'measured':'assumed'},
mode:'highspeed',source:'import',clip_ref:newId('clip'),allowNoSwing:false,pose_model:st.model,
warnings:app.controller?.warnings?.()??[],lm:{ground:st.lm?.ground},
},{onProgress:(stg)=>{
if(!STEPS.includes(stg)||stg===last)return;
for(const s of STEPS.slice(0,STEPS.indexOf(stg)))it.steps.set(s,'done');
it.steps.set(stg,'active');
last=stg;
}});
it.job=job;
const res=await job;
const shot=res?.shot??res;
if(cal?.preset_id&&!shot.preset_id)shot.preset_id=cal.preset_id;
const elapsed=performance.now()-it.t0;
app.record?.('import.analysis_s',elapsed/1000);
if(frames)msPerFrame=elapsed/frames;
dm?.tagShot(app,it,shot);
const r=await app.controller.saveShot(shot,{clipBlob:it.file,poseSeq:res?.poseSeq??null,mime:it.file.type});
const saved=r?.shot??(r?.shot_id?r:shot);
it.clipSaved=r&&typeof r==='object'&&'clipSaved'in r?r.clipSaved:true;
it.slowmo=[...(res?.reasons??[]),...(saved?.quality?.warnings??[])].includes(RC.SLOWMO_CORRECTED)
?(saved?.events?.meta?.time_scale??res?.time_scale??8):null;
for(const s of STEPS)it.steps.set(s,'done');
it.shot=saved;
await dm?.recordImported(app,it,saved).catch(()=>{});
it.status='done';
}catch(e){
if(cancelledErr(e)){it.status='cancelled';}else{
app.errors?.report?.(e,{where:'import.analyse',silent:true});
it.status='error';
it.error={code:errCode(e),params:e?.params??{}};
for(const s of STEPS)if(it.steps.el.querySelector(`[data-step="${s}"]`)?.dataset.state==='active')it.steps.set(s,'error');
}
}finally{
clearInterval(it.etaTimer);
it.steps.eta(null);
it.job=null;
}
}

async function runAll(){
if(running)return;
const todo=items.filter((x)=>x.status==='ready'||(x.status==='low'&&x.allowLow));
if(!todo.length)return;


const seam=typeof globalThis.__GSL_E2E__?.analyzeClip==='function'?globalThis.__GSL_E2E__.analyzeClip:null;
if(!app.vision&&!seam){C.toast.error(t('error.MODULE_MISSING'));return;}
running=true;
cancelAll=false;
for(const it of todo)it.status='queued';
render();
let vc;
try{
vc=seam?{analyzeClip:(f,o,cb)=>{let stop=false;const p=Promise.resolve().then(()=>seam(f,o,{...cb,cancelled:()=>stop}));p.cancel=()=>{stop=true;};return p;}}:await app.vision();
}catch(e){
running=false;
for(const it of todo){it.status='error';it.error={code:errCode(e),params:{}};}
app.errors?.report?.(e,{where:'import.vision',silent:true});
render();
return;
}
for(const it of todo){
if(cancelAll){it.status='ready';continue;}
await analyse(it,vc);
paintItem(it);
}
running=false;
const done=todo.filter((x)=>x.status==='done');
if(todo.length===1&&done.length===1){app.nav.go('shot',{shot_id:done[0].shot.shot_id,shot:done[0].shot,from:'import'});return;}
render();
if(done.length)C.toast.info(plural('import.batch.done',done.length));
}

async function confirmCancel(it){
const ok=await C.confirmSheet({title:t('import.cancel.title'),consequence:t('import.cancel.body'),confirmLabel:t('import.cancel.stop'),cancelLabel:t('import.cancel.keep'),destructive:true,testid:'import-cancel'});
if(!ok)return;
cancelAll=true;
it?.job?.cancel?.();
}

async function leave(){
if(running){
const ok=await C.confirmSheet({title:t('import.leave.title'),consequence:t('import.leave.body'),confirmLabel:t('import.cancel.stop'),cancelLabel:t('import.cancel.keep'),destructive:true,testid:'import-leave'});
if(!ok)return;
cancelAll=true;
for(const it of items)it.job?.cancel?.();
}
app.nav.back();
}


const cards=new Map();

function errorCard(it){
const code=it.error?.code??'INTERNAL';
const title=has(`error.${code}`)?t(`error.${code}`,it.error?.params):t('error.INTERNAL');
const fix=has(`error.${code}.fix`)?t(`error.${code}.fix`,it.error?.params):t('import.error.generic_fix');
const cause=has(`import.cause.${code}`)?t(`import.cause.${code}`):null;
const another=C.button({label:t('import.error.another'),variant:'primary',size:'lg',block:true,testid:'import-error-another',onClick:()=>{remove(it);picker.input.click();}});
const noBall=(code==='DECODE_FAILED'||code==='UNSUPPORTED_CODEC'||code==='FILE_TRUNCATED'||code==='NO_SWING_FOUND'||code==='NO_VIDEO_TRACK')?null
:C.button({label:t('import.error.without_ball'),variant:'secondary',size:'lg',block:true,testid:'import-error-noball',onClick:()=>{it.noBall=true;it.allowLow=true;it.status='ready';it.error=null;render();}});
const dismiss=C.button({label:t('import.error.dismiss'),variant:'plain',size:'md',testid:'import-error-dismiss',onClick:()=>remove(it)});
const body=h('div.ie-body',{},cause?h('p',cause):null,h('p.ie-fix',fix),h('div.ie-actions',{},another,noBall,dismiss));
const n=C.notice({variant:'error',title,body,testid:'import-error-card'});
n.classList.add('import-error-card');
return n;
}

function remove(it){
const i=items.indexOf(it);
if(i>=0)items.splice(i,1);
cards.delete(it.id);
render();
}

function probeLine(it){
const p=it.probe;
if(!p)return null;
return h('p.qi-probe',t('import.probe.line',{w:p.width,h:p.height,fps:fmtNum(p.effective_fps,{digits:0}),n:p.sample_count??'—'}));
}

function itemCard(it){
let c=cards.get(it.id);
if(!c){
it.steps=it.steps??C.progressSteps({steps:STEPS.map((s)=>({id:s,label:t(`import.step.${s}`)})),testid:'import-steps',onCancel:()=>confirmCancel(it),cancelLabel:t('common.cancel')});
c={el:h('li.queue-item',{'data-item':it.id})};
cards.set(it.id,c);
}
paintItemInto(it,c.el);
return c.el;
}

function paintItem(it){const c=cards.get(it.id);if(c)paintItemInto(it,c.el);}

function paintItemInto(it,el){
el.dataset.status=it.status;
const name=String(it.file?.name??'').slice(0,60);
const head=h('div.qi-head',{},C.icon('film'),h('span.qi-name',name),h('span.qi-size',t('import.size_mb',{n:fmtNum((it.file?.size??0)/1e6,{digits:1})})));
const parts=[head,probeLine(it)];
if(it.status==='probing')parts.push(h('p.hint',t('import.probing')));
if(it.status==='low'){
parts.push(C.notice({variant:'caution',title:t('import.low.title',{fps:fmtNum(it.probe?.effective_fps??0,{digits:0})}),body:t('import.low.body')}));
parts.push(C.button({label:t('import.low.anyway'),variant:'secondary',size:'lg',block:true,testid:'import-low-anyway',onClick:()=>{it.allowLow=true;it.status='ready';render();}}));
}
if(it.status==='low'&&it.allowLow)parts.push(h('p.hint',t('import.low.accepted')));
if(['queued','running','done','cancelled'].includes(it.status)&&it.steps){
it.steps.el.querySelector('.btn')?.toggleAttribute('hidden',it.status!=='running');
parts.push(it.steps.el);
}
if(it.status==='queued')parts.push(h('p.hint',t('import.queued')));
if(it.status==='cancelled')parts.push(h('p.hint',t('common.cancelled')));
if(it.status==='error')parts.push(errorCard(it));
if(it.status==='done'&&it.shot){
if(it.slowmo)parts.push(C.notice({variant:'info',title:t('import.slowmo.title'),body:t('import.slowmo.body',{k:it.slowmo})}));
if(it.clipSaved===false)parts.push(C.notice({variant:'caution',title:t('reason.CLIP_NOT_SAVED.short'),body:t('reason.CLIP_NOT_SAVED.fix')}));
parts.push(C.listRow({icon:'check',title:t('import.done.open'),subtitle:[clubName(it.shot.club?.type),viewName(it.shot.capture?.view)].join(' · '),testid:'import-open-shot',onClick:()=>app.nav.go('shot',{shot_id:it.shot.shot_id,shot:it.shot,from:'import'})}));
}
clear(el,...parts);
}

let picker=null;
function guide(){
const steps=[1,2,3,4].map((k)=>h('li',t(`import.guide.step${k}`)));
const why=h('details.why',{},h('summary',t('import.guide.why_title')),h('p',t('import.guide.why_body')));
const g=h('details.card.import-guide',{'data-testid':'import-guide',open:!guideSeen()||null},
h('summary',{},C.icon('info'),h('span',t('import.guide.title'))),h('ol.guide-steps',{},steps),why);
g.addEventListener('toggle',()=>{if(!g.open)markGuideSeen();});
return g;
}

function render(){
if(!prefs)initPrefs();
picker=C.filePicker({accept:'video/*',multiple:true,variant:'zone',label:t('import.pick.label'),hint:t('import.pick.hint'),testid:'import-file-input',id:'import-file',onFiles:(files)=>{markGuideSeen();addFiles(files);picker.input.value='';}});
const ready=items.filter((x)=>x.status==='ready'||(x.status==='low'&&x.allowLow)).length;
const lowWaiting=items.some((x)=>x.status==='low'&&!x.allowLow);
const probing=items.some((x)=>x.status==='probing');
const go=C.button({label:ready>1?t('import.start_n',{n:ready}):t('import.start'),variant:'primary',size:'lg',block:true,testid:'import-start',
reason:running?t('import.running'):(probing?t('import.probing'):(ready?null:(lowWaiting?t('import.reason.low'):t('import.reason.none')))),
onClick:()=>runAll()});
const queue=items.length?h('ol.import-queue',{'data-testid':'import-queue','aria-label':t('import.queue.label')},items.map(itemCard)):null;
const done=items.filter((x)=>x.status==='done');
const summary=!running&&done.length>1?C.notice({variant:'info',title:plural('import.batch.done',done.length),body:t('import.batch.body')}):null;
const next=!running&&done.length?C.button({label:t('import.next'),icon:'film',variant:'tinted',size:'lg',block:true,testid:'import-next',onClick:()=>{for(const x of done)remove(x);picker.input.click();}}):null;
clear(root,
C.screenHeader({title:t('screen.import.title'),back:true,onBack:leave}),
h('div.list-group',{},settingsRow()),
guide(),
picker,
dm?.drillImportPanel(app,items,{onChange:render}),queue,summary,
h('div.import-primary',{},go,next));
}

return{
async show(params={}){
if(!running&&!params.keep){for(const it of[...items])if(['done','cancelled'].includes(it.status))items.splice(items.indexOf(it),1);}
prefs=null;
render();
await loadCalibs();
dm=app.drill?.current?.()?.status==='active'?await import('./drill.js').catch(()=>null):null;
prefs=null;
render();
},
hide(){ },
};
}
