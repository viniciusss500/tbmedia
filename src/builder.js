// ─── STREAMS (OTIMIZADO) ──────────────────────────────────────────────────────
const NodeCache = require('node-cache');

const streamCache = new NodeCache({ stdTTL: 3600 }); // cache de links
const filesCache  = new NodeCache({ stdTTL: 3600 }); // cache de arquivos

async function buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode, lang) {
  const indexKey = `${type === 'anime' ? 'series' : type}:${tmdbId}`;
  let entries    = tmdbindex.get(indexKey);

  if (!entries || entries.length === 0) {
    console.log(`[Stream] ❌ Sem índice para ${indexKey} → abortando`);
    return []; // 🚫 NÃO reconstruir downloads (economia massiva)
  }

  // ── Filtrar episódios ───────────────────────────────────────────────────────
  let filtered = entries;

  if (type === 'series' || type === 'anime') {
    filtered = entries.filter(({ season: s, episode: e }) => {
      if (season && s && String(s) !== String(season)) return false;
      if (episode && e && String(e) !== String(episode)) return false;
      return true;
    });
  }

  if (!filtered.length) return [];

  console.log(`[Stream] ${filtered.length} entries após filtro`);

  // ── Coletar streams (LIMITADO + CACHE) ──────────────────────────────────────
  const rawStreams = [];
  const MAX_STREAMS = 5;

  for (const { item } of filtered) {
    if (rawStreams.length >= MAX_STREAMS) break;

    const filesKey = `files:${item.id}`;
    let files = filesCache.get(filesKey);

    if (!files) {
      files = await getTorBoxFiles(torboxApiKey, item.source, item.id);
      filesCache.set(filesKey, files);
    }

    const videoFiles = files.filter(f => isVideoFile(f.name || f.short_name));

    for (const file of videoFiles.slice(0, 3)) { // limita por item
      if (rawStreams.length >= MAX_STREAMS) break;

      const cacheKey = `stream:${item.id}:${file.id}`;
      let url = streamCache.get(cacheKey);

      if (!url) {
        url = await getTorBoxStreamLink(torboxApiKey, item.source, item.id, file.id);
        if (url) streamCache.set(cacheKey, url);
      }

      if (!url) continue;

      rawStreams.push({
        url,
        fname: file.name || file.short_name || item.name,
        size: file.size || 0,
        source: item.source
      });
    }
  }

  if (!rawStreams.length) return [];

  // ── Ordenação ───────────────────────────────────────────────────────────────
  const langCode = (lang || 'pt-BR').split('-')[0].toLowerCase();

  rawStreams.sort((a, b) => {
    const dl = langScore(b.fname, langCode) - langScore(a.fname, langCode);
    if (dl !== 0) return dl;
    const dq = qualityScore(b.fname) - qualityScore(a.fname);
    if (dq !== 0) return dq;
    return b.size - a.size;
  });

  return rawStreams.map(({ url, fname, size, source }) => ({
    url,
    name: formatStreamName(fname),
    description: formatStreamDesc(fname, size, source),
    behaviorHints: { notWebReady: false },
  }));
}
