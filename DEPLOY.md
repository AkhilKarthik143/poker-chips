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
- No secrets or environment file are required.
