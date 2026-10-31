import { implement, step, Source } from "@olivervea/pipelines";

export const test = implement(step({
  name: "test",
  description: "Runs `npm ci`, `npm run typecheck` and `npm test` (server and client suites, offline).",
  image: "node:22",
  input: { source: Source },
  timeoutSeconds: 1200,
}), async ({ source }, ctx) => {
  const cwd = await ctx.files.fetch(source.tree);
  await ctx.exec(["npm", "ci", "--no-audit", "--no-fund"], { cwd });
  await ctx.exec(["npm", "run", "typecheck"], { cwd });
  await ctx.exec(["npm", "test"], { cwd });
});
