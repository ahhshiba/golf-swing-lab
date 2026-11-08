












export function rgbaToGray(rgba,out){
const n=rgba.length>>2;
const g=out&&out.length>=n?out:new Uint8Array(n);
for(let i=0,j=0;i<n;i++,j+=4){
g[i]=(77*rgba[j]+150*rgba[j+1]+29*rgba[j+2]+128)>>8;
}
return g;
}

export function roiInDisplay(roi,Wd,Hd,maxWidth=Infinity){
let x=0,y=0,w=Wd,h=Hd;
if(roi&&roi.w>0&&roi.h>0){
x=Math.max(0,Math.min(Wd-1,Math.floor(roi.x)));
y=Math.max(0,Math.min(Hd-1,Math.floor(roi.y)));
w=Math.max(1,Math.min(Wd-x,Math.ceil(roi.w)));
h=Math.max(1,Math.min(Hd-y,Math.ceil(roi.h)));
}
const scale=Math.min(1,maxWidth/w);
return{x,y,w,h,scale,dw:Math.max(1,Math.round(w*scale)),dh:Math.max(1,Math.round(h*scale))};
}

function frameDims(frame){
const W=frame.displayWidth??frame.codedWidth??frame.width;
const H=frame.displayHeight??frame.codedHeight??frame.height;
return{W,H};
}

export function createFrameConverter(opts={}){
const env=opts.env??globalThis;
let canvas=null;
let ctx=null;
function surface(w,h){
if(!canvas){
canvas=typeof env.OffscreenCanvas==='function'?new env.OffscreenCanvas(w,h):env.document.createElement('canvas');
ctx=canvas.getContext('2d',{willReadFrequently:true});
}
if(canvas.width!==w)canvas.width=w;
if(canvas.height!==h)canvas.height=h;
return ctx;
}
function draw(frame,rotation0,roi,maxWidth){

const rotation=frame&&'codedWidth'in frame?rotation0:0;
const{W:Wc,H:Hc}=frameDims(frame);
const rot90=rotation===90||rotation===270;
const Wd=rot90?Hc:Wc;
const Hd=rot90?Wc:Hc;
const r=roiInDisplay(roi,Wd,Hd,maxWidth);
const c=surface(r.dw,r.dh);
c.setTransform(1,0,0,1,0,0);
if(!rotation){
c.drawImage(frame,r.x,r.y,r.w,r.h,0,0,r.dw,r.dh);
}else{

c.scale(r.scale,r.scale);
c.translate(-r.x,-r.y);
if(rotation===90){c.translate(Hc,0);c.rotate(Math.PI/2);}
else if(rotation===180){c.translate(Wc,Hc);c.rotate(Math.PI);}
else if(rotation===270){c.translate(0,Wc);c.rotate(-Math.PI/2);}
c.drawImage(frame,0,0,Wc,Hc);
c.setTransform(1,0,0,1,0,0);
}
return{r,Wd,Hd};
}
return{
async toBitmap(frame,{rotation=0,roi=null,maxWidth=384}={}){
const{r,Wd,Hd}=draw(frame,rotation,roi,maxWidth);
const bitmap=typeof canvas.transferToImageBitmap==='function'
?canvas.transferToImageBitmap()
:await env.createImageBitmap(canvas);
return{bitmap,roi:{x:r.x,y:r.y,w:r.w,h:r.h},W:Wd,H:Hd,scale:r.scale};
},
toGray(frame,{rotation=0,roi=null,maxWidth=Infinity}={}){
const{r}=draw(frame,rotation,roi,maxWidth);
const img=ctx.getImageData(0,0,r.dw,r.dh);
return{data:rgbaToGray(img.data),W:r.dw,H:r.dh,origin:{u:r.x,v:r.y},scale:r.scale,
roi:{x:r.x,y:r.y,w:r.w,h:r.h}};
},
};
}
