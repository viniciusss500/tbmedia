const express = require('express');
const path = require('path');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const { getTorBoxDownloads } = require('./src/torbox');
const { buildCatalog, buildMeta, buildStreams } = require('./src/builder');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 300 });
const app = express();
app.use(express.json());

// ─── MANIFEST ────────────────────────────────────────────────────────────────
const manifest = {
  id: 'community.torbox.catalog',
  version: '1.0.0',
  name: 'TorBox Catalog',
  description: 'Seu catálogo pessoal do TorBox com metadados em Português BR do TMDB.',
  logo: 'https://torbox.app/favicon.ico',
  background: 'https://i.imgur.com/wEYpOCO.jpg',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['torbox:'],
  catalogs: [
    {
      id: 'torbox-movies',
      type: 'movie',
      name: 'TorBox - Filmes',
      extra: [
        { name: 'skip', isRequired: false },
        { name: 'search', isRequired: false },
      ],
    },
    {
      id: 'torbox-series',
      type: 'series',
      name: 'TorBox - Séries',
      extra: [
        { name: 'skip', isRequired: false },
        { name: 'search', isRequired: false },
      ],
    },
  ],
  behaviorHints: { configurable: true, configurationRequired: true },
};

// ─── CONFIG ENCODE/DECODE ─────────────────────────────────────────────────────
function encodeConfig(cfg) {
  return Buffer.from(JSON.stringify(cfg)).toString('base64url');
}
function decodeConfig(str) {
  try {
    return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

// ─── ADDON BUILDER PER REQUEST ───────────────────────────────────────────────
function buildAddon(config) {
  const builder = new addonBuilder({ ...manifest });

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const { torboxApiKey, tmdbApiKey, sortBy = 'data_adicao' } = config;
    if (!torboxApiKey || !tmdbApiKey) return { metas: [] };

    const cacheKey = `catalog:${type}:${id}:${sortBy}:${extra?.search || ''}:${extra?.skip || 0}:${torboxApiKey.slice(-6)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const downloads = await getTorBoxDownloads(torboxApiKey, type);
      const metas = await buildCatalog(downloads, tmdbApiKey, type, sortBy, extra);
      const result = { metas };
      cache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error('Catalog error:', err.message);
      return { metas: [] };
    }
  });

  builder.defineMetaHandler(async ({ type, id }) => {
    const { tmdbApiKey } = config;
    if (!tmdbApiKey || !id.startsWith('torbox:')) return { meta: null };

    const cacheKey = `meta:${id}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const parts = id.split(':');
      const tmdbId = parts[2];
      const meta = await buildMeta(tmdbId, type, tmdbApiKey);
      const result = { meta };
      cache.set(cacheKey, result, 3600);
      return result;
    } catch (err) {
      console.error('Meta error:', err.message);
      return { meta: null };
    }
  });

  builder.defineStreamHandler(async ({ type, id }) => {
    const { torboxApiKey, tmdbApiKey } = config;
    if (!torboxApiKey || !id.startsWith('torbox:')) return { streams: [] };

    try {
      const parts = id.split(':');
      const tmdbId = parts[2];
      const season = parts[3];
      const episode = parts[4];
      const streams = await buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode);
      return { streams };
    } catch (err) {
      console.error('Stream error:', err.message);
      return { streams: [] };
    }
  });

  return builder.getInterface();
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect('/configure'));

// Serve the configure page HTML
app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'configure.html'));
});

// Bare manifest (no config encoded)
app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ ...manifest });
});

// Configured addon routes: /:configBase64/manifest.json, /catalog/..., etc.
app.use('/:configBase64/:resource(*)', (req, res, next) => {
  const { configBase64 } = req.params;
  if (configBase64 === 'configure') return next();

  const config = decodeConfig(configBase64);
  const addonInterface = buildAddon(config);
  const router = getRouter(addonInterface);

  // Rewrite url so the addon router sees /resource instead of /configBase64/resource
  req.url = '/' + (req.params.resource || '');
  router(req, res, next);
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`TorBox Addon → http://localhost:${PORT}`);
  console.log(`Configure   → http://localhost:${PORT}/configure`);
});

module.exports = app; // for Vercel
