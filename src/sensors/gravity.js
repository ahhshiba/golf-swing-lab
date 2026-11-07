










import{createGravityTracker,orientationName}from'../calib/gravity.js';
import{RC}from'../contract/reason-codes.js';
import{diagRecord}from'../workers/diag.js';

const state={permission:null,available:null,same_click:null,samples:0};

export function getMotionState(){
return{...state};
}

export function motionReasonCodes(){
return state.samples>0?[]:[RC.NO_GRAVITY_REF];
}

function setPermission(p){
state.permission=p;
diagRecord('motion.permission',p);
return p;
}

export function requestMotionPermission(opts={}){
const env=opts.env??globalThis;
const DME=env.DeviceMotionEvent;
let p=null;
let threw=false;
if(DME&&typeof DME.requestPermission==='function'){
try{
p=DME.requestPermission();
}catch{
threw=true;
}
}

state.same_click=!opts.retry;
diagRecord('motion.same_click',state.same_click);
if(!DME)return Promise.resolve(setPermission('unsupported'));
if(typeof DME.requestPermission!=='function')return Promise.resolve(setPermission('not_required'));
if(threw)return Promise.resolve(setPermission('denied'));
return Promise.resolve(p).then(
(r)=>setPermission(r==='granted'?'granted':'denied'),
()=>setPermission('denied'),
);
}

function screenOrientation(env){
try{
const a=env.screen&&env.screen.orientation?env.screen.orientation.angle:env.orientation;
return orientationName(Number.isFinite(a)?a:0);
}catch{
return'portrait';
}
}

export function startGravity(onSample,opts={}){
const env=opts.env??globalThis;
const fixed=opts.orientation??null;
let orientation=fixed??screenOrientation(env);
const mk=()=>createGravityTracker({orientation,sign:opts.sign??1,tau_s:opts.tau_s,span_s:opts.span_s,tol_deg:opts.tol_deg});
let tracker=mk();
let gotAny=false;
const handler=(ev)=>{
const a=ev&&ev.accelerationIncludingGravity;
if(!a||!Number.isFinite(a.x)||!Number.isFinite(a.y)||!Number.isFinite(a.z))return;
if(!fixed){
const o=screenOrientation(env);
if(o!==orientation){orientation=o;tracker=mk();}
}
const t_s=(Number.isFinite(ev.timeStamp)?ev.timeStamp:0)/1000;
const acc=[a.x,a.y,a.z];
const g=tracker.push(acc,t_s);
if(!gotAny){gotAny=true;state.available=true;diagRecord('motion.available',true);}
state.samples+=1;
if(g)onSample({...g,acc,t_s,orientation});
};
if(typeof env.addEventListener!=='function'){
state.available=false;
diagRecord('motion.available',false);
return()=>{};
}
env.addEventListener('devicemotion',handler);
return()=>env.removeEventListener('devicemotion',handler);
}


export function _resetMotionForTests(){
state.permission=null;state.available=null;state.same_click=null;state.samples=0;
}
