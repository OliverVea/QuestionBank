import { implement } from "@olve/pipelines";
import { betaTest } from "../pipeline";
import { check, checkSpa, health, serviceUrl } from "./lib/checks";

// The suite writes (and deletes) books in the smoke client's own tenant, so it runs against beta only.
export default implement(betaTest, async ({ source, release }, ctx) => {
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
