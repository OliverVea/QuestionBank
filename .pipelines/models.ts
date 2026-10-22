import { model, z } from "@olve/pipelines";

export const DeployRequest = model("DeployRequest", z.object({
  repo: z.string().default("OliverVea/QuestionBank"),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  deployTo: z.enum(["beta", "prod"]).default("prod"),
}));

/** An image in registry.ovea.pro, tagged by the content of its build context. */
export const PushedImage = model("PushedImage", z.object({
  repository: z.string(),
  tag: z.string(),
}));
