




const EPS=2.220446049250313e-16;



export function add3(a,b){return[a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
export function sub3(a,b){return[a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
export function scale3(a,s){return[a[0]*s,a[1]*s,a[2]*s];}
export function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
export function cross3(a,b){
return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
}
export function norm3(a){return Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]);}
export function dist3(a,b){return norm3(sub3(a,b));}

export function normalize3(a){
const n=norm3(a);
if(!(n>0)||!Number.isFinite(n))throw new RangeError('normalize3: zero or non-finite vector');
return[a[0]/n,a[1]/n,a[2]/n];
}



export function mat3Identity(){return[1,0,0,0,1,0,0,0,1];}

export function mat3Mul(A,B){
const C=new Array(9);
for(let i=0;i<3;i++){
for(let j=0;j<3;j++)C[3*i+j]=A[3*i]*B[j]+A[3*i+1]*B[3+j]+A[3*i+2]*B[6+j];
}
return C;
}


export function mat3MulVec(A,v){
return[
A[0]*v[0]+A[1]*v[1]+A[2]*v[2],
A[3]*v[0]+A[4]*v[1]+A[5]*v[2],
A[6]*v[0]+A[7]*v[1]+A[8]*v[2],
];
}


export function mat3TMulVec(A,v){
return[
A[0]*v[0]+A[3]*v[1]+A[6]*v[2],
A[1]*v[0]+A[4]*v[1]+A[7]*v[2],
A[2]*v[0]+A[5]*v[1]+A[8]*v[2],
];
}

export function mat3Transpose(A){return[A[0],A[3],A[6],A[1],A[4],A[7],A[2],A[5],A[8]];}

export function mat3Det(A){
return A[0]*(A[4]*A[8]-A[5]*A[7])-A[1]*(A[3]*A[8]-A[5]*A[6])+A[2]*(A[3]*A[7]-A[4]*A[6]);
}


export function mat3Inverse(A){
const c00=A[4]*A[8]-A[5]*A[7];
const c01=A[5]*A[6]-A[3]*A[8];
const c02=A[3]*A[7]-A[4]*A[6];
const det=A[0]*c00+A[1]*c01+A[2]*c02;
let scale=0;
for(let i=0;i<9;i++)scale=Math.max(scale,Math.abs(A[i]));
if(!Number.isFinite(det)||!(Math.abs(det)>16*EPS*scale*scale*scale))return null;
const k=1/det;
return[
c00*k,(A[2]*A[7]-A[1]*A[8])*k,(A[1]*A[5]-A[2]*A[4])*k,
c01*k,(A[0]*A[8]-A[2]*A[6])*k,(A[2]*A[3]-A[0]*A[5])*k,
c02*k,(A[1]*A[6]-A[0]*A[7])*k,(A[0]*A[4]-A[1]*A[3])*k,
];
}



function checkSquare(A,name){
const n=A.length;
for(let i=0;i<n;i++)if(A[i].length!==n)throw new RangeError(`${name}: square matrix required`);
return n;
}

export function zeros(m,n){return Array.from({length:m},()=>new Float64Array(n));}

export function identity(n){
const I=zeros(n,n);
for(let i=0;i<n;i++)I[i][i]=1;
return I;
}

export function transpose(A){
const m=A.length;
const n=m?A[0].length:0;
const T=zeros(n,m);
for(let i=0;i<m;i++)for(let j=0;j<n;j++)T[j][i]=A[i][j];
return T;
}

export function matMul(A,B){
const m=A.length;
const k=B.length;
const n=k?B[0].length:0;
const C=zeros(m,n);
for(let i=0;i<m;i++){
const Ai=A[i];
if(Ai.length!==k)throw new RangeError('matMul: inner dimensions differ');
const Ci=C[i];
for(let l=0;l<k;l++){
const a=Ai[l];
if(a===0)continue;
const Bl=B[l];
for(let j=0;j<n;j++)Ci[j]+=a*Bl[j];
}
}
return C;
}

export function matVec(A,x){
const m=A.length;
const y=new Float64Array(m);
for(let i=0;i<m;i++){
const Ai=A[i];
let s=0;
for(let j=0;j<Ai.length;j++)s+=Ai[j]*x[j];
y[i]=s;
}
return y;
}


export function gram(A){
const m=A.length;
const n=m?A[0].length:0;
const G=zeros(n,n);
for(let r=0;r<m;r++){
const a=A[r];
for(let i=0;i<n;i++){
const ai=a[i];
if(ai===0)continue;
const Gi=G[i];
for(let j=i;j<n;j++)Gi[j]+=ai*a[j];
}
}
for(let i=0;i<n;i++)for(let j=0;j<i;j++)G[i][j]=G[j][i];
return G;
}


export function gramVec(A,r){
const m=A.length;
const n=m?A[0].length:0;
const g=new Float64Array(n);
for(let i=0;i<m;i++){
const a=A[i];
const ri=r[i];
if(ri===0)continue;
for(let j=0;j<n;j++)g[j]+=a[j]*ri;
}
return g;
}





export function luDecompose(A){
const n=checkSquare(A,'luDecompose');
const LU=Array.from(A,(row)=>Float64Array.from(row));
const perm=new Int32Array(n);
for(let i=0;i<n;i++)perm[i]=i;
let scale=0;
for(let i=0;i<n;i++)for(let j=0;j<n;j++)scale=Math.max(scale,Math.abs(LU[i][j]));
if(!(scale>0)||!Number.isFinite(scale))return null;
const tiny=scale*EPS*Math.max(n,1);
let sign=1;
for(let k=0;k<n;k++){
let p=k;
let big=Math.abs(LU[k][k]);
for(let i=k+1;i<n;i++){
const v=Math.abs(LU[i][k]);
if(v>big){big=v;p=i;}
}
if(!(big>tiny))return null;
if(p!==k){
const tmp=LU[p];LU[p]=LU[k];LU[k]=tmp;
const tp=perm[p];perm[p]=perm[k];perm[k]=tp;
sign=-sign;
}
const rowK=LU[k];
const piv=rowK[k];
for(let i=k+1;i<n;i++){
const row=LU[i];
const f=row[k]/piv;
row[k]=f;
if(f!==0)for(let j=k+1;j<n;j++)row[j]-=f*rowK[j];
}
}
return{LU,perm,sign,n};
}


export function luSolve(lu,b){
const{LU,perm,n}=lu;
const x=new Float64Array(n);
for(let i=0;i<n;i++)x[i]=b[perm[i]];
for(let i=0;i<n;i++){
const row=LU[i];
let s=x[i];
for(let j=0;j<i;j++)s-=row[j]*x[j];
x[i]=s;
}
for(let i=n-1;i>=0;i--){
const row=LU[i];
let s=x[i];
for(let j=i+1;j<n;j++)s-=row[j]*x[j];
x[i]=s/row[i];
}
return x;
}

function allFinite(x){
for(let i=0;i<x.length;i++)if(!Number.isFinite(x[i]))return false;
return true;
}


export function solve(A,b){
if(b.length!==A.length)throw new RangeError('solve: dimension mismatch');
const lu=luDecompose(A);
if(!lu)return null;
const x=luSolve(lu,b);
return allFinite(x)?x:null;
}


export function inverse(A){
const lu=luDecompose(A);
if(!lu)return null;
const n=lu.n;
const Inv=zeros(n,n);
const e=new Float64Array(n);
for(let j=0;j<n;j++){
e.fill(0);
e[j]=1;
const col=luSolve(lu,e);
for(let i=0;i<n;i++)Inv[i][j]=col[i];
}
for(let i=0;i<n;i++)if(!allFinite(Inv[i]))return null;
return Inv;
}


export function det(A){
const lu=luDecompose(A);
if(!lu)return 0;
let d=lu.sign;
for(let i=0;i<lu.n;i++)d*=lu.LU[i][i];
return d;
}





export function cholesky(A){
const n=checkSquare(A,'cholesky');
const L=zeros(n,n);
for(let j=0;j<n;j++){
const Lj=L[j];
let s=A[j][j];
for(let k=0;k<j;k++)s-=Lj[k]*Lj[k];
if(!(s>0)||!Number.isFinite(s))return null;
const d=Math.sqrt(s);
Lj[j]=d;
for(let i=j+1;i<n;i++){
const Li=L[i];
let t=A[i][j];
for(let k=0;k<j;k++)t-=Li[k]*Lj[k];
Li[j]=t/d;
}
}
return L;
}


export function choleskySolve(L,b){
const n=L.length;
const y=new Float64Array(n);
for(let i=0;i<n;i++){
let s=b[i];
for(let k=0;k<i;k++)s-=L[i][k]*y[k];
y[i]=s/L[i][i];
}
for(let i=n-1;i>=0;i--){
let s=y[i];
for(let k=i+1;k<n;k++)s-=L[k][i]*y[k];
y[i]=s/L[i][i];
}
return y;
}






export function inverseSPD(A){
const n=checkSquare(A,'inverseSPD');
const d=new Float64Array(n);
for(let i=0;i<n;i++){
if(!(A[i][i]>0)||!Number.isFinite(A[i][i]))return null;
d[i]=1/Math.sqrt(A[i][i]);
}
const S=zeros(n,n);
for(let i=0;i<n;i++)for(let j=0;j<n;j++)S[i][j]=A[i][j]*d[i]*d[j];
const L=cholesky(S);
if(!L)return null;
for(let i=0;i<n;i++)if(!(L[i][i]*L[i][i]>n*1e-14))return null;
const Inv=zeros(n,n);
const e=new Float64Array(n);
for(let j=0;j<n;j++){
e.fill(0);
e[j]=1;
const col=choleskySolve(L,e);
for(let i=0;i<n;i++)Inv[i][j]=col[i]*d[i]*d[j];
}
for(let i=0;i<n;i++)for(let j=0;j<i;j++)Inv[i][j]=Inv[j][i]=0.5*(Inv[i][j]+Inv[j][i]);
return Inv;
}








export function eigenSym(A,{maxSweeps=100}={}){
const n=checkSquare(A,'eigenSym');
const a=Array.from(A,(row)=>Float64Array.from(row));
for(let i=0;i<n;i++){
for(let j=i+1;j<n;j++){
const s=0.5*(a[i][j]+a[j][i]);
a[i][j]=s;
a[j][i]=s;
}
}
const V=identity(n);
let frob=0;
for(let i=0;i<n;i++)for(let j=0;j<n;j++)frob+=a[i][j]*a[i][j];
frob=Math.sqrt(frob);
let sweeps=0;
for(;sweeps<maxSweeps;sweeps++){
let off=0;
for(let p=0;p<n;p++)for(let q=p+1;q<n;q++)off+=a[p][q]*a[p][q];
if(!(Math.sqrt(off)>1e-18*frob)||off<1e-300)break;
for(let p=0;p<n-1;p++){
for(let q=p+1;q<n;q++){
const apq=a[p][q];
if(apq===0)continue;
const theta=(a[q][q]-a[p][p])/(2*apq);
let t;
if(Math.abs(theta)>1e150)t=0.5/theta;
else t=(theta>=0?1:-1)/(Math.abs(theta)+Math.sqrt(theta*theta+1));
const c=1/Math.sqrt(t*t+1);
const s=t*c;
for(let k=0;k<n;k++){
const ak=a[k];
const akp=ak[p];
const akq=ak[q];
ak[p]=c*akp-s*akq;
ak[q]=s*akp+c*akq;
}
const ap=a[p];
const aq=a[q];
for(let k=0;k<n;k++){
const apk=ap[k];
const aqk=aq[k];
ap[k]=c*apk-s*aqk;
aq[k]=s*apk+c*aqk;
}
ap[q]=0;
aq[p]=0;
for(let k=0;k<n;k++){
const vk=V[k];
const vkp=vk[p];
const vkq=vk[q];
vk[p]=c*vkp-s*vkq;
vk[q]=s*vkp+c*vkq;
}
}
}
}
const order=Array.from({length:n},(_,i)=>i).sort((i,j)=>a[i][i]-a[j][j]);
const values=new Float64Array(n);
const vectors=[];
order.forEach((col,k)=>{
values[k]=a[col][col];
const v=new Float64Array(n);
for(let i=0;i<n;i++)v[i]=V[i][col];
vectors.push(v);
});
return{values,vectors,sweeps};
}










export function smallestSingularVector(A){
const G=gram(A);
const{values,vectors}=eigenSym(G);
const v=Float64Array.from(vectors[0]);
let imax=0;
for(let i=1;i<v.length;i++)if(Math.abs(v[i])>Math.abs(v[imax]))imax=i;
if(v[imax]<0)for(let i=0;i<v.length;i++)v[i]=-v[i];
return{
v,
sigma:Math.sqrt(Math.max(values[0],0)),
sigmaNext:values.length>1?Math.sqrt(Math.max(values[1],0)):NaN,
values,
};
}






export function hartleyNormalize(points){
const n=points.length;
if(n===0)throw new RangeError('hartleyNormalize: no points');
const dim=points[0].length;
const c=new Array(dim).fill(0);
for(const p of points)for(let i=0;i<dim;i++)c[i]+=p[i]/n;
let md=0;
for(const p of points){
let s=0;
for(let i=0;i<dim;i++)s+=(p[i]-c[i])**2;
md+=Math.sqrt(s)/n;
}
const scale=md>0?Math.sqrt(dim)/md:1;
const D=dim+1;
const T=new Array(D*D).fill(0);
for(let i=0;i<dim;i++){
T[i*D+i]=scale;
T[i*D+dim]=-scale*c[i];
}
T[D*D-1]=1;
const pts=points.map((p)=>Array.from({length:dim},(_,i)=>scale*(p[i]-c[i])));
return{T,pts,scale,centroid:c};
}




export function rodrigues(rvec){
const rx=rvec[0];
const ry=rvec[1];
const rz=rvec[2];
const th2=rx*rx+ry*ry+rz*rz;
const th=Math.sqrt(th2);
let A;
let B;
if(th<1e-8){
A=1-th2/6;
B=0.5-th2/24;
}else{
A=Math.sin(th)/th;
const h=Math.sin(0.5*th)/th;
B=2*h*h;
}

return[
1+B*(rx*rx-th2),-A*rz+B*rx*ry,A*ry+B*rx*rz,
A*rz+B*rx*ry,1+B*(ry*ry-th2),-A*rx+B*ry*rz,
-A*ry+B*rx*rz,A*rx+B*ry*rz,1+B*(rz*rz-th2),
];
}


export function rotAxisAngle(axis,angle){
const k=normalize3(axis);
return rodrigues([k[0]*angle,k[1]*angle,k[2]*angle]);
}


export function rvecFromR(R){
const w=[0.5*(R[7]-R[5]),0.5*(R[2]-R[6]),0.5*(R[3]-R[1])];
const s=norm3(w);
const c=0.5*(R[0]+R[4]+R[8]-1);
const th=Math.atan2(s,c);
if(c>0){

if(s===0)return[0,0,0];
const k=th/s;
return[w[0]*k,w[1]*k,w[2]*k];
}

const B=[
R[0]-c,0.5*(R[1]+R[3]),0.5*(R[2]+R[6]),
0.5*(R[1]+R[3]),R[4]-c,0.5*(R[5]+R[7]),
0.5*(R[2]+R[6]),0.5*(R[5]+R[7]),R[8]-c,
];
let i=0;
if(B[4]>B[0])i=1;
if(B[8]>B[4*i])i=2;
const den=Math.sqrt(B[4*i]*(1-c));
let k=[B[3*i]/den,B[3*i+1]/den,B[3*i+2]/den];
k=normalize3(k);
if(dot3(k,w)<0)k=[-k[0],-k[1],-k[2]];
return[k[0]*th,k[1]*th,k[2]*th];
}


export function quatFromR(R){
const tr=R[0]+R[4]+R[8];
let w;
let x;
let y;
let z;
if(tr>0){
const s=2*Math.sqrt(tr+1);
w=0.25*s;x=(R[7]-R[5])/s;y=(R[2]-R[6])/s;z=(R[3]-R[1])/s;
}else if(R[0]>R[4]&&R[0]>R[8]){
const s=2*Math.sqrt(1+R[0]-R[4]-R[8]);
w=(R[7]-R[5])/s;x=0.25*s;y=(R[1]+R[3])/s;z=(R[2]+R[6])/s;
}else if(R[4]>R[8]){
const s=2*Math.sqrt(1+R[4]-R[0]-R[8]);
w=(R[2]-R[6])/s;x=(R[1]+R[3])/s;y=0.25*s;z=(R[5]+R[7])/s;
}else{
const s=2*Math.sqrt(1+R[8]-R[0]-R[4]);
w=(R[3]-R[1])/s;x=(R[2]+R[6])/s;y=(R[5]+R[7])/s;z=0.25*s;
}
const n=Math.sqrt(w*w+x*x+y*y+z*z)*(w<0?-1:1);
return[w/n,x/n,y/n,z/n];
}


export function rFromQuat(q){
const n=Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]);
if(!(n>0))throw new RangeError('rFromQuat: zero quaternion');
const w=q[0]/n;
const x=q[1]/n;
const y=q[2]/n;
const z=q[3]/n;
return[
1-2*(y*y+z*z),2*(x*y-w*z),2*(x*z+w*y),
2*(x*y+w*z),1-2*(x*x+z*z),2*(y*z-w*x),
2*(x*z-w*y),2*(y*z+w*x),1-2*(x*x+y*y),
];
}






export function orthonormalize(M){
const N=[
[M[0]+M[4]+M[8],M[7]-M[5],M[2]-M[6],M[3]-M[1]],
[M[7]-M[5],M[0]-M[4]-M[8],M[1]+M[3],M[2]+M[6]],
[M[2]-M[6],M[1]+M[3],-M[0]+M[4]-M[8],M[5]+M[7]],
[M[3]-M[1],M[2]+M[6],M[5]+M[7],-M[0]-M[4]+M[8]],
];
const{vectors}=eigenSym(N);
return rFromQuat(vectors[3]);
}


export function isRotation(R,tol=1e-9){
const P=mat3Mul(R,mat3Transpose(R));
const I=mat3Identity();
for(let i=0;i<9;i++)if(!(Math.abs(P[i]-I[i])<=tol))return false;
return Math.abs(mat3Det(R)-1)<=tol;
}
