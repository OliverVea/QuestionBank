// Every push goes beta, then prod and the public demo.
import { pipeline, steps } from "@olivervea/pipelines";
import * as M from "./models";
import { GITHUB_TOKEN, HOST, REGISTRY_MAP, SSH_PRIVATE_KEY } from "./shared";
import { betaSecrets } from "./steps/beta-secrets";
import { betaTest } from "./steps/beta-test";
import { demoTest } from "./steps/demo-test";
import { prodSecrets } from "./steps/prod-secrets";
import { prodTest } from "./steps/prod-test";
import { test } from "./steps/test";

const source = steps.gitHubSource({
  name: "source",
  description: "Fetches the pushed commit from GitHub.",
  token: GITHUB_TOKEN,
});

const build = steps.imageBuild({
  name: "build",
  description: "Builds the app image (API + SPA) with kaniko.",
  repository: "questionbank",
  registryMap: REGISTRY_MAP,
  timeoutSeconds: 1200,
});

// The figure image is ~3.5 GB: too big to travel as a tarball, so it goes through the registry,
// and is rebuilt only when services/figure-service changes.
const buildFigures = steps.imageBuild({
  name: "build-figures",
  description: "Builds the figure service image with kaniko and pushes it to registry.ovea.pro, unless an image of this exact services/figure-service is already there.",
  repository: "registry.ovea.pro/questionbank/figure-service",
  context: "services/figure-service",
  push: true,
  contentTag: true,
  // Installing torch and baking the model weights can go quiet for minutes.
  stallTimeoutSeconds: 1200,
  registryMap: REGISTRY_MAP,
  timeoutSeconds: 3600,
});

const figuresTo = (namespace: string) => ({
  host: HOST,
  sshKey: SSH_PRIVATE_KEY,
  release: "questionbank-figures",
  namespace,
  chart: "services/figure-service/helm",
  fromRegistry: true,
  rolloutTimeoutSeconds: 300,
  healthUrl: { url: `http://questionbank-figures.${namespace}.svc.cluster.local/health`, attempts: 6 },
  timeoutSeconds: 1800,
}) as const;

const deployFiguresBeta = steps.helmDeployOverSsh({
  name: "deploy-figures-beta",
  description: "Deploys the figure service to apps-beta with Helm and checks its health.",
  ...figuresTo("apps-beta"),
});

const deployBeta = steps.helmDeployOverSsh({
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

const deployFiguresProd = steps.helmDeployOverSsh({
  name: "deploy-figures-prod",
  description: "Deploys the figure service to apps with Helm and checks its health.",
  ...figuresTo("apps"),
});

const deployProd = steps.helmDeployOverSsh({
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

const deployDemo = steps.helmDeployOverSsh({
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
