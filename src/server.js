import { catalogCache } from "./cache.js";

app.get("/catalog/:type/:id.json", async (req, res) => {

  const cacheKey = req.originalUrl;

  const cached = catalogCache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }

const result = await getCatalog(req);
  
  catalogCache.set(cacheKey, result);

  res.json(result);

});
