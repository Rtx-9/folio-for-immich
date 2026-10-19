NOTICE: This sloptastic project takes direct ideas from wispdevons (or dev idk what ur github is as it doesnt work) "ImmichPager" project (this too idk where to find a link to so ye) thanks dev for the idea and thanks claude for stealing it

<p align="center"><img src="public/icon.svg" width="96" alt="Folio icon"></p>

# Folio for Immich

Share a **themed page** instead of a plain Immich link. Start from a ready-made layout,
add albums or hand-picked photos, choose a look, publish, and send one beautiful URL to
clients, guests or family.

- **Lives inside Immich.** A **Folio** item appears in Immich's sidebar, and you're
  signed in with your Immich account. No second login, no extra users.
- **Build pages from blocks:** Albums, Photos, Text, Quote, Divider and Button. Add,
  reorder (drag and drop), duplicate and delete them freely.
- **Pick individual photos**, not just albums. Browse your whole library month by month,
  open an album, or use Immich's smart search (“beach at sunset”). Add captions.
- **Drag to resize, right in the preview:** pull the header taller or shorter, resize the
  logo, and drag the cover photo to choose which part shows. Click ✎ on any block in the
  preview to jump to its settings.
- **7 ready-made templates:** Wedding, Portfolio, Event recap, Travel journal, Client
  delivery, Photo story and Blank.
- **18 themes** and **36 fonts** (sans, serif, display, handwriting and mono), with any
  custom colors you like.
- **4 header styles** (Cover, Banner, Split, Minimal) with free height, title size,
  alignment, photo darkening and logo size.
- **5 album layouts:** Cards, Tiles, Editorial, Feature, or All photos (every photo
  right on the page). Group albums by year or by your own sections.
- **5 photo layouts** for Photos blocks: Justified, Masonry, Square, Large (one per row)
  and Carousel. Photo height, columns and spacing are adjustable.
- **Lightbox and slideshow** with keyboard, swipe, fullscreen, video playback, captions and
  per-photo download. **ZIP downloads** of whole albums and photo blocks.
- **Password protection, expiry dates, download on/off, hide from search engines.**
  These take effect immediately, even on a page that is already live.
- **Draft → Publish** with a live desktop/tablet/phone preview. Custom page address
  (`/p/your-name`), link previews for WhatsApp/iMessage, and a view counter.

## How it works

Folio is a small Node.js service (no dependencies) that sits **in front of Immich**:

```
browser ──► Folio :2284 ──► Immich :2283
              │
              ├─ /folio        the page editor (uses your Immich session)
              ├─ /p/<slug>     public pages
              └─ everything else is passed through to Immich unchanged
                 (+ a tiny script that adds "Folio" to the sidebar)
```

For each album on a page, Folio creates a private Immich album link, and for each Photos
block an individual link holding exactly those photos. You'll see them in Immich under
*Shared links*, named `Folio · <page title>`. The link keys stay on the server. Visitors never see them, because Folio streams photos itself. That's
what lets the page's password, expiry and download rules apply to the photos too.
Removing an album, a photo or a page removes it from the links. Photos you remove stay
shared until you publish, so the live page never breaks while you edit.

Immich's own "plugins" (v2+/v3) are server-side workflow automations and can't add
UI, so a companion service like this is the way to extend the web app.

## Install (Docker, next to Immich)

> Just want it running? Follow the 4-step **[INSTALL.md](INSTALL.md)**. The details below are for custom setups.

1. Put this `folio/` folder next to your Immich `docker-compose.yml`.
2. Add the service from [`docker-compose.example.yml`](docker-compose.example.yml).
3. Point your domain / reverse proxy at `folio:2284` instead of `immich-server:2283`.
   For example, in Caddy: `reverse_proxy immich_folio:2284`.
4. `docker compose up -d --build`, open Immich, and click **Folio** in the sidebar.

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
| `FOLIO_INJECT` | `true` | Add "Folio" to Immich's sidebar |
| `FOLIO_MAX_UPLOAD_MB` | `15` | Max logo/cover upload size |

Back up `FOLIO_DATA` together with Immich.

## Notes & limits

- You can only share albums and photos **you own**. Immich only lets the owner create share
  links. Albums shared with you show a clear message.
- Smart search needs Immich's machine-learning container. Library and album browsing
  work without it.
- Pages made with older versions of Folio are upgraded to blocks automatically.
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

Open http://localhost:2284/auth/login, click *Sign in as Wisp*, then **Folio**.

## License

[GPL-3.0-or-later](LICENSE). You can use, change and share Folio freely. If you distribute
a modified version, it has to stay open source under the same license.

Folio is an independent project and is not affiliated with or endorsed by the Immich team.
