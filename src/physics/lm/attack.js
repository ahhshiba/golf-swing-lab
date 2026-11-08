








import{LM_PARAMS}from'./params.js';

const D=Math.PI/180;


export function attackFromClub(club){
if(!club||!club.ok||!Array.isArray(club.v_vec)||!Number.isFinite(club.t_mid)||!(club.club_speed_mps>0))return{ok:false};
const v=club.v_vec;
const sp=Math.hypot(v[0],v[1],v[2]);
if(!(sp>0))return{ok:false};
const P=LM_PARAMS.attack;
const chord=Math.atan2(v[2],Math.hypot(v[0],v[1]))/D;
const s=Math.abs(club.t_mid)*sp;
const value=chord+(P.kappa_v_per_m*s)/D;
const sPix=(club.sigma??0)/club.club_speed_mps/D;
const sigma=Math.hypot(sPix,(P.kappa_v_sigma*s)/D,P.model_sigma_deg);
return{ok:true,value,sigma,chord_deg:chord,s_mid_m:s};
}
