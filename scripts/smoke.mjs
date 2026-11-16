// Chạy thử MCP qua stdio: node scripts/smoke.mjs <tool> '<json args>'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const [tool, args] = process.argv.slice(2);
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env } }));
if (!tool) {
  const { tools } = await client.listTools();
  console.log(tools.map((t) => t.name).join("\n"));
} else {
  const r = await client.callTool({ name: tool, arguments: args ? JSON.parse(args) : {} }, undefined, { timeout: 180000 });
  console.log(r.isError ? "[LỖI] " : "", r.content.map((c) => c.text).join("\n"));
}
await client.close();
