import { httpHealthCheck, type Ctx } from "@olivervea/pipelines";

export { checkSpa, serviceUrl } from "@olivervea/pipelines";

export function check(ok: boolean, what: string): asserts ok {
  if (!ok) throw new Error(`check failed: ${what}`);
}

export async function health(ctx: Ctx, url: string) {
  await httpHealthCheck(ctx, `${url}/api/health`, { attempts: 6, delaySeconds: 5 });
  return ctx.http.getJson<{ status?: string; mode?: string }>(`${url}/api/health`);
}
