

























import{RC,REASON_CODES}from'../contract/reason-codes.js';
import{fpsAtLeast,RAD2DEG}from'../geom/constants.js';
import{sha256Hex}from'../physics/sha256.js';
import{POSE_SIGMA,EVENT_CONF_MIN,rss}from'../metrics/common.js';
import{makeBody,meanOver,midOf,meanVis,missingCode}from'../metrics/body.js';
import{poseContext,displacement}from'../metrics/pose.js';
import{LAB_PARAMS,FAULT_IDS,ruleFor}from'./params.js';
import{normalizeLab}from'./settings.js';

const Z95=1.96;

export const WEAK_CODES=Object.freeze([RC.BODY_PLANE_ASSUMED,RC.POSE_LOW_VISIBILITY,RC.EVENTS_UNCERTAIN,
RC.TIMEBASE_SUSPECT,RC.SETUP_UNVERIFIED,RC.CALIB_STALE,RC.PRESET_MISMATCH,RC.DEPTH_DRIFT_SUSPECT,
RC.TIMESTAMPS_NOMINAL,RC.TRACK_MAY_BE_SHORT,RC.OUT_OF_FRAME]);

function canonical(v){
if(Array.isArray(v))return`[${v.map(canonical).join(',')}]`;
if(v!==null&&typeof v==='object')return`{${Object.keys(v).sort().map((k)=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
return JSON.stringify(v);
}
let algo=null;
export function labAlgorithm(){
algo??=Object.freeze({version:LAB_PARAMS.version,sha256:sha256Hex(canonical(LAB_PARAMS))});
return algo;
}


function interval({value,sigma,ci95}){
if(Array.isArray(ci95)&&ci95.length===2&&ci95.every(Number.isFinite))return[Math.min(...ci95),Math.max(...ci95)];
if(Number.isFinite(sigma))return[value-Z95*sigma,value+Z95*sigma];
return null;
}

export function judge(m,op,threshold){
const v=m.value;
const ci=interval(m)??[v,v];
if(op==='>')return v>threshold?(ci[0]>threshold?'fault':'possible'):'ok';
if(op==='<')return v<threshold?(ci[1]<threshold?'fault':'possible'):'ok';
if(op==='outside'){
const[lo,hi]=threshold;
if(v<lo)return ci[1]<lo?'fault':'possible';
if(v>hi)return ci[0]>hi?'fault':'possible';
return'ok';
}
throw new RangeError(`judge: unknown op '${op}'`);
}


function need(ctx,names){
for(const n of names)if(!Number.isFinite(ctx.events?.[n]?.t_s))return{nullValidity:'not_computed',codes:[RC.EVENTS_UNCERTAIN]};
return null;
}
function codesOf(ctx,body,names,frameSets){
const codes=[];
if(names.some((n)=>!(ctx.conf(n)>=EVENT_CONF_MIN)))codes.push(RC.EVENTS_UNCERTAIN);
if(frameSets.some(([fr,js])=>meanVis(body,fr,js)<0.5))codes.push(RC.POSE_LOW_VISIBILITY);
if(body.camAssumed||body.depth?.assumed)codes.push(RC.BODY_PLANE_ASSUMED);
return codes;
}

function tiltOver(body,frames,which){
const per=[];
for(const i of frames){
const sh=midOf(body,i,11,12);
const hp=midOf(body,i,23,24);
if(!sh||!hp)continue;
const s=[sh[0]-hp[0],sh[1]-hp[1],sh[2]-hp[2]];
per.push(Math.atan2(which==='forward'?-s[1]:-s[0],s[2])*RAD2DEG);
}
if(!per.length)return null;
const m=per.reduce((a,x)=>a+x,0)/per.length;
const sd=per.length>1?Math.sqrt(per.reduce((a,x)=>a+(x-m)**2,0)/(per.length-1)):0;
return{value:m,sd,n:per.length};
}
const SPINE=[11,12,23,24];

export function labMeasure(name,body,ctx){
const lv=LAB_PARAMS.sigmaLevel;
if(name==='forward_tilt_change'||name==='side_tilt_top'){
const ev=name==='side_tilt_top'?'top':'impact';
const names=name==='side_tilt_top'?['top']:['address','impact'];
const miss=need(ctx,names);
if(miss)return miss;
const fe=body.eventFrames(ev);
const te=tiltOver(body,fe,name==='side_tilt_top'?'side':'forward');
if(!te)return{nullValidity:'occluded',codes:[missingCode(body,fe,SPINE)]};
if(name==='side_tilt_top'){
const sigma=rss(POSE_SIGMA.angle_deg[lv],te.sd/Math.sqrt(te.n),ctx.roll_sigma_deg);
return{value:te.value,sigma,codes:codesOf(ctx,body,names,[[fe,SPINE]])};
}
const fa=body.addressFrames();
const ta=tiltOver(body,fa,'forward');
if(!ta)return{nullValidity:'occluded',codes:[missingCode(body,fa,SPINE)]};

const sigma=rss(POSE_SIGMA.angle_deg[lv],te.sd/Math.sqrt(te.n),ta.sd/Math.sqrt(ta.n));
return{value:te.value-ta.value,sigma,codes:codesOf(ctx,body,names,[[fe,SPINE],[fa,SPINE]])};
}
if(name==='hand_path_transition'){
const names=['address','mid_backswing','mid_downswing'];
const miss=need(ctx,names);
if(miss)return miss;
const fa=body.addressFrames();
const fb=body.eventFrames('mid_backswing');
const fm=body.eventFrames('mid_downswing');
const mean=(fr)=>meanOver(fr,(i)=>midOf(body,i,15,16));
const ha=mean(fa);
if(!ha)return{nullValidity:'occluded',codes:[missingCode(body,fa,[15,16])]};
const hb=mean(fb);
if(!hb)return{nullValidity:'occluded',codes:[missingCode(body,fb,[15,16])]};
const hm=mean(fm);
if(!hm)return{nullValidity:'occluded',codes:[missingCode(body,fm,[15,16])]};
const n=Math.hypot(ha.X[1],ha.X[2]);
if(!(n>0))return{nullValidity:'implausible',codes:[RC.IMPLAUSIBLE_VALUE]};
const dev=(h)=>(h.X[2]*ha.X[1]-h.X[1]*ha.X[2])/n;
const value=dev(hm)-dev(hb);


const sigma=rss(POSE_SIGMA.disp_rel[lv]*Math.abs(value),POSE_SIGMA.disp_abs_m[lv]*Math.SQRT2,LAB_PARAMS.handMotionSigma,(body.depth?.sigma_rel??0)*Math.abs(value));
return{value,sigma,codes:codesOf(ctx,body,names,[[fm,[15,16]],[fb,[15,16]]])};
}
if(name==='pelvis_sway_top'){
const r=displacement(ctx,lv,[23,24],'top',0,-1);
if(r.nullValidity)return r;
return{value:r.value,sigma:r.sigma,codes:[...r.codes]};
}
if(name==='pelvis_past_lead_ankle'){
const names=['address','impact'];
const miss=need(ctx,names);
if(miss)return miss;
const fa=body.addressFrames();
const fi=body.eventFrames('impact');
const pel=meanOver(fi,(i)=>midOf(body,i,23,24));
if(!pel)return{nullValidity:'occluded',codes:[missingCode(body,fi,[23,24])]};
const ank=meanOver(fa,(i)=>body.P(i,27));
if(!ank)return{nullValidity:'occluded',codes:[missingCode(body,fa,[27])]};
const value=pel.X[0]-ank.X[0];
const jitter=Math.hypot(pel.sd[0]/Math.sqrt(pel.n),ank.sd[0]/Math.sqrt(ank.n));
const span=Math.abs(pel.X[0])+Math.abs(ank.X[0]);
const sigma=rss(POSE_SIGMA.disp_rel[lv]*Math.abs(value),POSE_SIGMA.disp_abs_m[lv],jitter,(body.depth?.sigma_rel??0)*span);
return{value,sigma,codes:codesOf(ctx,body,names,[[fi,[23,24]],[fa,[27]]])};
}
throw new RangeError(`labMeasure: unknown measurement '${name}'`);
}


const uniq=(xs)=>[...new Set(xs.filter((c)=>c in REASON_CODES))];
const sigmaOf=(m)=>(Number.isFinite(m.sigma)?m.sigma:(Array.isArray(m.ci95)&&m.ci95.every(Number.isFinite)?Math.abs(m.ci95[1]-m.ci95[0])/(2*Z95):null));


function widen(m,sys){
const s=Z95*sys;
const ci=Array.isArray(m.ci95)&&m.ci95.every(Number.isFinite)
?[m.value-Math.hypot(m.value-Math.min(...m.ci95),s),m.value+Math.hypot(Math.max(...m.ci95)-m.value,s)]:null;
return{...m,sigma:Number.isFinite(m.sigma)?Math.hypot(m.sigma,sys):(ci?(ci[1]-ci[0])/(2*Z95):null),ci95:ci};
}

function unknown(id,codes,rule=null){
const c=uniq(codes);
return{id,status:'unknown',value:null,sigma:null,threshold:rule?thresholdNum(rule,null):null,event:rule?.event??null,reason_codes:c.length?c:[RC.DEPENDS_ON_NULL]};
}

function thresholdNum(rule,value){
if(!Array.isArray(rule.threshold))return rule.threshold;
const[lo,hi]=rule.threshold;
return Number.isFinite(value)&&value<(lo+hi)/2?lo:hi;
}

export function evaluateFaults(args){
const{shot,poseSeq=null,view,fps,settings,at}=args??{};
if(!['face_on','dtl','high_behind'].includes(view))throw new RangeError(`evaluateFaults: unknown view '${view}'`);
const sens=normalizeLab(settings).sensitivity;
const events=shot?.events??{};
let ctx;
let body;
const bodyCtx=()=>{
if(ctx!==undefined)return ctx;
ctx=null;
if(poseSeq?.t_s?.length&&poseSeq?.img){
try{
body=makeBody({poseSeq,calibration:shot?.calibration??null,view,handedness:shot?.handedness??'right',events});
ctx=poseContext({body,events,calibration:shot?.calibration??null,fps});
}catch(_){ctx=null;}
}
return ctx;
};
const faults=FAULT_IDS.map((id)=>{
const rule=ruleFor(id,view,sens);
if(!rule.allowed)return unknown(id,[rule.viewCode??RC.VIEW_PLANE_MISMATCH]);
if(!fpsAtLeast(Number(fps)||0,rule.minFps))return unknown(id,[RC.FPS_TOO_LOW],rule);
if(rule.disabled)return unknown(id,[rule.disabled],rule);
let m;
if(rule.kind==='metric'){
const mt=shot?.metrics?.[rule.key];
if(!mt||!Number.isFinite(mt.value))return unknown(id,mt?.reason_codes?.length?mt.reason_codes:[RC.DEPENDS_ON_NULL],rule);
m={value:mt.value,sigma:sigmaOf(mt),ci95:mt.ci95??null,codes:mt.reason_codes??[]};
}else{
const c=bodyCtx();
if(!c)return unknown(id,[RC.POSE_LOW_VISIBILITY],rule);
const r=labMeasure(rule.key,body,c);
if(r.nullValidity||!Number.isFinite(r.value)||!Number.isFinite(r.sigma))return unknown(id,r.codes??[RC.IMPLAUSIBLE_VALUE],rule);
m={value:r.value,sigma:r.sigma,ci95:null,codes:r.codes};
}
if(rule.sysSigma>0)m=widen(m,rule.sysSigma);
const status=judge(m,rule.op,rule.threshold);
const codes=uniq([...m.codes,...(status==='possible'?[RC.FAULT_INCONCLUSIVE]:[])]);
return{id,status,value:m.value,sigma:m.sigma,threshold:thresholdNum(rule,m.value),event:rule.event,reason_codes:codes};
});
return{
shot_id:String(shot?.shot_id??''),view,algo:{...labAlgorithm()},faults,
computed_at:at??new Date().toISOString(),
};
}

export function faultValidity(fault,shot=null){
if(!fault||fault.status==='unknown')return null;
if((fault.reason_codes??[]).some((c)=>WEAK_CODES.includes(c)))return'low_confidence';
const view=shot?.capture?.view;
if(view&&LAB_PARAMS.faults[fault.id]){
const rule=ruleFor(fault.id,view);
if(rule.kind==='metric'&&shot?.metrics?.[rule.key]?.validity==='low_confidence')return'low_confidence';
}
return'estimated';
}

export function confidenceKey(fault){
if(!fault)return null;
if(fault.status==='fault')return'likely';
if(fault.status==='possible')return'possible';
if(fault.status==='unknown')return'unknown';
return null;
}


export const shownFaults=(rec)=>(rec?.faults??[]).filter((f)=>f.status==='fault'||f.status==='possible');
