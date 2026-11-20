// Canvas e tamanho da tela. W, H e dpr são "live bindings": quem importa sempre vê o valor atual.

export const cv = document.querySelector('#c');
export const ctx = cv.getContext('2d');
export let W = 0, H = 0, dpr = 1;

export function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  W = cv.width = Math.round(innerWidth * dpr);
  H = cv.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', resize); resize();
