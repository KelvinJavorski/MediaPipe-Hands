// Som das cordas: AudioContext, cadeia de efeitos e os três timbres.
//
// Cadeia: vozes das cordas -> master -> duck (sidechain da batida) -> compressor
//         master -> delay no tempo (colcheia pontuada) e reverb -> duck
//         batida -> drums -> compressor (não é "abaixada" por ela mesma)
import {opt} from './state.js';

export let BPM = 112, BEAT = 60 / BPM;      // mudam com o estilo da batida (setTempo)
export let ac, master, duck, drums, noiseBuf, distCurve;
let delayNode;
const voices = [];          // vozes tocando: {s, end, set(f), kill(t)}
const MAX_VOICES = 10;
const bufCache = new Map();

// precisa ser chamado dentro de um gesto do usuário (exigência do iOS)
export function initAudio() {
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ac.createDynamicsCompressor(); comp.connect(ac.destination);
  duck = ac.createGain(); duck.connect(comp);
  drums = ac.createGain(); drums.gain.value = .55; drums.connect(comp);
  master = ac.createGain(); master.gain.value = .8; master.connect(duck);
  // delay com realimentação filtrada, sincronizado com a batida
  const dl = ac.createDelay(2), fb = ac.createGain(), lp = ac.createBiquadFilter(), wet = ac.createGain();
  dl.delayTime.value = BEAT * .75; fb.gain.value = .38; lp.type = 'lowpass'; lp.frequency.value = 2400; wet.gain.value = .3;
  master.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(duck);
  delayNode = dl;
  // curva de saturação (tanh) para os timbres dark e o baixo distorcido
  distCurve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; distCurve[i] = Math.tanh(x * 3.5) / Math.tanh(3.5); }
  // reverb: resposta ao impulso gerada (ruído com decaimento exponencial), sem arquivos
  const rv = ac.createConvolver(), rvWet = ac.createGain(), sr = ac.sampleRate, n = Math.round(sr * 2.4);
  const ir = ac.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3; }
  rv.buffer = ir; rvWet.gain.value = .28;
  master.connect(rv); rv.connect(rvWet); rvWet.connect(duck);
  noiseBuf = ac.createBuffer(1, sr, sr);
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < sr; i++) d[i] = Math.random() * 2 - 1; }
  const o = ac.createOscillator(), g = ac.createGain(); g.gain.value = 0; // "destrava" o áudio no iOS
  o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + .05);
}

// novo andamento: o delay continua em colcheia pontuada
export function setTempo(bpm) {
  BPM = bpm; BEAT = 60 / bpm;
  if (delayNode) delayNode.delayTime.setTargetAtTime(BEAT * .75, ac.currentTime, .05);
}

export const stopAt = (o, t) => { try { o.stop(t); } catch (e) {} };
export function shaper() {
  const sh = ac.createWaveShaper(); sh.curve = distCurve; sh.oversample = '2x'; return sh;
}

