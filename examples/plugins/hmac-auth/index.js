/**
 * HMAC Auth Plugin
 *
 * Adds an HMAC-SHA256 signature header to every request.
 * Useful for APIs that require request signing (e.g. Stripe webhooks, Shopify, custom auth).
 *
 * Configuration:
 *   secretKey      - The shared secret key
 *   headerName     - Header to inject (default: X-Signature)
 *   algorithm      - HMAC-SHA256 (hex) or HMAC-SHA256 (base64)
 *   signContent    - What to sign: method+url | url-only | body | method+url+body
 *   timestampHeader - Whether to include X-Timestamp header
 *
 * Example signed message for signContent=method+url:
 *   "GET\nhttps://api.example.com/users"
 */

module.exports = {
  async beforeRequest(ctx) {
    const { config, crypto } = ctx;
    const secret = config.secretKey;

    if (!secret) {
      console.warn("[hmac-auth] No secretKey configured. Skipping signature.");
      return;
    }

    const ts = Math.floor(Date.now() / 1000).toString();
    const headerName = config.headerName || "X-Signature";
    const useBase64 = (config.algorithm || "").includes("base64");

    // Build the message to sign
    let message;
    switch (config.signContent || "method+url") {
      case "url-only":
        message = ctx.url;
        break;
      case "body":
        message = ctx.body || "";
        break;
      case "method+url+body":
        message = `${ctx.method.toUpperCase()}\n${ctx.url}\n${ctx.body || ""}`;
        break;
      default: // method+url
        message = `${ctx.method.toUpperCase()}\n${ctx.url}`;
    }

    // Include timestamp in message to prevent replay attacks
    if (config.timestampHeader !== "false") {
      message = `${ts}\n${message}`;
    }

    // Compute HMAC-SHA256
    const sigBytes = await crypto.hmacSha256Bytes(secret, message);
    const signature = useBase64
      ? crypto.base64Encode(sigBytes)
      : crypto.hexEncode(sigBytes);

    const newHeaders = { ...ctx.headers };
    newHeaders[headerName] = signature;

    if (config.timestampHeader !== "false") {
      newHeaders["X-Timestamp"] = ts;
    }

    console.log(`[hmac-auth] Signed request → ${headerName}: ${signature.slice(0, 16)}...`);

    return { headers: newHeaders };
  },
};
