const express = require('express');
const path = require('path');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');

const ROOT_DIR = path.resolve(__dirname);
const { getTorBoxDownloads } = require('./src/torbox');
const { buildCatalog, buildMeta, buildStreams } = require('./src/builder');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 300 });
const app = express();
app.use(express.json());

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

// ─── BASE MANIFEST (sem config) ───────────────────────────────────────────────
// configurationRequired: true  → Stremio mostra botão "Configurar"
// configureUrl                 → ao clicar "Configurar", abre nossa página HTML
function getBaseManifest(baseUrl) {
  return {
    id: 'community.torbox.catalog',
    version: '1.1.0',
    name: 'TorBox Catalog',
    description: 'Seu catálogo pessoal do TorBox com metadados em Português BR do TMDB.',
    logo: 'https://torbox.app/favicon.ico',
    background: 'https://raw.githubusercontent.com/adrianoBP/torbox-stremio/main/bg.jpg',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['torbox:'],
    catalogs: [],
    behaviorHints: {
      configurable: true,
      configurationRequired: true,
    },
    // Stremio abre esta URL quando o usuário clica em "Configurar"
    configureUrl: `${baseUrl}/configure`,
  };
}

// ─── MANIFEST CONFIGURADO (com config no token) ───────────────────────────────
// configurationRequired: false → Stremio mostra botão "Instalar" ✅
function getConfiguredManifest() {
  return {
    id: 'community.torbox.catalog',
    version: '1.1.0',
    name: 'TorBox Catalog',
    description: 'Seu catálogo pessoal do TorBox com metadados em Português BR do TMDB.',
    logo: 'https://torbox.app/favicon.ico',
    background: 'https://raw.githubusercontent.com/adrianoBP/torbox-stremio/main/bg.jpg',
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
    // SEM configurationRequired → Stremio exibe "Instalar" normalmente
    behaviorHints: {
      configurable: true,
    },
  };
}

// ─── CONFIG DECODE ────────────────────────────────────────────────────────────
function decodeConfig(str) {
  try {
    const padded = str + '=='.slice(0, (4 - (str.length % 4)) % 4);
    const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(standard, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

// ─── ADDON BUILDER ────────────────────────────────────────────────────────────
function buildAddon(config) {
  const builder = new addonBuilder(getConfiguredManifest());

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const { torboxApiKey, tmdbApiKey, sortBy = 'data_adicao' } = config;
    if (!torboxApiKey || !tmdbApiKey) return { metas: [] };

    const cacheKey = `catalog:${type}:${id}:${sortBy}:${extra?.search || ''}:${extra?.skip || 0}:${torboxApiKey.slice(-6)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const downloads = await getTorBoxDownloads(torboxApiKey);
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

// ─── ROTAS ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect('/configure'));

// Página de configuração HTML
app.get('/configure', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'configure.html'));
});

// Manifest raiz — sem config, mostra botão "Configurar" no Stremio
app.get('/manifest.json', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json(getBaseManifest(baseUrl));
});

// ── Rotas configuradas: /:configBase64/manifest.json etc. ────────────────────
app.use('/:configBase64', (req, res, next) => {
  const { configBase64 } = req.params;

  // Ignorar caminhos reservados
  if (['configure', 'favicon.ico', 'static'].includes(configBase64)) return next();
  if (configBase64.includes('.') && !configBase64.includes('manifest')) return next();

  const config = decodeConfig(configBase64);
  const addonInterface = buildAddon(config);
  const addonRouter = getRouter(addonInterface);

  // Remove o prefixo de config da URL antes de passar ao router do addon
  const stripped = req.originalUrl.replace(`/${configBase64}`, '') || '/';
  req.url = stripped;

  addonRouter(req, res, next);
});

module.exports = app;
