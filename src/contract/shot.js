










import{RC,REASON_CODES}from'./reason-codes.js';
import{
SCHEMA_ID,METRIC_IDS,METRIC_UNITS,METRIC_DEFAULT_ORIGIN,SETUP_LEVEL_CODES,SHOT_REQUIRED_KEYS,
SHOT_OPTIONAL_KEYS,isAffectedBySetup,LM_ALGORITHM_NONE,
}from'./enums.js';
import{metricNull,downgrade}from'./metric.js';
import{ContractError,validateShot,formatErrors}from'./validate.js';

const isPlain=(x)=>{
if(x===null||typeof x!=='object'||Array.isArray(x))return false;
const proto=Object.getPrototypeOf(x);
return proto===Object.prototype||proto===null;
};


function clone(x){
if(Array.isArray(x))return x.map(clone);
if(ArrayBuffer.isView(x))throw new ContractError('shot data must be JSON-like, got a typed array (convert with Array.from)');
if(isPlain(x)){
const out={};
for(const k of Object.keys(x))if(x[k]!==undefined)out[k]=clone(x[k]);
return out;
}
if(typeof x==='function'||typeof x==='symbol'||typeof x==='bigint'||(x!==null&&typeof x==='object')){
throw new ContractError(`shot data must be JSON-like, got ${typeof x==='object'?'a non-plain object':typeof x}`);
}
return x;
}


function mergeDeep(target,src){
if(isPlain(target)&&isPlain(src)){
const out={...target};
for(const k of Object.keys(src)){
if(src[k]===undefined)continue;
out[k]=k in target?mergeDeep(target[k],src[k]):clone(src[k]);
}
return out;
}
return clone(src);
}


export function emptyMetrics(){
const out={};
for(const id of METRIC_IDS){
out[id]=metricNull('not_computed',[RC.NOT_IMPLEMENTED],METRIC_UNITS[id],METRIC_DEFAULT_ORIGIN[id]);
}
return out;
}

function defaultQuality(){
return{pose_mean_vis:null,frames_analyzed:0,frames_dropped:0,audio_onset:null,touches:0,warnings:[]};
}









export function newShot(init={}){
if(!isPlain(init))throw new ContractError('newShot: expected an options object');
const allowed=[...SHOT_REQUIRED_KEYS,...SHOT_OPTIONAL_KEYS];
for(const k of Object.keys(init)){
if(!allowed.includes(k))throw new ContractError(`newShot: unknown field '${k}'`);
}
const metrics=emptyMetrics();
if(init.metrics!==undefined){
if(!isPlain(init.metrics))throw new ContractError('newShot: metrics must be an object keyed by metric id');
for(const id of Object.keys(init.metrics)){
if(!METRIC_IDS.includes(id))throw new ContractError(`newShot: unknown metric id '${id}'`);
metrics[id]=clone(init.metrics[id]);
}
}
const base={
schema:SCHEMA_ID,
shot_id:init.shot_id,
session_id:init.session_id,
venue_id:init.venue_id===undefined?null:init.venue_id,
preset_id:init.preset_id===undefined?null:init.preset_id,
created_at:init.created_at,
app_version:init.app_version,
algorithms:isPlain(init.algorithms)&&!('lm'in init.algorithms)?{...init.algorithms,lm:{...LM_ALGORITHM_NONE}}:init.algorithms,
capture:init.capture,
calibration:init.calibration,
club:init.club,
handedness:init.handedness,
events:init.events,
metrics,
quality:{...defaultQuality(),...(isPlain(init.quality)?clone(init.quality):{})},
starred:init.starred===undefined?false:init.starred,
note:init.note===undefined?'':init.note,
revision:init.revision===undefined?0:init.revision,
flight:init.flight===undefined?null:init.flight,
tracks:init.tracks===undefined?null:init.tracks,
practice:init.practice===undefined?null:init.practice,
};
if(init.history!==undefined)base.history=init.history;
if(init.quality!==undefined&&!isPlain(init.quality))base.quality=init.quality;

return clone(base);
}






export function attributeWarnings(shot){
const warnings=shot?.quality?.warnings;
if(!Array.isArray(warnings)||!isPlain(shot.metrics))throw new ContractError('attributeWarnings: shot has no quality.warnings or metrics');
const out=clone(shot);
for(const code of SETUP_LEVEL_CODES){
if(!warnings.includes(code))continue;
for(const id of METRIC_IDS){
const m=out.metrics[id];
if(!isPlain(m)||!Array.isArray(m.reason_codes)||m.value===null)continue;
if(isAffectedBySetup(id,m))out.metrics[id]=downgrade(m,code);
}
}
return out;
}


export function addWarning(shot,code){
if(typeof code!=='string'||!Object.prototype.hasOwnProperty.call(REASON_CODES,code)){
throw new ContractError(`addWarning: unknown reason code ${String(code)}`);
}
const out=clone(shot);
if(!isPlain(out.quality)||!Array.isArray(out.quality.warnings))throw new ContractError('addWarning: shot has no quality.warnings');
if(!out.quality.warnings.includes(code))out.quality.warnings.push(code);
return SETUP_LEVEL_CODES.includes(code)?attributeWarnings(out):out;
}

const FROZEN_KEYS=['schema','shot_id','session_id','created_at','revision','history'];









export function bumpRevision(shot,patch,opts={}){
if(!isPlain(shot)||!Number.isInteger(shot.revision)||shot.revision<0){
throw new ContractError('bumpRevision: shot must be an object with an integer revision');
}
if(!isPlain(patch))throw new ContractError('bumpRevision: patch must be an object');
const allowed=[...SHOT_REQUIRED_KEYS,...SHOT_OPTIONAL_KEYS];
const keys=Object.keys(patch).filter((k)=>patch[k]!==undefined);
for(const k of keys){
if(!allowed.includes(k))throw new ContractError(`bumpRevision: unknown field '${k}'`);
if(FROZEN_KEYS.includes(k))throw new ContractError(`bumpRevision: '${k}' cannot be patched`);
}
const next=clone(shot);
const before={};
for(const k of keys){
before[k]=k in shot?clone(shot[k]):null;
next[k]=k in next?mergeDeep(next[k],patch[k]):clone(patch[k]);
}
next.revision=shot.revision+1;
next.history=[...(Array.isArray(shot.history)?clone(shot.history):[]),{revision:shot.revision,at:opts.at??null,before}];

const known=new Set(validateShot(shot).errors.map((e)=>`${e.path}\u0000${e.msg}`));
const introduced=validateShot(next).errors.filter((e)=>!known.has(`${e.path}\u0000${e.msg}`));
if(introduced.length)throw new ContractError(`bumpRevision: patch makes the shot invalid. ${formatErrors(introduced)}`,introduced);
return next;
}
