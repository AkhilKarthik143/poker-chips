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
4. Render reads `render.yaml`: one free Node service, Node 22, build `npm ci`, start `npm start`, health check `/healthz`.
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
- Optional accounts use the remote Turso configuration below. The database also stores nights, sessions, friendships, league records, settings and uploaded avatar photos. Schema migrations 1–9 run before the server accepts traffic. Friends need no separate service or push keys. Direct account-to-account table invitation delivery is not configured; members can share the existing room link. Uploaded photos are cropped to 256×256 WebP before storage and deleted when replaced or when an account is deleted.

## Free persistent accounts on Render

Keep the existing **Free** Render web service. Create a free [Turso Cloud](https://docs.turso.tech/quickstart.md) account and a **libSQL** database. The new Turso Database engine uses a different SDK; this app deliberately uses the supported libSQL client for direct remote access. With the Turso CLI:

```sh
brew install tursodatabase/tap/turso   # macOS
turso auth signup                       # or: turso auth login
turso db create tablemate               # omit --tursodb: create libSQL
turso db show tablemate --url           # copy the libsql:// URL
turso db tokens create tablemate        # copy the secret token privately
```

In the existing [Render service Environment](https://dashboard.render.com/web/srv-daoo6p8473hc73d5nkeg), set these values (never in Git):

| Variable | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | Exact `libsql://…` URL from `turso db show tablemate --url` |
| `TURSO_AUTH_TOKEN` | Write-capable token from `turso db tokens create tablemate` |
| `GOOGLE_CLIENT_ID` | Existing Tablemate Google OAuth Web application client ID |

Leave `TABLEMATE_DB_PATH` unset on Render Free. The app will refuse to start if the remote URL/token is incomplete or the database cannot connect or migrate. It never stores account data in an ephemeral Render file. `RESEND_API_KEY` and `MAIL_FROM` are needed **only** if email-link sign-in should also be available; Google sign-in works without them.

In [Google Cloud Credentials](https://console.cloud.google.com/apis/credentials), open the existing Tablemate **Web application** OAuth client and add `https://poker-chips-o7n9.onrender.com` to **Authorized JavaScript origins**. Keep the localhost origins if you still use the local demo. This implementation uses the Google Identity Services JavaScript callback, so no redirect URI or client secret is required. The client ID is public; the Turso auth token is secret.

Redeploy, then open `https://poker-chips-o7n9.onrender.com/api/config`. It should report `accounts: true` and a non-null `googleClientId`. Open the home page, choose **Sign in → Continue with Google**, complete the popup, and check that **My profile** opens. Sign out, sign back in with the same Google account, and confirm the same username and profile. Redeploy once more and repeat to verify persistence. If the database is temporarily unavailable, `/api/config` returns HTTP 503 with `accounts: false`; account APIs fail closed while guest tables remain usable. Render Free can still spin down and lose *live in-memory rooms*, although Turso account and night data survives.

### Existing local SQLite data

The production service currently has accounts disabled, so it has no persistent account database to migrate. If you have a **local** `data/tablemate.db` with accounts you want to keep, stop the local server, back up the file, and import that existing SQLite file into Turso **instead of creating a new blank database**. The [Turso import command](https://docs.turso.tech/cli/db/import.md) expects WAL journal mode:

```sh
sqlite3 data/tablemate.db 'PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=WAL;'
turso db import data/tablemate.db
```

Use the imported database's URL and a new write token in Render. Do not commit the database file, token or a `.env` file. Verify the imported `schema_version` is 9 and sign in with the same Google identity; the stable Google subject and sessions remain linked to the existing account. Existing local data is **not** copied automatically when you set Turso variables.

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
