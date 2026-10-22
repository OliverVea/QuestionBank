import { implement } from "@olivervea/pipelines";
import { prodSecrets } from "../pipeline";
import { applySecret, connect } from "./lib/ssh";

export default implement(prodSecrets, async (_input, ctx) => {
  const ssh = await connect(ctx, ctx.secrets.SSH_PRIVATE_KEY);
  await applySecret(ctx, ssh, "apps", "figure-service-auth", "api-key", "FIGURE_SERVICE_API_KEY");
  await applySecret(ctx, ssh, "apps", "questionbank-secrets", "anthropic-api-key", "ANTHROPIC_API_KEY");
});
