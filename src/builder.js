import NodeCache from "node-cache";
import { searchMetadata } from "./tmdb.js";

const matchCache = new NodeCache({ stdTTL: 86400 });

export async function buildMeta(info, type, tmdbApiKey, lang) {
  const cacheKey = `${info.title}:${info.year}:${type}`;

  const cached = matchCache.get(cacheKey);
  if (cached) return cached;

  const tmdbType = type === "movie" ? "movie" : "tv";

  const result = await searchMetadata(
    tmdbApiKey,
    info.title,
    tmdbType,
    info.year,
    lang
  );

  if (!result) {
    matchCache.set(cacheKey, null);
    return null;
  }

  // NÃO excluir anime
  if (result.isJapaneseAnimation) {
    console.log(`[TMDB] "${info.title}" detectado como anime`);
  }

  const meta = {
    id: `tmdb:${result.id}`,
    type,
    name: result.title
  };

  matchCache.set(cacheKey, meta);

  return meta;
}
