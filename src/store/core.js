



































import{RC}from'../contract/reason-codes.js';

export const DB_NAME='golf-swing-lab';
export const SCHEMA_VERSION=4;

function deepFreeze(o){
for(const v of Object.values(o))if(v!==null&&typeof v==='object')deepFreeze(v);
return Object.freeze(o);
}

export const STORE_DEFS=deepFreeze({
venues:{keyPath:'venue_id',indexes:{name:'name',created_at:'created_at'}},
presets:{keyPath:'preset_id',indexes:{venue_id:'venue_id',view:'view',created_at:'created_at'}},
sessions:{keyPath:'session_id',indexes:{venue_id:'venue_id',created_at:'created_at'}},
shots:{
keyPath:'shot_id',
indexes:{
session_id:'session_id',
preset_id:'preset_id',
venue_id:'venue_id',
view:'capture.view',
club_type:'club.type',
created_at:'created_at',
},
},
poses:{keyPath:'shot_id',indexes:{session_id:'session_id',created_at:'created_at'}},
clips:{keyPath:'clip_id',indexes:{shot_id:'shot_id',session_id:'session_id',created_at:'created_at'}},

labels:{keyPath:'shot_id',indexes:{labelled_at:'labelled_at'}},
models:{keyPath:'slot',indexes:{imported_at:'imported_at'}},


trash:{keyPath:'shot_id',indexes:{deleted_at:'deleted_at'}},

drills:{keyPath:'drill_id',indexes:{created_at:'created_at',template:'template'}},
});


export const V1_STORE_NAMES=Object.freeze(['venues','presets','sessions','shots','poses','clips']);

export const STORE_NAMES=Object.freeze(Object.keys(STORE_DEFS));








export const MIGRATIONS=Object.freeze([
Object.freeze({version:2,up:async()=>{ }}),
Object.freeze({version:3,up:async()=>{ }}),
Object.freeze({version:4,up:async()=>{ }}),
]);


export const MIGRATE_BATCH=50;

let migrateModP=null;

function migrator(){
if(!migrateModP)migrateModP=import('../contract/migrate.js');
return migrateModP;
}
async function toV2(rec){
if(rec===null||rec===undefined)return rec;
const{migrateShot}=await migrator();
return migrateShot(rec).shot;
}
async function allToV2(rows){
const{migrateShot}=await migrator();
return rows.map((r)=>migrateShot(r).shot);
}




const pad=(n,w=2)=>String(n).padStart(w,'0');


export function isoFromMs(ms){
if(!Number.isFinite(ms))return null;
const msDay=86400000;
let days=Math.floor(ms/msDay);
let rem=ms-days*msDay;

days+=719468;
const era=Math.floor(days/146097);
const doe=days-era*146097;
const yoe=Math.floor((doe-Math.floor(doe/1460)+Math.floor(doe/36524)-Math.floor(doe/146096))/365);
const doy=doe-(365*yoe+Math.floor(yoe/4)-Math.floor(yoe/100));
const mp=Math.floor((5*doy+2)/153);
const d=doy-Math.floor((153*mp+2)/5)+1;
const m=mp<10?mp+3:mp-9;
const y=yoe+era*400+(m<=2?1:0);
const hh=Math.floor(rem/3600000);rem-=hh*3600000;
const mi=Math.floor(rem/60000);rem-=mi*60000;
const ss=Math.floor(rem/1000);rem-=ss*1000;
return`${pad(y,4)}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mi)}:${pad(ss)}.${pad(Math.round(rem),3)}Z`;
}


export function msFromIso(iso){
const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(String(iso??''));
if(!m)return NaN;
let y=Number(m[1]);
const mo=Number(m[2]);
const d=Number(m[3]);
y-=mo<=2?1:0;
const era=Math.floor(y/400);
const yoe=y-era*400;
const doy=Math.floor((153*(mo+(mo>2?-3:9))+2)/5)+d-1;
const doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;
const days=era*146097+doe-719468;
const frac=m[7]?Number(`0.${m[7]}`)*1000:0;
let ms=days*86400000+Number(m[4])*3600000+Number(m[5])*60000+Number(m[6]??0)*1000+frac;
if(m[8]!=='Z'){
const sign=m[8][0]==='-'?-1:1;
ms-=sign*(Number(m[8].slice(1,3))*3600000+Number(m[8].slice(4,6))*60000);
}
return Math.round(ms);
}


