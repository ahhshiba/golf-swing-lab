








import{mulberry32,gauss}from'../geom/rng.js';

export const SCORE_K=0.25;
export const SCORE_MC_DRAWS=200;
export const SCORE_SEED=0x5c0e5;

const fin=(x)=>typeof x==='number'&&Number.isFinite(x);


export function scoreOf(d,T,k=SCORE_K){
return 100*Math.max(0,1-d/(k*T));
}

export function scoreShot({target_m,carry_m,carry_sigma=0,side_m=null,side_sigma=null,k=SCORE_K,draws=SCORE_MC_DRAWS,seed=SCORE_SEED}={}){
if(!(fin(target_m)&&target_m>0))throw new RangeError('scoreShot: target_m must be a number > 0');
if(!(fin(k)&&k>0))throw new RangeError('scoreShot: k must be a number > 0');
if(!fin(carry_m))return{score:null,score_sigma:null,miss_m:null,miss_side_m:null};
const hasSide=fin(side_m);
const cs=fin(carry_sigma)&&carry_sigma>0?carry_sigma:0;
const ss=hasSide&&fin(side_sigma)&&side_sigma>0?side_sigma:0;
const dist=(c,s)=>(hasSide?Math.hypot(c-target_m,s):Math.abs(c-target_m));
const score=scoreOf(dist(carry_m,side_m),target_m,k);
let score_sigma=0;
if(cs>0||ss>0){
const rng=mulberry32(seed);
let sum=0;
let sum2=0;
for(let i=0;i<draws;i++){
const c=gauss(rng,carry_m,cs);
const s=hasSide?gauss(rng,side_m,ss):0;
const v=scoreOf(dist(c,s),target_m,k);
sum+=v;
sum2+=v*v;
}
const mean=sum/draws;
score_sigma=Math.sqrt(Math.max(0,(sum2-draws*mean*mean)/(draws-1)));
}
return{score,score_sigma,miss_m:carry_m-target_m,miss_side_m:hasSide?side_m:null};
}


export function meanScore(items){
const xs=items.filter((x)=>fin(x?.score));
if(!xs.length)return null;
const n=xs.length;
const mean=xs.reduce((a,x)=>a+x.score,0)/n;
const sigma=Math.sqrt(xs.reduce((a,x)=>a+(fin(x.score_sigma)?x.score_sigma**2:0),0))/n;
return{n,mean,sigma,ci95:[Math.max(0,mean-1.96*sigma),Math.min(100,mean+1.96*sigma)]};
}
