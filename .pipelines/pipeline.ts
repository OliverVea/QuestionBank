// Every push goes beta, then prod and the public demo. config.yaml beside it is the paused v1 deployer's rollback path.
import { pipeline, secret, step, steps, HelmRelease, Source } from "@olve/pipelines";
import * as M from "./models";

export const GITHUB_TOKEN = secret("GITHUB_TOKEN", "GitHub read token used to fetch the repo tarball.");
export const SSH_PRIVATE_KEY = secret("SSH_PRIVATE_KEY", "SSH key for the homelab host: image import, helm, kubectl.");
export const ANTHROPIC_API_KEY = secret("ANTHROPIC_API_KEY", "Anthropic API key for prod, written into questionbank-secrets in apps.");
export const FIGURE_SERVICE_API_KEY = secret("FIGURE_SERVICE_API_KEY", "Shared X-API-Key of the figure service, written into figure-service-auth in apps-beta and apps.");
export const QB_BETA_OIDC_CLIENT_SECRET = secret("QB_BETA_OIDC_CLIENT_SECRET", "Client secret of beta Authentik's questionbank-smoke machine client.");

export const HOST = "oliver@bulwark-m2";
export const FIGURES_REPOSITORY = "registry.ovea.pro/questionbank/figure-service";

export const source = steps.gitHubSource({
  name: "source",
  description: "Fetches the pushed commit from GitHub.",
  token: GITHUB_TOKEN,
});

export const build = steps.imageBuild({
  name: "build",
  description: "Builds the app image (API + SPA) with kaniko.",
  repository: "questionbank",
  registryMap: { "mcr.microsoft.com": "mcr-cache.ovea.pro", "index.docker.io": "hub-cache.ovea.pro" },
  timeoutSeconds: 1200,
});

// The figure image is ~3.5 GB: too big to travel as a tarball, so it goes through the registry,
// and is rebuilt only when services/figure-service changes.
export const buildFigures = step({
  name: "build-figures",
  description: "Builds the figure service image with kaniko and pushes it to registry.ovea.pro, unless an image of this exact services/figure-service is already there.",
  image: "gcr.io/kaniko-project/executor:debug",
  input: { source: Source },
  output: M.PushedImage,
  timeoutSeconds: 3600,
  retries: 2,
});

export const test = step({
  name: "test",
  description: "Runs `npm ci`, `npm run typecheck` and `npm test` (server and client suites, offline).",
  image: "node:22",
  input: { source: Source },
  timeoutSeconds: 1200,
});

export const betaSecrets = step({
  name: "beta-secrets",
  description: "Writes the figure service key into the figure-service-auth Secret in apps-beta.",
  image: "alpine:3.22",
  secrets: [SSH_PRIVATE_KEY, FIGURE_SERVICE_API_KEY],
  timeoutSeconds: 300,
});

export const deployFiguresBeta = step({
  name: "deploy-figures-beta",
  description: "Deploys the figure service to apps-beta with Helm and checks its health.",
  image: "alpine:3.22",
  input: { source: Source, image: M.PushedImage },
  output: HelmRelease,
  secrets: [SSH_PRIVATE_KEY],
  timeoutSeconds: 1800,
});

export const deployBeta = steps.helmDeployOverSsh({
  name: "deploy-beta",
  description: "Deploys the app image to apps-beta with Helm and checks its health.",
  host: HOST,
  sshKey: SSH_PRIVATE_KEY,
  release: "questionbank",
  namespace: "apps-beta",
  chart: "helm",
  values: ["values-beta.yaml"],
  healthUrl: "http://questionbank.apps-beta.svc.cluster.local/api/health",
  timeoutSeconds: 900,
});

export const betaTest = step({
  name: "beta-test",
  description: "Runs the beta test suite (`npm run test:beta`) against beta in-cluster with a token from beta Authentik, and checks the SPA is served.",
  image: "node:22",
  input: { source: Source, release: HelmRelease },
  secrets: [QB_BETA_OIDC_CLIENT_SECRET],
  timeoutSeconds: 900,
});

export const prodSecrets = step({
  name: "prod-secrets",
  description: "Writes the figure service key into figure-service-auth and the Anthropic key into questionbank-secrets in apps.",
  image: "alpine:3.22",
  secrets: [SSH_PRIVATE_KEY, FIGURE_SERVICE_API_KEY, ANTHROPIC_API_KEY],
  timeoutSeconds: 300,
});

export const deployFiguresProd = step({
  name: "deploy-figures-prod",
  description: "Deploys the figure service to apps with Helm and checks its health.",
  image: "alpine:3.22",
  input: { source: Source, image: M.PushedImage },
  output: HelmRelease,
  secrets: [SSH_PRIVATE_KEY],
  timeoutSeconds: 1800,
});

export const deployProd = steps.helmDeployOverSsh({
  name: "deploy-prod",
  description: "Deploys the app image to apps with Helm and checks its health.",
  host: HOST,
  sshKey: SSH_PRIVATE_KEY,
  release: "questionbank",
  namespace: "apps",
  chart: "helm",
  values: ["values-minimal.yaml"],
  healthUrl: "http://questionbank.apps.svc.cluster.local/api/health",
  timeoutSeconds: 900,
});

export const prodTest = step({
  name: "prod-test",
  description: "Read-only smoke test of prod: health, that the API needs a token, and the SPA.",
  image: "alpine:3.22",
  input: { release: HelmRelease },
  timeoutSeconds: 180,
});

export const deployDemo = steps.helmDeployOverSsh({
  name: "deploy-demo",
  description: "Deploys the same image as the public demo (questionbank-demo in apps, QB_DEMO=1, no secrets).",
  host: HOST,
  sshKey: SSH_PRIVATE_KEY,
  release: "questionbank-demo",
  namespace: "apps",
  chart: "helm",
  values: ["values-demo.yaml"],
  healthUrl: "http://questionbank-demo.apps.svc.cluster.local/api/health",
  timeoutSeconds: 900,
});

export const demoTest = step({
  name: "demo-test",
  description: "Read-only check of the demo: it runs in demo mode, serves the SPA, and its pod has no credentials in its environment.",
  image: "alpine:3.22",
  input: { release: HelmRelease },
  secrets: [SSH_PRIVATE_KEY],
  timeoutSeconds: 300,
});

export default pipeline({
  name: "QuestionBank",
  description: "Build the app and figure service images and run the offline tests, deploy both to apps-beta and run the beta test suite against it, then deploy to apps, smoke-test prod read-only and deploy the public demo. deployTo=beta stops after beta.",
  input: M.DeployRequest,
})
  .onPush(e => ({ repo: e.repository.full_name, sha: e.after, deployTo: "prod" }))
  .stage([source, from => ({ repo: from.input.repo, sha: from.input.sha })])
  .stage(build, buildFigures, test, betaSecrets)
  .stage(deployFiguresBeta, deployBeta)
  .stage([betaTest, from => ({ source: from.source, release: from["deploy-beta"] })])
  .when({ deployTo: "prod" }, p => p
    .stage(prodSecrets)
    .stage(deployFiguresProd, deployProd)
    .stage([prodTest, from => ({ release: from["deploy-prod"] })], deployDemo)
    .stage([demoTest, from => ({ release: from["deploy-demo"] })]));
