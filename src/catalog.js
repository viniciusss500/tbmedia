import { fetchTorbox } from "./torbox.js";
import { parseFilename } from "./parser.js";
import { buildMeta } from "./builder.js";

export async function getCatalog(type, id, req) {

  const config = JSON.parse(Buffer.from(req.params.config, "base64").toString());

  const tmdbApiKey = config.tmdbApiKey;
  const lang = config.lang || "pt-BR";

  console.log(`[Catalog] type=${id} lang=${lang}`);

  const items = await fetchTorbox(config);

  const metas = [];

  for (const item of items) {

    const info = parseFilename(item.name);

    if (!info.title) continue;

    const meta = await buildMeta(info, type, tmdbApiKey, lang);

    if (!meta) continue;

    metas.push(meta);

    if (metas.length >= 100) break;
  }

  return metas;
}