// reese: 2 serras bem desafinadas + sub, saturação, lowpass "respirando" com LFO (dark, estilo Rezz).
// Força = LFO mais rápido e mais fundo, mais volume e pitch bend.
function reeseVoice(f, vel, t, out) {
  const ratios = [1, 1, .5], oscs = ratios.map(() => ac.createOscillator());
  oscs[0].type = oscs[1].type = 'sawtooth'; oscs[2].type = 'sine';
  oscs[0].detune.value = -18; oscs[1].detune.value = 18;
  const pre = ac.createGain(), sub = ac.createGain(), sh = shaper(), flt = ac.createBiquadFilter(), amp = ac.createGain();
  pre.gain.value = .55; sub.gain.value = .9;
  oscs[0].connect(pre); oscs[1].connect(pre); oscs[2].connect(sub); sub.connect(pre);
  flt.type = 'lowpass'; flt.Q.value = 5; flt.frequency.value = f * 2.5 + 250;
  const lfo = ac.createOscillator(), depth = ac.createGain();
  lfo.frequency.value = 1.5 + 5 * vel; depth.gain.value = (f * 2.5 + 400) * (.5 + .5 * vel);
  lfo.connect(depth); depth.connect(flt.frequency);
  pre.connect(sh); sh.connect(flt); flt.connect(amp); amp.connect(out);
  const bend = 2 ** (2 * vel / 12), dur = 2.6 + vel;
  oscs.forEach((o, i) => {
    o.frequency.setValueAtTime(f * ratios[i] * bend, t);
    o.frequency.setTargetAtTime(f * ratios[i], t + .01, .1);
    o.start(t); stopAt(o, t + dur);
  });
  lfo.start(t); stopAt(lfo, t + dur);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(.13 + .15 * vel, t + .015);
  amp.gain.setTargetAtTime(0, t + .08, .5 + .4 * vel);
  return {end: t + dur,
    set(nf) { const n = ac.currentTime; oscs.forEach((o, i) => o.frequency.setTargetAtTime(nf * ratios[i], n, .03)); },
    kill(n) { oscs.forEach(o => stopAt(o, n + .1)); stopAt(lfo, n + .1); }};
}

// ácido: serra com filtro muito ressonante que varre de cima para baixo + saturação (303, psicodélico)
function acidVoice(f, vel, t, out) {
  const o = ac.createOscillator(), flt = ac.createBiquadFilter(), sh = shaper(), amp = ac.createGain();
  o.type = 'sawtooth';
  flt.type = 'lowpass'; flt.Q.value = 14 + 8 * vel;
  o.connect(flt); flt.connect(sh); sh.connect(amp); amp.connect(out);
  const bend = 2 ** (3 * vel / 12), dur = 1.6;
  o.frequency.setValueAtTime(f * bend, t); o.frequency.setTargetAtTime(f, t + .01, .05);
  flt.frequency.setValueAtTime(Math.min(12000, f * (5 + 25 * vel)), t);
  flt.frequency.setTargetAtTime(f * 1.3 + 100, t + .005, .1 + .15 * vel);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(.17 + .2 * vel, t + .004);
  amp.gain.setTargetAtTime(0, t + .03, .22 + .2 * vel);
  o.start(t); stopAt(o, t + dur);
  return {end: t + dur,
    set(nf) { o.frequency.setTargetAtTime(nf, ac.currentTime, .03); },
    kill(n) { stopAt(o, n + .1); }};
}

// synth: 2 serras desafinadas + sub quadrada, filtro ressonante com envelope.
// Batida forte = tom começa mais alto e "volta" (corda esticada), filtro mais aberto, mais volume.
function synthVoice(f, vel, t, out) {
  const ratios = [1, 1, .5], oscs = ratios.map(() => ac.createOscillator());
  oscs[0].type = oscs[1].type = 'sawtooth'; oscs[2].type = 'square';
  oscs[0].detune.value = -9; oscs[1].detune.value = 9;
  const flt = ac.createBiquadFilter(), amp = ac.createGain(), sub = ac.createGain();
  flt.type = 'lowpass'; flt.Q.value = 6 + 6 * vel; sub.gain.value = .35;
  oscs[0].connect(flt); oscs[1].connect(flt); oscs[2].connect(sub); sub.connect(flt);
  flt.connect(amp); amp.connect(out);
  const bend = 2 ** (2 * vel / 12), dur = 1.8 + vel;
  oscs.forEach((o, i) => {
    o.frequency.setValueAtTime(f * ratios[i] * bend, t);
    o.frequency.setTargetAtTime(f * ratios[i], t + .01, .08);
    o.start(t); stopAt(o, t + dur);
  });
  flt.frequency.setValueAtTime(Math.min(16000, f * (3 + 14 * vel)), t);
  flt.frequency.setTargetAtTime(f * 1.2 + 150, t + .01, .18 + .25 * vel);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(.12 + .22 * vel, t + .006);
  amp.gain.setTargetAtTime(0, t + .02, .25 + .35 * vel);
  return {end: t + dur,
    set(nf) { const n = ac.currentTime; oscs.forEach((o, i) => o.frequency.setTargetAtTime(nf * ratios[i], n, .03)); },
    kill(n) { oscs.forEach(o => stopAt(o, n + .1)); }};
}

