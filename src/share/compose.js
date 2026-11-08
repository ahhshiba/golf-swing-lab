


























import{decodeFile}from'../import/decode.js';
import{probeFile}from'../import/probe.js';
import{createFrameConverter}from'../import/gray.js';
import{pickMimeType}from'../capture/recorder.js';
import{projectFlight}from'../viz/tracer.js';
import{t}from'../i18n/index.js';
import{DEFAULT_UNITS}from'../i18n/units.js';
import{metricName}from'../ui/glossary.js';
import{buildTimeline,neededSourceTimes}from'./timeline.js';
import{normalizeShare}from'./settings.js';
import{CARD_METRICS,pmText,validityWord}from'./card.js';

export const SIZES=Object.freeze({portrait:Object.freeze([720,1280]),landscape:Object.freeze([1280,720])});
export const BITRATE=4000000;
export const RETRY_BITRATE=2000000;
export const MAX_BYTES=15000000;

export class ComposeError extends Error{
constructor(code,message){super(message??code);this.name='ComposeError';this.code=code;}
}

const fin=(x)=>typeof x==='number'&&Number.isFinite(x);

export const clipMime=(isTypeSupported)=>pickMimeType(isTypeSupported);

export function mimeBase(mime){
const b=String(mime??'').split(';')[0].trim().toLowerCase();
return b||'video/webm';
}

export function clipExtension(mime){
return mimeBase(mime)==='video/mp4'?'mp4':'webm';
}

export function videoSupport(env=globalThis){
if(typeof env.MediaRecorder!=='function')return{ok:false,reason:'no_recorder'};
const C=env.HTMLCanvasElement;
if(!C||typeof C.prototype?.captureStream!=='function')return{ok:false,reason:'no_capture_stream'};
return{ok:true,reason:null};
}

export function layoutRect(srcW,srcH,outW,outH){
const s=Math.min(outW/srcW,outH/srcH);
const w=Math.round(srcW*s);
const h=Math.round(srcH*s);
return{x:Math.round((outW-w)/2),y:Math.round((outH-h)/2),w,h};
}

const LEAD_WRIST={right:15,left:16};
const HEAD=[0,1,2,3,4,5,6,7,8,9,10];

function nearestIdx(arr,x){
let lo=0;
let hi=arr.length-1;
if(hi<0)return-1;
while(hi-lo>1){const m=(lo+hi)>>1;if(arr[m]<=x)lo=m;else hi=m;}
return Math.abs(arr[hi]-x)<Math.abs(arr[lo]-x)?hi:lo;
}

function cssOf(doc,name){
try{return getComputedStyle(doc.documentElement).getPropertyValue(name).trim();}catch(_){return'';}
}

async function videoDuration(blob,doc,hint_s){
const v=doc.createElement('video');
v.muted=true;
v.preload='metadata';
const url=URL.createObjectURL(blob);
const wait=(ok,ms=5000)=>new Promise((res,rej)=>{
const to=setTimeout(()=>rej(new Error('timeout')),ms);
v.addEventListener(ok,()=>{clearTimeout(to);res();},{once:true});
v.addEventListener('error',()=>{clearTimeout(to);rej(new Error('error'));},{once:true});
});
try{
v.src=url;
await wait('loadedmetadata');
if(!fin(v.duration)&&fin(hint_s)&&hint_s>0){



const p=wait('durationchange',3000).catch(()=>{});
v.currentTime=hint_s;
await p;
for(let i=0;i<20&&!fin(v.duration);i++)await new Promise((r)=>setTimeout(r,50));
}
return fin(v.duration)&&v.duration>0?v.duration:null;
}catch(_){
return null;
}finally{
v.removeAttribute('src');
v.load?.();
URL.revokeObjectURL(url);
}
}


export function nominalProbe(duration_s,fps){
const f=fps>0?fps:30;
const n=Math.max(1,Math.floor(duration_s*f)+1);
return{cts_s:Array.from({length:n},(_,i)=>i/f),timestamps:'nominal',reason_codes:[],rotation:0,display_width:null,display_height:null};
}



