













import{RC}from'../contract/reason-codes.js';
import{mulberry32,gauss}from'../geom/rng.js';
import{SIM_PARAMS as P,ELLIPSE_K95}from'./params.js';
import{applyStroke,ballOf,strokeSeed}from'./round.js';
import{lieAt,dist}from'../course/model.js';

const r2=(x)=>{
const y=Math.round(x*100)/100;
return y===0?0:y;
};
const LN2=0.6931471805599453;

const skillOf=(s)=>([0,10,20,30].includes(s)?s:20);

export function puttProbability(d,skill=20,slope=1){
const T=P.putt;
const d50=T.d50[skillOf(skill)]/(1+T.slope_k*Math.max(0,slope-T.slope_ref));
const x=Math.max(0,d-T.tap_in_m)/(d50-T.tap_in_m);
const p=Math.exp(-Math.pow(x,T.k)*LN2);
return Math.min(T.p_max,Math.max(T.p_min,p));
}

const leaveSigma=(d)=>P.putt.leave_sigma_frac*d+P.putt.leave_sigma_m;


const QZ=Array.from({length:40},(_,i)=>(i+0.5)*0.1);
const QW=(()=>{
const w=QZ.map((z)=>Math.exp(-0.5*z*z));
const s=w.reduce((a,b)=>a+b,0);
return w.map((x)=>x/s);
})();


export function expectedPutts(d,skill=20,slope=1,k=1){
if(k>=P.putt.max_putts)return 1;
const p=puttProbability(d,skill,slope);
const sg=leaveSigma(d);
let next=0;
for(let i=0;i<QZ.length;i++)next+=QW[i]*expectedPutts(Math.max(P.putt.miss_min_m,QZ[i]*sg),skill,slope,k+1);
return 1+(1-p)*next;
}

const roundOk=(round,who)=>{
if(!round||!Array.isArray(round.strokes)||!Array.isArray(round.players)||!round.course)throw new TypeError(`${who}: round must be a golf-round/1 record`);
};
const idOf=(player)=>(typeof player==='string'?player:player?.player_id);
const playerRec=(round,id)=>round.players.find((p)=>p.player_id===id);
const holeAt=(round)=>round.course.holes[(round.current?.hole??1)-1];
const sv=(value,sigma,origin,code)=>({value:r2(value),ci95:null,sigma:sigma===null?null:r2(sigma),validity:'estimated',origin,reason_codes:[code]});

function puttCount(round,id,holeN){
let n=0;
for(const s of round.strokes)if(s.player_id===id&&s.hole===holeN&&s.club==='putter'&&s.source!=='pickup')n++;
return n;
}

function frameTo(b,pin){
const L=dist(b.x,b.y,pin[0],pin[1]);
const ux=L>0?(pin[0]-b.x)/L:0,uy=L>0?(pin[1]-b.y)/L:1;
return{L,ux,uy,vx:uy,vy:-ux};
}








export function autoPutt(round,player,rng){
roundOk(round,'autoPutt');
const id=idOf(player);
const rec=playerRec(round,id);
if(!rec)throw new RangeError(`autoPutt: unknown player ${id}`);
if(!round.current)throw Object.assign(new Error('autoPutt: the round is finished'),{code:'ROUND_FINISHED'});
const r=typeof rng==='function'?rng:mulberry32(strokeSeed(round));
const holeN=round.current.hole;
const hole=holeAt(round);
const hand=rec.handedness==='left'?-1:1;
let cur=round;
const strokes=[];
for(let guard=0;guard<12;guard++){
const b=ballOf(cur,id,holeN);
if(b.done)break;
const f=frameTo(b,hole.pin);
const seed=Math.floor(r()*4294967296)>>>0;
const sub=mulberry32(seed);
const last=puttCount(cur,id,holeN)+1>=P.putt.max_putts;
const holed=last||sub()<puttProbability(f.L,rec.putt_skill,hole.green.slope_pct);
let along=f.L,lat=0;
const sg=leaveSigma(f.L);
if(!holed){
const leave=Math.max(P.putt.miss_min_m,Math.abs(gauss(sub,0,sg)));
const phi=2*Math.PI*sub();
along=f.L+leave*Math.cos(phi);
lat=leave*Math.sin(phi);
}
const outcome={
carry:sv(along,sg,'sim',RC.AUTO_PUTT),side:sv(lat*hand,sg,'sim',RC.AUTO_PUTT),
draw:{seed,carry_m:r2(along),side_m:r2(lat*hand)},source:'auto_putt',shot_id:null,
ellipse:{sx:r2(ELLIPSE_K95*sg),sy:r2(ELLIPSE_K95*sg)},club:'putter',
};
const res=applyStroke(cur,id,outcome,{x:hole.pin[0],y:hole.pin[1]});
cur=res.round;
strokes.push(res.stroke);
}
return{round:cur,strokes};
}

