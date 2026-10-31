import { secret } from "@olivervea/pipelines";

export const GITHUB_TOKEN = secret("GITHUB_TOKEN", "GitHub read token used to fetch the repo tarball.");
export const SSH_PRIVATE_KEY = secret("SSH_PRIVATE_KEY", "SSH key for the homelab host: image import, helm, kubectl.");
export const ANTHROPIC_API_KEY = secret("ANTHROPIC_API_KEY", "Anthropic API key for prod, written into questionbank-secrets in apps.");
export const FIGURE_SERVICE_API_KEY = secret("FIGURE_SERVICE_API_KEY", "Shared X-API-Key of the figure service, written into figure-service-auth in apps-beta and apps.");
export const QB_BETA_OIDC_CLIENT_SECRET = secret("QB_BETA_OIDC_CLIENT_SECRET", "Client secret of beta Authentik's questionbank-smoke machine client.");
export const HOST = "oliver@bulwark-m2";
// kaniko under gVisor stalls pulling from these registries directly.
export const REGISTRY_MAP = { "mcr.microsoft.com": "mcr-cache.ovea.pro", "index.docker.io": "hub-cache.ovea.pro" };
