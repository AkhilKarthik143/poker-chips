import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/tokens.css', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const baseBlock = source.match(/^:root\s*\{([^}]*)\}/m)?.[1];
if (!baseBlock) throw new Error('Missing base token block in public/tokens.css');

function parseTokens(block) {
  const tokens = new Map();
  for (const declaration of block.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const name = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (name.startsWith('--') && value) tokens.set(name.slice(2), value);
  }
  return tokens;
}

const base = parseTokens(baseBlock);
const themes = new Map();
for (const match of source.matchAll(/:root\[data-theme="([a-z-]+)"\]\s*,\s*\[data-theme-preview="\1"\]\s*\{([^}]*)\}/g)) {
  themes.set(match[1], new Map([...base, ...parseTokens(match[2])]));
}
const highContrast = new Map(base);
for (const match of styleSource.matchAll(/:root\[data-contrast="high"\]\s*\{([^}]*)\}/g)) {
  for (const [key, value] of parseTokens(match[1])) highContrast.set(key, value);
}

function rgb(theme, token) {
  const value = theme.get(token);
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value || '');
  if (!match) throw new Error(`${token} must be a 3- or 6-digit hex color (got ${value || 'missing'})`);
  const digits = match[1].length === 3 ? [...match[1]].map(char => char + char).join('') : match[1];
  return [0, 2, 4].map(offset => parseInt(digits.slice(offset, offset + 2), 16) / 255);
}

function luminance(color) {
  const linear = color.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(theme, first, second) {
  const [light, dark] = [luminance(rgb(theme, first)), luminance(rgb(theme, second))].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const themeNames = ['felt', 'midnight', 'burgundy', 'graphite', 'daylight', 'miami-vice', 'royal-flush', 'retro-arcade'];
const failures = [];
for (const name of themeNames) {
  const theme = themes.get(name);
  if (!theme) { failures.push(`Missing theme block: ${name}`); continue; }
  const check = (first, second, minimum, label) => {
    const ratio = contrast(theme, first, second);
    if (ratio < minimum) failures.push(`${name}: ${label} ${ratio.toFixed(2)}:1 (needs ${minimum}:1)`);
  };

  const surfaces = ['bg-page', 'bg-panel', 'bg-table', 'bg-seat-empty', 'bg-seat-occupied'];
  for (const background of surfaces) check('text-primary', background, 4.5, `primary text on ${background}`);
  check('text-secondary', 'bg-panel', 4.5, 'secondary text on bg-panel');
  check('text-disabled', 'bg-seat-empty', 4.5, 'disabled/open-seat text on bg-seat-empty');
  check('bg-panel', 'accent', 4.5, 'primary-button text on accent');
  check('bg-panel', 'accent-hover', 4.5, 'primary-button text on accent-hover');
  check('dp-color-accent-secondary-ink', 'dp-color-accent-secondary', 4.5, 'text on secondary accent surfaces');
  check('dp-color-accent-warm-ink', 'dp-color-accent-warm', 4.5, 'text on warm accent surfaces');
  check('dp-color-accent-fresh-ink', 'dp-color-accent-fresh', 4.5, 'text on fresh accent surfaces');
  for (const border of ['border-seat-empty', 'border-your-seat', 'border-action-bar-top', 'accent']) {
    for (const background of ['bg-page', 'bg-panel', 'bg-seat-occupied']) check(border, background, 3, `${border} against ${background}`);
  }
  check('net-up', 'bg-panel', 4.5, 'positive settlement text on bg-panel');
  check('net-down', 'bg-panel', 4.5, 'negative settlement text on bg-panel');
  const colors = new Set();
  for (let index = 1; index <= 12; index++) {
    check('avatar-ink-dark', `avatar-c${index}`, 3, `avatar icon on color ${index}`);
    const avatarRatio = contrast(highContrast, 'avatar-ink-dark', `avatar-c${index}`);
    if (avatarRatio < 3) failures.push(`high contrast: avatar ink on color ${index} ${avatarRatio.toFixed(2)}:1 (needs 3:1)`);
    const token = `seat-c${index}`;
    check(token, 'bg-seat-occupied', 3, `${token} against occupied seat`);
    if (colors.has(theme.get(token))) failures.push(`${name}: duplicate seat color ${token}`);
    colors.add(theme.get(token));
    if (contrast(highContrast, token, 'bg-seat-occupied') < 4.5) failures.push(`high contrast: ${token} below 4.5:1`);
  }

  if (name === 'felt') continue;
  const extendedSurfaces = ['bg-stage', 'bg-selected', 'bg-active-seat', 'bg-action-bar'];
  for (const background of extendedSurfaces) check('text-primary', background, 4.5, `primary text on ${background}`);
  for (const background of ['bg-stage', 'bg-seat-empty', 'bg-seat-occupied', 'bg-selected', 'bg-active-seat', 'bg-action-bar']) {
    check('text-secondary', background, 4.5, `secondary text on ${background}`);
  }
  for (const feltSurface of ['bg-table', 'bg-felt-highlight']) {
    check('text-on-felt', feltSurface, 4.5, `felt text on ${feltSurface}`);
    check('text-on-felt-muted', feltSurface, 4.5, `muted felt text on ${feltSurface}`);
  }
  check('dp-color-accent-ink', 'accent', 4.5, 'primary button text on accent');
  check('dp-color-accent-ink', 'accent-hover', 4.5, 'primary button text on accent-hover');
  check('dp-color-danger-ink', 'status-allin', 4.5, 'text on all-in control');
  check('status-allin', 'bg-panel', 4.5, 'danger text on panel');
  check('dp-color-active-ink', 'status-active', 4.5, 'text on active-turn indicator');
  for (const background of ['bg-panel', 'bg-action-bar', 'bg-selected']) check('status-active', background, 4.5, `active-turn label on ${background}`);
  check('border-felt', 'bg-table', 3, 'felt rail against felt');
  for (const border of ['dp-color-focus', 'border-seat-empty', 'border-your-seat', 'border-action-bar-top', 'accent', 'status-active']) {
    for (const background of ['bg-page', 'bg-panel', 'bg-stage', 'bg-seat-occupied', 'bg-selected', 'bg-action-bar']) {
      check(border, background, 3, `${border} against ${background}`);
    }
  }
}

if (themes.size !== themeNames.length) failures.push(`Expected ${themeNames.length} themes, found ${themes.size}`);
for (const surface of ['bg-page', 'bg-panel', 'bg-seat-occupied', 'bg-seat-empty', 'bg-table']) {
  for (const ink of ['text-primary', 'text-secondary']) {
    const ratio = contrast(highContrast, ink, surface);
    if (ratio < 7) failures.push(`high contrast: ${ink} on ${surface} ${ratio.toFixed(2)}:1 (needs 7:1)`);
  }
  const border = contrast(highContrast, 'border-seat-empty', surface);
  if (border < 4.5) failures.push(`high contrast: border on ${surface} ${border.toFixed(2)}:1 (needs 4.5:1)`);
}
if (failures.length) {
  process.stderr.write(`Contrast checks failed:\n${failures.map(item => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Contrast checks passed for ${themes.size} themes.\n`);
}
