/** Fixed model contract. Changing any encoding/chunking field requires a new key. */
export const HISTORY_EMBEDDING_MODEL = {
  id: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  key: "multilingual-e5-small:761b726dd34fb83930e26aab4e9ac3899aa1fa78:q8:mean-l2:c384-o64:v1",
  dimensions: 384,
  maxTokens: 512,
  chunkTokens: 384,
  overlapTokens: 64,
  queryPrefix: "query: ",
  passagePrefix: "passage: ",
  license: "MIT",
} as const;
