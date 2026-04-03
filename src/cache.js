const Redis = require('ioredis');

let redis = null;

function getRedisClient() {
  if (!redis && process.env.UPSTASH_REDIS_URL) {
    redis = new Redis(process.env.UPSTASH_REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });
    
    redis.on('error', (err) => {
      console.error('[Redis] Error:', err.message);
    });
    
    redis.on('connect', () => {
      console.log('[Redis] Connected to Upstash');
    });
  }
  return redis;
}

async function get(key) {
  const client = getRedisClient();
  if (!client) return null;
  
  try {
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('[Cache] Get error:', err.message);
    return null;
  }
}

async function set(key, value, ttl = 3600) {
  const client = getRedisClient();
  if (!client) return false;
  
  try {
    await client.setex(key, ttl, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('[Cache] Set error:', err.message);
    return false;
  }
}

async function del(key) {
  const client = getRedisClient();
  if (!client) return false;
  
  try {
    await client.del(key);
    return true;
  } catch (err) {
    console.error('[Cache] Del error:', err.message);
    return false;
  }
}

module.exports = { get, set, del };
