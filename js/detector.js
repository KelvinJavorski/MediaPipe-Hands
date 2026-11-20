// Web Worker de detecção: roda o MediaPipe fora do thread principal, para o desenho não travar.
// Protocolo:
//   worker -> {type: 'ready', delegate: 'GPU'|'CPU'} | {type: 'error', message}
//   main   -> {bitmap: ImageBitmap (transferido), t: timestamp ms crescente}
//   worker -> {type: 'result', landmarks, handedness, ms}
import {FilesetResolver, HandLandmarker} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

let landmarker, delegate;

async function init() {
  const files = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  // O MediaPipe carrega o "loader" do WASM com importScripts(), que não existe em worker de módulo.
  // Baixamos o loader antes e trocamos importScripts por um eval global (síncrono) desse código.
  const loaderCode = await (await fetch(files.wasmLoaderPath)).text();
  self.importScripts = (...urls) => {
    for (const u of urls) {
      if (u !== files.wasmLoaderPath) throw new Error('importScripts inesperado: ' + u);
      (0, eval)(loaderCode);
    }
  };
  const base = {modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"};
  const cfg = d => ({baseOptions: {...base, delegate: d}, runningMode: "VIDEO", numHands: 2,
    minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5});
  try { landmarker = await HandLandmarker.createFromOptions(files, cfg("GPU")); delegate = 'GPU'; }
  catch (e) { landmarker = await HandLandmarker.createFromOptions(files, cfg("CPU")); delegate = 'CPU'; }
}

const ready = init().then(
  () => postMessage({type: 'ready', delegate}),
  e => postMessage({type: 'error', message: String(e?.message || e)}));

onmessage = async ({data}) => {
  await ready;
  const {bitmap, t} = data;
  try {
    const t0 = performance.now();
    const r = landmarker.detectForVideo(bitmap, t);
    postMessage({type: 'result', landmarks: r.landmarks, handedness: r.handedness, ms: performance.now() - t0});
  } catch (e) {
    postMessage({type: 'result', landmarks: [], handedness: [], ms: 0, error: String(e?.message || e)});
  } finally {
    bitmap.close();
  }
};
