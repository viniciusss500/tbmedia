const express = require('express');
const path    = require('path');
const NodeCache = require('node-cache');
const { getTorBoxDownloads } = require('./src/torbox');
const { buildCatalog, buildMeta, buildStreams } = require('./src/builder');
const { imdbToTmdb } = require('./src/tmdb');

const ROOT_DIR = path.resolve(__dirname);
const cache    = new NodeCache({ stdTTL: 7200 });
const knownConfigs = new Map();
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

// ─── BACKGROUND REFRESH ───────────────────────────────────────────────────────
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
      const cacheKey = `cat:${type}:${sortBy}::0:${torboxApiKey.slice(-6)}:${lang}`;
      cache.set(cacheKey, { metas });
      console.log(`[Cache] ${type} → ${metas.length} itens`);
    }
  } catch (err) {
    console.error('[Cache] Erro:', err.message);
  }
}

setInterval(() => {
  for (const [token, config] of knownConfigs.entries()) {
    buildAndCacheForConfig(token, config).catch(() => {});
  }
}, REFRESH);

// ─── MANIFESTS ────────────────────────────────────────────────────────────────
function getBaseManifest(baseUrl) {
  return {
    id: 'community.torbox.catalog',
    version: '1.4.0',
    name: 'TB Media',
    description: 'Seu catálogo pessoal do TorBox com metadados do TMDB.',
    logo: 'https://tbmedia.vercel.app/file_00000000eb3871fdbe0126338c869eba.png',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['torbox:'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: true },
    configureUrl: `${baseUrl}/configure`,
  };
}

function getConfiguredManifest() {
  return {
    id: 'community.torbox.catalog',
    version: '1.4.0',
    name: 'TB Media',
    description: 'Seu catálogo pessoal do TorBox com metadados do TMDB.',
    logo: 'https://tbmedia.vercel.app/file_00000000eb3871fdbe0126338c869eba.png',
    resources: [
      'catalog',
      'meta',
      { 
        name: 'stream', 
        types: ['movie', 'series'], 
        idPrefixes: ['torbox:', 'tt'] 
      },
    ],
    types: ['movie', 'series'],
    idPrefixes: ['torbox:'],
    catalogs: [
      { 
        id: 'torbox-movies',  
        type: 'movie',  
        name: '🎬 TorBox Filmes', 
        extra: [{ name: 'skip' }, { name: 'search' }] 
      },
      { 
        id: 'torbox-series',  
        type: 'series', 
        name: '📺 TorBox Series', 
        extra: [{ name: 'skip' }, { name: 'search' }] 
      },
      { 
        id: 'torbox-anime',   
        type: 'series', 
        name: '🍥 TorBox Animes',  
        extra: [{ name: 'skip' }, { name: 'search' }] 
      },
    ],
    behaviorHints: { configurable: true },
  };
}

// ─── STATIC ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/manifest.json'));
app.get('/configure', (req, res) => res.sendFile(path.join(ROOT_DIR, 'configure.html')));

// ✅ CORREÇÃO PRINCIPAL: manifest.json na raiz (exigência do stremio-addons.net)
app.get('/manifest.json', (req, res) => {
  // Retorna manifest base com configuração obrigatória
  res.json(getBaseManifest(req.protocol + '://' + req.get('host')));
});

// ─── MANIFEST CONFIGURADO ─────────────────────────────────────────────────────
app.get('/:token/manifest.json', (req, res) => {
  if (!decodeConfig(req.params.token)) return res.status(400).json({ error: 'Invalid token' });
  res.json(getConfiguredManifest());
});

// ─── CATALOG ─────────────────────────────────────────────────────────────────
async function handleCatalog(req, res) {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ metas: [] });

  const { torboxApiKey, tmdbApiKey, sortBy = 'data_adicao', lang = 'pt-BR' } = config;
  if (!torboxApiKey || !tmdbApiKey) return res.json({ metas: [] });

  // Determinar tipo real: torbox-anime → 'anime', torbox-movies → 'movie', torbox-series → 'series'
  const catalogId = req.params.catalogId;
  let type;
  if (catalogId === 'torbox-anime')   type = 'anime';
  else if (catalogId === 'torbox-movies') type = 'movie';
  else type = 'series';

  const extra  = parseExtra(req.params.extra || '');
  const skip   = parseInt(extra.skip) || 0;
  const search = extra.search || '';

  console.log(`[Catalog] type=${type} skip=${skip} lang=${lang}`);

  const token    = req.params.token;
  if (!knownConfigs.has(token)) {
    knownConfigs.set(token, config);
    buildAndCacheForConfig(token, config).catch(() => {});
  }

  const cacheKey = `cat:${type}:${sortBy}:${search}:${skip}:${torboxApiKey.slice(-6)}:${lang}`;
  const cached   = cache.get(cacheKey);
  if (cached) {
    console.log(`[Catalog] Cache hit → ${cached.metas.length} items`);
    return res.json(cached);
  }

  try {
    const downloads = await getTorBoxDownloads(torboxApiKey);
    const metas     = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang);
    console.log(`[Catalog] Built → ${metas.length} metas`);
    const result = { metas };
    cache.set(cacheKey, result);
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

  const cacheKey = `meta:${id}:${lang}`;
  const cached   = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const tmdbId = id.split(':')[2];
    const meta   = await buildMeta(tmdbId, type, tmdbApiKey, lang, torboxApiKey);
    const result = { meta };
    cache.set(cacheKey, result, 3600);
    res.json(result);
  } catch (err) {
    console.error('[Meta] Error:', err.message);
    res.json({ meta: null });
  }
});

// ─── STREAM ───────────────────────────────────────────────────────────────────
// Aceita IDs do nosso catálogo (torbox:movie:12345) E IDs do IMDB (tt1234567)
// para servir streams quando o usuário está em outro catálogo (Cinemeta, etc.)
app.get('/:token/stream/:type/:id.json', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ streams: [] });

  const { torboxApiKey, tmdbApiKey, lang = 'pt-BR' } = config;
  if (!torboxApiKey || !tmdbApiKey) return res.json({ streams: [] });

  let { type, id } = req.params;
  let tmdbId, season, episode;

  if (id.startsWith('torbox:')) {
    // ID do nosso próprio catálogo: torbox:movie:12345 ou torbox:series:12345:1:2
    const parts = id.split(':');
    tmdbId  = parts[2];
    season  = parts[3];
    episode = parts[4];
  } else if (id.startsWith('tt')) {
    // ID do IMDB vindo de outro catálogo (ex: tt0816692:1:5 para séries)
    // Formato Stremio para séries: tt1234567:SEASON:EPISODE
    const parts = id.split(':');
    const imdbId = parts[0];
    season  = parts[1];
    episode = parts[2];

    console.log(`[Stream] IMDB ID ${imdbId} → buscando TMDB...`);
    const found = await imdbToTmdb(tmdbApiKey, imdbId).catch(() => null);
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
    res.json({ streams });
  } catch (err) {
    console.error('[Stream] Error:', err.message);
    res.json({ streams: [] });
  }
});

module.exports = app;
