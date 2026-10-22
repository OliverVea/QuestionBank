import { implement } from "@olivervea/pipelines";
import { test } from "../pipeline";

export default implement(test, async ({ source }, ctx) => {
  const cwd = await ctx.files.fetch(source.tree);
  await ctx.exec(["npm", "ci", "--no-audit", "--no-fund"], { cwd });
  await ctx.exec(["npm", "run", "typecheck"], { cwd });
  await ctx.exec(["npm", "test"], { cwd });
});
