import { getCachedCatalog } from "./cache/catalogCache.js";
import express from "express";
import cors from "cors";
import NodeCache from "node-cache";

import { getCatalog } from "./catalog.js";
import { getStreams } from "./streams.js";
import { getMeta } from "./meta.js";

const app = express();
app.use(cors());

const catalogCache = new NodeCache({ stdTTL: 300 }); // 5 minutos
const streamCache = new NodeCache({ stdTTL: 1800 }); // 30 minutos

app.get("/", (req, res) => {
  res.redirect("/configure");
});

app.get("/configure", (req, res) => {
  res.send("TBMedia addon running");
});

/*
CATALOG
*/
app.get("/:config/catalog/:type/:id.json", async (req, res) => {
  const cacheKey = req.originalUrl;

  const cached = catalogCache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const { type, id } = req.params;

    console.log(`[Catalog] type=${id}`);

    const metas = await getCachedCatalog(type, id, req);

    const response = { metas };

    catalogCache.set(cacheKey, response);

    res.json(response);
  } catch (err) {
    console.error("[Catalog] Error:", err);

    res.json({ metas: [] });
  }
});

/*
META
*/
app.get("/:config/meta/:type/:id.json", async (req, res) => {
  try {
    const meta = await getMeta(req);

    res.json({ meta });
  } catch (err) {
    console.error("[Meta] Error:", err);

    res.json({ meta: null });
  }
});

/*
STREAM
*/
app.get("/:config/stream/:type/:id.json", async (req, res) => {
  const cacheKey = req.originalUrl;

  const cached = streamCache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const streams = await getStreams(req);

    const response = { streams };

    streamCache.set(cacheKey, response);

    res.json(response);
  } catch (err) {
    console.error("[Streams] Error:", err);

    res.json({ streams: [] });
  }
});

export default app;