export function isQuotaError(e){
if(!e)return false;
if(e.name==='QuotaExceededError'||e.code===22||e.code==='QUOTA_EXCEEDED')return true;
return Boolean(e.cause&&e.cause!==e&&isQuotaError(e.cause));
}






export class StoreError extends Error{
constructor(code,message,cause){
super(message);
this.name='StoreError';
this.code=code;
if(cause!==undefined)this.cause=cause;
}
}



export function getPath(obj,path){
let cur=obj;
for(const part of path.split('.')){
if(cur===null||cur===undefined||typeof cur!=='object')return undefined;
cur=cur[part];
}
return cur;
}


export function isValidKey(k){
return typeof k==='string'||(typeof k==='number'&&!Number.isNaN(k));
}

export function compareKeys(a,b){
const ta=typeof a;
const tb=typeof b;
if(ta!==tb)return ta==='number'?-1:1;
return a<b?-1:a>b?1:0;
}

export function isKeyRange(q){
return q!==null&&typeof q==='object'&&!Array.isArray(q)&&
('gte'in q||'gt'in q||'lte'in q||'lt'in q);
}


export function matchesQuery(key,q){
if(q===undefined)return true;
if(!isKeyRange(q))return key===q;
if(q.gte!==undefined&&!(compareKeys(key,q.gte)>=0))return false;
if(q.gt!==undefined&&!(compareKeys(key,q.gt)>0))return false;
if(q.lte!==undefined&&!(compareKeys(key,q.lte)<=0))return false;
if(q.lt!==undefined&&!(compareKeys(key,q.lt)<0))return false;
return true;
}

function normalizeQuery(q){
if(q===undefined)return undefined;
if(isKeyRange(q)){
for(const[k,v]of Object.entries(q)){
if(!['gte','gt','lte','lt'].includes(k)||!isValidKey(v)){
throw new StoreError('BAD_QUERY',`bad query range key: ${k}`);
}
}
return{...q};
}
if(!isValidKey(q))throw new StoreError('BAD_QUERY','a query value must be a string or a number');
return q;
}





export const SHOT_FILTER_KEYS=Object.freeze(['session_id','preset_id','venue_id','view','club_type','lie',
'from','to','starred']);
const SHOT_QUERY_EXTRA_KEYS=['limit','reverse'];

export function assertShotFilter(filter){
const f=filter??{};
if(typeof f!=='object'||Array.isArray(f))throw new StoreError('BAD_QUERY','a shot filter must be an object');
for(const k of Object.keys(f)){
if(!SHOT_FILTER_KEYS.includes(k)&&!SHOT_QUERY_EXTRA_KEYS.includes(k)){
throw new StoreError('BAD_QUERY',`unknown shot filter key: ${k}`);
}
}
return f;
}

function anyOf(want,have){
if(want===undefined||want===null)return true;
return Array.isArray(want)?want.includes(have):want===have;
}

export function matchesShotFilter(shot,f){
if(!anyOf(f.session_id,shot.session_id))return false;
if(!anyOf(f.preset_id,shot.preset_id))return false;
if(!anyOf(f.venue_id,shot.venue_id))return false;
if(!anyOf(f.view,getPath(shot,'capture.view')))return false;
if(!anyOf(f.club_type,getPath(shot,'club.type')))return false;
if(!anyOf(f.lie,getPath(shot,'club.lie')))return false;
if(f.starred!==undefined&&f.starred!==null&&Boolean(shot.starred)!==Boolean(f.starred))return false;
if((f.from!==undefined&&f.from!==null)||(f.to!==undefined&&f.to!==null)){
const t=shot.created_at;
if(!isValidKey(t))return false;
if(f.from!==undefined&&f.from!==null&&compareKeys(t,f.from)<0)return false;
if(f.to!==undefined&&f.to!==null&&compareKeys(t,f.to)>0)return false;
}
return true;
}


