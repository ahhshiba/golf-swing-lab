



































import{METRIC_IDS}from'./metric-ids.js';
import{assertShotFilter,getPath,revisionOf,filterShots}from'./core.js';
import{validateLabel,LABEL_SET_FORMAT}from'./labels.js';
import{migrateShot}from'../contract/migrate.js';

export{LABEL_SET_FORMAT};

export const EXPORT_FORMAT='golf-swing-lab-export/1';
const FORMAT_RE=/^golf-swing-lab-export\/(\d+)$/;
const SUPPORTED_MAJOR=1;

export const CSV_FIXED_COLUMNS=Object.freeze(['shot_id','created_at','venue_id','preset_id','view','club_type','lie']);
export const CSV_COLUMNS=Object.freeze([
...CSV_FIXED_COLUMNS,
...METRIC_IDS.flatMap((id)=>[id,`${id}_lo`,`${id}_hi`,`${id}_validity`]),
]);






export class ImportError extends Error{
constructor(message,details=[],{reason='invalid',params={}}={}){
super(message);
this.name='ImportError';
this.code='IMPORT_REJECTED';
this.reason=reason;
this.params=params;
this.details=details;
}
}



const TYPED={
Float32Array,Float64Array,Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,
};

function bytesToB64(bytes){
let s='';
for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
return btoa(s);
}

function b64ToBytes(b64){
const s=atob(b64);
const out=new Uint8Array(s.length);
for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);
return out;
}

const isPlain=(v)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&!ArrayBuffer.isView(v);


export function encodeTyped(value){
if(ArrayBuffer.isView(value)){
const name=value.constructor.name;
if(!TYPED[name])throw new Error(`unsupported typed array type: ${name}`);
return{__typed:name,b64:bytesToB64(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};
}
if(Array.isArray(value))return value.map(encodeTyped);
if(isPlain(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encodeTyped(v)]));
return value;
}


export function decodeTyped(value){
if(Array.isArray(value))return value.map(decodeTyped);
if(isPlain(value)){
if(typeof value.__typed==='string'){
const Ctor=TYPED[value.__typed];
if(!Ctor||typeof value.b64!=='string')throw new Error('malformed binary field');
const bytes=b64ToBytes(value.b64);
if(bytes.byteLength%Ctor.BYTES_PER_ELEMENT!==0)throw new Error('binary field has a bad length');
return new Ctor(bytes.buffer,0,bytes.byteLength/Ctor.BYTES_PER_ELEMENT);
}
return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decodeTyped(v)]));
}
return value;
}

async function blobBytes(blob){
if(blob&&typeof blob.arrayBuffer==='function')return new Uint8Array(await blob.arrayBuffer());
if(ArrayBuffer.isView(blob))return new Uint8Array(blob.buffer,blob.byteOffset,blob.byteLength);
if(blob instanceof ArrayBuffer)return new Uint8Array(blob);
throw new Error('malformed clip data');
}

async function encodeClip(clip){
const{blob,...rest}=clip;
if(blob===undefined||blob===null)return encodeTyped(rest);
return{...encodeTyped(rest),mime:rest.mime??blob.type??'',data_b64:bytesToB64(await blobBytes(blob))};
}

function decodeClip(rec){
const{data_b64:data,...rest}=rec;
const out=decodeTyped(rest);
if(data!==undefined){
if(typeof data!=='string')throw new Error('malformed clip data');
out.blob=new Blob([b64ToBytes(data)],{type:typeof rest.mime==='string'?rest.mime:''});
}
return out;
}



function isoNow(now){
if(typeof now==='function')return isoNow(now());
if(now instanceof Date)return now.toISOString();
if(typeof now==='string')return now;
return new Date().toISOString();
}





