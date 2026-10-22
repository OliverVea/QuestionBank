import { implement } from "@olve/pipelines";
import { demoTest } from "../pipeline";
import { check, checkSpa, health, serviceUrl } from "./lib/checks";
import { connect } from "./lib/ssh";

const CREDENTIALS = ["ANTHROPIC_API_KEY", "FIGURE_SERVICE_API_KEY"];

// The demo is public, so it must hold no credentials.
export default implement(demoTest, async ({ release }, ctx) => {
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
