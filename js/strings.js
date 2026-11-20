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
  // corda real: frequência ~ 1/comprimento. 2 oitavas, de Dó3 (longa) a Dó5 (curta): acima do baixo
  // da batida (que fica entre Sol1 e Fá#2), para não embolar com ele
  const semis = Math.max(0, Math.min(24, Math.round(12 * Math.log2(.9 / Math.max(r, .9 / 4)))));
  let best = 0, bd = 99;
  for (let o = 0; o <= 2; o++) for (const p of PENTA) { const s = o * 12 + p; if (s <= 24 && Math.abs(s - semis) < bd) { bd = Math.abs(s - semis); best = s; } }
  const midi = 48 + best;                                       // 48 = Dó3
  return {f: 440 * 2 ** ((midi - 69) / 12), name: NAMES[midi % 12] + (Math.floor(midi / 12) - 1), hue: (200 + best * 13) % 360};
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

// ponto do MEIO de alguma corda perto de p (para o bend): projeção de p na corda, longe das pontas.
// Retorna {s, e: 'mid'} ou null. Cordas já seguradas no meio por outra mão são ignoradas.
export function nearestMid(p, r, hands) {
  let best = null;
  for (const s of strings) {
    if (hands.some(h => h.st.grab && h.st.grab.s === s && h.st.grab.e === 'mid')) continue;
    const a = endPt(s, 'a'), b = endPt(s, 'b'), dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
    if (u < .15 || u > .85) continue;
    const d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(L2);
    if (d < r) { r = d; best = {s, e: 'mid'}; }
  }
  return best;
}

// Bend: a corda é puxada pelo meio até p. Guarda o ponto (u ao longo da corda, off = deslocamento
// perpendicular em px, com sinal) e sobe a nota como uma corda real esticada: quanto mais longe, mais aguda.
export const BEND_MAX_SEMIS = 7;
export function bendTo(g, p) {
  const s = g.s, a = endPt(s, 'a'), b = endPt(s, 'b'), dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const u = Math.max(.1, Math.min(.9, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (L * L)));
  const off = ((p.x - a.x) * -dy + (p.y - a.y) * dx) / L;     // projeção na normal (-dy, dx)/L, igual à do desenho
  s.bend = {u, off};
  const semis = Math.min(BEND_MAX_SEMIS, 30 * Math.abs(off) / L);   // 10% do comprimento ≈ +3 semitons
  const mul = 2 ** (semis / 12);
  if (Math.abs(mul - (s.bendMul || 1)) > .002) { s.bendMul = mul; retune(s); }
}
export function releaseBend(s) { const b = s.bend; s.bend = null; s.bendMul = 1; retune(s); return b; }

// move a ponta agarrada g = {s, e} para p e atualiza a nota (vozes soando deslizam junto)
export function moveEnd(g, p) {
  const s = g.s;
  s[g.e + 'x'] = p.x / W; s[g.e + 'y'] = p.y / H;
  const n = noteFor(strLen(s));
  if (n.f !== s.f) { Object.assign(s, n); retune(s); }
}
