










import{h,clear,downloadLink}from'./dom.js';
import*as C from'./components.js';
import{t,plural,fmtDate,fmtTime,fmtNum}from'../i18n/index.js';
import{fmtMetric}from'../i18n/units.js';
import{exportJSON,exportCSV,importJSON}from'../store/export.js';
import{validateShot}from'../contract/validate.js';
import{clubName,viewName}from'./glossary.js';
import{openCompare}from'./compare.js';

const PAGE_ROWS=50;
const PAGE_GROUPS=20;
const OPEN_GROUPS=2;
const OPEN_SHOTS=20;
export const UNDO_MS=10000;


export function buildFilter({view,preset_id,club_type,starred}={}){
const f={};
if(view)f.view=view;
if(preset_id)f.preset_id=preset_id;
if(club_type)f.club_type=club_type;
if(starred)f.starred=true;
return f;
}


export function fileStamp(iso=new Date()){
const d=iso instanceof Date?iso:new Date(iso);
const ok=Number.isFinite(d.getTime())?d:new Date();
const p=(n)=>String(n).padStart(2,'0');
return`${ok.getFullYear()}-${p(ok.getMonth()+1)}-${p(ok.getDate())}-${p(ok.getHours())}${p(ok.getMinutes())}`;
}


const pendingDeletes=new Map();


export function shotOps(app){
const repo=()=>app.repo;
return{
async setStar(shot,on){
const r=repo();
if(!r)throw Object.assign(new Error('no repository'),{code:'REPO_UNAVAILABLE'});
if(typeof r.shots.setStar==='function')await r.shots.setStar(shot.shot_id,Boolean(on));
else{const cur=(await r.shots.get(shot.shot_id))??shot;await r.shots.put({...cur,starred:Boolean(on)});}
return{...((await r.shots.get(shot.shot_id))??shot),starred:Boolean(on)};
},
async softDelete(id){
const r=repo();
if(!r)throw Object.assign(new Error('no repository'),{code:'REPO_UNAVAILABLE'});
if(typeof r.shots.softDelete==='function')return r.shots.softDelete(id);
clearTimeout(pendingDeletes.get(id));
pendingDeletes.set(id,setTimeout(()=>{pendingDeletes.delete(id);r.deleteShot?.(id).catch(()=>{});},UNDO_MS+1000));
return true;
},
async restore(id){
const r=repo();
if(r&&typeof r.shots.restore==='function')return r.shots.restore(id);
clearTimeout(pendingDeletes.get(id));
pendingDeletes.delete(id);
return true;
},
isDeleted:(shot)=>Boolean(shot?.deleted_at||shot?.deleted)||pendingDeletes.has(shot?.shot_id),
};
}





export async function shareOrDownload(blob,name,outEl,{title}={}){
try{
const file=typeof File==='function'?new File([blob],name,{type:blob.type}):null;
if(file&&navigator.canShare?.({files:[file]})&&typeof navigator.share==='function'){
await navigator.share({files:[file],title:title??name});
return'shared';
}
}catch(e){
if(e?.name==='AbortError')return'cancelled';

}
if(outEl){
const a=downloadLink(blob,name,t('history.data.download',{name,size:fmtSize(blob.size)}));
a.classList.add('btn','btn-tinted','btn-lg','download-link');
clear(outEl,a);
}
return'link';
}

export function fmtSize(bytes){
if(!Number.isFinite(bytes))return t('common.unknown');
if(bytes>=1e9)return t('history.size.gb',{n:fmtNum(bytes/1e9,{digits:1})});
if(bytes>=1e6)return t('history.size.mb',{n:fmtNum(bytes/1e6,{digits:bytes>=1e8?0:1})});
return t('history.size.kb',{n:fmtNum(Math.max(1,Math.round(bytes/1e3)))});
}


