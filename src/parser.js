/**
 * Parser de nomes de torrent/usenet.
 */

const YEAR_RE = /\b(19[5-9]\d|20[0-3]\d)\b/;
const EP_RE   = /[Ss](\d{1,2})[Ee](\d{1,2})/;
const S_RE    = /\b[Ss](\d{1,2})\b(?![Ee\d])/;

const TECH = [
  /\b(2160p|1080p|720p|480p|360p)\b/i,
  /\b(4k|uhd)\b/i,
  /\b(web[-\s]?dl|webdl|web[-\s]?rip|webrip|bluray|blu[-\s]?ray|bdrip|brrip|hdtv|hdrip|dvdrip|dvdscr|camrip|hdtc|hdcam)\b/i,
  /\b(x264|x265|h264|h\.?265|hevc|avc|xvid)\b/i,
  /\b(ddp?5[\s.]1|dd5[\s.]1|aac|ac3|eac3|dts|truehd|atmos|opus|flac)\b/i,
  /\b(hdr10?|dolby[\s.]?vision|sdr)\b/i,
  /\b(remux|proper|repack|extended)\b/i,
  /\b(dual|dublado|legendado|nacional|plsub|multi[-\s]?sub|multi[-\s]?audio)\b/i,
  /\b(amzn|nflx|hmax|dsnp|iqiyi|adn)\b/i,
];

function normalize(s) {
  return s.replace(/[._]/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function guessMediaInfo(raw) {
  if (!raw || raw.length < 3) return null;

  let name = raw.replace(/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i, '').trim();

  // Remove [Grupo] no início
  name = name.replace(/^\[[^\]]{1,50}\]\s*/, '').trim();
  // Remove www.site.com -
  name = name.replace(/^www\.\S+\s*[-–]+\s*/i, '').trim();
  // Remove WORD.TLD.. apenas quando TLD seguido por .. (ex: HIDRATORRENTS.ORG..)
  name = name.replace(/^[A-Z0-9_-]{4,}\.[A-Z]{2,4}(?=\.\.)/i, '').replace(/^[.\s-]+/, '').trim();

  const norm = normalize(name);

  // Detectar série
  const epMatch = norm.match(EP_RE);
  let isSeries = false, season = null, episode = null;
  let serieCut = norm.length;

  if (epMatch) {
    isSeries = true; season = parseInt(epMatch[1], 10); episode = parseInt(epMatch[2], 10);
    serieCut = epMatch.index;
  } else {
    const sm = norm.match(S_RE);
    if (sm) { isSeries = true; season = parseInt(sm[1], 10); serieCut = sm.index; }
  }

  // Corte técnico
  let techCut = norm.length;
  for (const re of TECH) {
    const m = norm.match(re);
    if (m && m.index < techCut) techCut = m.index;
  }

  // Corte pelo ano
  const ym = norm.match(YEAR_RE);
  let year = null;
  if (ym) { year = parseInt(ym[1], 10); if (ym.index < techCut) techCut = ym.index; }

  const cutIndex = Math.min(serieCut, techCut);
  let title = norm.substring(0, cutIndex);

  // 1. Remover parênteses completos: (alias)
  title = title.replace(/\s*\([^)]*\)/g, '');
  // 2. Remover colchetes completos: [info]
  title = title.replace(/\s*\[[^\]]*\]/g, '');
  // 3. Remover colchete/parêntese aberto sem fechar no final
  title = title.replace(/[\s([{]+$/, '').trim();
  // 4. Remover "- 02" de episódio anime numerado
  title = title.replace(/\s*[-–]\s*\d+\s*$/, '');
  // 5. Remover hífen solto no final
  title = title.replace(/[\s\-–]+$/, '').trim();
  title = title.replace(/\s{2,}/g, ' ').trim();

  if (!title || title.length < 2) return null;

  title = title.split(' ').filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return { title, year, isSeries, season, episode };
}

module.exports = { guessMediaInfo };
