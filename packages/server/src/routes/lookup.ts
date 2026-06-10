import { Router } from 'express';
import { lookupIsbn, type IsbnFetcher } from '../services/isbn-lookup.js';

/**
 * /api/lookup — read-only external-catalog reads (not CRUD). The fetcher is injectable so
 * tests run offline; production uses the default Open Library fetcher.
 */
export function lookupRouter(fetcher?: IsbnFetcher): Router {
  const router = Router();

  router.get('/isbn/:isbn', async (req, res) => {
    let metadata;
    try {
      metadata = await lookupIsbn(req.params.isbn, fetcher);
    } catch {
      res.status(502).json({ error: 'lookup failed' });
      return;
    }
    if (!metadata) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(metadata);
  });

  return router;
}
