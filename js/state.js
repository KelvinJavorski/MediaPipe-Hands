// Estado compartilhado de opções da UI e versão.

// A versão vem do "?v=N" que o import map do index.html coloca na URL deste módulo:
// é o único lugar onde a versão é definida.
export const VERSION = 'v' + (new URL(import.meta.url).searchParams.get('v') || 'dev');

export const opt = {skel: true, trail: true, sound: true, timbre: 0, beat: false};
export const TIMBRES = ['Synth', 'Reese', 'Ácido', 'Sino', 'Harpa'];   // mesma ordem de VOICES em audio.js
