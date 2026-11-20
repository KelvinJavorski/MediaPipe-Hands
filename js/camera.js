// MediaPipe Hand Landmarker + câmera + mapeamento landmark -> pixel da tela.
import {FilesetResolver, HandLandmarker} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import {W, H} from './view.js';

export const video = document.querySelector('#v');
export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;   // array de {start, end}
export let mirror = true;
let stream, devices = [], devIdx = -1;

export async function loadModel() {
  const files = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  const base = {modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"};
  const cfg = d => ({baseOptions: {...base, delegate: d}, runningMode: "VIDEO", numHands: 2,
    minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5});
  try { return await HandLandmarker.createFromOptions(files, cfg("GPU")); }
  catch (e) { console.warn('GPU falhou, usando CPU', e); return await HandLandmarker.createFromOptions(files, cfg("CPU")); }
}

export async function openCamera(deviceId) {
  if (stream) stream.getTracks().forEach(t => t.stop());
  const vc = deviceId ? {deviceId: {exact: deviceId}} : {facingMode: 'user'};
  // resolução baixa basta: o modelo reduz a imagem para ~224px; menos pixels = detecção mais rápida
  stream = await navigator.mediaDevices.getUserMedia({audio: false,
    video: {...vc, width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 30}}});
  video.srcObject = stream; await video.play();
  const s = stream.getVideoTracks()[0].getSettings();
  mirror = s.facingMode ? s.facingMode === 'user' : true;
  video.classList.toggle('mirror', mirror);
  devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  devIdx = Math.max(0, devices.findIndex(d => d.deviceId === s.deviceId));
}

// espelhamento manual (câmeras virtuais, como celular usado de webcam, não informam se são frontais)
export function toggleMirror() {
  mirror = !mirror;
  video.classList.toggle('mirror', mirror);
  return mirror;
}

// próxima câmera da lista; retorna false se só há uma
export async function nextCamera() {
  if (devices.length < 2) return false;
  devIdx = (devIdx + 1) % devices.length;
  await openCamera(devices[devIdx].deviceId);
  return true;
}

// mesmo mapeamento do "object-fit: cover" do <video> na tela
export function frameBox() {
  const vw = video.videoWidth, vh = video.videoHeight, sc = Math.max(W / vw, H / vh);
  return {ox: (W - vw * sc) / 2, oy: (H - vh * sc) / 2, dw: vw * sc, dh: vh * sc};
}
export function toScreen(lm, b) { const x = b.ox + lm.x * b.dw; return {x: mirror ? W - x : x, y: b.oy + lm.y * b.dh}; }
