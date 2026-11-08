



import{mulberry32}from'../geom/rng.js';
import{RC}from'../contract/reason-codes.js';
import{fit3d}from'./fit3d.js';
import{fit2d}from'./fit2d.js';
import{clubSpeed}from'./club.js';
import{propagate,systematicsFrom}from'./mc.js';
import{carryEstimate}from'./ballistics.js';
import{ballPlausibility}from'./plausibility.js';
import{BALL_MIN_FPS,toMetrics}from'./result.js';
import{clubPath}from'./clubpath.js';
import{launchHighBehind}from'./launch_h.js';
import{metricNull,metricValue}from'../contract/metric.js';
import{fpsAtLeast}from'../geom/constants.js';








export function analyzeFaceOn(o){
const rng=mulberry32(o.seed??1);
const club=o.club??null;
const fps=o.fps;
const ballFps=fpsAtLeast(fps,BALL_MIN_FPS);
const fit=ballFps
?fit3d({cam:o.cam,obs:o.ballObs??[],start:o.start,t_impact_guess:o.t_impact_guess,fps,club})
:{ok:false,method:'fit3d',ball_speed_mps:null,launch_v_deg:null,flags:[RC.FPS_TOO_LOW]};
const base=ballFps?fit2d({cam:o.cam,obs:o.ballObs??[],start:o.start}):null;
const tImp=fit.ok?fit.t0:o.t_impact_guess;
const clubRes=o.clubObs?clubSpeed({cam:o.cam,obs:o.clubObs,start:o.start,t_impact:tImp,fps}):null;
const systematics=systematicsFrom({
calibration:o.calibration??null,
club,
overrides:{readout_source:o.readout_source??o.calibration?.readout_source??'assumed',...(o.systematics??{})},
});
const plaus=ballPlausibility(fit,o.t_impact_guess??null);
const mc=fit.ok?propagate({fit,club:clubRes,systematics,rng,n:o.nMC??2000}):null;
const carry=fit.ok&&plaus.ok
?carryEstimate({speed_mps:fit.ball_speed_mps,launch_v_deg:fit.launch_v_deg,draws:mc?.draws,club,rng,n:o.nCarry??500})
:null;
const metrics=toMetrics({
fit,mc,carry,club:clubRes,fps,view:o.view??'face_on',readout_source:systematics.readout_source,
lie:club?.lie??'mat',tee_lift_source:club?.tee_lift_source??'measured',t_impact_guess:o.t_impact_guess,
extra_codes:o.extra_codes??[],
});
return{metrics,fit,fit2d:base,club:clubRes,mc,carry};
}







export function analyzeHighBehind(o){
const rng=mulberry32(o.seed??1);
const extra=o.extra_codes??[];
const ball=o.start?[o.start.X[0],o.start.X[1]]:[0,0];
const path=clubPath({
cam:o.cam,obs:o.clubObs??[],ball,fps:o.fps,handedness:o.handedness,calibration:o.calibration,
venue:o.venue,rng,n:o.nMC??600,
});
const launch=launchHighBehind({
cam:o.cam,obs:o.ballObs??[],start:o.start,fps:o.fps,club:o.club??null,t_impact_guess:o.t_impact_guess,
calibration:o.calibration,venue:o.venue,handedness:o.handedness,
});
const asMetric=(r,key,unit)=>(r.ok
?metricValue({value:r[key],unit,ci95:r.ci95,sigma:r.sigma,validity:r.validity,value_origin:r.value_origin,
reason_codes:[...new Set([...r.reason_codes,...extra])]})
:metricNull(r.validity,r.reason_codes,unit,r.value_origin));
return{metrics:{club_path_deg:asMetric(path,'club_path_deg','deg'),launch_h_deg:asMetric(launch,'launch_h_deg','deg')},path,launch};
}
