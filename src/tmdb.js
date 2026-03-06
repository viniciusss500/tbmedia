const axios = require('axios');

const TMDB_BASE  = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';

function tmdbAuth(apiKey) {
  if (!apiKey) return { headers: {}, params: {} };
  if (apiKey.startsWith('eyJ')) return { headers: { Authorization: `Bearer ${apiKey}` }, params: {} };
  return { headers: {}, params: { api_key: apiKey } };
}

// Converte IMDB ID → { tmdbId, type }
async function imdbToTmdb(apiKey, imdbId) {
  const auth = tmdbAuth(apiKey);
  try {
    const res = await axios.get(`${TMDB_BASE}/find/${imdbId}`, {
      headers: auth.headers,
      params: { ...auth.params, external_source: 'imdb_id' },
    });
    const d = res.data;
    if (d.movie_results?.length > 0) return { tmdbId: d.movie_results[0].id, type: 'movie' };
    if (d.tv_results?.length > 0)    return { tmdbId: d.tv_results[0].id,    type: 'series' };
    return null;
  } catch { return null; }
}

/**
 * Busca metadata no TMDB.
 * Retorna resultado com `isJapaneseAnimation` — usado pelo builder para
 * separar anime de séries de forma confiável, independente do nome do arquivo.
 */
async function searchMetadata(apiKey, query, type, year, lang = 'pt-BR') {
  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const auth   = tmdbAuth(apiKey);
  const region = lang.split('-')[1] || 'BR';
  const params = { ...auth.params, query, language: lang, region, page: 1 };
  if (year) params.year = year;

  const res = await axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params });
  const result = res.data?.results?.[0];
  if (!result) return null;

  // Detectar anime de forma confiável: idioma original japonês + gênero Animation (id=16)
  result.isJapaneseAnimation =
    result.original_language === 'ja' &&
    (result.genre_ids || []).includes(16);

  return result;
}

async function fetchSeasonVideos(auth, tmdbId, season, lang, fallbackPoster) {
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${season.season_number}`, {
      headers: auth.headers,
      params: { ...auth.params, language: lang },
    });
    const eps = res.data?.episodes || [];
    return eps.map(ep => ({
      id:        `torbox:series:${tmdbId}:${season.season_number}:${ep.episode_number}`,
      title:     ep.name || `Episódio ${ep.episode_number}`,
      season:    season.season_number,
      episode:   ep.episode_number,
      overview:  ep.overview || '',
      thumbnail: ep.still_path
        ? `${TMDB_IMAGE}/w300${ep.still_path}`
        : (season.poster_path ? `${TMDB_IMAGE}/w300${season.poster_path}` : fallbackPoster),
      released:  ep.air_date ? new Date(ep.air_date).toISOString() : undefined,
      rating:    ep.vote_average?.toFixed(1),
    }));
  } catch {
    // Fallback: só o card da temporada
    return [{
      id:      `torbox:series:${tmdbId}:${season.season_number}:1`,
      title:   season.name || `Temporada ${season.season_number}`,
      season:  season.season_number,
      episode: 1,
      poster:  season.poster_path ? `${TMDB_IMAGE}/w500${season.poster_path}` : fallbackPoster,
      released: season.air_date ? new Date(season.air_date).toISOString() : undefined,
    }];
  }
}

async function getMetadata(apiKey, tmdbId, type, lang = 'pt-BR') {
  const endpoint = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const auth = tmdbAuth(apiKey);
  const baseParams = { ...auth.params, language: lang };

  const [detailRes, creditsRes, externalRes] = await Promise.allSettled([
    axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params: { ...baseParams, append_to_response: 'videos,images' } }),
    axios.get(`${TMDB_BASE}${endpoint}/credits`, { headers: auth.headers, params: baseParams }),
    axios.get(`${TMDB_BASE}${endpoint}/external_ids`, { headers: auth.headers, params: auth.params }),
  ]);

  const detail   = detailRes.status   === 'fulfilled' ? detailRes.value.data   : null;
  const credits  = creditsRes.status  === 'fulfilled' ? creditsRes.value.data  : null;
  const external = externalRes.status === 'fulfilled' ? externalRes.value.data : null;
  if (!detail) return null;

  const imdbId    = external?.imdb_id || null;
  const cast      = (credits?.cast || []).slice(0, 8).map(c => c.name);
  const directors = type === 'movie'
    ? (credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name)
    : (detail.created_by || []).map(c => c.name);

  let poster     = detail.poster_path   ? `${TMDB_IMAGE}/w500${detail.poster_path}`    : null;
  let background = detail.backdrop_path ? `${TMDB_IMAGE}/w1280${detail.backdrop_path}` : null;
  const langCode = lang.split('-')[0];
  const lp = detail.images?.posters?.find(p => p.iso_639_1 === langCode);
  if (lp) poster = `${TMDB_IMAGE}/w500${lp.file_path}`;

  const genres  = (detail.genres || []).map(g => g.name);
  const vids    = detail.videos?.results || [];
  const trailer = vids.find(v => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === langCode)
               || vids.find(v => v.type === 'Trailer' && v.site === 'YouTube');

  if (type === 'movie') {
    return {
      id: `torbox:movie:${tmdbId}`, tmdbId, imdbId,
      type: 'movie',
      name: detail.title || detail.original_title,
      year: detail.release_date?.split('-')[0],
      poster, background,
      description: detail.overview,
      runtime: detail.runtime ? `${detail.runtime} min` : undefined,
      genres, cast, director: directors,
      trailerStreams: trailer ? [{ title: 'Trailer', ytId: trailer.key }] : [],
      releaseInfo: detail.release_date?.split('-')[0],
      released: detail.release_date ? new Date(detail.release_date).toISOString() : undefined,
      imdbRating: detail.vote_average?.toFixed(1),
      links: imdbId ? [{ name: 'IMDB', category: 'imdb', url: `https://www.imdb.com/title/${imdbId}` }] : [],
    };
  } else {
    // Buscar episódios de cada temporada em paralelo
    const rawSeasons = (detail.seasons || []).filter(s => s.season_number > 0);
    const episodeLists = await Promise.all(
      rawSeasons.map(s => fetchSeasonVideos(auth, tmdbId, s, lang, poster))
    );
    const videos = episodeLists.flat();

    return {
      id: `torbox:series:${tmdbId}`, tmdbId, imdbId,
      type: 'series',
      name: detail.name || detail.original_name,
      year: detail.first_air_date?.split('-')[0],
      poster, background,
      description: detail.overview,
      genres, cast, director: directors,
      trailerStreams: trailer ? [{ title: 'Trailer', ytId: trailer.key }] : [],
      releaseInfo: detail.first_air_date?.split('-')[0],
      released: detail.first_air_date ? new Date(detail.first_air_date).toISOString() : undefined,
      imdbRating: detail.vote_average?.toFixed(1),
      videos,
      links: imdbId ? [{ name: 'IMDB', category: 'imdb', url: `https://www.imdb.com/title/${imdbId}` }] : [],
      status: detail.status,
    };
  }
}

module.exports = { searchMetadata, getMetadata, imdbToTmdb };
