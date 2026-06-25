/**
 * AWS Signature Version 4 Plugin
 *
 * Signs HTTP requests using AWS SigV4 for use with:
 *   - API Gateway (execute-api)
 *   - S3 (s3)
 *   - Lambda (lambda)
 *   - Any other AWS service
 *
 * Uses ctx.crypto for Web Crypto-based HMAC-SHA256 (async, no native Node.js needed).
 *
 * Reference: https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html
 */

module.exports = {
  async beforeRequest(ctx) {
    const { config, crypto: cryptoUtils } = ctx;
    const { accessKeyId, secretAccessKey, region, service } = config;

    if (!accessKeyId || !secretAccessKey) {
      console.warn("[aws-sigv4] accessKeyId and secretAccessKey are required.");
      return;
    }

    const awsRegion = region || "us-east-1";
    const awsService = service || "execute-api";

    // ── Parse URL ────────────────────────────────────────────────────────────
    let parsedUrl;
    try {
      parsedUrl = new URL(ctx.url);
    } catch {
      console.error("[aws-sigv4] Invalid URL:", ctx.url);
      return;
    }

    const host = parsedUrl.host;
    const pathname = parsedUrl.pathname || "/";
    const searchParams = parsedUrl.searchParams;

    // ── Date/Time ────────────────────────────────────────────────────────────
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z"; // 20240610T120000Z
    const dateStamp = amzDate.slice(0, 8); // 20240610

    // ── Canonical headers ────────────────────────────────────────────────────
    const newHeaders = {
      ...ctx.headers,
      "host": host,
      "x-amz-date": amzDate,
    };
    if (config.sessionToken) {
      newHeaders["x-amz-security-token"] = config.sessionToken;
    }

    // Sorted, lowercase header names
    const signedHeaderNames = Object.keys(newHeaders)
      .map((k) => k.toLowerCase())
      .filter((k) => k === "host" || k === "content-type" || k.startsWith("x-amz-"))
      .sort();

    const canonicalHeaders = signedHeaderNames
      .map((k) => `${k}:${(newHeaders[k] || newHeaders[k.toLowerCase()] || "").trim()}`)
      .join("\n") + "\n";

    const signedHeaders = signedHeaderNames.join(";");

    // ── Canonical request ─────────────────────────────────────────────────────
    const body = ctx.body || "";
    const payloadHash = await cryptoUtils.sha256(body);

    // Canonical query string
    const queryParts = [];
    searchParams.sort();
    for (const [k, v] of searchParams.entries()) {
      queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    const canonicalQueryString = queryParts.join("&");

    const canonicalRequest = [
      ctx.method.toUpperCase(),
      pathname,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    // ── String to sign ────────────────────────────────────────────────────────
    const credentialScope = `${dateStamp}/${awsRegion}/${awsService}/aws4_request`;
    const canonicalRequestHash = await cryptoUtils.sha256(canonicalRequest);

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join("\n");

    // ── Signing key ───────────────────────────────────────────────────────────
    // kSigning = HMAC(HMAC(HMAC(HMAC("AWS4" + secret, date), region), service), "aws4_request")
    const kSecret = "AWS4" + secretAccessKey;
    const kDate  = await cryptoUtils.hmacSha256Bytes(kSecret, dateStamp);
    const kRegion = await cryptoUtils.hmacSha256Bytes(kDate, awsRegion);
    const kService = await cryptoUtils.hmacSha256Bytes(kRegion, awsService);
    const kSigning = await cryptoUtils.hmacSha256Bytes(kService, "aws4_request");

    // ── Signature ─────────────────────────────────────────────────────────────
    const signature = await cryptoUtils.hmacSha256(kSigning, stringToSign);

    // ── Authorization header ──────────────────────────────────────────────────
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    newHeaders["Authorization"] = authorization;
    newHeaders["x-amz-content-sha256"] = payloadHash;

    console.log(`[aws-sigv4] Signed: ${ctx.method.toUpperCase()} ${pathname} → ${credentialScope}`);

    return { headers: newHeaders };
  },
};
