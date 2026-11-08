




















import{RC}from'../contract/reason-codes.js';
import{project}from'../geom/camera.js';
import{BALL_R}from'../geom/constants.js';
import{LAB_LINE_IDS}from'./settings.js';

const OK=true;
const CAL='calib';
export const LINE_TABLE=Object.freeze({
head_box:Object.freeze({face_on:OK,dtl:OK,high_behind:OK}),
spine:Object.freeze({face_on:OK,dtl:OK,high_behind:RC.VIEW_PLANE_MISMATCH}),
shoulders:Object.freeze({face_on:OK,dtl:RC.VIEW_DEPTH_AXIS,high_behind:RC.VIEW_DEPTH_AXIS}),
hip_walls:Object.freeze({face_on:OK,dtl:RC.VIEW_DEPTH_AXIS,high_behind:RC.VIEW_DEPTH_AXIS}),
butt_line:Object.freeze({face_on:RC.VIEW_DEPTH_AXIS,dtl:OK,high_behind:RC.VIEW_PLANE_MISMATCH}),
stance:Object.freeze({face_on:OK,dtl:RC.VIEW_DEPTH_AXIS,high_behind:RC.VIEW_DEPTH_AXIS}),
ball_hand_plane:Object.freeze({face_on:RC.VIEW_PLANE_MISMATCH,dtl:CAL,high_behind:RC.VIEW_PLANE_MISMATCH}),
ball_shoulder_plane:Object.freeze({face_on:RC.VIEW_PLANE_MISMATCH,dtl:CAL,high_behind:RC.VIEW_PLANE_MISMATCH}),
target_line:Object.freeze({face_on:CAL,dtl:CAL,high_behind:CAL}),
});
export const LINES_BY_VIEW=Object.freeze(Object.fromEntries(['face_on','dtl','high_behind'].map((v)=>[v,
Object.freeze(LAB_LINE_IDS.filter((id)=>LINE_TABLE[id][v]===OK||LINE_TABLE[id][v]===CAL))])));

export function lineVerdict(id,view){
const c=LINE_TABLE[id]?.[view];
if(c===undefined)throw new RangeError(`unknown line '${id}' / view '${view}'`);
return{draw:c===OK||c===CAL,calib:c===CAL,code:c===OK||c===CAL?null:c};
}

const VIS=0.3;
const ADDRESS_WINDOW_S=0.3;


function meanPx(seq,frames,j,W,H,missing){
let u=0;let v=0;let vis=0;let n=0;let out=0;
for(const i of frames){
const o=(i*33+j)*4;
const vi=seq.img[o+3];
const x=seq.img[o];const y=seq.img[o+1];
vis+=vi;
if(!(x>=-0.02&&x<=1.02&&y>=-0.02&&y<=1.02))out++;
if(!(vi>=VIS)||!Number.isFinite(x)||!Number.isFinite(y))continue;
u+=x*W;v+=y*H;n++;
}
if(!n){missing.set(j,out*2>=frames.length?RC.OUT_OF_FRAME:RC.POSE_LOW_VISIBILITY);return null;}
return{u:u/n,v:v/n,vis:vis/frames.length};
}
function addressFrames(seq,events){
const ta=events?.address?.t_s;
const ts=seq.t_s;
if(!Number.isFinite(ta))return[];
const out=[];
for(let i=0;i<ts.length;i++)if(ts[i]>=ta-ADDRESS_WINDOW_S-1e-9&&ts[i]<=ta+1e-9)out.push(i);
if(!out.length){
let best=0;
for(let i=1;i<ts.length;i++)if(Math.abs(ts[i]-ta)<Math.abs(ts[best]-ta))best=i;
out.push(best);
}
return out;
}

const mid=(a,b)=>({u:(a.u+b.u)/2,v:(a.v+b.v)/2,vis:Math.min(a.vis,b.vis)});
const ext=(a,b,k)=>({u:a.u+(b.u-a.u)*k,v:a.v+(b.v-a.v)*k});


function ballPx(cam){
const p=project(cam,[0,0,BALL_R]);
return Number.isFinite(p.u)&&Number.isFinite(p.v)?{u:p.u,v:p.v,vis:1}:null;
}


