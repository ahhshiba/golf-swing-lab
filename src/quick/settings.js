




export const QUICK_DEFAULTS=Object.freeze({enabled:true});


export function normalizeQuick(raw){
const q=raw!==null&&typeof raw==='object'?raw:{};
return{enabled:typeof q.enabled==='boolean'?q.enabled:QUICK_DEFAULTS.enabled};
}
