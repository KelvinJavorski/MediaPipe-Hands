// Geometria pura (sem estado).

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a, b) => ({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// retorna posição (0..1) ao longo de q1-q2 onde p1-p2 cruza, ou null
export function crossAt(p1, p2, q1, q2) {
  const d = (p2.x - p1.x) * (q2.y - q1.y) - (p2.y - p1.y) * (q2.x - q1.x);
  if (!d) return null;
  const t = ((q1.x - p1.x) * (q2.y - q1.y) - (q1.y - p1.y) * (q2.x - q1.x)) / d;
  const u = ((q1.x - p1.x) * (p2.y - p1.y) - (q1.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? u : null;
}
