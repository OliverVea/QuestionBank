import { implement, step } from "@olivervea/pipelines";
import { SSH_PRIVATE_KEY, ANTHROPIC_API_KEY, FIGURE_SERVICE_API_KEY } from "../shared";
import { applySecret, connect } from "../lib/ssh";

export const prodSecrets = implement(step({
  name: "prod-secrets",
  description: "Writes the figure service key into figure-service-auth and the Anthropic key into questionbank-secrets in apps.",
  image: "alpine:3.22",
  secrets: [SSH_PRIVATE_KEY, FIGURE_SERVICE_API_KEY, ANTHROPIC_API_KEY],
  timeoutSeconds: 300,
}), async (_input, ctx) => {
  const ssh = await connect(ctx, ctx.secrets.SSH_PRIVATE_KEY);
  await applySecret(ctx, ssh, "apps", "figure-service-auth", "api-key", "FIGURE_SERVICE_API_KEY");
  await applySecret(ctx, ssh, "apps", "questionbank-secrets", "anthropic-api-key", "ANTHROPIC_API_KEY");
});
