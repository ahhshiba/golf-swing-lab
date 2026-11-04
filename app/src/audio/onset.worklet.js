// audio/onset.worklet.js - impact-sound onset detector running in the AudioWorklet (CAFCR P4 IMPACT, R1 audio row).
// Self-contained (no imports): AudioWorkletGlobalScope module support for imports is not relied upon.
//
// Exported for Node tests (the worklet scope ignores the exports):
//   ONSET_DEFAULTS
//   class OnsetCore({ sampleRate, hop = 128, refractory_s = 0.3, thresh_db = 12, rise_db = 6, floor_db = -70,
//                     bg_tau_s = 0.6, preemph = 0.97, supersede_db = 12 })
//     .push(Float32Array block, startFrame) -> [{ frame, level_db }]   frame = absolute sample index of the onset
// Method: pre-emphasised (high-passed) signal, per-hop log energy; an onset is a hop whose log energy is
// >= thresh_db above a slow background and >= rise_db above the previous hop (positive spectral-flux proxy), outside
// the refractory period - unless it is >= supersede_db louder (above background) than the onset that started the
// refractory period: a swing's whoosh rises 0.1-0.2 s before the impact click and must not mask it. The onset sample is refined to the first sample of the previous+current hop whose
// |x| reaches half of the hop peak, so the timestamp is sample-accurate rather than hop-accurate.
// The processor posts { type: 'onset', t_ctx: frame / sampleRate, level_db } (AudioContext time, seconds).

export const ONSET_DEFAULTS = Object.freeze({
  hop: 128, refractory_s: 0.3, thresh_db: 12, rise_db: 6, floor_db: -70, bg_tau_s: 0.6, preemph: 0.97, supersede_db: 12,
});

export class OnsetCore {
  constructor(opts = {}) {
    const o = { ...ONSET_DEFAULTS, ...opts };
    if (!(o.sampleRate > 0)) throw new RangeError('OnsetCore: sampleRate required');
    this.o = o;
    this.sr = o.sampleRate;
    this.hop = o.hop;
    this.buf = new Float32Array(o.hop);
    this.prevHop = new Float32Array(o.hop);
    this.fill = 0;
    this.hopStart = 0; // absolute frame of buf[0]
    this.prevX = 0;
    this.prevLog = null;
    this.bg = null;
    this.lastOnset = -Infinity;
    this.lastLevel = -Infinity;
    this.alpha = 1 - Math.exp(-o.hop / (o.bg_tau_s * o.sampleRate));
  }

  push(block, startFrame) {
    const out = [];
    let frame = startFrame;
    for (let i = 0; i < block.length; i++, frame++) {
      if (this.fill === 0) this.hopStart = frame;
      const x = block[i];
      this.buf[this.fill++] = x - this.o.preemph * this.prevX;
      this.prevX = x;
      if (this.fill === this.hop) {
        const ev = this._hop();
        if (ev) out.push(ev);
        this.fill = 0;
      }
    }
    return out;
  }

  _hop() {
    const b = this.buf;
    let e = 0;
    let peak = 0;
    for (let i = 0; i < b.length; i++) { e += b[i] * b[i]; const a = Math.abs(b[i]); if (a > peak) peak = a; }
    const logE = 10 * Math.log10(e / b.length + 1e-14);
    let ev = null;
    // digital silence (a mic / fake device that is still starting delivers zeros) must not seed the background:
    // from a -140 dB background every noise hop is "above" and the slow loud-hop adaptation never catches up
    if (logE < this.o.floor_db) { this.prevLog = logE; this.prevHop.set(b); return null; }
    if (this.bg === null) this.bg = logE;
    const above = logE - this.bg;
    const rise = this.prevLog === null ? 0 : logE - this.prevLog;
    const tHop = this.hopStart / this.sr;
    if (above >= this.o.thresh_db && rise >= this.o.rise_db && logE >= this.o.floor_db &&
        (tHop - this.lastOnset >= this.o.refractory_s || above >= this.lastLevel + this.o.supersede_db)) {
      // refine: first sample in [previous hop, this hop] reaching half of this hop's peak
      const bgAmp = Math.sqrt(Math.pow(10, this.bg / 10));
      const half = Math.max(0.5 * peak, 3 * bgAmp);
      let k = -1;
      for (let i = 0; i < this.prevHop.length; i++) if (Math.abs(this.prevHop[i]) >= half) { k = i - this.hop; break; }
      if (k === -1) for (let i = 0; i < b.length; i++) if (Math.abs(b[i]) >= half) { k = i; break; }
      const f = this.hopStart + Math.max(-this.hop, k);
      const t = f / this.sr;
      if (t - this.lastOnset >= this.o.refractory_s || above >= this.lastLevel + this.o.supersede_db) {
        this.lastOnset = t;
        this.lastLevel = above;
        ev = { frame: f, level_db: above };
      }
    }
    // background adapts slowly, and not on loud hops (so a clap does not lift it)
    if (above < this.o.thresh_db) this.bg += this.alpha * (logE - this.bg);
    else this.bg += this.alpha * 0.05 * (logE - this.bg);
    this.prevLog = logE;
    this.prevHop.set(b);
    return ev;
  }
}

if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
  class GslOnsetProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const po = (options && options.processorOptions) || {};
      this.core = new OnsetCore({ ...po, sampleRate }); // eslint-disable-line no-undef
      this.alive = true;
      this.port.onmessage = (ev) => { if (ev.data && ev.data.type === 'stop') this.alive = false; };
    }

    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      if (ch && ch.length) {
        const evs = this.core.push(ch, currentFrame); // eslint-disable-line no-undef
        for (const e of evs) this.port.postMessage({ type: 'onset', t_ctx: e.frame / sampleRate, level_db: e.level_db }); // eslint-disable-line no-undef
      }
      return this.alive;
    }
  }
  registerProcessor('gsl-onset', GslOnsetProcessor);
}
