const axios = require('axios');

const TMDB_BASE  = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';

function tmdbAuth(apiKey) {
  if (!apiKey) return { headers: {}, params: {} };
  if (apiKey.startsWith('eyJ')) {
    return { headers: { Authorization: `Bearer ${apiKey}` }, params: {} };
  }
  return { headers: {}, params: { api_key: apiKey } };
}

/**
 * Converte IMDB ID (tt1234567) → { tmdbId, type }
 * Usado quando outros catálogos passam IDs do IMDB para o handler de stream.
 */
async function imdbToTmdb(apiKey, imdbId) {
  const auth = tmdbAuth(apiKey);
  try {
    const res = await axios.get(`${TMDB_BASE}/find/${imdbId}`, {
      headers: auth.headers,
      params: { ...auth.params, external_source: 'imdb_id' },
    });
    const data = res.data;
    if (data.movie_results?.length > 0) {
      return { tmdbId: data.movie_results[0].id, type: 'movie' };
    }
    if (data.tv_results?.length > 0) {
      return { tmdbId: data.tv_results[0].id, type: 'series' };
    }
    return null;
  } catch {
    return null;
  }
}

async function searchMetadata(apiKey, query, type, year, lang = 'pt-BR') {
  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const auth = tmdbAuth(apiKey);
  const region = lang.split('-')[1] || 'BR';
  const params = { ...auth.params, query, language: lang, region, page: 1 };
  if (year) params.year = year;

  const res = await axios.get(`${TMDB_BASE}${endpoint}`, {
    headers: auth.headers,
    params,
  });

  return res.data?.results?.[0] || null;
}

async function getMetadata(apiKey, tmdbId, type, lang = 'pt-BR') {
  const endpoint = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const auth = tmdbAuth(apiKey);
  const baseParams = { ...auth.params, language: lang };

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

  const langCode    = lang.split('-')[0];
  const localPoster = detail.images?.posters?.find(p => p.iso_639_1 === langCode);
  if (localPoster) poster = `${TMDB_IMAGE}/w500${localPoster.file_path}`;

  const genres  = (detail.genres || []).map(g => g.name);
  const videos  = detail.videos?.results || [];
  const trailer =
    videos.find(v => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === langCode) ||
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

async function getSeasonEpisodes(apiKey, tmdbId, seasonNumber, lang = 'pt-BR') {
  const auth = tmdbAuth(apiKey);
  const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${seasonNumber}`, {
    headers: auth.headers,
    params: { ...auth.params, language: lang },
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

module.exports = { searchMetadata, getMetadata, getSeasonEpisodes, imdbToTmdb };
