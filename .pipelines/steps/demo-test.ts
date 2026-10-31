import { implement, step, HelmRelease } from "@olivervea/pipelines";
import { SSH_PRIVATE_KEY } from "../shared";
import { check, checkSpa, health, serviceUrl } from "../lib/checks";
import { connect } from "../lib/ssh";

const CREDENTIALS = ["ANTHROPIC_API_KEY", "FIGURE_SERVICE_API_KEY"];

// The demo is public, so it must hold no credentials.
export const demoTest = implement(step({
  name: "demo-test",
  description: "Read-only check of the demo: it runs in demo mode, serves the SPA, and its pod has no credentials in its environment.",
  image: "alpine:3.22",
  input: { release: HelmRelease },
  secrets: [SSH_PRIVATE_KEY],
  timeoutSeconds: 300,
}), async ({ release }, ctx) => {
  const url = serviceUrl(release);
  const h = await health(ctx, url);
  check(h.mode === "demo", `/api/health answered ${JSON.stringify(h)}, expected demo mode`);
  await checkSpa(ctx, url);

  const ssh = await connect(ctx, ctx.secrets.SSH_PRIVATE_KEY);
  const names = (await ssh.text(`kubectl -n ${release.namespace} get deploy ${release.release} -o jsonpath='{.spec.template.spec.containers[*].env[*].name}'`)).split(/\s+/);
  const leaked = CREDENTIALS.filter(n => names.includes(n));
  check(leaked.length === 0, `the demo pod gets ${leaked.join(", ")}`);
  ctx.log("demo check passed", { url });
});
