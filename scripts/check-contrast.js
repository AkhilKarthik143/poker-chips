import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/tokens.css', import.meta.url), 'utf8');
const themes = new Map();
for (const match of source.matchAll(/:root\[data-theme="([a-z]+)"\]\s*\{([^}]*)\}/g)) {
  const tokens = new Map();
  for (const declaration of match[2].split(';')) {
    const [name, value] = declaration.split(':').map(part => part.trim());
    if (name?.startsWith('--') && value) tokens.set(name.slice(2), value);
  }
  themes.set(match[1], tokens);
}

function rgb(hex, theme, token) {
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
  const [light, dark] = [luminance(rgb(first, theme, first)), luminance(rgb(second, theme, second))].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const failures = [];
const backgrounds = ['bg-page', 'bg-panel', 'bg-table', 'bg-seat-empty', 'bg-seat-occupied'];
for (const name of ['felt', 'midnight', 'burgundy', 'graphite', 'daylight']) {
  const theme = themes.get(name);
  if (!theme) { failures.push(`Missing theme block: ${name}`); continue; }
  const check = (first, second, minimum, label) => {
    const ratio = contrast(theme, first, second);
    if (ratio < minimum) failures.push(`${name}: ${label} ${ratio.toFixed(2)}:1 (needs ${minimum}:1)`);
  };
  for (const background of backgrounds) check('text-primary', background, 4.5, `text-primary on ${background}`);
  check('text-secondary', 'bg-panel', 4.5, 'text-secondary on bg-panel');
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
}

if (failures.length) {
  process.stderr.write(`Contrast checks failed:\n${failures.map(item => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Contrast checks passed for ${themes.size} themes.\n`);
}
