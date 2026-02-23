const express = require('express');
const path = require('path');
const NodeCache = require('node-cache');
const { getTorBoxDownloads } = require('./src/torbox');
const { buildCatalog, buildMeta, buildStreams } = require('./src/builder');
const ROOT_DIR = path.resolve(__dirname);
const cache = new NodeCache({ stdTTL: 300 });
const app = express();
// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
// ─── REQUEST LOGGING ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});
// ─── HELPERS ──────────────────────────────────────────────────────────────────
function decodeConfig(str) {
  try {
    const padded = str + '=='.slice(0, (4 - (str.length % 4)) % 4);
    const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(standard, 'base64').toString('utf8'));
  } catch { return null; }
}
function parseExtra(str) {
  const extra = {};
  if (!str) return extra;
  str.split('&').forEach(pair => {
    const eq = pair.indexOf('=');
    if (eq > 0) {
      extra[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    }
  });
  return extra;
}
// ─── MANIFESTS ────────────────────────────────────────────────────────────────
function getBaseManifest(baseUrl) {
  return {
    id: 'community.torbox.catalog',
    version: '1.2.0',
    name: 'TorBox Catalog',
    description: 'Seu catálogo pessoal do TorBox com metadados em Português BR do TMDB.',
    logo: 'https://torbox.app/favicon.ico',
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
    version: '1.2.0',
    name: 'TorBox Catalog',
    description: 'Seu catálogo pessoal do TorBox com metadados em Português BR do TMDB.',
    logo: 'https://torbox.app/favicon.ico',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['torbox:'],
    catalogs: [
      {
        id: 'torbox-movies',
        type: 'movie',
        name: 'TorBox - Filmes',
        extra: [{ name: 'skip' }, { name: 'search' }],
      },
      {
        id: 'torbox-series',
        type: 'series',
        name: 'TorBox - Séries',
        extra: [{ name: 'skip' }, { name: 'search' }],
      },
    ],
    behaviorHints: { configurable: true },
  };
}
// ─── STATIC ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/configure'));
app.get('/configure', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'configure.html'));
});
app.get('/manifest.json', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json(getBaseManifest(baseUrl));
});
// ─── MANIFEST ─────────────────────────────────────────────────────────────────
app.get('/:token/manifest.json', (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  res.json(getConfiguredManifest());
});
// ─── CATALOG ─────────────────────────────────────────────────────────────────
async function handleCatalog(req, res) {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ metas: [] });
  const { torboxApiKey, tmdbApiKey, sortBy = 'data_adicao' } = config;
  const type      = req.params.type;
  const extra     = parseExtra(req.params.extra || '');
  const skip      = parseInt(extra.skip) || 0;
  const search    = extra.search || '';
  console.log(`[Catalog] type=${type} skip=${skip} search="${search}" hasKeys=${!!(torboxApiKey && tmdbApiKey)}`);
  if (!torboxApiKey || !tmdbApiKey) return res.json({ metas: [] });
  const cacheKey = `cat:${type}:${sortBy}:${search}:${skip}:${torboxApiKey.slice(-6)}`;  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[Catalog] Cache hit → ${cached.metas.length} items`);
    return res.json(cached);
  }
  try {
    const downloads = await getTorBoxDownloads(torboxApiKey);
    const metas = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search });
    console.log(`[Catalog] Built → ${metas.length} metas, first id: ${metas[0]?.id}`);
    const result = { metas };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[Catalog] Error:', err.message);
    res.json({ metas: [] });
  }
}
// Sem extras
app.get('/:token/catalog/:type/:catalogId.json', handleCatalog);
// Com extras: /skip=50.json ou /skip=50&search=foo.json
app.get('/:token/catalog/:type/:catalogId/:extra.json', handleCatalog);
// ─── META ─────────────────────────────────────────────────────────────────────
app.get('/:token/meta/:type/:id.json', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ meta: null });
  const { tmdbApiKey } = config;
  const { type, id } = req.params;
  if (!tmdbApiKey || !id.startsWith('torbox:')) return res.json({ meta: null });
  const cacheKey = `meta:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);
  try {
    const tmdbId = id.split(':')[2];
    const meta = await buildMeta(tmdbId, type, tmdbApiKey);
    const result = { meta };
    cache.set(cacheKey, result, 3600);
    res.json(result);
  } catch (err) {
    console.error('[Meta] Error:', err.message);
    res.json({ meta: null });
  }
});
// ─── STREAM ───────────────────────────────────────────────────────────────────
app.get('/:token/stream/:type/:id.json', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ streams: [] });
  const { torboxApiKey, tmdbApiKey } = config;
  const { type, id } = req.params;
  if (!torboxApiKey || !id.startsWith('torbox:')) return res.json({ streams: [] });
  try {
    const parts = id.split(':');
    const streams = await buildStreams(torboxApiKey, tmdbApiKey, type, parts[2], parts[3], parts[4]);
    res.json({ streams });
  } catch (err) {
    console.error('[Stream] Error:', err.message);
    res.json({ streams: [] });
  }
});
module.exports = app;
