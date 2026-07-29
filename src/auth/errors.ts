export class VkAdsAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class VkAdsAuthConfigError extends VkAdsAuthError {
  constructor(message: string) {
    super(message, "auth_config_error");
  }
}

export class VkAdsTokenLimitError extends VkAdsAuthError {
  constructor() {
    super(
      "VK Ads token limit reached; no token was created.",
      "token_limit_exceeded",
      403,
    );
  }
}

export class VkAdsTokenRefreshError extends VkAdsAuthError {
  constructor(code: string, httpStatus?: number) {
    super("VK Ads rejected the token refresh request.", code, httpStatus);
  }
}

export class VkAdsTokenUnavailableError extends VkAdsAuthError {
  constructor() {
    super(
      "The stored access token cannot be renewed without a refresh token.",
      "token_unavailable",
    );
  }
}
