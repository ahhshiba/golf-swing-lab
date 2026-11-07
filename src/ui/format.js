



import{t,has,fmtNum as fmtLocaleNum}from'../i18n/index.js';
import{fmtMetric,DEFAULT_UNITS}from'../i18n/units.js';
import{METRIC_IDS}from'../contract/enums.js';

export{fmtMetric};


export function formatMetric(m,units=DEFAULT_UNITS){
if(!m||m.value===null||m.value===undefined)return'—';
return fmtMetric(m,units).text;
}


export function reasonTexts(codes=[]){
return codes.map((c)=>(has(`reason.${c}.long`)?t(`reason.${c}.long`):t('common.unknown')));
}


export function metricRows(metrics={},units=DEFAULT_UNITS){
return METRIC_IDS.map((id)=>{
const m=metrics[id];
const isNull=!m||m.value===null;
const validity=m?.validity??'not_computed';
return{
id,
label:t(`metric.${id}.label`),
text:formatMetric(m,units),
validity,
validityLabel:t(`validity.${validity}`),
reasons:reasonTexts(m?.reason_codes??[]),
isNull,
};
});
}


export function failureTexts(evaluation){
return(evaluation?.failures??[]).map((f)=>{
const params=typeof f.value==='number'?{value:fmtNum(f.value),limit:fmtNum(f.limit)}:{};
return t(`calib.check.${f.check}`,{...params,...(f.params??{})});
});
}


export function fmtNum(x,d=2){
if(typeof x!=='number'||!Number.isFinite(x))return String(x);
return fmtLocaleNum(x,{digits:Math.abs(x)>=100?0:d});
}

export function fmtBytes(n){
if(!Number.isFinite(n))return t('common.unknown');
if(n>=1e9)return`${fmtLocaleNum(n/1e9,{digits:2})} GB`;
if(n>=1e6)return`${fmtLocaleNum(n/1e6,{digits:1})} MB`;
return`${fmtLocaleNum(Math.round(n/1e3))} KB`;
}

export function fmtDuration(s){
if(!Number.isFinite(s))return'—';
const m=Math.floor(s/60);
const r=Math.floor(s%60);
return`${m}:${String(r).padStart(2,'0')}`;
}


export function errorText(e){
const code=e?.code??e?.name??'';
if(code&&has(`error.${code}`))return t(`error.${code}`,e?.params??{});
return t('error.INTERNAL');
}


export function errorFix(e){
const code=e?.code??e?.name??'INTERNAL';
return has(`error.${code}.fix`)?t(`error.${code}.fix`,e?.params??{}):'';
}
