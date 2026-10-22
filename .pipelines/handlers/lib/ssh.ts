import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "@olve/pipelines";
import { HOST } from "../../pipeline";

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export interface Ssh {
  run(remote: string): Promise<void>;
  text(remote: string): Promise<string>;
  copy(localDir: string, remoteDir: string): Promise<void>;
  /** Writes one key of a Secret from an env var, passed on stdin so the value never reaches a command line. */
  applySecret(namespace: string, name: string, key: string, envVar: string): Promise<void>;
}

export async function connect(ctx: Ctx, privateKey: string): Promise<Ssh> {
  await ctx.exec(["apk", "add", "--no-cache", "openssh-client"]);
  const dir = join(ctx.tmpDir, "ssh");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyFile = join(dir, "id");
  writeFileSync(keyFile, privateKey.endsWith("\n") ? privateKey : privateKey + "\n", { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  const opts = ["-i", keyFile, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "BatchMode=yes"];
  const ssh = ["ssh", ...opts, HOST];
  return {
    run: (remote) => ctx.exec([...ssh, remote]),
    text: (remote) => ctx.sh.text([...ssh, remote].map(q).join(" ")),
    copy: (localDir, remoteDir) => ctx.exec(["scp", ...opts, "-r", localDir, `${HOST}:${remoteDir}`]),
    applySecret: (namespace, name, key, envVar) => {
      if (!process.env[envVar]) throw new Error(`${envVar} is unset`);
      const remote = `kubectl -n ${namespace} create secret generic ${name} --from-file=${key}=/dev/stdin --dry-run=client -o yaml`
        + ` | kubectl apply --server-side --force-conflicts --field-manager=olve-pipelines -f -`;
      ctx.log("writing secret", { namespace, name, key });
      return ctx.sh(`printf '%s' "$${envVar}" | ${[...ssh, remote].map(q).join(" ")}`);
    },
  };
}
