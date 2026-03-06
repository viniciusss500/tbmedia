import NodeCache from "node-cache";

export const catalogCache = new NodeCache({
  stdTTL: 300
});

export const streamCache = new NodeCache({
  stdTTL: 1800
});
