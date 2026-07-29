import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CommunityResearchStore } from "../../src/community/research-store.js";
import { COMMUNITY_TOOL_NAMES } from "../../src/community/tools.js";
import { createVkAdsMcpServer } from "../../src/server.js";

describe("community MCP tools", () => {
  it("registers all ten community tools without live VK calls", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vk-community-tools-"));
    const client = new Client({ name: "test-client", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createVkAdsMcpServer(
      undefined,
      undefined,
      undefined,
      {
        client: {
          searchPage: async () => ({ count: 0, offset: 0, items: [] }),
          getByIds: async () => [],
          wall: async () => [],
        } as never,
        store: new CommunityResearchStore(
          join(directory, "runs.json"),
          86_400_000,
        ),
      },
    );

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      const names = new Set(tools.tools.map((tool) => tool.name));
      for (const name of COMMUNITY_TOOL_NAMES) {
        expect(names.has(name)).toBe(true);
      }

      const result = await client.callTool({
        name: "vk_discover_communities",
        arguments: { keywords: ["регент"] },
      });
      expect(result.structuredContent).toEqual({ items: [] });
    } finally {
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
