import NodeCache from "node-cache";
import { getCatalog } from "../catalog.js";

const cache = new NodeCache({
  stdTTL: 300,
  checkperiod: 120
});

export async function getCachedCatalog(type, id, req) {
  const key = `${type}:${id}`;

  const cached = cache.get(key);

  if (cached) {
    console.log("[Cache] HIT", key);
    return cached;
  }

  console.log("[Cache] MISS", key);

  try {
    const metas = await getCatalog(type, id, req);

    cache.set(key, metas);

    return metas;

  } catch (err) {

    console.error("[Cache] Erro:", err);

    return [];

  }
}
