





export function mulberry32(seed){
if(typeof seed!=='number'||!Number.isFinite(seed))throw new TypeError('mulberry32: seed must be a finite number');
let a=seed>>>0;
return function next(){
a=(a+0x6d2b79f5)|0;
let t=Math.imul(a^(a>>>15),1|a);
t=(t+Math.imul(t^(t>>>7),61|t))^t;
return((t^(t>>>14))>>>0)/4294967296;
};
}


export function gauss(rng,mean=0,sd=1){
const u1=1-rng();
const u2=rng();
return mean+sd*Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
}


export function uniform(rng,lo=0,hi=1){
return lo+(hi-lo)*rng();
}
