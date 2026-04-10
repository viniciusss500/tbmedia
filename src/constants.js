const VERSION = '1.4.1';

const TIMEOUTS = {
  TORBOX_API: 20000,
  TMDB_API: 10000,
  STREAM_REQUEST: 10000,
};

const CACHE_TTL = {
  CATALOG: 3600,        // 1 hora
  META: 86400,          // 24 horas
  STREAM: 600,          // 10 minutos
  IMDB_MAPPING: 604800, // 7 dias
  MATCH: 86400,         // 1 dia
};

const PAGE_SIZE = 50;

const MAX_CONCURRENCY = 20;

const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutos

module.exports = {
  VERSION,
  TIMEOUTS,
  CACHE_TTL,
  PAGE_SIZE,
  MAX_CONCURRENCY,
  REFRESH_INTERVAL,
};
