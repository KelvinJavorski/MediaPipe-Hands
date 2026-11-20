// Som das cordas: AudioContext, cadeia de efeitos e os timbres.
//
// Cadeia: vozes das cordas -> master -> fx (pedal wah do rosto) -> duck (sidechain da batida) -> compressor
//         fx -> delay no tempo (colcheia pontuada) e reverb -> duck
//         batida -> drums -> compressor (não é "abaixada" por ela mesma)
//         tambores de luz -> padBus -> compressor
import {opt} from './state.js';

export let BPM = 112, BEAT = 60 / BPM;      // mudam com o estilo da batida (setTempo)
export let ac, master, duck, drums, padBus, noiseBuf, distCurve;
export const DRUMS_GAIN = .42;              // volume base da batida (cada estilo multiplica por style.vol)
let delayNode, comp, fx;
let globalMul = 1;          // pitch bend global (cabeça inclinada), multiplica todas as vozes
const voices = [];          // vozes tocando: {s, base (freq sem o bend global), end, set(f), kill(t)}
const MAX_VOICES = 10;

// precisa ser chamado dentro de um gesto do usuário (exigência do iOS)
export function initAudio() {
  ac = new (window.AudioContext || window.webkitAudioContext)();
  comp = ac.createDynamicsCompressor(); comp.connect(ac.destination);
  duck = ac.createGain(); duck.connect(comp);
  // mistura: as cordas são o instrumento principal e devem ficar acima da batida (medido: corda/batida ≥ ~1,2)
  drums = ac.createGain(); drums.gain.value = DRUMS_GAIN; drums.connect(comp);
  master = ac.createGain(); master.gain.value = 1;
  // pedal: filtro passa-baixas; desligado fica aberto em 20 kHz (transparente), o wah o move com a boca
  fx = ac.createBiquadFilter(); fx.type = 'lowpass'; fx.frequency.value = 20000; fx.Q.value = .7;
  master.connect(fx); fx.connect(duck);
  padBus = ac.createGain(); padBus.gain.value = .9; padBus.connect(comp);
  // delay com realimentação filtrada, sincronizado com a batida
  const dl = ac.createDelay(2), fb = ac.createGain(), lp = ac.createBiquadFilter(), wet = ac.createGain();
  dl.delayTime.value = BEAT * .75; fb.gain.value = .28; lp.type = 'lowpass'; lp.frequency.value = 1800; wet.gain.value = .18;   // eco discreto: com mais, as notas embolavam
  fx.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(duck);
  delayNode = dl;
  // curva de saturação (tanh) para os timbres dark e o baixo distorcido
  distCurve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; distCurve[i] = Math.tanh(x * 3.5) / Math.tanh(3.5); }
  // reverb: resposta ao impulso gerada (ruído com decaimento exponencial), sem arquivos
  const rv = ac.createConvolver(), rvWet = ac.createGain(), sr = ac.sampleRate, n = Math.round(sr * 1.6);   // IR curta: convolução custa CPU de áudio a cada amostra
  const ir = ac.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3; }
  rv.buffer = ir; rvWet.gain.value = .3;
  fx.connect(rv); rv.connect(rvWet); rvWet.connect(duck);
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
export function shaper(oversample = '2x') {
  const sh = ac.createWaveShaper(); sh.curve = distCurve; sh.oversample = oversample; return sh;
}

// ---------- timbres ----------
// Regra geral: a nota começa CERTA (antes ela começava mais alta e escorregava, o que soava desafinado);
// a força do toque (vel) muda volume, brilho e duração. Filtros com pouca ressonância (som "redondo").
const osc = (type, f, t, detune = 0) => { const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune; return o; };

// pluck: dedilhado eletrônico macio (3 serras levemente desafinadas + filtro que fecha rápido)
function pluckSynthVoice(f, vel, t, out) {
  const oscs = [osc('sawtooth', f, t, -8), osc('sawtooth', f, t, 8), osc('triangle', f / 2, t)];
  const mix = ac.createGain(), sub = ac.createGain(), flt = ac.createBiquadFilter(), amp = ac.createGain();
  mix.gain.value = .5; sub.gain.value = .6;
  oscs[0].connect(mix); oscs[1].connect(mix); oscs[2].connect(sub); sub.connect(mix);
  flt.type = 'lowpass'; flt.Q.value = 1.2;
  flt.frequency.setValueAtTime(Math.min(12000, f * (6 + 10 * vel)), t);
  flt.frequency.setTargetAtTime(f * 1.5 + 300, t + .005, .09 + .1 * vel);
  mix.connect(flt); flt.connect(amp); amp.connect(out);
  const dur = 1.6 + vel;
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(.29 + .29 * vel, t + .004);
  amp.gain.setTargetAtTime(0, t + .01, .28 + .3 * vel);
  oscs.forEach(o => { o.start(t); stopAt(o, t + dur); });
  return {end: t + dur,
    set(nf) { const n = ac.currentTime; oscs[0].frequency.setTargetAtTime(nf, n, .03); oscs[1].frequency.setTargetAtTime(nf, n, .03); oscs[2].frequency.setTargetAtTime(nf / 2, n, .03); },
    kill(n) { oscs.forEach(o => stopAt(o, n + .1)); }};
}

