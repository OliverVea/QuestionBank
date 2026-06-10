// Default the test harness to the "local" customer fallback, matching how a local/dev
// run is configured. Route tests that don't care about tenancy keep asserting current
// behavior as a single implicit customer; resolution/segmentation tests pass an explicit
// ResolveCustomerConfig (createApp's 4th arg) or X-Customer-Id headers to override this.
process.env.QB_ALLOW_DEFAULT_CUSTOMER = '1';
