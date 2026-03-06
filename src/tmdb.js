import axios from "axios";
import NodeCache from "node-cache";

const tmdbCache = new NodeCache({ stdTTL: 86400 }); // 24h

export async function searchMetadata(apiKey, title, type, year, lang = "pt-BR") {
  const cacheKey = `${title}:${year}:${type}`;

  const cached = tmdbCache.get(cacheKey);
  if (cached) return cached;

  try {
    const endpoint =
      type === "movie"
        ? "https://api.themoviedb.org/3/search/movie"
        : "https://api.themoviedb.org/3/search/tv";

    const res = await axios.get(endpoint, {
      params: {
        api_key: apiKey,
        query: title,
        year,
        language: lang
      }
    });

    const result = res.data.results?.[0];
    if (!result) return null;

    const isAnimation = (result.genre_ids || []).includes(16);

    const isJapaneseAnimation =
      isAnimation &&
      (result.original_language === "ja" ||
        result.origin_country?.includes("JP"));

    const metadata = {
      id: result.id,
      title: result.title || result.name,
      year:
        result.release_date?.split("-")[0] ||
        result.first_air_date?.split("-")[0],
      isJapaneseAnimation
    };

    tmdbCache.set(cacheKey, metadata);

    return metadata;
  } catch (err) {
    console.log("[TMDB ERROR]", err.message);
    return null;
  }
}
