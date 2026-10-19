NOTICE: This sloptastic project takes direct ideas from wispdevons (or dev idk what ur github is as it doesnt work) "ImmichPager" project (this too idk where to find a link to so ye) thanks dev for the idea and thanks claude for stealing it

# Folio for Immich

Share a **themed page** instead of a plain Immich link. Pick albums, choose a look,
publish, and send one beautiful URL to clients, guests or family.

- **Lives inside Immich.** A **Pages** item appears in Immich's sidebar, and you're
  signed in with your Immich account. No second login, no extra users.
- **9 theme presets** (Atelier, Midnight, Darkroom, Linen, Fern, Afterglow, Poster,
  Tide, Blush). You can also set any color and pick from 17 fonts with live previews.
- **4 header styles:** full-bleed Cover, Banner with logo, Split, or Minimal.
  Each comes in 4 heights, left or centered, with adjustable photo darkening.
- **5 album layouts:** Cards, Tiles, Editorial (alternating rows), Feature (one hero
  album and the rest as cards), or **All photos**, which shows every album's photos right on the page.
  Albums can be grouped by year or by your own sections ("Ceremony", "Party"), and
  sorted any way you like.
- **3 photo grids:** Justified rows, Masonry or Square, at three spacing levels.
- **Lightbox and slideshow** with keyboard, swipe, fullscreen, video playback and
  per-photo download.
- **Download whole albums as ZIP** (Immich's own archive endpoint).
- **Password protection, expiry dates, download on/off, hide from search engines.**
  These take effect immediately, even on a page that is already live.
- **Draft → Publish.** Edit freely with a live desktop/tablet/phone preview.
  Visitors only see changes after you click *Update live page*.
- Custom page address (`/p/your-name`), per-album titles, descriptions and cover photos,
  your own cover image and logo, footer text and a contact button. Link previews
  (Open Graph) look good in WhatsApp and iMessage. View counter.

## How it works

Folio is a small Node.js service (no dependencies) that sits **in front of Immich**:

```
browser ──► Folio :2284 ──► Immich :2283
              │
              ├─ /folio        the page editor (uses your Immich session)
              ├─ /p/<slug>     public pages
              └─ everything else is passed through to Immich unchanged
                 (+ a tiny script that adds "Pages" to the sidebar)
```

For each album on a page, Folio creates a private Immich shared link (you'll see them
in Immich under *Shared links*, named `Folio · <page title>`). The link keys stay on
the server. Visitors never see them, because Folio streams photos itself. That's
what lets the page's password, expiry and download rules apply to the photos too.
Removing an album or deleting a page removes its links.

Immich's own "plugins" (v2+/v3) are server-side workflow automations and can't add
UI, so a companion service like this is the way to extend the web app.

## Install (Docker, next to Immich)

> Just want it running? Follow the 4-step **[INSTALL.md](INSTALL.md)**. The details below are for custom setups.

1. Put this `folio/` folder next to your Immich `docker-compose.yml`.
2. Add the service from [`docker-compose.example.yml`](docker-compose.example.yml).
3. Point your domain / reverse proxy at `folio:2284` instead of `immich-server:2283`.
   For example, in Caddy: `reverse_proxy immich_folio:2284`.
4. `docker compose up -d --build`, open Immich, and click **Pages** in the sidebar.

Folio has to be on the **same domain** as Immich. That's how it reuses your Immich
login and adds the sidebar link.

**Alternative (keep your proxy pointing at Immich):** route only `/p/*`, `/folio*`
and `/_folio/*` to Folio. Everything still works except the sidebar link. Open
`https://your-domain/folio` directly.

### Settings

| Variable | Default | |
|---|---|---|
| `IMMICH_URL` | `http://localhost:2283` | How Folio reaches Immich |
| `PORT` | `2284` | |
| `FOLIO_DATA` | `./data` | Pages (`folio.json`) and uploaded logos/covers |
| `PUBLIC_URL` | (from request) | e.g. `https://photos.example.com`, for link previews |
| `FOLIO_PROXY` | `true` | Forward non-Folio requests to Immich |
| `FOLIO_INJECT` | `true` | Add "Pages" to Immich's sidebar |
| `FOLIO_MAX_UPLOAD_MB` | `15` | Max logo/cover upload size |

Back up `FOLIO_DATA` together with Immich.

## Notes & limits

- You can only add albums **you own**. Immich only lets the owner create share links.
  Albums shared with you show a clear message.
- Pages use Google Fonts, which load in the visitor's browser. Pick *System sans* /
  *System serif* if you'd rather avoid that.
- The sidebar link clones Immich's own "Sharing" item. If a future Immich release
  changes its markup, the link may disappear (nothing breaks; use `/folio`).
- Built against the Immich **v3.3** API (album assets come from the timeline
  endpoints, since v3 album responses no longer include assets).

## Development

No build step and no npm dependencies. Node 20+.

```bash
node dev/mock-immich.js     # fake Immich with sample albums on :2283
node src/server.js          # Folio on :2284
node dev/smoke-test.mjs     # end-to-end checks (password, expiry, downloads, CSRF…)
```

Open http://localhost:2284/auth/login, click *Sign in as Wisp*, then **Pages**.

## License

[GPL-3.0-or-later](LICENSE). You can use, change and share Folio freely. If you distribute
a modified version, it has to stay open source under the same license.

Folio is an independent project and is not affiliated with or endorsed by the Immich team.
