

























import{poseRow}from'./convert.js';
import{diagRecord}from'../workers/diag.js';

export const MODELS=Object.freeze(['lite','full','heavy']);

export function assetUrls({model='full',base=import.meta.url}={}){
if(!MODELS.includes(model))throw new RangeError(`unknown pose model '${model}'`);
return{
bundle:new URL('../../vendor/mediapipe/vision_bundle.mjs',base).href,
wasm:new URL('../../vendor/mediapipe/wasm',base).href,
model:new URL(`../../models/pose_landmarker_${model}.task`,base).href,
};
}

export function createMonotonicClock(){
let last=-Infinity;
let offset=0;
let fresh=true;
return{
next(t_s){
const raw=Math.round(t_s*1000);
if(fresh){offset=(last===-Infinity?0:last+1000)-raw;fresh=false;}
let ms=raw+offset;
if(ms<=last)ms=last+1;
last=ms;
return ms;
},
newSequence(){fresh=true;},
last:()=>last,
};
}

let blockedCount=0;
function noteBlocked(api){
blockedCount+=1;
diagRecord('pose.blocked_requests',blockedCount);
diagRecord('pose.blocked_last',api);
}

function originOf(env){
return env&&env.location&&env.location.origin&&env.location.origin!=='null'?env.location.origin:null;
}


export function isForeign(input,env=globalThis){
const origin=originOf(env);
if(!origin)return false;
let u=null;
try{u=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,env.location?env.location.href:undefined);}catch{u=null;}
if(!u)return false;
if(/^wss?:$/.test(u.protocol))return u.host!==new URL(origin).host;
return/^https?:$/.test(u.protocol)&&u.origin!==origin;
}

export function blockForeignFetch(env=globalThis){
const orig=env&&env.fetch;
if(typeof orig!=='function'||orig.__gslLocalOnly)return false;
const guarded=function fetch(input,init){
if(isForeign(input,env)){
noteBlocked('fetch');
return Promise.reject(new TypeError('blocked: the app is offline-only (no requests leave this origin)'));
}
return orig.call(this??env,input,init);
};
guarded.__gslLocalOnly=true;
env.fetch=guarded;
return true;
}

export function blockForeignRequests(env=globalThis){
const out={fetch:blockForeignFetch(env),xhr:false,beacon:false,websocket:false};
try{
const X=env.XMLHttpRequest;
const open=X&&X.prototype&&X.prototype.open;
if(typeof open==='function'&&!open.__gslLocalOnly){
const guarded=function openGuard(method,url,...rest){
if(isForeign(url,env)){noteBlocked('xhr');throw new TypeError('blocked: the app is offline-only');}
return open.call(this,method,url,...rest);
};
guarded.__gslLocalOnly=true;
X.prototype.open=guarded;
out.xhr=true;
}
}catch{ }
try{
const nav=env.navigator;
const beacon=nav&&nav.sendBeacon;
if(typeof beacon==='function'&&!beacon.__gslLocalOnly){
const guarded=function sendBeacon(url,data){
if(isForeign(url,env)){noteBlocked('beacon');return false;}
return beacon.call(nav,url,data);
};
guarded.__gslLocalOnly=true;
Object.defineProperty(nav,'sendBeacon',{value:guarded,configurable:true,writable:true});
out.beacon=true;
}
}catch{ }
try{
const WS=env.WebSocket;
if(typeof WS==='function'&&!WS.__gslLocalOnly){
const Guarded=function WebSocket(url,protocols){
if(isForeign(url,env)){noteBlocked('websocket');throw new TypeError('blocked: the app is offline-only');}
return protocols===undefined?new WS(url):new WS(url,protocols);
};
Guarded.prototype=WS.prototype;
Guarded.__gslLocalOnly=true;
for(const k of['CONNECTING','OPEN','CLOSING','CLOSED'])Guarded[k]=WS[k];
env.WebSocket=Guarded;
out.websocket=true;
}
}catch{ }
return out;
}

const SOFTWARE_GL=/SwiftShader|llvmpipe|softpipe|Software Rasterizer|Basic Render|Mesa OffScreen/i;

export function softwareRenderer(env=globalThis){
try{
const canvas=typeof env.OffscreenCanvas==='function'?new env.OffscreenCanvas(1,1)
:(env.document?env.document.createElement('canvas'):null);
if(!canvas)return null;
const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
if(!gl)return null;
const ext=gl.getExtension('WEBGL_debug_renderer_info');
const name=String(ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)||'');
try{gl.getExtension('WEBGL_lose_context')?.loseContext();}catch{ }
return SOFTWARE_GL.test(name)?name:null;
}catch{
return null;
}
}

function inModuleWorker(){
return typeof globalThis.WorkerGlobalScope!=='undefined'&&typeof globalThis.document==='undefined';
}

function median(a){
if(!a.length)return null;
const s=a.slice().sort((x,y)=>x-y);
const m=s.length>>1;
return s.length%2?s[m]:(s[m-1]+s[m])/2;
}

export async function createPoseLandmarker(opts={}){
const model=opts.model??'full';
const urls=assetUrls({model});
if(!opts.vision)blockForeignRequests(globalThis);
const vision=opts.vision??(await import(urls.bundle));
const moduleWorker=opts.moduleWorker??inModuleWorker();
const fileset=await vision.FilesetResolver.forVisionTasks(urls.wasm,moduleWorker);
const conf=opts.minConf??0.5;



const restoreFactory=async()=>{
if(globalThis.ModuleFactory||!fileset||!fileset.wasmLoaderPath)return;
try{
const m=await import(fileset.wasmLoaderPath);
if(typeof m.default==='function')globalThis.ModuleFactory=m.default;
}catch{ }
};
const make=async(delegate)=>{await restoreFactory();return vision.PoseLandmarker.createFromOptions(fileset,{
baseOptions:{modelAssetPath:urls.model,delegate},
runningMode:'VIDEO',
numPoses:1,
minPoseDetectionConfidence:conf,
minPosePresenceConfidence:conf,
minTrackingConfidence:conf,
outputSegmentationMasks:false,
});};
let delegate=opts.delegate??'GPU';
if(delegate==='GPU'&&!opts.vision){
const sw=softwareRenderer(globalThis);
if(sw){delegate='CPU';diagRecord('pose.gpu_software',sw);}
}
let lm;
try{
lm=await make(delegate);
}catch(e){
if(delegate!=='GPU')throw e;
diagRecord('pose.gpu_error',String(e&&e.message?e.message:e));
delegate='CPU';
lm=await make('CPU');
}
diagRecord('pose.delegate',delegate);
const clock=createMonotonicClock();
const times=[];
const now=()=>(globalThis.performance?globalThis.performance.now():Date.now());
return{
model,
delegate,
detect(image,t_s,crop){
const t0=now();
const r=lm.detectForVideo(image,clock.next(t_s));
const row=poseRow(r&&r.landmarks?r.landmarks[0]:null,r&&r.worldLandmarks?r.worldLandmarks[0]:null,crop);
const ms=now()-t0;
times.push(ms);
if(times.length>200)times.shift();
if(times.length%20===0)diagRecord(`pose.${model}_ms_p50`,median(times));
return{...row,ms};
},
newSequence(){clock.newSequence();},
ms_p50:()=>median(times),
close(){try{lm.close();}catch{ }},
};
}
