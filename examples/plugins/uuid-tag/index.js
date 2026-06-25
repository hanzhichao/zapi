/**
 * UUID Tag Plugin
 *
 * Usage:
 *   {{uuid-tag.v4}}          → e.g. 550e8400-e29b-41d4-a716-446655440000
 *   {{uuid-tag.short}}       → 8-char hex ID, e.g. a3f2c1b0
 *   {{uuid-tag.numeric(10)}} → 10-digit numeric ID, e.g. 4823910587
 */

module.exports = {
  templateTags: [
    {
      name: "v4",
      displayName: "UUID v4",
      description: "Generates a random UUID v4.",
      args: [],
      async resolve(_args, _config, crypto) {
        return crypto.randomUUID();
      },
    },
    {
      name: "short",
      displayName: "Short ID",
      description: "Generates an 8-character hexadecimal ID.",
      args: [{ name: "length", type: "number", default: "8" }],
      async resolve(args, _config, crypto) {
        const len = Math.min(32, Math.max(1, parseInt(args[0] || "8", 10)));
        const bytes = crypto.randomBytes(Math.ceil(len / 2));
        return crypto.hexEncode(bytes).slice(0, len);
      },
    },
    {
      name: "numeric",
      displayName: "Numeric ID",
      description: "Generates a random numeric ID of the given length.",
      args: [{ name: "length", type: "number", default: "10" }],
      async resolve(args, _config, crypto) {
        const len = Math.min(18, Math.max(1, parseInt(args[0] || "10", 10)));
        const bytes = crypto.randomBytes(8);
        // Build a BigInt from random bytes, then take modulo
        let num = 0n;
        for (const b of bytes) num = (num << 8n) | BigInt(b);
        const max = BigInt("9".repeat(len));
        const min = BigInt("1" + "0".repeat(len - 1));
        return String((num % (max - min + 1n)) + min);
      },
    },
  ],
};
