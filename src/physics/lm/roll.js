



import{LM_PARAMS}from'./params.js';
import{interp}from'./dplane.js';

export const LM_GROUND_DEFAULT='normal';


export function rollFrac(landingDeg,ground=LM_GROUND_DEFAULT){
const R=LM_PARAMS.roll;
const ys=R[ground]??R[LM_GROUND_DEFAULT];
return Math.max(0,interp(landingDeg,R.angle_knots_deg,ys));
}
