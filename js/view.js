// Canvas e tamanho da tela. W, H e dpr são "live bindings": quem importa sempre vê o valor atual.

export const cv = document.querySelector('#c');
export const ctx = cv.getContext('2d');
export let W = 0, H = 0, dpr = 1;
// Teto de pixels do canvas: cada pixel é somado várias vezes ('lighter') e a GPU é a mesma da detecção
// das mãos. Num PC 2000×1040 com escala 1,5 seriam ~4,7 MP; o teto deixa ~1,2 MP (celular quase não muda).
const MAX_PIXELS = 1.2e6;

// dpr = escala canvas/CSS; todo tamanho em pixel do desenho é multiplicado por ele (pode ser < 1 no PC)
export function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_PIXELS / (innerWidth * innerHeight)));
  W = cv.width = Math.round(innerWidth * dpr);
  H = cv.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', resize); resize();
