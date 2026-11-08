
















import{FAULT_IDS}from'./params.js';

const DAY=86400000;
export const MAX_SESSIONS=10;

export const MIN_CHANGE_N=10;

export function wilson(k,n,z=1.96){
if(!(n>0))return{p:0,lo:0,hi:1};
const p=k/n;
const z2=z*z;
const den=1+z2/n;
const c=(p+z2/(2*n))/den;
const half=(z*Math.sqrt((p*(1-p))/n+z2/(4*n*n)))/den;
return{p,lo:Math.max(0,c-half),hi:Math.min(1,c+half)};
}

const isHit=(s)=>s==='fault'||s==='possible';
const judged=(s)=>s==='fault'||s==='possible'||s==='ok';

export function faultTrends(labRecords,filter={}){
const{days=null,view=null,shots=null,now=Date.now(),sessions:maxS=MAX_SESSIONS}=filter??{};
const byId=shots instanceof Map?shots:new Map((Array.isArray(shots)?shots:[]).map((s)=>[s.shot_id,s]));
const since=Number.isFinite(days)&&days>0?now-days*DAY:-Infinity;
const recs=[];
for(const r of Array.isArray(labRecords)?labRecords:[]){
if(!r||!Array.isArray(r.faults)||(view&&r.view!==view))continue;
const s=byId.get(r.shot_id);
const at=Date.parse(s?.created_at??r.computed_at);
if(!Number.isFinite(at)||at<since||at>now+DAY)continue;
const session=s?.session_id??`day-${new Date(at).toISOString().slice(0,10)}`;
recs.push({r,at,session});
}

const rows=[];
for(const v of['face_on','dtl','high_behind']){
if(view&&v!==view)continue;
const inView=recs.filter((x)=>x.r.view===v);
for(const id of FAULT_IDS){
const per=new Map();
for(const x of inView){
const f=x.r.faults.find((y)=>y.id===id);
if(!f||!judged(f.status))continue;
const g=per.get(x.session)??{k:0,n:0,at:-Infinity};
g.n++;if(isHit(f.status))g.k++;
g.at=Math.max(g.at,x.at);
per.set(x.session,g);
}
if(!per.size)continue;
const list=[...per.entries()].sort((a,b)=>a[1].at-b[1].at).slice(-maxS)
.map(([session_id,g])=>({session_id,...wilson(g.k,g.n),n:g.n,k:g.k,at:new Date(g.at).toISOString()}));
const n=list.reduce((a,s)=>a+s.n,0);
const k=list.reduce((a,s)=>a+s.k,0);
let change=null;
let few=false;
if(list.length>=2){
const last=list[list.length-1];
const before=list.slice(0,-1);
const bn=before.reduce((a,s)=>a+s.n,0);
const b=wilson(before.reduce((a,s)=>a+s.k,0),bn);
if(last.n<MIN_CHANGE_N||bn<MIN_CHANGE_N)few=true;
else if(last.hi<b.lo)change='fewer';
else if(last.lo>b.hi)change='more';
}
rows.push({id,view:v,n,k,...wilson(k,n),sessions:list,change,few});
}
}
const best=new Map();
for(const r of rows)if(r.k>0){const b=best.get(r.id);if(!b||r.p>b.p||(r.p===b.p&&r.k>b.k))best.set(r.id,r);}
const top=[...best.values()].sort((a,b)=>b.p-a.p||b.k-a.k||FAULT_IDS.indexOf(a.id)-FAULT_IDS.indexOf(b.id)).slice(0,3).map((r)=>r.id);
return{top,rows};
}
