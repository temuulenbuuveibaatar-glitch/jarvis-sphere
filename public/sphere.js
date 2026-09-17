const canvas = document.getElementById('particle-sphere');
const context = canvas.getContext('2d', { alpha: false });
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const categories = ['WORLD', 'CHINA', 'ENGINEERING', 'AIRCRAFT', 'MARKETS', 'OSIRIS'];
const points = Array.from({ length: 4600 }, (_, index) => {
  const y = 1 - 2 * (index + .5) / 4600, angle = index * 2.399963229728653, radius = Math.sqrt(1 - y * y);
  return { index, category: categories[index % categories.length], x: radius * Math.cos(angle), y, z: radius * Math.sin(angle), seed: (index * 127.1) % 31, screenX: 0, screenY: 0, depth: -1 };
});
let previous = 0;
let userYaw = 0, userTilt = 0, userZoom = 1;
function selectAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect(), x = clientX - rect.left, y = clientY - rect.top;
  let nearest, distance = Infinity;
  for (const point of points) {
    if (point.depth < -.3) continue;
    const next = Math.hypot(point.screenX - x, point.screenY - y);
    if (next < distance) { nearest = point; distance = next; }
  }
  if (nearest) window.dispatchEvent(new CustomEvent('sphere-dot-select', { detail: { index: nearest.index, category: nearest.category } }));
}
function preview() {
  let front;
  for (const point of points) if (!front || point.depth > front.depth) front = point;
  if (front) window.dispatchEvent(new CustomEvent('sphere-preview', { detail: { index: front.index, category: front.category } }));
}
function draw(time) {
  const low = document.body.classList.contains('low-power');
  if (document.hidden || time - previous < (low ? 66 : 30)) return requestAnimationFrame(draw);
  previous = time;
  const size = Math.max(1, canvas.clientWidth, canvas.parentElement?.clientWidth || 0), dpr = Math.min(devicePixelRatio || 1, 1.5);
  if (canvas.width !== Math.round(size * dpr)) canvas.width = canvas.height = Math.round(size * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0); context.fillStyle = '#030609'; context.fillRect(0, 0, size, size);
  const t = reduced.matches ? 0 : time * .00012, yaw = t + userYaw, cosine = Math.cos(yaw), sine = Math.sin(yaw), tiltCosine = Math.cos(userTilt), tiltSine = Math.sin(userTilt), active = document.getElementById('reactor').classList.contains('thinking'), radius = size * .385 * userZoom, middle = size / 2;
  for (let index = 0; index < points.length; index += low ? 2 : 1) {
    const point = points[index], x = point.x * cosine + point.z * sine, yawZ = point.z * cosine - point.x * sine, y = point.y * tiltCosine - yawZ * tiltSine, z = yawZ * tiltCosine + point.y * tiltSine, ripple = 1 + .019 * Math.sin(point.seed + t * 7) * (active ? 2 : 1), perspective = 2.8 / (2.8 - z * .3), light = (z + 1) / 2;
    point.screenX = middle + x * radius * ripple * perspective; point.screenY = middle + y * radius * ripple * perspective; point.depth = z;
    context.fillStyle = point.category === 'OSIRIS' && light > .5 ? '#ffd466' : light > .84 ? '#97e9ff' : light > .42 ? '#21c5ff' : '#09678f'; context.globalAlpha = .24 + light * .73;
    const dot = (.55 + light * .8) * size / 560; context.fillRect(point.screenX, point.screenY, dot * 1.35, dot);
  }
  context.lineWidth = Math.max(1, size / 900);
  for (const [factor, start, length, color] of [[.43, .12, 1.18, '#59d7ff'], [.465, 3.38, .76, '#f28a44'], [.49, 1.68, .5, '#59d7ff']]) { context.strokeStyle = color; context.globalAlpha = .65; context.beginPath(); context.arc(middle, middle, radius * factor / .385, start + t * 3, start + length + t * 3); context.stroke(); }
  context.globalAlpha = .5; context.strokeStyle = '#5dcff0'; context.beginPath(); context.moveTo(middle - radius * .58, middle); context.lineTo(middle - radius * .43, middle); context.moveTo(middle + radius * .43, middle); context.lineTo(middle + radius * .58, middle); context.stroke(); context.globalAlpha = 1;
  requestAnimationFrame(draw);
}
canvas.addEventListener('click', event => selectAt(event.clientX, event.clientY));
canvas.addEventListener('wheel', event => { event.preventDefault(); userZoom = Math.max(.72, Math.min(1.32, userZoom - event.deltaY * .001)); if (userZoom > 1.04) preview(); }, { passive: false });
canvas.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const rect = canvas.getBoundingClientRect(); selectAt(rect.left + rect.width / 2, rect.top + rect.height / 2); } });
window.jarvisSphere = { selectAt, drag(dx, dy) { userYaw += dx; userTilt = Math.max(-.7, Math.min(.7, userTilt + dy)); }, zoom(delta) { userZoom = Math.max(.72, Math.min(1.32, userZoom + delta)); } };
requestAnimationFrame(draw);
