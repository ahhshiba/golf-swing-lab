














import{h,clear}from'./dom.js';
import*as C from'./components.js';
import{t,has,fmtDateTime}from'../i18n/index.js';
import{fmtMetric}from'../i18n/units.js';
import{REGISTRY,cellFor}from'../metrics/registry.js';
import{tileDefaults,saveSettings,LM_TILE_MAX,CLUBS,clubLength}from'../session/settings.js';
import{bumpRevision}from'../contract/shot.js';
import{RC}from'../contract/reason-codes.js';
import{nowIso}from'../session/ids.js';
import{clubName,viewName,metricName}from'./glossary.js';


export const TILE_GROUPS=Object.freeze({
club:Object.freeze(['club_speed_mps','attack_angle_deg','club_path_deg','dynamic_loft_deg','face_angle_deg','face_to_path_deg','spin_loft_deg']),
ball:Object.freeze(['ball_speed_mps','smash_factor','launch_v_deg','launch_h_deg','spin_rate_rpm','spin_axis_deg']),
flight:Object.freeze(['carry_m','total_m','carry_side_m','total_side_m','curve_m','apex_m','landing_angle_deg','hang_time_s']),
swing:Object.freeze(['tempo_ratio','backswing_s','downswing_s','head_sway_x_m','head_lift_z_m','head_depth_y_m','spine_forward_tilt_deg',
'spine_side_tilt_deg','shoulder_turn_deg','hip_turn_deg','x_factor_deg','hand_plane_dev_m','top_shaft_angle_deg','weight_shift_pct','early_extension_m']),
});
const ALL_IDS=Object.freeze(Object.values(TILE_GROUPS).flat());
const TEMPO=['tempo_ratio','backswing_s','downswing_s'];
const TABS=['side','top','3d','video'];
const TAB_FPS=240;


export function tileIds(lm,view){
if(!isCustom(lm))return tileDefaults(view);
return lm.tiles.filter((id)=>ALL_IDS.includes(id)).slice(0,LM_TILE_MAX);
}
const isCustom=(lm)=>Boolean(lm&&lm.tilePreset==='custom'&&Array.isArray(lm.tiles)&&lm.tiles.length);





export const AUTO_MIN=6;
export function shownIds(ids,metrics,custom){
if(custom)return ids;
let room=AUTO_MIN-ids.filter((id)=>!isNull(metrics?.[id])).length;
return ids.filter((id)=>!isNull(metrics?.[id])||room-->0);
}

export function toggleTile(list,id,on){
if(on)return list.includes(id)||list.length>=LM_TILE_MAX?list:[...list,id];
return list.length>1?list.filter((x)=>x!==id):list;
}

export function moveTile(list,id,dir){
const i=list.indexOf(id);
const j=i+dir;
if(i<0||j<0||j>=list.length)return list;
const out=[...list];
[out[i],out[j]]=[out[j],out[i]];
return out;
}

export function allTilesFor(view){
return ALL_IDS.filter((id)=>{try{return cellFor(id,view,TAB_FPS).validity!==null;}catch(_){return false;}}).slice(0,LM_TILE_MAX);
}

export function needsRederive(shot,version){
if(!shot||shot.capture?.view==='dtl')return false;
const v=shot.algorithms?.lm?.version??'none';
return v==='none'||(typeof version==='string'&&version!=='none'&&v!==version);
}

export function neighbours(shots,id){
const list=[...shots].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.shot_id).localeCompare(String(b.shot_id)));
const i=list.findIndex((s)=>s.shot_id===id);
return{prev:i>0?list[i-1].shot_id:null,next:i>=0&&i<list.length-1?list[i+1].shot_id:null,i,n:list.length};
}
const isNull=(m)=>!m||typeof m.value!=='number'||!Number.isFinite(m.value);
const sigmaOf=(m)=>(Number.isFinite(m?.sigma)?m.sigma:(Array.isArray(m?.ci95)&&m.ci95.every(Number.isFinite)?(m.ci95[1]-m.ci95[0])/3.92:null));

export function topPoint(shot){
const L=shot?.flight?.landing;
if(!L)return null;
const m=shot.metrics??{};
const side=shot.capture?.view==='face_on'||!Number.isFinite(L.y_m)?null:L.y_m;
return{x:L.x_m,y:side,sx:sigmaOf(m.carry_m),sy:side===null?null:sigmaOf(m.carry_side_m),club:shot.club?.type??null,validity:m.carry_m?.validity??'estimated'};
}

