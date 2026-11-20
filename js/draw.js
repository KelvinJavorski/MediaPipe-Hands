// Desenho no canvas: primitivas de brilho, cordas elétricas, partículas, rastro e esqueleto.
// Regra de desempenho (iOS): nada de shadowBlur/filtros; brilho = traços sobrepostos com 'lighter'.
import {ctx, dpr} from './view.js';
import {dist} from './geom.js';
import {endPt} from './strings.js';
import {HAND_CONNECTIONS} from './camera.js';

const particles = [];
const MAX_PARTICLES = 300;

export function strokePts(pts, color, w) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}
export function glowLine(pts, hue, w, bright) {
  strokePts(pts, `hsla(${hue},100%,60%,${.10 + .15 * bright})`, w * 8);
  strokePts(pts, `hsla(${hue},100%,65%,${.25 + .4 * bright})`, w * 3);
  strokePts(pts, `hsla(${hue},100%,${80 + 15 * bright}%,1)`, w);
}
// raio por deslocamento de ponto médio entre a e b
export function jagged(a, b, amt) {
  let pts = [a, b], d = dist(a, b) * amt;
  for (let k = 0; k < 5; k++) {
    const np = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) { const p = pts[i], q = pts[i + 1];
      np.push({x: (p.x + q.x) / 2 + (Math.random() - .5) * d, y: (p.y + q.y) / 2 + (Math.random() - .5) * d}, q); }
    pts = np; d /= 2;
  }
  return pts;
}
// orbe brilhante: sprite com gradiente radial pré-renderizado por matiz (drawImage é barato; shadowBlur não)
const glowCache = new Map();
function glowSprite(hue) {
  const key = Math.round(hue / 10) * 10;
  if (glowCache.has(key)) return glowCache.get(key);
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'hsla(0,0%,100%,1)'); gr.addColorStop(.12, `hsla(${key},100%,90%,.95)`);
  gr.addColorStop(.35, `hsla(${key},100%,60%,.35)`); gr.addColorStop(1, `hsla(${key},100%,50%,0)`);
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  glowCache.set(key, c); return c;
}
export function orb(p, hue, r) { ctx.drawImage(glowSprite(hue), p.x - r, p.y - r, r * 2, r * 2); }
// raio elétrico seguindo a curva pts: deslocamento aleatório perpendicular, preso nas pontas
// (cada segmento ganha um ponto do meio com deslocamento menor: aspecto fractal de faísca)
function bolt(pts, nx, ny, amt) {
  const out = [], n = pts.length - 1;
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n, env = Math.min(1, 6 * t * (1 - t)), o = (Math.random() - .5) * 2 * amt * env;
    const p = {x: pts[i].x + nx * o, y: pts[i].y + ny * o};
    if (prev) {
      const m = (Math.random() - .5) * amt * env;
      out.push({x: (prev.x + p.x) / 2 + nx * m, y: (prev.y + p.y) / 2 + ny * m});
    }
    out.push(p); prev = p;
  }
  return out;
}
export function ring(p, r, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
}
export function label(p, text, hue) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = `600 ${13 * dpr}px -apple-system,system-ui,sans-serif`;
  ctx.fillStyle = `hsla(${hue},100%,85%,.95)`; ctx.fillText(text, p.x + 10 * dpr, p.y - 10 * dpr);
  ctx.globalCompositeOperation = 'lighter';
}
export function dot(p, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); }

export function spawn(p, hue, n, power = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = (1 + Math.random() * 4) * dpr * power;
    particles.push({x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, hue});
  }
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
}
export function drawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += .12 * dpr; p.vx *= .97; p.life -= .03;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    dot(p, (1 + 2 * p.life) * dpr, `hsla(${p.hue},100%,${70 + 25 * p.life}%,${p.life})`);
  }
}

