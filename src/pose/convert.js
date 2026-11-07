











export const N_LANDMARKS=33;
export const IMG_STRIDE=N_LANDMARKS*4;
export const WORLD_STRIDE=N_LANDMARKS*3;

export function poseRow(lms,wlms,crop){
const img=new Float32Array(IMG_STRIDE);
const world=new Float32Array(WORLD_STRIDE);
const found=Array.isArray(lms)&&lms.length>=N_LANDMARKS;
let ox=0,oy=0,sx=1,sy=1,sz=1;
if(crop&&crop.roi&&crop.W>0&&crop.H>0){
ox=crop.roi.x/crop.W;
oy=crop.roi.y/crop.H;
sx=crop.roi.w/crop.W;
sy=crop.roi.h/crop.H;
sz=sx;
}
for(let j=0;j<N_LANDMARKS;j++){
const q=4*j;
if(found&&lms[j]){
const l=lms[j];
img[q]=ox+l.x*sx;
img[q+1]=oy+l.y*sy;
img[q+2]=Number.isFinite(l.z)?l.z*sz:0;
img[q+3]=Number.isFinite(l.visibility)?l.visibility:Number.isFinite(l.presence)?l.presence:1;
}else{
img[q]=NaN;img[q+1]=NaN;img[q+2]=NaN;img[q+3]=0;
}
const w=Array.isArray(wlms)&&wlms.length>=N_LANDMARKS?wlms[j]:null;
world[3*j]=w?w.x:NaN;
world[3*j+1]=w?w.y:NaN;
world[3*j+2]=w?w.z:NaN;
}
return{img,world,found};
}

export function imgToPixels(img,W,H,offset=0){
const out=new Float64Array(2*N_LANDMARKS);
for(let j=0;j<N_LANDMARKS;j++){
out[2*j]=img[offset+4*j]*W;
out[2*j+1]=img[offset+4*j+1]*H;
}
return out;
}

export function createPoseSeqBuilder({W,H,model}){
const ts=[];
const imgs=[];
const worlds=[];
return{
push(t_s,row){
if(ts.length&&!(t_s>ts[ts.length-1]))return false;
ts.push(t_s);
imgs.push(row.img);
worlds.push(row.world);
return true;
},
size:()=>ts.length,
build(){
const T=ts.length;
const img=new Float32Array(T*IMG_STRIDE);
const world=new Float32Array(T*WORLD_STRIDE);
for(let i=0;i<T;i++){img.set(imgs[i],i*IMG_STRIDE);world.set(worlds[i],i*WORLD_STRIDE);}
return{t_s:Float64Array.from(ts),img,world,W,H,model};
},
};
}
