const Redis = require('ioredis');

let redis = null;
let isConnected = false;

function getRedisClient() {
  if (!redis) {
    const url      = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
    const host     = process.env.REDIS_HOST;
    const port     = parseInt(process.env.REDIS_PORT) || 6379;
    const password = process.env.REDIS_PASSWORD;
    const tls      = process.env.REDIS_TLS === 'true' || (url && url.startsWith('rediss://'));

    if (!url && !host) return null;

    const opts = {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 50, 2000);
      },
      ...(tls ? { tls: {} } : {}),
    };

    console.log(`[Redis] Conectando via ${url ? 'URL' : `${host}:${port}`}...`);
    redis = url
      ? new Redis(url, opts)
      : new Redis({ host, port, password, ...opts });

    redis.on('error',   (err) => { console.error('[Redis] Erro:', err.message); isConnected = false; });
    redis.on('connect', ()    => { console.log('[Redis] Conectado'); isConnected = true; });
    redis.on('close',   ()    => { console.log('[Redis] Conexão fechada'); isConnected = false; });
  }
  return redis;
}

async function get(key) {
  const client = getRedisClient();
  if (!client) {
    console.warn('[Cache] Redis não configurado, usando fallback');
    return null;
  }
  
  try {
    const data = await client.get(key);
    if (!data) return null;
    
    const parsed = JSON.parse(data);
    console.log(`[Cache] HIT → ${key}`);
    return parsed;
  } catch (err) {
    console.error(`[Cache] Erro ao buscar ${key}:`, err.message);
    return null;
  }
}

async function set(key, value, ttl = 3600) {
  const client = getRedisClient();
  if (!client) {
    console.warn('[Cache] Redis não configurado, usando fallback');
    return false;
  }
  
  try {
    const serialized = JSON.stringify(value);
    await client.setex(key, ttl, serialized);
    console.log(`[Cache] SET → ${key} (TTL: ${ttl}s)`);
    return true;
  } catch (err) {
    console.error(`[Cache] Erro ao armazenar ${key}:`, err.message);
    return false;
  }
}

async function del(key) {
  const client = getRedisClient();
  if (!client) return false;
  
  try {
    await client.del(key);
    console.log(`[Cache] DEL → ${key}`);
    return true;
  } catch (err) {
    console.error(`[Cache] Erro ao deletar ${key}:`, err.message);
    return false;
  }
}

async function delPattern(pattern) {
  const client = getRedisClient();
  if (!client) return 0;
  
  try {
    const keys = await client.keys(pattern);
    if (keys.length === 0) return 0;
    
    await client.del(...keys);
    console.log(`[Cache] DEL Pattern → ${pattern} (${keys.length} chaves)`);
    return keys.length;
  } catch (err) {
    console.error(`[Cache] Erro ao deletar padrão ${pattern}:`, err.message);
    return 0;
  }
}

async function exists(key) {
  const client = getRedisClient();
  if (!client) return false;
  
  try {
    const result = await client.exists(key);
    return result === 1;
  } catch (err) {
    console.error(`[Cache] Erro ao verificar ${key}:`, err.message);
    return false;
  }
}

async function expire(key, ttl) {
  const client = getRedisClient();
  if (!client) return false;
  
  try {
    await client.expire(key, ttl);
    return true;
  } catch (err) {
    console.error(`[Cache] Erro ao definir TTL para ${key}:`, err.message);
    return false;
  }
}

async function getStats() {
  const client = getRedisClient();
  if (!client) return { connected: false };
  
  try {
    const info = await client.info('stats');
    const dbsize = await client.dbsize();
    
    return {
      connected: isConnected,
      dbsize,
      info: info.split('\r\n').reduce((acc, line) => {
        const [key, value] = line.split(':');
        if (key && value) acc[key] = value;
        return acc;
      }, {}),
    };
  } catch (err) {
    console.error('[Cache] Erro ao obter estatísticas:', err.message);
    return { connected: false, error: err.message };
  }
}

function makeKey(prefix, ...parts) {
  return `${prefix}:${parts.filter(Boolean).join(':')}`;
}

module.exports = {
  get,
  set,
  del,
  delPattern,
  exists,
  expire,
  getStats,
  makeKey,
  getRedisClient,
};
