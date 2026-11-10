import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import express from 'express';

export const hasUnityBuild = root => existsSync(join(root, 'index.html'));
const contentTypes = { '.wasm': 'application/wasm', '.data': 'application/octet-stream',
  '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

export function unityHeaders(res, path) {
  const encoding = path.endsWith('.gz') ? 'gzip' : path.endsWith('.br') ? 'br' : null;
  const plain = encoding ? path.slice(0, -(encoding === 'gzip' ? 3 : 3)) : path;
  if (encoding) res.setHeader('Content-Encoding', encoding);
  const type = contentTypes[extname(plain)];
  if (type) res.setHeader('Content-Type', type);
  if (/\.[a-f0-9]{8,}\./i.test(plain)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  else res.setHeader('Cache-Control', 'no-cache');
}

export function unityStatic(root, enabled) {
  const files = express.static(root, { fallthrough: false, setHeaders: unityHeaders });
  return (req, res, next) => {
    if (!enabled) { res.status(404).end(); return; }
    const current = String(res.getHeader('Content-Security-Policy') || '');
    res.setHeader('Content-Security-Policy', current.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'"));
    files(req, res, next);
  };
}
