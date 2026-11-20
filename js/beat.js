// Batida: bateria e baixo sintetizados, sequenciador de 16 passos, 3 estilos.
// O agendamento roda num setInterval próprio, ~120 ms à frente no relógio do áudio,
// independente do requestAnimationFrame (não atrasa se o desenho travar).
// Cada estilo define andamento, escala das cordas e padrões.
import {ac, duck, drums, noiseBuf, BEAT, setTempo, shaper} from './audio.js';
import {setScale} from './strings.js';
import {opt} from './state.js';

// padrões: 'x' = toca, 'o' = toca mais forte/aberto (chimbal aberto), '.' = pausa
// bass: MIDI por passo (0 = pausa); bassType: 'pluck' curto e limpo | 'reese' distorcido e com LFO
export const STYLES = [
  {name: 'House', bpm: 112, scale: 'maior', bassType: 'pluck', duck: .5,
    kick: 'x...x...x...x...', clap: '....x.......x...', hat: '..x...x...x...x.', tick: 'x.x.x.x.x.x.x.x.',
    bass: [36, 0, 0, 36, 0, 0, 43, 0, 36, 0, 0, 38, 0, 0, 31, 0]},
  // lento e hipnótico, meio-tempo, baixo distorcido em Dó menor (inspirado em Rezz)
  {name: 'Rezz', bpm: 100, scale: 'menor', bassType: 'reese', duck: .35,
    kick: 'x.........x.....', clap: '........x.......', hat: '....x.......x..x', tick: '..x...x...x...x.',
    bass: [36, 0, 0, 36, 0, 0, 39, 0, 0, 36, 0, 0, 34, 0, 41, 0]},
  // techno escuro: bumbo reto, chimbal aberto no contratempo, baixo rolando entre os bumbos
  {name: 'Techno', bpm: 126, scale: 'menor', bassType: 'pluck', duck: .45,
    kick: 'x...x...x...x...', clap: '....x.......x...', hat: '..o...o...o...o.', tick: 'xxxxxxxxxxxxxxxx',
    bass: [0, 36, 36, 0, 0, 36, 36, 0, 0, 36, 39, 0, 0, 36, 34, 0]},
];
let style = STYLES[0];
let beatStep = 0, beatNext = 0, beatTimer = null;
const kickTimes = [];       // horários (tempo do áudio) dos bumbos agendados, para o pulso visual
let lastKick = -9;

function noise(t, dur, type, freq, gain, q = 1) {
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  s.connect(f); f.connect(g); g.connect(drums); s.start(t); s.stop(t + dur + .02);
}
function kick(t, heavy) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.setValueAtTime(heavy ? 120 : 150, t); o.frequency.exponentialRampToValueAtTime(heavy ? 36 : 42, t + .12);
  g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(.001, t + (heavy ? .6 : .4));
  o.connect(g);
  if (heavy) { const sh = shaper(); g.connect(sh); sh.connect(drums); } else g.connect(drums);
  o.start(t); o.stop(t + .65);
  // sidechain: as cordas "respiram" com o bumbo
  duck.gain.setValueAtTime(1, t); duck.gain.linearRampToValueAtTime(style.duck, t + .01); duck.gain.setTargetAtTime(1, t + .03, .09);
  kickTimes.push(t);
}
function bass(t, midi) {
  const f = 440 * 2 ** ((midi - 69) / 12), lp = ac.createBiquadFilter(), g = ac.createGain();
  if (style.bassType === 'reese') {
    // dois serras desafinadas + saturação, filtro abrindo e fechando: o "rosnado" dark
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), sh = shaper(), len = BEAT * 1.4;
    o1.type = o2.type = 'sawtooth'; o1.frequency.value = o2.frequency.value = f; o1.detune.value = -20; o2.detune.value = 20;
    lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(180, t); lp.frequency.linearRampToValueAtTime(1100, t + len * .45); lp.frequency.linearRampToValueAtTime(160, t + len);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.22, t + .02); g.gain.setTargetAtTime(0, t + len * .8, .05);
    o1.connect(sh); o2.connect(sh); sh.connect(lp); lp.connect(g); g.connect(drums);
    o1.start(t); o2.start(t); o1.stop(t + len + .3); o2.stop(t + len + .3);
  } else {
    const o = ac.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = f;
    lp.type = 'lowpass'; lp.Q.value = 8; lp.frequency.setValueAtTime(900, t); lp.frequency.setTargetAtTime(150, t, .06);
    g.gain.setValueAtTime(.32, t); g.gain.setTargetAtTime(0, t + BEAT * .35, .04);
    o.connect(lp); lp.connect(g); g.connect(drums); o.start(t); o.stop(t + BEAT);
  }
}
function scheduleBeat() {
  while (beatNext < ac.currentTime + .12) {
    const i = beatStep, t = beatNext, st = style;
    if (st.kick[i] === 'x') kick(t, st.bassType === 'reese');
    if (st.clap[i] === 'x') { noise(t, .18, 'bandpass', 1400, .7, 1.5); noise(t + .012, .12, 'bandpass', 1400, .5, 1.5); }
    if (st.hat[i] === 'o') noise(t, .28, 'highpass', 6500, .3);
    else if (st.hat[i] === 'x') noise(t, .09, 'highpass', 7000, .35);
    else if (st.tick[i] === 'x') noise(t, .03, 'highpass', 9000, .1);
    if (st.bass[i]) bass(t, st.bass[i]);
    beatStep = (i + 1) % 16; beatNext += BEAT / 4;
  }
}

// idx = índice em STYLES, ou -1 para desligar. A escala e o andamento ficam no último estilo usado.
export function setBeat(idx) {
  opt.beat = idx >= 0;
  clearInterval(beatTimer); beatTimer = null;
  if (idx < 0 || !ac) return;
  style = STYLES[idx];
  setTempo(style.bpm); setScale(style.scale);
  if (ac.state !== 'running') ac.resume();
  beatStep = 0; beatNext = ac.currentTime + .08;
  scheduleBeat(); beatTimer = setInterval(scheduleBeat, 25);
}

// 0..1: brilho que decai depois de cada bumbo (para as cordas pulsarem)
export function beatPulse() {
  if (!ac) return 0;
  while (kickTimes.length && kickTimes[0] <= ac.currentTime) lastKick = kickTimes.shift();
  return opt.beat ? Math.exp(-(ac.currentTime - lastKick) * 7) : 0;
}
