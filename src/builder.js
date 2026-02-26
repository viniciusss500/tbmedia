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
      for (const [k, v] of Object.entries(data)) { matchCache.set(k, v); count++; }
      console.log(`[Cache] Loaded ${count} TMDB entries from disk`);
    }
  } catch (e) { console.error('[Cache] Load error:', e.message); }
}

function savePersistentCache() {
  try {
    const data = {};
    for (const k of matchCache.keys()) {
      const v = matchCache.get(k);
      if (v !== undefined) data[k] = v;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch (e) { console.error('[Cache] Save error:', e.message); }
}

loadPersistentCache();
setInterval(savePersistentCache, 60_000);

// ─── ÍNDICE tmdbId → [torboxItems] ────────────────────────────────────────────
const tmdbIndex = new Map();

// ─── MATCH ITEM ───────────────────────────────────────────────────────────────
async function matchItem(item, tmdbApiKey, type, lang) {
  const name      = item.name || item.filename || '';
  const tmdbType  = type === 'movie' ? 'movie' : 'series';
  const cacheKey  = `match:${type}:${lang}:${name}`;

  const cached = matchCache.get(cacheKey);
  if (cached !== undefined) {
    // Revalidar entradas antigas do cache — anime nunca deve estar em 'series'
    if (cached !== null) {
      const info = guessMediaInfo(name);
      if (info) {
        if (type === 'movie'  && (info.isSeries || info.isAnime)) { matchCache.set(cacheKey, null); return null; }
        if (type === 'series' && info.isAnime)                     { matchCache.set(cacheKey, null); return null; }
        if (type === 'anime'  && !info.isAnime)                    { matchCache.set(cacheKey, null); return null; }
      }
    }
    return cached;
  }

  const info = guessMediaInfo(name);
  if (!info) { matchCache.set(cacheKey, null); return null; }

  // Filtro estrito por tipo
  if (type === 'movie'  && (info.isSeries || info.isAnime))  { matchCache.set(cacheKey, null); return null; }
  if (type === 'series' && (!info.isSeries || info.isAnime)) { matchCache.set(cacheKey, null); return null; }
  if (type === 'anime'  && !info.isAnime)                    { matchCache.set(cacheKey, null); return null; }

  try {
    const result = await searchMetadata(tmdbApiKey, info.title, tmdbType, info.year, lang);
    if (!result) { matchCache.set(cacheKey, null); return null; }

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
      catalogType: type,
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

  // Filtrar por tipo (sem deduplicar ainda — precisamos de TODOS os episódios no índice)
  const allRelevant = [];
  for (const item of downloads) {
    const name = item.name || item.filename || '';
    const info = guessMediaInfo(name);
    if (!info) continue;
    if (type === 'movie'  && (info.isSeries || info.isAnime))  continue;
    if (type === 'series' && (!info.isSeries || info.isAnime)) continue;
    if (type === 'anime'  && !info.isAnime)                    continue;
    allRelevant.push({ item, info });
  }

  console.log(`[Catalog] type=${type} | raw=${downloads.length} → filtered=${allRelevant.length}`);

  // TMDB lookup para TODOS os itens (episódios individuais) — popula o índice completo
  const CONCURRENCY = 15;
  const results     = [];
  for (let i = 0; i < allRelevant.length; i += CONCURRENCY) {
    const batch   = allRelevant.slice(i, i + CONCURRENCY);
    const matched = await Promise.all(batch.map(({ item }) => matchItem(item, tmdbApiKey, type, lang)));
    results.push(...matched.filter(Boolean));
  }

  // Popula tmdbIndex com TODOS os episódios/arquivos (sem dedup)
  // e dedup por tmdbId só para exibição no catálogo
  const seen = new Map();
  for (const meta of results) {
    const indexKey = `${meta.type}:${meta.tmdbId}`;
    const entry    = { item: meta.torboxItem, season: meta.season, episode: meta.episode };

    // Índice: acumula todos os episódios/arquivos para streams
    if (!tmdbIndex.has(indexKey)) {
      tmdbIndex.set(indexKey, [entry]);
    } else {
      // Evitar duplicatas no índice pelo mesmo item
      const existing = tmdbIndex.get(indexKey);
      const isDup = existing.some(e => e.item.id === entry.item.id);
      if (!isDup) existing.push(entry);
    }

    // Catálogo: apenas um card por show
    if (!seen.has(meta.id)) {
      seen.set(meta.id, { ...meta, torboxItems: [entry] });
    }
  }

  let metas = Array.from(seen.values());

  if (search) metas = metas.filter(m => m.name?.toLowerCase().includes(search));

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
  const tmdbType = type === 'anime' ? 'series' : type;
  return await getMetadata(tmdbApiKey, tmdbId, tmdbType, lang);
}

// ─── STREAMS ──────────────────────────────────────────────────────────────────
async function buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode, lang) {
  const indexKey = `${type === 'anime' ? 'series' : type}:${tmdbId}`;
  let entries    = tmdbIndex.get(indexKey);

  if (!entries) {
    console.log(`[Stream] Índice vazio para ${indexKey}, reconstruindo...`);
    entries = [];
    const downloads = await getTorBoxDownloads(torboxApiKey);
    for (const item of downloads) {
      const name = item.name || item.filename || '';
      for (const t of ['movie', 'series', 'anime']) {
        const cached = matchCache.get(`match:${t}:${lang || 'pt-BR'}:${name}`);
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
          const fname = file.name || file.short_name || item.name || '';
          streams.push({
            url,
            name:          formatStreamName(fname),
            description:   formatStreamDesc(fname, file.size, item.source),
            behaviorHints: { notWebReady: false },
          });
        } catch {}
      }
    } else {
      try {
        const url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, 0);
        if (url) {
          const fname = item.name || '';
          streams.push({
            url,
            name:          formatStreamName(fname),
            description:   formatStreamDesc(fname, item.size, item.source),
            behaviorHints: { notWebReady: false },
          });
        }
      } catch {}
    }
  }

  return streams;
}