export function sortShots(shots){
return shots.slice().sort((a,b)=>
compareKeys(a.created_at??'',b.created_at??'')||compareKeys(a.shot_id??'',b.shot_id??''));
}


export function filterShots(shots,filter){
const f=assertShotFilter(filter);
let rows=sortShots(shots.filter((s)=>matchesShotFilter(s,f)));
if(f.reverse)rows.reverse();
if(f.limit!==undefined&&f.limit!==null)rows=rows.slice(0,f.limit);
return rows;
}



export function revisionOf(rec){
return rec&&Number.isFinite(rec.revision)?rec.revision:0;
}



const INDEXED_FILTERS=[
['session_id','session_id'],
['preset_id','preset_id'],
['venue_id','venue_id'],
['view','view'],
['club_type','club_type'],
];

const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

export class Repository{
constructor(backend,{stores=STORE_DEFS,version=SCHEMA_VERSION,oldVersion=0}={}){
this._backend=backend;
this.stores=stores;
this.schemaVersion=version;
this.openedFromVersion=oldVersion;


for(const name of Object.keys(stores)){
this[name]={
get:(id)=>this.get(name,id),
put:(rec)=>this.put(name,rec),
putMany:(recs)=>this.putMany(name,recs),
delete:(id)=>this.delete(name,id),
list:(opts)=>this.list(name,opts),
count:()=>this.count(name),
};
}

if(this.shots)this.shots.get=async(id)=>toV2(await this.get('shots',id));
if(this.shots&&!has(stores,'trash'))this.shots.list=async(opts)=>allToV2(await this.list('shots',opts));
if(this.shots&&has(stores,'trash')){
Object.assign(this.shots,{
list:async(opts={})=>allToV2(await this.listShots(opts)),
softDelete:(id,opts)=>this.softDeleteShot(id,opts),
restore:(id)=>this.restoreShot(id),
purgeDeleted:(opts)=>this.purgeDeleted(opts),
listDeleted:()=>this.list('trash',{index:'deleted_at'}),
setStar:(id,starred)=>this.setStar(id,starred),
});
}
if(this.labels)this.labels.unlabelledWithClips=()=>this.unlabelledWithClips();
}

_def(store){
if(typeof store!=='string'||!has(this.stores,store)){
throw new StoreError('BAD_STORE',`unknown store: ${String(store)}`);
}
return this.stores[store];
}

_key(store,rec){
const def=this._def(store);
if(rec===null||typeof rec!=='object'||Array.isArray(rec)){
throw new StoreError('BAD_RECORD',`${store}: a record must be an object`);
}
const key=getPath(rec,def.keyPath);
if(typeof key!=='string'||key===''){
throw new StoreError('BAD_RECORD',`${store}: missing ${def.keyPath} (a non-empty string)`);
}
return key;
}

_wrapTx(raw,names,writable){
const use=(s)=>{
this._def(s);
if(!names.includes(s))throw new StoreError('BAD_STORE',`store ${s} is not part of this transaction`);
};
const write=()=>{
if(!writable)throw new StoreError('READONLY','a readonly transaction cannot write');
};
return{
get:async(s,id)=>{use(s);return(await raw.get(s,id))??null;},
put:async(s,rec)=>{use(s);write();const key=this._key(s,rec);await raw.put(s,rec);return key;},
delete:async(s,id)=>{use(s);write();await raw.delete(s,id);},
getAll:async(s)=>{use(s);return raw.getAll(s);},
getAllByIndex:async(s,index,q)=>{
use(s);
if(!has(this.stores[s].indexes,index))throw new StoreError('BAD_QUERY',`${s} has no index ${index}`);
return raw.getAllByIndex(s,index,normalizeQuery(q));
},
clear:async(s)=>{use(s);write();await raw.clear(s);},
};
}


async transaction(storeNames,mode,fn){
const names=[...new Set(storeNames)];
names.forEach((n)=>this._def(n));
if(mode!=='readonly'&&mode!=='readwrite')throw new StoreError('BAD_QUERY',`unknown transaction mode: ${mode}`);
return this._backend.transaction(names,mode,(raw)=>fn(this._wrapTx(raw,names,mode==='readwrite')));
}

async get(store,id){
this._def(store);
return this.transaction([store],'readonly',(tx)=>tx.get(store,id));
}


async put(store,rec){
return this.transaction([store],'readwrite',(tx)=>tx.put(store,rec));
}

async putMany(store,recs){
return this.batch(recs.map((record)=>({op:'put',store,record})));
}

async delete(store,id){
this._def(store);
return this.transaction([store],'readwrite',(tx)=>tx.delete(store,id));
}


async list(store,{index,query,limit,reverse}={}){
const def=this._def(store);
if(index===undefined&&query!==undefined)throw new StoreError('BAD_QUERY','a query needs an index');
if(index!==undefined&&!has(def.indexes,index))throw new StoreError('BAD_QUERY',`${store} has no index ${index}`);
const rows=await this.transaction([store],'readonly',(tx)=>
index===undefined?tx.getAll(store):tx.getAllByIndex(store,index,query));
if(reverse)rows.reverse();
return limit===undefined||limit===null?rows:rows.slice(0,limit);
}

async count(store){
return(await this.list(store)).length;
}


async clear(store){
const names=store===undefined?Object.keys(this.stores):[store];
return this.transaction(names,'readwrite',async(tx)=>{
for(const n of names)await tx.clear(n);
});
}


async batch(ops){
for(const o of ops){
if(o.op==='put')this._key(o.store,o.record);
else if(o.op==='delete')this._def(o.store);
else throw new StoreError('BAD_QUERY',`unknown batch op: ${String(o.op)}`);
}
const names=[...new Set(ops.map((o)=>o.store))];
if(names.length===0)return 0;
await this.transaction(names,'readwrite',async(tx)=>{
await Promise.all(ops.map((o)=>(o.op==='put'?tx.put(o.store,o.record):tx.delete(o.store,o.id))));
});
return ops.length;
}


async snapshot(storeNames){
return this.transaction(storeNames,'readonly',async(tx)=>{
const out={};
for(const n of storeNames)out[n]=await tx.getAll(n);
return out;
});
}





async merge(byStore){
const names=Object.keys(byStore);
for(const n of names)for(const rec of byStore[n])this._key(n,rec);
return this.transaction(names,'readwrite',async(tx)=>{
const counts={};
for(const n of names){
const c={added:0,updated:0,kept:0};
const keyPath=this.stores[n].keyPath;
for(const rec of byStore[n]){
const cur=await tx.get(n,getPath(rec,keyPath));
if(cur===null){await tx.put(n,rec);c.added++;}
else if(revisionOf(rec)>revisionOf(cur)){await tx.put(n,rec);c.updated++;}
else c.kept++;
}
counts[n]=c;
}
return counts;
});
}



async queryShots(filter={}){
return allToV2(await this._queryShotsRaw(filter));
}






async migrateBatch(n=MIGRATE_BATCH){
const{migrateShot,SCHEMA_V1}=await migrator();
const limit=Math.max(1,Math.floor(Number(n)||MIGRATE_BATCH));
return this.transaction(['shots'],'readwrite',async(tx)=>{
const old=(await tx.getAll('shots')).filter((s)=>s&&s.schema===SCHEMA_V1);
const batch=old.slice(0,limit);
for(const s of batch)await tx.put('shots',migrateShot(s).shot);
return{migrated:batch.length,remaining:old.length-batch.length};
});
}

async _queryShotsRaw(filter={}){
const f=assertShotFilter(filter);
const scalar=(v)=>typeof v==='string'||typeof v==='number';
const pick=INDEXED_FILTERS.find(([key])=>scalar(f[key]));
let rows;
if(pick)rows=await this.list('shots',{index:pick[1],query:f[pick[0]]});
else if(scalar(f.from)||scalar(f.to)){
const range={};
if(scalar(f.from))range.gte=f.from;
if(scalar(f.to))range.lte=f.to;
rows=await this.list('shots',{index:'created_at',query:range});
}else rows=await this.list('shots');
return filterShots(rows,f);
}


async deleteShot(shotId){
const trash=has(this.stores,'trash');
return this.transaction(['shots','poses','clips',...(trash?['trash']:[])],'readwrite',async(tx)=>{
const out={shot:false,pose:false,clips:0};
if((await tx.get('shots',shotId))!==null){out.shot=true;await tx.delete('shots',shotId);}
if(trash&&(await tx.get('trash',shotId))!==null){out.shot=true;await tx.delete('trash',shotId);}
if((await tx.get('poses',shotId))!==null){out.pose=true;await tx.delete('poses',shotId);}
for(const clip of await tx.getAllByIndex('clips','shot_id',shotId)){
await tx.delete('clips',clip.clip_id);
out.clips++;
}
return out;
});
}




async listShots({includeDeleted=false,...opts}={}){
const rows=await this.list('shots',opts);
if(!includeDeleted||!has(this.stores,'trash'))return rows;
const gone=await this.list('trash');
return[...rows,...gone.map((t)=>t.shot).filter(Boolean)];
}


_nowMs(){
const n=typeof this._backend.now==='function'?this._backend.now():null;
return Number.isFinite(n)?n:null;
}


async softDeleteShot(shotId,{at}={}){
const when=typeof at==='string'&&at!==''?at:isoFromMs(this._nowMs());
if(!when)throw new StoreError('BAD_RECORD','softDelete needs { at: ISO time } (this backend has no clock)');
at=when;
return this.transaction(['shots','trash'],'readwrite',async(tx)=>{
const shot=await tx.get('shots',shotId);
if(shot===null)return{ok:false,deleted_at:null};
await tx.put('trash',{shot_id:shotId,deleted_at:at,shot});
await tx.delete('shots',shotId);
return{ok:true,deleted_at:at};
});
}


async restoreShot(shotId){
return this.transaction(['shots','trash'],'readwrite',async(tx)=>{
const t=await tx.get('trash',shotId);
if(t===null||!t.shot||(await tx.get('shots',shotId))!==null)return{ok:false};
await tx.put('shots',t.shot);
await tx.delete('trash',shotId);
return{ok:true};
});
}






async purgeDeleted({olderThanMs=0,now=null}={}){
let cutoffMs=null;
if(olderThanMs>0){
const t=typeof now==='string'?msFromIso(now):this._nowMs();
if(!Number.isFinite(t))throw new StoreError('BAD_QUERY','purgeDeleted with olderThanMs needs { now: ISO time }');
cutoffMs=t-olderThanMs;
}
const names=['trash','poses','clips',...(has(this.stores,'labels')?['labels']:[])];
return this.transaction(names,'readwrite',async(tx)=>{
const out={purged:0,clips:0};
for(const t of await tx.getAll('trash')){
if(cutoffMs!==null&&!(msFromIso(t.deleted_at)<cutoffMs))continue;
await tx.delete('trash',t.shot_id);
await tx.delete('poses',t.shot_id);
if(names.includes('labels'))await tx.delete('labels',t.shot_id);
for(const clip of await tx.getAllByIndex('clips','shot_id',t.shot_id)){await tx.delete('clips',clip.clip_id);out.clips++;}
out.purged++;
}
return out;
});
}


async setStar(shotId,starred){
const want=Boolean(starred);
return this.transaction(['shots','clips'],'readwrite',async(tx)=>{
const shot=await tx.get('shots',shotId);
if(shot===null)return{ok:false,starred:null};
if(Boolean(shot.starred)!==want)await tx.put('shots',{...shot,starred:want,revision:revisionOf(shot)+1});
for(const clip of await tx.getAllByIndex('clips','shot_id',shotId)){
if(Boolean(clip.starred)!==want)await tx.put('clips',{...clip,starred:want});
}
return{ok:true,starred:want};
});
}


async unlabelledWithClips(){
const names=['shots','clips',...(has(this.stores,'labels')?['labels']:[])];
return this.transaction(names,'readonly',async(tx)=>{
const withClip=new Set((await tx.getAll('clips')).map((c)=>c.shot_id));
const labelled=names.includes('labels')?new Set((await tx.getAll('labels')).map((l)=>l.shot_id)):new Set();
const rows=(await tx.getAll('shots')).filter((s)=>withClip.has(s.shot_id)&&!labelled.has(s.shot_id));
return sortShots(rows).reverse();
});
}


async deleteAll(){
const names=Object.keys(this.stores);
return this.transaction(names,'readwrite',async(tx)=>{
const out={};
for(const n of names){out[n]=(await tx.getAll(n)).length;await tx.clear(n);}
return out;
});
}








async saveShot({shot,pose=null,clip=null,onClipDropped=(x)=>x,skipClip=false}={}){
const ops=(s,withPose,withClip)=>[
{op:'put',store:'shots',record:s},
...(withPose&&pose?[{op:'put',store:'poses',record:pose}]:[]),
...(withClip&&clip?[{op:'put',store:'clips',record:clip}]:[]),
];
const tryOps=async(list)=>{
try{await this.batch(list);return null;}catch(e){if(isQuotaError(e))return e;throw e;}
};
if(clip&&!skipClip){
const e=await tryOps(ops(shot,true,true));
if(!e)return{ok:true,clipSaved:true,poseSaved:Boolean(pose),shot,lowSpace:false};
}
const dropped=clip?onClipDropped(shot):shot;
const reason=clip?RC.CLIP_NOT_SAVED:undefined;
const lowSpace=Boolean(clip);
const e2=await tryOps(ops(dropped,true,false));
if(!e2)return{ok:true,clipSaved:false,poseSaved:Boolean(pose),shot:dropped,lowSpace,...(reason?{reason}:{})};
if(pose){
const e3=await tryOps(ops(dropped,false,false));
if(!e3)return{ok:true,clipSaved:false,poseSaved:false,shot:dropped,lowSpace:true,...(reason?{reason}:{})};
}
return{ok:false,clipSaved:false,poseSaved:false,shot:dropped,lowSpace:true,error:'QUOTA_EXCEEDED'};
}

async close(){
await this._backend.close();
}
}



