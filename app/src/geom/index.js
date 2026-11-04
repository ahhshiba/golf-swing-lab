// geom — shared geometry / math base (pure; no globals, no randomness except a passed-in seeded rng).
//
// API summary (signatures only; frames and conventions in docs/interfaces.md §2, §3, §6):
//
// constants.js
//   G, BALL_D, BALL_R, BALL_MASS, AIR_RHO, IPHONE_HFOV_1080P240_DEG, DEFAULT_READOUT_MS,
//   TEE_LIFT_PRIOR_M, TEE_LIFT_PRIOR_SIGMA_M, DEG, RAD2DEG, VIEWS
// rng.js
//   mulberry32(seed) -> () => number in [0,1)      gauss(rng, mean = 0, sd = 1) -> number
//   uniform(rng, lo = 0, hi = 1) -> number
// stats.js   (x: Array | Float64Array; empty or NaN-containing input -> NaN)
//   sum(x)  mean(x)  variance(x, ddof = 1)  std(x, ddof = 1)  median(x)  mad(x, scale = 1)
//   percentile(x, p /* 0..100, linear */)  quantile(x, q /* 0..1 */)  rmse(a, b?)  MAD_TO_SIGMA
// linalg.js  (vec3 = [3]; mat3 / R = row-major [9]; general matrix = array of rows)
//   add3 sub3 scale3 dot3 cross3 norm3 dist3 normalize3
//   mat3Identity() mat3Mul(A,B) mat3MulVec(A,v) mat3TMulVec(A,v) mat3Transpose(A) mat3Det(A)
//   mat3Inverse(A) -> [9] | null
//   zeros(m,n) identity(n) transpose(A) matMul(A,B) matVec(A,x) gram(A) /* AᵀA */ gramVec(A,r) /* Aᵀr */
//   luDecompose(A) -> {LU, perm, sign, n} | null   luSolve(lu, b)   det(A)
//   solve(A, b) -> Float64Array | null   inverse(A) -> rows | null   inverseSPD(A) -> rows | null
//   cholesky(A) -> L rows | null   choleskySolve(L, b) -> Float64Array
//   eigenSym(A, {maxSweeps}) -> { values: Float64Array ascending, vectors: Float64Array[], sweeps }
//   smallestSingularVector(A) -> { v, sigma, sigmaNext, values }
//   hartleyNormalize(points) -> { T /* (d+1)² row-major */, pts, scale, centroid }
//   rodrigues(rvec) -> R   rvecFromR(R) -> rvec   rotAxisAngle(axis, angle) -> R
//   quatFromR(R) -> [w,x,y,z]   rFromQuat(q) -> R   orthonormalize(M) -> R   isRotation(R, tol = 1e-9)
// lm.js
//   lm({ residual(theta) -> Float64Array | number[] | null, theta0, jacobian?(theta), diff = 'central',
//        step?, relStep?, maxIter = 100, lambda0 = 1e-3, tol = 1e-12, gtol = 1e-10, lambdaMax = 1e16 })
//     -> { theta, cost /* Σr² */, iterations, converged, reason, cov /* = covScaled */, covScaled, covRaw,
//          dof, reducedChi2, J, r, nEval, badColumns }
//   numericJacobian(residual, theta, { r0?, diff?, step?, relStep? }) -> { J, nEval, badColumns }
// camera.js  (camera = { W, H, f, cx, cy, k1, R, t, readout: { ms, axis, dir } })
//   makeCamera({ W, H, f | hfovDeg, k1?, R?, t | C, readout? }) -> camera
//   project(cam, X) -> { u, v, z }   projectMany(cam, pts) -> { uv: Float64Array(2N), z: Float64Array(N) }
//   ray(cam, u, v) -> { C, d }   center(cam) -> C   toCamera(cam, X) -> Xc
//   pixelToNormalized(cam, u, v) -> [x, y]   distortNormalized(k1, x, y)   undistortNormalized(k1, xd, yd)
//   intersectRayZ({ C, d }, z0 = 0) -> X | null
//   lookAt(C, target, up = [0,0,1], rollRad = 0) -> { R, t }
//   fFromHfov(W, hfovDeg) -> f   hfovFromF(W, f) -> deg
//   rFromEuler({ yaw, pitch, roll } /* rad */, view) -> R      rFromEuler(e, view, C) -> { R, t }
//   eulerFromR(R | cam, view) -> { yaw, pitch, roll } /* rad */
//   poseReport(cam, view) -> { yaw_deg, pitch_deg, roll_deg, X_m, Y_m, h_m, D_m }
//   nominalCamera(view, opts?) -> camera     VIEW_HEADING, NOMINAL_GEOMETRY

export * from './constants.js';
export * from './rng.js';
export * from './stats.js';
export * from './linalg.js';
export * from './lm.js';
export * from './camera.js';
