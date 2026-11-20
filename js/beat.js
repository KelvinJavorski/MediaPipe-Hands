// Batida: bateria e baixo sintetizados, sequenciador de 16 passos, 3 estilos.
// O agendamento roda num setInterval próprio, ~120 ms à frente no relógio do áudio,
// independente do requestAnimationFrame (não atrasa se o desenho travar).
//
// Para o som "fazer sentido" com a batida ligada:
//  - cada estilo tem uma PROGRESSÃO de 4 acordes (um por compasso) e o baixo segue o acorde;
//  - harmonize(): cada toque de corda é puxado para a nota do acorde do momento mais próxima
//    (corda longa continua grave e curta aguda, mas nunca desafina com o baixo);
//  - quantize(): o toque espera a próxima semicolcheia (1/16 do compasso) para soar no ritmo.
// Sem batida, nada disso é aplicado (toque livre, na hora, nota da escala).
import {ac, duck, drums, noiseBuf, BEAT, setTempo, shaper, DRUMS_GAIN, setHarmonizer} from './audio.js';
import {setScale} from './strings.js';
import {opt} from './state.js';

// acordes: raiz e notas (classes de altura 0..11, Dó = 0)
const C = (name, root, tones) => ({name, root, tones});
const DO = C('Dó', 0, [0, 4, 7]), LAm = C('Lá menor', 9, [9, 0, 4]), FA = C('Fá', 5, [5, 9, 0]), SOL = C('Sol', 7, [7, 11, 2]);
const DOm = C('Dó menor', 0, [0, 3, 7]), LAb = C('Lá♭', 8, [8, 0, 3]), MIb = C('Mi♭', 3, [3, 7, 10]), SIb = C('Si♭', 10, [10, 2, 5]);

// padrões: 'x' = toca, 'o' = toca mais forte/aberto (chimbal aberto), '.' = pausa
// bass: intervalo em semitons a partir da RAIZ do acorde do compasso (null = pausa); só 0, 7 (quinta)
// e 12 (oitava), que combinam com qualquer acorde. bassType: 'pluck' curto | 'reese' distorcido.
const _ = null;
export const STYLES = [
  // I – vi – IV – V: a progressão de milhares de músicas pop
  {name: 'House', bpm: 112, scale: 'maior', bassType: 'pluck', duck: .75, chords: [DO, LAm, FA, SOL],
    kick: 'x...x...x...x...', clap: '....x.......x...', hat: '..x...x...x...x.', tick: 'x.x.x.x.x.x.x.x.',
    bass: [0, _, _, 0, _, _, 7, _, 0, _, _, 12, _, _, 7, _]},
  // lento e hipnótico, meio-tempo, baixo distorcido (inspirado em Rezz); i – VI – III – VII em Dó menor
  {name: 'Rezz', bpm: 100, scale: 'menor', bassType: 'reese', duck: .65, vol: .65, chords: [DOm, LAb, MIb, SIb],
    kick: 'x.........x.....', clap: '........x.......', hat: '....x.......x..x', tick: '..x...x...x...x.',
    bass: [0, _, _, 0, _, _, 7, _, _, 0, _, _, 12, _, 7, _]},
  // techno escuro: bumbo reto, chimbal aberto no contratempo, baixo rolando entre os bumbos
  {name: 'Techno', bpm: 126, scale: 'menor', bassType: 'pluck', duck: .7, chords: [DOm, DOm, LAb, SIb],
    kick: 'x...x...x...x...', clap: '....x.......x...', hat: '..o...o...o...o.', tick: 'xxxxxxxxxxxxxxxx',
    bass: [_, 0, 0, _, _, 0, 0, _, _, 0, 7, _, _, 0, 12, _]},
];
let style = STYLES[0];
let beatStep = 0, beatNext = 0, beatStart = 0, beatTimer = null;
const kickTimes = [];       // horários (tempo do áudio) dos bumbos agendados, para o pulso visual
let lastKick = -9;

// acorde que está tocando no instante t (relógio do áudio)
export function chordAt(t) {
  const bar = BEAT * 4, n = style.chords.length;
  return style.chords[((Math.floor((t - beatStart) / bar) % n) + n) % n];
}
export const currentChord = () => (opt.beat && ac ? chordAt(ac.currentTime) : null);

