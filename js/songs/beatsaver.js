// Client for the public BeatSaver API (https://api.beatsaver.com), the open community
// repository of rhythm maps used as this game's song source ("OpenSaver" in the brief).
// Only endpoints verified against the live API are used:
//   GET /search/text/{page}?q=&sortOrder=Latest|Relevance|Rating|Curated -> {docs, info:{total,pages}}
//   GET /maps/id/{id}                                                  -> map document
// Each map document has metadata, stats and versions[0].{hash, downloadURL, coverURL, previewURL, diffs[]}.

import { BEATSAVER } from '../core/config.js';

function fetchJson(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'text';
    xhr.timeout = timeoutMs || 15000;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(new Error('Resposta inválida do servidor')); }
      } else if (xhr.status === 404) {
        reject(new Error('Não encontrado (404)'));
      } else if (xhr.status === 429) {
        reject(new Error('Muitas requisições — aguarde alguns segundos'));
      } else {
        reject(new Error('Erro do servidor (' + xhr.status + ')'));
      }
    };
    xhr.onerror = function () { reject(new Error('Sem conexão com o BeatSaver')); };
    xhr.ontimeout = function () { reject(new Error('Tempo esgotado ao contatar o BeatSaver')); };
    xhr.send();
  });
}

// Normalizes a BeatSaver map document into what the UI needs.
export function normalizeMapDoc(doc) {
  const v = (doc.versions && doc.versions[0]) || {};
  const md = doc.metadata || {};
  const diffs = (v.diffs || []).map(function (d) {
    return {
      characteristic: d.characteristic,
      difficulty: d.difficulty,
      label: d.label || d.difficulty,
      njs: d.njs,
      notes: d.notes,
      bombs: d.bombs,
      obstacles: d.obstacles,
      nps: d.nps,
    };
  });
  return {
    source: 'beatsaver',
    id: String(doc.id),
    hash: v.hash || '',
    title: md.songName || doc.name || 'Sem título',
    subTitle: md.songSubName || '',
    artist: md.songAuthorName || '',
    mapper: md.levelAuthorName || (doc.uploader && doc.uploader.name) || '',
    bpm: md.bpm || 0,
    duration: md.duration || 0,
    coverURL: v.coverURL || '',
    previewURL: v.previewURL || '',
    downloadURL: v.downloadURL || '',
    upvotes: (doc.stats && doc.stats.upvotes) || 0,
    downvotes: (doc.stats && doc.stats.downvotes) || 0,
    score: (doc.stats && doc.stats.score) || 0,
    diffs: diffs,
  };
}

export const SORT_ORDERS = ['Rating', 'Curated', 'Latest', 'Relevance'];

export class BeatSaverClient {
  constructor(base) {
    this.base = base || BEATSAVER.apiBase;
    this.cache = new Map();
  }

  // Returns { maps: [...], page, pages, total }
  search(query, page, sortOrder) {
    const q = (query || '').trim();
    const order = sortOrder || (q ? 'Relevance' : 'Rating');
    const url = this.base + '/search/text/' + (page | 0) + '?q=' + encodeURIComponent(q) + '&sortOrder=' + encodeURIComponent(order);
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.at < 120000) return Promise.resolve(cached.value);
    const self = this;
    return fetchJson(url).then(function (json) {
      const docs = Array.isArray(json.docs) ? json.docs : [];
      const info = json.info || {};
      const value = {
        maps: docs.filter(function (d) { return d && d.versions && d.versions.length; }).map(normalizeMapDoc),
        page: page | 0,
        pages: typeof info.pages === 'number' ? info.pages : (docs.length ? (page | 0) + 2 : page | 0),
        total: typeof info.total === 'number' ? info.total : docs.length,
      };
      self.cache.set(url, { at: Date.now(), value: value });
      return value;
    });
  }

  byId(id) {
    return fetchJson(this.base + '/maps/id/' + encodeURIComponent(id)).then(normalizeMapDoc);
  }
}
