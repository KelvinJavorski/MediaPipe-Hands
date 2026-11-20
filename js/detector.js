// Web Worker de detecção: roda o MediaPipe fora do thread principal, para o desenho não travar.
//
// Escolha automática de GPU x CPU: no Safari/iPhone a GPU (WebGL) nem sempre é a mais rápida, porque
// copiar a imagem para a GPU e de volta custa caro, e ela disputa a GPU com o desenho. Então o worker
// começa na GPU, mede BENCH_N detecções, carrega a versão CPU, mede mais BENCH_N e fica com a mais rápida.
//
// Protocolo:
//   worker -> {type: 'ready', delegate: 'GPU'|'CPU'} | {type: 'error', message}
//   main   -> {bitmap: ImageBitmap (transferido), t: timestamp ms crescente}
//   worker -> {type: 'result', landmarks, worldLandmarks (metros), handedness, ms, delegate, bench, face}
//   main   -> {type: 'face', on: true|false}  liga/desliga o modelo de ROSTO (carregado só quando ligado)
//   main   -> {bitmap, t, face: true}         também detecta o rosto neste quadro (main manda em quadros alternados)
//             face = null | {pts: [6 pontos {x, y}: 13 lábio de cima, 14 lábio de baixo, 10 testa, 152 queixo,
//                    33 canto do olho direito, 263 canto do olho esquerdo], ms}
//             bench = null (medindo) | {gpu: ms, cpu: ms} (mediana de cada, depois da escolha)
import {FilesetResolver, HandLandmarker, FaceLandmarker} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const BENCH_N = 30, WARMUP = 5;     // as primeiras leituras de cada um incluem compilação/aquecimento
let files, landmarkers = {}, delegate, phase, bench = null;
const samples = {GPU: [], CPU: []};

const cfg = d => ({baseOptions: {
    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    delegate: d},
  runningMode: "VIDEO", numHands: 2,
  minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5});

async function init() {
  files = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  // O MediaPipe carrega o "loader" do WASM com importScripts(), que não existe em worker de módulo.
  // Baixamos o loader antes e trocamos importScripts por um eval global (síncrono) desse código.
  const loaderCode = await (await fetch(files.wasmLoaderPath)).text();
  self.importScripts = (...urls) => {
    for (const u of urls) {
      if (u !== files.wasmLoaderPath) throw new Error('importScripts inesperado: ' + u);
      (0, eval)(loaderCode);
    }
  };
  try { landmarkers.GPU = await HandLandmarker.createFromOptions(files, cfg("GPU")); delegate = 'GPU'; phase = 'GPU'; }
  catch (e) { landmarkers.CPU = await HandLandmarker.createFromOptions(files, cfg("CPU")); delegate = 'CPU'; phase = 'done'; }
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

function record(ms) {
  if (phase === 'done' || phase === 'loading') return;
  samples[delegate].push(ms);
  if (samples[delegate].length < WARMUP + BENCH_N) return;
  if (phase === 'GPU') {
    // GPU medida: carrega a CPU sem parar a detecção (segue na GPU enquanto carrega)
    phase = 'loading';
    HandLandmarker.createFromOptions(files, cfg("CPU")).then(lm => {
      landmarkers.CPU = lm; delegate = 'CPU'; phase = 'CPU';
    }, () => { phase = 'done'; });
  } else if (phase === 'CPU') {
    const g = median(samples.GPU.slice(WARMUP)), c = median(samples.CPU.slice(WARMUP));
    const keep = c < g ? 'CPU' : 'GPU', drop = keep === 'CPU' ? 'GPU' : 'CPU';
    delegate = keep; landmarkers[drop].close(); delete landmarkers[drop];
    bench = {gpu: Math.round(g), cpu: Math.round(c)};
    phase = 'done';
  }
}

const ready = init().then(
  () => postMessage({type: 'ready', delegate}),
  e => postMessage({type: 'error', message: String(e?.message || e)}));

// ---------- rosto (opcional) ----------
const FACE_IDX = [13, 14, 10, 152, 33, 263];
let faceLm = null, faceLoading = null, faceOn = false;
function loadFace() {
  if (faceLm || faceLoading) return faceLoading;
  const fcfg = d => ({baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: d},
    runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false});
  faceLoading = FaceLandmarker.createFromOptions(files, fcfg(delegate))
    .catch(() => FaceLandmarker.createFromOptions(files, fcfg('CPU')))
    .then(lm => { faceLm = lm; }, e => { faceLoading = null; postMessage({type: 'faceError', message: String(e?.message || e)}); });
  return faceLoading;
}

onmessage = async ({data}) => {
  await ready;
  if (data.type === 'face') { faceOn = data.on; if (faceOn) loadFace(); return; }
  const {bitmap, t} = data;
  const used = delegate;
  try {
    const t0 = performance.now();
    const r = landmarkers[used].detectForVideo(bitmap, t);
    const ms = performance.now() - t0;
    record(ms);
    let face = null;
    if (faceOn && faceLm && data.face) {
      const f0 = performance.now(), fr = faceLm.detectForVideo(bitmap, t), lm = fr.faceLandmarks?.[0];
      face = {pts: lm ? FACE_IDX.map(i => ({x: lm[i].x, y: lm[i].y})) : null, ms: performance.now() - f0};
    }
    postMessage({type: 'result', landmarks: r.landmarks, worldLandmarks: r.worldLandmarks, handedness: r.handedness,
      ms, delegate: used, bench, face});
  } catch (e) {
    postMessage({type: 'result', landmarks: [], worldLandmarks: [], handedness: [], ms: 0, delegate: used, bench,
      error: String(e?.message || e)});
  } finally {
    bitmap.close();
  }
};
