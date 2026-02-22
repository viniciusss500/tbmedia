const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { getTorBoxDownloads } = require('./src/torbox');
const { getMetadata, searchMetadata } = require('./src/tmdb');
const { buildCatalog, buildMeta, buildStreams } = require('./src/builder');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 300 }); // 5 min cache

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
  behaviorHints: {
    configurable: true,
    configurationRequired: true,
  },
  config: [
    {
      key: 'torboxApiKey',
      type: 'text',
      title: 'TorBox API Key',
      required: true,
    },
    {
      key: 'tmdbApiKey',
      type: 'text',
      title: 'TMDB API Key (v3)',
      required: true,
    },
    {
      key: 'sortBy',
      type: 'select',
      title: 'Ordenar por',
      options: ['data_adicao', 'data_lancamento', 'titulo'],
      required: false,
    },
  ],
};

const builder = new addonBuilder(manifest);

// ─── CATALOG ────────────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra, config }) => {
  const { torboxApiKey, tmdbApiKey, sortBy = 'data_adicao' } = config || {};
  if (!torboxApiKey || !tmdbApiKey) {
    return { metas: [] };
  }

  const cacheKey = `catalog:${type}:${id}:${sortBy}:${extra?.search || ''}:${extra?.skip || 0}`;
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

// ─── META ────────────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ type, id, config }) => {
  const { tmdbApiKey } = config || {};
  if (!tmdbApiKey || !id.startsWith('torbox:')) return { meta: null };

  const cacheKey = `meta:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // id format: torbox:movie:tmdbId  or  torbox:series:tmdbId
    const parts = id.split(':');
    const tmdbId = parts[2];
    const meta = await buildMeta(tmdbId, type, tmdbApiKey);
    const result = { meta };
    cache.set(cacheKey, result, 3600); // 1h for meta
    return result;
  } catch (err) {
    console.error('Meta error:', err.message);
    return { meta: null };
  }
});

// ─── STREAM ──────────────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ type, id, config }) => {
  const { torboxApiKey, tmdbApiKey } = config || {};
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

// ─── SERVER ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7860;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`TorBox Stremio Addon running on port ${PORT}`);
