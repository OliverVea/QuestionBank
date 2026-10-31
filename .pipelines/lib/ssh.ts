import { sshSession, type Ctx, type SshSession } from "@olivervea/pipelines";
import { HOST } from "../shared";

export const connect = (ctx: Ctx, privateKey: string) => sshSession(ctx, { host: HOST, key: privateKey });

/** Writes one key of a Secret from an env var, passed on stdin so the value never reaches a command line. */
export function applySecret(ctx: Ctx, ssh: SshSession, namespace: string, name: string, key: string, envVar: string) {
  if (!process.env[envVar]) throw new Error(`${envVar} is unset`);
  const remote = `kubectl -n ${namespace} create secret generic ${name} --from-file=${key}=/dev/stdin --dry-run=client -o yaml`
    + ` | kubectl apply --server-side --force-conflicts --field-manager=olve-pipelines -f -`;
  ctx.log("writing secret", { namespace, name, key });
  return ctx.sh(`printf '%s' "$${envVar}" | ${ssh.shell(remote)}`);
}
