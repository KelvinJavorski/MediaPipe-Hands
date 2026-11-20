// Looper: grava os toques nas cordas e repete em loop, com camadas por cima (overdub).
//
// Estados (botão Loop):  vazio --toque--> gravando --toque--> tocando <--toque--> gravando camada
//                        (botão lixeira do loop volta para vazio)
// Cada toque gravado guarda a FREQUÊNCIA do momento (o loop continua igual mesmo se a corda mudar
// ou for apagada) e a corda, só para o efeito visual. Com a batida ligada, a duração do loop é
// arredondada para compassos inteiros, para ficar no tempo.
// O agendamento é igual ao da batida: setInterval de 25 ms agendando ~120 ms à frente no relógio do áudio.
import {ac, BEAT, playString} from './audio.js';
import {drumHit} from './drums.js';
import {opt} from './state.js';

export let loopState = 'vazio';        // 'vazio' | 'gravando' | 'tocando' | 'camada'
let events = [];                       // corda: {o: segundos desde o início, s, vel, pan, f, u}; tambor: {o, pad, drum, vel}
let recStart = 0, loopStart = 0, loopLen = 0, schedUntil = 0, timer = null;
const hits = [];                       // toques agendados, para o efeito visual: {t, ev}
const MAX_EVENTS = 400, AHEAD = .12;

export function loopPress() {
  if (!ac) return loopState;
  const t = ac.currentTime;
  if (loopState === 'vazio') {
    events = []; recStart = t; loopState = 'gravando';
  } else if (loopState === 'gravando') {
    let len = t - recStart;
    if (opt.beat) { const bar = BEAT * 4; len = Math.max(1, Math.round(len / bar)) * bar; }
    if (!events.length || len < .4) { loopState = 'vazio'; return loopState; }
    loopStart = recStart; loopLen = len; schedUntil = t; loopState = 'tocando';
    clearInterval(timer); timer = setInterval(tick, 25); tick();
  } else {
    loopState = loopState === 'tocando' ? 'camada' : 'tocando';
  }
  return loopState;
}

export function loopClear() {
  clearInterval(timer); timer = null;
  events = []; hits.length = 0; loopState = 'vazio';
}

// chamado a cada toque de corda feito pela pessoa. when = horário em que o toque soa (com a batida
// ligada é a semicolcheia seguinte); f = nota da corda (a repetição é harmonizada com o acorde de cada volta)
export function loopRecord(s, vel, pan, f, u, when) {
  if (!ac || events.length >= MAX_EVENTS) return;
  const t = when ?? ac.currentTime;
  if (loopState === 'gravando') events.push({o: t - recStart, s, vel, pan, f, u});
  // na camada, o toque já soou agora; ele entra no loop a partir da próxima volta
  else if (loopState === 'camada') events.push({o: (((t - loopStart) % loopLen) + loopLen) % loopLen, s, vel, pan, f, u});
}

// toque num tambor de luz
export function loopRecordDrum(pad, drum, vel, when) {
  if (!ac || events.length >= MAX_EVENTS) return;
  const t = when ?? ac.currentTime;
  if (loopState === 'gravando') events.push({o: t - recStart, pad, drum, vel});
  else if (loopState === 'camada') events.push({o: (((t - loopStart) % loopLen) + loopLen) % loopLen, pad, drum, vel});
}

function tick() {
  const from = schedUntil, to = ac.currentTime + AHEAD;
  if (to <= from) return;
  const k0 = Math.floor((from - loopStart) / loopLen), k1 = Math.floor((to - loopStart) / loopLen);
  for (let k = k0; k <= k1; k++) for (const ev of events) {
    const T = loopStart + k * loopLen + ev.o;
    if (T >= from && T < to) {
      if (ev.drum) drumHit(ev.drum, ev.vel, T); else playString(ev.s, ev.vel, ev.pan, T, ev.f);
      hits.push({t: T, ev});
    }
  }
  schedUntil = to;
}

// toques do loop que já chegaram na hora de soar (para a corda vibrar na tela)
export function dueLoopHits() {
  if (!ac || !hits.length) return [];
  const now = ac.currentTime, out = [];
  while (hits.length && hits[0].t <= now) out.push(hits.shift().ev);
  if (hits.length > 200) hits.splice(0, hits.length - 200);
  return out;
}

// 0..1: posição dentro do loop (para mostrar o progresso)
export function loopProgress() {
  if (!ac) return 0;
  if (loopState === 'gravando') return 0;
  if (loopState === 'vazio' || !loopLen) return 0;
  return ((ac.currentTime - loopStart) % loopLen) / loopLen;
}
