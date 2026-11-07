



import{mean,std}from'../geom/stats.js';
import{RC}from'../contract/reason-codes.js';
import{POSE_KEYS}from'./pnp.js';
import{presetDeviation}from'./report.js';


export const F_LOCK_RULE=Object.freeze({min_n:3,max_sd_pct:1});

function pickPose(p){
const out={};
for(const k of POSE_KEYS){
if(!Number.isFinite(p?.[k]))throw new RangeError(`preset: pose.${k} must be a finite number`);
out[k]=p[k];
}
return out;
}


export function presetId(venue_id,view,created_at){
return`${venue_id}:${view}:${created_at}`;
}






export function createPreset(o){
if(!o.venue_id)throw new RangeError('createPreset: venue_id is required');
if(!['face_on','dtl','high_behind'].includes(o.view))throw new RangeError(`createPreset: bad view '${o.view}'`);
if(o.created_at===undefined||o.created_at===null)throw new RangeError('createPreset: created_at is required');
const pose=pickPose(o.pose??o.calibration?.pose);
const f_locked=o.f_locked??(o.calibration?.f_locked?o.calibration.f_px:null);
return{
preset_id:o.preset_id??presetId(o.venue_id,o.view,o.created_at),
venue_id:o.venue_id,
view:o.view,
pose,
f_locked:Number.isFinite(f_locked)?f_locked:null,
W:o.W??o.calibration?.camera?.W??null,
H:o.H??o.calibration?.camera?.H??null,
created_at:o.created_at,
updated_at:o.created_at,
revision:1,
};
}


export function updatePreset(preset,changes,updated_at){
if(updated_at===undefined||updated_at===null)throw new RangeError('updatePreset: updated_at is required');
return{
...preset,
pose:changes.pose?pickPose(changes.pose):{...preset.pose},
f_locked:changes.f_locked!==undefined?changes.f_locked:preset.f_locked,
W:changes.W??preset.W,
H:changes.H??preset.H,
updated_at,
revision:(preset.revision??1)+1,
};
}






export function comparePreset(calibOrReport,preset,ctx={}){
const pose=calibOrReport.pose??calibOrReport;
const view=ctx.view??calibOrReport.view;
const venue=ctx.venue_id??calibOrReport.venue_id;
const same_view=view===undefined||view===preset.view;
const same_venue=venue===undefined||venue===preset.venue_id;
return{
dev:presetDeviation(pose,preset),
same_view,
same_venue,
reason_codes:same_view&&same_venue?[]:[RC.PRESET_MISMATCH],
};
}


export function comparePresets(a,b){
const same=a.preset_id===b.preset_id;
const sameKind=a.view===b.view&&a.venue_id===b.venue_id;
return{dev:presetDeviation(a.pose,b),same,reason_codes:same?[]:[RC.PRESET_MISMATCH],same_kind:sameKind};
}





export function fLockFromSolves(fs,rule=F_LOCK_RULE){
const xs=fs.filter(Number.isFinite);
const failures=[];
const n=xs.length;
const m=n?mean(xs):NaN;
const sd=n>=2?std(xs):NaN;
const sd_pct=(100*sd)/m;
if(n<rule.min_n)failures.push({check:'f_lock_n',value:n,limit:rule.min_n});
if(n>=2&&!(sd_pct<=rule.max_sd_pct))failures.push({check:'f_lock_sd_pct',value:sd_pct,limit:rule.max_sd_pct});
const ok=failures.length===0;
return{ok,f_locked:ok?m:null,mean:m,sd,sd_pct,n,failures};
}
