const { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile } = require('./torbox');
const { searchMetadata, getMetadata } = require('./tmdb');
const { guessMediaInfo } = require('./parser');
const NodeCache = require('node-cache');

const matchCache = new NodeCache({ stdTTL: 86400 }); // 24h for TMDB matches

/**
 * Match a single TorBox item to TMDB, returning minimal catalog meta.
 */
async function matchItem(item, tmdbApiKey, type) {
  const name = item.name || item.filename || '';
  const cacheKey = `match:${type}:${name}`;
  const cached = matchCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const info = guessMediaInfo(name);
  if (!info) {
    matchCache.set(cacheKey, null);
    return null;
  }

  // Skip obvious mismatches (series files in movie catalog etc.)
  if (type === 'movie' && info.isSeries) { matchCache.set(cacheKey, null); return null; }
  if (type === 'series' && !info.isSeries) { matchCache.set(cacheKey, null); return null; }

  try {
    const tmdbType = type === 'series' ? 'series' : 'movie';
    const result = await searchMetadata(tmdbApiKey, info.title, tmdbType, info.year);
    if (!result) { matchCache.set(cacheKey, null); return null; }

    const tmdbId = result.id;
    const poster = result.poster_path
      ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
      : null;

    const meta = {
      id: `torbox:${type}:${tmdbId}`,
      type,
      name: result.title || result.name,
      poster,
      releaseInfo: (result.release_date || result.first_air_date || '').split('-')[0],
      released: result.release_date || result.first_air_date,
      tmdbId,
      popularity: result.popularity,
      torboxItem: item,
    };

    matchCache.set(cacheKey, meta);
    return meta;
  } catch (err) {
    console.error(`TMDB match error for "${name}":`, err.message);
    matchCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Build catalog: match all TorBox downloads to TMDB, deduplicate, sort, paginate.
 */
async function buildCatalog(downloads, tmdbApiKey, type, sortBy, extra) {
  const skip = parseInt(extra?.skip) || 0;
  const search = extra?.search?.toLowerCase();
  const PAGE_SIZE = 50;

  // Match all in parallel (with concurrency limit)
  const CONCURRENCY = 5;
  const results = [];
  for (let i = 0; i < downloads.length; i += CONCURRENCY) {
    const batch = downloads.slice(i, i + CONCURRENCY);
    const matched = await Promise.all(batch.map((item) => matchItem(item, tmdbApiKey, type)));
    results.push(...matched);
  }

  // Deduplicate by TMDB id, merging torbox items
  const seen = new Map();
  for (const meta of results) {
    if (!meta) continue;
    if (!seen.has(meta.id)) {
      seen.set(meta.id, { ...meta, torboxItems: [meta.torboxItem] });
    } else {
      seen.get(meta.id).torboxItems.push(meta.torboxItem);
    }
  }

  let metas = Array.from(seen.values());

  // Search filter
  if (search) {
    metas = metas.filter((m) => m.name?.toLowerCase().includes(search));
  }

  // Sort
  if (sortBy === 'data_lancamento') {
    metas.sort((a, b) => (b.released || '').localeCompare(a.released || ''));
  } else if (sortBy === 'titulo') {
    metas.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  } else {
    // data_adicao: by TorBox item created_at
    metas.sort((a, b) => {
      const aDate = a.torboxItems?.[0]?.created_at || '';
      const bDate = b.torboxItems?.[0]?.created_at || '';
      return bDate.localeCompare(aDate);
    });
  }

  // Remove internal fields before returning
  const cleanMetas = metas.slice(skip, skip + PAGE_SIZE).map(({ torboxItem, torboxItems, tmdbId, popularity, ...rest }) => rest);

  return cleanMetas;
}

/**
 * Build full meta object for a TMDB id.
 */
async function buildMeta(tmdbId, type, tmdbApiKey) {
  const { getMetadata } = require('./tmdb');
  return await getMetadata(tmdbApiKey, tmdbId, type);
}

/**
 * Build stream list from TorBox files matching a specific movie/episode.
 */
async function buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode) {
  const allDownloads = await getTorBoxDownloads(torboxApiKey, type);
  const streams = [];

  for (const item of allDownloads) {
    const name = item.name || item.filename || '';
    const info = guessMediaInfo(name);
    if (!info) continue;

    // Try to match TMDB id
    const tmdbResult = await searchMetadata(tmdbApiKey, info.title, type === 'series' ? 'series' : 'movie', info.year).catch(() => null);
    if (!tmdbResult || String(tmdbResult.id) !== String(tmdbId)) continue;

    // For series, filter by season/episode
    if (type === 'series') {
      if (info.season && String(info.season) !== String(season)) continue;
      if (info.episode && String(info.episode) !== String(episode)) continue;
    }

    // Get files
    const files = await getTorBoxFiles(torboxApiKey, item.source, item.id);
    const videoFiles = files.filter((f) => isVideoFile(f.name || f.short_name));

    for (const file of videoFiles) {
      try {
        const url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, file.id);
        if (!url) continue;

        const quality = extractQuality(file.name || item.name);
        const size = formatBytes(file.size);

        streams.push({
          url,
          name: `TorBox\n${quality}`,
          description: `📁 ${file.name || item.name}\n💾 ${size}\n⚡ ${item.source === 'torrent' ? 'Torrent' : 'Usenet'}`,
          behaviorHints: {
            notWebReady: false,
          },
        });
      } catch (err) {
        console.error('Stream link error:', err.message);
      }
    }

    // If no individual files found, try the item itself
    if (streams.length === 0) {
      try {
        const url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, 0);
        if (url) {
          const quality = extractQuality(item.name);
          streams.push({
            url,
            name: `TorBox\n${quality}`,
            description: `📁 ${item.name}\n⚡ ${item.source === 'torrent' ? 'Torrent' : 'Usenet'}`,
          });
        }
      } catch {}
    }
  }

  return streams;
}

function extractQuality(name = '') {
  const n = name.toUpperCase();
  if (n.includes('2160P') || n.includes('4K') || n.includes('UHD')) return '4K';
  if (n.includes('1080P')) return '1080p';
  if (n.includes('720P')) return '720p';
  if (n.includes('480P')) return '480p';
  if (n.includes('BLURAY') || n.includes('BLU-RAY')) return 'BluRay';
  if (n.includes('WEBRIP') || n.includes('WEB-RIP')) return 'WEBRip';
  if (n.includes('WEBDL') || n.includes('WEB-DL')) return 'WEB-DL';
  return 'SD';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(0)} MB`;
}

module.exports = { buildCatalog, buildMeta, buildStreams };
