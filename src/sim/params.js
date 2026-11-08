



const f=Object.freeze;





export const ELLIPSE_K95=2.4477;

export const SIM_PARAMS=f({
version:'sim-1',

reference_sigma_frac:0.12,

gapping_min_n:5,

side_min_n:10,

side_sigma_frac:f({driver:0.08,default:0.06}),

side_sigma_min_m:1,

woods:f(['driver','3w']),
lie:f({
tee:f({carry:1,wood:1,sigma:1}),
fairway:f({carry:1,wood:1,sigma:1}),
green:f({carry:1,wood:1,sigma:1}),
rough:f({carry:0.9,wood:0.85,sigma:1.3}),
bunker:f({carry:0.85,wood:0.7,sigma:1.5}),
}),

greenside_bunker_m:30,

land_deg:f({driver:38,'3w':41,hybrid:44,'5i':45,'7i':47,'9i':49,pw:50,sw:52,default:46}),

land_tan:f({driver:0.7813,'3w':0.8693,hybrid:0.9657,'5i':1,'7i':1.0724,'9i':1.1504,pw:1.1918,sw:1.2799,default:1.0355}),

apex_frac:f({driver:0.13,'3w':0.14,hybrid:0.16,'5i':0.17,'7i':0.19,'9i':0.21,pw:0.23,sw:0.25,default:0.18}),
apex_at:0.58,

path_step_m:2,

roll_mult:f({fairway:1,tee:1,green:1,rough:0.35,bunker:0,water:0,ob:0}),
roll_step_m:0.5,

water_drop_back_m:2,

ob_drop_inside_m:1,

max_score_par_mult:2,

cup_m:0.054,



putt:f({
d50:f({0:2.4,10:1.8,20:1.4,30:1.1}),
k:1.3,tap_in_m:0.45,p_min:0.02,p_max:0.995,
leave_sigma_frac:0.08,leave_sigma_m:0.25,miss_min_m:0.1,max_putts:4,

slope_k:0.08,slope_ref:1,
}),

chip:f({sigma_frac:0.12,skill:f({0:0.8,10:1,20:1.2,30:1.45}),club:'sw'}),

dz_factor:1,
});
