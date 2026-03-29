const axios = require('axios');

const TORBOX_BASE = 'https://api.torbox.app/v1/api';

// Rastreia se já avisamos sobre usenet indisponível (evita spam no log)
let usenetUnavailableLogged = false;

/**
 * Faz uma requisição GET ao TorBox com tratamento de erro granular.
 * Retorna { data, status } ou { error, status } em caso de falha.
 */
async function torboxGet(path, apiKey, params = {}) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  try {
    const res = await axios.get(`${TORBOX_BASE}${path}`, { headers, params, timeout: 15000 });
    return { data: res.data, status: res.status };
  } catch (err) {
    const status = err.response?.status ?? null;
    const message = err.response?.data?.detail || err.response?.data?.error || err.message;
    return { error: message, status };
  }
}

/**
 * Busca todos os downloads concluídos do TorBox (torrents + usenet).
 */
async function getTorBoxDownloads(apiKey) {
  // bypass_cache: false → usa cache do servidor (mais rápido e compatível com todos os planos)
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

  // ── Usenet ──────────────────────────────────────────────────────────────────
  if (!usenetResult.error) {
    const data = usenetResult.data?.data;
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    console.log(`[TorBox] Usenet: ${list.length} itens`);
    items = items.concat(list.map(u => ({ ...u, source: 'usenet' })));
  } else {
    const s = usenetResult.status;
    if (s === 403 || s === 401) {
      // 403/401 em usenet = plano não inclui usenet. Logar apenas uma vez.
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

  // TorBox states: "completed", "seeding", "cached", "finalized", + download_finished / download_present
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

/**
 * Obtém link de stream direto para um arquivo específico.
 */
async function getTorBoxStreamLink(apiKey, source, itemId, fileId) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const endpoint = source === 'torrent'
    ? `${TORBOX_BASE}/torrents/requestdl`
    : `${TORBOX_BASE}/usenet/requestdl`;

  const params = source === 'torrent'
    ? { token: apiKey, torrent_id: itemId, file_id: fileId, zip_link: false }
    : { token: apiKey, usenet_id: itemId,  file_id: fileId, zip_link: false };

  try {
    const res = await axios.get(endpoint, { headers, params, timeout: 10000 });
    return res.data?.data || null;
  } catch (err) {
    const s = err.response?.status;
    console.error(`[TorBox] requestdl erro ${s ?? '?'} (${source} id=${itemId} file=${fileId}): ${err.message}`);
    return null;
  }
}

/**
 * Lista arquivos dentro de um item do TorBox.
 */
async function getTorBoxFiles(apiKey, source, itemId) {
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

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.wmv', '.webm'];

function isVideoFile(name = '') {
  return VIDEO_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}

module.exports = { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile };
