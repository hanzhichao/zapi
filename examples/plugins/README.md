# zapi Plugin Examples

Example plugins for zapi. Each folder is a self-contained plugin ready to install.

## Installing an Example Plugin

1. Open zapi → click the **Puzzle** icon in the sidebar → **Plugin Manager**
2. Click **Install Plugin**
3. Select one of the folders below
4. Enable the plugin with the toggle

---

## Available Example Plugins

### `timestamp-tag`
Adds template tags for the current time.

| Tag | Example Output |
|-----|---------------|
| `{{timestamp-tag.now}}` | `1718000000000` |
| `{{timestamp-tag.unix}}` | `1718000000` |
| `{{timestamp-tag.iso}}` | `2024-06-10T08:00:00.000Z` |
| `{{timestamp-tag.date}}` | `2024-06-10` |
| `{{timestamp-tag.future(3600000)}}` | timestamp 1 hour from now |

---

### `uuid-tag`
Generates random identifiers.

| Tag | Example Output |
|-----|---------------|
| `{{uuid-tag.v4}}` | `550e8400-e29b-41d4-a716-446655440000` |
| `{{uuid-tag.short}}` | `a3f2c1b0` |
| `{{uuid-tag.short(12)}}` | `a3f2c1b0e9f4` |
| `{{uuid-tag.numeric(10)}}` | `4823910587` |

---

### `hmac-auth`
Signs every request with HMAC-SHA256. Compatible with Stripe, Shopify, and custom auth schemes.

**Config:**
- `secretKey` – your shared secret
- `headerName` – header to inject (default `X-Signature`)
- `algorithm` – hex or base64
- `signContent` – what to include in the signed message
- `timestampHeader` – also inject `X-Timestamp`

---

### `jwt-decode`
Decodes JWT tokens automatically without needing the secret.

**What it does:**
- Logs decoded header + payload to the **Plugin Console** tab
- Shows expiration status (✓ valid / ⚠️ EXPIRED)
- Optionally annotates response bodies containing JWTs

**Config:**
- `decodeRequest` – decode JWT in `Authorization: Bearer` header
- `decodeResponse` – decode JWTs found in response body
- `annotateResponse` – replace JWT strings in response with decoded JSON

---

### `aws-sigv4`
Full AWS Signature Version 4 implementation for authenticating with AWS services.

**Works with:** API Gateway, S3, Lambda, DynamoDB, and any other AWS service.

**Config:**
- `accessKeyId` – AWS Access Key ID
- `secretAccessKey` – AWS Secret Access Key
- `sessionToken` – (optional) STS session token
- `region` – AWS region (default: `us-east-1`)
- `service` – AWS service name (default: `execute-api`)

---

## Writing Your Own Plugin

See the **Plugin Development Guide** inside the Plugin Manager (📖 button),
or read [`PLUGIN_DEV.md`](../../docs/PLUGIN_DEV.md).

### Minimal plugin structure

```
my-plugin/
  plugin.json   ← manifest
  index.js      ← CommonJS module with hook exports
```

### `plugin.json`
```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "...",
  "hooks": ["beforeRequest"],
  "config": []
}
```

### `index.js`
```javascript
module.exports = {
  async beforeRequest(ctx) {
    // ctx.method, ctx.url, ctx.headers, ctx.body
    // ctx.config   ← your plugin's config values
    // ctx.crypto   ← hmacSha256, sha256, base64Encode, randomUUID, ...
    ctx.headers['X-Custom'] = 'hello';
    return ctx;
  },

  async afterResponse(ctx) {
    console.log('Response status:', ctx.status);
  },

  templateTags: [{
    name: 'greet',
    async resolve(args, config) {
      return `Hello, ${args[0] || 'world'}!`;
    }
  }]
};
```

Use it: `{{my-plugin.greet("Alice")}}` → `Hello, Alice!`
