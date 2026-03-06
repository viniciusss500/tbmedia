const fs   = require('fs');
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
      let n = 0;
      for (const [k, v] of Object.entries(data)) { matchCache.set(k, v); n++; }
      console.log(`[Cache] Loaded ${n} entries from disk`);
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

// ─── ÍNDICE ───────────────────────────────────────────────────────────────────
const tmdbIndex = new Map(); // `series:12345` → [{item, season, episode}]

// ─── HELPERS ─────────────────────────────────────────────────────────────────
// Decide se um resultado do TMDB é anime.
// Usa flag isJapaneseAnimation da searchMetadata OU campo do cache.
function isTmdbAnime(result) {
  return result && (result.isJapaneseAnimation === true);
}

// ─── MATCH ITEM ───────────────────────────────────────────────────────────────
async function matchItem(item, tmdbApiKey, type, lang) {
  const name     = item.name || item.filename || '';
  const tmdbType = type === 'movie' ? 'movie' : 'series';
  const cacheKey = `match:${type}:${lang}:${name}`;

  const cached = matchCache.get(cacheKey);
  if (cached !== undefined) {
    // Revalidar: se a entrada cacheada tem isJapaneseAnimation=true mas type='series' → rejeitar
    if (cached !== null && type === 'series' && cached.isJapaneseAnimation === true) {
      matchCache.set(cacheKey, null);
      return null;
    }
    // Revalidar: se type='anime' mas não é anime → rejeitar
    if (cached !== null && type === 'anime' && cached.isJapaneseAnimation !== true) {
      // Só revalidar se o parser também não detecta como anime (double-check)
      const info2 = guessMediaInfo(name);
      if (info2 && !info2.isAnime) {
        matchCache.set(cacheKey, null);
        return null;
      }
    }
    return cached;
  }

  const info = guessMediaInfo(name);
  if (!info) { matchCache.set(cacheKey, null); return null; }

  // Filtro pelo parser (rápido, sem rede)
  if (type === 'movie'  && (info.isSeries || info.isAnime))  { matchCache.set(cacheKey, null); return null; }
  if (type === 'series' && !info.isSeries)                   { matchCache.set(cacheKey, null); return null; }
  if (type === 'anime'  && !info.isSeries)                   { matchCache.set(cacheKey, null); return null; }
  // Anime detectado pelo parser → não vai para 'series'
  if (type === 'series' && info.isAnime)                     { matchCache.set(cacheKey, null); return null; }

  try {
    const result = await searchMetadata(tmdbApiKey, info.title, tmdbType, info.year, lang);
    if (!result) { matchCache.set(cacheKey, null); return null; }

    // Verificação via TMDB: anime (ja + Animation) não vai para 'series'
    if (type === 'series' && isTmdbAnime(result)) {
      console.log(`[TMDB] "${info.title}" é anime (ja+Animation) — excluído de séries`);
      matchCache.set(cacheKey, null);
      return null;
    }
    // Verificação via TMDB: 'anime' requer que seja anime (ja+Animation) OU parser detectou
    if (type === 'anime' && !isTmdbAnime(result) && !info.isAnime) {
      matchCache.set(cacheKey, null);
      return null;
    }

    console.log(`[TMDB] "${info.title}" → "${result.title || result.name}" (${result.id}) anime=${isTmdbAnime(result)}`);

    const stremioType = type === 'anime' ? 'series' : type;
    const meta = {
      id:                   `torbox:${stremioType}:${result.id}`,
      type:                 stremioType,
      name:                 result.title || result.name,
      poster:               result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
      releaseInfo:          (result.release_date || result.first_air_date || '').split('-')[0],
      released:             result.release_date || result.first_air_date,
      tmdbId:               result.id,
      catalogType:          type,
      isJapaneseAnimation:  isTmdbAnime(result),
      torboxItem:           item,
      season:               info.season,
      episode:              info.episode,
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

  // Filtrar por tipo sem deduplicar — todos os episódios precisam entrar no índice
  const allRelevant = [];
  for (const item of downloads) {
    const name = item.name || item.filename || '';
    const info = guessMediaInfo(name);
    if (!info) continue;
    if (type === 'movie'  && (info.isSeries || info.isAnime))  continue;
    if (type === 'series' && (!info.isSeries || info.isAnime)) continue;
    if (type === 'anime'  && !info.isSeries)                   continue; // anime usa SxxExx ou formato proprio
    allRelevant.push({ item, info });
  }

  console.log(`[Catalog] type=${type} | raw=${downloads.length} → filtered=${allRelevant.length}`);

  const CONCURRENCY = 15;
  const results     = [];
  for (let i = 0; i < allRelevant.length; i += CONCURRENCY) {
    const batch   = allRelevant.slice(i, i + CONCURRENCY);
    const matched = await Promise.all(batch.map(({ item }) => matchItem(item, tmdbApiKey, type, lang)));
    results.push(...matched.filter(Boolean));
  }

  // Popula índice com todos os episódios; catálogo exibe um card por show
  const seen = new Map();
  for (const meta of results) {
    const indexKey = `${meta.type}:${meta.tmdbId}`;
    const entry    = { item: meta.torboxItem, season: meta.season, episode: meta.episode };

    if (!tmdbIndex.has(indexKey)) {
      tmdbIndex.set(indexKey, [entry]);
    } else {
      const existing = tmdbIndex.get(indexKey);
      if (!existing.some(e => e.item.id === entry.item.id)) existing.push(entry);
    }

    if (!seen.has(meta.id)) seen.set(meta.id, { ...meta, torboxItems: [entry] });
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
    .map(({ torboxItem, torboxItems, tmdbId, released, catalogType, isJapaneseAnimation, season, episode, ...rest }) => rest)
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

  if (!entries || entries.length === 0) {
    console.log(`[Stream] Índice vazio para ${indexKey}, reconstruindo...`);
    entries = [];
    const downloads = await getTorBoxDownloads(torboxApiKey);

    for (const item of downloads) {
      const name = item.name || item.filename || '';
      let found  = false;

      // Tentar matchCache com todos os tipos e langs
      for (const t of ['movie', 'series', 'anime']) {
        for (const l of [lang, 'pt-BR', 'en-US']) {
          const c = matchCache.get(`match:${t}:${l}:${name}`);
          if (c && String(c.tmdbId) === String(tmdbId)) {
            entries.push({ item, season: c.season, episode: c.episode });
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }

    // Fallback: busca via TMDB para candidatos plausíveis
    if (entries.length === 0 && tmdbApiKey) {
      console.log(`[Stream] Fallback TMDB para tmdbId=${tmdbId}`);
      const tmdbType = type === 'movie' ? 'movie' : 'series';
      for (const item of downloads || []) {
        const name = item.name || item.filename || '';
        const info = guessMediaInfo(name);
        if (!info) continue;
        if (tmdbType === 'movie'  && info.isSeries)  continue;
        if (tmdbType === 'series' && !info.isSeries) continue;
        try {
          const result = await searchMetadata(tmdbApiKey, info.title, tmdbType, info.year, lang);
          if (result && String(result.id) === String(tmdbId)) {
            entries.push({ item, season: info.season, episode: info.episode });
          }
        } catch {}
      }
    }

    if (entries.length > 0) tmdbIndex.set(indexKey, entries);
  }

  if (!entries || entries.length === 0) return [];

  // ── Filtrar por temporada/episódio ────────────────────────────────────────
  // Problema: anime SubsPlease usa numeração absoluta (ep 61 = S03E14 no TMDB).
  // O Stremio envia o número relativo da temporada (season=3, episode=14).
  // Se filtrarmos por episode=14 mas o arquivo tem episode=61 → zero resultados.
  //
  // Estratégia em 3 camadas:
  //   1. Filtro estrito por season+episode (funciona para séries com SxxExx)
  //   2. Se vazio, filtro só por season (para anime com numeração absoluta)
  //   3. Se ainda vazio, todos os entries (pack geral ou numeração incompatível)
  let filtered;
  if (type === 'series' || type === 'anime') {
    // Camada 1: filtro estrito
    const strict = entries.filter(({ season: s, episode: e }) => {
      if (season != null && season !== '' && s != null && String(s) !== String(season)) return false;
      if (episode != null && episode !== '' && e != null && String(e) !== String(episode)) return false;
      return true;
    });

    if (strict.length > 0) {
      filtered = strict;
    } else if (type === 'anime') {
      // Camada 2: para anime, ignorar episódio (numeração absoluta incompatível)
      // Filtrar só por season se disponível
      const bySeason = entries.filter(({ season: s }) => {
        if (season != null && season !== '' && s != null && String(s) !== String(season)) return false;
        return true;
      });
      filtered = bySeason.length > 0 ? bySeason : entries;
      console.log(`[Stream] Anime fallback (numeração absoluta): ${filtered.length} entries`);
    } else {
      filtered = strict; // séries: respeitar filtro estrito (retorna vazio se não tiver)
    }
  } else {
    filtered = entries;
  }

  console.log(`[Stream] ${filtered.length} item(s) para ${indexKey} s=${season} e=${episode}`);

  // ── Coletar streams ────────────────────────────────────────────────────────
  const rawStreams = [];
  for (const { item } of filtered) {
    const files      = await getTorBoxFiles(torboxApiKey, item.source, item.id);
    const videoFiles = files.filter(f => isVideoFile(f.name || f.short_name));

    if (videoFiles.length > 0) {
      for (const file of videoFiles) {
        try {
          const url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, file.id);
          if (!url) continue;
          const fname = file.name || file.short_name || item.name || '';
          rawStreams.push({ url, fname, size: file.size || 0, source: item.source });
        } catch {}
      }
    } else {
      try {
        const url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, 0);
        if (url) rawStreams.push({ url, fname: item.name || '', size: item.size || 0, source: item.source });
      } catch {}
    }
  }

  // ── Ordenar: 1) idioma 2) resolução 3) tamanho ─────────────────────────────
  const langCode = (lang || 'pt-BR').split('-')[0].toLowerCase();
  rawStreams.sort((a, b) => {
    const dl = langScore(b.fname, langCode) - langScore(a.fname, langCode);
    if (dl !== 0) return dl;
    const dq = qualityScore(b.fname) - qualityScore(a.fname);
    if (dq !== 0) return dq;
    return b.size - a.size;
  });

  return rawStreams.map(({ url, fname, size, source }) => ({
    url,
    name:          formatStreamName(fname),
    description:   formatStreamDesc(fname, size, source),
    behaviorHints: { notWebReady: false },
  }));
}

// ─── SCORING ─────────────────────────────────────────────────────────────────
function langScore(n = '', langCode = 'pt') {
  const u = n.toUpperCase();
  if (langCode === 'pt') {
    if (u.match(/\bDUAL\b|\bDUBLADO\b|\bNACIONAL\b/)) return 3;
    if (u.match(/\bPT.?BR\b|\bPT.?PT\b/))              return 2;
    if (u.match(/\bLEGENDADO\b|\bPLSUB\b/))            return 1;
  }
  if (langCode === 'en' && u.match(/\bENGLISH\b|\bENG\b/)) return 2;
  return 0;
}

function qualityScore(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\b(2160P|4K|UHD)\b/)) return 4;
  if (u.match(/\b1080P\b/))           return 3;
  if (u.match(/\b720P\b/))            return 2;
  if (u.match(/\b480P\b/))            return 1;
  return 0;
}

// ─── FORMATAÇÃO ───────────────────────────────────────────────────────────────
function formatStreamName(filename = '') {
  const badges = [
    extractQuality(filename),
    extractHDR(filename),
    extractCodec(filename),
    extractSource(filename),
  ].filter(Boolean).join(' · ');
  return badges ? `⚡ TorBox · ${badges}` : '⚡ TorBox';
}

function formatStreamDesc(filename = '', size, source) {
  // Nome completo sem extensão
  const display = filename.replace(/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i, '');
  const langStr = extractAudio(filename);
  const subs    = extractSubs(filename);
  const sz      = size ? formatBytes(size) : '';

  const lines = [];
  if (display) lines.push(`📄 ${display}`);
  const row = [
    langStr ? `🎙 ${langStr}` : '',
    subs    ? `💬 ${subs}`   : '',
    sz      ? `💾 ${sz}`     : '',
    source  ? `☁️ ${source}`  : '',
  ].filter(Boolean).join('   ');
  if (row) lines.push(row);
  return lines.join('\n');
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
  if (u.match(/HDR10\+/))            return 'HDR10+';
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
  if      (u.match(/\bDUAL\b|\bDUBLADO\b/))      parts.push('Dublado');
  else if (u.match(/\bNACIONAL\b|\bPT.?BR\b/))    parts.push('PT-BR');
  else if (u.match(/\bPT.?PT\b/))                 parts.push('PT-PT');
  else if (u.match(/\bLEGENDADO\b/))              parts.push('Leg.');
  else if (u.match(/\bENG(LISH)?\b/))             parts.push('EN');
  if      (u.match(/\bATMOS\b/))                  parts.push('Atmos');
  else if (u.match(/\bTRUEHD\b/))                 parts.push('TrueHD');
  else if (u.match(/\bDTS.?HD\b/))                parts.push('DTS-HD');
  else if (u.match(/\bDTS\b/))                    parts.push('DTS');
  else if (u.match(/\bDDP?5\.?1\b|\bDD5\.?1\b/)) parts.push('DD5.1');
  else if (u.match(/\bAAC\b/))                    parts.push('AAC');
  return parts.join(' · ');
}

function extractSubs(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\bMULTI.?SUB\b/))                         return 'Multi';
  if (u.match(/\bPLSUB\b/))                              return 'PT';
  if (u.match(/\bLEGENDADO\b/) && !u.match(/\bDUAL\b/)) return 'PT-BR';
  return '';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

module.exports = { buildCatalog, buildMeta, buildStreams };
