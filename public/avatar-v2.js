/* global window, document, Image */
(() => {
const catalog = window.TablemateAvatarParts;
const imageCache = new Map();
const renderCache = new Map();
const subscribers = new Map();
let compositions = 0;
const pick = { bg: _spec => 'disc', hairBack: spec => spec.hair, body: spec => spec.face || 'base',
  nose: spec => spec.nose || 'none',
  outfit: spec => spec.outfit, mouth: spec => spec.mouth, eyes: spec => spec.eyes,
  facialHair: spec => spec.facialHair, brows: spec => spec.brows || 'none', hairFront: spec => spec.hair, glasses: spec => spec.glasses,
  hat: spec => spec.hat, frame: spec => spec.frame };
const tint = { bg: spec => catalog.palette[spec.bg], hairBack: spec => catalog.palette[spec.hairColor],
  body: spec => catalog.skinTones[spec.skin], outfit: spec => catalog.palette[spec.outfitColor],
  facialHair: spec => catalog.palette[spec.facialHairColor], hairFront: spec => catalog.palette[spec.hairColor] };
const specKey = spec => JSON.stringify(Object.fromEntries(Object.keys(spec).sort().map(key => [key, spec[key]])));
function layersFor(spec) {
  return [...catalog.layers].sort((a, b) => a.zOrder - b.zOrder).map(slot => ({ slot: slot.slot,
    id: pick[slot.slot](spec), zOrder: slot.zOrder, tint: tint[slot.slot]?.(spec) || null }));
}
function loadLayer(layer) {
  const key = `${layer.slot}/${layer.id}`;
  if (!imageCache.has(key)) {
    const pending = new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(`Missing avatar layer: ${key}`));
      image.src = `/avatar-layers/${key}.png`;
    });
    imageCache.set(key, pending);
    pending.catch(() => { if (imageCache.get(key) === pending) imageCache.delete(key); });
  }
  return imageCache.get(key);
}
function blankCanvas(size) { const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; return canvas; }
function compose(spec) {
  const layers = layersFor(spec);
  return Promise.all(layers.map(loadLayer)).then(images => {
    const canvas = blankCanvas(catalog.size); const context = canvas.getContext('2d');
    layers.forEach((layer, index) => {
      if (!layer.tint) { context.drawImage(images[index], 0, 0); return; }
      const colored = blankCanvas(catalog.size); const ink = colored.getContext('2d');
      ink.drawImage(images[index], 0, 0);
      ink.globalCompositeOperation = 'multiply'; ink.fillStyle = layer.tint; ink.fillRect(0, 0, catalog.size, catalog.size);
      ink.globalCompositeOperation = 'destination-in'; ink.drawImage(images[index], 0, 0);
      context.drawImage(colored, 0, 0);
    });
    compositions++;
    return canvas;
  });
}
function paint(canvas, source) {
  const context = canvas.getContext('2d'); context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
}
function placeholder(canvas) {
  const context = canvas.getContext('2d'); const middle = canvas.width / 2;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#e6e8e8'; context.beginPath(); context.arc(middle, middle, middle - 1, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#9ca5a9'; context.beginPath(); context.arc(middle, middle * .8, middle * .25, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.ellipse(middle, middle * 1.45, middle * .42, middle * .25, 0, 0, Math.PI * 2); context.fill();
}
function mount(canvas, spec) {
  const key = specKey(spec);
  const cached = renderCache.get(key);
  if (cached?.image) { paint(canvas, cached.image); return canvas; }
  placeholder(canvas);
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key).add(canvas);
  if (!cached) {
    const pending = { image: null };
    renderCache.set(key, pending);
    compose(spec).then(image => {
      pending.image = image;
      for (const target of subscribers.get(key) || []) paint(target, image);
      subscribers.delete(key);
    }).catch(() => {
      renderCache.delete(key); subscribers.delete(key);
    });
  }
  return canvas;
}
function render(spec, px = 64, name = 'player') {
  const size = Number.isInteger(px) && px >= 16 && px <= 160 ? px : 64;
  const canvas = blankCanvas(size); canvas.className = 'profile-avatar profile-avatar-v2';
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Character avatar of ${String(name).slice(0, 20)}`);
  return mount(canvas, spec);
}
function markup(spec, px = 64, name = 'player') {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = px;
  canvas.className = 'profile-avatar profile-avatar-v2';
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Character avatar of ${String(name).slice(0, 20)}`);
  canvas.dataset.avatarV2 = JSON.stringify(spec);
  return canvas.outerHTML;
}
function hydrate(root = document) {
  root.querySelectorAll('canvas[data-avatar-v2]').forEach(canvas => {
    try { mount(canvas, JSON.parse(canvas.dataset.avatarV2)); }
    catch { placeholder(canvas); }
  });
}
window.AvatarV2 = Object.freeze({ specKey, layersFor, render, markup, hydrate,
  stats: () => ({ compositions, images: imageCache.size, specs: renderCache.size }) });
})();
