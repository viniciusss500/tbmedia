const axios = require('axios');

const RD_BASE = 'https://api.real-debrid.com/rest/1.0';

async function rdGet(path, apiKey, params = {}) {
  try {
    const res = await axios.get(`${RD_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      params,
      timeout: 20000,
    });
    return { data: res.data };
  } catch (err) {
    return { error: err.response?.data?.error || err.message, status: err.response?.status };
  }
}

async function getRealDebridDownloads(apiKey) {
  const items = [];
  let page = 1;

  while (true) {
    const { data, error } = await rdGet('/torrents', apiKey, { page, limit: 100 });
    if (error || !Array.isArray(data) || data.length === 0) break;

    for (const t of data) {
      if (t.status !== 'downloaded') continue;
      items.push({
        id:                t.id,
        name:              t.filename,
        filename:          t.filename,
        size:              t.bytes,
        source:            'realdebrid',
        download_state:    'completed',
        download_finished: true,
        created_at:        t.added,
        _rdHash:           t.hash,
      });
    }

    if (data.length < 100) break;
    page++;
  }

  console.log(`[RD] Downloads: ${items.length} itens`);
  return items;
}

// FIX: retorna { files, links } do torrent — reutilizável por getRealDebridFiles e getRealDebridStreamLink
async function getRealDebridTorrentInfo(apiKey, itemId) {
  const { data, error } = await rdGet(`/torrents/info/${itemId}`, apiKey);
  if (error || !data) return null;
  return data;
}

async function getRealDebridFiles(apiKey, itemId) {
  const info = await getRealDebridTorrentInfo(apiKey, itemId);
  if (!info) return [];
  return (info.files || [])
    .filter(f => f.selected === 1)
    .map(f => ({ id: f.id, name: f.path?.split('/').pop() || f.path, size: f.bytes, _info: info }));
}

// FIX: aceita info pré-carregado para evitar segunda chamada a /torrents/info/{id}
async function getRealDebridStreamLink(apiKey, itemId, fileId, preloadedInfo = null) {
  const info = preloadedInfo || await getRealDebridTorrentInfo(apiKey, itemId);
  if (!info?.links?.length) return null;

  const selectedFiles = (info.files || []).filter(f => f.selected === 1);
  const fileIndex     = selectedFiles.findIndex(f => f.id === fileId);
  const link          = info.links[fileIndex >= 0 ? fileIndex : 0];
  if (!link) return null;

  const { data: unrestricted } = await axios.post(
    `${RD_BASE}/unrestrict/link`,
    new URLSearchParams({ link }),
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    }
  ).catch(() => ({ data: null }));

  return unrestricted?.download || null;
}

module.exports = { getRealDebridDownloads, getRealDebridFiles, getRealDebridStreamLink, getRealDebridTorrentInfo };
