import { implement } from "@olivervea/pipelines";
import { prodTest } from "../pipeline";
import { check, checkSpa, health, serviceUrl } from "./lib/checks";

// Read-only, so it is safe against prod.
export default implement(prodTest, async ({ release }, ctx) => {
  const url = serviceUrl(release);
  const h = await health(ctx, url);
  check(h.status === "ok" && h.mode === undefined, `/api/health answered ${JSON.stringify(h)}`);
  const books = await ctx.http.fetch(`${url}/api/books`);
  check(books.status === 401, `an anonymous GET /api/books answered ${books.status}, expected 401`);
  await checkSpa(ctx, url);
  ctx.log("prod smoke test passed", { url });
});
