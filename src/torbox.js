const axios = require('axios');
const NodeCache = require('node-cache');

const TORBOX_BASE = 'https://api.torbox.app/v1/api';

let usenetUnavailableLogged = false;

// Caches curtos em memória para evitar repetir chamadas à API do TorBox
// dentro do mesmo processo (a instância free do Render perde o cache ao hibernar,
// então reduzir chamadas duplicadas é essencial para não estourar tráfego de saída).
const downloadsCache = new NodeCache({ stdTTL: 120, checkperiod: 60, useClones: false });
const filesCache     = new NodeCache({ stdTTL: 300, checkperiod: 120, useClones: false });

const downloadsInflight = new Map();
const filesInflight     = new Map();

async function torboxGet(path, apiKey, params = {}) {
  if (!apiKey || apiKey.length < 10) {
    console.error('[TorBox] API key inválida ou ausente');
    return { error: 'API key inválida', status: 401 };
  }
  
  const headers = { Authorization: `Bearer ${apiKey}` };
  console.log(`[TorBox] Request: ${path} | Key: ...${apiKey.slice(-8)}`);
  
  try {
    const res = await axios.get(`${TORBOX_BASE}${path}`, { 
      headers, 
      params, 
      timeout: 20000,
      validateStatus: (status) => status < 500
    });
    return { data: res.data, status: res.status };
  } catch (err) {
    const status = err.response?.status ?? null;
    const message = err.response?.data?.detail || err.response?.data?.error || err.message;
    console.error(`[TorBox] Error ${status}: ${message}`);
    return { error: message, status };
  }
}

async function fetchTorBoxDownloads(apiKey) {
  const params = { bypass_cache: false };

  const [torrentsResult, usenetResult] = await Promise.all([
    torboxGet('/torrents/mylist', apiKey, params),
    torboxGet('/usenet/mylist',   apiKey, params),
  ]);

  let items = [];

  if (!torrentsResult.error) {
    const data = torrentsResult.data?.data;
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    console.log(`[TorBox] Torrents: ${list.length} itens`);
    items = items.concat(list.map(t => ({ ...t, source: 'torrent' })));
  } else {
    const s = torrentsResult.status;
    if (s === 403) {
      console.error('[TorBox] Torrents: acesso negado (403). Verifique se a chave de API está correta e ativa.');
    } else if (s === 401) {
      console.error('[TorBox] Torrents: chave de API inválida (401).');
    } else {
      console.error(`[TorBox] Torrents: erro ${s ?? 'desconhecido'} — ${torrentsResult.error}`);
    }
  }

  if (!usenetResult.error) {
    const data = usenetResult.data?.data;
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    console.log(`[TorBox] Usenet: ${list.length} itens`);
    items = items.concat(list.map(u => ({ ...u, source: 'usenet' })));
  } else {
    const s = usenetResult.status;
    if (s === 403 || s === 401) {
      if (!usenetUnavailableLogged) {
        console.log('[TorBox] Usenet: não disponível neste plano (ignorando).');
        usenetUnavailableLogged = true;
      }
    } else {
      console.error(`[TorBox] Usenet: erro ${s ?? 'desconhecido'} — ${usenetResult.error}`);
    }
  }

  console.log(`[TorBox] Total antes do filtro: ${items.length}`);

  const states = [...new Set(items.map(i => i.download_state))];
  if (states.length > 0) console.log(`[TorBox] Estados encontrados:`, states);

  const completed = items.filter(i => {
    const state = (i.download_state || '').toLowerCase();
    return (
      state === 'completed'  ||
      state === 'seeding'    ||
      state === 'cached'     ||
      state === 'finalized'  ||
      i.download_finished === true ||
      i.download_present === true
    );
  });

  console.log(`[TorBox] Itens concluídos: ${completed.length}`);
  if (completed.length > 0) {
    console.log(`[TorBox] Amostra:`, completed[0].name || completed[0].filename);
  }

  return completed;
}

const TB_DOWNLOADS_TTL = parseInt(process.env.TB_DOWNLOADS_TTL) || 120;

async function getTorBoxDownloads(apiKey) {
  const cacheKey = `dl:${apiKey}`;
  const cached = downloadsCache.get(cacheKey);
  if (cached !== undefined) return cached;

  if (downloadsInflight.has(cacheKey)) return downloadsInflight.get(cacheKey);

  const p = fetchTorBoxDownloads(apiKey)
    .then(result => { downloadsCache.set(cacheKey, result, TB_DOWNLOADS_TTL); return result; })
    .finally(() => downloadsInflight.delete(cacheKey));

  downloadsInflight.set(cacheKey, p);
  return p;
}

/**
 * Gera a URL direta de reprodução no TorBox.
 *
 * IMPORTANTE: não resolve o link no servidor. Devolvemos a própria URL do
 * `requestdl` com `redirect=true`; ao reproduzir, o player do Stremio abre essa
 * URL, o TorBox responde com 302 para o CDN e o vídeo flui TorBox → Stremio,
 * sem passar pelo servidor do addon (Render). Isso elimina o tráfego de mídia
 * e as chamadas `requestdl` originadas do Render.
 */
function getTorBoxStreamLink(apiKey, source, itemId, fileId) {
  const endpoint = source === 'torrent'
    ? `${TORBOX_BASE}/torrents/requestdl`
    : `${TORBOX_BASE}/usenet/requestdl`;

  const params = source === 'torrent'
    ? { token: apiKey, torrent_id: itemId, file_id: fileId, zip_link: false, redirect: true }
    : { token: apiKey, usenet_id: itemId,  file_id: fileId, zip_link: false, redirect: true };

  return `${endpoint}?${new URLSearchParams(params).toString()}`;
}

async function fetchTorBoxFiles(apiKey, source, itemId) {
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
    return item?.files || [];
  } catch (err) {
    const s = err.response?.status;
    console.error(`[TorBox] Files erro ${s ?? '?'} (${source} id=${itemId}): ${err.message}`);
    return [];
  }
}

async function getTorBoxFiles(apiKey, source, itemId) {
  const cacheKey = `files:${source}:${itemId}`;
  const cached = filesCache.get(cacheKey);
  if (cached !== undefined) return cached;

  if (filesInflight.has(cacheKey)) return filesInflight.get(cacheKey);

  const p = fetchTorBoxFiles(apiKey, source, itemId)
    .then(result => { filesCache.set(cacheKey, result); return result; })
    .finally(() => filesInflight.delete(cacheKey));

  filesInflight.set(cacheKey, p);
  return p;
}

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.wmv', '.webm'];

function isVideoFile(name = '') {
  return VIDEO_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}

module.exports = { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile };
