# Autonomous Task: Tablemate Character Avatars — Unity WebGL Avatar Creator (paper-doll layers + palette swap)

## Instructions
Continue working until all todos are complete.
Do not stop to ask questions.
Do not wait for confirmation at checkpoints.
Make reasonable assumptions and proceed. Log each assumption in Notes.
If a fix does not work, try a different approach.
Run validation after every meaningful change.
Update progress in this file as you go.

Run rules:
- Work on a new branch `feature/unity-avatars`, created from the newest of `feature/account-identity`, `feature/customization`, `feature/accounts-stats` whose `npm run lint && npm test` pass (log which). Commit after each stage's Gate passes. Never push, never open a PR.
- Commit messages: `feat(avatar): <summary>`. One commit per stage minimum.
- If a stage's Gate still fails after 3 genuinely different approaches, log it under Blockers in Notes, reset to the last Gate commit, and continue with any stage that does not depend on it. Never loop on one problem.
- You almost certainly cannot run the Unity Editor here. Do not pretend otherwise: write everything so it can be validated with Node scripts and Chromium, and list every Unity-only step under "Untested for real" in Notes.

## Task Description
Replace "pick an icon" avatars with customizable 2D character avatars. Approach decision (from the options in the attached research): use **paper-doll sprite layering plus palette-swap tinting** (options 1 and 3). Reject skeletal rigging (Spine/DragonBones: paid or heavy pipeline, overkill for 10 seats at 64 to 128 px) and 2.5D rendering (3D pipeline cost, off-style). Engine: **Unity**, used for the avatar CREATOR (live preview, idle animation, randomize, save). The poker table itself stays vanilla JS and renders avatars with a lightweight canvas compositor from the same layer PNGs.

Art style: flat, rounded, friendly poker-night mascots; 256x256 transparent layers, shown at 64 to 128 px at the table.

### Principles (apply to every stage)
- The app must work with no Unity build present. The existing simple avatar builder (icon + colors, identity spec I3) remains the fallback and stays the default when the Unity build is missing, fails to load, or the device is low-memory.
- Closed vocabularies: an avatar is a small JSON spec of enum ids from one manifest. No image uploads, no URLs, no free-text colors. Server validates the spec; clients never send pixels.
- One source of truth: `avatar-art/manifest.json` (parts, z-order, tintable flags, palette). Enum lists for the server, the web client and Unity are GENERATED from it, with a `--check` mode that fails on drift.
- Feature flag: no database means no accounts and no avatar saving; the creator is hidden and all pre-existing tests pass unchanged. Guests keep deterministic default avatars.
- Strict CSP stays on every route except `/avatar-creator/*`, which gets its own scoped, minimal relaxation (see U5). No inline scripts or `style="..."` anywhere else. No new runtime dependencies (devDependencies for art export only).
- Privacy: avatar specs are public to a room only when the owner has `showAvatarAtTables`; never expose account ids or emails.
- Do not change betting, pot, payout or undo logic.

### Prerequisite check
Required: accounts with sessions, `PUT /api/me/profile` and `avatar_json` (identity spec), `view()` avatars, `public/avatar.js` simple renderer. If the identity spec is missing, implement the minimum (column, strict `PUT` field, `view()` entry) and log it. Run `which Unity Unity.exe unity-editor unity-hub; ls /opt | grep -i unity; node -v; ls node_modules/playwright 2>/dev/null` and record what is installed; this decides which validations can run.

