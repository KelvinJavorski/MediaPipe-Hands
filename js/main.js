// Ponto de entrada: botões da interface e o loop por frame (gestos -> cordas -> som -> desenho).
import {VERSION, opt, TIMBRES} from './state.js';
import {ctx, W, H, dpr} from './view.js';
import {dist, mid, clamp, crossAt} from './geom.js';
import {ac, initAudio, playString, curFreq, setWah, setGlobalBend} from './audio.js';
import {drumHit} from './drums.js';
import {pads, addPad, padRadius, padType, padPt, padR, PAD_MIN_DEG, PAD_HUE, PAD_NAME} from './pads.js';
import {setBeat, beatPulse, STYLES, quantize, currentChord} from './beat.js';
import {strings, MAX_STRINGS, noteFor, endPt, strLen, nearestEnd, nearestMid, moveEnd, bendTo, releaseBend} from './strings.js';
import {loopState, loopPress, loopClear, loopRecord, loopRecordDrum, dueLoopHits, loopProgress} from './looper.js';
import {recSupported, isRecording, recSeconds, startRec, recFrame, stopRec, saveVideo} from './recorder.js';
import {video, mirror, delegate, loadModel, startWorker, openCamera, nextCamera, toggleMirror, frameBox, toScreen} from './camera.js';
import {spawn, drawString, drawStretch, drawTrail, drawSkeleton, drawParticles, dot, ring, label, strokePts, drawPad, drawPadGhost} from './draw.js';

const $ = s => document.querySelector(s);
const msg = t => { $('#msg').textContent = t; };
// Detecção: de preferência num Web Worker (o desenho não espera); senão, no thread principal.
let worker = null, landmarker = null, mode = '';
let lastVT = -1, result = null, busy = false, busyT = 0, gotResult = false, detMs = 0;
function onWorkerMsg(e) {
  if (e.data.type === 'faceError') { faceErr = 'rosto indisponível'; return; }
  if (e.data.type !== 'result') return;
  if (e.data.face) gotFace(e.data.face);
  result = e.data; gotResult = true; busy = false;
  detMs = detMs * .9 + e.data.ms * .1;
  const bn = e.data.bench;   // o worker compara GPU x CPU no início e fica com o mais rápido
  mode = 'worker ' + e.data.delegate + (bn ? ` · GPU ${bn.gpu}/CPU ${bn.cpu} ms` : ' · comparando GPU/CPU');
}
async function initDetector() {
  if (worker || landmarker) return;
  worker = await startWorker();
  if (worker) {
    worker.onmessage = onWorkerMsg; mode = 'worker GPU';
    worker.onerror = async e => {                                // worker quebrou no meio: volta ao thread principal
      console.warn('worker caiu', e); worker.terminate(); worker = null; busy = false;
      landmarker = await loadModel(); mode = 'principal ' + delegate;
    };
  } else { landmarker = await loadModel(); mode = 'principal ' + delegate; }
}
const hand = {};            // estado por mão (Left/Right): pinça, ponta agarrada, posição anterior, rastro
let stretch = null;         // corda sendo esticada {a,b}

$('#ver').textContent = VERSION;
if (!window.isSecureContext) msg('A câmera só funciona via https:// ou localhost.');