function targetPts(cam){
const pts=[];
for(let x=-6;x<=40;x+=0.25){
const p=project(cam,[x,0,0]);
if(!(p.z>0.3)||!Number.isFinite(p.u))continue;
if(p.u<-cam.W||p.u>2*cam.W||p.v<-cam.H||p.v>2*cam.H)continue;
pts.push(p);
}
if(pts.length<2)return null;
return[pts[0],pts[pts.length-1]];
}

export function computeLines(args){
const{view,poseSeq=null,events=null,calibration=null,handedness='right',frame}=args??{};
if(!['face_on','dtl','high_behind'].includes(view))throw new RangeError(`computeLines: unknown view '${view}'`);
const live=Number.isInteger(frame);
const kind=live?'live':'ref';
const out={};
const reasons={};
const cam=calibration?.camera??null;
const hasPose=Boolean(poseSeq?.img&&poseSeq?.t_s?.length);
const W=cam?.W??poseSeq?.W??1;
const H=cam?.H??poseSeq?.H??1;
let frames=[];
if(hasPose)frames=live?[Math.max(0,Math.min(poseSeq.t_s.length-1,frame))]:addressFrames(poseSeq,events);
const lm=new Map();
const missing=new Map();
const P=(j)=>{
if(!lm.has(j))lm.set(j,frames.length?meanPx(poseSeq,frames,j,W,H,missing):null);
return lm.get(j);
};
const trail=handedness==='left'?{sh:11,hip:23}:{sh:12,hip:24};
const norm=(p)=>[p.u/W,p.v/H];
const box=(cu,cv,s)=>[[cu-s/2,cv-s/2],[cu+s/2,cv-s/2],[cu+s/2,cv+s/2],[cu-s/2,cv+s/2]].map(([u,v])=>[u/W,v/H]);

for(const id of LAB_LINE_IDS){
const vd=lineVerdict(id,view);
if(!vd.draw){out[id]=null;reasons[id]=[vd.code];continue;}
if(vd.calib&&!cam){out[id]=null;reasons[id]=[RC.NO_CALIBRATION];continue;}
if(id==='target_line'){
const tp=targetPts(cam);
if(!tp){out[id]=null;reasons[id]=[RC.OUT_OF_FRAME];continue;}
out[id]={pts:tp.map(norm),kind:'ref',validity:'estimated',reason_codes:[]};
continue;
}
if(!hasPose){out[id]=null;reasons[id]=[RC.POSE_LOW_VISIBILITY];continue;}
if(!frames.length){out[id]=null;reasons[id]=[RC.EVENTS_UNCERTAIN];continue;}
const need=(...js)=>js.map(P);
let used=[];
let line=null;
if(id==='head_box'){
const face=need(0,2,5,7,8).filter(Boolean);
const sh=need(11,12);
if(face.length>=2){
used=face;
const us=face.map((p)=>p.u);const vs=face.map((p)=>p.v);
const cu=(Math.min(...us)+Math.max(...us))/2;
const cv=(Math.min(...vs)+Math.max(...vs))/2;
const neck=sh[0]&&sh[1]?Math.abs(mid(sh[0],sh[1]).v-cv):0;

const s=Math.max(Math.max(...us)-Math.min(...us),Math.max(...vs)-Math.min(...vs),0.55*neck)*1.15;
line={pts:box(cu,cv,s),closed:true};
}else if(sh[0]&&sh[1]){

used=sh;
const m=mid(sh[0],sh[1]);
const w=Math.hypot(sh[0].u-sh[1].u,sh[0].v-sh[1].v);
line={pts:box(m.u,m.v-0.55*w,0.6*w*1.15),closed:true,weak:true};
}else used=[null];
}else if(id==='spine'){
used=need(11,12,23,24);
if(used.every(Boolean)){
const hp=mid(used[2],used[3]);const sp=mid(used[0],used[1]);
line={pts:[hp,ext(hp,sp,1.25)].map(norm)};
}
}else if(id==='shoulders'){
used=need(11,12);
if(used.every(Boolean))line={pts:[ext(used[1],used[0],1.2),ext(used[0],used[1],1.2)].map(norm)};
}else if(id==='hip_walls'||id==='stance'){
used=need(23,24,27,28,11,12);
if(used.every(Boolean)){
const[l,r,al,ar,sl,sr]=used;
const top=Math.min(sl.v,sr.v);
const foot=Math.max(al.v,ar.v);
if(id==='hip_walls'){
const w=Math.abs(l.u-r.u)*0.3;
const lo=Math.min(l.u,r.u)-w;const hi=Math.max(l.u,r.u)+w;
line={pts:[[lo,top],[lo,foot],[hi,top],[hi,foot]].map(([u,v])=>[u/W,v/H]),pairs:true};
}else{
const hipV=(l.v+r.v)/2;
const tick=Math.abs(foot-top)*0.06;
line={pts:[[al.u,foot],[al.u,hipV],[ar.u,foot],[ar.u,hipV],
[sl.u,sl.v-tick],[sl.u,sl.v+tick],[sr.u,sr.v-tick],[sr.u,sr.v+tick]].map(([u,v])=>[u/W,v/H]),pairs:true};
}
}
}else if(id==='butt_line'){
used=need(trail.hip,23,24,15,16,11,12,25,26);
const[,l,r,wl,wr,sl,sr,kl,kr]=used;
if(l&&r&&wl&&wr&&sl&&sr){
const hp=mid(l,r);
const hands=mid(wl,wr);
const torso=Math.hypot(mid(sl,sr).u-hp.u,mid(sl,sr).v-hp.v);
const dir=Math.sign(hp.u-hands.u)||1;
const u=(dir>0?Math.max(l.u,r.u):Math.min(l.u,r.u))+dir*0.25*torso;
const bottom=kl&&kr?Math.max(kl.v,kr.v):hp.v+torso*0.9;
line={pts:[[u,Math.min(sl.v,sr.v)],[u,bottom]].map(([a,b])=>[a/W,b/H])};
used=[l,r,wl,wr,sl,sr];
}else used=[l,r,wl,wr,sl,sr];
}else if(id==='ball_hand_plane'||id==='ball_shoulder_plane'){
const ball=ballPx(cam);
used=id==='ball_hand_plane'?need(15,16):need(trail.sh);
if(ball&&used.every(Boolean)){
const to=used.length===2?mid(used[0],used[1]):used[0];
line={pts:[ball,ext(ball,to,id==='ball_hand_plane'?2.2:1.6)].map(norm)};
}else if(!ball){out[id]=null;reasons[id]=[RC.OUT_OF_FRAME];continue;}
}
if(!line){
out[id]=null;
const why=[...missing.values()];
reasons[id]=[why.includes(RC.OUT_OF_FRAME)?RC.OUT_OF_FRAME:RC.POSE_LOW_VISIBILITY];
continue;
}
const seen=used.filter(Boolean);
const weak=line.weak||seen.some((p)=>p.vis<0.5);
const codes=weak?[RC.POSE_LOW_VISIBILITY]:[];
const validity=weak||(id==='head_box'&&view==='high_behind')?'low_confidence':'estimated';
delete line.weak;
out[id]={...line,kind,validity,reason_codes:codes};
}
Object.defineProperty(out,'reasons',{value:Object.freeze(reasons),enumerable:false});
return out;
}


export function deviates(ref,live,tol=0.02){
if(!ref?.pts||!live?.pts||ref.pts.length!==live.pts.length)return false;
let d=0;
for(let i=0;i<ref.pts.length;i++)d=Math.max(d,Math.hypot(ref.pts[i][0]-live.pts[i][0],ref.pts[i][1]-live.pts[i][1]));
return d>tol;
}


export function eventFrame(poseSeq,events,name){
const t=events?.[name]?.t_s;
const ts=poseSeq?.t_s;
if(!Number.isFinite(t)||!ts?.length)return Number.isFinite(events?.[name]?.frame)?events[name].frame:null;
let best=0;
for(let i=1;i<ts.length;i++)if(Math.abs(ts[i]-t)<Math.abs(ts[best]-t))best=i;
return best;
}
