# Tablemate character pipeline

## Current path

`avatar-art/manifest.json` is the catalog and layer order. `npm run avatars:build` exports each 256×256 SVG into identical PNGs for Unity Resources and `public/avatar-layers/`. `scripts/gen-avatar-enums.js` generates the same allowed IDs for the server, browser, and Unity. The Unity `LayerCompositor` renders the live preview, and the WebGL bridge sends a version 2 avatar specification to `/api/me/profile`. The server validates each part and color before saving it. `public/avatar-v2.js` renders the same layers into a small canvas for profiles, seats, friends, and leagues; the Unity runtime is only loaded in the creator.

Older version 2 specifications omit the new `face`, `nose`, and `brows` fields. They retain the original `base`, `none`, and `none` layers. Existing icon and photo avatars continue through their previous paths. Privacy controls still decide whether avatars appear at tables.

## Art and editor rules

Every source layer uses a 256×256 canvas and shared face coordinates. The head stays centered at x=128, eyes at x=103/153 and y=115, nose at y=130, and mouth at y=148. New face variants keep the same hairline, neck, ear, and clothing anchors. Tintable layers are grayscale; color IDs are allowlisted in the manifest. `npm run avatars:check` verifies SVG export, image dimensions, tintability, unique IDs, generated catalog parity, and deterministic output. `node scripts/avatar-contact-sheet.js` captures representative characters at 32, 40, 56, 96, and 160 pixels for visual review.

The Unity creator keeps its live character preview visible on phones. Back and Save are in the header; choices, swatches, Undo, Redo, Shuffle, and Reset stay in the control panel. Save is explicit. Subtle breathing, blinking, brow movement, and mouth movement are preview only and stop with reduced motion. The simple builder remains the fallback when WebGL cannot load and remains the accessible alternative for screen readers.

## Source references

The modular slot catalog was informed by [Kopes SpriteComposer 2D](https://github.com/keshavprasadneupane/Kopes-SpriteComposer-2D) and [LPC Unity Character Creator](https://github.com/TCLowe1982/LPC-Unity-Character-Creator). No pixel art or project code was imported from them. The `soft` and `raised` brow shapes were adapted from MIT-licensed [Avataaars](https://github.com/fangpenlin/avataaars); see `avatar-art/ATTRIBUTION.md` and `avatar-art/AVATAAARS-LICENSE.txt`. Other new layers were drawn for Tablemate.

## QA

- Build: `npm run avatars:build && npm run avatars:check && npm run unity:check`
- Browser render: `node scripts/check-avatar-render.js && node scripts/avatar-contact-sheet.js`
- Full project: `npm run lint && npm test && node scripts/simulate-four.js`
- Unity: build `BuildScript.BuildWebGL` in Unity 6000.3.26f1, then `node scripts/install-unity-build.js`

Screenshots and measured build sizes belong in `artifacts/qa/` during review. The avatar artwork is static at the poker table, so additional Unity layers do not add a Unity runtime cost to gameplay.

The checked-in WebGL download (data, framework, loader, wasm) measured 8,083,125 bytes before this change and 8,105,171 bytes after it: an increase of 22,046 bytes (0.27%). This is a compressed-file comparison, not a mobile network or startup benchmark. Headless Chromium loaded the finished editor without page errors or horizontal overflow at 360×740, 390×844, 768×1024, and 1280×800. Physical iOS Safari and Android Chrome performance still need device testing.