### U1. Art pipeline and manifest (`avatar-art/`)
- Author layer art as SVG sources in `avatar-art/svg/<slot>/<id>.svg` (viewBox 256x256, flat shapes, dark 4 px outline, transparent background). Tintable layers (hair, facial hair, outfit, skin) are drawn in neutral grayscale so multiply-tinting works; non-tintable layers (eyes, mouth, glasses, hat details) are full color.
- Slots and z-order, back to front: `bg`, `hairBack`, `body` (skin tinted), `outfit` (tinted), `mouth`, `eyes`, `facialHair` (tinted), `hairFront` (tinted), `glasses`, `hat`, `frame`.
- Minimum catalog: 8 skin tones, 6 hair styles (including bald), 4 eyes, 4 mouths, 4 facial-hair options (including none), 4 hats (including none; include a poker visor and a cowboy hat), 3 glasses (including none; include shades), 6 outfits, 3 frames (none, plain, double), 12 palette colors used for hair, outfit and backgrounds.
- `avatar-art/manifest.json`: `{ version, size: 256, slots: [{ slot, zOrder, parts: [{ id, file, tintable }] }], palette: [{ id, hex, name }], skinTones: [{ id, hex }] }`; ids are lowercase `[a-z0-9-]`, unique per slot.
- `scripts/avatar-assets.js`: rasterizes every SVG to `public/avatar-layers/<slot>/<id>.png` (256x256 RGBA) with Chromium via Playwright (add `playwright` as a devDependency only if not already available; if it cannot run, log a Blocker and hand-commit nothing for the art export), plus `--check` mode that validates: every manifest file exists, PNGs are 256x256 RGBA, tintable PNGs are grayscale, ids unique, z-orders unique, file sizes under 40 KB each, total under 2 MB.
- Also copy the same PNGs to `unity/AvatarCreator/Assets/Resources/AvatarLayers/<slot>/<id>.png` (the script does this, one source of truth) and write `unity/AvatarCreator/Assets/StreamingAssets/manifest.json`.