// Notas permitidas sobre um acorde: as do acorde + as da escala que NÃO ficam meio tom acima de uma
// nota do acorde (esse é o choque que soa "errado", ex.: Dó sobre Sol–Si–Ré). Puxar tudo para as notas
// do acorde deixava quase todas as cordas com a mesma nota (monótono); assim só muda o que briga.
const SCALE_PCS = {maior: [0, 2, 4, 7, 9], menor: [0, 3, 5, 7, 10]};
function allowedPcs(chord) {
  const avoid = chord.tones.map(p => (p + 1) % 12);
  return [...new Set([...chord.tones, ...SCALE_PCS[style.scale].filter(p => !avoid.includes(p))])];
}

// nota permitida (no acorde do instante t) mais próxima da frequência f; sem batida devolve f
export function harmonize(f, t) {
  if (!opt.beat || !beatTimer) return f;
  const ok = allowedPcs(chordAt(t)), m = 69 + 12 * Math.log2(f / 440), mi = Math.round(m);
  if (ok.includes(((mi % 12) + 12) % 12)) return f;              // já combina: mantém (inclui bend)
  let best = mi, bd = 99;
  for (let n = mi - 6; n <= mi + 6; n++) {
    if (!ok.includes(((n % 12) + 12) % 12)) continue;
    const d = Math.abs(n - m);
    if (d < bd) { bd = d; best = n; }
  }
  return 440 * 2 ** ((best - 69) / 12);
}

// próxima semicolcheia depois de t; se t passou da anterior há pouco (< 1/4 dela), toca já
export function quantize(t) {
  if (!opt.beat || !beatTimer) return t;
  const grid = BEAT / 4, k = Math.ceil((t - beatStart) / grid - .25);
  return Math.max(t, beatStart + k * grid);
}

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
  if (heavy) { const sh = shaper('none'); g.connect(sh); sh.connect(drums); } else g.connect(drums);  // grave: sem aliasing audível
  o.start(t); o.stop(t + .65);
  // sidechain: as cordas "respiram" com o bumbo
  duck.gain.setValueAtTime(1, t); duck.gain.linearRampToValueAtTime(style.duck, t + .01); duck.gain.setTargetAtTime(1, t + .03, .09);
  kickTimes.push(t);
}
function bass(t, midi) {
  const f = 440 * 2 ** ((midi - 69) / 12), lp = ac.createBiquadFilter(), g = ac.createGain();
  if (style.bassType === 'reese') {
    // dois serras desafinadas + saturação, filtro abrindo e fechando: o "rosnado" dark
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), sh = shaper('none'), len = BEAT * 1.4;
    o1.type = o2.type = 'sawtooth'; o1.frequency.value = o2.frequency.value = f; o1.detune.value = -20; o2.detune.value = 20;
    lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(180, t); lp.frequency.linearRampToValueAtTime(1100, t + len * .45); lp.frequency.linearRampToValueAtTime(160, t + len);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.13, t + .02); g.gain.setTargetAtTime(0, t + len * .8, .05);
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
    if (st.bass[i] !== null) {
      // raiz do acorde na região Sol1–Fá#2 (MIDI 31–42), abaixo das cordas
      const pc = chordAt(t + .001).root, root = 36 + pc - (pc > 6 ? 12 : 0);
      bass(t, root + st.bass[i]);
    }
    beatStep = (i + 1) % 16; beatNext += BEAT / 4;
  }
}

// idx = índice em STYLES, ou -1 para desligar. A escala e o andamento ficam no último estilo usado.
export function setBeat(idx) {
  opt.beat = idx >= 0;
  clearInterval(beatTimer); beatTimer = null;
  setHarmonizer(null);
  if (idx < 0 || !ac) return;
  style = STYLES[idx];
  drums.gain.setTargetAtTime(DRUMS_GAIN * (style.vol ?? 1), ac.currentTime, .05);   // volume por estilo
  setTempo(style.bpm); setScale(style.scale);
  if (ac.state !== 'running') ac.resume();
  beatStep = 0; beatNext = beatStart = ac.currentTime + .08;
  scheduleBeat(); beatTimer = setInterval(scheduleBeat, 25);
  setHarmonizer(harmonize);
}

// 0..1: brilho que decai depois de cada bumbo (para as cordas pulsarem)
export function beatPulse() {
  if (!ac) return 0;
  while (kickTimes.length && kickTimes[0] <= ac.currentTime) lastKick = kickTimes.shift();
  return opt.beat ? Math.exp(-(ac.currentTime - lastKick) * 7) : 0;
}
