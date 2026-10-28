// The managed gateway token authorizes dispatching turns and reading snapshots on this server's
// port, and reaches it through the environment, which every agent, terminal and tool the server
// spawns inherits. bin.ts imports this first: the token is taken out of the environment as the
// server loads, before anything is started, and only the server holds it from then on.
const ENV_NAME = "WORKSPACE_GATEWAY_TOKEN";

export const managedGatewayToken: string | undefined = process.env[ENV_NAME] || undefined;
delete process.env[ENV_NAME];
