// Injected into Immich's web app by the Folio proxy: adds "Folio" and "RinkSide"
// to the sidebar, right after "Sharing". They are clones of Immich's own
// link so they inherit the current look, and nothing happens if Immich's markup
// ever changes.
(() => {
  const ITEMS = [
    {
      id: 'folio-sidebar-link',
      href: '/folio',
      label: 'Folio',
      icon: 'M3 5.4 11 4v16l-8-1.4V5.4zm10-1.4 8 1.4v13.2L13 20V4zm1.4 13.4 2.6-4.2 1.5 2 .9-1.1 1.2 1.9-6.2 1.4zm4.2-9.6a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5z',
    },
    {
      id: 'rinkside-sidebar-link',
      href: '/rinkside',
      label: 'RinkSide',
      icon: 'M16.2 1.6 18.4 2.9 10.5 17.1c-.3.5-.8.7-1.3.7H4a1.5 1.5 0 0 1-1.5-1.5v-.6A1.5 1.5 0 0 1 4 14.2h4.9zM14 17.6c0-1 1.8-1.8 4-1.8s4 .8 4 1.8v1.6c0 1-1.8 1.8-4 1.8s-4-.8-4-1.8z',
    },
  ];

  function textNodes(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const out = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) out.push(walker.currentNode);
    return out;
  }

  function insert() {
    if (ITEMS.every((item) => document.getElementById(item.id))) return;
    const anchor = document.querySelector('nav a[href="/sharing"], aside a[href="/sharing"], a[href="/sharing"]');
    if (!anchor) return;

    // Clone the outermost wrapper that only contains the Sharing link.
    let template = anchor;
    while (template.parentElement && template.parentElement.children.length === 1 && template.parentElement.tagName !== 'NAV') {
      template = template.parentElement;
    }
    let after = template;
    for (const item of ITEMS) {
      const existing = document.getElementById(item.id);
      if (existing) {
        after = existing;
        continue;
      }
      const clone = template.cloneNode(true);
      clone.id = item.id;
      const link = clone.matches('a') ? clone : clone.querySelector('a');
      link.href = item.href;
      link.setAttribute('data-sveltekit-reload', '');
      link.removeAttribute('aria-current');
      link.setAttribute('title', item.label);
      for (const node of clone.querySelectorAll('[aria-current]')) node.removeAttribute('aria-current');
      const labels = textNodes(clone);
      if (labels.length) {
        labels[0].nodeValue = labels[0].nodeValue.replace(/\S.*\S|\S/, item.label);
        labels.slice(1).forEach((n) => (n.nodeValue = ''));
      }
      clone.querySelectorAll('svg path').forEach((p) => {
        p.setAttribute('d', item.icon);
        p.setAttribute('fill-rule', 'evenodd');
      });
      after.after(clone);
      after = clone;
    }
  }

  const observer = new MutationObserver(() => insert());
  const start = () => {
    insert();
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