export function makeClipRecord({clip_id,shot_id,session_id,created_at,blob,mime,starred=false,kind='raw'}){
const bytes=blob&&Number.isFinite(blob.size)?blob.size:(blob&&Number.isFinite(blob.byteLength)?blob.byteLength:0);
return{clip_id,shot_id,session_id,created_at,kind,mime:mime??(blob&&blob.type)??'',bytes,starred:Boolean(starred),blob};
}

function toStoreError(e){
if(e instanceof StoreError)return e;
if(isQuotaError(e))return new StoreError('QUOTA_EXCEEDED',`out of space: ${(e&&e.message)||String(e)}`,e);
if(e&&e.name==='VersionError'){
return new StoreError('VERSION_NEWER','the local database is newer than this app version (update the app; nothing was changed)',e);
}
return new StoreError('BACKEND',`opening local storage failed: ${(e&&e.message)||String(e)}`,e);
}



export async function openRepository(backend,opts={}){
const version=opts.version??SCHEMA_VERSION;
const stores=opts.stores??STORE_DEFS;
const migrations=[...(opts.migrations??MIGRATIONS)].sort((a,b)=>a.version-b.version);
const migrate=async(oldVersion,newVersion,tx)=>{
if(oldVersion===0)return;
for(const m of migrations){
if(m.version>oldVersion&&m.version<=newVersion)await m.up(tx,{oldVersion,newVersion});
}
};
let info;
try{
info=await backend.open({version,stores,migrate});
}catch(e){
throw toStoreError(e);
}
return new Repository(backend,{stores,version,oldVersion:info?info.oldVersion:0});
}
