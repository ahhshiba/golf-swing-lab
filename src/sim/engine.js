




import{mulberry32}from'../geom/rng.js';
import{carrySource,sideSource}from'./source.js';
import{ELLIPSE_K95}from'./params.js';






export function flightShape(samples){
if(!Array.isArray(samples)||samples.length<3)return null;
const z0=samples[0][3];
let apex=0;
for(const p of samples)if(Number.isFinite(p[3])&&p[3]-z0>apex)apex=p[3]-z0;
const a=samples[samples.length-2],b=samples[samples.length-1];
const h=Math.hypot(b[1]-a[1],b[2]-a[2]);
const dz=a[3]-b[3];
if(!(apex>=1)||!(h>0)||!(dz>0))return null;
const deg=(Math.atan2(dz,h)*180)/Math.PI;
const r1=(x)=>Math.round(x*10)/10;
return{apex_m:r1(apex),land_deg:r1(Math.min(75,Math.max(10,deg)))};
}























export function shotOutcome(args){
const{input,view=null,club,player={},rows={},rules={},rng,lie='fairway',style=null}=args??{};
if(!input||typeof input!=='object')throw new TypeError('shotOutcome: input is required');
if(typeof club!=='string'||!club)throw new TypeError('shotOutcome: club is required');
let seed=args.seed;
if(!(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff)){
if(typeof rng!=='function')throw new TypeError('shotOutcome: rng or seed is required');
seed=Math.floor(rng()*4294967296)>>>0;
}
const sub=mulberry32(seed);
const c=carrySource({input,view,club,player,rows:rows??{},lie,style});
const s=sideSource({input,view,club,player,rows:rows??{},rules:rules??{},carry_m:c.value.value,lie,style,rng:sub});
const shape=input.kind==='shot'?flightShape(input.shot?.flight?.samples):null;
return{
carry:c.value,
side:s.value,
draw:shape?{seed,carry_m:c.value.value,side_m:s.draw_m,...shape}:{seed,carry_m:c.value.value,side_m:s.draw_m},
source:input.kind,
shot_id:input.kind==='shot'?input.shot?.shot_id??null:null,
ellipse:{sx:Math.round(ELLIPSE_K95*s.sigma_used*100)/100,sy:Math.round(ELLIPSE_K95*c.sigma_used*100)/100},
club,lie,view:c.view,merge:c.merge,
};
}
