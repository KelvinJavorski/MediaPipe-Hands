// Ponto de entrada: botões da interface e o loop por frame (gestos -> cordas -> som -> desenho).
import {VERSION, opt, TIMBRES} from './state.js';
import {ctx, W, H, dpr} from './view.js';
import {dist, mid, clamp, crossAt} from './geom.js';
import {initAudio, playString} from './audio.js';
import {setBeat, beatPulse, STYLES} from './beat.js';
import {strings, MAX_STRINGS, noteFor, endPt, strLen, nearestEnd, moveEnd} from './strings.js';
import {video, mirror, delegate, loadModel, startWorker, openCamera, nextCamera, toggleMirror, frameBox, toScreen} from './camera.js';
import {spawn, drawString, drawStretch, drawTrail, drawSkeleton, drawParticles, dot, ring, label} from './draw.js';

const $ = s => document.querySelector(s);
const msg = t => { $('#msg').textContent = t; };
// Detecção: de preferência num Web Worker (o desenho não espera); senão, no thread principal.
let worker = null, landmarker = null, mode = '';
let lastVT = -1, result = null, busy = false, busyT = 0, gotResult = false, detMs = 0;
function onWorkerMsg(e) {
  if (e.data.type !== 'result') return;
  result = e.data; gotResult = true; busy = false;
  detMs = detMs * .9 + e.data.ms * .1;
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
$('#bUndo').onclick = () => strings.pop();
$('#bClear').onclick = () => { strings.length = 0; };
const showMirror = () => $('#bMirror').classList.toggle('on', mirror);
$('#bMirror').onclick = () => { toggleMirror(); showMirror(); };
$('#bCam').onclick = async () => {
  try { if (await nextCamera()) { lastVT = -1; showMirror(); } } catch (e) { console.error(e); }
};

/* ---------- lógica por frame ---------- */
const grabR = st => Math.max(40 * dpr, st.size * .6);   // raio para agarrar a ponta de uma corda
let fpsT = performance.now(), fpsN = 0, detN = 0;

// Pinça: usa a distância REAL (em metros, worldLandmarks) entre as pontas do polegar e do indicador,
// que não engana quando os dedos só se sobrepõem na imagem (mão de lado). Entrar exige 3D e 2D perto;
// sair basta um dos dois longe (histerese). A mudança só vale após PINCH_FRAMES leituras seguidas,
// para uma leitura errada isolada não agarrar (nem soltar) uma corda.
const PINCH_IN_M = .03, PINCH_OUT_M = .05, PINCH_IN_2D = .35, PINCH_OUT_2D = .5, PINCH_FRAMES = 2;
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function updatePinch(st, pts, size, world) {
  const r2 = dist(pts[4], pts[8]) / (size || 1);              // 2D relativo ao tamanho da mão
  const m = world ? dist3(world[4], world[8]) : null;         // 3D em metros (se disponível)
  st.cm = m === null ? null : m * 100;
  const raw = st.pinch
    ? !(r2 > PINCH_OUT_2D || (m !== null && m > PINCH_OUT_M))
    : r2 < PINCH_IN_2D && (m === null || m < PINCH_IN_M);
  if (raw === st.pinch) { st.flip = 0; return; }
  if (++st.flip >= PINCH_FRAMES) { st.pinch = raw; st.flip = 0; }
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
      createImageBitmap(video)
        .then(bitmap => worker.postMessage({bitmap, t: performance.now()}, [bitmap]))
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
  if (fresh) detN++;
  const b = frameBox();
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  const pulse = beatPulse();

  // mãos detectadas, com identidade estável (Left/Right)
  const hands = (result?.landmarks || []).map((h, i) => {
    const pts = h.map(l => toScreen(l, b));
    const id = result.handedness?.[i]?.[0]?.categoryName || 'h' + i;
    const st = hand[id] ||= {pinch: false, wasPinch: false, grab: null, prev: null, prevT: 0, trail: [], flip: 0, cm: 0};
    const size = dist(pts[0], pts[9]);
    if (fresh) updatePinch(st, pts, size, result.worldLandmarks?.[i]);
    st.pinchPt = mid(pts[4], pts[8]); st.size = size;
    return {id, pts, st};
  });
  for (const id in hand) if (!hands.some(h => h.id === id)) {
    const st = hand[id]; st.pinch = st.wasPinch = false; st.grab = null; st.prev = null; st.trail.length = 0; st.flip = 0;
  }

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = ctx.lineJoin = 'round';

  // 1) agarrar / mover / soltar a ponta de uma corda (pinça que começa em cima da ponta)
  for (const h of hands) {
    const st = h.st;
    if (st.grab && !strings.includes(st.grab.s)) st.grab = null;  // apagada por Desfazer/Limpar
    if (st.pinch && !st.wasPinch) st.grab = nearestEnd(st.pinchPt, grabR(st), hands);
    if (!st.pinch && st.grab) {
      const s = st.grab.s, held = hands.some(o => o !== h && o.st.grab && o.st.grab.s === s);
      if (!held && strLen(s) < 50 * dpr) {                       // encolheu demais: apaga
        strings.splice(strings.indexOf(s), 1);
        spawn(endPt(s, 'a'), s.hue, 20, 1.6);
      } else spawn(st.pinchPt, s.hue, 6, .8);
      st.grab = null;
    }
    st.wasPinch = st.pinch;
    if (st.grab) moveEnd(st.grab, st.pinchPt);
  }

  // 2) esticar / fixar corda nova (duas pinças "livres", sem nada agarrado)
  const free = hands.filter(h => h.st.pinch && !h.st.grab);
  if (free.length === 2) {
    stretch = {a: free[0].st.pinchPt, b: free[1].st.pinchPt};
  } else if (stretch) {
    const len = dist(stretch.a, stretch.b);
    if (len > 50 * dpr) {
      const n = noteFor(len);
      const s = {ax: stretch.a.x / W, ay: stretch.a.y / H, bx: stretch.b.x / W, by: stretch.b.y / H, ...n,
        hitT: now, amp: 10 * dpr, u: .5, dir: 1};
      strings.push(s); if (strings.length > MAX_STRINGS) strings.shift();
      playString(s, .6, 0);
      spawn(stretch.a, n.hue, 14, 1.4); spawn(stretch.b, n.hue, 14, 1.4);
    }
    stretch = null;
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
            playString(s, vel, clamp((tip.x / W) * 2 - 1, -1, 1));
            spawn({x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u}, s.hue, 6 + 10 * vel, 1 + vel);
          }
        }
      }
      st.prev = tip; st.prevT = now;
      st.trail.push({x: tip.x, y: tip.y, t: now});
    }
    while (st.trail.length && now - st.trail[0].t > 600) st.trail.shift();
  }

  // 4) cordas fixas + pontas agarradas / agarráveis
  for (const s of strings) drawString(s, now, pulse);
  for (const h of hands) {
    const st = h.st;
    if (st.grab) {
      const s = st.grab.s, p = endPt(s, st.grab.e);
      dot(p, 7 * dpr, `hsla(${s.hue},100%,80%,.9)`); ring(p, grabR(st) * .6, `hsla(${s.hue},100%,75%,.7)`);
      label(mid(endPt(s, 'a'), endPt(s, 'b')), s.name, s.hue);
    } else if (!st.pinch) {
      const e = nearestEnd(st.pinchPt, grabR(st), hands);
      if (e) ring(endPt(e.s, e.e), 12 * dpr, `hsla(${e.s.hue},100%,80%,.6)`);
    }
  }

  // 5) corda sendo esticada
  if (stretch) drawStretch(stretch, noteFor(dist(stretch.a, stretch.b)));

  // 6) rastro, esqueleto, partículas
  if (opt.trail) for (const h of hands) drawTrail(h.st.trail);
  if (opt.skel) for (const h of hands) drawSkeleton(h.pts, h.st.pinch ? h.st.pinchPt : null);
  drawParticles();

  fpsN++;
  if (now - fpsT > 1000) {
    const cms = hands.map(h => h.st.cm === null ? '?' : h.st.cm.toFixed(1)).join('/');
    $('#hud').textContent = `${VERSION} · ${fpsN} fps · mãos ${detN}/s · detecção ${detMs.toFixed(0)} ms (${mode})` +
      (cms ? ` · pinça ${cms} cm` : '') + ` · ${strings.length} corda(s)`;
    fpsN = 0; detN = 0; fpsT = now;
  }
}
