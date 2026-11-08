


















import{RC}from'../contract/reason-codes.js';


export const PRE_IMPACT_FRAMES=30;
export const POST_IMPACT_FRAMES=60;


const WR=19595;
const WG=38470;
const WB=7471;

function dims(img){
const W=img.W??img.width;
const H=img.H??img.height;
if(!Number.isInteger(W)||!Number.isInteger(H)||W<=0||H<=0)throw new RangeError('frames: image needs integer W/H (or width/height)');
if(!img.data||img.data.length<W*H*4)throw new RangeError('frames: RGBA data shorter than W·H·4');
return[W,H];
}


export function rgbaToGray(img,out){
const[W,H]=dims(img);
const d=img.data;
const n=W*H;
const g=out&&out.length>=n?out:new Uint8Array(n);
for(let p=0,q=0;p<n;p++,q+=4)g[p]=(WR*d[q]+WG*d[q+1]+WB*d[q+2]+32768)>>>16;
return g;
}


export function clampRoi(roi,W,H){
if(!roi)return{x:0,y:0,w:W,h:H};
const x0=Math.max(0,Math.floor(roi.x));
const y0=Math.max(0,Math.floor(roi.y));
const x1=Math.min(W,Math.ceil(roi.x+roi.w));
const y1=Math.min(H,Math.ceil(roi.y+roi.h));
if(!(x1>x0&&y1>y0))return null;
return{x:x0,y:y0,w:x1-x0,h:y1-y0};
}


export function rgbaToGrayCrop(img,roi,out){
const[W,H]=dims(img);
const r=clampRoi(roi,W,H);
if(!r)throw new RangeError('rgbaToGrayCrop: ROI outside the image');
const d=img.data;
const g=out&&out.length>=r.w*r.h?out:new Uint8Array(r.w*r.h);
for(let y=0;y<r.h;y++){
let q=((r.y+y)*W+r.x)*4;
let p=y*r.w;
for(let x=0;x<r.w;x++,p++,q+=4)g[p]=(WR*d[q]+WG*d[q+1]+WB*d[q+2]+32768)>>>16;
}
return{data:g,W:r.w,H:r.h,origin:{u:r.x,v:r.y},roi:r};
}


export function cropGray(gray,W,H,roi){
if(!gray||gray.length<W*H)throw new RangeError('cropGray: data shorter than W·H');
const r=clampRoi(roi,W,H);
if(!r)throw new RangeError('cropGray: ROI outside the image');
const out=new Uint8Array(r.w*r.h);
for(let y=0;y<r.h;y++)out.set(gray.subarray((r.y+y)*W+r.x,(r.y+y)*W+r.x+r.w),y*r.w);
return{data:out,W:r.w,H:r.h,origin:{u:r.x,v:r.y},roi:r};
}






export function resolveTimestamps(cts,n,nominal_fps){
const N=Number.isInteger(n)?n:cts?.length??0;
let ok=Array.isArray(cts)||ArrayBuffer.isView(cts);
if(ok&&cts.length<N)ok=false;
let monotonic=ok;
if(ok){
for(let i=0;i<N;i++){
if(!Number.isFinite(cts[i])||(i>0&&!(cts[i]>cts[i-1]))){monotonic=false;break;}
}
}
if(ok&&monotonic)return{times:Float64Array.from({length:N},(_,i)=>cts[i]),kind:'container',monotonic:true,reason_codes:[]};
if(!(nominal_fps>0))throw new RangeError('resolveTimestamps: no usable CTS and no nominal_fps');
return{
times:Float64Array.from({length:N},(_,i)=>i/nominal_fps),
kind:'nominal',
monotonic,
reason_codes:[RC.TIMESTAMPS_NOMINAL],
};
}


export function effectiveFps(times){
if(!times||times.length<2)return NaN;
const span=times[times.length-1]-times[0];
return span>0?(times.length-1)/span:NaN;
}


export function nearestFrame(times,t_s){
const n=times?.length??0;
if(!n)return-1;
if(!(t_s>times[0]))return 0;
if(t_s>=times[n-1])return n-1;
let lo=0;
let hi=n-1;
while(hi-lo>1){
const mid=(lo+hi)>>1;
if(times[mid]<=t_s)lo=mid;else hi=mid;
}
return t_s-times[lo]<=times[hi]-t_s?lo:hi;
}






export function impactWindow(o){
const n=o.times?o.times.length:o.n;
if(!Number.isInteger(n)||n<=0)throw new RangeError('impactWindow: empty clip');
let impact;
if(Number.isInteger(o.impact_frame))impact=o.impact_frame;
else if(Number.isFinite(o.impact_t_s)&&o.times)impact=nearestFrame(o.times,o.impact_t_s);
else throw new RangeError('impactWindow: needs impact_frame, or impact_t_s with times');
impact=Math.min(n-1,Math.max(0,impact));
const before=o.before??PRE_IMPACT_FRAMES;
const after=o.after??POST_IMPACT_FRAMES;
const start=Math.max(0,impact-before);
const end=Math.min(n,impact+after+1);
return{start,end,impact,n:end-start,clipped:start!==impact-before||end!==impact+after+1};
}


export function sliceWindow(frames,times,win){
return{frames:frames.slice(win.start,win.end),times:Float64Array.from(times.slice(win.start,win.end))};
}






export function suggestBallRoi(o){
const{W,H,rest}=o;
const r=(rest.w_px>0?rest.w_px:20)/2;
const back=o.back_px??10*r;
const below=o.below_px??4*r;
const tee=o.tee_px??0;
const du=o.dir?.[0]??1;
const x0=du>=0?rest.u-back:0;
const x1=du>=0?W:rest.u+back;
const y1=rest.v+r+below+tee;
return clampRoi({x:x0,y:0,w:x1-x0,h:y1},W,H);
}
