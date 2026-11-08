

export const MAD_TO_SIGMA=1.482602218505602;

function hasNaN(x){
for(let i=0;i<x.length;i++)if(Number.isNaN(x[i]))return true;
return false;
}

export function sum(x){
let s=0;
for(let i=0;i<x.length;i++)s+=x[i];
return s;
}

export function mean(x){
const n=x.length;
if(n===0)return NaN;
return sum(x)/n;
}


export function variance(x,ddof=1){
const n=x.length;
if(n-ddof<=0)return NaN;
const m=mean(x);
let s=0;
for(let i=0;i<n;i++){
const d=x[i]-m;
s+=d*d;
}
return s/(n-ddof);
}


export function std(x,ddof=1){
return Math.sqrt(variance(x,ddof));
}





export function percentile(x,p){
if(!(p>=0&&p<=100))throw new RangeError('percentile: p must be in [0, 100]');
const n=x.length;
if(n===0||hasNaN(x))return NaN;
const s=Float64Array.from(x).sort();
const pos=(p/100)*(n-1);
const lo=Math.floor(pos);
const hi=Math.min(lo+1,n-1);
const frac=pos-lo;
return frac===0?s[lo]:s[lo]+frac*(s[hi]-s[lo]);
}


export function quantile(x,q){
return percentile(x,q*100);
}

export function median(x){
return percentile(x,50);
}


export function mad(x,scale=1){
const m=median(x);
if(Number.isNaN(m))return NaN;
const d=new Float64Array(x.length);
for(let i=0;i<x.length;i++)d[i]=Math.abs(x[i]-m);
return median(d)*scale;
}


export function rmse(a,b){
const n=a.length;
if(b!==undefined&&b.length!==n)throw new RangeError('rmse: length mismatch');
if(n===0)return NaN;
let s=0;
for(let i=0;i<n;i++){
const d=b===undefined?a[i]:a[i]-b[i];
s+=d*d;
}
return Math.sqrt(s/n);
}
