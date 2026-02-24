const fs   = require('fs');
const path = require('path');
const { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile } = require('./torbox');
const { searchMetadata, getMetadata } = require('./tmdb');
const { guessMediaInfo } = require('./parser');
const NodeCache = require('node-cache');

// ─── CACHE TMDB PERSISTENTE ───────────────────────────────────────────────────
const CACHE_FILE = '/tmp/torbox-tmdb-cache.json';
const matchCache = new NodeCache({ stdTTL: 86400 }); // 24h

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

// ─── ÍNDICE tmdbId → [torboxItems] ───────────────────────────────────────────
// Populado durante buildCatalog, consultado em buildStreams (lookup O(1))
const tmdbIndex = new Map(); // `${type}:${tmdbId}` → [torboxItem, ...]

// ─── MATCH ITEM ───────────────────────────────────────────────────────────────
async function matchItem(item, tmdbApiKey, type) {
  const name     = item.name || item.filename || '';
  const cacheKey = `match:${type}:${name}`;

  const cached = matchCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const info = guessMediaInfo(name);
  if (!info || (type === 'movie' && info.isSeries) || (type === 'series' && !info.isSeries)) {
    matchCache.set(cacheKey, null);
    return null;
  }

  try {
    const result = await searchMetadata(tmdbApiKey, info.title, type === 'series' ? 'series' : 'movie', info.year);
    if (!result) {
      matchCache.set(cacheKey, null);
      return null;
    }

    console.log(`[TMDB] "${info.title}" → "${result.title || result.name}" (${result.id})`);

    const meta = {
      id:          `torbox:${type}:${result.id}`,
      type,
      name:        result.title || result.name,
      poster:      result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
      releaseInfo: (result.release_date || result.first_air_date || '').split('-')[0],
      released:    result.release_date || result.first_air_date,
      tmdbId:      result.id,
      torboxItem:  item,
      // Guarda info de série para filtro de episódio
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
async function buildCatalog(downloads, tmdbApiKey, type, sortBy, extra) {
  const skip      = parseInt(extra?.skip) || 0;
  const search    = extra?.search?.toLowerCase();
  const PAGE_SIZE = 50;

  // STEP 1: Filtrar e deduplicar por parser (sem rede)
  const relevant    = [];
  const dedupTitles = new Map();

  for (const item of downloads) {
    const name = item.name || item.filename || '';
    const info = guessMediaInfo(name);
    if (!info) continue;
    if (type === 'movie'  && info.isSeries)  continue;
    if (type === 'series' && !info.isSeries) continue;

    const dedupeKey = `${info.title}::${info.year}`;
    if (!dedupTitles.has(dedupeKey)) {
      dedupTitles.set(dedupeKey, true);
      relevant.push({ item, info });
    }
  }

  console.log(`[Catalog] type=${type} | raw=${downloads.length} → after filter+dedup=${relevant.length}`);

  // STEP 2: TMDB lookup em paralelo
  const CONCURRENCY = 15;
  const results     = [];

  for (let i = 0; i < relevant.length; i += CONCURRENCY) {
    const batch   = relevant.slice(i, i + CONCURRENCY);
    const matched = await Promise.all(batch.map(({ item }) => matchItem(item, tmdbApiKey, type)));
    results.push(...matched.filter(Boolean));
  }

  // STEP 3: Deduplicar por TMDB id e popular índice
  const seen = new Map();
  for (const meta of results) {
    const indexKey = `${type}:${meta.tmdbId}`;
    if (!seen.has(meta.id)) {
      seen.set(meta.id, { ...meta, torboxItems: [{ item: meta.torboxItem, season: meta.season, episode: meta.episode }] });
      tmdbIndex.set(indexKey, [{ item: meta.torboxItem, season: meta.season, episode: meta.episode }]);
    } else {
      const entry = { item: meta.torboxItem, season: meta.season, episode: meta.episode };
      seen.get(meta.id).torboxItems.push(entry);
      tmdbIndex.get(indexKey)?.push(entry);
    }
  }

  let metas = Array.from(seen.values());

  // STEP 4: Filtro de busca
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
    .map(({ torboxItem, torboxItems, tmdbId, released, season, episode, ...rest }) => rest)
    .filter(m => m.poster);
}

// ─── META ─────────────────────────────────────────────────────────────────────
async function buildMeta(tmdbId, type, tmdbApiKey) {
  return await getMetadata(tmdbApiKey, tmdbId, type);
}

// ─── STREAMS ──────────────────────────────────────────────────────────────────
// Usa o índice tmdbId→items para lookup O(1) em vez de varrer 1048 itens
async function buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode) {
  const indexKey = `${type}:${tmdbId}`;
  let entries    = tmdbIndex.get(indexKey);

  // Se índice ainda não foi populado (primeiro request após restart),
  // faz busca rápida só dos itens cacheados no matchCache
  if (!entries) {
    console.log(`[Stream] Índice vazio para ${indexKey}, reconstruindo do matchCache...`);
    entries = [];
    const downloads = await getTorBoxDownloads(torboxApiKey);
    for (const item of downloads) {
      const name     = item.name || item.filename || '';
      const cacheKey = `match:${type}:${name}`;
      const cached   = matchCache.get(cacheKey);
      if (cached && String(cached.tmdbId) === String(tmdbId)) {
        entries.push({ item, season: cached.season, episode: cached.episode });
      }
    }
    if (entries.length > 0) tmdbIndex.set(indexKey, entries);
  }

  if (!entries || entries.length === 0) {
    console.log(`[Stream] Nenhum item encontrado para tmdbId=${tmdbId}`);
    return [];
  }

  // Filtra por temporada/episódio (só para séries)
  const filtered = type === 'series'
    ? entries.filter(({ season: s, episode: e }) => {
        if (season  && s && String(s) !== String(season))  return false;
        if (episode && e && String(e) !== String(episode)) return false;
        return true;
      })
    : entries;

  console.log(`[Stream] ${filtered.length} item(s) para tmdbId=${tmdbId} s=${season} e=${episode}`);

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
