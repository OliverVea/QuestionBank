import { implement, step } from "@olivervea/pipelines";
import { SSH_PRIVATE_KEY, FIGURE_SERVICE_API_KEY } from "../shared";
import { applySecret, connect } from "../lib/ssh";

// Beta's questionbank-secrets holds beta's own Anthropic key and is managed outside the pipeline.
export const betaSecrets = implement(step({
  name: "beta-secrets",
  description: "Writes the figure service key into the figure-service-auth Secret in apps-beta.",
  image: "alpine:3.22",
  secrets: [SSH_PRIVATE_KEY, FIGURE_SERVICE_API_KEY],
  timeoutSeconds: 300,
}), async (_input, ctx) => {
  const ssh = await connect(ctx, ctx.secrets.SSH_PRIVATE_KEY);
  await applySecret(ctx, ssh, "apps-beta", "figure-service-auth", "api-key", "FIGURE_SERVICE_API_KEY");
});
