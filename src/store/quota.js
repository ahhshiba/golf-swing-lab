









const MIB=1024*1024;

export const DEFAULT_POLICY=Object.freeze({highWater:0.8,lowWater:0.6,minFreeBytes:500*MIB});

const finiteNum=(x)=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const mb=(bytes)=>Math.round(bytes/MIB);



export function isDeletableClip(c,protectedShots){
if(c===null||typeof c!=='object')return false;
if(typeof c.clip_id!=='string'||c.clip_id==='')return false;
if(c.kind!==undefined&&c.kind!=='raw')return false;
if(c.starred||c.protected)return false;
if(protectedShots.has(c.shot_id))return false;
return finiteNum(c.bytes)&&c.bytes>0;
}


export function policyClips(records){
return records.map((r)=>({
clip_id:r.clip_id,
shot_id:r.shot_id,
kind:r.kind??'raw',
created_at:r.created_at,
starred:Boolean(r.starred),
bytes:finiteNum(r.bytes)?r.bytes:(r.blob&&finiteNum(r.blob.size)?r.blob.size:0),
}));
}











export function planCleanup(input){
const{
usage,quota,clips=[],practiceActive=false,protectShotIds=[],
highWater=DEFAULT_POLICY.highWater,lowWater=DEFAULT_POLICY.lowWater,
highBytes=null,lowBytes=null,minFreeBytes=DEFAULT_POLICY.minFreeBytes,
}=input??{};
const plan={
status:'unknown',usage:finiteNum(usage)?usage:null,quota:finiteNum(quota)?quota:null,
highBytes:null,lowBytes:null,bytesToFree:0,deleteIds:[],freedBytes:0,satisfied:true,
warnOnly:false,lowSpace:false,msg:{code:'storage.unknown',params:{}},
};

if(plan.usage===null||(plan.quota===null&&!finiteNum(highBytes)))return plan;
plan.lowSpace=plan.quota!==null&&plan.quota-plan.usage<minFreeBytes;
const high=finiteNum(highBytes)?highBytes:Math.round(plan.quota*highWater);
const low=finiteNum(lowBytes)?lowBytes:Math.round((high*lowWater)/highWater);
plan.highBytes=high;
plan.lowBytes=Math.min(low,high);

if(plan.usage<=high){
plan.status='ok';
plan.msg=plan.lowSpace
?{code:'storage.low_free',params:{freeMb:mb(plan.quota-plan.usage),minMb:mb(minFreeBytes)}}
:{code:'storage.ok',params:{}};
return plan;
}

plan.status='over';
plan.bytesToFree=plan.usage-plan.lowBytes;
if(practiceActive){
plan.warnOnly=true;
plan.satisfied=false;
plan.msg={code:'storage.over_limit_practice',params:{usedMb:mb(plan.usage)}};
return plan;
}

const protectedShots=new Set(protectShotIds);
const candidates=clips.filter((c)=>isDeletableClip(c,protectedShots)).sort((a,b)=>{
const ta=a.created_at??'\uffff';
const tb=b.created_at??'\uffff';
return ta<tb?-1:ta>tb?1:(a.clip_id<b.clip_id?-1:a.clip_id>b.clip_id?1:0);
});
for(const c of candidates){
if(plan.freedBytes>=plan.bytesToFree)break;
plan.deleteIds.push(c.clip_id);
plan.freedBytes+=c.bytes;
}
plan.satisfied=plan.freedBytes>=plan.bytesToFree;
plan.msg={
code:plan.satisfied?'storage.over_limit':'storage.over_limit_unsatisfied',
params:{usedMb:mb(plan.usage),n:plan.deleteIds.length,freedMb:mb(plan.freedBytes)},
};
return plan;
}


export function freeBytes(est){
return est&&finiteNum(est.usage)&&finiteNum(est.quota)?Math.max(0,est.quota-est.usage):null;
}





export function clipSpaceCheck(est,{minFreeBytes=DEFAULT_POLICY.minFreeBytes,clipBytes=0}={}){
const free=freeBytes(est);
return{free,lowSpace:free!==null&&free-(finiteNum(clipBytes)?clipBytes:0)<minFreeBytes};
}



export async function estimateStorage(nav,{timeoutMs=2000}={}){
const out={supported:false,usage:null,quota:null};
try{
const n=nav??globalThis.navigator;
if(n&&n.storage&&typeof n.storage.estimate==='function'){
out.supported=true;
let timer=null;
const e=await Promise.race([
n.storage.estimate(),
new Promise((resolve)=>{timer=setTimeout(()=>resolve(null),timeoutMs);}),
]).finally(()=>clearTimeout(timer));
if(e&&finiteNum(e.usage))out.usage=e.usage;
if(e&&finiteNum(e.quota))out.quota=e.quota;
}
}catch(_){

}
return out;
}




export async function requestPersist(nav){
const out={supported:false,persisted:null,requested:false,usage:null,quota:null,error:null};
try{
const n=nav??globalThis.navigator;
const s=n&&n.storage;
if(s&&typeof s.persist==='function'){
out.supported=true;
if(typeof s.persisted==='function')out.persisted=Boolean(await s.persisted());
if(out.persisted!==true){
out.requested=true;
out.persisted=Boolean(await s.persist());
}
}
}catch(e){
out.error=String((e&&e.message)||e);
}
const est=await estimateStorage(nav);
out.usage=est.usage;
out.quota=est.quota;
return out;
}
