/** Voyage AI embeddings, shared by the KB and the code index. */

export interface EmbeddingModel {
  name: string;
  dimension: number; // must match the vector index in firestore.indexes.json
}

export const KB_EMBEDDINGS: EmbeddingModel = { name: 'voyage-3.5-lite', dimension: 1024 };
export const CODE_EMBEDDINGS: EmbeddingModel = { name: 'voyage-code-4', dimension: 1024 };
const RERANK_MODEL = 'rerank-2.5-lite';

const RETRY_DELAYS_MS = [2000, 8000];

async function postWithRetry(apiKey: string, path: string, payload: unknown): Promise<Response> {
  const request = () =>
    fetch(`https://api.voyageai.com/v1/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
  let res = await request();
  // Rate limits and server errors pass quickly; anything else won't change on a retry.
  for (const delay of RETRY_DELAYS_MS) {
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    res = await request();
  }
  if (!res.ok) throw new Error(`Voyage ${path} ${res.status}: ${await res.text()}`);
  return res;
}

export async function embed(
  apiKey: string,
  model: EmbeddingModel,
  texts: string[],
  inputType: 'document' | 'query',
): Promise<number[][]> {
  const res = await postWithRetry(apiKey, 'embeddings', {
    model: model.name,
    input: texts,
    input_type: inputType,
    output_dimension: model.dimension,
  });
  const body = (await res.json()) as { data: { embedding: number[] }[] };
  return body.data.map((d) => d.embedding);
}

/** Scores documents against a query, best first, as `{ index, score }` into `documents`. */
export async function rerank(
  apiKey: string,
  query: string,
  documents: string[],
  topK: number,
): Promise<{ index: number; score: number }[]> {
  const res = await postWithRetry(apiKey, 'rerank', { model: RERANK_MODEL, query, documents, top_k: topK });
  const body = (await res.json()) as { data: { index: number; relevance_score: number }[] };
  return body.data.map((d) => ({ index: d.index, score: d.relevance_score }));
}
