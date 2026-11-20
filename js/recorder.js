// Gravação de vídeo da performance: câmera + escurecimento + desenho do canvas + som, num MP4/WebM.
//
// O vídeo da câmera é mostrado pelo <video> (não está no canvas), então durante a gravação cada
// quadro desenhado é composto num canvas próprio (recFrame), que vira o stream gravado.
// O áudio vem de audioStream() (saída final, depois do compressor).
// No iPhone, o arquivo é entregue pela folha de compartilhar (salvar em Fotos, TikTok, etc.);
// no PC, é baixado.
import {video, frameBox, mirror} from './camera.js';
import {cv, W, H} from './view.js';
import {audioStream} from './audio.js';

// Formato: Safari/iPhone só grava MP4 (e é o que o app Fotos aceita). Nos outros navegadores o WebM é o
// confiável: um Chromium sem codec H.264 aceitou 'video/mp4' mas gerou arquivo só com áudio (testado).
const MP4 = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4'];
const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(navigator.userAgent);
const TYPES = isSafari ? [...MP4, ...WEBM] : [...WEBM, ...MP4];
const MAX_SIDE = 1280;                 // resolução máxima do vídeo gravado (lado maior)
let rec = null, chunks = [], rc, rctx, sc = 1, t0 = 0;

export const recSupported = () => !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
export const isRecording = () => !!rec;
export const recSeconds = () => rec ? (performance.now() - t0) / 1000 : 0;

export function startRec() {
  if (!recSupported()) throw new Error('Este navegador não grava vídeo.');
  sc = Math.min(1, MAX_SIDE / Math.max(W, H));
  rc = document.createElement('canvas');
  rc.width = Math.round(W * sc / 2) * 2; rc.height = Math.round(H * sc / 2) * 2;   // codecs pedem lados pares
  rctx = rc.getContext('2d');
  recFrame();
  const stream = rc.captureStream(30);
  const as = audioStream();
  if (as) for (const tr of as.getAudioTracks()) stream.addTrack(tr);
  const mimeType = TYPES.find(t => MediaRecorder.isTypeSupported(t));
  rec = new MediaRecorder(stream, mimeType ? {mimeType, videoBitsPerSecond: 5e6} : {});
  chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start(1000);
  t0 = performance.now();
}

// compõe o quadro atual (chamar depois de desenhar o canvas principal)
export function recFrame() {
  if (!rctx) return;
  rctx.setTransform(sc, 0, 0, sc, 0, 0);
  rctx.fillStyle = '#000'; rctx.fillRect(0, 0, W, H);
  if (video.readyState >= 2 && video.videoWidth) {
    const b = frameBox();
    rctx.save();
    if (mirror) { rctx.translate(W, 0); rctx.scale(-1, 1); }
    rctx.drawImage(video, b.ox, b.oy, b.dw, b.dh);
    rctx.restore();
  }
  rctx.fillStyle = 'rgba(0,0,0,.35)'; rctx.fillRect(0, 0, W, H);        // mesmo escurecimento do #shade
  rctx.drawImage(cv, 0, 0, W, H);
}

// para a gravação e devolve o arquivo
export function stopRec() {
  return new Promise(resolve => {
    if (!rec) return resolve(null);
    const r = rec;
    r.onstop = () => {
      const type = r.mimeType || (chunks[0] && chunks[0].type) || 'video/webm';
      const blob = new Blob(chunks, {type});
      rec = null; rctx = null; chunks = [];
      resolve(blob);
    };
    r.stop();
  });
}

// entrega o vídeo: compartilhar (iPhone) ou baixar (PC). Precisa ser chamado num toque do usuário.
export async function saveVideo(blob) {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const name = `harpa-de-ar-${stamp}.${ext}`;
  const file = new File([blob], name, {type: blob.type});
  if (navigator.canShare && navigator.canShare({files: [file]})) {
    try { await navigator.share({files: [file], title: 'Harpa de Ar'}); return 'compartilhado'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelado'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return 'baixado';
}
