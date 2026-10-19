// Folio public page: photo galleries, lightbox, slideshow, downloads,
// and (inside the editor preview) drag handles for resizing.
(() => {
  const F = window.FOLIO || {};
  const base = F.base;
  document.documentElement.classList.add('js');

  const svg = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICON = {
    close: svg('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'),
    prev: svg('M15.41 16.59 10.83 12l4.58-4.59L14 6l-6 6 6 6z'),
    next: svg('M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z'),
    play: svg('M8 5v14l11-7z'),
    pause: svg('M6 19h4V5H6v14zm8-14v14h4V5h-4z'),
    download: svg('M5 20h14v-2H5v2zm14-9h-4V3H9v8H5l7 7 7-7z'),
    expand: svg('M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'),
  };
  const DENSITY = {
    tight: { row: 230, cell: 170 },
    normal: { row: 270, cell: 230 },
    airy: { row: 320, cell: 290 },
  };
  const media = (ref, id, size) => `${base}/m/${ref}/${id}/${size}`;
  const clampRatio = (r) => Math.min(3, Math.max(0.4, r || 1.5));
  const duration = (ms) => {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const longDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const text = (s) => {
    const span = document.createElement('span');
    span.textContent = s;
    return span.innerHTML;
  };

  // ---- data -------------------------------------------------------------------
  // A "ref" is an album id (photos fetched on demand) or a Photos block id
  // (photos embedded in the page as JSON).
  const cache = new Map();
  function loadRef(ref) {
    if (cache.has(ref)) return cache.get(ref);
    const inline = document.getElementById(`photos-${ref}`);
    let request;
    if (inline) request = Promise.resolve(JSON.parse(inline.textContent));
    else {
      request = fetch(`${base}/api/album/${ref}`, { credentials: 'same-origin' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => d.assets);
      request.catch(() => cache.delete(ref));
    }
    cache.set(ref, request);
    return request;
  }

  // ---- galleries ----------------------------------------------------------------
  function settingsFor(gallery) {
    if (gallery.dataset.photos) {
      const d = gallery.dataset;
      return { style: d.style, density: d.density, row: Number(d.row) || 280, cols: Number(d.cols) || 3 };
    }
    const g = F.gallery || { style: 'justified', density: 'normal' };
    return { style: g.style, density: g.density, row: (DENSITY[g.density] || DENSITY.normal).row, cols: 0 };
  }

  function skeleton(gallery) {
    const n = Math.max(3, Math.min(Number(gallery.dataset.count) || 8, 8));
    gallery.innerHTML = `<div class="g-skeleton">${'<span></span>'.repeat(n)}</div>`;
  }

  function makeItem(ref, asset, index, size) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'g-item';
    el.dataset.index = String(index);
    el.setAttribute('aria-label', asset.caption || `${asset.video ? 'Play video' : 'Open photo'} ${index + 1}`);
    const img = new Image();
    img.alt = asset.caption || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onload = () => img.classList.add('is-loaded');
    img.onerror = () => img.classList.add('is-loaded');
    img.src = media(ref, asset.id, size);
    el.append(img);
    if (asset.video) el.insertAdjacentHTML('beforeend', `<span class="g-badge">${ICON.play}${duration(asset.duration)}</span>`);
    return el;
  }

  const withCaption = (item, asset) => {
    const fig = document.createElement('figure');
    fig.append(item);
    if (asset.caption) fig.insertAdjacentHTML('beforeend', `<figcaption>${text(asset.caption)}</figcaption>`);
    return fig;
  };

  function layoutJustified(gallery, assets, items, target) {
    const width = gallery.clientWidth;
    if (!width) return;
    const gap = parseFloat(getComputedStyle(gallery).getPropertyValue('--g-gap')) || 0;
    const rowH = width < 600 ? target * 0.62 : width < 1000 ? target * 0.8 : target;
    const frag = document.createDocumentFragment();
    let row = [];
    let sum = 0;
    const flush = (full) => {
      const h = full ? (width - gap * (row.length - 1)) / sum : Math.min(rowH, (width - gap * (row.length - 1)) / sum);
      const el = document.createElement('div');
      el.className = 'g-row';
      let used = 0;
      row.forEach((i, n) => {
        let w = Math.floor(clampRatio(assets[i].ratio) * h);
        if (full && n === row.length - 1) w = Math.max(1, Math.floor(width - used - gap * (row.length - 1)));
        used += w;
        items[i].style.width = `${w}px`;
        items[i].style.height = `${Math.round(h)}px`;
        el.append(items[i]);
      });
      frag.append(el);
      row = [];
      sum = 0;
    };
    assets.forEach((a, i) => {
      row.push(i);
      sum += clampRatio(a.ratio);
      if (sum * rowH + gap * (row.length - 1) >= width) flush(true);
    });
    if (row.length) flush(false);
    gallery.replaceChildren(frag);
  }

  function renderGallery(gallery, ref, assets) {
    const s = settingsFor(gallery);
    gallery.dataset.density = s.density;
    if (!assets.length) {
      gallery.innerHTML = '<div class="g-error">Nothing to show here yet.</div>';
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const big = ['stack', 'carousel', 'masonry'].includes(s.style) || s.row * dpr > 380;
    const items = assets.map((a, i) => makeItem(ref, a, i, big ? 'preview' : 'thumbnail'));
    gallery.addEventListener('click', (e) => {
      const item = e.target.closest('.g-item');
      if (item) lightbox.open(ref, assets, Number(item.dataset.index));
    });

    if (s.style === 'stack') {
      const wrap = document.createElement('div');
      wrap.className = 'g-stack';
      items.forEach((el, i) => {
        el.style.aspectRatio = String(Math.min(5, Math.max(0.2, assets[i].ratio || 1.5)));
        el.style.maxWidth = `calc(88svh * ${assets[i].ratio || 1.5})`;
        wrap.append(withCaption(el, assets[i]));
      });
      gallery.replaceChildren(wrap);
      return;
    }
    if (s.style === 'carousel') {
      const wrap = document.createElement('div');
      wrap.className = 'g-carousel';
      const row = Math.min(s.row, window.innerWidth < 600 ? 300 : 9999);
      wrap.style.setProperty('--row', `${row}px`);
      items.forEach((el, i) => {
        el.style.width = `${Math.round(clampRatio(assets[i].ratio) * row)}px`;
        wrap.append(withCaption(el, assets[i]));
      });
      const nav = document.createElement('div');
      nav.className = 'g-nav';
      nav.innerHTML = `<button type="button" aria-label="Scroll back">${ICON.prev}</button><button type="button" aria-label="Scroll forward">${ICON.next}</button>`;
      nav.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const dir = btn === nav.firstElementChild ? -1 : 1;
        wrap.scrollBy({ left: dir * wrap.clientWidth * 0.8, behavior: 'smooth' });
      });
      gallery.replaceChildren(wrap, nav);
      return;
    }
    if (s.style === 'masonry') {
      const wrap = document.createElement('div');
      wrap.className = 'g-masonry';
      const cols = () => {
        const w = gallery.clientWidth;
        const want = s.cols || (s.density === 'airy' ? 3 : 4);
        wrap.style.setProperty('--g-cols', w < 600 ? Math.min(2, want) : w < 1000 ? Math.min(3, want) : want);
      };
      items.forEach((el, i) => {
        el.style.aspectRatio = String(clampRatio(assets[i].ratio));
        wrap.append(el);
      });
      gallery.replaceChildren(wrap);
      cols();
      new ResizeObserver(cols).observe(gallery);
      return;
    }
    if (s.style === 'grid') {
      const wrap = document.createElement('div');
      wrap.className = 'g-grid';
      const apply = () => {
        const w = gallery.clientWidth;
        if (s.cols) wrap.style.gridTemplateColumns = `repeat(${w < 600 ? Math.min(2, s.cols) : s.cols}, minmax(0, 1fr))`;
        else wrap.style.setProperty('--g-cell', `${(DENSITY[s.density] || DENSITY.normal).cell * (w < 600 ? 0.5 : 1)}px`);
      };
      wrap.append(...items);
      gallery.replaceChildren(wrap);
      apply();
      new ResizeObserver(apply).observe(gallery);
      return;
    }
    let lastWidth = 0;
    const relayout = () => {
      if (gallery.clientWidth === lastWidth) return;
      lastWidth = gallery.clientWidth;
      layoutJustified(gallery, assets, items, s.row);
    };
    relayout();
    let raf;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(relayout);
    }).observe(gallery);
  }

  async function mountGallery(gallery) {
    const ref = gallery.dataset.album || gallery.dataset.photos;
    skeleton(gallery);
    try {
      renderGallery(gallery, ref, await loadRef(ref));
    } catch {
      gallery.innerHTML = '<div class="g-error">These photos could not be loaded right now. Try refreshing the page.</div>';
    }
  }

  const galleries = document.querySelectorAll('.gallery[data-album], .gallery[data-photos]');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          mountGallery(entry.target);
        }
      },
      { rootMargin: '800px 0px' },
    );
    galleries.forEach((g) => {
      skeleton(g);
      io.observe(g);
    });
  } else {
    galleries.forEach(mountGallery);
  }

  // ---- lightbox ------------------------------------------------------------------
  const lightbox = (() => {
    let root, stage, countEl, infoEl, playBtn, dlBtn, progress;
    let ref, assets, index, playing, timer, returnFocus, pushed, removeTimer;
    const SLIDE_MS = 4500;

    function build() {
      root = document.createElement('div');
      root.className = 'lb';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', 'Photo viewer');
      root.innerHTML = `
        <div class="lb-top">
          <span class="lb-count" aria-live="polite"></span>
          <div class="lb-tools">
            <button class="lb-btn" data-act="play" aria-label="Play slideshow">${ICON.play}</button>
            ${F.allowDownload ? `<a class="lb-btn" data-act="download" aria-label="Download original" download>${ICON.download}</a>` : ''}
            ${document.fullscreenEnabled ? `<button class="lb-btn" data-act="full" aria-label="Full screen">${ICON.expand}</button>` : ''}
            <button class="lb-btn" data-act="close" aria-label="Close">${ICON.close}</button>
          </div>
        </div>
        <div class="lb-stage">
          <div class="lb-progress"></div>
          <button class="lb-btn lb-nav lb-prev" data-act="prev" aria-label="Previous">${ICON.prev}</button>
          <button class="lb-btn lb-nav lb-next" data-act="next" aria-label="Next">${ICON.next}</button>
        </div>
        <div class="lb-bottom"></div>`;
      stage = root.querySelector('.lb-stage');
      countEl = root.querySelector('.lb-count');
      infoEl = root.querySelector('.lb-bottom');
      playBtn = root.querySelector('[data-act="play"]');
      dlBtn = root.querySelector('[data-act="download"]');
      progress = root.querySelector('.lb-progress');

      root.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'close') close();
        else if (act === 'prev') go(-1);
        else if (act === 'next') go(1);
        else if (act === 'play') setPlaying(!playing);
        else if (act === 'full') toggleFullscreen();
        else if (e.target === stage) close();
      });

      let startX = null;
      stage.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse') startX = e.clientX;
      });
      stage.addEventListener('pointerup', (e) => {
        if (startX === null) return;
        const dx = e.clientX - startX;
        startX = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      });
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === ' ' && e.target.tagName !== 'VIDEO') {
        e.preventDefault();
        setPlaying(!playing);
      } else if (e.key === 'f') toggleFullscreen();
    }

    function toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen?.().catch(() => {});
    }

    function show() {
      const asset = assets[index];
      countEl.textContent = `${index + 1} / ${assets.length}`;
      infoEl.innerHTML = [asset.caption ? `<b>${text(asset.caption)}</b>` : '', text(longDate(asset.date))].filter(Boolean).join(' · ');
      if (dlBtn) dlBtn.href = media(ref, asset.id, 'original');

      stage.querySelectorAll('.lb-media, .lb-spinner').forEach((n) => n.remove());
      const spinner = document.createElement('div');
      spinner.className = 'lb-spinner';
      let el;
      if (asset.video) {
        el = document.createElement('video');
        el.controls = true;
        el.playsInline = true;
        el.autoplay = true;
        el.poster = media(ref, asset.id, 'preview');
        el.src = media(ref, asset.id, 'video');
        el.onloadeddata = () => spinner.remove();
        el.onended = () => playing && go(1);
        requestAnimationFrame(() => el.classList.remove('is-entering'));
      } else {
        el = new Image();
        el.alt = asset.caption || '';
        el.onload = () => {
          spinner.remove();
          el.classList.remove('is-entering');
        };
        el.onerror = () => spinner.remove();
        el.src = media(ref, asset.id, 'preview');
      }
      el.className = 'lb-media is-entering';
      stage.prepend(el);
      stage.append(spinner);

      for (const d of [1, -1, 2]) {
        const n = assets[(index + d + assets.length) % assets.length];
        if (n && !n.video) new Image().src = media(ref, n.id, 'preview');
      }
      scheduleNext();
    }

    function scheduleNext() {
      clearTimeout(timer);
      progress.classList.remove('is-running');
      progress.style.transitionDuration = '0ms';
      if (!playing || assets[index].video) return;
      void progress.offsetWidth;
      progress.style.transitionDuration = `${SLIDE_MS}ms`;
      progress.classList.add('is-running');
      timer = setTimeout(() => go(1), SLIDE_MS);
    }

    function setPlaying(on) {
      playing = on;
      playBtn.innerHTML = on ? ICON.pause : ICON.play;
      playBtn.setAttribute('aria-label', on ? 'Pause slideshow' : 'Play slideshow');
      scheduleNext();
    }

    function go(delta) {
      index = (index + delta + assets.length) % assets.length;
      show();
    }

    function open(id, list, start = 0, { play = false } = {}) {
      if (!list.length) return;
      if (!root) build();
      clearTimeout(removeTimer);
      ref = id;
      assets = list;
      index = start;
      returnFocus = document.activeElement;
      document.body.append(root);
      document.body.classList.add('lb-lock');
      requestAnimationFrame(() => root.classList.add('is-open'));
      document.addEventListener('keydown', onKey);
      setPlaying(play);
      show();
      root.querySelector('[data-act="close"]').focus({ preventScroll: true });
      if (!pushed) {
        history.pushState({ folioLightbox: true }, '');
        pushed = true;
      }
    }

    function close(fromHistory = false) {
      if (!root?.isConnected || !root.classList.contains('is-open')) return;
      clearTimeout(timer);
      playing = false;
      document.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      stage.querySelectorAll('video').forEach((v) => v.pause());
      root.classList.remove('is-open');
      document.body.classList.remove('lb-lock');
      removeTimer = setTimeout(() => root.remove(), 200);
      returnFocus?.focus?.({ preventScroll: true });
      if (pushed && !fromHistory) {
        pushed = false;
        history.back();
      }
      pushed = false;
    }

    window.addEventListener('popstate', () => {
      if (root?.isConnected) {
        pushed = false;
        close(true);
      }
    });

    return { open };
  })();

  // ---- actions --------------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    const slideshow = e.target.closest('[data-slideshow]');
    if (slideshow) {
      const ref = slideshow.dataset.slideshow;
      try {
        lightbox.open(ref, await loadRef(ref), 0, { play: true });
      } catch {}
      return;
    }
    const download = e.target.closest('[data-download]');
    if (download) {
      document.querySelector('.dl-pop')?.remove();
      const ref = download.dataset.download;
      download.disabled = true;
      try {
        const r = await fetch(`${base}/dl/${ref}`, { credentials: 'same-origin' });
        const { parts } = await r.json();
        if (parts.length === 1) {
          location.href = `${base}/dl/${ref}/0`;
        } else if (parts.length > 1) {
          const pop = document.createElement('div');
          pop.className = 'dl-pop';
          pop.innerHTML = parts
            .map((p) => `<a href="${base}/dl/${ref}/${p.index}">Part ${p.index + 1} <small>${p.count} files · ${(p.size / 1e9).toFixed(1)} GB</small></a>`)
            .join('');
          const rect = download.getBoundingClientRect();
          pop.style.top = `${rect.bottom + window.scrollY + 8}px`;
          pop.style.left = `${Math.max(16, Math.min(rect.left + window.scrollX, document.documentElement.clientWidth - 280))}px`;
          document.body.append(pop);
        }
      } finally {
        download.disabled = false;
      }
      return;
    }
    if (!e.target.closest('.dl-pop')) document.querySelector('.dl-pop')?.remove();
  });

  // ---- entrance animation ------------------------------------------------------------
  if (!F.edit && 'IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const targets = document.querySelectorAll('.card, .tile, .row, .missing, .inline-head, .group-title, .text-block, .quote');
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -40px 0px' },
    );
    targets.forEach((el) => {
      const siblings = [...el.parentElement.children];
      el.style.transitionDelay = `${(siblings.indexOf(el) % 4) * 70}ms`;
      el.classList.add('reveal');
      io.observe(el);
    });
  }

  // ---- editor preview: drag to resize, click to edit -------------------------------------
  if (F.edit && window.parent !== window) setupEditing();

  function setupEditing() {
    const post = (msg) => window.parent.postMessage({ source: 'folio-preview', ...msg }, location.origin);
    const root = document.documentElement;
    const hero = F.hero;
    const LABELS = { albums: 'Albums', photos: 'Photos', text: 'Text', quote: 'Quote', divider: 'Divider', button: 'Button', header: 'Header', footer: 'Footer' };

    // "Edit" chips on blocks, the header and the footer.
    document.querySelectorAll('[data-block], [data-edit]').forEach((el) => {
      const target = el.dataset.block || el.dataset.edit;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'edit-chip';
      chip.textContent = `✎ ${LABELS[el.dataset.type || target] || 'Edit'}`;
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        post({ type: 'select', target });
      });
      el.prepend(chip);
    });

    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.data?.source !== 'folio-editor') return;
      if (e.data.type === 'highlight') {
        document.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
        const el = document.querySelector(`[data-block="${CSS.escape(e.data.target)}"], [data-edit="${CSS.escape(e.data.target)}"]`);
        if (el) {
          el.classList.add('is-selected');
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    });

    const tip = document.createElement('div');
    tip.className = 'size-tip';
    tip.hidden = true;
    document.body.append(tip);
    const showTip = (e, label) => {
      tip.hidden = false;
      tip.textContent = label;
      tip.style.left = `${e.clientX + 14}px`;
      tip.style.top = `${e.clientY + 14}px`;
    };

    function drag(handle, { onMove, onEnd, cursor }) {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        const start = { x: e.clientX, y: e.clientY };
        let moved = false;
        document.body.style.cursor = cursor;
        const move = (ev) => {
          moved = true;
          onMove(ev.clientX - start.x, ev.clientY - start.y, ev);
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          document.body.style.cursor = '';
          tip.hidden = true;
          if (moved) onEnd();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });
    }

    const header = document.querySelector('.hero');
    if (!header) return;
    const style = [...header.classList].find((c) => c.startsWith('hero-'))?.slice(5);

    // Header height: drag the bar at the bottom of the header (or its photo).
    const sizeHost = header.querySelector('.banner, .split-media') || header;
    const bar = document.createElement('div');
    bar.className = 'resize-bar';
    bar.title = 'Drag to change the header height';
    bar.textContent = 'Height';
    sizeHost.append(bar);
    const factor = style === 'minimal' ? 0.8 : 1;
    drag(bar, {
      cursor: 'ns-resize',
      onMove: (dx, dy, ev) => {
        const startSize = Number(bar.dataset.start || hero.size);
        bar.dataset.start = startSize;
        const next = Math.round(Math.min(100, Math.max(20, startSize + (dy / window.innerHeight) * 100 / factor)));
        root.style.setProperty('--hero-size', next);
        hero.size = next;
        showTip(ev, `${next}% of screen`);
      },
      onEnd: () => {
        delete bar.dataset.start;
        post({ type: 'set', changes: { 'hero.size': hero.size } });
      },
    });

    // Logo size: drag the dot at its corner.
    const logo = header.querySelector('.logo');
    if (logo) {
      const wrap = document.createElement('span');
      wrap.className = 'logo-wrap';
      logo.replaceWith(wrap);
      wrap.append(logo);
      const dot = document.createElement('span');
      dot.className = 'logo-handle';
      dot.title = 'Drag to resize the logo';
      wrap.append(dot);
      const centered = header.classList.contains('align-center') ? 2 : 1;
      drag(dot, {
        cursor: 'nwse-resize',
        onMove: (dx, dy, ev) => {
          const startSize = Number(dot.dataset.start || hero.logoSize);
          dot.dataset.start = startSize;
          const next = Math.round(Math.min(260, Math.max(32, startSize + ((dx * centered + dy) / 2))));
          root.style.setProperty('--logo', `${next}px`);
          hero.logoSize = next;
          showTip(ev, `${next}px`);
        },
        onEnd: () => {
          delete dot.dataset.start;
          post({ type: 'set', changes: { 'hero.logoSize': hero.logoSize } });
        },
      });
    }

    // Cover photo framing: drag the photo itself.
    const img = header.querySelector('.hero-img');
    if (img) {
      const hint = document.createElement('div');
      hint.className = 'drag-hint';
      hint.textContent = 'Drag the photo to reframe it';
      (header.querySelector('.hero-media') || header).append(hint);
      drag(img, {
        cursor: 'grabbing',
        onMove: (dx, dy, ev) => {
          const r = img.getBoundingClientRect();
          const sx = Number(img.dataset.sx ?? hero.focusX);
          const sy = Number(img.dataset.sy ?? hero.focusY);
          img.dataset.sx = sx;
          img.dataset.sy = sy;
          const fx = Math.round(Math.min(100, Math.max(0, sx - (dx / r.width) * 150)));
          const fy = Math.round(Math.min(100, Math.max(0, sy - (dy / r.height) * 150)));
          root.style.setProperty('--fx', `${fx}%`);
          root.style.setProperty('--fy', `${fy}%`);
          hero.focusX = fx;
          hero.focusY = fy;
          showTip(ev, `${fx}% · ${fy}%`);
        },
        onEnd: () => {
          delete img.dataset.sx;
          delete img.dataset.sy;
          post({ type: 'set', changes: { 'hero.focusX': hero.focusX, 'hero.focusY': hero.focusY } });
        },
      });
    }
  }
})();
