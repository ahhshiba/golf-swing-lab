

export const G=9.80665;
export const BALL_D=0.04267;
export const BALL_R=0.021335;
export const BALL_MASS=0.04593;
export const AIR_RHO=1.204;
export const IPHONE_HFOV_1080P240_DEG=68.161;
export const DEFAULT_READOUT_MS=3.0;
export const TEE_LIFT_PRIOR_M=0.030;
export const TEE_LIFT_PRIOR_SIGMA_M=0.015;


export const DEG=Math.PI/180;
export const RAD2DEG=180/Math.PI;

export const VIEWS=Object.freeze(['face_on','dtl','high_behind']);


export const FPS_TOLERANCE=0.01;

export const fpsAtLeast=(fps,min)=>fps*(1+FPS_TOLERANCE)>=min;