// sino: síntese FM (modulador em razão não inteira dá o brilho metálico); força = mais harmônicos
function bellVoice(f, vel, t, out) {
  const car = ac.createOscillator(), mod = ac.createOscillator(), idx = ac.createGain(), amp = ac.createGain();
  const ratio = 3.5, bend = 2 ** (vel / 12), dur = 3 + vel;
  car.frequency.setValueAtTime(f * bend, t); car.frequency.setTargetAtTime(f, t + .01, .06);
  mod.frequency.setValueAtTime(f * ratio * bend, t); mod.frequency.setTargetAtTime(f * ratio, t + .01, .06);
  idx.gain.setValueAtTime(f * (1.5 + 5 * vel), t); idx.gain.setTargetAtTime(f * .3, t + .005, .25);
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(.2 + .25 * vel, t + .004);
  amp.gain.setTargetAtTime(0, t + .01, .6 + .4 * vel);
  mod.connect(idx); idx.connect(car.frequency); car.connect(amp); amp.connect(out);
  car.start(t); mod.start(t); stopAt(car, t + dur); stopAt(mod, t + dur);
  return {end: t + dur,
    set(nf) { const n = ac.currentTime; car.frequency.setTargetAtTime(nf, n, .03); mod.frequency.setTargetAtTime(nf * ratio, n, .03); },
    kill(n) { stopAt(car, n + .1); stopAt(mod, n + .1); }};
}

// harpa: Karplus-Strong (buffer cacheado), com glide via playbackRate
function pluckBuffer(f) {
  const key = Math.round(f * 10);
  if (bufCache.has(key)) return bufCache.get(key);
  const sr = ac.sampleRate, N = Math.max(2, Math.round(sr / f)), len = Math.round(sr * 2.5);
  const buf = ac.createBuffer(1, len, sr), d = buf.getChannelData(0), ring = new Float32Array(N);
  for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
  for (let i = 0, p = 0; i < len; i++) {
    const n = (p + 1) % N, v = ring[p];
    d[i] = v; ring[p] = .996 * .5 * (v + ring[n]); p = n;
  }
  bufCache.set(key, buf); return buf;
}
function pluckVoice(f, vel, t, out) {
  const src = ac.createBufferSource(), g = ac.createGain();
  src.buffer = pluckBuffer(f); g.gain.value = .25 + .5 * vel;
  src.connect(g); g.connect(out);
  src.playbackRate.setValueAtTime(2 ** (vel / 12), t);
  src.playbackRate.setTargetAtTime(1, t + .01, .06);
  src.start(t);
  return {end: t + 2.5,
    set(nf) { src.playbackRate.setTargetAtTime(nf / f, ac.currentTime, .03); },
    kill(n) { stopAt(src, n + .1); }};
}

// mesma ordem de TIMBRES em state.js
const VOICES = [synthVoice, reeseVoice, acidVoice, bellVoice, pluckVoice];

// toca a corda s: vel 0..1 (força do dedo), pan -1..1 (posição X)
export function playString(s, vel, pan) {
  if (!opt.sound || !ac) return;
  if (ac.state !== 'running') ac.resume();
  const t = ac.currentTime, out = ac.createGain();
  let node = out;
  if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; out.connect(p); node = p; }
  node.connect(master);
  const v = VOICES[opt.timbre](s.f, vel, t, out);
  v.s = s; v.out = out; voices.push(v);
  for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < t) voices.splice(i, 1);
  while (voices.length > MAX_VOICES) { const o = voices.shift(); o.out.gain.setTargetAtTime(0, t, .015); o.kill(t); }
}

// a corda mudou de nota (comprimento ajustado): as vozes que estão soando deslizam para a nova nota
export function retune(s) { for (const v of voices) if (v.s === s) v.set(s.f); }
