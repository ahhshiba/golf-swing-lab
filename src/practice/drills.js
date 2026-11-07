












import{mulberry32}from'../geom/rng.js';
import{CLUBS}from'../session/settings.js';
import{MODEL_ORIGINS}from'../contract/enums.js';
import{MODEL_CODES}from'../contract/reason-codes.js';
import{scoreShot,meanScore,SCORE_K}from'./scoring.js';

export const YD_M=0.9144;
const CLUB_IDS=CLUBS.map((c)=>c[0]);





export const REFERENCE_CARRY_M=Object.freeze({driver:200,'3w':180,hybrid:165,'5i':150,'7i':135,'9i':115,pw:100,sw:75});

export const DRILL_TEMPLATES=Object.freeze([

Object.freeze({id:'target',kind:'target',scored:true,count:10}),

Object.freeze({id:'gapping',kind:'gapping',scored:false,perClub:5}),

Object.freeze({id:'distance18',kind:'test',scored:true,rounds:2,targets_yd:Object.freeze([40,50,60,70,80,90,100,110,120])}),

Object.freeze({id:'clubs3',kind:'test',scored:true,rounds:3,byClub:true}),
]);

export const templateOf=(id)=>DRILL_TEMPLATES.find((x)=>x.id===id)??null;

const fin=(x)=>typeof x==='number'&&Number.isFinite(x);

function shuffle(arr,rng){
const a=arr.slice();
for(let i=a.length-1;i>0;i--){
const j=Math.floor(rng()*(i+1));
[a[i],a[j]]=[a[j],a[i]];
}
return a;
}

const emptySlot=(slot,round,target_m,club)=>({
slot,round,target_m,club:club??null,shot_id:null,attempt:0,carry_m:null,carry_sigma:null,side_m:null,side_sigma:null,
score:null,score_sigma:null,miss_m:null,miss_side_m:null,estimated:false,view:null,
});

function clubTarget(club,targets,i){
if(Array.isArray(targets)&&fin(targets[i])&&targets[i]>0)return targets[i];
if(targets&&!Array.isArray(targets)&&fin(targets[club])&&targets[club]>0)return targets[club];
return REFERENCE_CARRY_M[club]??100;
}

export function makeDrill(templateId,{seed=1,clubs,targets,count,perClub,drill_id,created_at=null,k=SCORE_K}={}){
const tpl=templateOf(templateId);
if(!tpl)throw Object.assign(new RangeError(`makeDrill: unknown template ${templateId}`),{code:'DRILL_UNKNOWN'});
if(!fin(seed))throw new TypeError('makeDrill: seed must be a finite number');
const rng=mulberry32(seed);
const clubList=(Array.isArray(clubs)?clubs:[]).filter((c)=>CLUB_IDS.includes(c));
const plan=[];
if(tpl.kind==='target'){
const T=Array.isArray(targets)?targets[0]:targets;
if(!(fin(T)&&T>0))throw new RangeError('makeDrill(target): targets[0] must be a carry in metres > 0');
const n=Number.isInteger(count)&&count>0?Math.min(count,50):tpl.count;
for(let i=0;i<n;i++)plan.push([1,T,clubList[0]??null]);
}else if(tpl.kind==='gapping'){
const cl=clubList.length?clubList:CLUB_IDS;
const n=Number.isInteger(perClub)&&perClub>0?Math.min(perClub,20):tpl.perClub;
cl.forEach((c,i)=>{for(let j=0;j<n;j++)plan.push([1,clubTarget(c,targets,i),c]);});
}else if(tpl.byClub){
const cl=clubList.length?clubList:CLUB_IDS;
const items=cl.map((c,i)=>[c,clubTarget(c,targets,i)]);
for(let r=1;r<=tpl.rounds;r++)for(const[c,T]of shuffle(items,rng))plan.push([r,T,c]);
}else{
const base=Array.isArray(targets)&&targets.length&&targets.every((x)=>fin(x)&&x>0)?targets:tpl.targets_yd.map((y)=>y*YD_M);
for(let r=1;r<=tpl.rounds;r++)for(const T of shuffle(base,rng))plan.push([r,T,clubList[0]??null]);
}
return{
drill_id:drill_id??`drill-${tpl.id}-${(seed>>>0).toString(36)}`,
template:tpl.id,
kind:tpl.kind,
created_at,
updated_at:created_at,
seed,
k,
status:'active',
finished_at:null,
slots:plan.map(([r,T,c],i)=>emptySlot(i+1,r,T,c)),
};
}

