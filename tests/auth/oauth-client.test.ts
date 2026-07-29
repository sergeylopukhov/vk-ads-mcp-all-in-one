import { describe, expect, it } from "vitest";

import { VkAdsTokenLimitError } from "../../src/auth/errors.js";
import {
  type FetchLike,
  VkAdsOAuthClient,
} from "../../src/auth/oauth-client.js";

describe("VkAdsOAuthClient", () => {
  it("uses the documented client_credentials form contract", async () => {
    let requestBody = "";
    const fetchImpl: FetchLike = async (_input, init) => {
      requestBody = String(init.body);

      return new Response(
        JSON.stringify({
          access_token: "access-value",
          refresh_token: "refresh-value",
          expires_in: "86400",
          token_type: "bearer",
          scope: "read_ads",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const client = new VkAdsOAuthClient({
      endpoint: "https://example.test/token",
      fetchImpl,
    });

    await expect(
      client.issueClientCredentialsToken("client-id", "client-secret"),
    ).resolves.toEqual({
      accessToken: "access-value",
      refreshToken: "refresh-value",
      expiresInSeconds: 86_400,
    });

    const form = new URLSearchParams(requestBody);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "client_credentials",
      client_id: "client-id",
      client_secret: "client-secret",
    });
  });

  it("maps the fixed five-token limit response without retrying", async () => {
    let requestCount = 0;
    const fetchImpl: FetchLike = async () => {
      requestCount += 1;

      return new Response(
        JSON.stringify({
          error: "token_limit_exceeded",
          error_description: "limit reached",
        }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const client = new VkAdsOAuthClient({
      endpoint: "https://example.test/token",
      fetchImpl,
    });

    await expect(
      client.issueClientCredentialsToken("client-id", "client-secret"),
    ).rejects.toBeInstanceOf(VkAdsTokenLimitError);
    expect(requestCount).toBe(1);
  });

  it("inspects an authorization code without exposing user identity", async () => {
    let requestBody = "";
    const fetchImpl: FetchLike = async (_input, init) => {
      requestBody = String(init.body);

      return new Response(
        JSON.stringify({
          user: {
            id: 123,
            username: "private-account",
            types: ["advert", "agency_client"],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const client = new VkAdsOAuthClient({
      codeInfoEndpoint: "https://example.test/code-info",
      fetchImpl,
    });

    await expect(
      client.getAuthorizationCodeInfo(
        "client-id",
        "client-secret",
        "one-time-code",
      ),
    ).resolves.toEqual({
      userTypes: ["advert", "agency_client"],
    });
    expect(Object.fromEntries(new URLSearchParams(requestBody))).toEqual({
      code: "one-time-code",
      client_id: "client-id",
      client_secret: "client-secret",
    });
  });

  it("deletes current-user tokens through the documented form", async () => {
    let requestBody = "";
    const fetchImpl: FetchLike = async (_input, init) => {
      requestBody = String(init.body);
      return new Response(null, { status: 204 });
    };
    const client = new VkAdsOAuthClient({
      tokenDeleteEndpoint: "https://example.test/token-delete",
      fetchImpl,
    });

    await expect(
      client.deleteCurrentUserTokens("client-id", "client-secret"),
    ).resolves.toBeUndefined();
    expect(Object.fromEntries(new URLSearchParams(requestBody))).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
    });
  });
});