// teclado: piano elétrico por FM (modulador na mesma frequência = som quente; um "tine" agudo no ataque)
function keysVoice(f, vel, t, out) {
  const car = osc('sine', f, t), mod = osc('sine', f, t), idx = ac.createGain();
  const tine = osc('sine', f * 4, t), tg = ac.createGain(), amp = ac.createGain();
  idx.gain.setValueAtTime(f * (.8 + 1.6 * vel), t); idx.gain.setTargetAtTime(f * .15, t + .005, .35);
  mod.connect(idx); idx.connect(car.frequency);
  tg.gain.setValueAtTime(.08 + .12 * vel, t); tg.gain.setTargetAtTime(0, t + .003, .05);
  car.connect(amp); tine.connect(tg); tg.connect(amp); amp.connect(out);
  const dur = 2.6 + vel;
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(.17 + .14 * vel, t + .006);
  amp.gain.setTargetAtTime(0, t + .02, .7 + .5 * vel);
  [car, mod, tine].forEach(o => { o.start(t); stopAt(o, t + dur); });
  return {end: t + dur,
    set(nf) { const n = ac.currentTime; car.frequency.setTargetAtTime(nf, n, .03); mod.frequency.setTargetAtTime(nf, n, .03); tine.frequency.setTargetAtTime(nf * 4, n, .03); },
    kill(n) { [car, mod, tine].forEach(o => stopAt(o, n + .1)); }};
}

// marimba: fundamental + parciais de barra de madeira (4× e 10×) que somem rápido
function marimbaVoice(f, vel, t, out) {
  const parts = [[1, .5, .45 + .2 * vel], [4, .18 + .12 * vel, .07], [10, .05 + .06 * vel, .02]];
  const amp = ac.createGain(), oscs = [];
  for (const [r, g, tau] of parts) {
    const o = osc('sine', f * r, t), pg = ac.createGain();
    pg.gain.setValueAtTime(0, t); pg.gain.linearRampToValueAtTime(g, t + .002); pg.gain.setTargetAtTime(0, t + .004, tau);
    o.connect(pg); pg.connect(amp); oscs.push([o, r]);
  }
  amp.gain.value = .32 + .2 * vel; amp.connect(out);
  const dur = 2;
  oscs.forEach(([o]) => { o.start(t); stopAt(o, t + dur); });
  return {end: t + dur,
    set(nf) { const n = ac.currentTime; oscs.forEach(([o, r]) => o.frequency.setTargetAtTime(nf * r, n, .03)); },
    kill(n) { oscs.forEach(([o]) => stopAt(o, n + .1)); }};
}

// sino: síntese FM (modulador em razão não inteira dá o brilho metálico); força = mais harmônicos
function bellVoice(f, vel, t, out) {
  const ratio = 3.5, car = osc('sine', f, t), mod = osc('sine', f * ratio, t), idx = ac.createGain(), amp = ac.createGain();
  idx.gain.setValueAtTime(f * (1.2 + 3.5 * vel), t); idx.gain.setTargetAtTime(f * .25, t + .005, .25);
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(.12 + .14 * vel, t + .004);
  amp.gain.setTargetAtTime(0, t + .01, .6 + .4 * vel);
  mod.connect(idx); idx.connect(car.frequency); car.connect(amp); amp.connect(out);
  const dur = 3 + vel;
  car.start(t); mod.start(t); stopAt(car, t + dur); stopAt(mod, t + dur);
  return {end: t + dur,
    set(nf) { const n = ac.currentTime; car.frequency.setTargetAtTime(nf, n, .03); mod.frequency.setTargetAtTime(nf * ratio, n, .03); },
    kill(n) { stopAt(car, n + .1); stopAt(mod, n + .1); }};
}

// reese: 2 serras bem desafinadas + sub, saturação, lowpass "respirando" com LFO (dark, estilo Rezz).
// Força = LFO mais rápido e mais fundo, mais volume.
function reeseVoice(f, vel, t, out) {
  const ratios = [1, 1, .5], oscs = [osc('sawtooth', f, t, -18), osc('sawtooth', f, t, 18), osc('sine', f / 2, t)];
  const pre = ac.createGain(), sub = ac.createGain(), sh = shaper(), flt = ac.createBiquadFilter(), amp = ac.createGain();
  pre.gain.value = .55; sub.gain.value = .9;
  oscs[0].connect(pre); oscs[1].connect(pre); oscs[2].connect(sub); sub.connect(pre);
  flt.type = 'lowpass'; flt.Q.value = 3; flt.frequency.value = f * 2.5 + 250;
  const lfo = ac.createOscillator(), depth = ac.createGain();
  lfo.frequency.value = 1.5 + 4 * vel; depth.gain.value = (f * 2.5 + 400) * (.5 + .5 * vel);
  lfo.connect(depth); depth.connect(flt.frequency);
  pre.connect(sh); sh.connect(flt); flt.connect(amp); amp.connect(out);
  const dur = 2.6 + vel;
  oscs.forEach(o => { o.start(t); stopAt(o, t + dur); });
  lfo.start(t); stopAt(lfo, t + dur);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(.13 + .15 * vel, t + .015);
  amp.gain.setTargetAtTime(0, t + .08, .5 + .4 * vel);
  return {end: t + dur,
    set(nf) { const n = ac.currentTime; oscs.forEach((o, i) => o.frequency.setTargetAtTime(nf * ratios[i], n, .03)); },
    kill(n) { oscs.forEach(o => stopAt(o, n + .1)); stopAt(lfo, n + .1); }};
}

