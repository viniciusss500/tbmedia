export function parseFilename(name) {
  const clean = name.replace(/\./g, " ");

  const seasonEpisode = clean.match(/S(\d+)E(\d+)/i);
  const episodeOnly = clean.match(/\b(\d{2,3})\b/);

  const animeIndicators = [
    /SubsPlease/i,
    /Erai-raws/i,
    /\[.*?\]/,
    /1080p/i,
    /720p/i
  ];

  const isAnime = animeIndicators.some(r => r.test(name));

  let season = null;
  let episode = null;

  if (seasonEpisode) {
    season = Number(seasonEpisode[1]);
    episode = Number(seasonEpisode[2]);
  } else if (isAnime && episodeOnly) {
    season = 1;
    episode = Number(episodeOnly[1]);
  }

  const title = clean
    .replace(/\[.*?\]/g, "")
    .replace(/S\d+E\d+/i, "")
    .replace(/\b\d{3,4}p\b/i, "")
    .trim();

  return {
    title,
    season,
    episode,
    isAnime
  };
}
