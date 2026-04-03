const fs = require('fs');
const NodeCache = require('node-cache');

const {
  getTorBoxDownloads,
  getTorBoxStreamLink,
  getTorBoxFiles,
  isVideoFile
} = require('./torbox');

const { searchMetadata, getMetadata } = require('./tmdb');
const { guessMediaInfo } = require('./parser');

// ─── CACHE ────────────────────────────────────────────────────────────────────
const CACHE_FILE = '/tmp/torbox-tmdb-cache.json';

const matchCache  = new NodeCache({ stdTTL: 86400 });
const streamCache = new NodeCache({ stdTTL: 3600 });

// ─── LOAD/SAVE CACHE ──────────────────────────────────────────────────────────
function loadPersistentCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      for (const [k, v] of Object.entries(data)) {
        matchCache.set(k, v);
      }
      console.log(`[Cache] Loaded ${Object.keys(data).length}`);
    }
  } catch {}
}

function savePersistentCache() {
  try {
    const data = {};
    for (const k of matchCache.keys()) {
      const v = matchCache.get(k);
      if (v !== undefined) data[k] = v;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch {}
}

loadPersistentCache();
setInterval(savePersistentCache, 60000);

// ─── INDEX ────────────────────────────────────────────────────────────────────
const tmdbindex = new Map();

// ─── MATCH ────────────────────────────────────────────────────────────────────
async function matchItem(item, tmdbApiKey, type, lang) {
  const name = item.name || item.filename || '';
  const cacheKey = `match:${type}:${lang}:${name}`;

  const cached = matchCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const info = guessMediaInfo(name);
  if (!info) {
    matchCache.set(cacheKey, null);
    return null;
  }

  try {
    const tmdbType = type === 'movie' ? 'movie' : 'series';
    const result = await searchMetadata(tmdbApiKey, info.title, tmdbType, info.year, lang);

    if (!result) {
      matchCache.set(cacheKey, null);
      return null;
    }

    const meta = {
      id: `torbox:${type}:${result.id}`,
      type,
      name: result.title || result.name,
      poster: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
      released: result.release_date || result.first_air_date,
      tmdbId: result.id,
      torboxItem: item,
      season: info.season,
      episode: info.episode
    };

    matchCache.set(cacheKey, meta);
    return meta;

  } catch {
    matchCache.set(cacheKey, null);
    return null;
  }
}

// ─── CATALOG ──────────────────────────────────────────────────────────────────
async function buildCatalog(downloads, tmdbApiKey, type, sortBy, extra, lang) {
  const skip = parseInt(extra?.skip) || 0;
  const PAGE_SIZE = 50;

  const metas = [];

  for (const item of downloads) {
    const meta = await matchItem(item, tmdbApiKey, type, lang);
    if (meta) metas.push(meta);
  }

  // indexar
  for (const meta of metas) {
    const key = `${meta.type}:${meta.tmdbId}`;
    if (!tmdbindex.has(key)) tmdbindex.set(key, []);
    tmdbindex.get(key).push({
      item: meta.torboxItem,
      season: meta.season,
      episode: meta.episode
    });
  }

  return metas.slice(skip, skip + PAGE_SIZE);
}

// ─── META ─────────────────────────────────────────────────────────────────────
async function buildMeta(tmdbId, type, tmdbApiKey, lang) {
  const tmdbType = type === 'series' ? 'series' : 'movie';
  return await getMetadata(tmdbApiKey, tmdbId, tmdbType, lang);
}

// ─── STREAMS (OTIMIZADO) ──────────────────────────────────────────────────────
async function buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode, lang) {
  const key = `${type}:${tmdbId}`;
  const entries = tmdbindex.get(key);

  if (!entries || !entries.length) {
    console.log('[Stream] ❌ Sem índice → evitando rebuild');
    return [];
  }

  const MAX_STREAMS = 5;
  const streams = [];

  for (const { item } of entries) {
    if (streams.length >= MAX_STREAMS) break;

    const files = await getTorBoxFiles(torboxApiKey, item.source, item.id);
    const videos = files.filter(f => isVideoFile(f.name || f.short_name));

    for (const file of videos.slice(0, 2)) {
      if (streams.length >= MAX_STREAMS) break;

      const cacheKey = `stream:${item.id}:${file.id}`;
      let url = streamCache.get(cacheKey);

      if (!url) {
        url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, file.id);
        if (url) streamCache.set(cacheKey, url);
      }

      if (!url) continue;

      streams.push({
        url,
        name: '⚡ TorBox',
        behaviorHints: { notWebReady: false }
      });
    }
  }

  return streams;
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
  buildCatalog,
  buildMeta,
  buildStreams
};
