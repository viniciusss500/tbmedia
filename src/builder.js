const { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile } = require('./torbox');
const { searchMetadata, getMetadata } = require('./tmdb');
const { guessMediaInfo } = require('./parser');
const NodeCache = require('node-cache');

const matchCache = new NodeCache({ stdTTL: 86400 }); // 24h

/**
 * Match a single TorBox item to TMDB.
 */
async function matchItem(item, tmdbApiKey, type) {
  const name = item.name || item.filename || '';
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
      id: `torbox:${type}:${result.id}`,
      type,
      name: result.title || result.name,
      poster: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
      releaseInfo: (result.release_date || result.first_air_date || '').split('-')[0],
      released: result.release_date || result.first_air_date,
      tmdbId: result.id,
      torboxItem: item,
    };

    matchCache.set(cacheKey, meta);
    return meta;
  } catch (err) {
    console.error(`[TMDB] Error "${name}": ${err.message}`);
    matchCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Build catalog — filters by type BEFORE hitting TMDB to avoid timeout.
 */
async function buildCatalog(downloads, tmdbApiKey, type, sortBy, extra) {
  const skip     = parseInt(extra?.skip) || 0;
  const search   = extra?.search?.toLowerCase();
  const PAGE_SIZE = 50;

  // ── STEP 1: Filter by type using only the parser (no network calls) ──────
  // This reduces 1048 items to only the relevant type before any TMDB requests
  const relevant = [];
  const dedupTitles = new Map(); // title → item (pick one representative per unique title)

  for (const item of downloads) {
    const name = item.name || item.filename || '';
    const info = guessMediaInfo(name);
    if (!info) continue;
    if (type === 'movie'  && info.isSeries)  continue;
    if (type === 'series' && !info.isSeries) continue;

    // Deduplicate by title+year at parse level to avoid redundant TMDB calls
    const dedupeKey = `${info.title}::${info.year}`;
    if (!dedupTitles.has(dedupeKey)) {
      dedupTitles.set(dedupeKey, { item, info });
      relevant.push({ item, info });
    }
  }

  console.log(`[Catalog] type=${type} | raw=${downloads.length} → after filter+dedup=${relevant.length}`);

  // ── STEP 2: TMDB lookup only for the filtered+deduped set ────────────────
  const CONCURRENCY = 10;
  const results = [];

  for (let i = 0; i < relevant.length; i += CONCURRENCY) {
    const batch = relevant.slice(i, i + CONCURRENCY);
    const matched = await Promise.all(
      batch.map(({ item, info }) => matchItem(item, tmdbApiKey, type))
    );
    results.push(...matched.filter(Boolean));
  }

  // ── STEP 3: Deduplicate by TMDB id ───────────────────────────────────────
  const seen = new Map();
  for (const meta of results) {
    if (!seen.has(meta.id)) {
      seen.set(meta.id, { ...meta, torboxItems: [meta.torboxItem] });
    } else {
      seen.get(meta.id).torboxItems.push(meta.torboxItem);
    }
  }

  let metas = Array.from(seen.values());

  // ── STEP 4: Search filter ─────────────────────────────────────────────────
  if (search) {
    metas = metas.filter(m => m.name?.toLowerCase().includes(search));
  }

  // ── STEP 5: Sort ─────────────────────────────────────────────────────────
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

  return paginated.map(({ torboxItem, torboxItems, tmdbId, ...rest }) => rest);
}

/**
 * Full meta for a single item.
 */
async function buildMeta(tmdbId, type, tmdbApiKey) {
  return await getMetadata(tmdbApiKey, tmdbId, type);
}

/**
 * Stream links for a movie or episode.
 */
async function buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode) {
  const allDownloads = await getTorBoxDownloads(torboxApiKey);
  const streams = [];

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

    const files = await getTorBoxFiles(torboxApiKey, item.source, item.id);
    const videoFiles = files.filter(f => isVideoFile(f.name || f.short_name));

    if (videoFiles.length > 0) {
      for (const file of videoFiles) {
        try {
          const url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, file.id);
          if (!url) continue;
          streams.push({
            url,
            name: `TorBox\n${extractQuality(file.name || item.name)}`,
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
          name: `TorBox\n${extractQuality(item.name)}`,
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