export async function exportJSON(repo,filter={}){
const{includePoses=false,includeClips=false,includeLabels=false,includeRounds,app_version:appVersion,now,...shotFilter}=filter??{};
assertShotFilter(shotFilter);
const filtered=Object.values(shotFilter).some((v)=>v!==undefined&&v!==null);
const withRounds=(includeRounds??!filtered)&&Boolean(repo.stores?.rounds);

const names=['venues','presets','sessions','shots'];
if(includePoses)names.push('poses');
if(includeClips)names.push('clips');
if(includeLabels)names.push('labels');
if(withRounds)names.push('rounds');
const snap=await repo.snapshot(names);

const shots=filterShots(snap.shots,shotFilter);
let{venues,presets,sessions}=snap;
let poses=snap.poses;
let clips=snap.clips;
let labels=snap.labels;
if(filtered){
const ids=new Set(shots.map((s)=>s.shot_id));
const sessionIds=new Set(shots.map((s)=>s.session_id));
const presetIds=new Set(shots.map((s)=>s.preset_id));
sessions=sessions.filter((s)=>sessionIds.has(s.session_id));
presets=presets.filter((p)=>presetIds.has(p.preset_id));
const venueIds=new Set([...shots,...sessions,...presets].map((r)=>r.venue_id));
venues=venues.filter((v)=>venueIds.has(v.venue_id));
if(poses)poses=poses.filter((p)=>ids.has(p.shot_id));
if(clips)clips=clips.filter((c)=>ids.has(c.shot_id));
if(labels)labels=labels.filter((l)=>ids.has(l.shot_id));
}

const out={
format:EXPORT_FORMAT,
exported_at:isoNow(now),
app_version:appVersion??'unknown',
venues,
presets,
sessions,
shots:shots.map((x)=>migrateShot(x).shot),
};
if(includePoses)out.poses=poses.map(encodeTyped);
if(includeClips)out.clips=await Promise.all(clips.map(encodeClip));
if(includeLabels)out.labels=labels;
if(withRounds)out.rounds=snap.rounds;
return out;
}



export function csvField(v){
let s;
if(v===null||v===undefined)s='';
else if(typeof v==='number')s=Number.isFinite(v)?String(v):'';
else s=String(v);
return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}

function csvRow(shot){
const cells=[
shot.shot_id,shot.created_at,shot.venue_id,shot.preset_id,
getPath(shot,'capture.view'),getPath(shot,'club.type'),getPath(shot,'club.lie'),
];
const metrics=shot.metrics??{};
for(const id of METRIC_IDS){
const m=metrics[id];
const ci=m&&Array.isArray(m.ci95)?m.ci95:null;
cells.push(m?m.value:null,ci?ci[0]:null,ci?ci[1]:null,m?m.validity:null);
}
return cells.map(csvField).join(',');
}


export function exportCSV(shots,{bom=false}={}){
const lines=[CSV_COLUMNS.map(csvField).join(','),...shots.map(csvRow)];
return`${bom?'﻿':''}${lines.join('\r\n')}\r\n`;
}




export function builtinShotValidator(shot){
const errors=[];
if(!isPlain(shot))return{ok:false,errors:['not an object']};
if(shot.schema!=='golf-shot/1'&&shot.schema!=='golf-shot/2')errors.push(`schema must be golf-shot/2 or golf-shot/1, got ${String(shot.schema)}`);
if(typeof shot.shot_id!=='string'||shot.shot_id==='')errors.push('missing shot_id');
if(shot.metrics!==undefined&&!isPlain(shot.metrics))errors.push('metrics must be an object');
return{ok:errors.length===0,errors};
}

function describeError(e){
if(typeof e==='string')return e;
if(e&&typeof e==='object'){
const where=e.path??e.instancePath??e.field;
const what=e.message??e.msg??e.code;
if(what)return where?`${where}: ${what}`:String(what);
}
return JSON.stringify(e);
}


export function normalizeValidation(result){
if(result===true)return{ok:true,errors:[]};
if(result===false)return{ok:false,errors:['validation failed']};
if(Array.isArray(result))return{ok:result.length===0,errors:result.map(describeError)};
if(result&&typeof result==='object'){
const flag='ok'in result?result.ok:result.valid;
if(typeof flag==='boolean'){
const errs=Array.isArray(result.errors)?result.errors.map(describeError):[];
return{ok:flag,errors:flag?[]:(errs.length?errs:['validation failed'])};
}
}
return{ok:false,errors:['the validator returned an unrecognised result']};
}

let contractValidatorPromise=null;



