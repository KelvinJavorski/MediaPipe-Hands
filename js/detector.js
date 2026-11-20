// Web Worker de detecção: roda o MediaPipe fora do thread principal, para o desenho não travar.
//
// Escolha automática de GPU x CPU: no Safari/iPhone a GPU (WebGL) nem sempre é a mais rápida, porque
// copiar a imagem para a GPU e de volta custa caro, e ela disputa a GPU com o desenho. Então o worker
// começa na GPU, mede BENCH_N detecções, carrega a versão CPU, mede mais BENCH_N e fica com a mais rápida.
//
// Protocolo:
//   worker -> {type: 'ready', delegate: 'GPU'|'CPU'} | {type: 'error', message}
//   main   -> {bitmap: ImageBitmap (transferido), t: timestamp ms crescente}
//   worker -> {type: 'result', landmarks, worldLandmarks (metros), handedness, ms, delegate, bench}
//             bench = null (medindo) | {gpu: ms, cpu: ms} (mediana de cada, depois da escolha)
import {FilesetResolver, HandLandmarker} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

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

onmessage = async ({data}) => {
  await ready;
  const {bitmap, t} = data;
  const used = delegate;
  try {
    const t0 = performance.now();
    const r = landmarkers[used].detectForVideo(bitmap, t);
    const ms = performance.now() - t0;
    record(ms);
    postMessage({type: 'result', landmarks: r.landmarks, worldLandmarks: r.worldLandmarks, handedness: r.handedness,
      ms, delegate: used, bench});
  } catch (e) {
    postMessage({type: 'result', landmarks: [], worldLandmarks: [], handedness: [], ms: 0, delegate: used, bench,
      error: String(e?.message || e)});
  } finally {
    bitmap.close();
  }
};