/* ---------- interface ---------- */
$('#start').onclick = async () => {
  try {
    $('#start').disabled = true;
    initAudio();
    msg('Carregando modelo de mãos…');
    await initDetector();
    msg('Abrindo câmera…');
    await openCamera(); lastVT = -1; showMirror();
    $('#intro').hidden = true; $('#ui').hidden = false;
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    msg('Erro: ' + (e.name === 'NotAllowedError' ? 'permissão da câmera negada.' : e.message));
    $('#start').disabled = false;
  }
};
const toggle = (id, key) => $(id).onclick = () => { opt[key] = !opt[key]; $(id).classList.toggle('on', opt[key]); };
toggle('#bSkel', 'skel'); toggle('#bTrail', 'trail');
// botão Batida alterna: desligada -> House -> Rezz -> Techno -> desligada
let beatIdx = -1;
const beat = idx => {
  beatIdx = idx; setBeat(idx);
  $('#bBeat').classList.toggle('on', idx >= 0);
  $('#bBeat').textContent = idx >= 0 ? 'Batida: ' + STYLES[idx].name : 'Batida';
};
$('#bSound').onclick = () => { opt.sound = !opt.sound; $('#bSound').classList.toggle('on', opt.sound); if (!opt.sound) beat(-1); };
$('#bBeat').onclick = () => {
  if (!opt.sound) $('#bSound').onclick();
  beat(beatIdx + 1 < STYLES.length ? beatIdx + 1 : -1);
};
$('#bTimbre').onclick = () => { opt.timbre = (opt.timbre + 1) % TIMBRES.length; $('#bTimbre').textContent = TIMBRES[opt.timbre]; };
// Desfazer tira o último criado (corda ou tambor); Limpar tira tudo
$('#bUndo').onclick = () => {
  const s = strings.at(-1), p = pads.at(-1);
  if (p && (!s || (p.created || 0) > (s.created || 0))) pads.pop(); else strings.pop();
};
$('#bClear').onclick = () => { strings.length = 0; pads.length = 0; };

// Rosto como pedal: boca aberta = wah, cabeça inclinada = pitch bend global (modelo de rosto no worker)
let faceErr = '', faceTick = 0;
const face = {open: 0, roll: 0, seenT: -1e9, pts: null, ms: 0};
$('#bFace').onclick = () => {
  if (!worker) { faceErr = 'rosto precisa do modo worker'; return; }
  opt.face = !opt.face; $('#bFace').classList.toggle('on', opt.face);
  worker.postMessage({type: 'face', on: opt.face});
  if (!opt.face) { setWah(null); setGlobalBend(0); face.pts = null; }
};
const FACE_DEAD_DEG = 6, FACE_FULL_DEG = 26, FACE_MAX_SEMIS = 3;
function gotFace(f) {
  face.ms = face.ms * .8 + f.ms * .2;
  if (!f.pts || !video.videoWidth) return;
  const b = frameBox(), p = f.pts.map(q => toScreen(q, b));            // 0 lábio cima, 1 lábio baixo, 2 testa, 3 queixo, 4/5 olhos
  const ratio = dist(p[0], p[1]) / (dist(p[2], p[3]) || 1);
  const open = clamp((ratio - .03) / .17, 0, 1);                        // boca fechada ~0, bem aberta ~1
  const [l, rr] = p[4].x < p[5].x ? [p[4], p[5]] : [p[5], p[4]];
  const roll = Math.atan2(rr.y - l.y, rr.x - l.x) * 180 / Math.PI;     // + = cabeça inclinada para a direita da tela
  face.open = face.open * .5 + open * .5; face.roll = face.roll * .5 + roll * .5;
  face.seenT = performance.now(); face.pts = p;
  if (!opt.face) return;
  setWah(face.open);
  const ex = Math.max(0, Math.abs(face.roll) - FACE_DEAD_DEG) / (FACE_FULL_DEG - FACE_DEAD_DEG);
  setGlobalBend(Math.sign(face.roll) * Math.min(1, ex) * FACE_MAX_SEMIS);
}
const showMirror = () => $('#bMirror').classList.toggle('on', mirror);
$('#bMirror').onclick = () => { toggleMirror(); showMirror(); };
$('#bCam').onclick = async () => {
  try { if (await nextCamera()) { lastVT = -1; showMirror(); } } catch (e) { console.error(e); }
};

// Looper: Loop -> gravando -> tocando (+ Camada) <-> gravando camada; o "×" apaga o loop
const LOOP_LABEL = {vazio: 'Loop', gravando: '■ Fechar loop', tocando: '+ Camada', camada: '■ Fechar camada'};
function showLoop() {
  const b = $('#bLoop');
  b.textContent = LOOP_LABEL[loopState];
  b.classList.toggle('recOn', loopState === 'gravando' || loopState === 'camada');
  b.classList.toggle('playing', loopState === 'tocando');
  $('#bLoopClear').hidden = loopState === 'vazio';
}
$('#bLoop').onclick = () => { if (!opt.sound) $('#bSound').onclick(); loopPress(); showLoop(); };
$('#bLoopClear').onclick = () => { loopClear(); showLoop(); };