export function autoChip(round,player,rng){
roundOk(round,'autoChip');
const id=idOf(player);
const rec=playerRec(round,id);
if(!rec)throw new RangeError(`autoChip: unknown player ${id}`);
if(!round.current)throw Object.assign(new Error('autoChip: the round is finished'),{code:'ROUND_FINISHED'});
const hole=holeAt(round);
const b=ballOf(round,id,round.current.hole);
const lim=round.rules?.autoChipM??0;
if(!(lim>0)||b.lie==='green'||b.done||b.to_pin_m>lim){
throw Object.assign(new Error('autoChip: not available here (rules.autoChipM, off the green, within range)'),{code:'AUTO_CHIP_UNAVAILABLE'});
}
const r=typeof rng==='function'?rng:mulberry32(strokeSeed(round));
const seed=Math.floor(r()*4294967296)>>>0;
const sub=mulberry32(seed);
const f=frameTo(b,hole.pin);
const sg=P.chip.sigma_frac*f.L*(P.chip.skill[skillOf(rec.putt_skill)]??1);
const leave=Math.abs(gauss(sub,0,sg));
const phi=2*Math.PI*sub();
let px=hole.pin[0]+leave*(f.ux*Math.cos(phi)+f.vx*Math.sin(phi));
let py=hole.pin[1]+leave*(f.uy*Math.cos(phi)+f.vy*Math.sin(phi));

for(let i=0;i<400&&lieAt(hole,px,py)!=='green';i++){
px+=(hole.pin[0]-px)*0.05;
py+=(hole.pin[1]-py)*0.05;
}
const along=(px-b.x)*f.ux+(py-b.y)*f.uy;
const lat=(px-b.x)*f.vx+(py-b.y)*f.vy;
const hand=rec.handedness==='left'?-1:1;
const outcome={
carry:sv(along,sg,'sim',RC.AUTO_CHIP),side:sv(lat*hand,sg,'sim',RC.AUTO_CHIP),
draw:{seed,carry_m:r2(along),side_m:r2(lat*hand)},source:'auto_chip',shot_id:null,
ellipse:{sx:r2(ELLIPSE_K95*sg),sy:r2(ELLIPSE_K95*sg)},club:P.chip.club,
};
return applyStroke(round,id,outcome,{x:hole.pin[0],y:hole.pin[1]});
}

export function manualPutts(round,player,count){
roundOk(round,'manualPutts');
const id=idOf(player);
const rec=playerRec(round,id);
if(!rec)throw new RangeError(`manualPutts: unknown player ${id}`);
if(!(Number.isInteger(count)&&count>=1&&count<=6))throw new RangeError('manualPutts: count must be 1–6');
if(!round.current)throw Object.assign(new Error('manualPutts: the round is finished'),{code:'ROUND_FINISHED'});
const holeN=round.current.hole;
const hole=holeAt(round);
let cur=round;
const strokes=[];
for(let i=1;i<=count;i++){
const b=ballOf(cur,id,holeN);
if(b.done)break;
const f=frameTo(b,hole.pin);

const along=i===count?f.L:f.L-Math.min(0.6,f.L/2);
const v={value:r2(along),ci95:null,sigma:null,validity:'estimated',origin:'manual',reason_codes:[RC.MANUAL_ENTRY]};
const outcome={
carry:v,side:{...v,value:0,reason_codes:[RC.MANUAL_ENTRY]},draw:{seed:0,carry_m:r2(along),side_m:0},
source:'manual',shot_id:null,ellipse:{sx:0,sy:0},club:'putter',
};
const res=applyStroke(cur,id,outcome,{x:hole.pin[0],y:hole.pin[1]});
cur=res.round;
strokes.push(res.stroke);
}
return{round:cur,strokes};
}
