import { join } from "node:path";
import { implement } from "@olve/pipelines";
import { buildFigures, FIGURES_REPOSITORY } from "../pipeline";

// kaniko wipes the filesystem root between stages; only /kaniko survives.
const CONTEXT = "/kaniko/build-context";
const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export default implement(buildFigures, async ({ source }, ctx) => {
  const dir = join(await ctx.files.fetch(source.tree), "services/figure-service");
  // A deterministic tar of the build context, so its hash names the content.
  const context = await ctx.output.dir(dir, { name: "context" });
  const tag = `src-${context.sha256.slice(0, 12)}`;
  const image = { repository: FIGURES_REPOSITORY, tag };

  const [registry, ...path] = FIGURES_REPOSITORY.split("/");
  const head = await ctx.http.fetch(`https://${registry}/v2/${path.join("/")}/manifests/${tag}`, { method: "HEAD", headers: { Accept: MANIFEST_TYPES } });
  if (head.ok) {
    ctx.log("image already built", image);
    return image;
  }

  await ctx.exec(["mkdir", "-p", CONTEXT]);
  await ctx.exec(["cp", "-r", `${dir}/.`, CONTEXT]);
  // Installing torch and baking the model weights can go quiet for minutes.
  await ctx.exec([
    "/kaniko/executor",
    `--context=${CONTEXT}`,
    `--dockerfile=${CONTEXT}/Dockerfile`,
    `--destination=${FIGURES_REPOSITORY}:${tag}`,
    "--registry-map=index.docker.io=hub-cache.ovea.pro",
  ], { idleTimeoutSeconds: 1200 });
  ctx.log("image pushed", image);
  return image;
});
