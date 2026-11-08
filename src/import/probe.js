














import{openDemuxer,codecFamily}from'./demux.js';
import{buildTimebase,rotationFromMatrix,displaySize}from'./timebase.js';
import{diagRecord}from'../workers/diag.js';


export function captureFpsHintOf(edits,effective_fps){
if(!Array.isArray(edits)||!(effective_fps>0))return null;
let k=1;
for(const e of edits){
if(Number.isFinite(e.rate)&&e.rate>0&&e.rate<1)k=Math.max(k,1/e.rate);
if(e.segment_s>0&&e.media_s>0)k=Math.max(k,e.segment_s/e.media_s);
}
return k>=1.5?Math.round(effective_fps*k):null;
}


export function isTruncated(dm){
const size=dm&&dm.file_bytes;
const end=dm&&dm.table_end_bytes;
return Number.isFinite(size)&&Number.isFinite(end)&&end>size;
}

export function summarize(dm){
const tb=buildTimebase(dm.samples,{nominal_fps:dm.nominal_fps});
const rot=rotationFromMatrix(dm.matrix);
const disp=displaySize(dm.width,dm.height,rot.rotation);
return{
codec:dm.codec,
family:codecFamily(dm.codec),
width:dm.width,
height:dm.height,
display_width:disp.width,
display_height:disp.height,
rotation:rot.rotation,
mirrored:rot.mirrored,
sample_count:dm.samples.length,
effective_fps:tb.effective_fps,
nominal_fps:tb.nominal_fps,
vfr:tb.vfr,
cv:tb.cv,
timestamps:tb.timestamps,
cts_s:Array.from(tb.t_s),
duration_s:dm.duration_s,
reason_codes:tb.reason_codes.slice(),
timebase:tb,
truncated:isTruncated(dm),
file_bytes:Number.isFinite(dm.file_bytes)?dm.file_bytes:null,
table_end_bytes:Number.isFinite(dm.table_end_bytes)?dm.table_end_bytes:null,
captureFpsHint:captureFpsHintOf(dm.edits,tb.effective_fps),
};
}

async function readable(dm,d){
try{
for await(const s of dm.readSamples(d,d))return s.data.byteLength===s.sample.size;
}catch{return false;}
return false;
}

export async function probeFile(file,opts={}){
const dm=opts.demuxer??(await openDemuxer(file));
const p=summarize(dm);

if(!p.truncated&&typeof dm.readSamples==='function'&&dm.samples.length){
const ends=[0,dm.samples.length-1];
for(const d of ends)if(!(await readable(dm,d))){p.truncated=true;break;}
}
diagRecord('import.last.truncated',p.truncated);
diagRecord('import.last.effective_fps',p.effective_fps);
diagRecord('import.last.sample_count',p.sample_count);
diagRecord('import.last.hevc',p.family==='hevc');
diagRecord('import.last.vfr',p.vfr);
diagRecord('import.last.codec',p.codec);
return p;
}
