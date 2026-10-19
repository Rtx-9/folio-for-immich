// Folio public page: photo galleries, lightbox, slideshow and downloads.
(() => {
  const F = window.FOLIO || {};
  const base = F.base;
  const settings = F.gallery || { style: 'justified', density: 'normal' };
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
    video: svg('M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z'),
  };
  const DENSITY = {
    tight: { row: 230, cell: 170 },
    normal: { row: 270, cell: 230 },
    airy: { row: 320, cell: 290 },
  };
  const media = (albumId, id, size) => `${base}/m/${albumId}/${id}/${size}`;
  const duration = (ms) => {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const longDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  // ---- data -------------------------------------------------------------------
  const albumCache = new Map();
  function loadAlbum(id) {
    if (!albumCache.has(id)) {
      const request = fetch(`${base}/api/album/${id}`, { credentials: 'same-origin' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => d.assets);
      request.catch(() => albumCache.delete(id));
      albumCache.set(id, request);
    }
    return albumCache.get(id);
  }

  // ---- galleries ----------------------------------------------------------------
  function skeleton(gallery) {
    const n = Math.max(3, Math.min(Number(gallery.dataset.count) || 8, 8));
    gallery.innerHTML = `<div class="g-skeleton">${'<span></span>'.repeat(n)}</div>`;
  }

  function makeItem(albumId, asset, index, size) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'g-item';
    el.dataset.index = String(index);
    el.setAttribute('aria-label', `${asset.video ? 'Play video' : 'Open photo'} ${index + 1}`);
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onload = () => img.classList.add('is-loaded');
    img.onerror = () => img.classList.add('is-loaded');
    img.src = media(albumId, asset.id, size);
    el.append(img);
    if (asset.video) {
      el.insertAdjacentHTML('beforeend', `<span class="g-badge">${ICON.play}${duration(asset.duration)}</span>`);
    }
    return el;
  }

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
        const r = Math.min(3, Math.max(0.4, assets[i].ratio || 1.5));
        let w = Math.floor(r * h);
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
      sum += Math.min(3, Math.max(0.4, a.ratio || 1.5));
      if (sum * rowH + gap * (row.length - 1) >= width) flush(true);
    });
    if (row.length) flush(false);
    gallery.replaceChildren(frag);
  }

  function renderGallery(gallery, albumId, assets) {
    const style = settings.style;
    const density = DENSITY[settings.density] || DENSITY.normal;
    gallery.dataset.density = settings.density;
    if (!assets.length) {
      gallery.innerHTML = '<div class="g-error">This album is empty.</div>';
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const size = density.row * dpr > 380 || style === 'masonry' ? 'preview' : 'thumbnail';
    const items = assets.map((a, i) => makeItem(albumId, a, i, size));
    gallery.addEventListener('click', (e) => {
      const item = e.target.closest('.g-item');
      if (item) lightbox.open(albumId, assets, Number(item.dataset.index));
    });

    if (style === 'masonry') {
      const wrap = document.createElement('div');
      wrap.className = 'g-masonry';
      const cols = () => {
        const w = gallery.clientWidth;
        wrap.style.setProperty('--g-cols', w < 600 ? 2 : w < 1000 ? 3 : settings.density === 'airy' ? 3 : 4);
      };
      items.forEach((el, i) => {
        el.style.aspectRatio = String(Math.min(3, Math.max(0.4, assets[i].ratio || 1.5)));
        wrap.append(el);
      });
      gallery.replaceChildren(wrap);
      cols();
      new ResizeObserver(cols).observe(gallery);
      return;
    }
    if (style === 'grid') {
      const wrap = document.createElement('div');
      wrap.className = 'g-grid';
      wrap.style.setProperty('--g-cell', `${density.cell * (gallery.clientWidth < 600 ? 0.5 : 1)}px`);
      wrap.append(...items);
      gallery.replaceChildren(wrap);
      return;
    }
    let lastWidth = 0;
    const relayout = () => {
      if (gallery.clientWidth === lastWidth) return;
      lastWidth = gallery.clientWidth;
      layoutJustified(gallery, assets, items, density.row);
    };
    relayout();
    let raf;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(relayout);
    }).observe(gallery);
  }

  async function mountGallery(gallery) {
    const albumId = gallery.dataset.album;
    skeleton(gallery);
    try {
      renderGallery(gallery, albumId, await loadAlbum(albumId));
    } catch {
      gallery.innerHTML = '<div class="g-error">These photos could not be loaded right now. Try refreshing the page.</div>';
    }
  }

  const galleries = document.querySelectorAll('.gallery[data-album]');
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
      g.dataset.density = settings.density;
      skeleton(g);
      io.observe(g);
    });
  } else {
    galleries.forEach(mountGallery);
  }

  // ---- lightbox ------------------------------------------------------------------
  const lightbox = (() => {
    let root, stage, countEl, dateEl, playBtn, dlBtn, progress;
    let albumId, assets, index, playing, timer, returnFocus, pushed, removeTimer;
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
      dateEl = root.querySelector('.lb-bottom');
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
      dateEl.textContent = longDate(asset.date);
      if (dlBtn) dlBtn.href = media(albumId, asset.id, 'original');

      stage.querySelectorAll('.lb-media, .lb-spinner').forEach((n) => n.remove());
      const spinner = document.createElement('div');
      spinner.className = 'lb-spinner';
      let el;
      if (asset.video) {
        el = document.createElement('video');
        el.controls = true;
        el.playsInline = true;
        el.autoplay = true;
        el.poster = media(albumId, asset.id, 'preview');
        el.src = media(albumId, asset.id, 'video');
        el.onloadeddata = () => spinner.remove();
        el.onended = () => playing && go(1);
      } else {
        el = new Image();
        el.alt = '';
        el.onload = () => {
          spinner.remove();
          el.classList.remove('is-entering');
        };
        el.onerror = () => spinner.remove();
        el.src = media(albumId, asset.id, 'preview');
      }
      el.className = 'lb-media is-entering';
      if (asset.video) requestAnimationFrame(() => el.classList.remove('is-entering'));
      stage.prepend(el);
      stage.append(spinner);
      if (el.complete) el.onload?.();

      for (const d of [1, -1, 2]) {
        const n = assets[(index + d + assets.length) % assets.length];
        if (n && !n.video) new Image().src = media(albumId, n.id, 'preview');
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
      albumId = id;
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
      const id = slideshow.dataset.slideshow;
      try {
        lightbox.open(id, await loadAlbum(id), 0, { play: true });
      } catch {}
      return;
    }
    const download = e.target.closest('[data-download]');
    if (download) {
      document.querySelector('.dl-pop')?.remove();
      const id = download.dataset.download;
      download.disabled = true;
      try {
        const r = await fetch(`${base}/dl/${id}`, { credentials: 'same-origin' });
        const { parts } = await r.json();
        if (parts.length === 1) {
          location.href = `${base}/dl/${id}/0`;
        } else if (parts.length > 1) {
          const pop = document.createElement('div');
          pop.className = 'dl-pop';
          pop.innerHTML = parts
            .map(
              (p) =>
                `<a href="${base}/dl/${id}/${p.index}">Part ${p.index + 1} <small>${p.count} files · ${(p.size / 1e9).toFixed(1)} GB</small></a>`,
            )
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
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const targets = document.querySelectorAll('.card, .tile, .row, .missing, .inline-head, .group-title, .intro p');
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
})();
