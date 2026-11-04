// Physical and device constants shared by all modules (interfaces.md §3). SI units.

export const G = 9.80665; // m/s², gravity acts along -z of the mat frame M
export const BALL_D = 0.04267; // m, ball diameter (rules minimum)
export const BALL_R = 0.021335; // m, ball radius
export const BALL_MASS = 0.04593; // kg (rules maximum)
export const AIR_RHO = 1.204; // kg/m³ at 20 °C, sea level
export const IPHONE_HFOV_1080P240_DEG = 68.161; // horizontal FOV across the long image side, 1x lens, 1080p240
export const DEFAULT_READOUT_MS = 3.0; // rolling-shutter readout until measured (ROLLING_SHUTTER_ASSUMED)
export const TEE_LIFT_PRIOR_M = 0.030; // m, ball bottom above mat when teed and not measured
export const TEE_LIFT_PRIOR_SIGMA_M = 0.015;

// Angle helpers (degrees only at report/UI boundaries).
export const DEG = Math.PI / 180; // degrees -> radians: x_deg * DEG
export const RAD2DEG = 180 / Math.PI; // radians -> degrees: x_rad * RAD2DEG

export const VIEWS = Object.freeze(['face_on', 'dtl', 'high_behind']);

// Frame-rate thresholds: NTSC-style rates (29.97, 59.94, 119.88, 239.76) count as their nominal rate.
export const FPS_TOLERANCE = 0.01;
/** fps meets a nominal threshold (allows 1 % below it). */
export const fpsAtLeast = (fps, min) => fps * (1 + FPS_TOLERANCE) >= min;
