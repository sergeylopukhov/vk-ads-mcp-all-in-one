import type { ProviderFieldIssue } from "../provider-error.js";

export class VkAdsApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus?: number,
    readonly fieldIssues: readonly ProviderFieldIssue[] = [],
  ) {
    super(message);
    this.name = new.target.name;
  }
}