async function decodeNeeded(clipBlob,times,{probe,fps,maxWidth,rotation,signal,onProgress}){
const conv=createFrameConverter();
const cts=probe.cts_s;
const idxOf=times.map((x)=>nearestIdx(cts,x));
const wanted=[...new Set(idxOf)];
const byIdx=new Map();
try{
await decodeFile(clipBlob,{
indices:wanted,probe,nominal_fps:fps,signal,
onFrame:async(frame,t,index)=>{
if(byIdx.has(index)||!wanted.includes(index))return;
const{bitmap}=await conv.toBitmap(frame,{rotation,maxWidth});
byIdx.set(index,bitmap);
onProgress?.(byIdx.size/wanted.length);
},
});
}catch(e){
for(const b of byIdx.values())b.close?.();
if(e?.code==='CANCELLED')throw new ComposeError('CANCELLED');
throw new ComposeError('CLIP_UNREADABLE',String(e?.message??e));
}

const have=[...byIdx.keys()].sort((x,y)=>x-y);
if(!have.length)throw new ComposeError('CLIP_UNREADABLE','no frame decoded');
const out=new Map();
times.forEach((x,j)=>{
const i=idxOf[j];
const k=byIdx.has(i)?i:have.reduce((a,b)=>(Math.abs(b-i)<Math.abs(a-i)?b:a),have[0]);
out.set(x,byIdx.get(k));
});
return{frames:out,bitmaps:[...byIdx.values()]};
}



function strokeHalo(ctx,pts,{colour,halo,width,dash}){
if(pts.length<2)return;
const path=()=>{
ctx.beginPath();
let pen=false;
for(const p of pts){
if(!p){pen=false;continue;}
if(pen)ctx.lineTo(p[0],p[1]);else ctx.moveTo(p[0],p[1]);
pen=true;
}
};
ctx.lineCap='round';
ctx.lineJoin='round';
ctx.setLineDash(dash);
path();
ctx.lineWidth=width+4;
ctx.strokeStyle=halo;
ctx.stroke();
path();
ctx.lineWidth=width;
ctx.strokeStyle=colour;
ctx.stroke();
ctx.setLineDash([]);
}

function dots(ctx,pts,{colour,halo,r}){
for(const p of pts){
if(!p)continue;
ctx.beginPath();
ctx.arc(p[0],p[1],r,0,Math.PI*2);
ctx.lineWidth=3;
ctx.strokeStyle=halo;
ctx.stroke();
ctx.fillStyle=colour;
ctx.fill();
}
}

function label(ctx,s,x,y,{colour,halo,size,font,align='left',weight=700}){
ctx.font=`${weight} ${size}px ${font}`;
ctx.textAlign=align;
ctx.textBaseline='alphabetic';
ctx.lineJoin='round';
ctx.lineWidth=Math.max(3,size/6);
ctx.strokeStyle=halo;
ctx.strokeText(s,x,y);
ctx.fillStyle=colour;
ctx.fillText(s,x,y);
}

function mosaic(ctx,scratch,box){
const bw=Math.max(1,Math.round(box.w/12));
const bh=Math.max(1,Math.round(box.h/12));
scratch.width=bw;
scratch.height=bh;
const s=scratch.getContext('2d');
s.imageSmoothingEnabled=true;
s.drawImage(ctx.canvas,box.x,box.y,box.w,box.h,0,0,bw,bh);
const prev=ctx.imageSmoothingEnabled;
ctx.imageSmoothingEnabled=false;
ctx.drawImage(scratch,0,0,bw,bh,box.x,box.y,box.w,box.h);
ctx.imageSmoothingEnabled=prev;
}



function buildScene({shot,poseSeq,rect,srcW,srcH,fps,tl,o,units}){
const kx=rect.w/srcW;
const ky=rect.h/srcH;
const toCanvas=(u,v)=>[rect.x+u*kx,rect.y+v*ky];
const ev=shot.events??{};
const impT=ev.impact?.t_s;
const impF=ev.impact?.frame;
const tr=shot.tracks??null;

const ballDet=(tr?.ball_px??[]).filter((p)=>p.slice(0,3).every(fin))
.map((p)=>({t:(p[0]-(tr.impact_frame??p[0]))/fps,pt:toCanvas(p[1],p[2])}));
const samples=shot.flight?.samples??[];
const cam=shot.calibration?.camera??null;
const proj=cam&&samples.length?projectFlight(cam,samples):[];
const ballSim=proj.map((p,i)=>({t:samples[i][0],pt:p?toCanvas(p[0],p[1]):null}));

let club=[];
let clubKind=null;
if(Array.isArray(tr?.club_px)&&tr.club_px.length>=2&&fin(impT)&&fin(impF)){
club=tr.club_px.filter((p)=>p.every(fin)).map((p)=>({t:impT+(p[0]-impF)/fps,pt:toCanvas(p[1],p[2])}));
clubKind='club';
}else if(poseSeq?.img&&poseSeq?.t_s?.length){
const j=LEAD_WRIST[shot.handedness==='left'?'left':'right'];
for(let i=0;i<poseSeq.t_s.length;i++){
const tt=poseSeq.t_s[i];
if(tt<tl.swing.src_t0||tt>tl.swing.src_t1)continue;
const q=(i*33+j)*4;
if(!(poseSeq.img[q+3]>=0.5))continue;
club.push({t:tt,pt:[rect.x+poseSeq.img[q]*rect.w,rect.y+poseSeq.img[q+1]*rect.h]});
}
if(club.length>=2)clubKind='hand';else club=[];
}
const m=shot.metrics??{};
const cardIds=CARD_METRICS.filter((id)=>fin(m[id]?.value)).slice(0,6);
const cardRows=cardIds.map((id)=>({label:metricName(id),value:pmText(m[id],units,id),word:validityWord(m[id].validity)}));
return{ballDet,ballSim,club,clubKind,cardRows,flightT:tl.flight.T??tl.frames.find((f)=>f.seg==='card')?.flight_t??0};
}

