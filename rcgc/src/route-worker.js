import { RoadNetwork } from "./route-core.js";

let network;
let roadsUrl;

const respond = (id, payload) => self.postMessage({ id, ...payload });

self.addEventListener("message", async (event) => {
  const { id, type, payload = {} } = event.data || {};
  try {
    if (type === "init") {
      roadsUrl = payload.roadsUrl;
      respond(id, {
        progress: true,
        message: "Loading the Far North road network…"
      });
      const response = await fetch(roadsUrl);
      if (!response.ok) {
        throw new Error(`Road network request failed: HTTP ${response.status}`);
      }
      const geojson = await response.json();
      respond(id, {
        progress: true,
        message: `Building a graph from ${geojson.features?.length || 0} roads…`
      });
      network = new RoadNetwork(geojson);
      respond(id, {
        result: {
          status: "ready",
          graphNodes: network.nodes.size,
          graphEdges: network.edges.length,
          skippedEdges: network.skippedEdges,
          buildMs: network.buildMilliseconds
        }
      });
      return;
    }

    if (type === "route") {
      if (!network) {
        throw new Error(
          `Road network is not initialised${roadsUrl ? "" : " (missing URL)"}`
        );
      }
      respond(id, {
        progress: true,
        message: "Snapping endpoints and checking mapped closures…"
      });
      const result = network.findRoutes(payload);
      respond(id, { result });
      return;
    }

    throw new Error(`Unknown route worker request: ${type}`);
  } catch (error) {
    respond(id, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