// Gravar vídeo: ● grava; ao parar aparece "Salvar vídeo" (compartilhar precisa de um toque novo no iPhone)
let videoBlob = null;
if (!recSupported()) $('#bRec').hidden = true;
$('#bRec').onclick = async () => {
  if (!isRecording()) {
    try { startRec(); $('#bRec').classList.add('recOn'); $('#bSave').hidden = true; }
    catch (e) { console.error(e); $('#hud').textContent = 'Não deu para gravar: ' + e.message; }
  } else {
    $('#bRec').classList.remove('recOn');
    videoBlob = await stopRec();
    if (videoBlob && videoBlob.size) $('#bSave').hidden = false;
  }
};
$('#bSave').onclick = async () => {
  if (!videoBlob) return;
  const r = await saveVideo(videoBlob);
  if (r !== 'cancelado') { $('#bSave').hidden = true; videoBlob = null; }
};

// toque de verdade numa corda: soa e entra no loop (se estiver gravando).
// Com a batida ligada, soa na próxima semicolcheia (no ritmo) e na nota do acorde do momento
// (a harmonização acontece dentro de playString); o loop guarda a nota da corda, não a harmonizada,
// para a repetição combinar com o acorde de cada volta.
function pluck(s, vel, pan, u) {
  const when = ac ? quantize(ac.currentTime) : undefined;
  playString(s, vel, pan, when);
  loopRecord(s, vel, pan, curFreq(s), u, when);
}

/* ---------- lógica por frame ---------- */
const grabR = st => Math.max(40 * dpr, st.size * .6);   // raio para agarrar a ponta de uma corda
let fpsT = performance.now(), fpsN = 0, detN = 0;
// Desenhar mais rápido que as mãos atualizam quase não acrescenta e disputa a GPU com a detecção
// (medido no PC com tela de 120 Hz: detecção 35 → 76 ms com as cordas vibrando). Teto: ~30 fps no
// celular e ~60 fps no PC; todo frame com leitura nova das mãos é desenhado na hora.
const FRAME_MIN_MS = matchMedia('(pointer: coarse)').matches ? 30 : 15;
const DET_W = 320;          // largura da imagem enviada ao worker de detecção
let lastDraw = 0, lastDet = 0, gapMax = 0;   // gapMax = maior intervalo sem leitura das mãos no último segundo (HUD)