// ─── FORMATAÇÃO DOS STREAMS ───────────────────────────────────────────────────
function formatStreamName(filename = '') {
  const q   = extractQuality(filename);
  const c   = extractCodec(filename);
  const hdr = extractHDR(filename);
  const src = extractSource(filename);

  const badges = [q, hdr, c, src].filter(Boolean).join(' · ');
  return badges ? `⚡ TorBox · ${badges}` : '⚡ TorBox';
}

function formatStreamDesc(filename = '', size, source) {
  const lang = extractAudio(filename);
  const subs = extractSubs(filename);
  const sz   = size ? formatBytes(size) : '';

  // Truncar nome do arquivo para exibição
  const displayName = truncateFilename(filename, 60);

  const lines = [];
  if (displayName) lines.push(`📄 ${displayName}`);
  const details = [
    lang  ? `🎙 ${lang}`  : '',
    subs  ? `💬 ${subs}`  : '',
    sz    ? `💾 ${sz}`    : '',
    source ? `☁️ ${source}` : '',
  ].filter(Boolean).join('   ');
  if (details) lines.push(details);

  return lines.join('\n');
}

function truncateFilename(name = '', maxLen = 60) {
  // Remove extensão e encurta se necessário
  const clean = name.replace(/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i, '');
  if (clean.length <= maxLen) return clean;
  return clean.substring(0, maxLen - 1) + '…';
}

function extractQuality(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\b(2160P|4K|UHD)\b/)) return '4K';
  if (u.match(/\b1080P\b/))           return '1080p';
  if (u.match(/\b720P\b/))            return '720p';
  if (u.match(/\b480P\b/))            return '480p';
  return '';
}

function extractCodec(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\bH\.?265\b|\bHEVC\b|\bX265\b/)) return 'H.265';
  if (u.match(/\bH\.?264\b|\bAVC\b|\bX264\b/))  return 'H.264';
  if (u.match(/\bAV1\b/))                         return 'AV1';
  return '';
}

function extractHDR(n = '') {
  const u = n.toUpperCase();
  if (u.match(/DOLBY.?VISION|DV\b/)) return 'Dolby Vision';
  if (u.match(/HDR10\+/))             return 'HDR10+';
  if (u.match(/\bHDR\b/))            return 'HDR';
  return '';
}

function extractSource(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\bBLURAY\b|\bBLU.RAY\b|\bBDRIP\b/)) return 'BluRay';
  if (u.match(/\bWEB.DL\b|\bWEBDL\b/))              return 'WEB-DL';
  if (u.match(/\bWEBRIP\b|\bWEB.RIP\b/))            return 'WEBRip';
  if (u.match(/\bHDTV\b/))                           return 'HDTV';
  if (u.match(/\bDVDRIP\b/))                         return 'DVDRip';
  return '';
}

function extractAudio(n = '') {
  const u = n.toUpperCase();
  const parts = [];

  if (u.match(/\bDUAL\b|\bDUBLADO\b/))        parts.push('Dublado');
  else if (u.match(/\bNACIONAL\b|\bPT.?BR\b/)) parts.push('PT-BR');
  else if (u.match(/\bPT.?PT\b/))              parts.push('PT-PT');
  else if (u.match(/\bLEGENDADO\b/))           parts.push('Leg.');
  else if (u.match(/\bENG(LISH)?\b/))          parts.push('EN');

  if (u.match(/\bATMOS\b/))                    parts.push('Atmos');
  else if (u.match(/\bTRUEHD\b/))              parts.push('TrueHD');
  else if (u.match(/\bDTS.?HD\b/))             parts.push('DTS-HD');
  else if (u.match(/\bDTS\b/))                 parts.push('DTS');
  else if (u.match(/\bDDP?5\.?1\b|\bDD5\.?1\b/)) parts.push('DD5.1');
  else if (u.match(/\bAAC\b/))                 parts.push('AAC');

  return parts.join(' · ');
}

function extractSubs(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\bMULTI.?SUB\b/))                        return 'Multi';
  if (u.match(/\bPLSUB\b/))                             return 'PT';
  if (u.match(/\bLEGENDADO\b/) && !u.match(/\bDUAL\b/)) return 'PT-BR';
  return '';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

module.exports = { buildCatalog, buildMeta, buildStreams };
