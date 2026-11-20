// Cordas fixas: lista, nota pelo comprimento, pontas.
// Coordenadas guardadas normalizadas (ax, ay, bx, by em 0..1 da tela) para sobreviver a resize/rotação.
import {W, H} from './view.js';
import {dist} from './geom.js';
import {retune} from './audio.js';

export const strings = [];
export const MAX_STRINGS = 30;

/* ---------- comprimento -> nota (escala pentatônica em Dó, maior ou menor) ---------- */
const NAMES = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
const SCALES = {maior: [0, 2, 4, 7, 9], menor: [0, 3, 5, 7, 10]};
let PENTA = SCALES.maior;

// troca a escala (o estilo da batida decide) e reafina as cordas existentes
export function setScale(name) {
  if (PENTA === SCALES[name]) return;
  PENTA = SCALES[name];
  for (const s of strings) { Object.assign(s, noteFor(strLen(s))); retune(s); }
}

export function noteFor(lenPx) {
  const r = Math.min(1, lenPx / Math.hypot(W, H));              // 0..1 da diagonal da tela
  // corda real: frequência ~ 1/comprimento. 3 oitavas, de Dó2 (longa) a Dó5 (curta)
  const semis = Math.max(0, Math.min(36, Math.round(12 * Math.log2(.9 / Math.max(r, .9 / 8)))));
  let best = 0, bd = 99;
  for (let o = 0; o <= 3; o++) for (const p of PENTA) { const s = o * 12 + p; if (s <= 36 && Math.abs(s - semis) < bd) { bd = Math.abs(s - semis); best = s; } }
  const midi = 36 + best;                                       // 36 = Dó2
  return {f: 440 * 2 ** ((midi - 69) / 12), name: NAMES[midi % 12] + (Math.floor(midi / 12) - 1), hue: (200 + best * 9) % 360};
}

export const endPt = (s, e) => ({x: s[e + 'x'] * W, y: s[e + 'y'] * H});      // e = 'a' | 'b'
export const strLen = s => Math.hypot((s.bx - s.ax) * W, (s.by - s.ay) * H);

// ponta de corda mais próxima de p (dentro do raio r), ignorando as já agarradas por alguma mão
export function nearestEnd(p, r, hands) {
  let best = null;
  for (const s of strings) for (const e of ['a', 'b']) {
    if (hands.some(h => h.st.grab && h.st.grab.s === s && h.st.grab.e === e)) continue;
    const d = dist(p, endPt(s, e));
    if (d < r) { r = d; best = {s, e}; }
  }
  return best;
}

// move a ponta agarrada g = {s, e} para p e atualiza a nota (vozes soando deslizam junto)
export function moveEnd(g, p) {
  const s = g.s;
  s[g.e + 'x'] = p.x / W; s[g.e + 'y'] = p.y / H;
  const n = noteFor(strLen(s));
  if (n.f !== s.f) { Object.assign(s, n); retune(s); }
}
