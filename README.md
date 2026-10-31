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

## RinkSide: cull, caption and export hockey photos

<img src="public/rinkside/icon.svg" width="40" align="left" alt="">

A second sidebar item, **RinkSide**, is a fast culling and captioning tool for hockey
games, built for a laptop at the rink. Open it in **Edge or Chrome** on your Immich
address (the `https://` one).

- **Straight from the memory card.** The browser reads the card directly; nothing is
  uploaded while you cull. RinkSide never converts RAW files: it shows the camera JPEG,
  or the full-size JPEG already inside the NEF, and decodes the next few photos ahead.
  Holding an arrow key skims thumbnails.
- **Several bodies, one timeline.** NEF+JPG pairs are matched, and NEF-only shots work
  too. Cameras are merged by capture time down to the hundredth of a second, with a
  clock fix per camera. Both bodies' `DSC_0001` files stay apart.
- **Liiga games in one click.** In Game setup, choose the game from the photos' day.
  RinkSide fills in both teams, the arena and the city, and loads both lineups from
  liiga.fi with jersey numbers, positions and player photos. Before a lineup is out, it
  uses the season roster. Other leagues work too: type the teams and paste the rosters.
- **Tap the players.** The **Players** tab shows each team's players with their photos
  and numbers. Click the ones in the photo and the caption, keywords and Immich tags
  follow. Typing `23 a12` (home 23, away 12) still works, and so do Photo Mechanic codes
  like `\23\` and `\a12\` in custom captions. Rosters are remembered per team. If you
  don't want player names at all, switch off **Tag players** in Game setup.
- **Look and crop.** White balance from the ice (click it, or automatic), exposure,
  contrast, highlights, shadows, saturation. A look covers the whole game or one photo,
  and can be pasted to all picks. There are **presets**: Arena punch, Bright ice, Black
  & white and more, plus your own, saved to your account. Crop offers free, 3:2, 4:5,
  16:9, 1:1 and 9:16.
- **Automatic horizon.** Press `H` and RinkSide levels the photo from the boards, glass
  and lines on the ice, trimming the edges so no corners are empty. There's also a
  **Straighten** slider, and **Auto horizon for all picks**.
- **Export** writes resized JPEGs to a folder you choose. The camera EXIF is kept, and
  caption, byline, copyright, keywords and date go in as **IPTC and XMP**, for Photo
  Mechanic, Lightroom and wire services. It can also copy the picked NEF+JPG files with
  `.xmp` sidecars.
- **Export to Immich** sends those edited JPEGs (look and crop applied) to an album in
  Immich, tagged `RinkSide/Edit`. If the original was synced, the edit is stacked on top
  of it. Exporting again skips unchanged photos. A photo you changed replaces its earlier
  edit, and the old edit goes to Immich's trash. RinkSide can only trash its own edits,
  never originals.
- **Sync to Immich** uploads the originals, with your own Immich login (no API key):
  - uploads skip anything Immich already has (SHA-1 check);
  - NEF+JPG pairs are stacked;
  - picks become favorites and a `RinkSide/Pick` tag;
  - rejects are archived or tagged, never deleted;
  - stars become ratings and captions become descriptions;
  - players and teams become tags (`Players/…`, `Teams/…`);
  - each game gets an album.

  It can also suggest names for Immich's face-recognition People, and you can cull or
  caption an existing Immich album instead of a card.

Picks, stars, captions, looks and crops are saved by Folio for your Immich account as
you go, so you can close the laptop and carry on later. You'll be asked to reconnect
the card after a reload.

**First game:**

1. Click **Open a card…** and choose the card; use **Add another card** for a second
   body. Then click **Start culling**.
2. In **Game setup**, choose the **Liiga game** (or type the teams and paste the
   rosters), then add your byline and copyright. Under **Cameras**, a body whose clock
   was off gets a fix like `+2:05`.
3. Cull with `→`, `P`, `X` and `1`–`5`. Click the players in the **Players** tab (or type
   `23 a12`). Press `Shift+W` on a photo with lots of ice to set the white balance, and
   `H` to level a crooked one.
4. Use **Export** (`Ctrl+E`) for the agency, or choose **Send to: Immich** for the edited
   versions. Use **Sync** to put the originals in Immich.

| Keys | |
|---|---|
| `←` `→` (hold to skim), `Home` `End` | move |
| `Space`/`P`, `X`, `U` | pick, reject, unflag |
| `1`–`5`, `0` | stars |
| `Z` or click, drag | 100% focus check, pan |
| `G` / `E` | grid / loupe |
| `Enter`, `Shift+Enter`, `=` | type players, save and go to the next photo, same as previous |
| `T` | custom caption |
| `W` / `Shift+W` | white balance: click the ice / automatic |
| `Ctrl+C` / `Ctrl+V` / `Ctrl+Shift+V` | copy / paste look / paste to all picks |
| `\` (hold) | before / after |
| `C`, `R`, `Enter`, `Esc` | crop, rotate box, apply, cancel |
| `H` | automatic horizon |
| `A`, `Ctrl+Z`, `Ctrl+E`, `?` | auto-advance, undo, export, all shortcuts |

Firefox and Safari can't keep access to a card or write to a folder. They pick the card
again after a reload, and export as a ZIP download. Why RinkSide isn't an Immich plugin,
and the Immich API it uses, is explained in [docs/rinkside.md](docs/rinkside.md).

## How it works

Folio is a small Node.js service (no dependencies) that sits **in front of Immich**:

```
browser ──► Folio :2284 ──► Immich :2283
              │
              ├─ /folio        the page editor (uses your Immich session)
              ├─ /p/<slug>     public pages
              ├─ /rinkside     RinkSide (photos stay in the browser; games are saved here)
              └─ everything else is passed through to Immich unchanged
                 (+ a tiny script that adds "Folio" and "RinkSide" to the sidebar)
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

**Alternative (keep your proxy pointing at Immich):** route only `/p/*`, `/folio*`,
`/rinkside*` and `/_folio/*` to Folio. Everything still works except the sidebar link. Open
`https://your-domain/folio` directly.

### Settings

| Variable | Default | |
|---|---|---|
| `IMMICH_URL` | `http://localhost:2283` | How Folio reaches Immich |
| `PORT` | `2284` | |
| `FOLIO_DATA` | `./data` | Pages (`folio.json`), uploaded logos/covers, and RinkSide games (`rinkside/`) |
| `PUBLIC_URL` | (from request) | e.g. `https://photos.example.com`, for link previews |
| `FOLIO_PROXY` | `true` | Forward non-Folio requests to Immich |
| `FOLIO_INJECT` | `true` | Add "Folio" and "RinkSide" to Immich's sidebar |
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
node dev/rinkside-test.mjs  # RinkSide: sample Z50II/D3 cards, culling, export (checked
                            # with Pillow), sync to a mock Immich (needs Python + Pillow, Edge/Chrome)
```

Open http://localhost:2284/auth/login, click *Sign in as Wisp*, then **Folio**.

## License

[GPL-3.0-or-later](LICENSE). You can use, change and share Folio freely. If you distribute
a modified version, it has to stay open source under the same license.

Folio is an independent project and is not affiliated with or endorsed by the Immich team.
