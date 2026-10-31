import { implement, step, HelmRelease, Source } from "@olivervea/pipelines";
import { QB_BETA_OIDC_CLIENT_SECRET } from "../shared";
import { check, checkSpa, health, serviceUrl } from "../lib/checks";

// The suite writes (and deletes) books in the smoke client's own tenant, so it runs against beta only.
export const betaTest = implement(step({
  name: "beta-test",
  description: "Runs the beta test suite (`npm run test:beta`) against beta in-cluster with a token from beta Authentik, and checks the SPA is served.",
  image: "node:22",
  input: { source: Source, release: HelmRelease },
  secrets: [QB_BETA_OIDC_CLIENT_SECRET],
  timeoutSeconds: 900,
}), async ({ source, release }, ctx) => {
  const url = serviceUrl(release);
  const cwd = await ctx.files.fetch(source.tree);
  await ctx.exec(["npm", "ci", "--no-audit", "--no-fund"], { cwd });
  check((await health(ctx, url)).status === "ok", "/api/health is not ok");
  await checkSpa(ctx, url);
  await ctx.exec(["npm", "run", "test:beta"], {
    cwd,
    env: {
      QB_BETA_BASE_URL: url,
      QB_BETA_OIDC_TOKEN_URL: "https://auth-beta.ovea.pro/application/o/token/",
      QB_BETA_OIDC_CLIENT_ID: "questionbank-smoke",
      QB_BETA_OIDC_CLIENT_SECRET: ctx.secrets.QB_BETA_OIDC_CLIENT_SECRET,
    },
  });
});
