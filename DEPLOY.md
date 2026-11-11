# Publish to GitHub and Render

Repository: [AkhilKarthik143/poker-chips](https://github.com/AkhilKarthik143/poker-chips). The repository is public.

## 1. Get the source

```sh
git clone https://github.com/AkhilKarthik143/poker-chips.git
cd poker-chips
npm ci
npm run lint && npm test
```

## 2. Apply the Render Blueprint

1. Open [Render](https://dashboard.render.com/) and sign in.
2. Select **New > Blueprint**.
3. Connect GitHub if needed, then select **poker-chips**.
4. Render reads `render.yaml`: one free Node service, Node 20, build `npm ci`, start `npm start`, health check `/healthz`.
5. Select **Apply** (or the equivalent deploy confirmation in the current UI).
6. Wait for **Live**, open the assigned `https://…onrender.com` address, and share that address with players.

Use the service’s assigned URL below:

```sh
read -r -p 'Render service URL (https://...onrender.com): ' TABLE_URL
curl -f "$TABLE_URL/healthz"
```

The `read -p` example above is for Bash. In Zsh use:

```sh
read 'TABLE_URL?Render service URL (https://...onrender.com): '
curl -f "$TABLE_URL/healthz"
```

A successful response is `{"ok":true}`. Create a room and join it from a second device before game night.

## Operations

- Leave Render’s assigned `PORT` alone; the server already uses it.
- Keep one instance. Room state is not shared across processes.
- Free instances sleep. Rooms disappear on restart/spin-down, and cold starts can be slow. **Wake it up before game night**, then create your room.
- For updates, commit and `git push`; the Blueprint uses the repository’s default branch.
- Core gameplay needs no secrets or environment file. The optional Web Push feature requires the three VAPID values below.
- Optional accounts need `TABLEMATE_DB_PATH` plus at least one sign-in method: `RESEND_API_KEY` and `MAIL_FROM` for email, or `GOOGLE_CLIENT_ID` for Google. Create a Google OAuth Web application client and add the exact HTTPS service origin under authorized JavaScript origins. No client secret or redirect URI is used. Use a persistent disk for SQLite; a free instance's local files can disappear on restart or redeploy. A real Postgres adapter is not included in this local branch. Rooms remain process-local even when history is saved.
- Friends require those same SQLite accounts; schema migration 8 runs automatically on startup. Keep the database on persistent storage so friendships and stored request updates survive restarts. Friends do not require a separate service or push keys. Direct account-to-account table invitation delivery is not configured; the app checks the room and uses the existing copy/share link.

## Optional character creator build

The layered character avatars render in normal tables without Unity. The Unity WebGL editor is optional. Render's `npm ci` build does not compile Unity; deploy a real build in `public/avatar-creator/` to show **Customize character** on profile and onboarding. Build locally using the command in `README.md`, run `node scripts/install-unity-build.js`, verify the creator in a browser, and commit the installed directory if its size is suitable for the repository. Alternatively, configure `UNITY_LICENSE`, `UNITY_EMAIL` and `UNITY_PASSWORD` as GitHub Actions secrets, run the `Avatar Creator WebGL` workflow, download its `tablemate-avatar-creator-webgl` artifact into `unity/AvatarCreator/Builds/WebGL/`, run the installer, and include the installed directory in the Render source. The workflow checks art and generated enums even when license secrets are absent.

Keep the WebGL `.gz` assets compressed on disk. The server sends their MIME and `Content-Encoding: gzip` headers and a CSP with `'wasm-unsafe-eval'` only under `/avatar-creator/`. A missing build leaves the editor route at 404 and hides its links; icon and layered web avatars continue to work. Before deployment, confirm `GET /api/config` reports `avatarCreator: true` only when the build is present and accounts are enabled. A real Unity 6.3 WebGL build is installed locally and has passed Chromium desktop/mobile loading and account-save checks; physical-device behavior remains unverified.

## Optional turn notifications

Web Push is disabled until all three VAPID environment values are set. Generate a key pair once from the project directory:

```sh
npx web-push generate-vapid-keys
```

Set the printed public key as `VAPID_PUBLIC_KEY`, the private key as `VAPID_PRIVATE_KEY`, and a contact such as `mailto:you@example.com` as `VAPID_SUBJECT`. In Render, add these in the service environment settings; the Blueprint declares them as unsynced values so private keys never enter this repository. Keep the same pair across deployments. If any value is missing or invalid, the app continues to work and hides the turn-notification control.

Push notifications require HTTPS in production. On iPhone/iPad, users must add the site to the Home Screen and open that installed app before the enable control appears. Permission is requested only after a seated player taps **Enable turn notifications**. Subscriptions and hidden/visible presence stay in process memory; a server restart clears subscriptions, so users can enable again. A reconnect on the same running server restores its existing subscription from the browser.


## Current service

Live URL: https://poker-chips-o7n9.onrender.com/
Render service: `srv-daoo6p8473hc73d5nkeg`, connected to `AkhilKarthik143/poker-chips`, branch `main`, with automatic deploys. Source updates were published through the signed-in GitHub upload interface because CLI credentials return HTTP 403. Upload extracted source into the matching folders, never the ZIP alone.

For future command-line updates, install GitHub CLI with `brew install gh`, run `gh auth login` and `gh auth setup-git`, reconcile remote changes with `git fetch origin && git merge origin/main`, then run `npm run lint && npm test` and `git push origin main`.

Open https://dashboard.render.com/web/srv-daoo6p8473hc73d5nkeg to check the latest deployed commit. If automatic deployment does not start, choose Manual Deploy → Deploy latest commit.

```sh
curl --fail --show-error https://poker-chips-o7n9.onrender.com/healthz
curl --fail --show-error https://poker-chips-o7n9.onrender.com/app.js | grep 'function positionSeats'
```

Health must return `{"ok":true}`. The second check verifies the ellipse-layout release. Free instances sleep after inactivity; first load may be slow and in-memory rooms disappear on restart.

### Security release
Production origin is RENDER_EXTERNAL_URL, falling back to https://poker-chips-o7n9.onrender.com. Add a custom domain to the allowedOrigins server configuration before using it. Render supplies the trusted edge; only its last forwarded IP hop is used when RENDER=true. HTTPS and same-origin Socket.IO select WSS automatically. Eight-letter room codes and explicit per-action tokens require the updated public/app.js and public/index.html alongside src/validation.js, game.js and server.js. Rooms are in memory and restart on deployment; reconnecting to an expired room returns to entry.
