








import{RC}from'../contract/reason-codes.js';
import{METRIC_IDS}from'../contract/enums.js';
import{REGISTRY,cellFor}from'./registry.js';
import{tempoMetrics,nullMetric,valueMetric,worseValidity,rss}from'./common.js';
import{makeBody}from'./body.js';
import{poseContext,finalize}from'./pose.js';
import{computeFaceOn}from'./face_on.js';
import{computeDtl}from'./dtl.js';
import{computeHighBehind}from'./high_behind.js';
import{clubSpeedPoseMetric}from'./club.js';
import{POSE_CLUB_MAX_FPS}from'../physics/clubspeed_pose.js';
import{fpsAtLeast}from'../geom/constants.js';

const VIEW_FN={face_on:computeFaceOn,dtl:computeDtl,high_behind:computeHighBehind};









export function computeMetrics(opts){
const{view,fps,poseSeq,events}=opts;
if(!VIEW_FN[view])throw new RangeError(`computeMetrics: unknown view '${view}'`);
const out={};
const cells={};
for(const id of METRIC_IDS){
const cell=cellFor(id,view,fps);
if(cell.validity===null){
out[id]=nullMetric(id,cell.code===RC.DEPENDS_ON_NULL?'not_computed':'not_observable',[cell.code]);
}else if(REGISTRY[id].row>=14){
if(id==='club_speed_mps'&&view==='face_on'&&!fpsAtLeast(fps,POSE_CLUB_MAX_FPS))cells[id]=cell.validity;
else out[id]=nullMetric(id,'not_computed',[RC.TRACK_TOO_SHORT]);
}else cells[id]=cell.validity;
}

const tempoCells={};
for(const id of['backswing_s','downswing_s','tempo_ratio'])if(cells[id])tempoCells[id]=cells[id];
if(Object.keys(tempoCells).length)Object.assign(out,pick(tempoMetrics(events,fps,tempoCells),tempoCells));


const poseCells={};
for(const id of Object.keys(cells))if(REGISTRY[id].row>=2&&REGISTRY[id].row<=13)poseCells[id]=cells[id];
const poseClub=Boolean(cells.club_speed_mps);
if(Object.keys(poseCells).length||poseClub){
if(!poseSeq||!poseSeq.t_s||poseSeq.t_s.length===0){
for(const id of Object.keys(poseCells))out[id]=nullMetric(id,'not_computed',[RC.POSE_LOW_VISIBILITY]);
if(poseClub)out.club_speed_mps=nullMetric('club_speed_mps','not_computed',[RC.POSE_LOW_VISIBILITY],'pose');
}else{
const body=makeBody({poseSeq,calibration:opts.calibration,view,handedness:opts.handedness??'right',events,venue:opts.venue});
const ctx=poseContext({body,events,calibration:opts.calibration,fps,club:opts.club,clubObs:opts.clubObs});
const got=VIEW_FN[view](ctx,poseCells);

if(poseCells.x_factor_deg)got.x_factor_deg=xFactor(got.shoulder_turn_deg,got.hip_turn_deg,poseCells.x_factor_deg);
for(const id of Object.keys(poseCells)){

if(!got[id])throw new Error(`computeMetrics: ${view} has no primitive for allowed cell ${id}`);
out[id]=got[id];
}
if(poseClub)out.club_speed_mps=clubSpeedPoseMetric(ctx);
if(body.camAssumed){
for(const id of[...Object.keys(poseCells),...(poseClub?['club_speed_mps']:[])]){
const m=out[id];
if(m.value!==null&&!m.reason_codes.includes(RC.BODY_PLANE_ASSUMED)){
out[id]=valueMetric(id,{value:m.value,sigma:m.sigma,ci95:m.ci95,validity:'low_confidence',
codes:[...m.reason_codes,RC.BODY_PLANE_ASSUMED],origin:m.value_origin});
}
}
}
}
}
const ordered={};
for(const id of METRIC_IDS)ordered[id]=out[id];
return ordered;
}

function pick(obj,keys){
const o={};
for(const k of Object.keys(keys))o[k]=obj[k];
return o;
}

function xFactor(s,h,cell){
if(!s||!h||s.value===null||h.value===null)return nullMetric('x_factor_deg','not_computed',[RC.DEPENDS_ON_NULL]);
const codes=[...new Set([...s.reason_codes,...h.reason_codes])];
const value=s.value-h.value;
const sigma=rss(s.sigma,h.sigma);
return finalize('x_factor_deg',cell,{value,sigma,codes,cap:worseValidity(s.validity,h.validity)});
}

