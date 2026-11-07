














import{DEFAULT_UNITS,defaultUnits,normalizeUnits}from'../i18n/units.js';
import{METRIC_IDS}from'../contract/enums.js';

export const SETTINGS_KEY='gsl-settings-v2';
const V1_KEY='gsl-settings-v1';

export const THEMES=Object.freeze(['auto','light','dark','sun']);
export const LOCALE_PREFS=Object.freeze(['auto','zh-Hant','en']);

export const LIVE_METRIC_CHOICES=Object.freeze(['tempo_ratio','backswing_s','downswing_s','club_speed_mps','carry_m','ball_speed_mps','head_sway_x_m']);

export const LM_GROUNDS=Object.freeze(['firm','normal','soft']);
export const LM_TILE_PRESETS=Object.freeze(['auto','custom']);
export const LM_TILE_MAX=16;

export const LM_TILE_DEFAULTS=Object.freeze({
face_on:Object.freeze(['carry_m','total_m','ball_speed_mps','club_speed_mps','smash_factor','launch_v_deg','spin_rate_rpm','apex_m','landing_angle_deg','attack_angle_deg','dynamic_loft_deg','spin_loft_deg']),
high_behind:Object.freeze(['carry_side_m','curve_m','launch_h_deg','club_path_deg','face_angle_deg','face_to_path_deg','spin_axis_deg','club_speed_mps','carry_m']),
dtl:Object.freeze(['tempo_ratio','backswing_s','downswing_s','spine_forward_tilt_deg','hand_plane_dev_m','early_extension_m','head_lift_z_m','head_depth_y_m','top_shaft_angle_deg','shoulder_turn_deg','hip_turn_deg','x_factor_deg']),
});

export function tileDefaults(view){
return[...(LM_TILE_DEFAULTS[view]??LM_TILE_DEFAULTS.face_on)];
}
const YD=0.9144;

export const DEFAULT_SETTINGS=Object.freeze({
handedness:'right',
height_m:1.75,
club_type:'7i',
club_length_m:0.94,
lie:'mat',
model:'full',
lastVenueId:null,
lastView:'face_on',
mode:'live',

locale:'auto',
units:DEFAULT_UNITS,
theme:'dark',
onboarding:Object.freeze({done_v:0}),
live:Object.freeze({metrics:Object.freeze(['tempo_ratio','club_speed_mps','carry_m']),voice:true}),
dev:false,
sunSuggested:false,

lm:Object.freeze({
ground:'normal',crossView:false,tiles:LM_TILE_DEFAULTS.face_on,tilePreset:'auto',
gapMin:8*YD,gapMax:20*YD,excludeMishits:true,
}),
});

const NESTED=['units','onboarding','live','lm'];
const isObj=(v)=>v!==null&&typeof v==='object'&&!Array.isArray(v);

function read(storage,key){
try{
const raw=storage?.getItem(key);
const obj=raw?JSON.parse(raw):null;
return isObj(obj)?obj:null;
}catch(_){
return null;
}
}

function normalize(obj,languages){
const s={...DEFAULT_SETTINGS,...obj};
s.units=normalizeUnits(isObj(obj.units)?obj.units:{},defaultUnits(languages));
s.onboarding={...DEFAULT_SETTINGS.onboarding,...(isObj(obj.onboarding)?obj.onboarding:{})};
if(!Number.isInteger(s.onboarding.done_v)||s.onboarding.done_v<0)s.onboarding.done_v=0;
const live=isObj(obj.live)?obj.live:{};
const metrics=Array.isArray(live.metrics)?live.metrics.filter((m)=>LIVE_METRIC_CHOICES.includes(m)).slice(0,3):null;
s.live={metrics:metrics&&metrics.length?metrics:[...DEFAULT_SETTINGS.live.metrics],voice:typeof live.voice==='boolean'?live.voice:true};
if(!LOCALE_PREFS.includes(s.locale))s.locale='auto';
if(!THEMES.includes(s.theme))s.theme='auto';
s.dev=s.dev===true;
s.sunSuggested=s.sunSuggested===true;
s.lm=normalizeLm(isObj(obj.lm)?obj.lm:{});
return s;
}

const posNum=(x)=>typeof x==='number'&&Number.isFinite(x)&&x>0;

function normalizeLm(lm){
const d=DEFAULT_SETTINGS.lm;
const tiles=Array.isArray(lm.tiles)?[...new Set(lm.tiles.filter((id)=>METRIC_IDS.includes(id)))].slice(0,LM_TILE_MAX):[];
let gapMin=posNum(lm.gapMin)?lm.gapMin:d.gapMin;
let gapMax=posNum(lm.gapMax)?lm.gapMax:d.gapMax;
if(!(gapMin<gapMax)){gapMin=d.gapMin;gapMax=d.gapMax;}
return{
ground:LM_GROUNDS.includes(lm.ground)?lm.ground:d.ground,
crossView:false,
tiles:tiles.length?tiles:[...d.tiles],
tilePreset:LM_TILE_PRESETS.includes(lm.tilePreset)?lm.tilePreset:d.tilePreset,
gapMin,
gapMax,
excludeMishits:typeof lm.excludeMishits==='boolean'?lm.excludeMishits:d.excludeMishits,
};
}


export function migrateV1(v1){
const out={theme:'auto'};
for(const k of['handedness','height_m','club_type','club_length_m','lie','model','lastVenueId','lastView','mode']){
if(v1&&k in v1)out[k]=v1[k];
}
return out;
}

export function loadSettings(storage=globalThis.localStorage,{languages}={}){
const langs=languages??globalThis.navigator?.languages??[];
const v2=read(storage,SETTINGS_KEY);
if(v2)return normalize(v2,langs);
const v1=read(storage,V1_KEY);
const s=normalize(v1?migrateV1(v1):{},langs);
if(v1){try{storage?.setItem(SETTINGS_KEY,JSON.stringify(s));}catch(_){ }}
return s;
}

export function saveSettings(patch,storage=globalThis.localStorage){
const cur=loadSettings(storage);
const next={...cur};
for(const[k,v]of Object.entries(patch??{})){
next[k]=NESTED.includes(k)&&isObj(v)?{...cur[k],...v}:v;
}
const s=normalize(next,globalThis.navigator?.languages??[]);
try{storage?.setItem(SETTINGS_KEY,JSON.stringify(s));}catch(_){ }
return s;
}





export const CLUBS=Object.freeze([
['driver',1.15],['3w',1.09],['hybrid',1.0],['5i',0.965],['7i',0.94],['9i',0.915],['pw',0.9],['sw',0.89],
].map(([type,len])=>Object.freeze([type,len,len])));

export function clubLength(type){
const c=CLUBS.find((x)=>x[0]===type);
return c?c[1]:null;
}
