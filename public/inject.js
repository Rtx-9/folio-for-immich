// Injected into Immich's web app by the Folio proxy: adds a "Pages" item to the
// sidebar, right after "Sharing". It clones Immich's own link so it inherits the
// current look, and quietly does nothing if Immich's markup ever changes.
(() => {
  const ID = 'folio-sidebar-link';
  const ICON = 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 5v9h16V9H4zm2 2h6v5H6v-5zm8 0h4v2h-4v-2zm0 3h4v2h-4v-2z';

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
    link.setAttribute('title', 'Pages');
    for (const node of clone.querySelectorAll('[aria-current]')) node.removeAttribute('aria-current');
    const labels = textNodes(clone);
    if (labels.length) {
      labels[0].nodeValue = labels[0].nodeValue.replace(/\S.*\S|\S/, 'Pages');
      labels.slice(1).forEach((n) => (n.nodeValue = ''));
    }
    clone.querySelectorAll('svg path').forEach((p) => p.setAttribute('d', ICON));
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
