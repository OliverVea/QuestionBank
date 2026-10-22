import { httpHealthCheck, type Ctx, type HelmRelease, type Infer } from "@olve/pipelines";

export function check(ok: boolean, what: string): asserts ok {
  if (!ok) throw new Error(`check failed: ${what}`);
}

export const serviceUrl = ({ release, namespace }: Infer<typeof HelmRelease>) =>
  `http://${release}.${namespace}.svc.cluster.local`;

export async function health(ctx: Ctx, url: string) {
  await httpHealthCheck(ctx, `${url}/api/health`, { attempts: 6, delaySeconds: 5 });
  return ctx.http.getJson<{ status?: string; mode?: string }>(`${url}/api/health`);
}

export async function checkSpa(ctx: Ctx, url: string) {
  const html = await (await ctx.http.expectOk(`${url}/`)).text();
  const bundle = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  check(bundle !== undefined, "/ does not reference the SPA bundle");
  const js = await ctx.http.expectOk(`${url}${bundle}`);
  check(js.headers.get("content-type")?.includes("javascript") ?? false, `${bundle} is not served as JavaScript`);
}