// Ao ser tocada a corda começa "puxada" em V no ponto do toque, na direção do dedo
// (amplitude pela força), e vai virando uma vibração senoidal que decai.
// pulse (0..1) = brilho extra no bumbo da batida.
export function drawString(s, now, pulse) {
  const a = endPt(s, 'a'), b = endPt(s, 'b');
  const len = dist(a, b) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const age = (now - s.hitT) / 1000, amp = s.amp * Math.exp(-age * 2.2);
  const pts = [], N = Math.max(8, Math.min(28, Math.round(len / (14 * dpr))));
  const u = s.u, w = Math.min(1, age * 6);
  const osc = amp * s.dir * Math.cos(age * Math.min(14, s.f / 25) * Math.PI * 2);
  for (let i = 0; i <= N; i++) {
    const t = i / N, tri = t < u ? t / u : (1 - t) / (1 - u);
    const off = osc * (tri * (1 - w) + Math.sin(Math.PI * t) * w);
    pts.push({x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off});
  }
  const bright = Math.max(Math.min(1, amp / (12 * dpr)), pulse * .6);
  const hue = s.hue;
  // halo suave + núcleo fino
  strokePts(pts, `hsla(${hue},100%,55%,${.14 + .16 * bright})`, (12 + 10 * bright) * dpr);
  strokePts(pts, `hsla(${hue},100%,65%,${.3 + .3 * bright})`, 5 * dpr);
  strokePts(pts, `hsla(${hue},100%,80%,${.6 + .4 * bright})`, 1.8 * dpr);
  // raios: parada crepita de leve; tocada, os raios abrem e ficam mais brancos
  const zap = (2.5 + 3 * Math.random()) * dpr + amp * .6;
  strokePts(bolt(pts, nx, ny, zap), `hsla(${hue},100%,${80 + 18 * bright}%,${.6 + .4 * bright})`, (1.1 + .7 * bright) * dpr);
  if (bright > .15 || Math.random() < .4) strokePts(bolt(pts, nx, ny, zap * 1.7), `hsla(${hue},100%,88%,${.3 + .5 * bright})`, .9 * dpr);
  // pontas: orbes que pulsam, com núcleo branco
  const r = (24 + 12 * bright + 5 * Math.random()) * dpr;
  orb(a, hue, r); orb(b, hue, r);
  dot(a, 2.5 * dpr, '#fff'); dot(b, 2.5 * dpr, '#fff');
  if (Math.random() < .04 + .4 * bright) spawn(Math.random() < .5 ? a : b, hue, 1, .5 + bright);
  if (bright > .3 && Math.random() < bright) spawn(pts[(Math.random() * pts.length) | 0], hue, 1, .6);
}

// corda sendo esticada entre as pinças (elétrica) + nota prevista
export function drawStretch(stretch, n) {
  glowLine(jagged(stretch.a, stretch.b, .06), n.hue, 2 * dpr, 1);
  strokePts(jagged(stretch.a, stretch.b, .1), `hsla(${n.hue},100%,88%,.6)`, dpr);
  const r = (30 + 6 * Math.random()) * dpr;
  orb(stretch.a, n.hue, r); orb(stretch.b, n.hue, r);
  label({x: (stretch.a.x + stretch.b.x) / 2, y: (stretch.a.y + stretch.b.y) / 2}, n.name, n.hue);
  if (Math.random() < .5) spawn(Math.random() < .5 ? stretch.a : stretch.b, n.hue, 1, .8);
}

export function drawTrail(t) {
  for (let j = 1; j < t.length; j++) {
    const k = j / t.length;
    ctx.strokeStyle = `hsla(190,100%,${60 + 30 * k}%,${k * .8})`; ctx.lineWidth = (2 + 8 * k) * dpr;
    ctx.beginPath(); ctx.moveTo(t[j - 1].x, t[j - 1].y); ctx.lineTo(t[j].x, t[j].y); ctx.stroke();
  }
}

// esqueleto da mão (linhas num único path, pontos num único path)
export function drawSkeleton(pts, pinchPt) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#3dff7a';
  const r = 3.5 * dpr;
  ctx.beginPath();
  for (const c of HAND_CONNECTIONS) { ctx.moveTo(pts[c.start].x, pts[c.start].y); ctx.lineTo(pts[c.end].x, pts[c.end].y); }
  ctx.stroke();
  ctx.fillStyle = '#ff3048'; ctx.beginPath();
  for (const p of pts) { ctx.moveTo(p.x + r, p.y); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); }
  ctx.fill();
  if (pinchPt) dot(pinchPt, 6 * dpr, '#fff');
  ctx.globalCompositeOperation = 'lighter';
}
