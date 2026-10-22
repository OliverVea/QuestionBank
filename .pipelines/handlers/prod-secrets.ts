import { implement } from "@olve/pipelines";
import { prodSecrets } from "../pipeline";
import { connect } from "./lib/ssh";

export default implement(prodSecrets, async (_input, ctx) => {
  const ssh = await connect(ctx, ctx.secrets.SSH_PRIVATE_KEY);
  await ssh.applySecret("apps", "figure-service-auth", "api-key", "FIGURE_SERVICE_API_KEY");
  await ssh.applySecret("apps", "questionbank-secrets", "anthropic-api-key", "ANTHROPIC_API_KEY");
});
