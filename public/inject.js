// Injected into Immich's web app by the Folio proxy: adds a "Folio" item to the
// sidebar, right after "Sharing". It clones Immich's own link so it inherits the
// current look, and quietly does nothing if Immich's markup ever changes.
(() => {
  const ID = 'folio-sidebar-link';
  const ICON = 'M3 5.4 11 4v16l-8-1.4V5.4zm10-1.4 8 1.4v13.2L13 20V4zm1.4 13.4 2.6-4.2 1.5 2 .9-1.1 1.2 1.9-6.2 1.4zm4.2-9.6a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5z';

  function textNodes(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const out = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) out.push(walker.currentNode);
    return out;
  }

  function insert() {
    if (document.getElementById(ID)) return;
    const anchor = document.querySelector('nav a[href="/sharing"], aside a[href="/sharing"], a[href="/sharing"]');
    if (!anchor) return;

    // Clone the outermost wrapper that only contains this link.
    let item = anchor;
    while (item.parentElement && item.parentElement.children.length === 1 && item.parentElement.tagName !== 'NAV') {
      item = item.parentElement;
    }
    const clone = item.cloneNode(true);
    clone.id = ID;
    const link = clone.matches('a') ? clone : clone.querySelector('a');
    link.href = '/folio';
    link.setAttribute('data-sveltekit-reload', '');
    link.removeAttribute('aria-current');
    link.setAttribute('title', 'Folio');
    for (const node of clone.querySelectorAll('[aria-current]')) node.removeAttribute('aria-current');
    const labels = textNodes(clone);
    if (labels.length) {
      labels[0].nodeValue = labels[0].nodeValue.replace(/\S.*\S|\S/, 'Folio');
      labels.slice(1).forEach((n) => (n.nodeValue = ''));
    }
    clone.querySelectorAll('svg path').forEach((p) => {
      p.setAttribute('d', ICON);
      p.setAttribute('fill-rule', 'evenodd');
    });
    item.after(clone);
  }

  const observer = new MutationObserver(() => insert());
  const start = () => {
    insert();
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
