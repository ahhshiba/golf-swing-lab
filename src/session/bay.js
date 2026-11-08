








import{NOMINAL_GEOMETRY}from'../geom/camera.js';

export const TRIPOD_DEPTH_M=0.25;

export const DRIVER_LENGTH_M=1.15;


export const BAY_TABLE=Object.freeze([
Object.freeze({B_min:2.95,D:2.7,h_max:0.87,h_nominal:0.84,shift:0.4,top_m:2.07,verdict:'ideal'}),
Object.freeze({B_min:2.65,D:2.4,h_max:0.74,h_nominal:0.74,shift:0.4,top_m:1.86,verdict:'usable'}),
Object.freeze({B_min:2.45,D:2.2,h_max:0.67,h_nominal:0.67,shift:0.4,top_m:1.72,verdict:'usable_short'}),
Object.freeze({B_min:0,D:2.0,h_max:0.59,h_nominal:0.59,shift:0.34,top_m:1.57,verdict:'not_guaranteed'}),
]);
export const BAY_VERDICTS=Object.freeze(BAY_TABLE.map((r)=>r.verdict));





export function bayAdvice(B_m){
if(!(Number.isFinite(B_m)&&B_m>TRIPOD_DEPTH_M))return{ok:false,B_m:null};
const row=BAY_TABLE.find((r)=>B_m>=r.B_min);
const D_m=Math.min(2.7,+(B_m-TRIPOD_DEPTH_M).toFixed(3));
return{
ok:true,B_m,D_m,row,verdict:row.verdict,
h_max_m:row.h_max,h_nominal_m:row.h_nominal,shift_m:row.shift,
h_max:row.h_max,shift:row.shift,
};
}












export function tripodPlacement(venue={},view='face_on'){
const g=NOMINAL_GEOMETRY[view];
if(!g)throw new RangeError(`tripodPlacement: unknown view '${view}'`);
const L=Number.isFinite(venue?.mat_L)?venue.mat_L:1.5;
const edge=Number.isFinite(venue?.ball_edge_m)?venue.ball_edge_m:0.3;
const bx=Number.isFinite(venue?.ball_x_m)?venue.ball_x_m:0;
let out;
if(view==='face_on'){
const a=Number.isFinite(venue?.bay_B_m)?bayAdvice(venue.bay_B_m):{ok:false};
const D=a.ok?a.D_m:g.D;
const h=a.ok?Math.min(g.h,a.h_max_m):g.h;
const side=a.ok?a.shift_m:g.shift;
out={D_m:D,from_edge_m:D-edge,h_m:h,side_m:side,side_dir:'target',verdict:a.ok?a.verdict:null,source:a.ok?'bay':'nominal'};
}else{

const rear=L/2+bx;
out={D_m:g.Db,from_edge_m:g.Db-rear,h_m:g.h,side_m:g.y,side_dir:'golfer',verdict:null,source:'nominal'};
}
const round=(x,k)=>Math.round(x/k)*k;
return{
view,
orientation:g.W>=g.H?'landscape':'portrait',
lens:1,
...out,
from_edge_m:Math.max(0,+out.from_edge_m.toFixed(3)),
drivers:Math.max(0.5,round(Math.max(0,out.from_edge_m)/DRIVER_LENGTH_M,0.5)),
};
}


export function twoMeasureCheck(a,b,tol_mm=3){
if(!(Number.isFinite(a)&&Number.isFinite(b)&&a>0&&b>0))return{ok:false,mean:null,diff_mm:null};
const diff_mm=Math.abs(a-b)*1000;
return{ok:diff_mm<=tol_mm+1e-9,mean:(a+b)/2,diff_mm};
}
