










let sink=null;
let lazy=null;
const log=[];

function loadDefault(){
if(!lazy){
lazy=import('../diag/record.js')
.then((m)=>(typeof m.record==='function'?m.record:null))
.catch(()=>null);
}
return lazy;
}

export function setDiagSink(fn){
sink=typeof fn==='function'?fn:null;
}

export function diagRecord(path,value){
try{
log.push({path,value});
if(log.length>200)log.shift();
if(sink){sink(path,value);return;}
loadDefault().then((rec)=>{
try{if(rec)rec(path,value);}catch{ }
});
}catch{

}
}

export function getDiagLog(){
return log.slice();
}
