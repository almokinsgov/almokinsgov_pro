#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const serverInfo = {
  name: "rwas-mcp-server",
  version: "0.1.0"
};

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

async function loadMetadata() {
  if (process.env.RWAS_METADATA_JSON) {
    return JSON.parse(process.env.RWAS_METADATA_JSON);
  }
  if (process.env.RWAS_METADATA_URL) {
    const response = await fetch(process.env.RWAS_METADATA_URL);
    if (!response.ok) throw new Error(`Metadata URL failed: ${response.status} ${response.statusText}`);
    return response.json();
  }
  if (process.env.RWAS_METADATA_FILE) {
    const filePath = path.resolve(process.cwd(), process.env.RWAS_METADATA_FILE);
    return JSON.parse(await readFile(filePath, "utf8"));
  }
  return {
    schemaVersion: "rwas-agent-metadata-v1",
    generatedAt: new Date().toISOString(),
    error: "No RWAS metadata source configured. Set RWAS_METADATA_JSON, RWAS_METADATA_URL, or RWAS_METADATA_FILE."
  };
}

function metadataPart(metadata, uri) {
  if (uri === "rwas://alerts") return metadata.alerts || [];
  if (uri === "rwas://features") return metadata.features || { type: "FeatureCollection", features: [] };
  if (uri === "rwas://extensions") return metadata.extensions || [];
  return metadata;
}

function resourcesList() {
  return [
    { uri: "rwas://metadata", name: "RWAS metadata", mimeType: "application/json" },
    { uri: "rwas://alerts", name: "RWAS alerts", mimeType: "application/json" },
    { uri: "rwas://features", name: "RWAS alert GeoJSON", mimeType: "application/geo+json" },
    { uri: "rwas://extensions", name: "RWAS extensions", mimeType: "application/json" }
  ];
}

function toolsList() {
  return [
    {
      name: "rwas_get_metadata",
      description: "Return the current RWAS metadata JSON.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "rwas_get_alerts",
      description: "Return current RWAS alert summaries.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "rwas_get_features",
      description: "Return current RWAS GeoJSON alert features.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "rwas_get_extensions",
      description: "Return RWAS extension metadata.",
      inputSchema: { type: "object", properties: {} }
    }
  ];
}

async function handleRequest(message) {
  const method = message.method;
  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        resources: {},
        tools: {}
      },
      serverInfo
    };
  }
  if (method === "ping") return {};
  if (method === "resources/list") {
    return { resources: resourcesList() };
  }
  if (method === "resources/read") {
    const metadata = await loadMetadata();
    const uri = message.params && message.params.uri ? message.params.uri : "rwas://metadata";
    return {
      contents: [
        {
          uri,
          mimeType: uri === "rwas://features" ? "application/geo+json" : "application/json",
          text: jsonText(metadataPart(metadata, uri))
        }
      ]
    };
  }
  if (method === "tools/list") {
    return { tools: toolsList() };
  }
  if (method === "tools/call") {
    const name = message.params && message.params.name ? message.params.name : "";
    const metadata = await loadMetadata();
    const uriByTool = {
      rwas_get_metadata: "rwas://metadata",
      rwas_get_alerts: "rwas://alerts",
      rwas_get_features: "rwas://features",
      rwas_get_extensions: "rwas://extensions"
    };
    const uri = uriByTool[name];
    if (!uri) {
      throw new Error(`Unknown RWAS MCP tool: ${name}`);
    }
    return {
      content: [
        {
          type: "text",
          text: jsonText(metadataPart(metadata, uri))
        }
      ]
    };
  }
  throw new Error(`Unsupported MCP method: ${method}`);
}

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

async function respond(message) {
  if (!message || message.id === undefined || message.method === "notifications/initialized") return;
  try {
    const result = await handleRequest(message);
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32000,
        message: error && error.message ? error.message : String(error)
      }
    });
  }
}

let buffer = Buffer.alloc(0);

function drainFrames() {
  while (buffer.length) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/content-length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    try {
      respond(JSON.parse(body));
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: error && error.message ? error.message : String(error)
        }
      });
    }
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainFrames();
});

process.stdin.resume();
