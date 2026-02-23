const axios = require('axios');
const TORBOX_BASE = 'https://api.torbox.app/v1/api';
/**
 * Fetch all completed downloads from TorBox (torrents + usenet).
 */
async function getTorBoxDownloads(apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const [torrentsRes, usenetRes] = await Promise.allSettled([
    axios.get(`${TORBOX_BASE}/torrents/mylist`, { headers, params: { bypass_cache: true } }),
    axios.get(`${TORBOX_BASE}/usenet/mylist`,   { headers, params: { bypass_cache: true } }),
  ]);
  let items = [];
  if (torrentsRes.status === 'fulfilled') {
    const data = torrentsRes.value.data?.data;
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    console.log(`[TorBox] Torrents fetched: ${list.length}`);
    items = items.concat(list.map(t => ({ ...t, source: 'torrent' })));
  } else {
    console.error('[TorBox] Torrents error:', torrentsRes.reason?.message);
  }
  if (usenetRes.status === 'fulfilled') {
    const data = usenetRes.value.data?.data;
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    console.log(`[TorBox] Usenet fetched: ${list.length}`);
    items = items.concat(list.map(u => ({ ...u, source: 'usenet' })));
  } else {
    console.error('[TorBox] Usenet error:', usenetRes.reason?.message);
  }
  console.log(`[TorBox] Total before filter: ${items.length}`);
  // Log unique states to understand the API response
  const states = [...new Set(items.map(i => i.download_state))];
  console.log(`[TorBox] States found:`, states);
  // TorBox API states: "completed", "downloading", "seeding", "stalled", etc.
  // Also check download_finished boolean as fallback
  const completed = items.filter(i => {
    const state = (i.download_state || '').toLowerCase();
    return (
      state === 'completed' ||
      state === 'seeding' ||       // torrent still seeding but download is done
      state === 'cached' ||        // instant download from cache
      state === 'finalized' ||
      i.download_finished === true ||
      i.download_present === true  // file is present/available
    );
  });
  console.log(`[TorBox] Completed items: ${completed.length}`);
  if (completed.length > 0) {
    console.log(`[TorBox] Sample item name:`, completed[0].name || completed[0].filename);
  }
  return completed;
}
/**
 * Get a direct stream link for a specific file.
 */
async function getTorBoxStreamLink(apiKey, source, itemId, fileId) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const endpoint = source === 'torrent'
    ? `${TORBOX_BASE}/torrents/requestdl`
    : `${TORBOX_BASE}/usenet/requestdl`;
  const params = source === 'torrent'
    ? { token: apiKey, torrent_id: itemId, file_id: fileId, zip_link: false }
    : { token: apiKey, usenet_id: itemId,  file_id: fileId, zip_link: false };
  const res = await axios.get(endpoint, { headers, params });
  return res.data?.data || null;
}
/**
 * List files inside a TorBox download item.
 */
async function getTorBoxFiles(apiKey, source, itemId) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  try {
    const endpoint = source === 'torrent'
      ? `${TORBOX_BASE}/torrents/mylist`
      : `${TORBOX_BASE}/usenet/mylist`;
    const res = await axios.get(endpoint, {
      headers,
      params: { id: itemId, bypass_cache: true },
    });
    // API returns single item when id is specified
    const data = res.data?.data;
    const item = Array.isArray(data) ? data[0] : data;
    return item?.files || [];
  } catch (err) {
    console.error(`[TorBox] Files error for ${itemId}:`, err.message);
    return [];
  }
}
const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.wmv', '.webm'];
function isVideoFile(name = '') {
  return VIDEO_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}
module.exports = { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile };
