// Forgiving search for photo captions, keywords and names.
//
// Finnish bends words a lot (torjuu, torjunta, torjunnan…), people type without
// ä/ö, and names get misspelled. So a query word matches a word in the photo when
// it is the same, a prefix of it, shares a long enough stem with it, or is only a
// letter or two off. Every query word has to match something (AND); if nothing
// matches all of them, the best partial matches are returned instead.

export const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

export const tokenize = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function levenshtein(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// How well query word q matches document word t (0 = not at all).
export function wordScore(q, t) {
  if (q === t) return 1;
  const numeric = /^\d+$/.test(q);
  if (t.startsWith(q) && (q.length >= 2 || numeric)) return 0.9;
  if (numeric) return 0;
  const shorter = Math.min(q.length, t.length);
  const prefix = commonPrefix(q, t);
  if (prefix >= 4 && prefix >= shorter * 0.6) return 0.6 + 0.2 * (prefix / Math.max(q.length, t.length));
  if (q.length >= 4) {
    const allowed = q.length >= 7 ? 2 : 1;
    if (levenshtein(q, t, allowed) <= allowed) return 0.6;
  }
  return 0;
}

// docs: [{ id, primary: string, context: string }]. Words in `primary`
// (captions, keywords, names) count more than `context` (game, date, file name).
export class SearchIndex {
  constructor(docs) {
    this.vocab = new Map(); // word → Map(docId → weight)
    for (const doc of docs) {
      for (const [text, weight] of [
        [doc.context, 0.7],
        [doc.primary, 1],
      ]) {
        for (const word of tokenize(text)) {
          let postings = this.vocab.get(word);
          if (!postings) this.vocab.set(word, (postings = new Map()));
          postings.set(doc.id, Math.max(postings.get(doc.id) || 0, weight));
        }
      }
    }
  }

  search(query, limit = 5000) {
    const words = [...new Set(tokenize(query))];
    if (!words.length) return { ids: [], partial: false, words };
    const perWord = words.map((q) => {
      const hits = new Map();
      for (const [word, postings] of this.vocab) {
        const s = wordScore(q, word);
        if (!s) continue;
        for (const [id, weight] of postings) hits.set(id, Math.max(hits.get(id) || 0, s * weight));
      }
      return hits;
    });
    const totals = new Map();
    perWord.forEach((hits) => {
      for (const [id, s] of hits) {
        const t = totals.get(id) || { score: 0, matched: 0 };
        t.score += s;
        t.matched++;
        totals.set(id, t);
      }
    });
    let ranked = [...totals].filter(([, t]) => t.matched === words.length);
    let partial = false;
    if (!ranked.length && words.length > 1) {
      const best = Math.max(0, ...[...totals.values()].map((t) => t.matched));
      ranked = [...totals].filter(([, t]) => t.matched === best && best > 0);
      partial = ranked.length > 0;
    }
    ranked.sort((a, b) => b[1].score - a[1].score);
    return { ids: ranked.slice(0, limit).map(([id, t]) => ({ id, score: Math.round(t.score * 100) / 100 })), partial, words };
  }
}