function headBox(poseSeq,srcT,rect){
if(!poseSeq?.img||!poseSeq?.t_s?.length)return null;
const i=nearestIdx(poseSeq.t_s,srcT);
let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,n=0;
for(const j of HEAD){
const q=(i*33+j)*4;
if(!(poseSeq.img[q+3]>=0.3))continue;
const x=poseSeq.img[q],y=poseSeq.img[q+1];
x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);n++;
}
if(n<2)return null;
const w=Math.max(x1-x0,0.04)*rect.w;
const h=Math.max(y1-y0,0.04)*rect.h;
const s=Math.max(w,h)*1.9;
const cx=rect.x+((x0+x1)/2)*rect.w;
const cy=rect.y+((y0+y1)/2)*rect.h;
const x=Math.max(rect.x,Math.round(cx-s/2));
const y=Math.max(rect.y,Math.round(cy-s*0.55));
return{x,y,w:Math.max(1,Math.min(rect.x+rect.w-x,Math.round(s))),h:Math.max(1,Math.min(rect.y+rect.h-y,Math.round(s*1.1)))};
}






export function drawLinesInRect(ctx,draw,lines,{rect,W,H,frame,outline,enabled=null}){
ctx.save();
try{

ctx.beginPath();
ctx.rect(rect.x,rect.y,rect.w,rect.h);
ctx.clip();
ctx.translate(rect.x,rect.y);
ctx.scale(rect.w/W,rect.h/H);
return draw(ctx,lines,{frame,palette:{outline},enabled});
}finally{
ctx.restore();
}
}

