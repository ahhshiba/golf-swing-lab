


import{poseReport as geomPoseReport}from'../geom/camera.js';
import{POSE_KEYS}from'./pnp.js';


export function poseReport(cam,view){
return geomPoseReport(cam,view);
}

function wrap180(x){
let y=x-360*Math.round(x/360);
if(y<=-180)y+=360;
return y;
}





export function presetDeviation(report,preset){
if(!report||!preset)return null;
const ref=preset.pose??preset;
const out={};
for(const k of POSE_KEYS){
const a=report[k];
const b=ref[k];
if(!Number.isFinite(a)||!Number.isFinite(b)){out[k]=null;continue;}
out[k]=k==='yaw_deg'||k==='roll_deg'?wrap180(a-b):a-b;
}
return out;
}









export function makeCalibration(o){
if(!['mat_pnp','club_line','ball_only'].includes(o.method))throw new RangeError(`makeCalibration: bad method '${o.method}'`);
const source=o.source??'live';
if(source!=='live'&&source!=='clip')throw new RangeError("makeCalibration: source must be 'live' or 'clip'");
const pose=poseReport(o.cam,o.view);
const pose_sigma={};
for(const k of POSE_KEYS)pose_sigma[k]=o.sigma?.[k]??null;
return{
method:o.method,
source,
f_px:o.cam.f,
f_locked:Boolean(o.f_locked),
pose,
pose_sigma,
reproj_rmse_px:Number.isFinite(o.rmse_px)?o.rmse_px:null,
slope_deg:Number.isFinite(o.slope_deg)?o.slope_deg:null,
preset_dev:o.preset?presetDeviation(pose,o.preset):null,
readout_ms:o.cam.readout?.ms??null,
readout_source:o.readout_source??'assumed',
camera:o.cam,
};
}
