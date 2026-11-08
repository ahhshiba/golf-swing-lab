


















import{RC}from'../contract/reason-codes.js';
import{REFERENCE_CARRY_M}from'../practice/drills.js';
import{SIM_PARAMS as P}from'./params.js';
import{lieFactors}from'./lies.js';
import{gauss}from'../geom/rng.js';
import{CLUBS}from'../session/settings.js';

const fin=(x)=>typeof x==='number'&&Number.isFinite(x);
const uniq=(list)=>[...new Set(list.filter(Boolean))];
const Z10=1.2815515655446004;
const r2=(x)=>{
const y=Math.round(x*100)/100;
return y===0?0:y;
};

export function metricSigma(m){
if(!m)return null;
if(fin(m.sigma)&&m.sigma>0)return m.sigma;
if(Array.isArray(m.ci95)&&m.ci95.every(fin))return(m.ci95[1]-m.ci95[0])/3.92;
return null;
}


export function referenceCarry(club,player){
const base=REFERENCE_CARRY_M[club]??REFERENCE_CARRY_M['7i'];
const dc=player&&fin(player.driver_carry_m)&&player.driver_carry_m>0?player.driver_carry_m:REFERENCE_CARRY_M.driver;
return(base*dc)/REFERENCE_CARRY_M.driver;
}

function basePrior(club,player,gapRow){
const c=gapRow?.carry;
if(gapRow&&gapRow.n>=P.gapping_min_n&&c&&fin(c.median)){
const spread=fin(c.p10)&&fin(c.p90)&&c.p90>c.p10?(c.p90-c.p10)/(2*Z10):P.reference_sigma_frac*c.median;
return{median:c.median,sigma:spread,p10:fin(c.p10)?c.p10:c.median-Z10*spread,p90:fin(c.p90)?c.p90:c.median+Z10*spread,source:'gapping',small_sample:false};
}
const median=referenceCarry(club,player);
const sigma=P.reference_sigma_frac*median;
return{median,sigma,p10:median-Z10*sigma,p90:median+Z10*sigma,source:'reference',small_sample:!!gapRow&&gapRow.n>0};
}

const MIN_GAP_M=1;








export function playerCarries(player={},rows=[]){
const list=CLUBS.map(([club])=>({club,...basePrior(club,player,(rows??[]).find((r)=>r?.club===club)??null),scaled:false}));
const measured=list.filter((x)=>x.source==='gapping');
if(measured.length){
const ratios=measured.map((x)=>x.median/referenceCarry(x.club,player)).sort((a,b)=>a-b);
const m=ratios.length;
const k=m%2?ratios[(m-1)/2]:(ratios[m/2-1]+ratios[m/2])/2;
for(const x of list)if(x.source!=='gapping'){x.median*=k;x.scaled=true;}
for(let i=1;i<list.length;i++){
const x=list[i];
if(x.scaled&&x.median>list[i-1].median-MIN_GAP_M)x.median=list[i-1].median-MIN_GAP_M;
}
for(let i=list.length-2;i>=0;i--){
const x=list[i];
if(x.scaled&&x.median<list[i+1].median+MIN_GAP_M)x.median=list[i+1].median+MIN_GAP_M;
}
for(const x of list)if(x.scaled){x.sigma=P.reference_sigma_frac*x.median;x.p10=x.median-Z10*x.sigma;x.p90=x.median+Z10*x.sigma;}
}
return list.map((x)=>({...x,validity:x.source==='gapping'?'estimated':'low_confidence',reason_codes:[x.source==='gapping'?RC.GAPPING_PRIOR:RC.REFERENCE_PRIOR]}));
}






export function priorCarry(club,player,gapRow,allRows=player?.gapping){
const own=basePrior(club,player,gapRow);
if(own.source==='gapping'||!Array.isArray(allRows)||!allRows.length)return{...own,scaled:false};
const hit=playerCarries(player,allRows).find((x)=>x.club===club);
return hit?{...hit,small_sample:own.small_sample}:{...own,scaled:false};
}

export function sidePrior(club,carry_m,sideRow){
if(sideRow&&sideRow.n>=P.side_min_n&&!sideRow.indistinguishable&&fin(sideRow.mean)&&fin(sideRow.sd_est)){
return{mu:sideRow.mean,sigma:Math.max(P.side_sigma_min_m,sideRow.sd_est),source:'gapping'};
}
const frac=P.side_sigma_frac[club]??P.side_sigma_frac.default;
return{mu:0,sigma:Math.max(P.side_sigma_min_m,frac*Math.max(0,carry_m)),source:'reference'};
}

const value=(v,sigma,validity,origin,codes,ci95=null)=>({
value:r2(v),ci95:ci95?[r2(ci95[0]),r2(ci95[1])]:null,sigma:sigma===null?null:r2(sigma),
validity:validity==='valid'?'estimated':validity,origin,reason_codes:uniq(codes),
});

function fromPrior(club,player,gapRow,extraCodes=[],allRows){
const pr=priorCarry(club,player,gapRow,allRows);
const code=pr.source==='gapping'?RC.GAPPING_PRIOR:RC.REFERENCE_PRIOR;
return{pr,v:value(pr.median,pr.sigma,'low_confidence','prior',[...extraCodes,code])};
}

