const express = require('express');
const path    = require('path');
const cache   = require('./src/cache'); // ✅ Redis cache em vez de NodeCache
const { getTorBoxDownloads } = require('./src/torbox');
const { buildCatalog, buildMeta, buildStreams } = require('./src/builder');
const { imdbToTmdb } = require('./src/tmdb');

const ROOT_DIR = path.resolve(__dirname);

// ─── DETECÇÃO DE AMBIENTE ──────────────────────────────────────────────────────
const IS_SERVERLESS = !!process.env.VERCEL;

// ✅ Redis cache (persistente entre requests serverless)
// knownConfigs só é útil em processos persistentes (self-hosted)
const knownConfigs = IS_SERVERLESS ? null : new Map();

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
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

// ─── STATIC (para auto-hospedagem) ────────────────────────────────────────────
// Cache de 30 dias para assets estáticos
app.use(express.static(path.join(ROOT_DIR, 'public'), {
  maxAge: '30d',
  etag: true,
  immutable: true,
}));

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function decodeConfig(str) {
  try {
    const padded   = str + '=='.slice(0, (4 - (str.length % 4)) % 4);
    const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(standard, 'base64').toString('utf8'));
  } catch { return null; }
}

function parseExtra(str) {
  const extra = {};
  if (!str) return extra;
  str.split('&').forEach(pair => {
    const eq = pair.indexOf('=');
    if (eq > 0) extra[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
  });
  return extra;
}

// ─── BACKGROUND REFRESH (apenas self-hosted) ──────────────────────────────────
const TYPES   = ['movie', 'series', 'anime'];
const REFRESH = 30 * 60 * 1000;

async function buildAndCacheForConfig(token, config) {
  const { torboxApiKey, tmdbApiKey, sortBy = 'data_adicao', lang = 'pt-BR' } = config;
  if (!torboxApiKey || !tmdbApiKey) return;

  console.log(`[Cache] Refresh para ...${token.slice(-8)} (${lang})`);
  try {
    const downloads = await getTorBoxDownloads(torboxApiKey);
    for (const type of TYPES) {
      const metas    = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip: 0, search: '' }, lang);
      const cacheKey = cache.makeKey('cat', type, sortBy, '', '0', torboxApiKey.slice(-6), lang);
      await cache.set(cacheKey, { metas }, 3600); // 1 hora
      console.log(`[Cache] ${type} → ${metas.length} itens`);
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

// ─── LOGO: usa SVG (1.5 KB) em vez do PNG (1.6 MB) ───────────────────────────
function getLogoUrl(baseUrl) {
  return `${baseUrl}/tb-files-tmdb-icon.svg`;
}

// ─── MANIFESTS ────────────────────────────────────────────────────────────────
function getBaseManifest(baseUrl) {
  return {
    id: 'community.torbox.catalog',
    version: '1.4.1', // ✅ Bumped version após otimizações
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

function getConfiguredManifest(baseUrl) {
  return {
    id: 'community.torbox.catalog',
    version: '1.4.1', // ✅ Bumped version após otimizações
    name: 'TB Media',
    description: 'Seu catálogo pessoal do TorBox com metadados do TMDB.',
    logo: getLogoUrl(baseUrl),
    resources: [
      'catalog',
      'meta',
      { name: 'stream', types: ['movie', 'series'], idPrefixes: ['torbox:', 'tt'] },
    ],
    types: ['movie', 'series'],
    idPrefixes: ['torbox:'],
    catalogs: [
      { id: 'torbox-movies',  type: 'movie',  name: '🎬 TorBox Filmes', extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-series',  type: 'series', name: '📺 TorBox Series', extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-anime',   type: 'series', name: '🍥 TorBox Animes',  extra: [{ name: 'skip' }, { name: 'search' }] },
    ],
    behaviorHints: { configurable: true },
    stremioAddonsConfig: {
      issuer: "https://stremio-addons.net",
      signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..wuS2Idc3UAATsil5cgTVBw.YXJH_xCqef9srmpEvQnoCwnA62U2_CPGTB2UfL89gpqVTU928HWIhrHgrfXiQ6Qu_GYfKBjU1dKqKXp2ZGJb0_SoJ0pQK9lvhg23pN2JRXNhBbZirRxumbi3dFUpa3An.fn0tzw5B94KrkB5mXUanAw"
    },
  };
}

// ─── STATIC ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/manifest.json'));
app.get('/configure', (req, res) => res.sendFile(path.join(ROOT_DIR, 'configure.html')));

// ✅ Endpoint de health check / stats
app.get('/health', async (req, res) => {
  const stats = await cache.getStats();
  res.json({
    status: 'ok',
    cache: stats,
    environment: IS_SERVERLESS ? 'serverless' : 'self-hosted',
    version: '1.4.1',
  });
});

app.get('/manifest.json', (req, res) => {
  // ✅ OTIMIZAÇÃO: Cache de 24h + stale-while-revalidate de 7 dias
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800, immutable');
  res.json(getBaseManifest(req.protocol + '://' + req.get('host')));
});

// ─── MANIFEST CONFIGURADO ─────────────────────────────────────────────────────
app.get('/:token/manifest.json', (req, res) => {
  if (!decodeConfig(req.params.token)) return res.status(400).json({ error: 'Invalid token' });
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800, immutable');
  res.json(getConfiguredManifest(req.protocol + '://' + req.get('host')));
});

// ─── CATALOG ─────────────────────────────────────────────────────────────────
async function handleCatalog(req, res) {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ metas: [] });

  const { torboxApiKey, tmdbApiKey, sortBy = 'data_adicao', lang = 'pt-BR' } = config;
  if (!torboxApiKey || !tmdbApiKey) return res.json({ metas: [] });

  const catalogId = req.params.catalogId;
  let type;
  if (catalogId === 'torbox-anime')   type = 'anime';
  else if (catalogId === 'torbox-movies') type = 'movie';
  else type = 'series';

  const extra  = parseExtra(req.params.extra || '');
  const skip   = parseInt(extra.skip) || 0;
  const search = extra.search || '';

  console.log(`[Catalog] type=${type} skip=${skip} lang=${lang}`);

  const token = req.params.token;
  if (!IS_SERVERLESS && !knownConfigs.has(token)) {
    knownConfigs.set(token, config);
    buildAndCacheForConfig(token, config).catch(() => {});
  }

  // ✅ Redis cache com chave formatada
  const cacheKey = cache.makeKey('cat', type, sortBy, search, skip.toString(), torboxApiKey.slice(-6), lang);
  const cached   = await cache.get(cacheKey);
  
  if (cached) {
    console.log(`[Catalog] Cache hit → ${cached.metas.length} items`);
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=21600');
    return res.json(cached);
  }

  try {
    const downloads = await getTorBoxDownloads(torboxApiKey);
    const metas     = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang);
    console.log(`[Catalog] Built → ${metas.length} metas`);
    
    const result = { metas };
    await cache.set(cacheKey, result, 3600); // 1 hora
    
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=21600');
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

  const { torboxApiKey, tmdbApiKey, lang = 'pt-BR' } = config;
  const { type, id } = req.params;
  if (!tmdbApiKey || !id.startsWith('torbox:')) return res.json({ meta: null });

  // ✅ Redis cache
  const cacheKey = cache.makeKey('meta', id, lang);
  const cached   = await cache.get(cacheKey);
  
  if (cached) {
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return res.json(cached);
  }

  try {
    const tmdbId = id.split(':')[2];
    const meta   = await buildMeta(tmdbId, type, tmdbApiKey, lang, torboxApiKey);
    const result = { meta };
    
    await cache.set(cacheKey, result, 86400); // 24 horas
    
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.json(result);
  } catch (err) {
    console.error('[Meta] Error:', err.message);
    res.json({ meta: null });
  }
});

// ─── STREAM ───────────────────────────────────────────────────────────────────
// ✅ ARQUITETURA CORRETA — vídeo NÃO passa pelo Vercel:
//
//  1) Stremio pede  → Vercel /stream/:id.json
//  2) Vercel chama  → TorBox API (requestdl) — retorna URL CDN assinada (alguns KB JSON)
//  3) Vercel responde → { streams: [{ url: "https://cdn.torbox.app/..." }] }  (alguns KB)
//  4) Stremio conecta → TorBox CDN diretamente (vídeo completo, zero bytes pelo Vercel) ✅
app.get('/:token/stream/:type/:id.json', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ streams: [] });

  const { torboxApiKey, tmdbApiKey, lang = 'pt-BR' } = config;
  if (!torboxApiKey || !tmdbApiKey) return res.json({ streams: [] });

  let { type, id } = req.params;
  let tmdbId, season, episode;

  if (id.startsWith('torbox:')) {
    const parts = id.split(':');
    tmdbId  = parts[2];
    season  = parts[3];
    episode = parts[4];
  } else if (id.startsWith('tt')) {
    const parts  = id.split(':');
    const imdbId = parts[0];
    season  = parts[1];
    episode = parts[2];

    console.log(`[Stream] IMDB ID ${imdbId} → buscando TMDB...`);
    
    // ✅ Cache de conversão IMDB → TMDB
    const imdbCacheKey = cache.makeKey('imdb', imdbId);
    let found = await cache.get(imdbCacheKey);
    
    if (!found) {
      found = await imdbToTmdb(tmdbApiKey, imdbId).catch(() => null);
      if (found) {
        await cache.set(imdbCacheKey, found, 604800); // 7 dias
      }
    }
    
    if (!found) {
      console.log(`[Stream] IMDB ${imdbId} não encontrado no TMDB`);
      return res.json({ streams: [] });
    }
    
    tmdbId = found.tmdbId;
    type   = found.type;
    console.log(`[Stream] IMDB ${imdbId} → TMDB ${tmdbId} (${type})`);
  } else {
    return res.json({ streams: [] });
  }

  try {
    const streams = await buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode, lang);
    
    // ✅ OTIMIZAÇÃO: Cache de 10min
    // URLs do TorBox são assinadas e expiram, mas podemos cachear por alguns minutos
    res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=1800');
    res.json({ streams });
  } catch (err) {
    console.error('[Stream] Error:', err.message);
    res.json({ streams: [] });
  }
});

module.exports = app;
