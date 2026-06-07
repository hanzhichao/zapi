<div align="center">
  <img src="public/logo.png" alt="ZApi Logo" width="320" />
  <br/>
  <br/>
  <strong>A fast, modern, local-first API testing client</strong>
  <br/>
  Built with Tauri 2 · Next.js 15 · Rust
  <br/><br/>

  [🇨🇳 中文文档](README.zh-CN.md)
</div>

---

![ZApi Screenshot](public/screenshot.png)

## ✨ Features

- **Request Editor** — Full HTTP method support (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) with Params, Headers, Body, Auth tabs
- **Script Engine** — Pre-request scripts and test assertions via the `zapi.*` API (Postman-compatible), with `console.log` capture
- **Console Panel** — DevTools-style bottom panel showing script logs and HTTP request/response logs in real time
- **Environments** — Create named environments, manage variables, override per-request; env vars take precedence over collection vars
- **Collections & Runner** — Organize requests into collections, run them sequentially (functional mode) or as a load test (performance mode)
- **Performance Testing** — Rust-powered concurrent HTTP load testing inspired by [rs-wrk](https://github.com/codeb2cc/rs-wrk): configurable connections, duration, rate limiting, timeouts, per-request latency percentiles
- **Live Stats** — Real-time TPS, error rate, and latency display during load tests (via Tauri event system)
- **Run Reports** — Functional reports with per-request pass/fail and test assertion details; performance reports with p50/p90/p99/p99.9 latency distribution
- **Rerun** — Re-execute a report in one click preserving the exact request order
- **Layouts** — Toggle between vertical (stacked) and horizontal (side-by-side) request/response panels
- **History** — Full request history with one-click replay
- **Dark / Light mode** — System-aware theme toggle

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://v2.tauri.app/) (Rust) |
| Frontend | [Next.js 15](https://nextjs.org/) · React 19 · TypeScript |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) |
| UI primitives | [Radix UI](https://www.radix-ui.com/) |
| State | [Zustand](https://github.com/pmndrs/zustand) + `persist` |
| HTTP client (perf) | [reqwest](https://github.com/seanmonstar/reqwest) (Rust, async) |

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20
- [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/) stable toolchain
- Platform Tauri dependencies — see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
git clone https://github.com/yourname/zapi
cd zapi
pnpm install
pnpm tauri dev
```

The app opens in a Tauri window. The Next.js dev server runs on `http://localhost:3000`.

### Production Build

```bash
# macOS
pnpm tauri build

# macOS (Intel)
pnpm tauri build --target x86_64-apple-darwin

# Windows (cross-compile)
pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc
```

### Mobile (experimental)

```bash
# Android
pnpm tauri android init
pnpm tauri android build --apk

# iOS
pnpm tauri ios init
pnpm tauri ios build
```

## 📁 Project Structure

```
zapi/
├── src/                    # Next.js frontend
│   ├── app/                # App Router pages & layout
│   ├── components/         # React components
│   │   ├── RequestEditor.tsx
│   │   ├── ResponseViewer.tsx
│   │   ├── RunnerPanel.tsx
│   │   ├── RunnerReport.tsx
│   │   ├── ConsolePanel.tsx
│   │   └── ...
│   └── lib/                # State, types, utilities
│       ├── store.ts        # Zustand store
│       ├── types.ts        # Shared TypeScript types
│       ├── pm.ts           # zapi.* script engine
│       └── http-client.ts  # HTTP execution
├── src-tauri/              # Tauri / Rust backend
│   ├── src/lib.rs          # Rust performance test engine
│   └── tauri.conf.json
└── public/                 # Static assets & logos
```

## 🧪 Script API (`zapi.*`)

Pre-request scripts and tests use a Postman-compatible API exposed as `zapi`:

```javascript
// Pre-Script: runs before the request
zapi.environment.set("token", "abc123");
zapi.request.headers.add({ key: "Authorization", value: "Bearer " + zapi.environment.get("token") });

// Tests: run after the response
zapi.test("Status is 200", () => {
  zapi.response.to.have.status(200);
});

zapi.test("Has user id", () => {
  const json = zapi.response.json();
  zapi.expect(json).to.have.property("id");
});

// Save response value back to environment
zapi.environment.set("userId", zapi.response.json().id);
```

Console output from scripts is captured and shown in the **Console Panel** (toolbar `⌨` button).

## 📄 License

MIT