function drawFrame(ctx,f,env){
const{W,H,rect,frames,scene,P,o,poseSeq,lines,scratch}=env;
ctx.fillStyle=P.media;
ctx.fillRect(0,0,W,H);
const bm=frames.get(f.src_t);
if(bm)ctx.drawImage(bm,rect.x,rect.y,rect.w,rect.h);
if(o.faceMask){const b=headBox(poseSeq,f.src_t,rect);if(b)mosaic(ctx,scratch,b);}
if(lines.ok){
try{
drawLinesInRect(ctx,lines.draw,lines.lines,{rect,W,H,frame:f.k,outline:P.halo,enabled:lines.enabled});
}catch(e){
lines.ok=false;
env.notes.push('lines_failed');
}
}
const lw=Math.max(3,Math.round(Math.min(W,H)/180));

if(scene.club.length){
const pts=scene.club.filter((c)=>f.seg!=='swing'||c.t<=f.src_t+1e-6).map((c)=>c.pt);
strokeHalo(ctx,pts,{colour:P.club,halo:P.halo,width:Math.max(2,lw-2),dash:[lw*2.5,lw*1.8]});
}

if(f.seg!=='swing'){
const tf=f.flight_t??0;
const sim=scene.ballSim.filter((b)=>b.t<=tf+1e-6).map((b)=>b.pt);
strokeHalo(ctx,sim,{colour:P.ball,halo:P.halo,width:lw,dash:[1,lw*2.6]});
const det=scene.ballDet.filter((b)=>b.t<=tf+1e-6).map((b)=>b.pt);
strokeHalo(ctx,det,{colour:P.ball,halo:P.halo,width:lw,dash:[]});
dots(ctx,det,{colour:P.ball,halo:P.halo,r:lw*0.9});
}

const size=Math.round(Math.min(W,H)/26);
let y=Math.round(size*2);
const x=Math.round(size*1.1);
const entry=(text,colour,dash,width)=>{
strokeHalo(ctx,[[x,y-size*0.35],[x+size*1.8,y-size*0.35]],{colour,halo:P.halo,width,dash});
label(ctx,text,x+size*2.3,y,{colour:P.ink,halo:P.halo,size,font:P.font});
y+=Math.round(size*1.5);
};
if(f.seg!=='swing'&&scene.ballDet.length)entry(t('share.legend.detected'),P.ball,[],lw);
if(f.seg!=='swing'&&scene.ballSim.some((b)=>b.pt))entry(t('share.legend.modelled'),P.ball,[1,lw*2.6],lw);
if(scene.clubKind)entry(t(scene.clubKind==='club'?'share.legend.club_path':'share.legend.hand_path'),P.club,[lw*2.5,lw*1.8],Math.max(2,lw-2));

if(f.seg==='card'&&scene.cardRows.length){
const a=Math.min(1,(f.card_frac??1)*4);
const rows=scene.cardRows;
const pad=Math.round(size*1.2);
const rowH=Math.round(size*2.6);
const cw=Math.round(Math.min(W-2*pad,size*22));
const ch=rows.length*rowH+pad*2;
const cx=Math.round((W-cw)/2);
const cy=Math.round((H-ch)/2);
ctx.globalAlpha=0.78*a;
ctx.fillStyle=P.media;
ctx.fillRect(cx,cy,cw,ch);
ctx.globalAlpha=a;
rows.forEach((r,i)=>{
const ry=cy+pad+i*rowH+size*1.1;
label(ctx,r.label,cx+pad,ry,{colour:P.ink,halo:P.halo,size:Math.round(size*0.85),font:P.font,weight:400});
label(ctx,r.value,cx+cw-pad,ry,{colour:P.ink,halo:P.halo,size:Math.round(size*1.15),font:P.font,align:'right'});
label(ctx,r.word,cx+cw-pad,ry+size*1.05,{colour:P.ball,halo:P.halo,size:Math.round(size*0.7),font:P.font,align:'right',weight:400});
});
ctx.globalAlpha=1;
}
if(o.appMark){
const s=Math.round(size*0.7);
label(ctx,t('app.name'),W-s,H-s,{colour:P.ink,halo:P.halo,size:s,font:P.font,align:'right',weight:600});
ctx.font=`600 ${s}px ${P.font}`;
const tw=ctx.measureText(t('app.name')).width;
ctx.beginPath();
ctx.arc(W-s-tw-s*0.9,H-s-s*0.35,s*0.4,0,Math.PI*2);
ctx.fillStyle=P.ball;
ctx.fill();
}
}

const sleep=(ms)=>new Promise((r)=>setTimeout(r,Math.max(0,ms)));

async function record({canvas,ctx,tl,env,mime,bitrate,signal,onProgress,doc}){
const MR=globalThis.MediaRecorder;
const stream=canvas.captureStream(tl.out_fps);
let rec;
try{
rec=new MR(stream,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:bitrate});
}catch(e){
stream.getTracks().forEach((x)=>x.stop());
throw new ComposeError('RECORDER_FAILED',String(e?.message??e));
}
const chunks=[];
let failure=null;
rec.ondataavailable=(e)=>{if(e.data&&e.data.size)chunks.push(e.data);};
rec.onerror=(e)=>{failure=e?.error??new Error('recorder error');};
const stopped=new Promise((r)=>{rec.onstop=r;});
drawFrame(ctx,tl.frames[0],env);
rec.start(500);
const track=stream.getVideoTracks()[0];
const t0=performance.now();
try{
for(const f of tl.frames){
if(signal?.aborted)throw new ComposeError('CANCELLED');
if(failure)throw new ComposeError('RECORDER_FAILED',String(failure?.message??failure));
drawFrame(ctx,f,env);
track?.requestFrame?.();
onProgress?.((f.k+1)/tl.frames.length);
await sleep(t0+((f.k+1)*1000)/tl.out_fps-performance.now());
}
}catch(e){
try{rec.stop();}catch(_){ }
stream.getTracks().forEach((x)=>x.stop());
throw e;
}
rec.stop();
await stopped;
stream.getTracks().forEach((x)=>x.stop());
if(failure)throw new ComposeError('RECORDER_FAILED',String(failure?.message??failure));
const type=mimeBase(rec.mimeType||mime);
return new Blob(chunks,{type});
}

