const axios = require('axios');

const TORBOX_BASE = 'https://api.torbox.app/v1/api';

/**
 * Fetch all usenet/torrent downloads from TorBox and filter by type.
 */
async function getTorBoxDownloads(apiKey, type) {
  const headers = { Authorization: `Bearer ${apiKey}` };

  // Fetch torrents and usenet in parallel
  const [torrentsRes, usenetRes] = await Promise.allSettled([
    axios.get(`${TORBOX_BASE}/torrents/mylist`, { headers, params: { bypass_cache: false } }),
    axios.get(`${TORBOX_BASE}/usenet/mylist`, { headers, params: { bypass_cache: false } }),
  ]);

  let items = [];

  if (torrentsRes.status === 'fulfilled' && torrentsRes.value.data?.data) {
    items = items.concat(
      torrentsRes.value.data.data.map((t) => ({ ...t, source: 'torrent' }))
    );
  }

  if (usenetRes.status === 'fulfilled' && usenetRes.value.data?.data) {
    items = items.concat(
      usenetRes.value.data.data.map((u) => ({ ...u, source: 'usenet' }))
    );
  }

  // Only return completed downloads
  items = items.filter((i) => i.download_state === 'completed' || i.download_finished === true);

  return items;
}

/**
 * Get a direct stream link for a specific file in TorBox.
 */
async function getTorBoxStreamLink(apiKey, source, id, fileId) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const endpoint =
    source === 'torrent'
      ? `${TORBOX_BASE}/torrents/requestdl`
      : `${TORBOX_BASE}/usenet/requestdl`;

  const params = { token: apiKey, torrent_id: id, file_id: fileId, zip_link: false };
  if (source === 'usenet') {
    params.usenet_id = id;
    delete params.torrent_id;
  }

  const res = await axios.get(endpoint, { headers, params });
  return res.data?.data || null;
}

/**
 * List files inside a TorBox download item.
 */
async function getTorBoxFiles(apiKey, source, id) {
  const headers = { Authorization: `Bearer ${apiKey}` };

  try {
    if (source === 'torrent') {
      const res = await axios.get(`${TORBOX_BASE}/torrents/mylist`, {
        headers,
        params: { id, bypass_cache: true },
      });
      const item = res.data?.data;
      return item?.files || [];
    } else {
      const res = await axios.get(`${TORBOX_BASE}/usenet/mylist`, {
        headers,
        params: { id, bypass_cache: true },
      });
      const item = res.data?.data;
      return item?.files || [];
    }
  } catch {
    return [];
  }
}

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.wmv'];

function isVideoFile(name) {
  return VIDEO_EXTENSIONS.some((ext) => name?.toLowerCase().endsWith(ext));
}

module.exports = { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile };
