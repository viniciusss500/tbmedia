const express = require('express');
const path    = require('path');
const cache   = require('./src/cache');
const { getTorBoxDownloads } = require('./src/torbox');
const { getRealDebridDownloads } = require('./src/realdebrid');
const { buildCatalog, buildMeta, buildStreams } = require('./src/builder');

const ROOT_DIR = path.resolve(__dirname);

const IS_SERVERLESS = !!process.env.VERCEL;

const TTL_CATALOG = parseInt(process.env.CACHE_TTL_CATALOG) || 3600;   // padrão 1h
const TTL_STREAM  = parseInt(process.env.CACHE_TTL_STREAM)  || 21600;  // padrão 6h

const knownConfigs = IS_SERVERLESS ? null : new Map();

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

app.use(express.static(path.join(ROOT_DIR, 'public'), {
  maxAge: '30d',
  etag: true,
  immutable: true,
}));

function decodeConfig(str) {
  if (!str || typeof str !== 'string' || str.length > 2048) return null;
  try {
    const padded   = str + '=='.slice(0, (4 - (str.length % 4)) % 4);
    const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(standard, 'base64').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return null;
    return decoded;
  } catch { return null; }
}

function parseExtra(str) {
  const extra = {};
  if (!str || typeof str !== 'string' || str.length > 512) return extra;
  str.split('&').forEach(pair => {
    const eq = pair.indexOf('=');
    if (eq > 0) {
      const key = decodeURIComponent(pair.slice(0, eq));
      const val = decodeURIComponent(pair.slice(eq + 1));
      if (key.length < 50 && val.length < 200) extra[key] = val;
    }
  });
  return extra;
}

const TYPES   = ['movie', 'series', 'anime'];
const REFRESH = 30 * 60 * 1000;

function hashDownloads(downloads) {
  return downloads.map(d => d.id).sort().join(',');
}

async function buildAndCacheForConfig(token, config) {
  const { torboxApiKey, rdApiKey, tmdbApiKey, sortBy = 'data_adicao', lang = 'pt-BR', rdCatalog = 'merge' } = config;
  if (!tmdbApiKey) return;

  console.log(`[Cache] Refresh para ...${token.slice(-8)} (${lang})`);
  try {
    const [tbDownloads, rdDownloads] = await Promise.all([
      torboxApiKey ? getTorBoxDownloads(torboxApiKey) : Promise.resolve([]),
      rdApiKey     ? getRealDebridDownloads(rdApiKey) : Promise.resolve([]),
    ]);

    const tbHash  = hashDownloads(tbDownloads);
    const rdHash  = hashDownloads(rdDownloads);
    const newHash = tbHash + '|' + rdHash;
    const hashKey = cache.makeKey('dlhash', (torboxApiKey || rdApiKey).slice(-6));
    const oldHash = await cache.get(hashKey);

    if (oldHash === newHash) {
      console.log(`[Cache] Downloads inalterados, skip rebuild`);
      return;
    }
    await cache.set(hashKey, newHash, 7200);

    const merged   = [...tbDownloads, ...rdDownloads];
    const sources  = rdCatalog === 'separate'
      ? [{ key: 'tb', downloads: tbDownloads }, { key: 'rd', downloads: rdDownloads }]
      : [{ key: 'merged', downloads: merged }];

    for (const { key, downloads } of sources) {
      for (const type of TYPES) {
        const metas    = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip: 0, search: '' }, lang);
        const cacheKey = cache.makeKey('cat', key, type, sortBy, '', (torboxApiKey || rdApiKey).slice(-6), lang);
        await cache.set(cacheKey, { metas }, TTL_CATALOG);
        console.log(`[Cache] ${key}:${type} → ${metas.length} itens`);
      }
    }
  } catch (err) {
    console.error('[Cache] Erro:', err.message);
  }
}

if (!IS_SERVERLESS) {
  setInterval(() => {
    for (const [token, config] of knownConfigs.entries()) {
      buildAndCacheForConfig(token, config).catch(() => {});
    }
  }, REFRESH);
}

function getLogoUrl(baseUrl) {
  return `${baseUrl}/tb-files-tmdb-icon.svg`;
}

function getBaseManifest(baseUrl) {
  return {
    id: 'community.torbox.catalog',
    version: '1.4.1',
    name: 'TB Media',
    description: 'Seu catálogo pessoal do TorBox com metadados do TMDB.',
    logo: getLogoUrl(baseUrl),
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['torbox:'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: true },
    configureUrl: `${baseUrl}/configure`,
    stremioAddonsConfig: {
      issuer: "https://stremio-addons.net",
      signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..wuS2Idc3UAATsil5cgTVBw.YXJH_xCqef9srmpEvQnoCwnA62U2_CPGTB2UfL89gpqVTU928HWIhrHgrfXiQ6Qu_GYfKBjU1dKqKXp2ZGJb0_SoJ0pQK9lvhg23pN2JRXNhBbZirRxumbi3dFUpa3An.fn0tzw5B94KrkB5mXUanAw"
    },
  };
}

function getConfiguredManifest(baseUrl, config = {}) {
  const { rdApiKey, rdCatalog = 'merge' } = config;
  const hasRD = !!rdApiKey;

  const catalogs = [];

  if (!hasRD || rdCatalog === 'merge') {
    catalogs.push(
      { id: 'torbox-movies', type: 'movie',  name: '🎬 TB Media Filmes', extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-series', type: 'series', name: '📺 TB Media Séries',  extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-anime',  type: 'series', name: '🍥 TB Media Animes',  extra: [{ name: 'skip' }, { name: 'search' }] },
    );
  } else {
    // separate
    catalogs.push(
      { id: 'torbox-movies', type: 'movie',  name: '🎬 TorBox Filmes', extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-series', type: 'series', name: '📺 TorBox Séries',  extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-anime',  type: 'series', name: '🍥 TorBox Animes',  extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'rd-movies',     type: 'movie',  name: '🔴 Real-Debrid Filmes', extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'rd-series',     type: 'series', name: '🔴 Real-Debrid Séries',  extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'rd-anime',      type: 'series', name: '🔴 Real-Debrid Animes',  extra: [{ name: 'skip' }, { name: 'search' }] },
    );
  }

  return {
    id: 'community.torbox.catalog',
    version: '1.4.1',
    name: 'TB Media',
    description: 'Seu catálogo pessoal do TorBox com metadados do TMDB.',
    logo: getLogoUrl(baseUrl),
    resources: [
      'catalog',
      'meta',
      { name: 'stream', types: ['movie', 'series'], idPrefixes: ['torbox:'] },
    ],
    types: ['movie', 'series'],
    idPrefixes: ['torbox:'],
    catalogs,
    behaviorHints: { configurable: true },
    stremioAddonsConfig: {
      issuer: "https://stremio-addons.net",
      signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..wuS2Idc3UAATsil5cgTVBw.YXJH_xCqef9srmpEvQnoCwnA62U2_CPGTB2UfL89gpqVTU928HWIhrHgrfXiQ6Qu_GYfKBjU1dKqKXp2ZGJb0_SoJ0pQK9lvhg23pN2JRXNhBbZirRxumbi3dFUpa3An.fn0tzw5B94KrkB5mXUanAw"
    },
  };
}

app.get('/', (req, res) => res.redirect('/manifest.json'));
app.get('/configure', (req, res) => res.sendFile(path.join(ROOT_DIR, 'configure.html')));

app.get('/health', async (req, res) => {
  const stats = await cache.getStats();
  res.json({
    status: 'ok',
    cache: stats,
    environment: IS_SERVERLESS ? 'serverless' : 'self-hosted',
    version: '1.4.1',
  });
});

app.post('/cache/clear', async (req, res) => {
  try {
    const deleted = await cache.delPattern('*');
    res.json({ success: true, deleted, message: 'Cache limpo com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/:token/cache/clear', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Token inválido' });
  
  try {
    const { torboxApiKey } = config;
    const pattern = `*${torboxApiKey.slice(-6)}*`;
    const deleted = await cache.delPattern(pattern);
    res.json({ success: true, deleted, message: 'Cache do usuário limpo' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800, immutable');
  res.json(getBaseManifest(req.protocol + '://' + req.get('host')));
});

app.get('/:token/manifest.json', (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800, immutable');
  res.json(getConfiguredManifest(req.protocol + '://' + req.get('host'), config));
});

async function handleCatalog(req, res) {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ metas: [] });

  const { torboxApiKey, rdApiKey, tmdbApiKey, sortBy = 'data_adicao', lang = 'pt-BR', rdCatalog = 'merge' } = config;
  if (!tmdbApiKey || (!torboxApiKey && !rdApiKey)) return res.json({ metas: [] });

  const catalogId = req.params.catalogId;
  const isRDCatalog = catalogId.startsWith('rd-');

  let type;
  if (catalogId.endsWith('-anime'))   type = 'anime';
  else if (catalogId.endsWith('-movies')) type = 'movie';
  else type = 'series';

  const extra  = parseExtra(req.params.extra || '');
  const skip   = parseInt(extra.skip) || 0;
  const search = extra.search || '';

  console.log(`[Catalog] catalog=${catalogId} type=${type} skip=${skip} lang=${lang}`);

  const token = req.params.token;
  if (!IS_SERVERLESS && !knownConfigs.has(token)) {
    knownConfigs.set(token, config);
    buildAndCacheForConfig(token, config).catch(() => {});
  }

  const userKey  = (torboxApiKey || rdApiKey).slice(-6);
  const catKey   = rdCatalog === 'separate' ? (isRDCatalog ? 'rd' : 'tb') : 'merged';
  const cacheKey = cache.makeKey('cat', catKey, type, sortBy, search, skip.toString(), userKey, lang);
  const cached   = await cache.get(cacheKey);

  if (cached) {
    console.log(`[Catalog] Cache hit → ${cached.metas.length} items`);
    res.setHeader('Cache-Control', `public, max-age=${TTL_CATALOG}, stale-while-revalidate=${TTL_CATALOG * 6}`);
    return res.json(cached);
  }

  try {
    const [tbDownloads, rdDownloads] = await Promise.all([
      torboxApiKey && (!isRDCatalog || rdCatalog === 'merge') ? getTorBoxDownloads(torboxApiKey) : Promise.resolve([]),
      rdApiKey     && (isRDCatalog  || rdCatalog === 'merge') ? getRealDebridDownloads(rdApiKey)  : Promise.resolve([]),
    ]);

    const downloads = [...tbDownloads, ...rdDownloads];

    const newHash = hashDownloads(downloads);
    const hashKey = cache.makeKey('dlhash', userKey);
    const oldHash = await cache.get(hashKey);
    if (oldHash !== newHash) {
      await cache.set(hashKey, newHash, 7200);
      await cache.delPattern(`cat:*${userKey}*`);
    }

    const metas  = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang);
    console.log(`[Catalog] Built → ${metas.length} metas`);

    const result = { metas };
    await cache.set(cacheKey, result, TTL_CATALOG);

    res.setHeader('Cache-Control', `public, max-age=${TTL_CATALOG}, stale-while-revalidate=${TTL_CATALOG * 6}`);
    res.json(result);
  } catch (err) {
    console.error('[Catalog] Error:', err.message);
    res.json({ metas: [] });
  }
}

app.get('/:token/catalog/:type/:catalogId.json', handleCatalog);
app.get('/:token/catalog/:type/:catalogId/:extra.json', handleCatalog);

// ─── META ─────────────────────────────────────────────────────────────────────
app.get('/:token/meta/:type/:id.json', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ meta: null });

  const { torboxApiKey, rdApiKey, tmdbApiKey, lang = 'pt-BR' } = config;
  const { type, id } = req.params;
  if (!tmdbApiKey || !id.startsWith('torbox:')) return res.json({ meta: null });

  const cacheKey = cache.makeKey('meta', 'v2', id, lang);
  const cached   = await cache.get(cacheKey);
  
  if (cached) {
    console.log(`[Meta] Cache hit: ${id} → ${cached.meta?.videos?.length || 0} eps`);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return res.json(cached);
  }

  console.log(`[Meta] Building: ${id}`);
  try {
    const tmdbId = id.split(':')[2];
    const meta   = await buildMeta(tmdbId, type, tmdbApiKey, lang, torboxApiKey, rdApiKey);
    const result = { meta };
    
    await cache.set(cacheKey, result, 86400); // 24 horas
    
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.json(result);
  } catch (err) {
    console.error('[Meta] Error:', err.message);
    res.json({ meta: null });
  }
});

app.get('/:token/stream/:type/:id.json', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ streams: [] });

  const { torboxApiKey, rdApiKey, tmdbApiKey, lang = 'pt-BR' } = config;
  if (!tmdbApiKey || (!torboxApiKey && !rdApiKey)) return res.json({ streams: [] });

  const { type, id } = req.params;
  if (!id.startsWith('torbox:')) return res.json({ streams: [] });

  const parts   = id.split(':');
  const tmdbId  = parts[2];
  const season  = parts[3];
  const episode = parts[4];

  try {
    const userKey        = (torboxApiKey || rdApiKey).slice(-6);
    const streamCacheKey = cache.makeKey('stream', type, tmdbId, season || '', episode || '', userKey);
    const cachedStreams  = await cache.get(streamCacheKey);
    if (cachedStreams) {
      res.setHeader('Cache-Control', `public, max-age=${TTL_STREAM}, stale-while-revalidate=${TTL_STREAM * 2}`);
      return res.json(cachedStreams);
    }

    const streams = await buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode, lang, rdApiKey);
    const result  = { streams };
    await cache.set(streamCacheKey, result, TTL_STREAM);

    res.setHeader('Cache-Control', `public, max-age=${TTL_STREAM}, stale-while-revalidate=${TTL_STREAM * 2}`);
    res.json(result);
  } catch (err) {
    console.error('[Stream] Error:', err.message);
    res.json({ streams: [] });
  }
});

module.exports = app;
