





export const FEATURE_VERSION='evfeat-1';
export const FEATURE_HZ=30;

export const FEATURE_NAMES=Object.freeze([
'wrist_x',
'wrist_y',
'wrist_vx',
'wrist_vy',
'wrist_speed',
'lead_wrist_h',
'trail_wrist_h',
'shoulder_angle',
'hip_angle',
'lead_elbow',
'trail_elbow',
'vis_mean',
]);

export const N_LANDMARKS=33;


export const LR_PAIRS=Object.freeze([
[1,4],[2,5],[3,6],[7,8],[9,10],[11,12],[13,14],[15,16],[17,18],[19,20],[21,22],
[23,24],[25,26],[27,28],[29,30],[31,32],
]);


export const LR_SWAP=Object.freeze((()=>{
const m=Array.from({length:N_LANDMARKS},(_,i)=>i);
for(const[a,b]of LR_PAIRS){m[a]=b;m[b]=a;}
return m;
})());

const VIS_SET=[11,12,13,14,15,16,23,24];








export function resamplePose(poseSeq,hz=FEATURE_HZ){
const ts=poseSeq.t_s;
const T=ts.length;
if(!(T>=1))throw new RangeError('resamplePose: empty PoseSeq');
if(!(hz>0))throw new RangeError('resamplePose: hz must be > 0');
const src=poseSeq.img;
const C=N_LANDMARKS*4;
if(src.length<T*C)throw new RangeError('resamplePose: img is shorter than T*33*4');
const t0=ts[0];
const K=T===1?1:Math.floor((ts[T-1]-t0)*hz+1e-9)+1;
const t=new Float64Array(K);
const img=new Float64Array(K*C);
let i=0;
for(let k=0;k<K;k++){
const tk=t0+k/hz;
t[k]=tk;
if(T===1){
for(let c=0;c<C;c++)img[c]=src[c];
continue;
}
while(i<T-2&&ts[i+1]<tk)i++;
const ta=ts[i];
const tb=ts[i+1];
let w=tb>ta?(tk-ta)/(tb-ta):0;
if(w<0)w=0;
if(w>1)w=1;
const oa=i*C;
const ob=(i+1)*C;
const ok=k*C;
for(let c=0;c<C;c++){
const a=src[oa+c];
img[ok+c]=a+w*(src[ob+c]-a);
}
}
return{t,img,K,W:poseSeq.W,H:poseSeq.H};
}






export function canonicalPixels(img,K,W,H,handedness='right'){
const C=N_LANDMARKS*4;
const out=new Float64Array(K*C);
const left=handedness==='left';
for(let k=0;k<K;k++){
const o=k*C;
for(let j=0;j<N_LANDMARKS;j++){
const s=o+(left?LR_SWAP[j]:j)*4;
const d=o+j*4;
const xn=img[s];
out[d]=(left?1-xn:xn)*W;
out[d+1]=img[s+1]*H;
out[d+2]=img[s+2];
out[d+3]=img[s+3];
}
}
return out;
}


export function gradient(y,hz){
const n=y.length;
const g=new Float64Array(n);
if(n<2)return g;
g[0]=(y[1]-y[0])*hz;
g[n-1]=(y[n-1]-y[n-2])*hz;
for(let k=1;k<n-1;k++)g[k]=((y[k+1]-y[k-1])*hz)/2;
return g;
}


export function unwrap(p){
const n=p.length;
const out=new Float64Array(n);
if(n===0)return out;
const TWO_PI=2*Math.PI;
let corr=0;
out[0]=p[0];
for(let k=1;k<n;k++){
const dd=p[k]-p[k-1];
let ddmod=((((dd+Math.PI)%TWO_PI)+TWO_PI)%TWO_PI)-Math.PI;
if(ddmod===-Math.PI&&dd>0)ddmod=Math.PI;
if(Math.abs(dd)>=Math.PI)corr+=ddmod-dd;
out[k]=p[k]+corr;
}
return out;
}

function medianOf(arr){
const s=Float64Array.from(arr).sort();
const n=s.length;
if(n===0)return NaN;
return n%2?s[(n-1)>>1]:(s[n/2-1]+s[n/2])/2;
}






export function computeFeatures(poseSeq,opts={}){
const hz=opts.hz??FEATURE_HZ;
const handedness=opts.handedness??'right';
const r=resamplePose(poseSeq,hz);
const{K,W,H}=r;
const px=canonicalPixels(r.img,K,W,H,handedness);
const C=N_LANDMARKS*4;
const U=(k,j)=>px[k*C+j*4];
const V=(k,j)=>px[k*C+j*4+1];
const VIS=(k,j)=>px[k*C+j*4+3];

const torso=new Float64Array(K);
for(let k=0;k<K;k++){
const du=(U(k,11)+U(k,12))/2-(U(k,23)+U(k,24))/2;
const dv=(V(k,11)+V(k,12))/2-(V(k,23)+V(k,24))/2;
torso[k]=Math.sqrt(du*du+dv*dv);
}
let L=medianOf(torso);
if(!(L>1e-6))L=0.25*H;

const F=FEATURE_NAMES.length;
const data=new Float64Array(K*F);
const wx=new Float64Array(K);
const wy=new Float64Array(K);
const sh=new Float64Array(K);
const hp=new Float64Array(K);
for(let k=0;k<K;k++){
const hu=(U(k,23)+U(k,24))/2;
const hv=(V(k,23)+V(k,24))/2;
const wu=(U(k,15)+U(k,16))/2;
const wv=(V(k,15)+V(k,16))/2;
wx[k]=(wu-hu)/L;
wy[k]=-(wv-hv)/L;
sh[k]=Math.atan2(-(V(k,11)-V(k,12)),U(k,11)-U(k,12));
hp[k]=Math.atan2(-(V(k,23)-V(k,24)),U(k,23)-U(k,24));
const o=k*F;
data[o]=wx[k];
data[o+1]=wy[k];
data[o+5]=-(V(k,15)-hv)/L;
data[o+6]=-(V(k,16)-hv)/L;
data[o+9]=jointAngle(U(k,11),V(k,11),U(k,13),V(k,13),U(k,15),V(k,15));
data[o+10]=jointAngle(U(k,12),V(k,12),U(k,14),V(k,14),U(k,16),V(k,16));
let vs=0;
for(const j of VIS_SET)vs+=VIS(k,j);
data[o+11]=vs/VIS_SET.length;
}
const vx=gradient(wx,hz);
const vy=gradient(wy,hz);
const shu=unwrap(sh);
const hpu=unwrap(hp);
for(let k=0;k<K;k++){
const o=k*F;
data[o+2]=vx[k];
data[o+3]=vy[k];
data[o+4]=Math.sqrt(vx[k]*vx[k]+vy[k]*vy[k]);
data[o+7]=shu[k];
data[o+8]=hpu[k];
}
return{version:FEATURE_VERSION,names:FEATURE_NAMES,hz,K,F,t_s:r.t,data,torso_px:L,px,W,H};
}


function jointAngle(au,av,bu,bv,cu,cv){
const ax=au-bu;
const ay=av-bv;
const cx=cu-bu;
const cy=cv-bv;
return Math.atan2(Math.abs(ax*cy-ay*cx),ax*cx+ay*cy);
}


export function featureColumn(feat,name){
const j=feat.names.indexOf(name);
if(j<0)throw new RangeError(`unknown feature '${name}'`);
const out=new Float64Array(feat.K);
for(let k=0;k<feat.K;k++)out[k]=feat.data[k*feat.F+j];
return out;
}