// Pinça: usa a distância REAL (em metros, worldLandmarks) entre as pontas do polegar e do indicador,
// que não engana quando os dedos só se sobrepõem na imagem (mão de lado). Entrar exige 3D e 2D perto;
// sair basta um dos dois longe (histerese). A mudança só vale após algumas leituras seguidas
// (entrar 2, sair 3: soltar sem querer no meio de um arrasto é pior que demorar a soltar).
const PINCH_IN_M = .05, PINCH_OUT_M = .075, PINCH_IN_2D = .38, PINCH_OUT_2D = .55;
const PINCH_FRAMES_IN = 2, PINCH_FRAMES_OUT = 3;
const GRAB_WINDOW = 300;    // ms após fechar a pinça em que ela ainda pode agarrar uma ponta que encostar
const LOST_GRACE = 300;     // ms que a mão pode sumir do rastreamento sem soltar a corda que segura
const PINCH_MAX_MOVE = .35; // ponta do indicador andando mais que isso (× tamanho da mão) por leitura: não começa pinça
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function updatePinch(st, pts, size, world, now) {
  const r2 = dist(pts[4], pts[8]) / (size || 1);              // 2D relativo ao tamanho da mão
  const m = world ? dist3(world[4], world[8]) : null;         // 3D em metros (se disponível)
  st.cm = m === null ? null : m * 100;
  // Para COMEÇAR uma pinça, além de perto:
  //  - ponta com ponta: o polegar está mais perto da ponta do indicador (8) do que das articulações
  //    do meio (6, 7). Com a mão de lado apontando, o polegar encosta na lateral do dedo (falso positivo);
  //  - mão quase parada: ninguém fecha pinça no meio de um movimento rápido do dedo.
  const d = (i, j) => world ? dist3(world[i], world[j]) : dist(pts[i], pts[j]);
  const tipToTip = d(4, 8) < Math.min(d(4, 6), d(4, 7));
  const move = st.tipPrev ? dist(pts[8], st.tipPrev) / (size || 1) : 0;
  st.tipPrev = pts[8];
  const raw = st.pinch
    ? !(r2 > PINCH_OUT_2D || (m !== null && m > PINCH_OUT_M))
    : r2 < PINCH_IN_2D && (m === null || m < PINCH_IN_M) && tipToTip && move < PINCH_MAX_MOVE;
  if (raw === st.pinch) { st.flip = 0; return; }
  if (++st.flip >= (raw ? PINCH_FRAMES_IN : PINCH_FRAMES_OUT)) {
    st.pinch = raw; st.flip = 0;
    if (raw) st.pinchT = now;
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  if (video.readyState < 2) return;
  let fresh = false;                                             // chegou resultado novo de detecção?
  if (worker) {
    // manda o frame novo da câmera só quando o worker terminou o anterior (sem fila acumulando atraso)
    if (busy && now - busyT > 1000) busy = false;              // resposta perdida: não trava para sempre
    if (!busy && video.currentTime !== lastVT) {
      lastVT = video.currentTime; busy = true; busyT = now;
      // imagem reduzida (DET_W px de largura): o modelo trabalha em ~224 px de qualquer forma, e no Safari
      // copiar a imagem para a GPU é caro. As coordenadas são normalizadas, então nada muda no mapeamento.
      const sc = Math.min(1, DET_W / (video.videoWidth || DET_W));
      createImageBitmap(video, {resizeWidth: Math.round(video.videoWidth * sc), resizeHeight: Math.round(video.videoHeight * sc),
        resizeQuality: 'low'})
        .catch(() => createImageBitmap(video))                    // navegador sem suporte a resize
        .then(bitmap => worker.postMessage({bitmap, t: performance.now(), face: opt.face && (faceTick ^= 1) === 1}, [bitmap]))
        .catch(() => { busy = false; });
    }
    if (gotResult) { gotResult = false; fresh = true; }
  } else if (video.currentTime !== lastVT) {
    lastVT = video.currentTime;
    const t0 = performance.now();
    result = landmarker.detectForVideo(video, now);
    detMs = detMs * .9 + (performance.now() - t0) * .1;
    fresh = true;
  }
  if (fresh) { detN++; gapMax = Math.max(gapMax, now - lastDet); lastDet = now; }
  if (!fresh && now - lastDraw < FRAME_MIN_MS) return;
  lastDraw = now;
  const b = frameBox();
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  const pulse = beatPulse();

  // mãos detectadas, com identidade estável (Left/Right)
  const hands = (result?.landmarks || []).map((h, i) => {
    const pts = h.map(l => toScreen(l, b));
    const id = result.handedness?.[i]?.[0]?.categoryName || 'h' + i;
    const st = hand[id] ||= {pinch: false, wasPinch: false, grab: null, prev: null, prevT: 0, trail: [], flip: 0, cm: 0,
      pinchT: 0, lostT: 0};
    const size = dist(pts[0], pts[9]);
    if (fresh) updatePinch(st, pts, size, result.worldLandmarks?.[i], now);
    st.pinchPt = mid(pts[4], pts[8]); st.size = size; st.lostT = 0;
    return {id, pts, st};
  });
  // mão sumiu: para de tocar/rastro na hora, mas só larga pinça/corda se continuar sumida por LOST_GRACE
  for (const id in hand) if (!hands.some(h => h.id === id)) {
    const st = hand[id]; st.prev = null; st.trail.length = 0; st.flip = 0; st.tipPrev = null; st.tips = null; st.padMaking = false;
    st.lostT ||= now;
    if (now - st.lostT > LOST_GRACE) {
      if (st.grab && st.grab.e === 'mid') releaseBend(st.grab.s);   // corda puxada volta ao normal
      st.pinch = st.wasPinch = false; st.grab = null;
    }
  }

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = ctx.lineJoin = 'round';

  // 1) agarrar com a pinça (que fecha em cima, ou encosta até GRAB_WINDOW ms depois de fechar;
  //    não vale durante o esticar de corda nova):
  //    - ponta da corda: move a ponta (muda comprimento e nota);
  //    - meio da corda: BEND, puxa a corda em V e a nota sobe; ao soltar, a corda estala e toca.
  for (const h of hands) {
    const st = h.st;
    if (st.grab && !strings.includes(st.grab.s)) st.grab = null;  // apagada por Desfazer/Limpar
    if (st.pinch && !st.grab && !stretch && now - st.pinchT < GRAB_WINDOW)
      st.grab = nearestEnd(st.pinchPt, grabR(st), hands) || nearestMid(st.pinchPt, grabR(st) * .7, hands);
    if (!st.pinch && st.grab) {
      const s = st.grab.s;
      if (st.grab.e === 'mid') {
        const bd = releaseBend(s), len = strLen(s) || 1;
        if (bd && Math.abs(bd.off) > 8 * dpr) {                  // soltou a corda puxada: estala
          const vel = Math.min(1, Math.abs(bd.off) / (.12 * len));
          s.hitT = now; s.u = bd.u; s.dir = Math.sign(bd.off) || 1; s.amp = Math.min(Math.abs(bd.off), 60 * dpr);
          pluck(s, vel, clamp((st.pinchPt.x / W) * 2 - 1, -1, 1), bd.u);
          spawn(st.pinchPt, s.hue, 8 + 12 * vel, 1 + vel);
        }
      } else {
        const held = hands.some(o => o !== h && o.st.grab && o.st.grab.s === s);
        if (!held && strLen(s) < 50 * dpr) {                     // encolheu demais: apaga
          strings.splice(strings.indexOf(s), 1);
          spawn(endPt(s, 'a'), s.hue, 20, 1.6);
        } else spawn(st.pinchPt, s.hue, 6, .8);
      }
      st.grab = null;
    }
    // tambor de luz: pinça livre (sem agarrar nada), parada no lugar, + giro do pulso
    const ang = Math.atan2(h.pts[9].y - h.pts[0].y, h.pts[9].x - h.pts[0].x);
    if (st.pinch && !st.wasPinch) { st.padA0 = ang; st.padC = st.pinchPt; st.padMaking = false; }
    if (st.pinch && !st.grab && st.padC) {
      st.padDeg = ((ang - st.padA0 + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * 180 / Math.PI;
      if (!st.padMaking && Math.abs(st.padDeg) > PAD_MIN_DEG && dist(st.pinchPt, st.padC) < st.size * .7) st.padMaking = true;
    }
    if (!st.pinch && st.padMaking) {                               // soltou: o tambor fica
      const p = addPad(st.padC, padRadius(st.padDeg), now);
      drumHit(p.type, .6); p.hitT = now; p.vel = .6;
      spawn(st.padC, p.hue, 18, 1.4);
    }
    if (!st.pinch) { st.padMaking = false; st.padC = null; }
    st.wasPinch = st.pinch;
    if (st.grab) (st.grab.e === 'mid' ? bendTo : moveEnd)(st.grab, st.pinchPt);
  }

  // 2) esticar / fixar corda nova (duas pinças "livres", sem nada agarrado)
  const free = hands.filter(h => h.st.pinch && !h.st.grab);
  if (free.length === 2) {
    stretch = {a: free[0].st.pinchPt, b: free[1].st.pinchPt};
    for (const h of free) h.st.padMaking = false;
    for (const h of free) h.st.pinchT = -1e9;   // quem está esticando não agarra a ponta da corda recém-criada
  } else if (stretch) {
    const len = dist(stretch.a, stretch.b);
    if (len > 50 * dpr) {
      const n = noteFor(len);
      const s = {ax: stretch.a.x / W, ay: stretch.a.y / H, bx: stretch.b.x / W, by: stretch.b.y / H, ...n,
        hitT: now, amp: 10 * dpr, u: .5, dir: 1};
      s.created = now; strings.push(s); if (strings.length > MAX_STRINGS) strings.shift();
      playString(s, .6, 0);
      spawn(stretch.a, n.hue, 14, 1.4); spawn(stretch.b, n.hue, 14, 1.4);
    }
    stretch = null;
  }

  // 2b) tambores: ponta do indicador ou do médio ENTRANDO no círculo (de fora para dentro) com velocidade
  for (const h of hands) {
    const st = h.st;
    if (!fresh) continue;
    if (st.tips && !st.padMaking && pads.length) {
      const dt = Math.max(16, now - st.prevT);
      for (const i of [8, 12]) {
        const cur = h.pts[i], prev = st.tips[i];
        if (!prev) continue;
        const vel = Math.min(1, dist(cur, prev) * (33 / dt) / (40 * dpr));
        if (vel < .12) continue;
        for (const p of pads) {
          const c = padPt(p), R = padR(p);
          if (dist(prev, c) > R && dist(cur, c) <= R && now - p.hitT > 120) {
            const when = ac ? quantize(ac.currentTime) : undefined;
            drumHit(p.type, vel, when); loopRecordDrum(p, p.type, vel, when);
            p.hitT = now; p.vel = vel;
          }
        }
      }
    }
    st.tips = {8: h.pts[8], 12: h.pts[12]};
  }

  // 3) tocar: indicador de mão que não está em pinça cruzando uma corda (inclusive a que a outra mão segura)
  for (const h of hands) {
    const tip = h.pts[8], st = h.st;
    if (fresh) {
      if (st.prev && !st.pinch) {
        const mx = tip.x - st.prev.x, my = tip.y - st.prev.y;
        const dt = Math.max(16, now - st.prevT);
        const vel = Math.min(1, Math.hypot(mx, my) * (33 / dt) / (40 * dpr));   // velocidade normalizada a ~30fps
        for (const s of strings) {
          const a = endPt(s, 'a'), c = endPt(s, 'b');
          const u = crossAt(st.prev, tip, a, c);
          if (u !== null && now - s.hitT > 140) {
            const len = dist(a, c) || 1, nx = -(c.y - a.y) / len, ny = (c.x - a.x) / len;
            s.hitT = now; s.u = clamp(u, .12, .88); s.dir = Math.sign(mx * nx + my * ny) || 1;
            s.amp = (5 + 25 * vel) * dpr;
            pluck(s, vel, clamp((tip.x / W) * 2 - 1, -1, 1), s.u);
            spawn({x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u}, s.hue, 6 + 10 * vel, 1 + vel);
          }
        }
      }
      st.prev = tip; st.prevT = now;
      st.trail.push({x: tip.x, y: tip.y, t: now});
    }
    while (st.trail.length && now - st.trail[0].t > 600) st.trail.shift();
  }

  // 3b) toques do looper chegando na hora: a corda vibra na tela (o som já foi agendado)
  for (const ev of dueLoopHits()) {
    if (ev.pad) { if (pads.includes(ev.pad)) { ev.pad.hitT = now; ev.pad.vel = ev.vel; } continue; }
    const s = ev.s;
    if (!strings.includes(s)) continue;
    s.hitT = now; s.u = ev.u ?? .5; s.dir = 1; s.amp = (5 + 25 * ev.vel) * dpr;
    const a = endPt(s, 'a'), c = endPt(s, 'b');
    spawn({x: a.x + (c.x - a.x) * s.u, y: a.y + (c.y - a.y) * s.u}, s.hue, 4 + 6 * ev.vel, .8 + ev.vel);
  }

  // 4) cordas fixas + pontas agarradas / agarráveis
  for (const p of pads) drawPad(padPt(p), padR(p), p.hue, p.hitT, p.vel, now, pulse, PAD_NAME[p.type]);
  for (const h of hands) if (h.st.padMaking) {
    const rad = padRadius(h.st.padDeg), t = padType(rad);
    drawPadGhost(h.st.padC, rad, PAD_HUE[t], h.st.padDeg, PAD_NAME[t]);
  }
  for (const s of strings) drawString(s, now, pulse);
  for (const h of hands) {
    const st = h.st;
    if (st.grab && st.grab.e === 'mid') {
      const s = st.grab.s, semis = 12 * Math.log2(s.bendMul || 1);
      dot(st.pinchPt, 7 * dpr, `hsla(${s.hue},100%,85%,.95)`);
      label(st.pinchPt, `${s.name} +${semis.toFixed(1)}`, s.hue);
    } else if (st.grab) {
      const s = st.grab.s, p = endPt(s, st.grab.e);
      dot(p, 7 * dpr, `hsla(${s.hue},100%,80%,.9)`); ring(p, grabR(st) * .6, `hsla(${s.hue},100%,75%,.7)`);
      label(mid(endPt(s, 'a'), endPt(s, 'b')), s.name, s.hue);
    } else if (!st.pinch) {
      const e = nearestEnd(st.pinchPt, grabR(st), hands);
      if (e) ring(endPt(e.s, e.e), 12 * dpr, `hsla(${e.s.hue},100%,80%,.6)`);
      else { const m = nearestMid(st.pinchPt, grabR(st) * .7, hands); if (m) ring(st.pinchPt, 9 * dpr, `hsla(${m.s.hue},100%,80%,.5)`); }
    }
  }

  // 5) corda sendo esticada
  if (stretch) drawStretch(stretch, noteFor(dist(stretch.a, stretch.b)));

  // 6) rastro, esqueleto, partículas
  if (opt.trail) for (const h of hands) drawTrail(h.st.trail);
  if (opt.skel) for (const h of hands) drawSkeleton(h.pts, h.st.pinch ? h.st.pinchPt : null);
  drawParticles();

  if (opt.face && face.pts && performance.now() - face.seenT < 500) {
    const p = face.pts;
    strokePts([p[4], p[5]], 'hsla(190,100%,70%,.6)', 2 * dpr);                                // olhos = inclinação
    strokePts([p[0], p[1]], `hsla(300,100%,${60 + 30 * face.open}%,.9)`, (3 + 6 * face.open) * dpr);   // boca = wah
  } else if (opt.face && performance.now() - face.seenT > 500) { setWah(null); setGlobalBend(0); }
  if (isRecording()) recFrame();
  if (loopState === 'tocando') $('#bLoop').style.setProperty('--p', (loopProgress() * 100).toFixed(1) + '%');

  fpsN++;
  if (now - fpsT > 1000) {
    const cms = hands.map(h => h.st.cm === null ? '?' : h.st.cm.toFixed(1)).join('/');
    const worst = Math.max(gapMax, now - lastDet);               // inclui o caso de ter travado de vez
    $('#hud').textContent = `${VERSION} · ${fpsN} fps · mãos ${detN}/s (pior ${worst.toFixed(0)} ms) · ` +
      `detecção ${detMs.toFixed(0)} ms (${mode})` + (cms ? ` · pinça ${cms} cm` : '') + ` · ${strings.length} corda(s)` +
      (currentChord() ? ` · acorde ${currentChord().name}` : '') +
      (opt.face ? (face.pts ? ` · rosto: boca ${(face.open * 100).toFixed(0)}% inclinação ${face.roll.toFixed(0)}° (${face.ms.toFixed(0)} ms)` : ' · rosto: procurando') : '') +
      (faceErr ? ' · ' + faceErr : '') +
      (isRecording() ? ` · ● REC ${Math.floor(recSeconds() / 60)}:${String(Math.floor(recSeconds() % 60)).padStart(2, '0')}` : '');
    fpsN = 0; detN = 0; gapMax = 0; fpsT = now;
  }
}