export function inputsFor(id,view){
const d=REGISTRY[id]?.depends;
return(Array.isArray(d)?d:d?.[view]??[]).filter((x)=>x!==id);
}

const tx=(k,p)=>t(`tiles.${k}`,p);
const reasonText=(c,part)=>(has(`reason.${c}.${part}`)?t(`reason.${c}.${part}`):'');
const reducedMotion=()=>Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const vizMod=()=>import('../viz/index.js');
const lmMod=()=>import('../physics/lm/index.js');

export function createResults(ctx){
const{app,units}=ctx;
let shot=ctx.shot;
const view=shot.capture?.view??'face_on';
const metrics=shot.metrics??{};
const cleanups=[];
const sheets=new Set();
const lmSettings=()=>app.settings?.()?.lm??null;
let ids=tileIds(lmSettings(),view);

function openSheet(o){
const s=C.sheet({...o,onClose:(r)=>{sheets.delete(s);o.onClose?.(r);}});
sheets.add(s);
return s.open();
}


let nav=null;
function topRow(){
const chip=h('button.chip.lm-club',{type:'button','data-testid':'shot-club','aria-label':tx('club.change',{name:clubName(shot.club?.type)})},
C.icon('club'),h('span',clubName(shot.club?.type)));
chip.addEventListener('click',openClubs);
const prev=navBtn('shot-prev','chevron-left','nav.prev');
const next=navBtn('shot-next','chevron-right','nav.next');
const pos=h('span.lm-pos');
nav=h('div.lm-nav',{role:'group','aria-label':tx('nav.label')},prev,next);
const row=h('div.lm-top',{},chip,
h('p.lm-meta',{},`${viewName(view)} · ${fmtDateTime(shot.created_at)}`,pos,shot.revision>0?h('span.tag-corrected',t('shot.corrected')):null));
if(app.repo&&shot.session_id){
app.repo.queryShots({session_id:shot.session_id}).then((list)=>{
const nb=neighbours(list??[],shot.shot_id);
if(nb.n>1&&nb.i>=0)pos.textContent=` · ${tx('nav.pos',{i:nb.i+1,n:nb.n})}`;
for(const[b,target]of[[prev,nb.prev],[next,nb.next]]){
if(!target)continue;
b.disabled=false;
b.addEventListener('click',()=>ctx.go(target));
}
}).catch(()=>{});
}
return row;
}
function navBtn(testid,icon,key){
return h('button.icon-btn.lm-navbtn',{type:'button','data-testid':testid,'aria-label':tx(key),disabled:true},C.icon(icon));
}

function openClubs(){
const list=h('div.lm-clubs',{role:'group','aria-label':tx('club.title')});
let s=null;
for(const[type]of CLUBS){
const on=type===shot.club?.type;
const b=C.button({label:clubName(type),variant:on?'tinted':'secondary',size:'lg',block:true,testid:'shot-club-option'});
b.setAttribute('aria-pressed',String(on));
b.addEventListener('click',()=>{s?.close();if(!on)changeClub(type);});
list.append(b);
}
s=openSheet({title:tx('club.title'),content:h('div',{},h('p.hint',tx('club.hint')),list),testid:'shot-club-sheet'});
}

async function recomputed(base){
const L=await lmMod();
const s=lmSettings()??{};
return L.rederive(base,{settings:{ground:s.ground??'normal',crossView:false},clubProfile:null});
}
function patchOf(before,after,extra={}){
const p={...extra};
for(const k of['metrics','flight','tracks','algorithms','quality'])if(k in after&&JSON.stringify(after[k])!==JSON.stringify(before[k]))p[k]=after[k];
return p;
}
async function save(next,key,params){
if(app.repo)await app.repo.shots.put(next);
ctx.onSaved(next,key,params);
}

async function changeClub(type){
const club={...shot.club,type,length_m:clubLength(type)??shot.club?.length_m};
try{
if(view==='dtl'){await save(bumpRevision(shot,{club},{at:nowIso()}),'club.changed_only');return;}
const derived=await recomputed({...shot,club});
await save(bumpRevision(shot,patchOf(shot,derived,{club}),{at:nowIso()}),'club.changed');
}catch(e){
app.errors?.report?.(e,{where:'shot.club'});
C.toast.error(tx('rederive.failed'));
}
}


function rederiveCard(){
const card=h('div.lm-rederive');
lmMod().then((L)=>{
if(!needsRederive(shot,L.LM_PARAMS?.version))return;
const none=(shot.algorithms?.lm?.version??'none')==='none';
const btn=C.button({label:tx('rederive.button'),icon:'undo',variant:'tinted',size:'lg',testid:'shot-rederive'});
btn.addEventListener('click',async()=>{
btn.setDisabled(true);
try{
const derived=await recomputed(shot);
const next=bumpRevision(shot,patchOf(shot,derived),{at:nowIso()});
await save(next,'rederive.done',{n:next.revision});
}catch(e){
app.errors?.report?.(e,{where:'shot.rederive'});
C.toast.error(tx('rederive.failed'));
btn.setDisabled(false);
}
});
clear(card,h('p',tx(none?'rederive.none':'rederive.stale')),btn);
}).catch(()=>{});
return card;
}


const grid=h('ul.data-tiles.lm-tiles',{'data-testid':'shot-hero','aria-label':t('shot.hero.label')});

const tile=(id,o={})=>{
const el=C.dataTile({metric:metrics[id]??null,id,units,...o});
const u=el.querySelector('.mt-unit');
if(u&&/^[°%]$/.test(u.textContent.trim()))el.querySelector('.mt-num')?.append(u);
return el;
};
let custom=isCustom(lmSettings());
const shown=(list=ids)=>shownIds(list,metrics,custom);

const editBtn=h('button.data-tile.lm-tile-add',{type:'button','data-testid':'shot-tiles-edit'},C.icon('plus'),h('span',tx('edit_tile')));
editBtn.addEventListener('click',()=>openEditor());
function paintTiles(list=ids){
clear(grid,shown(list).map((id)=>h('li',{'data-metric':id},tile(id,{testid:'shot-tile',onClick:()=>openDetail(id)}))),h('li.lm-tile-add-li',{},editBtn));
}
paintTiles();

const tilesEl=h('section.lm-tiles-wrap',{'aria-label':t('shot.hero.label')},grid,
h('p.lm-legend',tx('legend')));

function fmtRange(m,id){
if(!Array.isArray(m?.ci95)||!m.ci95.every(Number.isFinite))return null;
const[lo,hi]=m.ci95.map((v)=>fmtMetric({...m,value:v,ci95:null,sigma:null},units,{id}));
return tx('detail.range_val',{lo:lo.value,hi:hi.value,unit:lo.unit});
}
function openDetail(id){
const m=metrics[id]??null;
const f=fmtMetric(m,units,{id});
const nul=isNull(m);
const codes=m?.reason_codes??[];
const sec=(key,...kids)=>h('section.lm-detail-sec',{},h('h3',tx(`detail.${key}`)),...kids);
const inputs=inputsFor(id,view).map((d)=>h('li',{},h('span',metricName(d)),h('span.lm-in-val',fmtMetric(metrics[d]??null,units,{id:d}).text)));
const kind=nul?'null':(C.isInferred(m)?'inferred':'measured');
const origin=!nul&&has(`tiles.origin.${m.value_origin}`)?tx(`origin.${m.value_origin}`):null;
const range=nul?null:fmtRange(m,id);
const body=h('div.lm-detail',{},
h('p.lm-detail-value',{},h('span.lm-detail-num',f.text),C.validityTag(m?.validity??'not_computed'),kind==='inferred'?h('span.dt-est',tx('estimated_badge')):null),
has(`metric.${id}.meaning`)?sec('what',h('p',t(`metric.${id}.meaning`))):null,
sec('how',h('p',tx(`kind.${kind}`)),origin?h('p',origin):null),
inputs.length?sec('inputs',h('ul.lm-inputs',{},inputs)):null,
range?sec('range',h('p',range)):null,
codes.length?sec('reasons',h('ul.lm-reasons',{},codes.map((c)=>h('li',{},h('p',reasonText(c,'long')||reasonText(c,'short')),reasonText(c,'fix')?h('p.lm-fix',reasonText(c,'fix')):null)))):null);
openSheet({title:metricName(id),content:body,testid:'tile-detail'});
}


function openEditor(){
let list=[...ids];
let preset=lmSettings()?.tilePreset==='custom'?'custom':'auto';
const body=h('div.tiles-edit');
const note=h('p.hint.lm-edit-note',{role:'status'});
const set=(next,focus)=>{
if(next!==list){list=next;preset='custom';custom=true;}
paint(focus);
paintTiles(list);
};
const row=(id,on,i)=>{
const sw=C.switchRow({label:metricName(id),checked:on,testid:'tiles-toggle',onChange:(v)=>{
const next=toggleTile(list,id,v);
note.textContent=next===list?tx(v?'sheet.max':'sheet.min',{n:LM_TILE_MAX}):'';
set(next,[id,'tiles-toggle']);
}});
const li=h('li.tiles-row',{'data-testid':'tiles-row','data-metric':id},sw);
if(on){
const mv=(dir,tid,icon)=>{
const b=h('button.icon-btn.lm-move',{type:'button','data-testid':tid,'aria-label':tx(dir<0?'sheet.up':'sheet.down',{name:metricName(id)}),disabled:dir<0?i===0:i===list.length-1},C.icon(icon));
b.addEventListener('click',()=>set(moveTile(list,id,dir),[id,tid]));
return b;
};
li.append(h('div.lm-move-pair',{},mv(-1,'tiles-up','chevron-down'),mv(1,'tiles-down','chevron-down')));
}
return li;
};
function paint(focus){
const autoSw=C.switchRow({label:tx('sheet.auto'),hint:tx('sheet.auto_hint',{view:viewName(view)}),checked:preset==='auto',testid:'tiles-auto',onChange:(v)=>{
if(v){list=tileDefaults(view);preset='auto';custom=false;paint(['','tiles-auto']);paintTiles(list);}else{preset='custom';custom=true;paintTiles(list);}
}});
const tools=h('div.lm-edit-tools',{},
C.button({label:tx('sheet.all'),variant:'secondary',size:'md',testid:'tiles-all',onClick:()=>set(allTilesFor(view),['','tiles-all'])}),
C.button({label:tx('sheet.reset'),variant:'secondary',size:'md',testid:'tiles-reset',onClick:()=>{list=tileDefaults(view);preset='auto';custom=false;paint(['','tiles-reset']);paintTiles(list);}}));
const groups=Object.entries(TILE_GROUPS).map(([g,gids])=>{
const off=gids.filter((id)=>!list.includes(id));
return off.length?h('section.lm-edit-group',{},h('h3',tx(`group.${g}`)),h('ul.lm-edit-list',{},off.map((id)=>row(id,false,-1)))):null;
});
clear(body,autoSw,tools,note,
h('section.lm-edit-group',{},h('h3',tx('sheet.shown',{n:list.length,max:LM_TILE_MAX})),h('ul.lm-edit-list',{},list.map((id,i)=>row(id,true,i)))),
groups);
if(focus){
const[id,tid]=focus;
const sel=id?`[data-metric="${id}"] [data-testid="${tid}"]`:`[data-testid="${tid}"]`;
const el=body.querySelector(`${sel}:not([disabled])`)??(id?body.querySelector(`[data-metric="${id}"] [role="switch"]`):null);
el?.focus?.();
}
}
paint();
openSheet({title:tx('sheet.title'),content:body,testid:'tiles-sheet',onClose:()=>{
ids=preset==='auto'?tileDefaults(view):list;
custom=preset==='custom';
app.updateSettings?.(saveSettings({lm:{tiles:list,tilePreset:preset}}));
paintTiles(ids);
}});
}


const vizEl=h('section.lm-viz',{'data-testid':'shot-viz','aria-label':tx('viz.label')});
let tab='side';
let panel=null;
let live=null;
const flight=shot.flight;
const clipOk=Boolean(shot.capture?.clip_ref)&&!(shot.quality?.warnings??[]).includes(RC.CLIP_NOT_SAVED);
const tracerOk=clipOk&&Boolean(shot.tracks?.ball_px?.length||(flight&&shot.calibration?.camera));

function tempoCard(){
const fps=shot.capture?.nominal_fps??0;
const why=view==='dtl'?'dtl':fps<200?'fps':(shot.algorithms?.lm?.version??'none')==='none'?'none':'other';
return h('div.lm-tempo',{},h('h2',tx('viz.tempo_title')),
h('div.data-tiles.lm-tempo-tiles',{},TEMPO.map((id)=>tile(id))),
h('p.hint',tx(`viz.no_flight.${why}`)));
}

function buildViz(){
if(!flight){clear(vizEl,tempoCard());return;}
const tabs=h('div.lm-viz-tabs',{role:'tablist','aria-label':tx('viz.label')});
for(const k of TABS){
const off=k==='video'&&!tracerOk;
const b=h('button.lm-viz-tab',{type:'button',role:'tab','data-testid':'shot-viz-tab','data-tab':k,'aria-selected':String(k===tab),'aria-disabled':off?'true':null},tx(`viz.tab.${k}`));
b.addEventListener('click',()=>{if(!off)selectTab(k);});
tabs.append(b);
}
panel=h('div.lm-viz-panel',{role:'tabpanel'});
const why=!tracerOk?h('p.lm-viz-note',{},tx('viz.video_off',{reason:clipOk?tx('viz.no_tracer'):reasonText(RC.CLIP_NOT_SAVED,'short')})):null;
clear(vizEl,tabs,panel,why);
}

function label(cv,res,fallback){
const key=res?.a11y;
cv.setAttribute('aria-label',key&&has(key)?t(key,res.params??{}):tx(`viz.tab.${fallback}`));
}

async function selectTab(k){
tab=k;
for(const b of vizEl.querySelectorAll('[data-testid="shot-viz-tab"]'))b.setAttribute('aria-selected',String(b.dataset.tab===k));
await draw();
}

async function draw(){
if(!panel)return;
live?.destroy?.();live=null;
const k=tab;
let V;
try{V=await vizMod();}catch(e){clear(panel,h('p.hint',tx('viz.failed')));return;}
if(k!==tab||!panel.isConnected)return;
const cv=h('canvas.lm-canvas',{role:'img','data-tab':k,tabindex:k==='3d'?'0':null});
try{
if(k==='video'){live=tracer(V,cv);return;}
const strip=k==='top'&&topPoint(shot)?.y===null;
const extra=strip?h('p.lm-viz-note',tx('viz.side_unknown')):null;

const box=h('div.lm-canvas-box',strip?{style:{height:'11rem'}}:{},cv);
clear(panel,box,extra,k==='3d'?orbitButtons():null);
const one={samples:flight.samples,club:shot.club?.type??null,validity:metrics.carry_m?.validity??'estimated'};
const target=shot.practice?.target_m;
const paint=()=>{
const palette=V.vizPalette(cv);
let res;
if(k==='side')res=V.drawSide(cv,{flights:[{...one,rest:flight.rest??null,sigma:{carry:sigmaOf(metrics.carry_m),apex:sigmaOf(metrics.apex_m)}}],units,palette,target_m:target});
else{
const pt=topPoint(shot);
res=V.drawTop(cv,{points:[{...pt,band:pt.y===null?null:flight.band??null}],paths:pt.y===null?undefined:[one],units,palette,target:target?{x:target,y:0}:undefined});
}
label(cv,res,k);
};
if(k==='3d'){

const traj=V.createTraj3d(cv,{flights:[one],palette:()=>V.vizPalette(cv),units,target_m:target,onChange:(r)=>label(cv,r,'3d')});
label(cv,traj?.a11y?traj:null,'3d');
live={destroy:()=>traj?.destroy?.(),redraw:()=>traj?.redraw?.(),traj};
}else{
paint();
live={destroy(){},redraw:paint};
}
}catch(e){
app.errors?.report?.(e,{where:`shot.viz.${k}`,silent:true});
clear(panel,h('p.hint.lm-viz-fail',tx('viz.failed')));
}
}


function orbitButtons(){

const name=(b,key,short)=>{b.setLabel(t(`viz.traj3d.${short}`));b.setAttribute('aria-label',t(`viz.traj3d.${key}`));return b;};
const b=(key,short,testid,fn)=>name(C.button({variant:'secondary',size:'md',testid,onClick:fn}),key,short);
let top=false;
const pitch=b('to_top','top_short','viz3d-pitch',()=>{top=!top;live?.traj?.setPitch?.(top?'top':'oblique');name(pitch,top?'to_oblique':'to_top',top?'oblique_short':'top_short');});
return h('div',{},h('div.lm-orbit',{role:'group','aria-label':tx('viz.orbit')},
b('rotate_left','left_short','viz3d-left',()=>live?.traj?.rotate?.(-15)),
b('rotate_right','right_short','viz3d-right',()=>live?.traj?.rotate?.(15)),pitch),h('p.lm-viz-note',t('viz.traj3d.hint')));
}



function tracer(V,cv){
const cam=shot.calibration?.camera??null;
const W=cam?.W??shot.capture?.width??1920;
const H=cam?.H??shot.capture?.height??1080;
const fps=shot.capture?.effective_fps??shot.capture?.nominal_fps??240;
const track=shot.tracks??null;
const projected=cam&&flight?V.projectFlight(cam,flight.samples):[];
const impact=track?.impact_frame??shot.events?.impact?.frame??0;
const lastT=flight?.samples?.at(-1)?.[0]??0;
const end=Math.max(impact+Math.ceil(lastT*fps)+1,...(track?.ball_px??[]).map((p)=>p[0]+1));
const times=flight?.samples?.map((x)=>x[0]);
const paint=(frame)=>label(cv,V.drawTracer(cv,{track,projected,frame,palette:V.vizPalette(cv),reducedMotion:reducedMotion(),size:[W,H],times,fps}),'video');
const stage=h('div.lm-tracer',{style:{aspectRatio:`${W} / ${H}`}});
let url=null;
let video=null;
let rvfc=null;
const blob=ctx.clip?.blob??null;
const kids=[stage];
if(blob){
url=URL.createObjectURL(blob);
video=h('video.lm-tracer-video',{src:url,muted:true,playsInline:true,preload:'auto','aria-hidden':'true'});
video.muted=true;
video.addEventListener('loadedmetadata',()=>{try{video.currentTime=impact/fps;}catch(_){ }},{once:true});
const tick=(_now,meta)=>{
paint(Math.round((meta?.mediaTime??video.currentTime)*fps));
if(!video.paused&&!video.ended)rvfc=video.requestVideoFrameCallback?.(tick);
};
video.addEventListener('ended',()=>paint(end));
video.addEventListener('pause',()=>paint(end));
const play=C.button({label:tx('viz.play'),icon:'play',variant:'secondary',size:'md',testid:'viz-tracer-play',onClick:()=>{
if(reducedMotion()){paint(end);return;}
video.currentTime=Math.max(0,impact/fps-0.2);
video.play().then(()=>{if(video.requestVideoFrameCallback)rvfc=video.requestVideoFrameCallback(tick);}).catch(()=>paint(end));
}});
stage.append(video);
kids.push(play);
}else{
kids.push(h('p.lm-viz-note',tx('viz.video_missing')));
}
stage.append(cv);
clear(panel,...kids);
paint(end);
return{destroy(){if(rvfc&&video?.cancelVideoFrameCallback)video.cancelVideoFrameCallback(rvfc);video?.pause?.();if(url)URL.revokeObjectURL(url);},redraw:()=>paint(end)};
}

buildViz();
if(flight){

let tmr=null;
const later=()=>{clearTimeout(tmr);tmr=setTimeout(()=>live?.redraw?.(),60);};
const theme=later;
const mo=new MutationObserver(theme);
mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class','style']});
const scr=vizEl.closest?.('[data-screen]');
if(scr)mo.observe(scr,{attributes:true,attributeFilter:['data-live-theme']});
const mq=globalThis.matchMedia?.('(prefers-color-scheme: dark)');
mq?.addEventListener?.('change',theme);
const ro=typeof ResizeObserver==='function'?new ResizeObserver(later):null;
ro?.observe(vizEl);
cleanups.push(()=>{mo.disconnect();mq?.removeEventListener?.('change',theme);ro?.disconnect();clearTimeout(tmr);});
requestAnimationFrame(()=>draw());
}


async function state(name){

if(name==='tiles'){custom=true;paintTiles(allTilesFor(view));grid.scrollIntoView?.({block:'start'});return true;}
if(!TABS.includes(name))return false;
if(!flight){

let other=null;
try{other=(await app.repo?.shots?.list?.())?.find((s)=>s.flight&&s.capture?.view==='face_on'&&s.capture?.clip_ref)??null;}catch(_){ }
if(!other){try{other=await recomputed(shot);}catch(_){other=null;}}
if(!other?.flight)return false;
return ctx.onPreview(other,name);
}
await selectTab(name);
return true;
}

const top=topRow();
return{
top,
nav,
viz:vizEl,
tiles:tilesEl,
rederive:rederiveCard(),
ids:()=>shown(),
tempoShown:!flight,
state,
selectTab,
destroy(){
live?.destroy?.();live=null;
for(const f of cleanups)f();
for(const s of[...sheets])s.close();
},
};
}