export function resolveDefaultValidator(){
if(!contractValidatorPromise){
contractValidatorPromise=import('../contract/validate.js').then(
(mod)=>{
const fn=mod.validateShot??mod.validate??mod.default;
if(typeof fn==='function')return{fn,source:'contract',note:null};
return{fn:builtinShotValidator,source:'builtin',note:'contract/validate.js exports no validateShot; structure checks only'};
},
()=>({fn:builtinShotValidator,source:'builtin',note:'contract/validate.js could not be loaded; structure checks only'}),
);
}
return contractValidatorPromise;
}



const REQUIRED_ARRAYS=['venues','presets','sessions','shots'];
const ID_FIELD={venues:'venue_id',presets:'preset_id',sessions:'session_id',shots:'shot_id',poses:'shot_id',clips:'clip_id',labels:'shot_id',rounds:'round_id'};
const MAX_LISTED=5;

function parseInput(data){
if(typeof data!=='string')return data;
try{
return JSON.parse(data.charCodeAt(0)===0xfeff?data.slice(1):data);
}catch(e){
throw new ImportError('not valid JSON; nothing imported',[String(e.message)],{reason:'not_json'});
}
}

function checkEnvelope(data){
if(!isPlain(data)){
throw new ImportError('not a golf-swing-lab export (not a JSON object); nothing imported',[],{reason:'not_export'});
}
const m=typeof data.format==='string'?FORMAT_RE.exec(data.format):null;
if(!m){
throw new ImportError(
`not a golf-swing-lab export (format is ${JSON.stringify(data.format??null)}, expected ${EXPORT_FORMAT}); nothing imported`,
[],{reason:'not_export',params:{format:String(data.format??'')}});
}
if(Number(m[1])!==SUPPORTED_MAJOR){
throw new ImportError(
`unsupported export format version ${data.format} (this app reads ${EXPORT_FORMAT}); nothing imported`,
[],{reason:'version',params:{format:data.format,supported:EXPORT_FORMAT}});
}
const missing=REQUIRED_ARRAYS.filter((k)=>!Array.isArray(data[k]));
if(missing.length){
throw new ImportError(`missing or malformed fields: ${missing.join(', ')}; nothing imported`,missing,{reason:'missing_fields',params:{fields:missing.join(', ')}});
}
for(const k of['poses','clips','labels','rounds']){
if(data[k]!==undefined&&!Array.isArray(data[k])){
throw new ImportError(`field ${k} is malformed; nothing imported`,[k],{reason:'bad_field',params:{field:k}});
}
}
}


function dedupe(store,list,problems,warnings){
const idField=ID_FIELD[store];
const byId=new Map();
let dropped=0;
list.forEach((rec,i)=>{
const id=isPlain(rec)?rec[idField]:undefined;
if(typeof id!=='string'||id===''){
problems.push(`${store}[${i}]: missing ${idField}`);
return;
}
if(rec.revision!==undefined&&!(Number.isInteger(rec.revision)&&rec.revision>=0)){
problems.push(`${store} ${id}: revision must be a non-negative integer`);
return;
}
const prev=byId.get(id);
if(!prev)byId.set(id,rec);
else{
dropped++;
if(revisionOf(rec)>revisionOf(prev))byId.set(id,rec);
}
});
if(dropped)warnings.push(`${store}: ${dropped} duplicate ${idField} in the file, kept the higher revision`);
return[...byId.values()];
}





