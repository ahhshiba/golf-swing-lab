






























import{RC}from'../../contract/reason-codes.js';
import{LM_METRIC_IDS,METRIC_UNITS,GROUNDS}from'../../contract/enums.js';
import{metricNull,metricValue}from'../../contract/metric.js';
import{attributeWarnings}from'../../contract/shot.js';
import{REGISTRY,cellFor}from'../../metrics/registry.js';
import{BALL_R}from'../../geom/constants.js';
import{gauss,mulberry32}from'../../geom/rng.js';
import{percentile,std}from'../../geom/stats.js';
import{spinPriorFor}from'../ballistics.js';
import{sha256Hex}from'../sha256.js';
import{LM_PARAMS}from'./params.js';
import{inverseHorizontal,inverseVertical,spinAxisDeg}from'./dplane.js';
import{clubParams,mergeSpin,spinCoefSigma,spinFromLoft}from'./spin.js';
import{fly,resample}from'./flight.js';
import{rollFrac}from'./roll.js';
import{attackFromClub}from'./attack.js';
import{hbClubSpeed}from'./hbspeed.js';

export{LM_PARAMS}from'./params.js';
export{clubProfile}from'./profile.js';

export const LM_FLIGHT_MODEL='lm-1';
const RANK={valid:0,estimated:1,low_confidence:2};
const NAMES=['valid','estimated','low_confidence'];
const D=Math.PI/180;

const NOT_INHERITED=new Set([RC.SPIN_ASSUMED,RC.SPIN_MODELLED,RC.WIND_IGNORED,RC.FLIGHT_MODELLED,RC.DPLANE_MODEL,
RC.ROLL_MODELLED,RC.SMASH_ASSUMED,RC.LAUNCH_V_ASSUMED,RC.SPIN_LOFT_ASSUMED,RC.MIGRATED_V1,RC.CROSS_VIEW_PRIOR]);


