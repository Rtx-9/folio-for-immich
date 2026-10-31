# RinkSide: how it works, and why it isn't an Immich plugin

These notes were checked against the Immich source on 2026-10-30, at release v3.3.5.

## Immich plugins today

- Immich v3.0 added **Workflows**, which the release notes call "the first preview of
  Workflows". A workflow is a trigger plus steps, and each step is a plugin method.
  The triggers are `AssetCreate`, `AssetMetadataExtraction`, `AssetOcrExtraction` and
  `AssetTagged`. You edit workflows under *Utilities → Workflows*.
- A plugin is a **WebAssembly module run by Extism on the server**: a `manifest.json`
  plus a `.wasm` file. Plugins are written in TypeScript and compiled with `extism-js`.
  See `packages/plugin-core` and `packages/plugin-sdk` in the Immich repo.
- The built-in core plugin can filter on file name, EXIF, date, tags or type. Its actions
  can add tags, add to albums, archive, favorite, lock, change visibility, or call a
  webhook.
- **A plugin can't add any web UI**: no pages, panels or sidebar items.
- **External plugins are off by default.** They need `IMMICH_ALLOW_EXTERNAL_PLUGINS=true`
  and `IMMICH_PLUGINS_INSTALL_FOLDER`, and neither variable is in the install docs.
- The plugin SDK isn't published on npm, so building a plugin means building it inside
  an Immich checkout.

## So RinkSide lives in Folio

Folio already sits in front of Immich on the same address, so RinkSide is a page in Folio
(`/rinkside`) with an item in Immich's sidebar:

- **The browser reads the memory card** through the File System Access API in Edge and
  Chrome. Photos aren't uploaded while you cull. The card's folder handle is remembered
  in the browser (IndexedDB), and permission is asked again after a reload. Other
  browsers fall back to a folder-upload field.
- **Folio stores each user's games** under `FOLIO_DATA/rinkside/<immich user id>/`: picks,
  stars, players, captions, looks, crops, camera clock fixes, rosters and sync progress.
  You're identified by your Immich login, like in Folio's page editor.
- **Immich is reached through Folio** (`/_folio/api/rinkside/immich/…`). Folio adds your
  Immich session server-side and only allows the calls RinkSide needs. Uploads stream
  through without being stored. No API key is needed.
- **Export** is done in the browser:
  - the GPU applies the look and crop, and the browser encodes the JPEG;
  - RinkSide writes the camera EXIF (orientation reset to 1, new pixel size), IPTC IIM
    (UTF-8, with the MD5 digest Lightroom checks) and XMP;
  - the result goes to the folder you choose, or to a ZIP in browsers without folder
    access.
- **Export to Immich** uploads those edited JPEGs instead of writing files:
  - they go into an album, tagged `RinkSide/Edit`, and are stacked on top of the synced
    original;
  - an edit is uploaded again only when something that changes its pixels has changed
    (look, crop, size, quality);
  - the replaced edit is moved to Immich's trash. Folio only allows that for asset IDs
    recorded as RinkSide edits in your games, with `force: false`, so originals can't be
    deleted this way, and nothing is ever deleted permanently.

- **Liiga data** comes from liiga.fi's public API, fetched and cached by Folio, because
  liiga.fi doesn't let a browser call it directly:
  - `/api/v2/games?tournament=…&season=…` for games by date, with teams, arena and city;
  - `/api/v2/games/{season}/{id}` for both lineups, with jersey numbers, positions and
    photo links (players marked as removed are left out);
  - `/api/v2/players/stats/summed/…` for season rosters, used before a lineup is out.

  Player photos are only fetched from Liiga's own storage and are cached in
  `FOLIO_DATA/rinkside/liiga`. Liiga seasons are named by the year they end (autumn 2026
  is season 2027). For tests, `LIIGA_URL` and `LIIGA_PHOTO_PREFIX` point to a fake.
- **Automatic horizon** runs in the browser:
  - a Sobel filter keeps edges that are nearly horizontal, and a Hough transform within
    ±10° finds the angle of the longest straight lines (boards, kick plate, glass, lines
    on the ice);
  - the photo is turned on the GPU, and the crop is shrunk until no corner falls outside;
  - if no line runs across at least a third of the photo, nothing is changed.

A plugin that captions photos on upload was considered as a server-side extra. It isn't
needed, because RinkSide's sync already writes the finished caption into every photo it
uploads. It would also need the external-plugin flag and an Immich build environment.

## Immich API details RinkSide relies on (v3)

- `POST /api/assets` (multipart) takes `assetData`, `fileCreatedAt`, `fileModifiedAt`,
  `filename` and `sidecarData` (the XMP with caption, rating and tags, so Immich's own
  metadata extraction agrees). `deviceAssetId` and `deviceId` were removed in v3.0.
- `POST /api/assets/bulk-upload-check` uses SHA-1, as hex or base64. Files Immich already
  has are linked instead of uploaded again.
- `PUT /api/assets/{id}` sets `{ description, rating }`. A rating is -1 (rejected), 1–5,
  or null; 0 is invalid in v3. Values set this way are *locked*, so re-extraction keeps
  them.
- `PUT /api/assets` with `{ ids, isFavorite }` or `{ ids, visibility: 'archive' | 'timeline' }`.
- `DELETE /api/assets` with `{ ids, force: false }` (trash), only for RinkSide's own replaced edits.
- `PUT /api/tags` with `{ tags: ['Players/Matti Virtanen'] }` creates the hierarchy.
- `PUT` and `DELETE /api/tags/{id}/assets`.
- `POST /api/albums`, `PUT /api/albums/{id}/assets`, and `POST /api/stacks`, where the
  first asset becomes the cover.
- `POST /api/search/metadata` with `{ albumIds, withExif }`, because v3 album responses
  no longer list their assets.
- `GET /api/faces?id=<assetId>` and `PUT /api/people/{id}`, for "suggest names for people".
