const axios = require('axios');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';
const LANG = 'pt-BR';
const REGION = 'BR';

/**
 * TMDB aceita dois tipos de chave:
 *   - API Key v3 (32 chars hex): passa como ?api_key=XXX
 *   - Read Access Token v4 (JWT começando com "eyJ"): passa como Bearer
 *
 * Detectamos automaticamente e usamos o método correto para evitar 401.
 */
function tmdbAuth(apiKey) {
  if (!apiKey) return { headers: {}, params: {} };
  if (apiKey.startsWith('eyJ')) {
    // Token v4 (JWT)
    return { headers: { Authorization: `Bearer ${apiKey}` }, params: {} };
  }
  // API Key v3 (hex)
  return { headers: {}, params: { api_key: apiKey } };
}

/**
 * Search for a movie or TV show by name. Returns the best match.
 */
async function searchMetadata(apiKey, query, type, year) {
  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const auth = tmdbAuth(apiKey);
  const params = { ...auth.params, query, language: LANG, region: REGION, page: 1 };
  if (year) params.year = year;

  const res = await axios.get(`${TMDB_BASE}${endpoint}`, {
    headers: auth.headers,
    params,
  });

  const results = res.data?.results || [];
  return results[0] || null;
}

/**
 * Get full metadata for a movie or TV show by TMDB id.
 */
async function getMetadata(apiKey, tmdbId, type) {
  const endpoint = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const auth = tmdbAuth(apiKey);
  const baseParams = { ...auth.params, language: LANG };

  const [detailRes, creditsRes, externalRes] = await Promise.allSettled([
    axios.get(`${TMDB_BASE}${endpoint}`, {
      headers: auth.headers,
      params: { ...baseParams, append_to_response: 'videos,images' },
    }),
    axios.get(`${TMDB_BASE}${endpoint}/credits`, {
      headers: auth.headers,
      params: baseParams,
    }),
    axios.get(`${TMDB_BASE}${endpoint}/external_ids`, {
      headers: auth.headers,
      params: auth.params,
    }),
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

  // Preferir pôster em PT-BR se disponível
  const ptPoster = detail.images?.posters?.find(p => p.iso_639_1 === 'pt');
  if (ptPoster) poster = `${TMDB_IMAGE}/w500${ptPoster.file_path}`;

  const genres = (detail.genres || []).map(g => g.name);

  // Trailer PT-BR ou EN
  const videos = detail.videos?.results || [];
  const trailer =
    videos.find(v => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === 'pt') ||
    videos.find(v => v.type === 'Trailer' && v.site === 'YouTube');

  if (type === 'movie') {
    return {
      id: `torbox:movie:${tmdbId}`,
      tmdbId, imdbId,
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
    const seasons = (detail.seasons || [])
      .filter(s => s.season_number > 0)
      .map(s => ({
        id: `torbox:series:${tmdbId}:${s.season_number}`,
        type: 'series',
        name: s.name || `Temporada ${s.season_number}`,
        season: s.season_number,
        episode: 1,
        poster: s.poster_path ? `${TMDB_IMAGE}/w500${s.poster_path}` : poster,
        overview: s.overview,
        released: s.air_date ? new Date(s.air_date).toISOString() : undefined,
        releaseInfo: s.air_date?.split('-')[0],
      }));

    return {
      id: `torbox:series:${tmdbId}`,
      tmdbId, imdbId,
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
      videos: seasons,
      links: imdbId ? [{ name: 'IMDB', category: 'imdb', url: `https://www.imdb.com/title/${imdbId}` }] : [],
      status: detail.status,
    };
  }
}

/**
 * Get episodes for a specific season.
 */
async function getSeasonEpisodes(apiKey, tmdbId, seasonNumber) {
  const auth = tmdbAuth(apiKey);
  const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${seasonNumber}`, {
    headers: auth.headers,
    params: { ...auth.params, language: LANG },
  });

  return (res.data?.episodes || []).map(ep => ({
    id: `torbox:series:${tmdbId}:${seasonNumber}:${ep.episode_number}`,
    title: ep.name || `Episódio ${ep.episode_number}`,
    season: seasonNumber,
    episode: ep.episode_number,
    overview: ep.overview,
    thumbnail: ep.still_path ? `${TMDB_IMAGE}/w300${ep.still_path}` : null,
    released: ep.air_date ? new Date(ep.air_date).toISOString() : undefined,
    rating: ep.vote_average?.toFixed(1),
  }));
}

module.exports = { searchMetadata, getMetadata, getSeasonEpisodes };
