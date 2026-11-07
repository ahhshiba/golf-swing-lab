



















import{RC}from'../contract/reason-codes.js';

export const VFR_CV_LIMIT=0.05;

export function rotationFromMatrix(m){
if(!m||m.length<5)return{rotation:0,mirrored:false,exact:false};
const a=m[0]/65536,b=m[1]/65536,c=m[3]/65536,d=m[4]/65536;
const det=a*d-b*c;
const deg=(Math.atan2(b,a)*180)/Math.PI;
const r=((Math.round(deg/90)*90)%360+360)%360;
return{rotation:r,mirrored:det<0,exact:Math.abs(deg-Math.round(deg/90)*90)<1e-6};
}

export function displaySize(W,H,rotation){
return rotation===90||rotation===270?{width:H,height:W}:{width:W,height:H};
}

export function displayPoint(x,y,rotation,Wc,Hc){
switch(rotation){
case 90:return[Hc-y,x];
case 180:return[Wc-x,Hc-y];
case 270:return[y,Wc-x];
default:return[x,y];
}
}

export function ctsStats(t){
const n=t.length;
if(n<2)return{n,effective_fps:NaN,mean_dt:NaN,cv:NaN,vfr:false,monotonic:n===1};
let monotonic=true;
let s=0;
for(let i=1;i<n;i++){const d=t[i]-t[i-1];if(!(d>0))monotonic=false;s+=d;}
const mean=s/(n-1);
let v=0;
for(let i=1;i<n;i++){const d=t[i]-t[i-1]-mean;v+=d*d;}
const sd=n>2?Math.sqrt(v/(n-2)):0;
const span=t[n-1]-t[0];
const cv=mean>0?sd/mean:NaN;
return{n,effective_fps:span>0?(n-1)/span:NaN,mean_dt:mean,cv,vfr:Number.isFinite(cv)&&cv>VFR_CV_LIMIT,monotonic};
}

export function buildTimebase(samples,opts={}){
const n=samples.length;
const raw=new Float64Array(n);
let ok=n>0;
for(let i=0;i<n;i++){
const s=samples[i];
const v=s&&Number.isFinite(s.cts)&&s.timescale>0?s.cts/s.timescale:NaN;
if(!Number.isFinite(v))ok=false;
raw[i]=v;
}

const idx=Array.from({length:n},(_,i)=>i);
if(ok)idx.sort((p,q)=>raw[p]-raw[q]||p-q);
const order=Int32Array.from(idx);
const pres=new Int32Array(n);
for(let p=0;p<n;p++)pres[order[p]]=p;
let t=new Float64Array(n);
for(let p=0;p<n;p++)t[p]=raw[order[p]];
const stats=ok?ctsStats(t):{monotonic:false};
let nominal=Number.isFinite(opts.nominal_fps)&&opts.nominal_fps>0?opts.nominal_fps:NaN;
const reason_codes=[];
let timestamps='container';
if(!ok||!stats.monotonic){
if(!Number.isFinite(nominal))nominal=Number.isFinite(stats.effective_fps)&&stats.effective_fps>0?stats.effective_fps:30;
t=new Float64Array(n);
for(let p=0;p<n;p++)t[p]=p/nominal;
timestamps='nominal';
reason_codes.push(RC.TIMESTAMPS_NOMINAL);
}
const fin=ctsStats(t);
if(!Number.isFinite(nominal))nominal=fin.effective_fps;
return{t_s:t,order,pres,timestamps,nominal_fps:nominal,effective_fps:fin.effective_fps,vfr:fin.vfr,cv:fin.cv,reason_codes};
}

export function rangeIndices(t,from_s=-Infinity,to_s=Infinity){
let i0=0;
while(i0<t.length&&t[i0]<from_s-1e-9)i0++;
let i1=t.length-1;
while(i1>=0&&t[i1]>to_s+1e-9)i1--;
return[i0,i1];
}

export function gridIndices(t,hz,from_s=-Infinity,to_s=Infinity){
const[i0,i1]=rangeIndices(t,from_s,to_s);
const out=[];
if(i1<i0)return Int32Array.from(out);
if(!(hz>0)){for(let i=i0;i<=i1;i++)out.push(i);return Int32Array.from(out);}
const period=1/hz;
const t0=t[i0];
let j=i0;
let last=-1;
for(let k=0;;k++){
const g=t0+k*period;
if(g>t[i1]+period/2)break;
while(j<i1&&Math.abs(t[j+1]-g)<=Math.abs(t[j]-g))j++;
if(j!==last&&Math.abs(t[j]-g)<=period/2+1e-9){out.push(j);last=j;}
}
return Int32Array.from(out);
}

export function impactWindow(t_impact,fps,opts={}){
const pre=opts.pre??30;
const post=opts.post??60;
const f=fps>0?fps:30;
let from_s=t_impact-pre/f;
let to_s=t_impact+post/f;
if(Number.isFinite(opts.t_min))from_s=Math.max(from_s,opts.t_min);
if(Number.isFinite(opts.t_max))to_s=Math.min(to_s,opts.t_max);
return{from_s,to_s};
}