const sigmaOf=(m)=>{
if(fin(m?.sigma))return m.sigma;
if(Array.isArray(m?.ci95)&&m.ci95.every(fin))return(m.ci95[1]-m.ci95[0])/(2*1.96);
return 0;
};

const isEstimated=(m)=>m?.validity!=='valid'||MODEL_ORIGINS.includes(m?.value_origin)
||(m?.reason_codes??[]).some((c)=>MODEL_CODES.includes(c));


export function shotInputs(shot){
const c=shot?.metrics?.carry_m;
const s=shot?.metrics?.carry_side_m;
const carry=fin(c?.value)?c.value:null;
const side=fin(s?.value)?s.value:null;
return{
carry_m:carry,carry_sigma:carry===null?null:sigmaOf(c),
side_m:side,side_sigma:side===null?null:sigmaOf(s),
estimated:(carry!==null&&isEstimated(c))||(side!==null&&isEstimated(s)),
};
}

export function practiceOf(drill,slot){
const s=drill.slots.find((x)=>x.slot===slot);
if(!s)throw new RangeError(`practiceOf: no slot ${slot}`);
return{drill_id:drill.drill_id,slot,target_m:s.target_m,attempt:s.attempt+1};
}

export function recordShot(drill,slot,shot,{now=null}={}){
const d={...drill,slots:drill.slots.map((s)=>({...s}))};
const s=d.slots.find((x)=>x.slot===slot);
if(!s)throw new RangeError(`recordShot: no slot ${slot}`);
const inp=shotInputs(shot);
const tpl=templateOf(d.template);
const sc=tpl?.scored&&inp.carry_m!==null
?scoreShot({target_m:s.target_m,carry_m:inp.carry_m,carry_sigma:inp.carry_sigma,side_m:inp.side_m,side_sigma:inp.side_sigma,k:d.k??SCORE_K})
:{score:null,score_sigma:null,miss_m:inp.carry_m===null?null:inp.carry_m-s.target_m,miss_side_m:inp.side_m};
Object.assign(s,{
shot_id:shot?.shot_id??null,attempt:s.attempt+1,club:s.club??shot?.club?.type??null,
carry_m:inp.carry_m,carry_sigma:inp.carry_sigma,side_m:inp.side_m,side_sigma:inp.side_sigma,
...sc,estimated:inp.estimated,view:shot?.capture?.view??null,
});
d.updated_at=now??d.updated_at;
if(d.slots.every((x)=>x.shot_id)){d.status='done';d.finished_at=now??d.finished_at;}
return d;
}

export function progressOf(drill){
const total=drill?.slots?.length??0;
const done=(drill?.slots??[]).filter((s)=>s.shot_id).length;
return{done,total,next:(drill?.slots??[]).find((s)=>!s.shot_id)??null};
}

export function summaryOf(drill){
const filled=(drill?.slots??[]).filter((s)=>s.shot_id);
const views=[...new Set(filled.map((s)=>s.view).filter(Boolean))];
const clubs=new Map();
for(const s of filled){
if(!fin(s.carry_m))continue;
const k=s.club??'';
if(!clubs.has(k))clubs.set(k,[]);
clubs.get(k).push(s.carry_m);
}
return{score:meanScore(filled),estimated:filled.some((s)=>s.estimated),views,clubs};
}


export function comparable(a,b){
if(!a||!b||a.template!==b.template)return false;
const va=summaryOf(a).views;
const vb=summaryOf(b).views;
return va.length===1&&vb.length===1&&va[0]===vb[0];
}