### U2. Avatar spec v2, server validation and generated enums
- Spec v2: `{ v: 2, skin, hair, hairColor, eyes, mouth, facialHair, facialHairColor, hat, glasses, outfit, outfitColor, bg, frame }`, every value an id from the manifest (colors from the palette). The existing icon avatar (no `v` field) is spec v1 and stays valid; the server schema is a discriminated union on `v`. Strict: unknown keys and values rejected, max 600 bytes.
- `scripts/gen-avatar-enums.js` generates `src/avatar-parts.js` (ESM, server), `public/avatar-parts.js` (classic script, one global) and `unity/AvatarCreator/Assets/Scripts/AvatarParts.cs` from the manifest; `--check` regenerates in memory and fails if files differ.
- Server: extend identity validation (`src/identity.js` or the accounts validator) to accept v2; `PUT /api/me/profile` stores it; `view()` carries the validated spec; deterministic default v2 spec derived from a hash of the account id (never exposed) for signed-in users without one; guests keep their v1 defaults.
- Tests: v1 and v2 accepted, unknown id/key/oversize rejected, enum parity between server, client and `AvatarParts.cs` (parse C# string arrays with a regex in a Node test), generated files up to date, `view()` carries only the spec.

### U3. Web compositor for tables, rosters and profile
- `public/avatar-v2.js` (classic script): `AvatarV2.render(spec, px)` returns a `<canvas>` (or `<img>` from `toDataURL`, allowed by `img-src 'self' data:`) by loading layer PNGs in z-order from `/avatar-layers/`, tinting tintable layers with the multiply technique (draw the grayscale layer, `globalCompositeOperation = 'multiply'` fill with the color, then `'destination-in'` to restore alpha), and caching the result by a stable `specKey` (sorted JSON). Layers load in parallel; a small neutral placeholder shows until ready; images are cached across seats.
- `public/avatar.js` dispatches by `spec.v`: 2 uses the compositor, anything else uses the existing SVG renderer. Containers keep `role="img"` and `aria-label`.
- Performance: at most 10 distinct specs per table, one network round of at most 12 small PNGs per avatar, cached by the browser; never re-render avatars on every game state update (only when the spec key changes). Respect `prefers-reduced-motion` (no animation here anyway).
- Tests: `specKey` is stable for reordered keys, layer ordering follows `zOrder` (pure function tested through `node:vm`), dispatch picks the right renderer, no re-render when the key is unchanged. If Playwright is available, add a screenshot check that two different specs render different pixels and the same spec renders identical pixels.

### U4. Unity project (`unity/AvatarCreator/`) — code-driven, no hand-authored scenes or prefabs
- Editor version: use the installed Unity LTS if any, otherwise target the latest Unity 6 LTS and record it in `ProjectSettings/ProjectVersion.txt`. Template: 2D, Built-in Render Pipeline (smallest WebGL build). Commit `Assets/`, `Packages/manifest.json`, `ProjectSettings/`; ignore `Library/`, `Temp/`, `Logs/`, `obj/`, `Builds/`, `*.csproj`, `*.sln`, `.vs/` in `unity/AvatarCreator/.gitignore`. Because `.meta` files cannot be produced without the Editor, nothing may depend on authored GUID references: everything is created in code at runtime.
- Scripts in `Assets/Scripts/`:
  - `AvatarParts.cs` (generated), `AvatarSpec.cs` (`[Serializable]` with fields matching the v2 JSON, `FromJson`/`ToJson` via `JsonUtility`, validation against `AvatarParts`).
  - `Catalog.cs`: reads `manifest.json` from StreamingAssets via `UnityWebRequest` and loads sprites from `Resources/AvatarLayers`.
  - `LayerCompositor.cs`: creates one `SpriteRenderer` per slot in z-order under a root, applies tint through `SpriteRenderer.color` (grayscale layers multiply with the Default sprite shader), supports `Apply(AvatarSpec)`.
  - `IdleAnimator.cs`: code-driven idle bob, blink (swap eyes to a closed variant if the manifest provides `blink`, otherwise squash the eyes layer), and a small hat bounce; no Animator controller assets. A static pose when `prefers-reduced-motion` is reported by the page bridge.
  - `CreatorUI.cs`: builds a uGUI `Canvas` (Scale With Screen Size, reference 360x640) at runtime: preview, tabs per slot, option grids with large tap targets (at least 48 px), color swatch rows, Randomize, Reset, Save, Back. Portrait first, works landscape.
  - `Bootstrap.cs` with `[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]` that builds camera, compositor, UI and loads the initial spec.
  - `WebBridge.cs` + `Plugins/WebGL/WebBridge.jslib`: `GetInitialSpec()` (reads `window.TablemateAvatar.initial` JSON from the page), `SaveSpec(json)` (page script performs the `fetch('/api/me/profile', { method: 'PUT', credentials: 'same-origin', body })` and returns success/error text to Unity through `SendMessage`), `GetPrefersReducedMotion()`, `Navigate(url)`. In the Editor a mock bridge reads/writes `Application.persistentDataPath`. Unity never handles cookies or tokens itself.
  - Editor-only: `Editor/LayerImportPostprocessor.cs` (`AssetPostprocessor` that sets every PNG under `Resources/AvatarLayers` to Sprite, single, pixels per unit 256, no mipmaps, bilinear filtering, uncompressed or high-quality compression, no alpha-is-transparency issues), and `Editor/BuildScript.cs` with `public static void BuildWebGL()` that creates and saves a minimal empty scene programmatically (`EditorSceneManager.NewScene`), sets it in `EditorBuildSettings`, applies the Player settings below, and builds to `unity/AvatarCreator/Builds/WebGL` (exit code non-zero on failure).
- Player settings applied in `BuildScript`: product name "Tablemate Avatar Creator", WebGL template `Tablemate` (see U5), compression format Gzip with decompression fallback OFF (the server sets headers, see U5), name files as hashes OFF, data caching ON, exception support "None", managed stripping "High", color space Gamma, memory size 128 MB initial with growth, `runInBackground` false, code optimization "Size".
- If the Editor is available: run `Unity -batchmode -nographics -quit -projectPath unity/AvatarCreator -executeMethod BuildScript.BuildWebGL -logFile unity-build.log` and fix compile errors until it passes. If not available, validate what you can: C# files parse structurally (balanced braces, namespaces, `using` lines) via a Node lint script `scripts/check-unity-sources.js`, `AvatarParts.cs` parity, and every `Resources` path referenced in code exists.

### U5. Build output, hosting and scoped CSP
- Custom WebGL template `unity/AvatarCreator/Assets/WebGLTemplates/Tablemate/` with `index.html`, `loader.js` and `style.css`: NO inline `<script>` or `style=""`; the page shows a progress bar, a "Use simple builder" fallback link to `/me.html`, a visible error message if loading fails, and defines `window.TablemateAvatar` (initial spec from `GET /api/me`, `save` function used by the bridge) in `loader.js`.
- Build output lives at `public/avatar-creator/` (copied from `Builds/WebGL` by `scripts/install-unity-build.js`, which also verifies file presence). The directory is committed only if a real build was produced; otherwise it does not exist and the app serves no creator. Large files go through Git LFS only if `.gitattributes` and `git lfs` are already in use; otherwise note the size in Notes and rely on CI building it at deploy (see U7).
- Server: a small `src/static-unity.js` middleware mounted before `express.static` for `/avatar-creator/`: sets `Content-Type` for `.wasm` (`application/wasm`), `.data`, `.framework.js`, `.loader.js`; for files ending `.gz` or `.br` sets `Content-Encoding` and the underlying type; adds `Cache-Control: public, max-age=31536000, immutable` only for hash-named files; and sets a scoped CSP for this path only: same as the global CSP plus `'wasm-unsafe-eval'` in `script-src`. If headless Chromium can run a real build and it truly requires `'unsafe-eval'` or `blob:` workers, add only the minimum, scoped to this path, and log it as a risk in Notes. The global CSP for every other route must stay byte-for-byte unchanged (test it).
- Capability flag: `GET /api/config` gains `avatarCreator: boolean` (true only when `public/avatar-creator/index.html` exists and accounts are enabled). All creator links and buttons are hidden when false.
- Origin and auth: the creator page calls the same-origin API with the session cookie through the page script; the existing origin check and rate limits apply. A `return` query parameter is allowed only as a relative path starting with `/` and not `//` (open-redirect test).
- Tests: scoped CSP applies only under `/avatar-creator/` and other routes keep the exact global CSP, wasm and gzip header handling for fixture files, `avatarCreator` flag true/false, return-path validation (reject `//evil.com`, absolute URLs, `javascript:`), missing build returns 404 and leaves the app working.

### U6. Integration UI
- `me.html` profile section: "Customize character" button (only if `avatarCreator`), navigating to `/avatar-creator/?return=/me.html`. Onboarding avatar step offers both builders when available. Devices with `navigator.deviceMemory < 4` or a failed load default to the simple builder, with "Use the full creator" as an opt-in link. Players can always switch to the simple builder, which saves a v1 spec (and replaces v2).
- League rosters, standings, Players list and seats render v2 avatars through `public/avatar.js` dispatch. `showAvatarAtTables` is respected.
- Accessibility: the creator page cannot expose its canvas to screen readers, so the profile page shows the avatar with a text description of the chosen parts, and the simple builder remains the accessible path (state this in Notes and README).

### U7. CI, docs and fallbacks
- `.github/workflows/unity-webgl.yml`: on manual dispatch and on changes under `unity/` or `avatar-art/`, run `node scripts/avatar-assets.js --check` and `node scripts/gen-avatar-enums.js --check`, then (when `UNITY_LICENSE`, `UNITY_EMAIL`, `UNITY_PASSWORD` secrets exist) build with `game-ci/unity-builder` using `targetPlatform: WebGL` and `buildMethod: BuildScript.BuildWebGL`, uploading the WebGL build as an artifact. Document that Render deploys must either commit the build to `public/avatar-creator/` or run `scripts/install-unity-build.js` from a downloaded artifact; the app works without it.
- Update `README.md` (avatar approaches and why paper-doll plus palette swap, art pipeline, how to add a part, how to build in Unity, hosting, scoped CSP and its justification, fallback behavior, accessibility note), `DEPLOY.md`, `VALIDATION.md`, `.gitignore`.

## Context
- Relevant files: `avatar-art/**` (new), `scripts/avatar-assets.js`, `scripts/gen-avatar-enums.js`, `scripts/check-unity-sources.js`, `scripts/install-unity-build.js` (new), `src/avatar-parts.js` (generated), `src/static-unity.js`, `src/server.js`, `src/identity.js`; `public/avatar.js`, `public/avatar-v2.js`, `public/avatar-parts.js` (generated), `public/avatar-layers/**` (generated), `public/me.html`, `public/welcome.html`; `unity/AvatarCreator/**` (new); `.github/workflows/unity-webgl.yml`; `test/*.test.js`; `eslint.config.js`, `README.md`, `DEPLOY.md`, `VALIDATION.md`, `.gitignore`.
- Dependencies: Node 20+, Chromium + Playwright for art export (devDependency only, if needed). Unity Editor LTS only for the real WebGL build (probably unavailable here).
- Scripts: `npm run lint` is `eslint . --max-warnings 0`; `npm test` is `node --test test/*.test.js`; `npm start` runs `node src/server.js` (port 3000, `GET /healthz`). Add npm scripts `avatars:build` (`node scripts/avatar-assets.js`) and `avatars:check` (both `--check` scripts).
- Constraints: strict CSP everywhere except the scoped creator path, closed vocabularies, app works without Unity, additive changes only, do not touch `poker-chips-github.zip`, do not push. Out of scope: avatar uploads, animated avatars at the table, emotes in game, equipment unlocks and achievements, marketplace or purchases, Spine/DragonBones, 3D avatars.

## Todo Checklist

### Investigation
- [x] Create branch `feature/unity-avatars` (see Run rules); run `npm ci`
- [x] Run baseline `npm run lint` and `npm test`; record pass counts in Notes
- [x] Run the environment probe from the Prerequisite check; record Unity, Playwright and Node availability in Notes
- [x] Read the existing avatar code (`public/avatar.js`, identity validation, `view()` avatar field) and the global CSP middleware in `src/server.js`; plan the scoped CSP override and the v1/v2 union
- [x] Document findings in Notes

### Implementation
- [x] U1: SVG art, manifest, `avatar-assets.js` with `--check`, generated PNGs. Gate: `node scripts/avatar-assets.js --check`, lint, test, commit
- [x] U2: spec v2, generated enums with `--check`, server validation, `view()`, tests. Gate: lint + test + `gen-avatar-enums.js --check`, commit
- [x] U3: web compositor, dispatch, caching, tests. Gate: lint + test, commit
- [ ] U4: Unity project sources, editor scripts, build script, source checker. Gate: `node scripts/check-unity-sources.js`, lint, test, commit (plus a real Unity build if the Editor exists)
- [ ] U5: template, static middleware, scoped CSP, config flag, install script, tests. Gate: lint + test, commit
- [ ] U6: integration UI and fallbacks. Gate: lint + test, commit
- [ ] U7: CI workflow, docs. Gate: lint + test, commit
- [ ] Add defensive checks for edge cases (missing layer PNG, manifest and enums out of sync, spec from a newer manifest version, slow network while layers load, creator opened while signed out, save failing mid-request, a 10-seat table with 10 distinct v2 avatars)

### Validation
- [ ] Run `npm run lint` and fix any issues (zero warnings)
- [ ] Run `npm test` and ensure all pass, including new tests for spec validation, enum parity (server, client, C#), compositor logic, scoped CSP, headers, return-path validation, config flag
- [ ] Run `npm test` again with no DB env vars set and confirm all original tests pass unchanged and the creator is hidden
- [ ] Run `node scripts/avatar-assets.js --check` and `node scripts/gen-avatar-enums.js --check` and ensure both pass
- [ ] Run `node scripts/check-unity-sources.js` and ensure it passes
- [ ] Run `node scripts/simulate-four.js` and ensure it exits 0
- [ ] If the Unity Editor exists: run the batchmode build command from U4 and ensure exit code 0, then `node scripts/install-unity-build.js` and load `/avatar-creator/index.html` in headless Chromium, confirming no CSP violations in the console beyond the documented scoped relaxation and that the canvas renders; otherwise write "Unity build not verified" in Notes
- [ ] Start `npm start` in the background and run a smoke: `GET /healthz` returns `{"ok":true}`, `GET /` response keeps the exact original CSP header, `GET /avatar-creator/index.html` returns 404 (no build) or the scoped CSP (with build), and `GET /api/config` reports `avatarCreator` correctly; stop the server
- [ ] Run a leak test: serialize every `view()` payload and assert avatars are spec-only (no account id, email, hash)
- [ ] Run `grep -rnE "style=\"|<script>[^<]" public/ --include=*.html --include=*.js --exclude-dir=avatar-creator` and confirm no inline styles or scripts outside the scoped creator build
- [ ] If Playwright is available, screenshot a 10-seat table with ten distinct v2 avatars at 360x740 and 390x844 and confirm no overlap, no horizontal scroll, and avatars legible at 64 px; otherwise list manual checks in Notes
- [ ] Verify regressions: `git diff main -- src/game.js` shows no change to betting, pot, payout or undo logic

### Cleanup
- [ ] Remove debug code and stray `console.log`
- [ ] Update docs/CHANGELOG (README, DEPLOY.md, VALIDATION.md)
- [ ] Final validation: `npm run lint && npm test && node scripts/avatar-assets.js --check && node scripts/gen-avatar-enums.js --check && node scripts/check-unity-sources.js && node scripts/simulate-four.js`
- [ ] Write the final summary at the top of Notes

## Definition of Done
- `avatar-art/manifest.json` and SVG sources define the full catalog (minimums in U1); `public/avatar-layers/**` and the Unity `Resources/AvatarLayers/**` are generated from them and pass `scripts/avatar-assets.js --check`
- Avatar spec v2 is validated server-side as a strict enum-only union with v1, stored through `PUT /api/me/profile`, delivered in `view()`, and enum lists are generated for server, web client and `AvatarParts.cs` with `--check` parity enforced in tests
- `public/avatar-v2.js` renders v2 avatars with tinting and caching at seats, in the Players list, in league views and on the profile; v1 avatars still render; no re-render on unchanged specs
- `unity/AvatarCreator/` contains the complete code-driven Unity project (no hand-authored scenes or prefabs), a batchmode `BuildScript.BuildWebGL`, a CSP-safe WebGL template, a web bridge that saves through the same-origin API, and passes `scripts/check-unity-sources.js`; a real build exists only if the Editor was available
- `/avatar-creator/` is served with correct wasm/gzip headers and a CSP relaxation scoped to that path only; every other route keeps the original CSP byte-for-byte; `avatarCreator` in `/api/config` reflects whether a build exists
- The app, the simple builder and all original tests work with no Unity build and with no database
- All commands in Validation pass: lint with zero warnings, `npm test` green, both `--check` scripts, `check-unity-sources`, `simulate-four` exits 0, `/healthz` OK, leak test clean, no inline styles or scripts outside the scoped creator build
- No regressions in betting, pots, payouts, undo, reconnect/rejoin, seat-token privacy
- At least one commit per stage on `feature/unity-avatars`, and `README.md` documents the pipeline and the Unity build

## Notes
Agent: log progress, assumptions, and blockers here.

### Final summary
(write last)

### Progress log
- Investigation: `feature/account-identity` is the newest passing base; `npm ci`, lint and 105 tests passed before branching. Node 24.20.0 and Playwright 1.65 are installed. No Unity executable was found in PATH or `/opt`. The identity column, strict profile endpoint, room projection and v1 SVG renderer already exist. v2 will extend `validAvatar` while preserving v1; a creator-specific middleware will be mounted before `express.static`, leaving other CSP headers unchanged. Table avatar markup currently uses `outerHTML`, so the canvas path needs post-render hydration.
- U1: Authored 42 transparent SVG layers for 11 z-ordered slots, 12 palette colors and eight skin tones. The Playwright export produced 256×256 RGBA PNGs for web and Unity Resources (169 KB total). `--check` rerenders and compares both copies, checks grayscale tintable layers, dimensions and limits. Lint and all 105 tests pass.
- U2: Manifest-generated server, browser and Unity enums now pass drift checks. Strict v1/v2 validation rejects unknown fields, ids and oversized specs. Signed-in accounts without saved art use a deterministic v2 default; saved v1 art remains valid, and onboarding skip writes v2. A room integration test confirms v2 spec-only projection after profile update. Lint and 107 tests pass; enum check passes.
- U3: Browser compositor now loads 11 z-ordered layers in parallel, tints grayscale slots, caches images and completed specs, and hydrates table markup after each state update. Existing v1 rendering remains. Chromium pixel check produced distinct character images, identical pixels for a repeated spec and zero additional compositions. Lint and 109 tests pass.

### Assumption log
- Target Unity 6.3 LTS (6000.3); no Editor is installed. Unity's own documentation identifies 6.3 as the latest LTS. Exact patch will be pinned to a known published release until an Editor build verifies it. (Investigation/U4)

### Blockers
- (stage, what failed, approaches tried)

### Untested for real
- (Unity Editor build, WebGL on iOS and Android browsers, real memory use, screen readers, anything else)
