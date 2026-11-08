






import{DEFAULT_READOUT_MS}from'../geom/constants.js';
import{RC}from'../contract/reason-codes.js';


export const READOUT_MEDIAN_MS=DEFAULT_READOUT_MS;

export const READOUT_ASSUMED_RANGE_MS=Object.freeze([2.0,4.0]);

export const READOUT_ASSUMED_HALFWIDTH_MS=(READOUT_ASSUMED_RANGE_MS[1]-READOUT_ASSUMED_RANGE_MS[0])/2;

export const READOUT_RESIDUAL_FRAC=0.007;

export const READOUT_RESIDUAL_SIGMA_FRAC=READOUT_RESIDUAL_FRAC/Math.sqrt(3);

export const READOUT_MEASURED_SIGMA_MS=0.2;


export const VIEW_DEFAULT_ORIENTATION=Object.freeze({
face_on:'landscape-primary',
high_behind:'landscape-primary',
dtl:'portrait-primary',
});










const ORIENTATION_READOUT=Object.freeze({
'landscape-primary':Object.freeze({axis:'v',dir:1}),
'landscape-secondary':Object.freeze({axis:'v',dir:-1}),
'portrait-primary':Object.freeze({axis:'u',dir:-1}),
'portrait-secondary':Object.freeze({axis:'u',dir:1}),
});






export function readoutFor(orientationType,view){
let o=orientationType;
if(!ORIENTATION_READOUT[o])o=VIEW_DEFAULT_ORIENTATION[view]??'landscape-primary';
const m=ORIENTATION_READOUT[o];
return{axis:m.axis,dir:m.dir,orientation:o,verified:false};
}






export function readoutModel(o={}){
const{axis,dir}=readoutFor(o.orientationType,o.view);
const measured=o.source==='measured'&&Number.isFinite(o.ms);
return{
readout:{ms:measured?o.ms:READOUT_MEDIAN_MS,axis,dir},
source:measured?'measured':'assumed',
reason_codes:measured?[]:[RC.ROLLING_SHUTTER_ASSUMED],
};
}





export function observationTime(obs,t_frame,cam){
const tf=t_frame??obs.t_s;
const ro=cam.readout;
if(!ro||!ro.ms)return tf;
const frac=ro.axis==='u'?obs.u/cam.W:obs.v/cam.H;
return tf+(ro.ms/1000)*ro.dir*(frac-0.5);
}


export function observationTimes(obs,cam){
const out=new Float64Array(obs.length);
for(let i=0;i<obs.length;i++)out[i]=observationTime(obs[i],obs[i].t_s,cam);
return out;
}


export function withReadoutMs(cam,ms){
return{...cam,readout:{...cam.readout,ms}};
}
