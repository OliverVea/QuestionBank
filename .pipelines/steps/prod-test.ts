import { implement, step, HelmRelease } from "@olivervea/pipelines";
import { check, checkSpa, health, serviceUrl } from "../lib/checks";

// Read-only, so it is safe against prod.
export const prodTest = implement(step({
  name: "prod-test",
  description: "Read-only smoke test of prod: health, that the API needs a token, and the SPA.",
  image: "alpine:3.22",
  input: { release: HelmRelease },
  timeoutSeconds: 180,
}), async ({ release }, ctx) => {
  const url = serviceUrl(release);
  const h = await health(ctx, url);
  check(h.status === "ok" && h.mode === undefined, `/api/health answered ${JSON.stringify(h)}`);
  const books = await ctx.http.fetch(`${url}/api/books`);
  check(books.status === 401, `an anonymous GET /api/books answered ${books.status}, expected 401`);
  await checkSpa(ctx, url);
  ctx.log("prod smoke test passed", { url });
});
