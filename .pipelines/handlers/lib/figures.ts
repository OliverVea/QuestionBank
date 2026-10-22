import { join } from "node:path";
import { httpHealthCheck, type Ctx, type Infer, type Source } from "@olve/pipelines";
import type { PushedImage } from "../../models";
import { connect } from "./ssh";

const RELEASE = "questionbank-figures";
const K3S_PULL = "sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io pull -q";

// The image is pulled onto the node before the rollout, so the rollout doesn't wait on 3.5 GB.
export async function deployFigures(
  ctx: Ctx,
  { source, image }: { source: Infer<typeof Source>; image: Infer<typeof PushedImage> },
  namespace: string,
) {
  const tree = await ctx.files.fetch(source.tree);
  const ssh = await connect(ctx, ctx.secrets.SSH_PRIVATE_KEY!);
  const ref = `${image.repository}:${image.tag}`;
  ctx.log("pulling image", { image: ref });
  await ssh.run(`${K3S_PULL} ${ref}`);

  const remoteChart = `/tmp/${RELEASE}-helm-${namespace}`;
  await ssh.run(`rm -rf ${remoteChart}`);
  await ssh.copy(join(tree, "services/figure-service/helm"), remoteChart);
  await ssh.run(
    `cd ${remoteChart} && helm upgrade --install ${RELEASE} . -n ${namespace}`
    + ` --set image.repository=${image.repository} --set image.tag=${image.tag} --set image.pullPolicy=IfNotPresent`
    + ` && cd / && rm -rf ${remoteChart}`,
  );
  await ssh.run(`kubectl -n ${namespace} rollout status deploy/${RELEASE} --timeout=300s`);
  await httpHealthCheck(ctx, `http://${RELEASE}.${namespace}.svc.cluster.local/health`, { attempts: 6, delaySeconds: 5 });
  return { release: RELEASE, namespace, image: ref };
}