// ácido: serra com filtro ressonante que varre de cima para baixo + saturação (303, psicodélico)
function acidVoice(f, vel, t, out) {
  const o = osc('sawtooth', f, t), flt = ac.createBiquadFilter(), sh = shaper(), amp = ac.createGain();
  flt.type = 'lowpass'; flt.Q.value = 9 + 5 * vel;
  o.connect(flt); flt.connect(sh); sh.connect(amp); amp.connect(out);
  const dur = 1.6;
  flt.frequency.setValueAtTime(Math.min(10000, f * (4 + 18 * vel)), t);
  flt.frequency.setTargetAtTime(f * 1.3 + 100, t + .005, .1 + .15 * vel);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(.135 + .16 * vel, t + .004);
  amp.gain.setTargetAtTime(0, t + .03, .22 + .2 * vel);
  o.start(t); stopAt(o, t + dur);
  return {end: t + dur,
    set(nf) { o.frequency.setTargetAtTime(nf, ac.currentTime, .03); },
    kill(n) { stopAt(o, n + .1); }};
}

const VOICES = [pluckSynthVoice, keysVoice, marimbaVoice, bellVoice, reeseVoice, acidVoice];

// frequência atual da corda: nota do comprimento × bend (pinça puxando o meio da corda)
export const curFreq = s => s.f * (s.bendMul || 1);

// Harmonizador (a batida instala um quando está ligada): (freq, t) -> nota do acorde do momento.
// Fica aqui como "gancho" para audio.js não depender de beat.js (beat.js já importa audio.js).
let harmonizer = null;
export function setHarmonizer(fn) { harmonizer = fn; }
// nota de verdade que soa: a nota da corda puxada para o acorde (se houver batida) × bend
const soundFreq = (base, mul, t) => (harmonizer ? harmonizer(base, t) : base) * mul;

// toca a corda s: vel 0..1 (força do dedo), pan -1..1 (posição X).
// when = horário no relógio do áudio (looper agenda à frente; toque no ritmo espera a semicolcheia);
// freq = frequência fixa (nota gravada no loop; não acompanha mudanças da corda).
export function playString(s, vel, pan, when, freq) {
  if (!opt.sound || !ac) return;
  if (ac.state !== 'running') ac.resume();
  const now = ac.currentTime, t = Math.max(now, when ?? now), out = ac.createGain();
  let node = out;
  if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; out.connect(p); node = p; }
  node.connect(master);
  const f = freq ? soundFreq(freq, 1, t) : soundFreq(s.f, s.bendMul || 1, t);
  const v = VOICES[opt.timbre](f * globalMul, vel, t, out);
  v.s = freq ? null : s; v.base = f;
  v.out = out; voices.push(v);
  for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < now) voices.splice(i, 1);
  while (voices.length > MAX_VOICES) { const o = voices.shift(); o.out.gain.setTargetAtTime(0, now, .015); o.kill(now); }
}

// a corda mudou de nota (comprimento ou bend): as vozes que estão soando deslizam para a nova nota
export function retune(s) {
  const f = soundFreq(s.f, s.bendMul || 1, ac ? ac.currentTime : 0);
  for (const v of voices) if (v.s === s) { v.base = f; v.set(f * globalMul); }
}

// Pedal wah (boca): x = 0..1 (fechada..aberta) move o filtro de ~350 Hz a ~3,5 kHz; null desliga (filtro aberto)
export function setWah(x) {
  if (!fx) return;
  const t = ac.currentTime;
  if (x === null) { fx.frequency.setTargetAtTime(20000, t, .08); fx.Q.setTargetAtTime(.7, t, .08); return; }
  fx.frequency.setTargetAtTime(350 * 2 ** (Math.max(0, Math.min(1, x)) * 3.3), t, .03);
  fx.Q.setTargetAtTime(5, t, .05);
}

// Pitch bend global (cabeça inclinada): todas as vozes soando e as próximas sobem/descem 'semis' semitons
export function setGlobalBend(semis) {
  const m = 2 ** (semis / 12);
  if (Math.abs(m - globalMul) < .001) return;
  globalMul = m;
  for (const v of voices) if (v.base) v.set(v.base * globalMul);
}

// som final (depois do compressor) como MediaStream, para gravar vídeo com áudio
let recDest = null;
export function audioStream() {
  if (!ac || !ac.createMediaStreamDestination) return null;
  if (!recDest) { recDest = ac.createMediaStreamDestination(); comp.connect(recDest); }
  return recDest.stream;
}
