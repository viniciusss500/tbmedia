const fs   = require('fs');
const path = require('path');
const { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile } = require('./torbox');
const { searchMetadata, getMetadata } = require('./tmdb');
const { guessMediaInfo } = require('./parser');
const NodeCache = require('node-cache');

// ─── CACHE PERSISTENTE ────────────────────────────────────────────────────────
// Salva em disco para sobreviver restarts — evita refazer 400+ lookups TMDB
const CACHE_FILE = path.join('/tmp', 'torbox-tmdb-cache.json');
const matchCache = new NodeCache({ stdTTL: 86400 }); // 24h em memória

function loadPersistentCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      let count = 0;
      for (const [k, v] of Object.entries(data)) {
        matchCache.set(k, v);
        count++;
      }
      console.log(`[Cache] Loaded ${count} TMDB matches from disk`);
    }
  } catch (e) {
    console.error('[Cache] Failed to load persistent cache:', e.message);
  }
}

function savePersistentCache() {
  try {
    const keys = matchCache.keys();
    const data = {};
    for (const k of keys) {
      const v = matchCache.get(k);
      if (v !== undefined) data[k] = v;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch (e) {
    console.error('[Cache] Failed to save persistent cache:', e.message);
  }
}

// Carrega cache do disco na inicialização
loadPersistentCache();
// Salva a cada 60s
setInterval(savePersistentCache, 60_000);

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
      console.log(`[TMDB] No result: "${info.title}"`);
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
  const relevant     = [];
  const dedupTitles  = new Map();

  for (const item of downloads) {
    const name = item.name || item.filename || '';
    const info = guessMediaInfo(name);
    if (!info) continue;
    if (type === 'movie'  && info.isSeries)  continue;
    if (type === 'series' && !info.isSeries) continue;

    const dedupeKey = `${info.title}::${info.year}`;
    if (!dedupTitles.has(dedupeKey)) {
      dedupTitles.set(dedupeKey, { item, info });
      relevant.push({ item, info });
    }
  }

  console.log(`[Catalog] type=${type} | raw=${downloads.length} → after filter+dedup=${relevant.length}`);

  // STEP 2: TMDB lookup (cache hit = 0ms, miss = rede)
  const CONCURRENCY = 15;
  const results     = [];

  for (let i = 0; i < relevant.length; i += CONCURRENCY) {
    const batch   = relevant.slice(i, i + CONCURRENCY);
    const matched = await Promise.all(batch.map(({ item }) => matchItem(item, tmdbApiKey, type)));
    results.push(...matched.filter(Boolean));
  }

  // STEP 3: Deduplicar por TMDB id
  const seen = new Map();
  for (const meta of results) {
    if (!seen.has(meta.id)) {
      seen.set(meta.id, { ...meta, torboxItems: [meta.torboxItem] });
    } else {
      seen.get(meta.id).torboxItems.push(meta.torboxItem);
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
      const aDate = a.torboxItems?.[0]?.created_at || '';
      const bDate = b.torboxItems?.[0]?.created_at || '';
      return bDate.localeCompare(aDate);
    });
  }

  const paginated = metas.slice(skip, skip + PAGE_SIZE);
  console.log(`[Catalog] Returning ${paginated.length} items (skip=${skip}, total=${metas.length})`);

  const output = paginated
    .map(({ torboxItem, torboxItems, tmdbId, released, ...rest }) => rest)
    .filter(m => m.poster);

  return output;
}

// ─── META ─────────────────────────────────────────────────────────────────────
async function buildMeta(tmdbId, type, tmdbApiKey) {
  return await getMetadata(tmdbApiKey, tmdbId, type);
}

// ─── STREAMS ──────────────────────────────────────────────────────────────────
async function buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode) {
  const allDownloads = await getTorBoxDownloads(torboxApiKey);
  const streams      = [];

  for (const item of allDownloads) {
    const name = item.name || item.filename || '';
    const info = guessMediaInfo(name);
    if (!info) continue;
    if (type === 'movie'  && info.isSeries)  continue;
    if (type === 'series' && !info.isSeries) continue;

    const tmdbResult = await searchMetadata(
      tmdbApiKey, info.title,
      type === 'series' ? 'series' : 'movie',
      info.year
    ).catch(() => null);

    if (!tmdbResult || String(tmdbResult.id) !== String(tmdbId)) continue;

    if (type === 'series') {
      if (season  && info.season  && String(info.season)  !== String(season))  continue;
      if (episode && info.episode && String(info.episode) !== String(episode)) continue;
    }

    const files      = await getTorBoxFiles(torboxApiKey, item.source, item.id);
    const videoFiles = files.filter(f => isVideoFile(f.name || f.short_name));

    if (videoFiles.length > 0) {
      for (const file of videoFiles) {
        try {
          const url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, file.id);
          if (!url) continue;
          streams.push({
            url,
            name:        `TorBox\n${extractQuality(file.name || item.name)}`,
            description: `📁 ${file.name || item.name}\n💾 ${formatBytes(file.size)}\n⚡ ${item.source}`,
            behaviorHints: { notWebReady: false },
          });
        } catch {}
      }
    } else {
      try {
        const url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, 0);
        if (url) streams.push({
          url,
          name:        `TorBox\n${extractQuality(item.name)}`,
          description: `📁 ${item.name}\n⚡ ${item.source}`,
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