export async function composeShotVideo({shot,clipBlob,poseSeq=null,opts={},onProgress,signal,units=DEFAULT_UNITS,env=globalThis}={}){
const sup=videoSupport(env);
if(!sup.ok)throw new ComposeError('VIDEO_UNSUPPORTED',sup.reason);
if(!clipBlob)throw new ComposeError('NO_CLIP');
const doc=env.document;
const o=normalizeShare(opts);
const notes=[];
const prog=(p)=>{try{onProgress?.(Math.max(0,Math.min(1,p)));}catch(_){ }};
prog(0);
let probe=null;
try{probe=await probeFile(clipBlob);}catch(_){probe=null;}
if(signal?.aborted)throw new ComposeError('CANCELLED');
const fps=shot.capture?.effective_fps||probe?.effective_fps||30;
if(!probe?.cts_s?.length){
const ev=shot.events??{};
const hint=fin(ev.impact?.t_s)?ev.impact.t_s+0.1:null;
let d=await videoDuration(clipBlob,doc,hint);
if(!fin(d)&&fin(hint)){d=hint;notes.push('duration_from_events');}
if(!fin(d))throw new ComposeError('CLIP_UNREADABLE','clip duration unknown');
probe=nominalProbe(d,shot.capture?.nominal_fps||fps);
}
const dur=probe.cts_s[probe.cts_s.length-1];
const samples=shot.flight?.samples??[];
const tl=buildTimeline({
fps,events:shot.events,clipDuration_s:dur,flightT_s:samples.length?samples[samples.length-1][0]:null,
ballTrack:Boolean(shot.tracks?.ball_px?.length),card:o.card,
});
const[W,H]=SIZES[o.layout];
const srcW=shot.calibration?.camera?.W||probe?.display_width||shot.capture?.width||1920;
const srcH=shot.calibration?.camera?.H||probe?.display_height||shot.capture?.height||1080;
const rect=layoutRect(srcW,srcH,W,H);
const{frames,bitmaps}=await decodeNeeded(clipBlob,neededSourceTimes(tl),{
probe,fps:shot.capture?.nominal_fps||fps,maxWidth:rect.w,rotation:probe.rotation??0,signal,onProgress:(p)=>prog(0.3*p),
});
const canvas=doc.createElement('canvas');
canvas.width=W;
canvas.height=H;
canvas.className='share-render';

Object.assign(canvas.style,{position:'fixed',left:'0',top:'0',width:'2px',height:'2px',opacity:'0',pointerEvents:'none'});
canvas.setAttribute('aria-hidden','true');
doc.body.append(canvas);
const ctx=canvas.getContext('2d');
const P={
media:cssOf(doc,'--media-bg')||'black',halo:cssOf(doc,'--media-bg')||'black',
ball:cssOf(doc,`--${o.ballColour}`)||'yellow',club:cssOf(doc,`--${o.clubColour}`)||'cyan',
ink:cssOf(doc,'--trail-6')||'white',font:cssOf(doc,'--font')||'system-ui, sans-serif',
};
const lines={ok:false};
if(o.lines){
try{
const[L,O]=await Promise.all([import('../lab/lines.js'),import('../lab/overlay.js')]);
const computed=L.computeLines({view:shot.capture?.view,poseSeq,events:shot.events,calibration:shot.calibration,handedness:shot.handedness});
Object.assign(lines,{ok:true,lines:computed,draw:O.drawLines,enabled:null});
}catch(e){
notes.push('lines_failed');
}
}
const scene=buildScene({shot,poseSeq,rect,srcW,srcH,fps,tl,o,units});
if(!scene.clubKind)notes.push('no_club_trail');
const env2={W,H,rect,frames,scene,P,o,poseSeq,lines,scratch:doc.createElement('canvas'),notes};
const isTS=typeof env.MediaRecorder.isTypeSupported==='function'?(m)=>env.MediaRecorder.isTypeSupported(m):null;
const mime=clipMime(isTS);
try{
let bitrate=BITRATE;
let blob=await record({canvas,ctx,tl,env:env2,mime,bitrate,signal,onProgress:(p)=>prog(0.3+0.7*p),doc});
if(blob.size>MAX_BYTES){
bitrate=RETRY_BITRATE;
notes.push('retried_2mbps');
prog(0.3);
blob=await record({canvas,ctx,tl,env:env2,mime,bitrate,signal,onProgress:(p)=>prog(0.3+0.7*p),doc});
if(blob.size>MAX_BYTES)throw new ComposeError('TOO_LARGE',`${blob.size} bytes`);
}
prog(1);
return{
blob,mime:blob.type,duration_s:tl.duration_s,bytes:blob.size,width:W,height:H,bitrate,notes,
timeline:{swing_s:tl.swing.n/tl.out_fps,flight_s:tl.flight.n/tl.out_fps,card_s:tl.card.n/tl.out_fps},
};
}finally{
canvas.remove();
for(const b of bitmaps){try{b.close();}catch(_){ }}
}
}
