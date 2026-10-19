# Installing Folio — the quick version

You need Immich already running with Docker Compose. That's it.

## 1. Download Folio

In the folder that has your Immich `docker-compose.yml`, run:

```bash
git clone https://github.com/Rtx-9/folio-for-immich folio
```

(No git? Download the ZIP from the GitHub page, unzip it and rename the folder to `folio`.) You should end up with:

```
immich-app/
├── docker-compose.yml
├── .env
└── folio/          ← here
```

## 2. Add Folio to `docker-compose.yml`

Open `docker-compose.yml` and paste this under `services:` (same indent as `immich-server:`):

```yaml
  folio:
    container_name: immich_folio
    build: ./folio
    environment:
      IMMICH_URL: http://immich-server:2283
    volumes:
      - ./folio-data:/data
    ports:
      - '2284:2284'
    restart: always
```

## 3. Start it

In the `immich-app` folder:

```bash
docker compose up -d --build
```

## 4. Open Immich through Folio

Use port **2284** instead of 2283:

- Before: `http://your-server:2283`
- Now: `http://your-server:2284`

You'll see normal Immich, with a new **Pages** item in the sidebar. Click it to make your first page.

**Using a domain (reverse proxy)?** Change where it points from `immich-server:2283` to `immich_folio:2284`. For example, in Caddy:

```
photos.example.com {
  reverse_proxy immich_folio:2284
}
```

## Something wrong?

| Problem | Fix |
|---|---|
| No **Pages** in the sidebar | Go to `/folio` directly, e.g. `http://your-server:2284/folio` |
| "Folio could not reach Immich" | Check that `IMMICH_URL` matches your Immich container name (usually `immich-server`) |
| Can't add an album | You can only add albums you own |
| Want to update Folio | Run `git -C folio pull`, then `docker compose up -d --build` again |

Your pages are saved in the `folio-data` folder. Back it up with the rest of Immich.
