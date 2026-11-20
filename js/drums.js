// Sons dos tambores de luz (pads): síntese, sem samples. Saem por padBus (não passam pelo wah nem
// pelo sidechain). Todos têm componente acima de 200 Hz para serem ouvidos em alto-falante pequeno.
// A força da batida (vel) controla um ganho DEPOIS da saturação: antes dela, a saturação "achatava"
// a diferença entre fraco e forte. LEVEL equaliza os tipos (medido: pico acima de 200 Hz de um toque
// forte ≈ o de uma nota média de corda).
import {ac, padBus, noiseBuf, shaper, stopAt} from './audio.js';
import {opt} from './state.js';

function noiseHit(dest, t, dur, type, freq, gain, q = 1) {
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest); s.start(t); s.stop(t + dur + .02);
}
function toneHit(dest, t, f0, f1, dur, gain, sat) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * .4);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(g);
  if (sat) { const sh = shaper('none'); g.connect(sh); sh.connect(dest); } else g.connect(dest);
  o.start(t); stopAt(o, t + dur + .05);
}

// tipo -> som (independente da força; a força entra no ganho de saída)
const KITS = {
  bumbo:   (d, t) => { toneHit(d, t, 170, 45, .45, 1, true); noiseHit(d, t, .015, 'highpass', 2500, .4); },
  tom:     (d, t) => { toneHit(d, t, 220, 120, .35, .8, true); noiseHit(d, t, .05, 'bandpass', 1200, .15, 1); },
  caixa:   (d, t) => { toneHit(d, t, 260, 180, .12, .5, false); noiseHit(d, t, .2, 'bandpass', 1800, .9, .8); },
  chimbal: (d, t) => { noiseHit(d, t, .1, 'highpass', 7000, 1); noiseHit(d, t, .03, 'bandpass', 10000, .6, 1); },
};
const LEVEL = {bumbo: .5, tom: .3, caixa: .9, chimbal: 3.2};
export const DRUM_TYPES = Object.keys(KITS);

export function drumHit(type, vel, when) {
  if (!opt.sound || !ac || !KITS[type]) return;
  if (ac.state !== 'running') ac.resume();
  const t = Math.max(ac.currentTime, when ?? ac.currentTime), v = Math.max(0, Math.min(1, vel));
  const out = ac.createGain();
  out.gain.value = LEVEL[type] * (.3 + .7 * v);           // fraco ≈ 1/3 do forte
  out.connect(padBus);
  KITS[type](out, t);
}
