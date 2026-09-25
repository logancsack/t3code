// TCP proxy that delays every chunk in both directions, to approximate the
// network round trip between a hub machine and PlanetScale.
//
//   node scripts/hub-proto/latency-proxy.ts <listen-port> <target-port> <one-way-delay-ms>
// @effect-diagnostics globalTimers:off
import * as NodeNet from "node:net";

const [listenPort, targetPort, delayArg] = process.argv.slice(2).map(Number);
if (!listenPort || !targetPort || delayArg === undefined) {
  throw new Error("usage: latency-proxy.ts <listen-port> <target-port> <one-way-delay-ms>");
}
const delayMs = delayArg;

const pipeDelayed = (from: NodeNet.Socket, to: NodeNet.Socket) => {
  from.on("data", (chunk) => {
    setTimeout(() => to.write(chunk), delayMs);
  });
  from.on("end", () => setTimeout(() => to.end(), delayMs));
  from.on("error", () => to.destroy());
};

NodeNet.createServer((client) => {
  client.setNoDelay(true);
  const upstream = NodeNet.connect({ host: "127.0.0.1", port: targetPort }, () => {
    upstream.setNoDelay(true);
  });
  pipeDelayed(client, upstream);
  pipeDelayed(upstream, client);
}).listen(listenPort, "127.0.0.1", () => {
  process.stdout.write(`latency proxy :${listenPort} -> :${targetPort} (+${delayMs}ms each way)\n`);
});