function canonical(x){
if(Array.isArray(x))return`[${x.map(canonical).join(',')}]`;
if(x&&typeof x==='object')return`{${Object.keys(x).sort().map((k)=>`${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
return JSON.stringify(x);
}

let ALGO=null;

export function lmAlgorithm(){
if(!ALGO)ALGO=Object.freeze({version:LM_PARAMS.version,sha256:sha256Hex(`golf-swing-lab/lm/${canonical(LM_PARAMS)}`)});
return ALGO;
}

const uniq=(a)=>[...new Set(a.filter(Boolean))];
const origin=(id)=>REGISTRY[id].value_origin;

function summary(value,draws){
const xs=draws.filter(Number.isFinite);
if(!Number.isFinite(value)||xs.length<8)return null;
return{value,ci95:[Math.min(percentile(xs,2.5),value),Math.max(percentile(xs,97.5),value)],sigma:std(xs)};
}


function reader(metrics,view,fps){
return(id)=>{
const m=metrics?.[id];
if(!m||m.value===null||!Number.isFinite(m.value))return{ok:false};
let sigma=Number.isFinite(m.sigma)?m.sigma:null;
if(sigma===null&&Array.isArray(m.ci95))sigma=(m.ci95[1]-m.ci95[0])/3.919927969;
const cell=cellFor(id,view,fps).validity;
return{
ok:true,value:m.value,sigma:sigma??0,origin:m.value_origin,
codes:(m.reason_codes??[]).filter((c)=>!NOT_INHERITED.has(c)),
worse:cell!==null&&RANK[m.validity]>RANK[cell],
};
};
}








export function deriveLaunchMonitor(input){
const view=input.view;
const fps=input.fps;
const club=input.club??null;
const rng=typeof input.rng==='function'?input.rng:mulberry32(1);
const n=input.n??LM_PARAMS.flight.mc_draws;
const ground=GROUNDS.includes(input.settings?.ground)?input.settings.ground:'normal';
const mirror=input.handedness==='left';
const cam=input.calibration?.camera??null;
const read=reader(input.metrics,view,fps);
const CP=clubParams(club);
const spinPrior=spinPriorFor(club);
const lift=Number.isFinite(club?.tee_lift_m)&&club?.lie==='tee'?club.tee_lift_m:0;
const startMat=Array.isArray(input.start)?input.start
:(input.fit?.ok&&Array.isArray(input.fit.p0)?input.fit.p0:[0,0,BALL_R+lift]);
const start=[startMat[0],mirror?-startMat[1]:startMat[1],startMat[2]];
const rsCodes=input.calibration&&input.calibration.readout_source!=='measured'?[RC.ROLLING_SHUTTER_ASSUMED]:[];

const out={};
const cells={};
const ids=[...LM_METRIC_IDS,'carry_m',...(view==='high_behind'?['club_speed_mps','ball_speed_mps']:[])];
for(const id of ids)cells[id]=cellFor(id,view,fps);
const allowed=(id)=>cells[id].validity!==null;
const nul=(id,codes,validity='not_computed')=>{
out[id]=metricNull(validity,codes,METRIC_UNITS[id],origin(id));
};

const put=(id,s,codes,worse,valueOrigin=origin(id))=>{
if(!s){nul(id,[RC.DEPENDS_ON_NULL]);return;}
const v=NAMES[Math.max(RANK[cells[id].validity],worse?RANK.low_confidence:0)];
out[id]=metricValue({value:s.value,unit:METRIC_UNITS[id],ci95:s.ci95,sigma:s.sigma,validity:v,value_origin:valueOrigin,reason_codes:uniq(codes)});
};

let flightNominal=null;
let band=null;
if(view==='face_on')faceOn();else if(view==='high_behind')highBehind();


for(const id of ids){
const c=cells[id];
if(c.validity===null)nul(id,[c.code],c.code===RC.DEPENDS_ON_NULL?'not_computed':'not_observable');
else if(!out[id])nul(id,[RC.DEPENDS_ON_NULL]);
}


let flight=null;
if(flightNominal&&out.carry_m.value!==null){
const toMat=(y)=>(mirror?-y:y);
const samples=resample(flightNominal.path).map(([t,x,y,z])=>[t,x,toMat(y),z]);
const last=samples[samples.length-1];
const rest=flightNominal.rest&&out.total_m.value!==null?{x_m:flightNominal.rest[0],y_m:toMat(flightNominal.rest[1])}:null;
flight={
samples,landing:{x_m:last[1],y_m:last[2],t_s:last[0]},rest,
band:band?{side_lo:band.slice(0,band.length/2).map(([x,y])=>[x,toMat(y)]),side_hi:band.slice(band.length/2).map(([x,y])=>[x,toMat(y)])}:null,
ground,model:LM_FLIGHT_MODEL,
};
}
return{metrics:out,flight,tracks:tracksOf(input,view),algorithm:{...lmAlgorithm()}};


function faceOn(){
const b=read('ball_speed_mps');
const lv=read('launch_v_deg');
const cs=read('club_speed_mps');

let atk=null;
if(allowed('attack_angle_deg')){
const r=attackFromClub(input.clubTrack?.club??null);
const stored=read('attack_angle_deg');
if(r.ok)atk={value:r.value,sigma:r.sigma,codes:cs.ok?cs.codes:rsCodes,worse:false};
else if(stored.ok&&stored.origin==='club_track')atk=stored;
if(atk){
out.attack_angle_deg=metricValue({value:atk.value,unit:'deg',ci95:[atk.value-1.959964*atk.sigma,atk.value+1.959964*atk.sigma],
sigma:atk.sigma,validity:NAMES[Math.max(RANK[cells.attack_angle_deg.validity],atk.worse?2:0)],value_origin:'club_track',reason_codes:uniq(atk.codes)});
}else{

const migrated=!input.clubTrack&&(input.metrics?.attack_angle_deg?.reason_codes??[]).includes(RC.MIGRATED_V1);
nul('attack_angle_deg',[migrated?RC.MIGRATED_V1:RC.TRACK_TOO_SHORT]);
}
}
const dpOk=Boolean(atk)&&lv.ok&&allowed('dynamic_loft_deg');
const spinOk=dpOk&&cs.ok&&allowed('spin_rate_rpm');
const flightOk=b.ok&&lv.ok&&allowed('carry_m');
if(!dpOk&&!flightOk)return;
const P=LM_PARAMS;
const dv=new Float64Array(n),sl=new Float64Array(n),phys=new Float64Array(n);
const dl=new Float64Array(n);
const bD=new Float64Array(n),lvD=new Float64Array(n);
for(let i=0;i<n;i++){
bD[i]=b.ok?Math.max(1,gauss(rng,b.value,b.sigma)):NaN;
lvD[i]=lv.ok?gauss(rng,lv.value,lv.sigma):NaN;
if(dpOk){
const a=gauss(rng,atk.value,atk.sigma);
const r=inverseVertical(lvD[i],a,{dv:gauss(rng,0,P.dplane.sigma_v)});
dl[i]=r.dl;sl[i]=r.spin_loft;
if(spinOk){
const c=gauss(rng,cs.value,cs.sigma);
phys[i]=spinFromLoft(c,sl[i],club,Math.max(0,1+gauss(rng,0,spinCoefSigma(club,sl[i]))));
}
}
}
const codesIn=uniq([...(b.codes??[]),...(lv.codes??[])]);
let spin=null;
if(dpOk){
const r0=inverseVertical(lv.value,atk.value);
const inDp=uniq([...atk.codes,...lv.codes]);
const worse=atk.worse||lv.worse;
put('dynamic_loft_deg',summary(r0.dl,Array.from(dl)),[RC.DPLANE_MODEL,...inDp],worse);
put('spin_loft_deg',summary(r0.spin_loft,Array.from(sl)),[RC.DPLANE_MODEL,...inDp],worse);
if(spinOk){
const p0=spinFromLoft(cs.value,r0.spin_loft,club);
const sd=std(Array.from(phys));
spin={...mergeSpin({value:p0,sigma:Math.max(sd,1)},spinPrior),physSd:Math.max(sd,1),codes:uniq([...inDp,...cs.codes]),worse:worse||cs.worse};
}
}
if(!flightOk){
if(spin)put('spin_rate_rpm',{value:spin.value,sigma:spin.sigma,ci95:[Math.max(0,spin.value-1.959964*spin.sigma),spin.value+1.959964*spin.sigma]},
[RC.SPIN_MODELLED,...spin.codes],spin.worse);
return;
}

const extra=spin?Math.sqrt(Math.max(0,spin.sigma**2-(spin.w*spin.physSd)**2)):0;
const spinD=new Float64Array(n);
const F=drawsArrays(n);
for(let i=0;i<n;i++){
const s=spin?spin.w*phys[i]+(1-spin.w)*spinPrior.mean_rpm+gauss(rng,0,extra):truncatedPrior(rng,spinPrior);
spinD[i]=Math.max(P.spin.min_rpm,s);
flyDraw(F,i,{speed_mps:bD[i],launch_v_deg:lvD[i],launch_h_deg:0,spin_rpm:spinD[i],axis_deg:0,start});
}
const spin0=spin?spin.value:spinPrior.mean_rpm;
const nom=nominalFlight({speed_mps:b.value,launch_v_deg:lv.value,launch_h_deg:0,spin_rpm:spin0,axis_deg:0,start});
if(!nom)return;
flightNominal=nom;
const spinCode=spin?RC.SPIN_MODELLED:RC.SPIN_ASSUMED;
const worse=b.worse||lv.worse||Boolean(spin?.worse);
const fc=[RC.FLIGHT_MODELLED,spinCode,RC.WIND_IGNORED,...codesIn,...(spin?spin.codes:[])];
if(spin)put('spin_rate_rpm',summary(spin.value,Array.from(spinD)),[RC.SPIN_MODELLED,...spin.codes],spin.worse);
put('carry_m',summary(nom.carry,F.carry),fc,worse,'flight_model');
put('total_m',summary(nom.total,F.total),[RC.ROLL_MODELLED,...fc],worse);
put('apex_m',summary(nom.apex,F.apex),[RC.FLIGHT_MODELLED,spinCode,...codesIn],worse);
put('landing_angle_deg',summary(nom.landing,F.landing),[RC.FLIGHT_MODELLED,spinCode,...codesIn],worse);
put('hang_time_s',summary(nom.hang,F.hang),[RC.FLIGHT_MODELLED,spinCode,...codesIn],worse);
}


function highBehind(){

let cs={ok:false};
if(allowed('club_speed_mps')){
const obs=input.clubTrack?.obs;
const stored=read('club_speed_mps');
if(cam&&Array.isArray(obs)&&obs.length){
const r=hbClubSpeed({cam,obs,ball:[startMat[0],startMat[1]],aoa:CP.aoa,rng});
if(r.ok){
cs={ok:true,value:r.value,sigma:r.sigma,codes:uniq([...rsCodes,...r.reason_codes]),worse:false};
out.club_speed_mps=metricValue({value:r.value,unit:'m/s',ci95:r.ci95,sigma:r.sigma,validity:cells.club_speed_mps.validity,
value_origin:'club_track',reason_codes:cs.codes});
}else nul('club_speed_mps',r.reason_codes);
}else if(stored.ok&&stored.origin==='club_track'){
cs=stored;
out.club_speed_mps=input.metrics.club_speed_mps;
}else nul('club_speed_mps',[RC.TRACK_TOO_SHORT]);
}
const lh=read('launch_h_deg');
const path=read('club_path_deg');
const dirOk=lh.ok&&path.ok&&allowed('face_angle_deg');
const ballOk=cs.ok&&allowed('ball_speed_mps');
const flightOk=ballOk&&allowed('carry_m');
if(!dirOk&&!ballOk)return;
const P=LM_PARAMS;
const F=drawsArrays(n);
const face=new Float64Array(n),f2p=new Float64Array(n),axis=new Float64Array(n),ball=new Float64Array(n);
for(let i=0;i<n;i++){
let lhI=0,axI=0;
if(dirOk){
const pI=gauss(rng,path.value,path.sigma);
lhI=gauss(rng,lh.value,lh.sigma);
const slI=Math.max(1,gauss(rng,CP.spin_loft.mean,CP.spin_loft.sd));
const aI=gauss(rng,CP.aoa.mean,CP.aoa.sd);
const r=inverseHorizontal(lhI,pI,slI,gauss(rng,0,P.dplane.sigma_h));
face[i]=r.face;f2p[i]=r.face_to_path;
axI=axis[i]=spinAxisDeg(aI,pI,slI+aI,r.face);
}
if(ballOk){
ball[i]=Math.max(1,gauss(rng,cs.value,cs.sigma))*gauss(rng,CP.smash.mean,CP.smash.sd);
if(flightOk){
flyDraw(F,i,{speed_mps:ball[i],launch_v_deg:gauss(rng,CP.launch_v.mean,CP.launch_v.sd),launch_h_deg:lhI,
spin_rpm:Math.max(P.spin.min_rpm,truncatedPrior(rng,spinPrior)),axis_deg:axI,start});
}
}
}
const dirCodes=uniq([...lh.codes,...path.codes]);
const dirWorse=lh.worse||path.worse;
let ax0=0;
if(dirOk){
const r0=inverseHorizontal(lh.value,path.value,CP.spin_loft.mean);
ax0=spinAxisDeg(CP.aoa.mean,path.value,CP.spin_loft.mean+CP.aoa.mean,r0.face);
const dc=[RC.DPLANE_MODEL,RC.SPIN_LOFT_ASSUMED,...dirCodes];
put('face_angle_deg',summary(r0.face,Array.from(face)),dc,dirWorse);
put('face_to_path_deg',summary(r0.face_to_path,Array.from(f2p)),dc,dirWorse);
put('spin_axis_deg',summary(ax0,Array.from(axis)),dc,dirWorse);
}
if(!ballOk)return;
const b0=cs.value*CP.smash.mean;
put('ball_speed_mps',summary(b0,Array.from(ball)),[RC.SMASH_ASSUMED,...cs.codes],cs.worse,'derived');
if(!flightOk)return;
const nom=nominalFlight({speed_mps:b0,launch_v_deg:CP.launch_v.mean,launch_h_deg:dirOk?lh.value:0,spin_rpm:spinPrior.mean_rpm,axis_deg:ax0,start});
if(!nom)return;
flightNominal=nom;
const worse=cs.worse||(dirOk&&dirWorse);
const pri=[RC.SPIN_ASSUMED,RC.WIND_IGNORED,RC.SMASH_ASSUMED,RC.LAUNCH_V_ASSUMED,...cs.codes];
const fc=[RC.FLIGHT_MODELLED,...pri,...(dirOk?dirCodes:[])];
put('carry_m',summary(nom.carry,F.carry),fc,worse,'flight_model');
put('total_m',summary(nom.total,F.total),[RC.ROLL_MODELLED,...fc],worse);
if(!dirOk)return;
const sc=[RC.DPLANE_MODEL,RC.FLIGHT_MODELLED,...pri,...dirCodes];
put('carry_side_m',summary(nom.side,F.side),sc,worse);
put('total_side_m',summary(nom.totalSide,F.totalSide),[RC.DPLANE_MODEL,RC.FLIGHT_MODELLED,RC.ROLL_MODELLED,...pri,...dirCodes],worse);
put('curve_m',summary(nom.curve,F.curve),sc,worse);
band=ellipse(F,nom);
}


function drawsArrays(m){
const z=()=>new Array(m).fill(NaN);
return{carry:z(),total:z(),apex:z(),landing:z(),hang:z(),side:z(),totalSide:z(),curve:z(),lx:z(),ly:z()};
}

function flyDraw(F,i,o){
const f=fly(o);
const kc=1+gauss(rng,0,LM_PARAMS.flight.carry_model_sigma_frac);
const ka=1+gauss(rng,0,LM_PARAMS.flight.apex_model_sigma_frac);
const dLand=gauss(rng,0,LM_PARAMS.flight.landing_model_sigma_deg);
const kr=Math.max(0,1+gauss(rng,0,LM_PARAMS.roll.sigma_frac));
if(!f.ok)return;
const r=outcome(f,o,{kc,ka,dLand,kr});
F.carry[i]=r.carry;F.total[i]=r.total;F.apex[i]=r.apex;F.landing[i]=r.landing;F.hang[i]=r.hang;
F.side[i]=r.side;F.totalSide[i]=r.totalSide;F.curve[i]=r.curve;F.lx[i]=r.lx;F.ly[i]=r.ly;
}
function nominalFlight(o){
const f=fly({...o,record:true});
if(!f.ok)return null;
return{...outcome(f,o,{kc:1,ka:1,dLand:0,kr:1}),path:f.path};
}

function outcome(f,o,k){
const dx=(f.x-o.start[0])*k.kc,dy=(f.y-o.start[1])*k.kc;
const landing=f.landing_deg+k.dLand;
const roll=Math.hypot(dx,dy)*rollFrac(landing,ground)*k.kr;
const vh=Math.hypot(f.vland[0],f.vland[1])||1;
const rx=dx+(roll*f.vland[0])/vh,ry=dy+(roll*f.vland[1])/vh;
const ps=(o.launch_h_deg??0)*D;
return{
carry:dx,total:rx,side:-dy,totalSide:-ry,curve:-dx*Math.sin(ps)-dy*Math.cos(ps),
apex:(f.apex-0)*k.ka,landing,hang:f.t,lx:o.start[0]+dx,ly:o.start[1]+dy,
rest:[o.start[0]+rx,o.start[1]+ry],
};
}

function ellipse(F,nom){
const xs=[],ys=[];
for(let i=0;i<F.lx.length;i++)if(Number.isFinite(F.lx[i])){xs.push(F.lx[i]);ys.push(F.ly[i]);}
if(xs.length<8)return null;
const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;
let sxx=0,sxy=0,syy=0;
for(let i=0;i<xs.length;i++){const a=xs[i]-mx,c=ys[i]-my;sxx+=a*a;sxy+=a*c;syy+=c*c;}
sxx/=xs.length-1;sxy/=xs.length-1;syy/=xs.length-1;
const tr=sxx+syy,det=sxx*syy-sxy*sxy;
const l1=tr/2+Math.sqrt(Math.max(0,tr*tr/4-det)),l2=Math.max(0,tr-l1);
const th=0.5*Math.atan2(2*sxy,sxx-syy);
const cx=nom.lx,cy=nom.ly;
const m=LM_PARAMS.flight.band_points;
const pts=[];
for(let k=0;k<m;k++){
const a=(2*Math.PI*k)/m;
const u=Math.sqrt(l1)*Math.cos(a),v=Math.sqrt(l2)*Math.sin(a);
pts.push([cx+u*Math.cos(th)-v*Math.sin(th),cy+u*Math.sin(th)+v*Math.cos(th)]);
}
return pts;
}
}

function truncatedPrior(rng,prior){
for(let k=0;k<20;k++){
const x=gauss(rng,prior.mean_rpm,prior.sigma_rpm);
if(x>=0.25*prior.mean_rpm)return x;
}
return 0.25*prior.mean_rpm;
}


function tracksOf(input,view){
const obs=(input.ballTrack?.obs??[]).filter((q)=>Number.isFinite(q.u)&&Number.isFinite(q.v)&&Number.isFinite(q.t_s));
if(!obs.length)return null;
const times=input.ballTrack.times&&input.ballTrack.times.length?input.ballTrack.times:null;
const fps=input.fps>0?input.fps:240;
const frameOf=(t)=>{
if(!times)return Math.max(0,Math.round(t*fps));
let lo=0,hi=times.length-1;
while(hi-lo>1){const mid=(lo+hi)>>1;if(times[mid]<=t)lo=mid;else hi=mid;}
return Math.abs(times[hi]-t)<Math.abs(times[lo]-t)?hi:lo;
};
const pts=[];
for(const q of[...obs].sort((a,b)=>a.t_s-b.t_s)){
const f=frameOf(q.t_s);
if(pts.length&&f<=pts[pts.length-1][0])continue;
const r=Number.isFinite(q.r_px)?q.r_px:Number.isFinite(q.w_px)?q.w_px/2:0;
pts.push([f,q.u,q.v,Math.max(0,r)]);
}
const max=40;
const ball=pts.length<=max?pts:Array.from({length:max},(_,k)=>pts[Math.round((k*(pts.length-1))/(max-1))]);
const t0=input.fit?.ok&&Number.isFinite(input.fit.t0)?input.fit.t0:obs[0].t_s;
return{ball_px:ball,impact_frame:frameOf(Math.max(0,t0)),view};
}


function capFps(cap){
const eff=cap?.effective_fps,nom=cap?.nominal_fps;
if(Number.isFinite(nom)&&nom>0&&Number.isFinite(eff)&&Math.abs(eff-nom)<=0.01*nom)return Math.max(eff,nom);
return eff;
}


function seedOf(id){
let h=2166136261;
for(const ch of String(id??''))h=Math.imul(h^ch.codePointAt(0),16777619)>>>0;
return h;
}







export function rederive(shot,{settings={}}={}){
const s=JSON.parse(JSON.stringify(shot));
const view=s.capture?.view;
const r=deriveLaunchMonitor({
view,fps:capFps(s.capture),club:s.club,metrics:s.metrics,fit:null,clubTrack:null,calibration:s.calibration,
settings:{ground:settings.ground??s.flight?.ground??'normal',crossView:false},clubProfile:null,
rng:mulberry32(seedOf(s.shot_id)),handedness:s.handedness,
start:Array.isArray(s.flight?.samples?.[0])?s.flight.samples[0].slice(1):undefined,
});
s.metrics={...s.metrics,...r.metrics};
s.flight=r.flight;
s.algorithms={...s.algorithms,lm:r.algorithm};
if(!('tracks'in s))s.tracks=null;
if(!('practice'in s))s.practice=null;
return attributeWarnings(s);
}
