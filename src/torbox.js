const axios = require('axios');
const NodeCache = require('node-cache');

const TORBOX_BASE = 'https://api.torbox.app/v1/api';

// ─── CACHE ────────────────────────────────────────────────────────────────────
const downloadsCache = new NodeCache({ stdTTL: 300 });   // 5 min
const filesCache     = new NodeCache({ stdTTL: 3600 });  // 1h

// Evita spam de log para usenet indisponível
let usenetUnavailableLogged = false;

// ─── HELPER REQUEST ───────────────────────────────────────────────────────────
async function torboxGet(path, apiKey, params = {}) {
  const headers = { Authorization: `Bearer ${apiKey}` };

  try {
    const res = await axios.get(`${TORBOX_BASE}${path}`, {
      headers,
      params,
      timeout: 15000,
    });
    return { data: res.data, status: res.status };

  } catch (err) {
    const status  = err.response?.status ?? null;
    const message = err.response?.data?.detail || err.response?.data?.error || err.message;

    return { error: message, status };
  }
}

// ─── DOWNLOADS (COM CACHE) ────────────────────────────────────────────────────
async function getTorBoxDownloads(apiKey) {
  const cacheKey = `downloads:${apiKey.slice(-6)}`;
  const cached   = downloadsCache.get(cacheKey);
  if (cached) {
    console.log('[TorBox] ✅ Downloads cache hit');
    return cached;
  }

  const params = { bypass_cache: false };

  const [torrentsResult, usenetResult] = await Promise.all([
    torboxGet('/torrents/mylist', apiKey, params),
    torboxGet('/usenet/mylist',   apiKey, params),
  ]);

  let items = [];

  // ── Torrents ────────────────────────────────────────────────────────────────
  if (!torrentsResult.error) {
    const data = torrentsResult.data?.data;
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    items = items.concat(list.map(t => ({ ...t, source: 'torrent' })));
  } else {
    console.error(`[TorBox] Torrents erro ${torrentsResult.status}: ${torrentsResult.error}`);
  }

  // ── Usenet ──────────────────────────────────────────────────────────────────
  if (!usenetResult.error) {
    const data = usenetResult.data?.data;
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    items = items.concat(list.map(u => ({ ...u, source: 'usenet' })));
  } else {
    const s = usenetResult.status;
    if ((s === 403 || s === 401) && !usenetUnavailableLogged) {
      console.log('[TorBox] Usenet não disponível no plano');
      usenetUnavailableLogged = true;
    }
  }

  // ── Filtrar concluídos ──────────────────────────────────────────────────────
  const completed = items.filter(i => {
    const state = (i.download_state || '').toLowerCase();
    return (
      state === 'completed' ||
      state === 'seeding' ||
      state === 'cached' ||
      state === 'finalized' ||
      i.download_finished === true ||
      i.download_present === true
    );
  });

  console.log(`[TorBox] Downloads: ${completed.length}`);

  downloadsCache.set(cacheKey, completed);
  return completed;
}

// ─── FILES (COM CACHE) ────────────────────────────────────────────────────────
async function getTorBoxFiles(apiKey, source, itemId) {
  const cacheKey = `files:${source}:${itemId}`;
  const cached   = filesCache.get(cacheKey);
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

// ─── STREAM LINK (SEM CACHE AQUI — CACHE NO BUILDER) ──────────────────────────
async function getTorBoxStreamLink(apiKey, source, itemId, fileId) {
  const headers = { Authorization: `Bearer ${apiKey}` };

  const endpoint = source === 'torrent'
    ? `${TORBOX_BASE}/torrents/requestdl`
    : `${TORBOX_BASE}/usenet/requestdl`;

  const params = source === 'torrent'
    ? { token: apiKey, torrent_id: itemId, file_id: fileId, zip_link: false }
    : { token: apiKey, usenet_id: itemId,  file_id: fileId, zip_link: false };

  try {
    const res = await axios.get(endpoint, {
      headers,
      params,
      timeout: 10000,
    });

    return res.data?.data || null;

  } catch (err) {
    const s = err.response?.status;
    console.error(`[TorBox] requestdl erro ${s ?? '?'} (${itemId}): ${err.message}`);
    return null;
  }
}

// ─── VIDEO DETECTION ──────────────────────────────────────────────────────────
const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.wmv', '.webm'];

function isVideoFile(name = '') {
  return VIDEO_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
  getTorBoxDownloads,
  getTorBoxStreamLink,
  getTorBoxFiles,
  isVideoFile
};
