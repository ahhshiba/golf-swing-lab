














import{AIR_RHO,BALL_MASS,BALL_R,G}from'../geom/constants.js';

export const BALL_AREA=Math.PI*BALL_R*BALL_R;

export const K_AERO=(AIR_RHO*BALL_AREA)/(2*BALL_MASS);

export const AERO_MODEL=Object.freeze({
CD1:0.225,
CD2:0.287,
CL1:0.462,
CL_EXP:0.4,
SPIN_DECAY_R1:2e-5,

CARRY_MODEL_SIGMA_FRAC:0.03,
});


export const CD_PRIOR=Object.freeze({mean:0.25,sigma:0.05});

export const RPM_TO_RAD_S=(2*Math.PI)/60;


export function spinRatio(omegaRadS,speed){
return speed>0?(omegaRadS*BALL_R)/speed:0;
}


export function aeroCoefficients(S){
const s=S>0?S:0;
return{cd:AERO_MODEL.CD1+AERO_MODEL.CD2*s,cl:AERO_MODEL.CL1*Math.pow(s,AERO_MODEL.CL_EXP)};
}


export function backspinAxis(v0){
const wx=v0[1];
const wy=-v0[0];
const n=Math.hypot(wx,wy);
return n>1e-12?[wx/n,wy/n,0]:[0,-1,0];
}





export function accelInto(out,vx,vy,vz,cd,cl,w){
const sp=Math.sqrt(vx*vx+vy*vy+vz*vz);
const kd=K_AERO*cd*sp;
const kl=K_AERO*cl*sp;

const cx=w[1]*vz-w[2]*vy;
const cy=w[2]*vx-w[0]*vz;
const cz=w[0]*vy-w[1]*vx;
out[0]=-kd*vx+kl*cx;
out[1]=-kd*vy+kl*cy;
out[2]=-G-kd*vz+kl*cz;
return out;
}
