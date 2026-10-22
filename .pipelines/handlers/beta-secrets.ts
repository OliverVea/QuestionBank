import { implement } from "@olivervea/pipelines";
import { betaSecrets } from "../pipeline";
import { applySecret, connect } from "./lib/ssh";

// Beta's questionbank-secrets holds beta's own Anthropic key and is managed outside the pipeline.
export default implement(betaSecrets, async (_input, ctx) => {
  const ssh = await connect(ctx, ctx.secrets.SSH_PRIVATE_KEY);
  await applySecret(ctx, ssh, "apps-beta", "figure-service-auth", "api-key", "FIGURE_SERVICE_API_KEY");
});
