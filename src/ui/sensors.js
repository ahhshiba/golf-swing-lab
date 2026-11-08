



export function startMotion(app,onAcc,onError=()=>{}){
const g=app.deps?.gravity;
const permP=(()=>{
try{
if(g?.requestMotionPermission)return g.requestMotionPermission();
const D=globalThis.DeviceMotionEvent;
if(D&&typeof D.requestPermission==='function')return D.requestPermission();
return Promise.resolve(D?'granted':'unavailable');
}catch(e){
return Promise.reject(e);
}
})();
let stopped=false;
let stopFn=null;
Promise.resolve(permP).then((state)=>{
if(stopped)return;
if(state&&state!=='granted'&&state!==true&&!state.granted){onError(String(state.state??state));return;}
if(g?.startGravity){
stopFn=g.startGravity((s)=>{
const a=Array.isArray(s?.acc)?s.acc:s?.acc?[s.acc.x,s.acc.y,s.acc.z]:Array.isArray(s)?s:[s?.x,s?.y,s?.z];
const t=Number.isFinite(s?.t_s)?s.t_s:performance.now()/1000;
if(a.every(Number.isFinite))onAcc(a,t);
});
return;
}
const handler=(ev)=>{
const a=ev.accelerationIncludingGravity;
if(a&&Number.isFinite(a.x))onAcc([a.x,a.y,a.z],ev.timeStamp/1000);
};
window.addEventListener('devicemotion',handler);
stopFn=()=>window.removeEventListener('devicemotion',handler);
}).catch((e)=>onError(e?.message??String(e)));
return()=>{stopped=true;stopFn?.();stopFn=null;};
}
