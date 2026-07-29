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

  it("returns valid MCP output for background runs, snapshots, and rescoring", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vk-community-runs-"));
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
    const input = {
      keywords: ["регент"],
      include_terms: [],
      exclude_terms: [],
      limit: 1,
      posts_limit: 1,
      clusters: [],
    };

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      let runId = "";
      for (const name of [
        "vk_start_community_research",
        "vk_research_communities",
      ]) {
        const started = await client.callTool({
          name,
          arguments: input,
        });
        expect(started.isError).not.toBe(true);
        expect(started.structuredContent).toMatchObject({
          progress: { selected: 0 },
        });
        const startedContent = started.structuredContent as
          | { status?: string; run_id?: string }
          | undefined;
        expect(["queued", "running", "completed"]).toContain(
          startedContent?.status,
        );
        const currentRunId = String(startedContent?.run_id);
        if (runId === "") runId = currentRunId;
        let currentSnapshot;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          currentSnapshot = await client.callTool({
            name: "vk_get_community_research_run",
            arguments: { run_id: currentRunId },
          });
          const snapshotContent =
            currentSnapshot.structuredContent as
              | { status?: string }
              | undefined;
          if (snapshotContent?.status === "completed") {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(currentSnapshot?.structuredContent).toMatchObject({
          run_id: currentRunId,
          status: "completed",
          progress: { remaining: 0 },
        });
      }

      const progress = await client.callTool({
        name: "vk_get_community_research_progress",
        arguments: { run_id: runId },
      });
      expect(progress.isError).not.toBe(true);
      expect(progress.structuredContent).toMatchObject({
        run_id: runId,
        status: "completed",
      });

      const rescored = await client.callTool({
        name: "vk_rescore_community_research_run",
        arguments: { run_id: runId },
      });
      expect(rescored.isError).not.toBe(true);
      expect(rescored.structuredContent).toMatchObject({
        status: "completed",
        rescore_of: runId,
      });
    } finally {
      await client.close();
      await server.close();
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 10,
      });
    }
  });
});
