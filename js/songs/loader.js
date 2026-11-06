// Downloads a map package (zip), unpacks only the files we need and decodes the audio.
// Uses the vendored fflate UMD build (global `fflate`).

import { parseInfo, parseDifficulty } from './mapparser.js';

function getFflate() {
  const f = (typeof window !== 'undefined' && window.fflate) || (typeof self !== 'undefined' && self.fflate);
  if (!f) throw new Error('Biblioteca de descompactação não carregada');
  return f;
}

export function downloadBinary(url, onProgress, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = timeoutMs || 120000;
    xhr.onprogress = function (e) {
      if (onProgress) onProgress(e.lengthComputable ? e.loaded / e.total : -1, e.loaded);
    };
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) resolve(xhr.response);
      else reject(new Error('Falha no download (' + xhr.status + ')'));
    };
    xhr.onerror = function () { reject(new Error('Falha de rede no download')); };
    xhr.ontimeout = function () { reject(new Error('Download demorou demais')); };
    xhr.send();
  });
}

function baseName(path) {
  const i = path.lastIndexOf('/');
  return (i >= 0 ? path.slice(i + 1) : path).toLowerCase();
}

function decodeText(bytes) {
  let text;
  if (typeof TextDecoder !== 'undefined') text = new TextDecoder('utf-8').decode(bytes);
  else text = getFflate().strFromU8(bytes);
  // strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function parseJsonBytes(bytes, what) {
  try { return JSON.parse(decodeText(bytes)); } catch (e) { throw new Error('JSON inválido em ' + what); }
}

// Unzips the package. Returns a "song package":
// { info, files: Map(lowercase basename -> Uint8Array), audioBytes, coverBytes }
export function unpackPackage(arrayBuffer) {
  const fflate = getFflate();
  const data = new Uint8Array(arrayBuffer);
  // Pass 1: small json files only.
  let meta;
  try {
    meta = fflate.unzipSync(data, { filter: function (f) { return /\.dat$/i.test(f.name) && f.originalSize < 40 * 1024 * 1024; } });
  } catch (e) {
    throw new Error('Pacote corrompido (zip inválido)');
  }
  const files = new Map();
  Object.keys(meta).forEach(function (name) { files.set(baseName(name), meta[name]); });
  const infoBytes = files.get('info.dat');
  if (!infoBytes) throw new Error('Pacote sem Info.dat');
  const info = parseInfo(parseJsonBytes(infoBytes, 'Info.dat'));
  if (!info.songFile) throw new Error('Info.dat não indica o arquivo de áudio');

  const wantAudio = baseName(info.songFile);
  const wantCover = info.coverFile ? baseName(info.coverFile) : '';
  const media = fflate.unzipSync(data, {
    filter: function (f) {
      const b = baseName(f.name);
      return b === wantAudio || (wantCover && b === wantCover);
    },
  });
  let audioBytes = null, coverBytes = null;
  Object.keys(media).forEach(function (name) {
    const b = baseName(name);
    if (b === wantAudio) audioBytes = media[name];
    else if (b === wantCover) coverBytes = media[name];
  });
  if (!audioBytes) throw new Error('Áudio "' + info.songFile + '" não encontrado no pacote');
  return { info: info, files: files, audioBytes: audioBytes, coverBytes: coverBytes };
}

export function loadDifficulty(pkg, characteristic, difficulty) {
  const set = pkg.info.sets.find(function (s) { return s.characteristic === characteristic; });
  if (!set) throw new Error('Característica ' + characteristic + ' não encontrada');
  const diff = set.diffs.find(function (d) { return d.difficulty === difficulty; });
  if (!diff) throw new Error('Dificuldade ' + difficulty + ' não encontrada');
  const bytes = pkg.files.get(baseName(diff.file || ''));
  if (!bytes) throw new Error('Arquivo ' + diff.file + ' ausente no pacote');
  const json = parseJsonBytes(bytes, diff.file);
  const map = parseDifficulty(json, pkg.info.bpm, pkg.info.songTimeOffset);
  return { map: map, njs: diff.njs, offset: diff.offset };
}

export function bytesToImage(bytes) {
  return new Promise(function (resolve) {
    if (!bytes) { resolve(null); return; }
    try {
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const blob = new Blob([bytes], { type: isPng ? 'image/png' : 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch (e) { resolve(null); }
  });
}

// Image loader for remote covers (BeatSaver CDN sends CORS headers).
const imageCache = new Map();
export function loadRemoteImage(url, onLoad) {
  if (!url) return null;
  let entry = imageCache.get(url);
  if (entry) {
    if (entry.ready) return entry.img;
    if (onLoad) entry.callbacks.push(onLoad);
    return null;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  entry = { img: img, ready: false, callbacks: onLoad ? [onLoad] : [] };
  imageCache.set(url, entry);
  img.onload = function () {
    entry.ready = true;
    entry.callbacks.forEach(function (cb) { try { cb(img); } catch (e) { /* ignore */ } });
    entry.callbacks.length = 0;
  };
  img.onerror = function () { entry.failed = true; };
  img.src = url;
  if (imageCache.size > 200) {
    const first = imageCache.keys().next().value;
    imageCache.delete(first);
  }
  return null;
}
