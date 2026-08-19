# Ask-your-Vault (AI/RAG) — system design

Semantic question-answering over everything the user saved, with numbered citations. pgvector replaces the frontend's term-overlap retrieval.

## Data

`embeddings(item_id, chunk, model, vector VECTOR(768))` — one row per ~800-char chunk (title+meta+tags is always chunk 0). Cascade-deleted with the item; trashed items are excluded at query time.

## Pipeline

```mermaid
flowchart LR
  A[item created/updated] -->|enqueue embed_item| Q[(Redis)]
  Q --> W[ARQ worker]
  W --> C[chunk: title+meta+tags, blocks ×800 chars]
  C --> E[embed_texts]
  E -->|EMBEDDINGS_URL set| P[any OpenAI-compatible /embeddings<br/>Ollama · Together · OpenAI]
  E -->|unset (dev)| H[deterministic hash embedder]
  E --> V[(pgvector)]
  U[POST /ai/ask] --> V
  V -->|cosine distance ORDER BY, top-k| S[sources + scores]
  S --> PR[numbered-citation prompt]
```

## API

| Endpoint | Purpose |
|---|---|
| `POST /ai/reindex` | queue every item for embedding (after /sync/import); falls back to inline indexing when Redis is absent |
| `POST /ai/ask {question,k}` | top-k cosine retrieval → `{sources[], prompt}` |

**v0 contract:** the server returns *sources + assembled prompt* and the frontend completes with the user's own key (Claude or open-source — unchanged UX). **Phase 3** moves completion server-side behind the key vault (Secrets Manager on AWS), enabling usage metering and Bedrock as a third provider.

## Design notes

- Provider-agnostic embeddings: any OpenAI-compatible endpoint via env (`EMBEDDINGS_URL`, 768-dim default matches `nomic-embed-text`). The hash fallback keeps dev/test self-contained and was used to verify the full pipeline (Redis → worker → pgvector → ranked, cited sources).
- Index upgrade path: exact scan now → `HNSW (vector_cosine_ops)` once chunks exceed ~100k.
- Citations map 1:1 to `item_id`, so the frontend's clickable [n] chips keep working.
