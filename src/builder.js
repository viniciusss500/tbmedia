const fs   = require('fs');
const path = require('path');
const { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile } = require('./torbox');
const { searchMetadata, getMetadata } = require('./tmdb');
const { guessMediaInfo } = require('./parser');
const NodeCache = require('node-cache');

// ─── CACHE PERSISTENTE ────────────────────────────────────────────────────────
const CACHE_FILE = '/tmp/torbox-tmdb-cache.json';
const matchCache = new NodeCache({ stdTTL: 86400 });

function loadPersistentCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      let count = 0;
      for (const [k, v] of Object.entries(data)) {
        matchCache.set(k, v);
        count++;
      }
      console.log(`[Cache] Loaded ${count} TMDB entries from disk`);
    }
  } catch (e) {
    console.error('[Cache] Load error:', e.message);
  }
}

function savePersistentCache() {
  try {
    const data = {};
    for (const k of matchCache.keys()) {
      const v = matchCache.get(k);
      if (v !== undefined) data[k] = v;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch (e) {
    console.error('[Cache] Save error:', e.message);
  }
}

loadPersistentCache();
setInterval(savePersistentCache, 60_000);

// ─── ÍNDICE tmdbId → [torboxItems] ────────────────────────────────────────────
const tmdbIndex = new Map();

// ─── MATCH ITEM ───────────────────────────────────────────────────────────────
// type aqui é 'movie' | 'series' | 'anime'
// Para TMDB, anime é sempre 'series'
async function matchItem(item, tmdbApiKey, type, lang) {
  const name      = item.name || item.filename || '';
  const tmdbType  = type === 'movie' ? 'movie' : 'series';
  const cacheKey  = `match:${type}:${lang}:${name}`;

  const cached = matchCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const info = guessMediaInfo(name);
  if (!info) {
    matchCache.set(cacheKey, null);
    return null;
  }

  // Filtro por tipo
  if (type === 'movie'  && (info.isSeries || info.isAnime)) { matchCache.set(cacheKey, null); return null; }
  if (type === 'series' && (!info.isSeries || info.isAnime)) { matchCache.set(cacheKey, null); return null; }
  if (type === 'anime'  && !info.isAnime)                   { matchCache.set(cacheKey, null); return null; }

  try {
    const result = await searchMetadata(tmdbApiKey, info.title, tmdbType, info.year, lang);
    if (!result) {
      matchCache.set(cacheKey, null);
      return null;
    }

    console.log(`[TMDB] "${info.title}" → "${result.title || result.name}" (${result.id})`);

    const stremioType = type === 'anime' ? 'series' : type;
    const meta = {
      id:          `torbox:${stremioType}:${result.id}`,
      type:        stremioType,
      name:        result.title || result.name,
      poster:      result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
      releaseInfo: (result.release_date || result.first_air_date || '').split('-')[0],
      released:    result.release_date || result.first_air_date,
      tmdbId:      result.id,
      catalogType: type, // 'movie' | 'series' | 'anime'
      torboxItem:  item,
      season:      info.season,
      episode:     info.episode,
    };

    matchCache.set(cacheKey, meta);
    return meta;
  } catch (err) {
    console.error(`[TMDB] Error "${name}": ${err.message}`);
    matchCache.set(cacheKey, null);
    return null;
  }
}

// ─── BUILD CATALOG ────────────────────────────────────────────────────────────
async function buildCatalog(downloads, tmdbApiKey, type, sortBy, extra, lang = 'pt-BR') {
  const skip      = parseInt(extra?.skip) || 0;
  const search    = extra?.search?.toLowerCase();
  const PAGE_SIZE = 50;

  // STEP 1: Filtrar e deduplicar
  const relevant    = [];
  const dedupTitles = new Map();

  for (const item of downloads) {
    const name = item.name || item.filename || '';
    const info = guessMediaInfo(name);
    if (!info) continue;

    if (type === 'movie'  && (info.isSeries || info.isAnime))  continue;
    if (type === 'series' && (!info.isSeries || info.isAnime)) continue;
    if (type === 'anime'  && !info.isAnime)                    continue;

    const dedupeKey = `${info.title}::${info.year}`;
    if (!dedupTitles.has(dedupeKey)) {
      dedupTitles.set(dedupeKey, true);
      relevant.push({ item, info });
    }
  }

  console.log(`[Catalog] type=${type} | raw=${downloads.length} → after filter+dedup=${relevant.length}`);

  // STEP 2: TMDB lookup
  const CONCURRENCY = 15;
  const results     = [];

  for (let i = 0; i < relevant.length; i += CONCURRENCY) {
    const batch   = relevant.slice(i, i + CONCURRENCY);
    const matched = await Promise.all(batch.map(({ item }) => matchItem(item, tmdbApiKey, type, lang)));
    results.push(...matched.filter(Boolean));
  }

  // STEP 3: Deduplicar por TMDB id + popular índice
  const seen = new Map();
  for (const meta of results) {
    const indexKey = `${meta.type}:${meta.tmdbId}`;
    const entry    = { item: meta.torboxItem, season: meta.season, episode: meta.episode };

    if (!seen.has(meta.id)) {
      seen.set(meta.id, { ...meta, torboxItems: [entry] });
      tmdbIndex.set(indexKey, [entry]);
    } else {
      seen.get(meta.id).torboxItems.push(entry);
      tmdbIndex.get(indexKey)?.push(entry);
    }
  }

  let metas = Array.from(seen.values());

  // STEP 4: Busca
  if (search) {
    metas = metas.filter(m => m.name?.toLowerCase().includes(search));
  }

  // STEP 5: Ordenação
  if (sortBy === 'data_lancamento') {
    metas.sort((a, b) => (b.released || '').localeCompare(a.released || ''));
  } else if (sortBy === 'titulo') {
    metas.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  } else {
    metas.sort((a, b) => {
      const aDate = a.torboxItems?.[0]?.item?.created_at || '';
      const bDate = b.torboxItems?.[0]?.item?.created_at || '';
      return bDate.localeCompare(aDate);
    });
  }

  const paginated = metas.slice(skip, skip + PAGE_SIZE);
  console.log(`[Catalog] Returning ${paginated.length} items (skip=${skip}, total=${metas.length})`);

  return paginated
    .map(({ torboxItem, torboxItems, tmdbId, released, catalogType, season, episode, ...rest }) => rest)
    .filter(m => m.poster);
}

// ─── META ─────────────────────────────────────────────────────────────────────
async function buildMeta(tmdbId, type, tmdbApiKey, lang = 'pt-BR') {
  // anime usa type 'series' no TMDB
  const tmdbType = type === 'anime' ? 'series' : type;
  return await getMetadata(tmdbApiKey, tmdbId, tmdbType, lang);
}

// ─── STREAMS ──────────────────────────────────────────────────────────────────
async function buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode, lang) {
  const indexKey = `${type === 'anime' ? 'series' : type}:${tmdbId}`;
  let entries    = tmdbIndex.get(indexKey);

  if (!entries) {
    console.log(`[Stream] Índice vazio para ${indexKey}, reconstruindo do matchCache...`);
    entries = [];
    const downloads = await getTorBoxDownloads(torboxApiKey);
    for (const item of downloads) {
      const name     = item.name || item.filename || '';
      // Tenta os três tipos de cache
      for (const t of ['movie', 'series', 'anime']) {
        const cacheKey = `match:${t}:${lang || 'pt-BR'}:${name}`;
        const cached   = matchCache.get(cacheKey);
        if (cached && String(cached.tmdbId) === String(tmdbId)) {
          entries.push({ item, season: cached.season, episode: cached.episode });
          break;
        }
      }
    }
    if (entries.length > 0) tmdbIndex.set(indexKey, entries);
  }

  if (!entries || entries.length === 0) return [];

  const filtered = (type === 'series' || type === 'anime')
    ? entries.filter(({ season: s, episode: e }) => {
        if (season  && s && String(s) !== String(season))  return false;
        if (episode && e && String(e) !== String(episode)) return false;
        return true;
      })
    : entries;

  console.log(`[Stream] ${filtered.length} item(s) para ${indexKey} s=${season} e=${episode}`);

  const streams = [];
  for (const { item } of filtered) {
    const files      = await getTorBoxFiles(torboxApiKey, item.source, item.id);
    const videoFiles = files.filter(f => isVideoFile(f.name || f.short_name));

    if (videoFiles.length > 0) {
      for (const file of videoFiles) {
        try {
          const url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, file.id);
          if (!url) continue;
          streams.push({
            url,
            name:          `TorBox\n${extractQuality(file.name || item.name)}`,
            description:   `📁 ${file.name || item.name}\n💾 ${formatBytes(file.size)}\n⚡ ${item.source}`,
            behaviorHints: { notWebReady: false },
          });
        } catch {}
      }
    } else {
      try {
        const url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, 0);
        if (url) streams.push({
          url,
          name:          `TorBox\n${extractQuality(item.name)}`,
          description:   `📁 ${item.name}\n⚡ ${item.source}`,
          behaviorHints: { notWebReady: false },
        });
      } catch {}
    }
  }

  return streams;
}

function extractQuality(name = '') {
  const n = name.toUpperCase();
  if (n.includes('2160P') || n.includes('4K') || n.includes('UHD')) return '4K';
  if (n.includes('1080P')) return '1080p';
  if (n.includes('720P'))  return '720p';
  if (n.includes('480P'))  return '480p';
  if (n.includes('BLURAY') || n.includes('BLU-RAY')) return 'BluRay';
  if (n.includes('WEBRIP') || n.includes('WEB-RIP')) return 'WEBRip';
  if (n.includes('WEBDL')  || n.includes('WEB-DL'))  return 'WEB-DL';
  return 'SD';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

module.exports = { buildCatalog, buildMeta, buildStreams };