function viewOf(input,view){
if(input.kind==='shot')return input.shot?.capture?.view??view??null;
return view??null;
}

export function carrySource({input,view,club,player,rows={},lie='fairway',style=null}){
const lf=lieFactors(lie,club,style);
const adj=(v)=>{
if(!lf.adjusted||v.origin==='manual')return v;
return{...v,value:r2(v.value*lf.carry),sigma:v.sigma===null?null:r2(v.sigma*lf.carry*lf.sigma),
ci95:v.ci95?[r2(v.value*lf.carry-(v.value-v.ci95[0])*lf.carry*lf.sigma),r2(v.value*lf.carry+(v.ci95[1]-v.value)*lf.carry*lf.sigma)]:null,
reason_codes:uniq([...v.reason_codes,RC.LIE_ADJUSTED])};
};
const vw=viewOf(input,view);
const gap=rows.gap??null;
const allRows=Array.isArray(rows.gapping)?rows.gapping:player?.gapping;
let v;
let merge=null;
if(input.kind==='manual'){
if(!(fin(input.carry_m)&&input.carry_m>=0))throw new RangeError('shotOutcome: manual carry_m must be a number >= 0');
v=value(input.carry_m,null,'estimated','manual',[RC.MANUAL_ENTRY]);
}else if(input.kind==='shot'){
const m=input.shot?.metrics?.carry_m;
const s=metricSigma(m);
if(m&&fin(m.value)&&s!==null)v=value(m.value,fin(m.sigma)?m.sigma:s,m.validity,m.value_origin??'derived',m.reason_codes??[],m.ci95??null);
else v=fromPrior(club,player,gap,m?.reason_codes??[],allRows).v;
}else if(input.kind==='quick'){
const r=input.result??{};
const m=r.metrics?.carry_m;
const s=metricSigma(m);
if(vw==='face_on'&&m&&fin(m.value)&&s!==null){
const codes=[...(m.reason_codes??[]),RC.PROVISIONAL];
const pr=priorCarry(club,player,gap,allRows);
const already=r.carry_source!=='pose'||codes.includes(RC.GAPPING_PRIOR)||codes.includes(RC.REFERENCE_PRIOR);
if(!already&&pr.source==='gapping'){

const wp=1/(s*s),wg=1/(pr.sigma*pr.sigma);
const c=(m.value*wp+pr.median*wg)/(wp+wg);
const sg=Math.sqrt(1/(wp+wg));
merge={pose:{value:m.value,sigma:s,w:wp/(wp+wg)},gap:{value:pr.median,sigma:pr.sigma,w:wg/(wp+wg)}};
v=value(c,sg,'low_confidence',m.value_origin??'flight_model',[...codes,RC.GAPPING_PRIOR]);
}else{
v=value(m.value,s,'low_confidence',m.value_origin??'flight_model',codes);
}
}else{
v=fromPrior(club,player,gap,[],allRows).v;
}
}else{
throw new TypeError(`shotOutcome: unknown input kind ${input?.kind}`);
}
const out=adj(v);
return{value:out,sigma_used:out.sigma??metricSigma(out)??0,merge,view:vw};
}

export function sideSource({input,view,club,player,rows={},rules={},carry_m,lie='fairway',style=null,rng}){
const lf=input.kind==='manual'?{sigma:1,adjusted:false}:lieFactors(lie,club,style);
const vw=viewOf(input,view);
if(input.kind==='manual'&&fin(input.side_m)){
const v=value(input.side_m,null,'estimated','manual',[RC.MANUAL_ENTRY]);
return{value:v,draw_m:v.value,sigma_used:0};
}
if(input.kind==='shot'){
const m=input.shot?.metrics?.carry_side_m;
const s=metricSigma(m);
if(m&&fin(m.value)&&s!==null){
const v=value(m.value,fin(m.sigma)?m.sigma:s,m.validity,m.value_origin??'derived',m.reason_codes??[],m.ci95??null);
return{value:v,draw_m:v.value,sigma_used:s};
}
}

const pr=sidePrior(club,carry_m,rows.side??null);
const sigma=pr.sigma*lf.sigma;
const nullCodes=input.kind==='shot'?(input.shot?.metrics?.carry_side_m?.reason_codes??[]):[];
const viewCodes=vw==='face_on'?[RC.LAUNCH_DIR_UNOBSERVABLE]:[];
const priorCode=pr.source==='gapping'?RC.GAPPING_PRIOR:RC.REFERENCE_PRIOR;
const extra=lf.adjusted?[RC.LIE_ADJUSTED]:[];
if(rules.unobservedSide==='center'){
const v=value(pr.mu,sigma,'low_confidence','prior',[...nullCodes,...viewCodes,priorCode,...extra]);
return{value:v,draw_m:v.value,sigma_used:sigma};
}
const drawn=r2(gauss(rng,pr.mu,sigma));
const v=value(drawn,sigma,'low_confidence','prior',[...nullCodes,...viewCodes,RC.SIDE_SAMPLED,...extra]);
return{value:v,draw_m:drawn,sigma_used:sigma};
}
