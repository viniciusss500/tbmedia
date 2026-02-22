/**
 * Smart media filename parser.
 * Handles common torrent naming conventions like:
 *   Movie.Name.2023.1080p.BluRay.mkv
 *   Series.Name.S02E05.720p.WEB-DL.mkv
 *   [Group] Anime Name - 12 [1080p].mkv
 */

const SERIES_PATTERN = /[Ss](\d{1,2})[Ee](\d{1,2})/;
const YEAR_PATTERN = /\b(19[89]\d|20[012]\d)\b/;
const QUALITY_WORDS = [
  '4k', 'uhd', '2160p', '1080p', '720p', '480p', '360p',
  'bluray', 'blu-ray', 'bdrip', 'brrip',
  'webrip', 'web-rip', 'webdl', 'web-dl', 'hdtv',
  'dvdrip', 'dvd', 'cam', 'ts', 'hdrip', 'hdr',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc',
  'aac', 'dts', 'ac3', 'eac3', 'truehd', 'atmos',
  'remux', 'encode', 'proper', 'repack', 'extended',
  'yts', 'yify', 'rarbg', 'ion10',
];

function cleanTitle(raw) {
  // Replace dots and underscores with spaces
  let title = raw.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();

  // Remove common junk at the end
  title = title.replace(/\[.*?\]/g, '').trim();
  title = title.replace(/\(.*?\)/g, '').trim();

  return title;
}

function guessMediaInfo(filename) {
  if (!filename || filename.length < 3) return null;

  // Strip extension
  let name = filename.replace(/\.[a-zA-Z0-9]{2,4}$/, '');

  // Check if it's a series (S01E01 pattern)
  const seriesMatch = name.match(SERIES_PATTERN);
  const isSeries = !!seriesMatch;

  let season = null;
  let episode = null;
  let titleRaw = name;

  if (seriesMatch) {
    season = parseInt(seriesMatch[1], 10);
    episode = parseInt(seriesMatch[2], 10);
    // Title is everything before the SxxExx marker
    titleRaw = name.substring(0, seriesMatch.index);
  }

  // Extract year
  const yearMatch = titleRaw.match(YEAR_PATTERN);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  // Remove year from title
  if (year) {
    titleRaw = titleRaw.replace(new RegExp(`\\b${year}\\b`), '');
  }

  // Remove quality keywords and group tags
  let cleanedTitle = titleRaw;
  for (const word of QUALITY_WORDS) {
    cleanedTitle = cleanedTitle.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
  }

  // Clean up the title
  let title = cleanTitle(cleanedTitle).replace(/\s{2,}/g, ' ').trim();

  // Remove trailing/leading dashes or special chars
  title = title.replace(/^[-\s]+|[-\s]+$/g, '').trim();

  if (!title || title.length < 2) return null;

  // Normalize capitalization (Title Case)
  title = title
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return { title, year, isSeries, season, episode };
}

module.exports = { guessMediaInfo };