export function groupShots(shots,venues=new Map()){
const groups=new Map();
for(const s of shots){
const key=s.session_id||`day-${String(s.created_at??'').slice(0,10)}`;
let g=groups.get(key);
if(!g){g={key,session_id:s.session_id??null,shots:[],venue:venues.get(s.venue_id)??null,views:new Set()};groups.set(key,g);}
g.shots.push(s);
if(s.capture?.view)g.views.add(s.capture.view);
}
const out=[...groups.values()];
for(const g of out){
g.shots.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
g.latest=g.shots[0]?.created_at??'';
}
out.sort((a,b)=>String(b.latest).localeCompare(String(a.latest)));
return out;
}

let lastShots=null;
export const loadedShots=()=>lastShots;





export function historySeg(app,cur,onLeave){
const nav=app.nav;
const g=C.segmented({options:['list','stats','gapping','patterns'].map((k)=>[k,t(`history.seg.${k}`)]),value:cur,label:t('history.seg.label'),
onChange:(v)=>{
if(v===cur)return;
onLeave?.();
const fromHist=cur!=='list'&&nav.stack().at(-1)==='history';
if(v==='list')return fromHist?nav.back():nav.root('history');
if(fromHist)nav.back();
nav.go(v);
}});
for(const b of g.children)Object.assign(b.dataset,{testid:'history-seg',seg:b.dataset.value});
return g;
}

const mean=(xs)=>(xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null);
const val=(m)=>(m&&Number.isFinite(m.value)?m.value:null);






function chevron(){
const ic=C.icon('chevron-right');
ic.classList.add('lr-chevron');
return ic;
}

function headline(shot,units){
const m=shot.metrics??{};
const pick=val(m.carry_m)!==null?['carry_m','ball_speed_mps']:['tempo_ratio','club_speed_mps'];
const parts=[];
let validity=null;
for(const id of pick){
if(val(m[id])===null)continue;
const f=fmtMetric({...m[id],ci95:null,sigma:null},units,{id});
parts.push(id==='tempo_ratio'?t('history.row.tempo',{v:f.value}):f.text);
const v=m[id].validity;
if(v==='low_confidence'||(v==='estimated'&&validity===null))validity=v;
}
if(!parts.length)return{nodes:t('history.row.no_numbers'),validity:null};
const out=[];
parts.forEach((x,i)=>{if(i)out.push(' · ');out.push(h('span.nowrap',x));});
return{nodes:out,validity};
}

export function mountHistory(root,app){
let shots=[];
let venues=new Map();
let clipBytes=0;
let filt={view:'',club_type:'',starred:false};
let compareMode=false;
const picks=new Map();
const openGroups=new Set();
const closedGroups=new Set();
const rowsShown=new Map();
let groupsShown=PAGE_GROUPS;
let status=null;
let teach=null;
const ops=shotOps(app);

let cacheSig=null;
const sig=()=>shots.map((s)=>`${s.shot_id}:${s.revision??0}:${s.starred?1:0}`).join('|');

async function load(){
if(!app.repo){shots=[];return;}
const all=await app.repo.queryShots({reverse:true});
shots=all.filter((s)=>!ops.isDeleted(s));
lastShots=shots;
try{venues=new Map((await app.repo.venues.list()).map((v)=>[v.venue_id,v]));}catch(_){venues=new Map();}
try{clipBytes=(await app.repo.clips.list()).reduce((a,c)=>a+(Number(c.bytes)||Number(c.blob?.size)||0),0);}catch(_){clipBytes=0;}
}

const visible=()=>shots.filter((s)=>(!filt.view||s.capture?.view===filt.view)&&(!filt.club_type||s.club?.type===filt.club_type)&&(!filt.starred||s.starred));

function filters(){
const viewItems=[['',t('history.filter.all')],...['face_on','dtl','high_behind'].filter((v)=>shots.some((s)=>s.capture?.view===v)).map((v)=>[v,viewName(v)]),['*',t('history.filter.starred')]];
const viewRow=C.chipRow({items:viewItems,value:filt.starred?'*':filt.view,label:t('history.filter.view_label'),testid:'history-filter-view',
onChange:(v)=>{filt={...filt,view:v==='*'?'':v,starred:v==='*'};render();}});
const clubs=[...new Set(shots.map((s)=>s.club?.type).filter(Boolean))];
const clubRow=clubs.length>1?C.chipRow({items:[['',t('history.filter.all_clubs')],...clubs.map((c)=>[c,clubName(c)])],value:filt.club_type,label:t('history.filter.club_label'),testid:'history-filter-club',
onChange:(v)=>{filt={...filt,club_type:v};render();}}):null;
return h('div.history-filters',{},viewRow,clubRow);
}

function groupHeader(g,open,units){
const d=g.shots[g.shots.length-1]?.created_at??g.latest;
const views=[...g.views].map(viewName).join(' / ');
const tempo=mean(g.shots.map((s)=>val(s.metrics?.tempo_ratio)).filter((x)=>x!==null));
const carry=mean(g.shots.map((s)=>val(s.metrics?.carry_m)).filter((x)=>x!==null));
const avg=[];
if(carry!==null)avg.push(t('history.group.avg_carry',{v:fmtMetric({value:carry,unit:'m'},units,{id:'carry_m'}).text}));
if(tempo!==null)avg.push(t('history.group.avg_tempo',{v:fmtNum(tempo,{digits:1})}));
const title=[fmtDate(d),g.venue?.name?String(g.venue.name).slice(0,60):null,views].filter(Boolean).join(' · ');
const sub=[plural('history.group.shots',g.shots.length),...avg].join(' · ');
const b=h('button.hg-head',{type:'button','aria-expanded':String(open),'data-testid':'history-session','data-session':g.key},
h('span.hg-text',{},h('span.hg-title',title),h('span.hg-sub',sub)),
h('span.hg-chev',{},C.icon('chevron-down')));
b.addEventListener('click',()=>{if(open){openGroups.delete(g.key);closedGroups.add(g.key);}else{openGroups.add(g.key);closedGroups.delete(g.key);}render();});
return b;
}

function row(s,units){
const time=fmtTime(s.created_at);
const{nodes:primary,validity}=headline(s,units);


const pill=validity?h(`span.vtag.sr-pill.vtag-${validity==='estimated'?'est':'low'}`,{'data-validity':validity},t(`validity.${validity}`)):null;
const tag=s.revision>0?h('span.tag-corrected',t('shot.corrected')):null;
const open=h('button.shot-row',{type:'button','data-testid':'shot-row','data-shot':s.shot_id},
h('span.club-chip',{'aria-hidden':'true'},clubName(s.club?.type)),
h('span.sr-main',{},h('span.sr-primary',primary,pill?' ':null,pill),h('span.sr-secondary',h('span.sr-club',`${clubName(s.club?.type)} · `),[time,viewName(s.capture?.view)].join(' · '),tag?' ':null,tag)),
chevron());
open.addEventListener('click',()=>app.nav.go('shot',{shot_id:s.shot_id},{opener:open}));
const star=h('button.icon-btn.star-btn',{type:'button','data-testid':'shot-star','aria-pressed':String(Boolean(s.starred)),'aria-label':t(s.starred?'history.row.unstar':'history.row.star',{time})},C.icon(s.starred?'star-filled':'star'));
star.addEventListener('click',async()=>{
try{const next=await ops.setStar(s,!s.starred);Object.assign(s,{starred:next.starred});render();}catch(e){app.errors?.report?.(e,{where:'history.star'});}
});
const del=h('button.icon-btn.del-btn',{type:'button','data-testid':'shot-delete','aria-label':t('history.row.delete',{time})},C.icon('trash'));
del.addEventListener('click',()=>remove(s));
let pick=null;
if(compareMode){
const p=picks.get(s.shot_id);
const ab=(k)=>{
const b=h('button.ab-btn',{type:'button','aria-pressed':String(p===k),'data-testid':`history-pick-${k.toLowerCase()}`,'aria-label':t(`history.compare.pick_${k.toLowerCase()}`,{time,club:clubName(s.club?.type)})},k);
b.addEventListener('click',()=>{if(picks.get(s.shot_id)===k)picks.delete(s.shot_id);else picks.set(s.shot_id,k);render();});
return b;
};
pick=h('span.ab',{},ab('A'),ab('B'));
}
return h('li.history-row',{'data-shot':s.shot_id},pick,open,compareMode?null:star,compareMode?null:del);
}

async function remove(s){
try{
await ops.softDelete(s.shot_id);
shots=shots.filter((x)=>x.shot_id!==s.shot_id);
picks.delete(s.shot_id);
render();
C.toast.info(t('history.deleted',{time:fmtTime(s.created_at)}),{
testid:'undo-toast',ms:UNDO_MS,
action:{label:t('common.undo'),testid:'undo-toast-undo',onClick:async()=>{
try{await ops.restore(s.shot_id);await load();render();C.toast.info(t('shot.restored'));}catch(e){app.errors?.report?.(e,{where:'history.restore'});}
}},
});
}catch(e){app.errors?.report?.(e,{where:'history.delete'});}
}

function list(units){
const vs=visible();
if(!shots.length){
return C.emptyState({icon:'history',title:t('history.empty.title'),body:t('history.empty.body'),action:{label:t('history.empty.action'),onClick:()=>app.nav.go('home'),testid:'history-empty-start'},testid:'history-empty'});
}
if(!vs.length)return C.emptyState({icon:'info',title:t('history.empty.filtered'),action:{label:t('history.filter.clear'),onClick:()=>{filt={view:'',club_type:'',starred:false};render();}}});
const groups=groupShots(vs,venues);
let opened=0;
const out=h('div.history-groups',{});
groups.slice(0,groupsShown).forEach((g,i)=>{
let open;
if(openGroups.has(g.key))open=true;
else if(closedGroups.has(g.key))open=false;
else open=i<OPEN_GROUPS||opened+g.shots.length<=OPEN_SHOTS;
if(open)opened+=g.shots.length;
const sec=h('section.history-group',{'data-session':g.key},groupHeader(g,open,units));
if(open){
const n=rowsShown.get(g.key)??PAGE_ROWS;
sec.append(h('ul.history-rows',{},g.shots.slice(0,n).map((s)=>row(s,units))));
if(g.shots.length>n){
sec.append(C.button({label:t('history.more_rows',{n:Math.min(PAGE_ROWS,g.shots.length-n),left:g.shots.length-n}),variant:'plain',size:'md',block:true,testid:'history-more-rows',
onClick:()=>{rowsShown.set(g.key,n+PAGE_ROWS);render();}}));
}
}
out.append(sec);
});
if(groups.length>groupsShown){
out.append(C.button({label:t('history.more_groups',{n:groups.length-groupsShown}),variant:'tinted',size:'lg',block:true,testid:'history-more-groups',onClick:()=>{groupsShown+=PAGE_GROUPS;render();}}));
}
return out;
}

function compareBar(){
if(!compareMode)return null;
const A=shots.filter((s)=>picks.get(s.shot_id)==='A');
const B=shots.filter((s)=>picks.get(s.shot_id)==='B');
const go=C.button({label:t('history.compare.open'),variant:'primary',size:'lg',testid:'history-compare-open',
reason:A.length&&B.length?null:t('history.compare.need'),
onClick:()=>openCompare({A,B,units:app.units?.()})});
return h('div.compare-bar',{role:'region','aria-label':t('history.compare.title')},
h('p.cb-text',t('history.compare.count',{a:A.length,b:B.length})),go);
}

function dataCard(){
const out=h('div.export-out',{'aria-live':'polite'});
const withClips=C.switchRow({label:t('history.data.with_videos'),hint:clipBytes>0?t('history.data.videos_size',{size:fmtSize(clipBytes)}):t('history.data.no_videos'),testid:'history-include-clips'});
const backup=C.button({label:t('history.data.backup'),icon:'download',variant:'secondary',size:'lg',block:true,testid:'history-export-json',
reason:app.repo?null:t('error.REPO_UNAVAILABLE'),
onClick:async()=>{
try{
backup.setDisabled(true);
const data=await exportJSON(app.repo,{includePoses:true,includeLabels:true,includeClips:withClips.checked,app_version:app.version?.()});
const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
await shareOrDownload(blob,`golf-swing-lab-backup-${fileStamp()}.json`,out,{title:t('history.data.backup')});
}catch(e){app.errors?.report?.(e,{where:'history.backup',slot:out});}finally{backup.setDisabled(false);}
}});
const csv=C.button({label:t('history.data.csv'),icon:'download',variant:'secondary',size:'lg',block:true,testid:'history-export-csv',
reason:shots.length?null:t('history.data.nothing'),
onClick:async()=>{
const blob=new Blob([exportCSV(visible(),{bom:true})],{type:'text/csv;charset=utf-8'});
await shareOrDownload(blob,`golf-swing-lab-${fileStamp()}.csv`,out,{title:t('history.data.csv')});
}});
const restore=C.filePicker({accept:'.json,application/json',label:t('history.data.restore'),testid:'history-import-input',id:'hist-import',onFiles:(files)=>restoreFrom(files[0])});
const st=status?h(`p.data-status.${status.kind}`,{role:status.kind==='error'?'alert':'status','data-testid':'history-restore-status'},status.text):null;
return h('section.card.data-card',{},h('h2',t('history.data.title')),
h('p.hint',t('history.data.hint')),withClips,backup,csv,restore,st,out);
}

async function restoreFrom(f){
if(!f)return;
if(!app.repo){status={kind:'error',text:t('error.REPO_UNAVAILABLE')};render();return;}
if(f.size>2e9){status={kind:'error',text:t('history.restore.error.too_big')};render();return;}
try{
const text=await f.text();
const r=await importJSON(app.repo,text,{validate:validateShot});

status={kind:r.total.added+r.total.updated>0?'ok':'info',text:t('history.restore.done',{added:r.total.added,updated:r.total.updated,kept:r.total.kept})};
await load();
}catch(e){
app.errors?.report?.(e,{where:'history.restore',silent:true});
const reason=e?.reason??'invalid';
status={kind:'error',text:`${t(`history.restore.error.${reason}`,e?.params??{})} ${t('history.restore.error.nothing_written')}`};
}
render();
}

function render(){
if(teach)return;
cacheSig=sig();
const units=app.units?.()??undefined;
const toggle=h('button.btn.btn-plain.btn-md',{type:'button','aria-pressed':String(compareMode),'data-testid':'history-compare-toggle'},t(compareMode?'history.compare.done':'history.compare.toggle'));
toggle.addEventListener('click',()=>{compareMode=!compareMode;if(!compareMode)picks.clear();render();});
const teachRow=C.listRow({icon:'target',title:t('history.teach.title'),subtitle:t('history.teach.subtitle'),onClick:()=>openTeach(),testid:'history-teach'});
clear(root,
C.screenHeader({title:t('screen.history.title'),actions:shots.length?toggle:null}),
historySeg(app,'list',()=>clear(root)),
app.repo?null:C.notice({variant:'error',title:t('error.REPO_UNAVAILABLE'),body:t('error.REPO_UNAVAILABLE.fix')}),
shots.length?filters():null,
compareMode?h('p.hint',t('history.compare.hint')):null,
list(units),
compareBar(),
h('div.list-group',{},teachRow),
dataCard());
}

async function openTeach(){
if(document.querySelector('[data-screen="teach"]')){app.nav.go('teach');return;}
const{mountTeach}=await import('./teach.js');
teach=mountTeach(root,app,{onBack:()=>{teach?.hide();teach=null;render();}});
await teach.show({});
}

return{
async show(params={}){
teach?.hide();teach=null;
if(params.view==='teach'){await openTeach();return;}
if(cacheSig!==null){

render();
load().then(()=>{const s2=sig();if(s2!==cacheSig){cacheSig=s2;render();}},(e)=>app.errors?.report?.(e,{where:'history.load'}));
return;
}
clear(root,C.screenHeader({title:t('screen.history.title')}),h('p.hint',t('common.loading')));
try{await load();}catch(e){app.errors?.report?.(e,{where:'history.load'});}
cacheSig=sig();
render();
},
hide(){teach?.hide();teach=null;},
};
}
