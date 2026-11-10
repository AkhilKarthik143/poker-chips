/* global window, document */
(() => {
const enums = Object.freeze({ shape: ['circle', 'rounded', 'hex'],
  icon: ['chip', 'spade', 'heart', 'diamond', 'club', 'crown', 'star', 'moon', 'sun', 'bolt', 'anchor', 'gem',
    'flame', 'wave', 'dice', 'target', 'laurel', 'shield', 'comet', 'mountain', 'arcade', 'palm', 'key', 'horseshoe'],
  bg: Array.from({ length: 12 }, (_, index) => `c${index + 1}`),
  accent: Array.from({ length: 12 }, (_, index) => `c${index + 1}`),
  pattern: ['none', 'stripes', 'dots', 'chevrons', 'rings'], frame: ['none', 'plain', 'double'] });
const defaults = Object.freeze({ shape: 'circle', icon: 'chip', bg: 'c1', accent: 'c2', pattern: 'none', frame: 'plain' });
const ns = 'http://www.w3.org/2000/svg';
const valid = spec => spec && typeof spec === 'object' && !Array.isArray(spec) && Object.keys(spec).length === 6 &&
  Object.entries(enums).every(([part, options]) => Object.hasOwn(spec, part) && options.includes(spec[part]));
function svgNode(tag, attributes) {
  const node = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
function renderAvatar(input, size = 40, name = 'player') {
  const spec = valid(input) ? input : defaults;
  const pixels = Number.isInteger(size) && size >= 16 && size <= 160 ? size : 40;
  const svg = svgNode('svg', { viewBox: '0 0 64 64', width: pixels, height: pixels, role: 'img',
    'aria-label': `Avatar of ${String(name).slice(0, 20)}`, class: `profile-avatar av-shape-${spec.shape}` });
  const shape = spec.shape === 'circle' ? ['circle', { cx: 32, cy: 32, r: 29 }]
    : spec.shape === 'rounded' ? ['rect', { x: 3, y: 3, width: 58, height: 58, rx: 16 }]
      : ['path', { d: 'M18 3h28l15 29-15 29H18L3 32Z' }];
  svg.append(svgNode(shape[0], { ...shape[1], class: `av-bg-${spec.bg}` }));
  const patterns = { stripes: 'M7 16 25 4M4 30 32 3M5 46 48 4M17 59 59 17M36 60 60 36',
    dots: 'M13 16h1m11-6h1m24 5h1M9 42h1m43 0h1M20 54h1m25 1h1',
    chevrons: 'm7 20 9-9 9 9m14 0 9-9 9 9M8 47l9-9 9 9m12 0 9-9 9 9',
    rings: 'M32 8a24 24 0 1 0 0 48a24 24 0 1 0 0-48ZM32 18a14 14 0 1 0 0 28a14 14 0 1 0 0-28Z' };
  if (spec.pattern !== 'none') svg.append(svgNode('path', { d: patterns[spec.pattern],
    class: `av-pattern av-accent-${spec.accent}`, 'aria-hidden': 'true' }));
  svg.append(svgNode('use', { href: `/avatars.svg#${spec.icon}`, x: 16, y: 16, width: 32, height: 32,
    class: 'av-icon av-ink-dark', 'aria-hidden': 'true' }));
  if (spec.frame !== 'none') {
    svg.append(svgNode(shape[0], { ...shape[1], class: 'av-frame', 'aria-hidden': 'true' }));
    if (spec.frame === 'double') svg.append(svgNode(spec.shape === 'circle' ? 'circle' : spec.shape === 'rounded' ? 'rect' : 'path',
      { ...(spec.shape === 'circle' ? { cx: 32, cy: 32, r: 25 } : spec.shape === 'rounded'
        ? { x: 7, y: 7, width: 50, height: 50, rx: 12 } : { d: 'M20 7h24l12 25-12 25H20L8 32Z' }),
      class: 'av-frame av-frame-inner', 'aria-hidden': 'true' }));
  }
  return svg;
}
function mountBuilder(container, initial, name, onSave) {
  let spec = { ...(valid(initial) ? initial : defaults) };
  const heading = document.createElement('p'); heading.className = 'helper'; heading.textContent = 'Build your own icon. No photo upload.';
  const preview = document.createElement('div'); preview.className = 'avatar-builder-preview';
  const controls = document.createElement('div'); controls.className = 'avatar-builder-controls';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  function update() {
    preview.replaceChildren(renderAvatar(spec, 96, name));
    controls.querySelectorAll('[data-avatar-part]').forEach(button => button.setAttribute('aria-checked', String(spec[button.dataset.avatarPart] === button.dataset.avatarValue)));
  }
  for (const [part, values] of Object.entries(enums)) {
    const section = document.createElement('section'); section.className = 'avatar-builder-part';
    const label = document.createElement('h3'); label.textContent = part === 'bg' ? 'Background' : part[0].toUpperCase() + part.slice(1);
    const grid = document.createElement('div'); grid.className = `avatar-builder-grid avatar-options-${part}`;
    grid.setAttribute('role', 'radiogroup'); grid.setAttribute('aria-label', label.textContent);
    for (const value of values) {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'radio');
      button.dataset.avatarPart = part; button.dataset.avatarValue = value;
      button.setAttribute('aria-label', value.replace(/^c/, 'Color ')); button.setAttribute('aria-checked', String(spec[part] === value));
      if (part === 'bg' || part === 'accent') {
        const swatch = document.createElement('span'); swatch.className = `avatar-swatch av-bg-${value}`; button.append(swatch);
      } else if (part === 'icon') button.append(renderAvatar({ ...defaults, icon: value }, 30, value));
      else button.textContent = value;
      button.addEventListener('click', () => { spec[part] = value; update(); status.textContent = ''; });
      button.addEventListener('keydown', event => {
        if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault(); const index = values.indexOf(value); const next = values[(index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + values.length) % values.length];
        const target = [...grid.querySelectorAll('button')].find(item => item.dataset.avatarValue === next);
        target.click(); target.focus();
      });
      grid.append(button);
    }
    section.append(label, grid); controls.append(section);
  }
  const actions = document.createElement('div'); actions.className = 'avatar-builder-actions';
  const random = document.createElement('button'); random.type = 'button'; random.textContent = 'Randomize';
  random.addEventListener('click', () => { spec = Object.fromEntries(Object.entries(enums).map(([part, values]) => [part, values[Math.floor(Math.random() * values.length)]])); update(); });
  const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset';
  reset.addEventListener('click', () => { spec = { ...(valid(initial) ? initial : defaults) }; update(); });
  const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save avatar'; save.className = 'primary';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try { await onSave({ ...spec }); status.textContent = 'Avatar saved.'; }
    catch (error) { status.textContent = error.message || 'Could not save avatar.'; }
    finally { save.disabled = false; }
  });
  actions.append(random, reset, save);
  container.replaceChildren(heading, preview, controls, actions, status); update();
  return { getSpec: () => ({ ...spec }) };
}
window.TablemateAvatar = Object.freeze({ enums, defaults, valid, renderAvatar, mountBuilder });
})();
