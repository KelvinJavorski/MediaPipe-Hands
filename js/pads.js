// Tambores de luz (pads): círculos fixos na tela, tocados batendo a ponta dos dedos para dentro deles.
// Criados com UMA mão: pinça + giro do pulso (como girar um botão); o raio cresce com o giro e o tipo
// de tambor vem do tamanho. Posição e raio guardados normalizados (x, y em 0..1 da tela; r em fração
// da diagonal), como as cordas.
import {W, H} from './view.js';

export const pads = [];
export const MAX_PADS = 12;
export const PAD_MIN_DEG = 25;          // giro mínimo para começar a criar (pinça normal não cria)

// raio (px do canvas) pelo giro (graus), proporcional ao lado menor da tela (num celular de 390 px
// um tamanho fixo em px virava um bumbo maior que a tela); tipo pela fração do lado menor
const side = () => Math.min(W, H);
export const padRadius = deg => side() * Math.min(.3, .06 + (Math.abs(deg) - PAD_MIN_DEG) * .0035);
export function padType(rPx) {
  const f = rPx / side();
  return f < .1 ? 'chimbal' : f < .15 ? 'caixa' : f < .21 ? 'tom' : 'bumbo';
}
export const PAD_HUE = {chimbal: 55, caixa: 330, tom: 280, bumbo: 15};
export const PAD_NAME = {chimbal: 'Chimbal', caixa: 'Caixa', tom: 'Tom', bumbo: 'Bumbo'};

export const padPt = p => ({x: p.x * W, y: p.y * H});
export const padR = p => p.r * Math.hypot(W, H);

export function addPad(center, rPx, now) {
  const type = padType(rPx);
  const p = {x: center.x / W, y: center.y / H, r: rPx / Math.hypot(W, H), type, hue: PAD_HUE[type], hitT: -1e9, vel: 0, created: now};
  pads.push(p); if (pads.length > MAX_PADS) pads.shift();
  return p;
}
