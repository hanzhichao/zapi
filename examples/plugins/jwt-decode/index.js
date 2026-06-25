/**
 * JWT Decoder Plugin
 *
 * Decodes JWT tokens in request Authorization headers and/or response bodies.
 * Outputs decoded header + payload to the plugin console for easy inspection.
 *
 * Does NOT verify the signature (no secret required).
 */

function decodeBase64Url(str) {
  // Base64-url → base64 → JSON
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function decodeJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = decodeBase64Url(parts[0]);
  const payload = decodeBase64Url(parts[1]);
  if (!header || !payload) return null;
  return { header, payload };
}

function findJwts(text) {
  // Match anything that looks like a JWT: xxx.yyy.zzz with base64url chars
  const re = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
  return text.match(re) || [];
}

function formatJwtInfo(decoded, context) {
  const { header, payload } = decoded;
  const lines = [
    `[jwt-decode] ${context}`,
    `  alg: ${header.alg || "?"}  typ: ${header.typ || "?"}`,
  ];

  if (payload.sub) lines.push(`  sub: ${payload.sub}`);
  if (payload.iss) lines.push(`  iss: ${payload.iss}`);
  if (payload.aud) lines.push(`  aud: ${Array.isArray(payload.aud) ? payload.aud.join(", ") : payload.aud}`);
  if (payload.exp) {
    const expDate = new Date(payload.exp * 1000);
    const expired = expDate < new Date();
    lines.push(`  exp: ${expDate.toISOString()} ${expired ? "⚠️  EXPIRED" : "✓ valid"}`);
  }
  if (payload.iat) lines.push(`  iat: ${new Date(payload.iat * 1000).toISOString()}`);

  // Print remaining non-standard claims
  const standardClaims = new Set(["sub", "iss", "aud", "exp", "iat", "nbf", "jti"]);
  const custom = Object.entries(payload)
    .filter(([k]) => !standardClaims.has(k))
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join("\n");
  if (custom) lines.push(custom);

  return lines.join("\n");
}

module.exports = {
  async beforeRequest(ctx) {
    if (ctx.config.decodeRequest === "false") return;

    const auth = ctx.headers["Authorization"] || ctx.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (token) {
      const decoded = decodeJwt(token);
      if (decoded) {
        console.log(formatJwtInfo(decoded, "Request Authorization JWT"));
      }
    }
  },

  async afterResponse(ctx) {
    if (ctx.config.decodeResponse === "false") return;

    const tokens = findJwts(ctx.body);
    for (const token of tokens) {
      const decoded = decodeJwt(token);
      if (decoded) {
        console.log(formatJwtInfo(decoded, `Response JWT (${token.slice(0, 20)}...)`));
      }
    }

    // Optionally replace JWTs in response with annotated JSON
    if (ctx.config.annotateResponse === "true" && tokens.length > 0) {
      let body = ctx.body;
      for (const token of tokens) {
        const decoded = decodeJwt(token);
        if (decoded) {
          const annotation = JSON.stringify({ __jwt_decoded__: decoded, __jwt_raw__: token }, null, 2);
          body = body.replace(token, annotation);
        }
      }
      return { body };
    }
  },
};