export async function importJSON(repo,data,{validate}={}){
const env=parseInput(data);
checkEnvelope(env);

const warnings=[];
let validator='custom';
let validateFn=validate;
if(typeof validateFn!=='function'){
const def=await resolveDefaultValidator();
validateFn=def.fn;
validator=def.source;
if(def.note)warnings.push(def.note);
}

const problems=[];
const byStore={};
for(const store of REQUIRED_ARRAYS)byStore[store]=dedupe(store,env[store],problems,warnings);

const bad=[];
for(const shot of byStore.shots){
let verdict;
try{
verdict=normalizeValidation(await validateFn(shot));
}catch(e){
verdict={ok:false,errors:[`validator threw: ${(e&&e.message)||String(e)}`]};
}
if(!verdict.ok)bad.push(`shots ${shot.shot_id}: ${verdict.errors.join('; ')}`);
}

for(const store of['poses','clips']){
if(env[store]===undefined)continue;
try{
byStore[store]=dedupe(store,env[store],problems,warnings).map(store==='poses'?decodeTyped:decodeClip);
}catch(e){
problems.push(`${store}: corrupt data: ${e.message}`);
}
}

if(env.labels!==undefined){
byStore.labels=dedupe('labels',env.labels,problems,warnings);
for(const l of byStore.labels){
const v=validateLabel(l);
if(!v.ok)problems.push(`labels ${l.shot_id}: ${v.errors.map(describeError).join('; ')}`);
}
}

if(env.rounds!==undefined){
byStore.rounds=dedupe('rounds',env.rounds,problems,warnings);
if(byStore.rounds.length){
const{validateRound}=await import('../contract/round.js');
for(const r of byStore.rounds){
const v=validateRound(r);
if(!v.ok)problems.push(`rounds ${r.round_id}: ${v.errors.map(describeError).join('; ')}`);
}
}
}

if(problems.length||bad.length){
const details=[...problems,...bad];
const shown=details.slice(0,MAX_LISTED).join('; ');
const more=details.length>MAX_LISTED?` (${details.length} problems in all)`:'';
throw new ImportError(`import cancelled, nothing written; ${bad.length?`${bad.length} invalid shot(s); `:''}${shown}${more}`,details,
{reason:'invalid',params:{n:details.length,shots:bad.length}});
}

const counts=await repo.merge(byStore);
const total={added:0,updated:0,kept:0};
for(const c of Object.values(counts))for(const k of Object.keys(total))total[k]+=c[k];
return{
ok:true,
counts,
total,
validator,
warnings,
message:`import done: ${total.added} added, ${total.updated} updated, ${total.kept} kept (same or newer revision already stored)`,
msg:{code:'history.restore.done',params:{...total}},
};
}











function originalEvents(shot){
for(const h of Array.isArray(shot?.history)?shot.history:[])if(h?.before?.events)return h.before.events;
return shot?.events??null;
}

function posePayload(p){
if(!p||!p.img||!p.t_s)return null;
const t=Array.from(p.t_s,Number);
const img=p.img instanceof Float32Array?p.img:Float32Array.from(p.img);
const hz=t.length>1&&t[t.length-1]>t[0]?Math.round(((t.length-1)/(t[t.length-1]-t[0]))*100)/100:null;
return{hz,W:p.W??null,H:p.H??null,model:p.model??'unknown',t_s:t,img_f32:bytesToB64(new Uint8Array(img.buffer,img.byteOffset,img.byteLength))};
}

export async function exportLabelSet(repo,{now,app_version:appVersion,shot_ids:shotIds}={}){
const snap=await repo.snapshot(['shots','poses','labels']);
const want=Array.isArray(shotIds)?new Set(shotIds):null;
const shots=new Map(snap.shots.map((s)=>[s.shot_id,s]));
const poses=new Map(snap.poses.map((p)=>[p.shot_id,p]));
const swings=[];
for(const l of[...snap.labels].sort((a,b)=>String(a.shot_id).localeCompare(String(b.shot_id)))){
if(!validateLabel(l).ok||(want&&!want.has(l.shot_id)))continue;
const s=shots.get(l.shot_id);
if(!s)continue;
const cap=s.capture??{};
swings.push({
shot_id:s.shot_id,
session_id:s.session_id??null,
view:cap.view??null,
handedness:s.handedness??'right',
fps:cap.effective_fps??cap.nominal_fps??l.fps,
container_fps:cap.nominal_fps??null,
time_scale:s.events?.meta?.time_scale??1,
audio_onset_t:Number.isFinite(s.quality?.audio_onset)?s.quality.audio_onset:null,
detected:originalEvents(s),
label:l,
pose:posePayload(poses.get(s.shot_id)),
});
}
return{format:LABEL_SET_FORMAT,exported_at:isoNow(now),app_version:appVersion??'unknown',source:'app',swings};
}
