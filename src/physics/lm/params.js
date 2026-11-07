





const f=(o)=>Object.freeze(o);







const CLUBS=f({

driver:f({tour:f({club_mph:113,aoa:-1.3,launch:10.9,spin:2686,smash:1.48}),a_spin:0.467059,
aoa:f({mean:-1.3,sd:2.5}),spin_loft:f({mean:14.7,sd:3}),launch_v:f({mean:10.9,sd:3}),smash:f({mean:1.48,sd:0.05})}),
wood:f({tour:f({club_mph:107,aoa:-2.9,launch:9.2,spin:3655,smash:1.48}),a_spin:0.676734,
aoa:f({mean:-2.9,sd:2.5}),spin_loft:f({mean:14.6,sd:3}),launch_v:f({mean:9.2,sd:3}),smash:f({mean:1.48,sd:0.05})}),
hybrid:f({tour:f({club_mph:100,aoa:-3.5,launch:10.2,spin:4437,smash:1.46}),a_spin:0.776631,
aoa:f({mean:-3.5,sd:2.5}),spin_loft:f({mean:16.6,sd:3}),launch_v:f({mean:10.2,sd:3}),smash:f({mean:1.46,sd:0.05})}),
iron_long:f({tour:f({club_mph:94,aoa:-3.7,launch:12.1,spin:5361,smash:1.41}),a_spin:0.866489,
aoa:f({mean:-3.7,sd:2.5}),spin_loft:f({mean:19.2,sd:3}),launch_v:f({mean:12.1,sd:3}),smash:f({mean:1.41,sd:0.05})}),
iron_mid:f({tour:f({club_mph:90,aoa:-4.3,launch:16.3,spin:7097,smash:1.33}),a_spin:0.923607,
aoa:f({mean:-4.3,sd:2.5}),spin_loft:f({mean:25.3,sd:3}),launch_v:f({mean:16.3,sd:3}),smash:f({mean:1.33,sd:0.05})}),
iron_short:f({tour:f({club_mph:85,aoa:-4.7,launch:20.4,spin:8647,smash:1.28}),a_spin:0.981602,
aoa:f({mean:-4.7,sd:2.5}),spin_loft:f({mean:31.2,sd:3}),launch_v:f({mean:20.4,sd:3}),smash:f({mean:1.28,sd:0.05})}),
wedge:f({tour:f({club_mph:83,aoa:-5.0,launch:24.2,spin:9304,smash:1.23}),a_spin:0.917166,
aoa:f({mean:-5.0,sd:2.5}),spin_loft:f({mean:37.6,sd:3}),launch_v:f({mean:24.2,sd:3}),smash:f({mean:1.23,sd:0.05})}),

unknown:f({tour:null,a_spin:0.85,
aoa:f({mean:-3.5,sd:3.5}),spin_loft:f({mean:24,sd:8}),launch_v:f({mean:16,sd:6}),smash:f({mean:1.35,sd:0.1})}),
});

export const LM_PARAMS=f({
version:'lm-1.0.0',

dplane:f({sl_knots_deg:f([13,30,50]),h:f([0.76,0.69,0.61]),v:f([0.83,0.81,0.72]),
sigma_h:0.10,sigma_v:0.05,h_min:0.3,v_min:0.3}),


spin:f({a_sigma_frac:0.15,a_sigma_frac_unknown:0.30,sl_max_deg:48,sl_over_sigma_frac:0.5,min_rpm:300,
prior_sigma_floor_frac:0.3}),
clubs:CLUBS,

flight:f({dt_s:0.004,t_max_s:15,mc_draws:256,carry_model_sigma_frac:0.03,apex_model_sigma_frac:0.10,
landing_model_sigma_deg:3,samples_max:64,band_points:16}),

roll:f({angle_knots_deg:f([30,40,50,55]),firm:f([0.14,0.09,0.04,0.02]),normal:f([0.10,0.06,0.025,0.01]),
soft:f([0.06,0.03,0.01,0.0]),sigma_frac:0.5}),

attack:f({kappa_v_per_m:0.76,kappa_v_sigma:0.18,model_sigma_deg:0.5}),


hb_speed:f({window_m:0.45,ahead_m:0.02,max_samples:2,bias_frac:0,sys_sigma_frac:0.05,head_height_m:0.025,
kappa_z_per_m:0.57,kappa_z_sigma:0.12,
head_height_range_m:f([0,0.05]),mc_draws:200}),
});
