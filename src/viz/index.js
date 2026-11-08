











export{vizPalette,seriesIndex,GLYPHS}from'./palette.js';
export{drawSide,drawTop}from'./plot2d.js';
export{createTraj3d,orbitCamera,project3}from'./traj3d.js';
export{drawTracer,projectFlight}from'./tracer.js';
export{drawBars,drawBox,quantile}from'./charts.js';


export function prefersReducedMotion(){
try{return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);}catch(_){return false;}
}
