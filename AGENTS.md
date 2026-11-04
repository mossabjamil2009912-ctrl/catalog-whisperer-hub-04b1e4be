<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Assistant retrieval is hybrid: AI question-understanding + pgvector embeddings (catalog_chunks.embedding, catalog_profiles) + trigram search + model-number match, fused with RRF (src/lib/rank.ts); why: users ask in any dialect/language and by function or specs. Re-run `scripts/index_catalogs.py chunks|profiles` to fill missing vectors/profiles.
- Serve Android Digital Asset Links as static JSON at public/.well-known/assetlinks.json using the supplied signing identity; TWA verification requires a same-origin, publicly accessible file rather than a CDN pointer.
