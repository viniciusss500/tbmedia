const NodeCache = require('node-cache');
const filesCache = new NodeCache({ stdTTL: 3600 });

async function getTorBoxFiles(apiKey, source, itemId) {
  const cacheKey = `${source}:${itemId}`;
  const cached = filesCache.get(cacheKey);
  if (cached) return cached;

  const headers = { Authorization: `Bearer ${apiKey}` };
  const endpoint = source === 'torrent'
    ? `${TORBOX_BASE}/torrents/mylist`
    : `${TORBOX_BASE}/usenet/mylist`;

  try {
    const res = await axios.get(endpoint, {
      headers,
      params: { id: itemId, bypass_cache: false },
      timeout: 10000,
    });

    const data = res.data?.data;
    const item = Array.isArray(data) ? data[0] : data;
    const files = item?.files || [];

    filesCache.set(cacheKey, files);
    return files;

  } catch (err) {
    console.error(`[TorBox] Files erro (${itemId}): ${err.message}`);
    return [];
  }
}
