// proxy.rs — MITM HTTP/HTTPS intercepting proxy
//
// Flow (HTTPS / CONNECT):
//   Browser → CONNECT host:443 → proxy
//   Proxy   → 200 Established
//   Browser → TLS handshake (proxy acts as server, using domain cert signed by our CA)
//   Proxy   → connects to real host:443 (TLS, trusts system roots)
//   Proxy   → decrypts both sides, captures, forwards
//
// Flow (plain HTTP):
//   Browser → GET http://host/path HTTP/1.1 → proxy
//   Proxy   → forwards to host:80, captures, returns


use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, KeyPair, PKCS_ECDSA_P256_SHA256};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName};
use rustls::{ClientConfig, RootCertStore, ServerConfig};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_rustls::{TlsAcceptor, TlsConnector};
use uuid::Uuid;

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_CAPTURE_BYTES: usize = 1_048_576; // 1 MB body capture limit
const MAX_HEADER_BYTES: usize = 131_072;    // 128 KB header limit

// ── Data types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedRequest {
    pub id: String,
    pub timestamp: u64,
    pub state: String,          // "pending" | "done" | "error"
    pub scheme: String,         // "http" | "https"
    pub method: String,
    pub host: String,
    pub path: String,
    pub query: String,
    pub url: String,
    pub req_headers: Vec<[String; 2]>,
    pub req_body: String,       // UTF-8 text (or base64 for binary)
    pub req_body_size: u64,
    pub res_status: u16,
    pub res_status_text: String,
    pub res_headers: Vec<[String; 2]>,
    pub res_body: String,
    pub res_body_size: u64,
    pub res_content_type: String,
    pub duration_ms: u64,
    pub error: String,
    pub client_addr: String,
    pub pinned: bool,
    pub app_name: String,
}

impl CapturedRequest {
    fn new(id: &str, scheme: &str, method: &str, host: &str, path: &str,
           query: &str, client_addr: &str) -> Self {
        let url = if query.is_empty() {
            format!("{}://{}{}", scheme, host, path)
        } else {
            format!("{}://{}{}?{}", scheme, host, path, query)
        };
        CapturedRequest {
            id: id.to_string(),
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
            state: "pending".to_string(),
            scheme: scheme.to_string(),
            method: method.to_string(),
            host: host.to_string(),
            path: path.to_string(),
            query: query.to_string(),
            url,
            req_headers: Vec::new(),
            req_body: String::new(),
            req_body_size: 0,
            res_status: 0,
            res_status_text: String::new(),
            res_headers: Vec::new(),
            res_body: String::new(),
            res_body_size: 0,
            res_content_type: String::new(),
            duration_ms: 0,
            error: String::new(),
            client_addr: client_addr.to_string(),
            pinned: false,
            app_name: String::new(),
        }
    }
}

// Shared state for the proxy server
pub struct ProxyState {
    pub running: Arc<AtomicBool>,
    pub port: Arc<Mutex<u16>>,
    pub captures: Arc<Mutex<Vec<CapturedRequest>>>,
    pub ca_cert_pem: Arc<Mutex<String>>,
    pub ca_cert_der: Arc<Mutex<Vec<u8>>>,
    pub ca_key_der: Arc<Mutex<Vec<u8>>>,
    pub ca_cert_path: Arc<Mutex<PathBuf>>,
    // Cache: hostname → Arc<ServerConfig>  (avoid re-generating certs every conn)
    pub server_config_cache: Arc<DashMap<String, Arc<ServerConfig>>>,
    pub shutdown_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    pub client_tls_config: Arc<Mutex<Option<Arc<ClientConfig>>>>,
}

impl ProxyState {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            port: Arc::new(Mutex::new(9090)),
            captures: Arc::new(Mutex::new(Vec::new())),
            ca_cert_pem: Arc::new(Mutex::new(String::new())),
            ca_cert_der: Arc::new(Mutex::new(Vec::new())),
            ca_key_der: Arc::new(Mutex::new(Vec::new())),
            ca_cert_path: Arc::new(Mutex::new(PathBuf::new())),
            server_config_cache: Arc::new(DashMap::new()),
            shutdown_tx: Mutex::new(None),
            client_tls_config: Arc::new(Mutex::new(None)),
        }
    }
}

// ── CA Certificate management ─────────────────────────────────────────────────

fn ca_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("proxy_ca");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Generate a new root CA key + self-signed certificate.
fn generate_ca() -> Result<(Vec<u8>, Vec<u8>, String), String> {
    let key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256)
        .map_err(|e| e.to_string())?;

    let mut params = CertificateParams::default();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![
        rcgen::KeyUsagePurpose::KeyCertSign,
        rcgen::KeyUsagePurpose::CrlSign,
    ];
    params.distinguished_name.push(DnType::CommonName, "zapi Proxy CA");
    params.distinguished_name.push(DnType::OrganizationName, "zapi");
    params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    params.not_after  = rcgen::date_time_ymd(2034, 1, 1);

    let cert = params.self_signed(&key).map_err(|e| e.to_string())?;
    let cert_der = cert.der().to_vec();
    let cert_pem = cert.pem();
    let key_der  = key.serialize_der();

    Ok((cert_der, key_der, cert_pem))
}

/// Load or generate the CA cert, persisting to disk.
pub async fn ensure_ca(app: &AppHandle, state: &ProxyState) -> Result<(), String> {
    let dir  = ca_dir(app)?;
    let cert_path = dir.join("ca.crt");
    let key_path  = dir.join("ca.key.der");

    let (cert_der, key_der, cert_pem) = if cert_path.exists() && key_path.exists() {
        let cert_der = std::fs::read(&cert_path).map_err(|e| e.to_string())?;
        let key_der  = std::fs::read(&key_path).map_err(|e| e.to_string())?;
        // Rebuild PEM from DER
        let pem = pem_encode(&cert_der, "CERTIFICATE");
        (cert_der, key_der, pem)
    } else {
        let result = generate_ca()?;
        std::fs::write(&cert_path, &result.0).map_err(|e| e.to_string())?;
        std::fs::write(&key_path, &result.1).map_err(|e| e.to_string())?;
        result
    };

    *state.ca_cert_pem.lock().await  = cert_pem;
    *state.ca_cert_der.lock().await  = cert_der;
    *state.ca_key_der.lock().await   = key_der;
    *state.ca_cert_path.lock().await = cert_path;
    Ok(())
}

fn pem_encode(der: &[u8], label: &str) -> String {
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, der);
    let lines: Vec<String> = b64.as_bytes().chunks(64)
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect();
    format!("-----BEGIN {}-----\n{}\n-----END {}-----\n", label, lines.join("\n"), label)
}

// ── Per-domain certificate generation ────────────────────────────────────────

/// Get (or generate + cache) a ServerConfig for `hostname`.
fn get_server_config(
    hostname: &str,
    ca_cert_der: &[u8],
    ca_key_der: &[u8],
    cache: &DashMap<String, Arc<ServerConfig>>,
) -> Result<Arc<ServerConfig>, String> {
    // Strip port if present
    let host = hostname.split(':').next().unwrap_or(hostname);

    if let Some(cfg) = cache.get(host) {
        return Ok(Arc::clone(&cfg));
    }

    // Generate domain key
    let domain_key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256)
        .map_err(|e| e.to_string())?;

    // Reconstruct CA from saved DER.
    // from_ca_cert_der (x509-parser feature) gives us the params back.
    // Re-signing with the same key produces same public key → AKI chain still validates.
    let ca_cert_der_typed = CertificateDer::from(ca_cert_der.to_vec());
    let ca_key_der_typed = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(ca_key_der.to_vec()));
    let ca_key_loaded = KeyPair::from_der_and_sign_algo(&ca_key_der_typed, &PKCS_ECDSA_P256_SHA256)
        .map_err(|e| e.to_string())?;
    let ca_params = CertificateParams::from_ca_cert_der(&ca_cert_der_typed)
        .map_err(|e: rcgen::Error| e.to_string())?;
    // Re-self-sign with the same key to obtain a Certificate object usable as issuer.
    let ca_cert  = ca_params.self_signed(&ca_key_loaded).map_err(|e| e.to_string())?;
    let ca_kp    = ca_key_loaded;

    // Build domain cert params with SAN
    let san_name = if host.parse::<std::net::IpAddr>().is_ok() {
        host.to_string()
    } else {
        host.to_string()
    };
    let mut domain_params = CertificateParams::new(vec![san_name.clone()])
        .map_err(|e| e.to_string())?;
    domain_params.distinguished_name.push(DnType::CommonName, &san_name);
    domain_params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    domain_params.not_after  = rcgen::date_time_ymd(2034, 1, 1);

    let domain_cert = domain_params.signed_by(&domain_key, &ca_cert, &ca_kp)
        .map_err(|e| e.to_string())?;

    let cert_der = CertificateDer::from(domain_cert.der().to_vec());
    let key_der  = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(domain_key.serialize_der()));

    let server_cfg = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)
        .map_err(|e| e.to_string())?;

    let arc_cfg = Arc::new(server_cfg);
    cache.insert(host.to_string(), Arc::clone(&arc_cfg));
    Ok(arc_cfg)
}

/// Build the shared outbound ClientConfig (trusts system root certs via webpki-roots).
fn build_client_tls_config() -> Arc<ClientConfig> {
    let mut root_store = RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let cfg = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    Arc::new(cfg)
}

// ── HTTP Parsing utilities ────────────────────────────────────────────────────

/// Read bytes until `\r\n\r\n` is found (end of HTTP headers).
async fn read_headers_raw(stream: &mut (impl AsyncReadExt + Unpin)) -> io::Result<Vec<u8>> {
    let mut buf = Vec::with_capacity(4096);
    let mut tmp = [0u8; 1];
    loop {
        stream.read_exact(&mut tmp).await?;
        buf.push(tmp[0]);
        if buf.ends_with(b"\r\n\r\n") {
            return Ok(buf);
        }
        if buf.len() > MAX_HEADER_BYTES {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "headers too large"));
        }
    }
}

#[derive(Debug)]
struct ParsedRequest {
    method: String,
    path: String,         // already stripped of absolute URL prefix
    query: String,
    version: String,
    host: String,         // from Host header or absolute URL
    headers: Vec<[String; 2]>,
    content_length: Option<usize>,
    is_chunked: bool,
    keep_alive: bool,
}

#[derive(Debug)]
struct ParsedResponse {
    #[allow(dead_code)]
    version: String,
    status: u16,
    status_text: String,
    headers: Vec<[String; 2]>,
    content_length: Option<usize>,
    is_chunked: bool,
    keep_alive: bool,
}

fn parse_request_head(raw: &[u8]) -> Option<ParsedRequest> {
    let text = std::str::from_utf8(raw).ok()?;
    let mut lines = text.split("\r\n");
    let first = lines.next()?;
    let mut parts = first.splitn(3, ' ');
    let method  = parts.next()?.to_string();
    let raw_path = parts.next()?;
    let version = parts.next().unwrap_or("HTTP/1.1").to_string();

    // Parse the path: may be absolute (http://host/path) or relative (/path)
    let (host_from_url, path_str, query_str) = if raw_path.starts_with("http") {
        if let Ok(parsed) = url_parse_simple(raw_path) {
            (parsed.0, parsed.1, parsed.2)
        } else {
            (String::new(), raw_path.to_string(), String::new())
        }
    } else {
        let (p, q) = split_path_query(raw_path);
        (String::new(), p, q)
    };

    let mut headers = Vec::new();
    let mut host = host_from_url;
    let mut content_length: Option<usize> = None;
    let mut is_chunked = false;
    let mut keep_alive = version == "HTTP/1.1";

    for line in lines {
        if line.is_empty() { break; }
        if let Some((k, v)) = line.split_once(": ") {
            let k_low = k.to_lowercase();
            match k_low.as_str() {
                "host"             => { host = v.to_string(); }
                "content-length"   => { content_length = v.trim().parse().ok(); }
                "transfer-encoding" => { is_chunked = v.to_lowercase().contains("chunked"); }
                "connection"       => { keep_alive = !v.to_lowercase().contains("close"); }
                _ => {}
            }
            headers.push([k.to_string(), v.to_string()]);
        }
    }

    Some(ParsedRequest { method, path: path_str, query: query_str, version,
        host, headers, content_length, is_chunked, keep_alive })
}

fn parse_response_head(raw: &[u8]) -> Option<ParsedResponse> {
    let text = std::str::from_utf8(raw).ok()?;
    let mut lines = text.split("\r\n");
    let first = lines.next()?;
    let mut parts = first.splitn(3, ' ');
    let version = parts.next()?.to_string();
    let status: u16 = parts.next()?.parse().ok()?;
    let status_text = parts.next().unwrap_or("").to_string();

    let mut headers = Vec::new();
    let mut content_length: Option<usize> = None;
    let mut is_chunked = false;
    let mut keep_alive = version == "HTTP/1.1";

    for line in lines {
        if line.is_empty() { break; }
        if let Some((k, v)) = line.split_once(": ") {
            let k_low = k.to_lowercase();
            match k_low.as_str() {
                "content-length"    => { content_length = v.trim().parse().ok(); }
                "transfer-encoding" => { is_chunked = v.to_lowercase().contains("chunked"); }
                "connection"        => { keep_alive = !v.to_lowercase().contains("close"); }
                _ => {}
            }
            headers.push([k.to_string(), v.to_string()]);
        }
    }

    Some(ParsedResponse { version, status, status_text, headers,
        content_length, is_chunked, keep_alive })
}

fn split_path_query(raw: &str) -> (String, String) {
    if let Some(idx) = raw.find('?') {
        (raw[..idx].to_string(), raw[idx+1..].to_string())
    } else {
        (raw.to_string(), String::new())
    }
}

fn url_parse_simple(url: &str) -> Result<(String, String, String), ()> {
    // Extract host and path from http(s)://host/path?query
    let after_scheme = url.split("://").nth(1).ok_or(())?;
    let slash_pos = after_scheme.find('/').unwrap_or(after_scheme.len());
    let host = after_scheme[..slash_pos].to_string();
    let raw_path = if slash_pos < after_scheme.len() {
        after_scheme[slash_pos..].to_string()
    } else {
        "/".to_string()
    };
    let (path, query) = split_path_query(&raw_path);
    Ok((host, path, query))
}

/// Read the HTTP body (up to MAX_CAPTURE_BYTES), returns (captured_bytes, full_body_size).
async fn read_body_capped(
    stream: &mut (impl AsyncReadExt + Unpin),
    content_length: Option<usize>,
    is_chunked: bool,
) -> io::Result<(Vec<u8>, u64)> {
    if is_chunked {
        return read_chunked_body_capped(stream).await;
    }
    if let Some(len) = content_length {
        if len == 0 { return Ok((Vec::new(), 0)); }
        let cap = len.min(MAX_CAPTURE_BYTES);
        let mut buf = vec![0u8; len];
        stream.read_exact(&mut buf).await?;
        let captured = buf[..cap].to_vec();
        Ok((captured, len as u64))
    } else {
        Ok((Vec::new(), 0))
    }
}

async fn read_chunked_body_capped(
    stream: &mut (impl AsyncReadExt + Unpin),
) -> io::Result<(Vec<u8>, u64)> {
    let mut decoded = Vec::new();
    let mut total: u64 = 0;

    loop {
        // Read chunk size line
        let mut line = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            stream.read_exact(&mut byte).await?;
            if byte[0] == b'\n' { break; }
            if byte[0] != b'\r' { line.push(byte[0]); }
        }
        let size_str = String::from_utf8_lossy(&line);
        // Strip chunk extensions (;...)
        let size_str = size_str.split(';').next().unwrap_or("").trim();
        let chunk_size = usize::from_str_radix(size_str, 16)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "bad chunk size"))?;

        if chunk_size == 0 {
            // Read trailing CRLF
            let mut crlf = [0u8; 2];
            stream.read_exact(&mut crlf).await?;
            break;
        }

        let mut chunk = vec![0u8; chunk_size];
        stream.read_exact(&mut chunk).await?;

        // Read trailing CRLF after chunk data
        let mut crlf = [0u8; 2];
        stream.read_exact(&mut crlf).await?;

        total += chunk_size as u64;
        if decoded.len() < MAX_CAPTURE_BYTES {
            let take = (MAX_CAPTURE_BYTES - decoded.len()).min(chunk_size);
            decoded.extend_from_slice(&chunk[..take]);
        }
    }

    Ok((decoded, total))
}

/// Convert body bytes to a display string (UTF-8 or base64).
fn body_to_string(bytes: &[u8], content_type: &str) -> String {
    let is_text = content_type.is_empty()
        || content_type.contains("text")
        || content_type.contains("json")
        || content_type.contains("xml")
        || content_type.contains("javascript")
        || content_type.contains("form-urlencoded");

    if is_text {
        String::from_utf8_lossy(bytes).into_owned()
    } else {
        // base64 prefix so the UI can detect binary
        format!("[binary:base64]{}",
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes))
    }
}

// ── Core forwarding engine ────────────────────────────────────────────────────

/// Make one outbound HTTP request to `host:port` and return the response.
/// `use_tls`: if true, connect over TLS (for HTTPS MITM outbound).
/// `raw_request_head`: the original bytes of the HTTP request head (to forward as-is).
async fn forward_request(
    host: &str,
    port: u16,
    use_tls: bool,
    raw_head: &[u8],
    body: &[u8],
    client_cfg: Arc<ClientConfig>,
) -> Result<(Vec<u8>, Vec<u8>, u64), String> {
    // Connect to real server
    let addr = format!("{}:{}", host, port);
    let tcp = TcpStream::connect(&addr).await
        .map_err(|e| format!("connect {}: {}", addr, e))?;

    let (raw_resp_head, resp_body, resp_body_size) = if use_tls {
        let connector = TlsConnector::from(client_cfg);
        let server_name = ServerName::try_from(host.to_string())
            .map_err(|_| format!("invalid server name: {}", host))?;
        let mut tls = connector.connect(server_name, tcp).await
            .map_err(|e| format!("TLS connect {}: {}", host, e))?;

        tls.write_all(raw_head).await.map_err(|e| e.to_string())?;
        tls.write_all(body).await.map_err(|e| e.to_string())?;

        read_full_response(&mut tls).await.map_err(|e| e.to_string())?
    } else {
        let mut tcp = tcp;
        tcp.write_all(raw_head).await.map_err(|e| e.to_string())?;
        tcp.write_all(body).await.map_err(|e| e.to_string())?;

        read_full_response(&mut tcp).await.map_err(|e| e.to_string())?
    };

    Ok((raw_resp_head, resp_body, resp_body_size))
}

async fn read_full_response(
    stream: &mut (impl AsyncReadExt + Unpin),
) -> io::Result<(Vec<u8>, Vec<u8>, u64)> {
    let raw_head = read_headers_raw(stream).await?;
    let parsed = parse_response_head(&raw_head)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "bad response head"))?;

    // Don't read body for 1xx/204/304
    let skip_body = parsed.status / 100 == 1
        || parsed.status == 204
        || parsed.status == 304;

    let (body, body_size) = if skip_body {
        (Vec::new(), 0u64)
    } else {
        read_body_capped(stream, parsed.content_length, parsed.is_chunked).await?
    };

    Ok((raw_head, body, body_size))
}

/// Build the raw HTTP/1.1 request head bytes to send to the server,
/// stripping proxy-specific headers and absolute URL prefix.
fn build_forwarded_request_head(parsed: &ParsedRequest, body_len: usize) -> Vec<u8> {
    let hop_by_hop = ["proxy-connection", "proxy-authorization", "proxy-authenticate",
                      "te", "trailer", "upgrade", "keep-alive"];

    let path_and_query = if parsed.query.is_empty() {
        parsed.path.clone()
    } else {
        format!("{}?{}", parsed.path, parsed.query)
    };

    let mut out = format!("{} {} {}\r\n", parsed.method, path_and_query, parsed.version);

    let mut has_host = false;
    let mut has_content_length = false;

    for [k, v] in &parsed.headers {
        let k_low = k.to_lowercase();
        if hop_by_hop.contains(&k_low.as_str()) { continue; }
        if k_low == "host" { has_host = true; }
        if k_low == "content-length" { has_content_length = true; }
        out.push_str(&format!("{}: {}\r\n", k, v));
    }

    if !has_host && !parsed.host.is_empty() {
        out.push_str(&format!("Host: {}\r\n", parsed.host));
    }
    // Override content-length if body was read
    if !has_content_length && body_len > 0 {
        out.push_str(&format!("Content-Length: {}\r\n", body_len));
    }
    out.push_str("Connection: close\r\n\r\n");
    out.into_bytes()
}

// ── Connection handlers ────────────────────────────────────────────────────────

/// Handle one accepted TCP connection.
async fn handle_connection(
    mut stream: TcpStream,
    state: Arc<ProxyState>,
    app: AppHandle,
) {
    let peer = stream.peer_addr().map(|a| a.to_string()).unwrap_or_default();

    let raw_head = match read_headers_raw(&mut stream).await {
        Ok(h) => h,
        Err(_) => return,
    };

    let parsed = match parse_request_head(&raw_head) {
        Some(p) => p,
        None => return,
    };

    if parsed.method == "CONNECT" {
        // HTTPS MITM
        let (host, port) = if let Some(idx) = parsed.path.rfind(':') {
            let port: u16 = parsed.path[idx+1..].parse().unwrap_or(443);
            (parsed.path[..idx].to_string(), port)
        } else {
            (parsed.path.clone(), 443)
        };

        // Acknowledge the CONNECT
        let _ = stream.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await;

        handle_tls_mitm(stream, host, port, state, app, peer).await;
    } else {
        // Plain HTTP proxy
        handle_plain_http(stream, raw_head, parsed, state, app, peer).await;
    }
}

/// Handle plain HTTP forwarding (no TLS).
async fn handle_plain_http(
    mut client_stream: TcpStream,
    _raw_head: Vec<u8>,
    parsed: ParsedRequest,
    state: Arc<ProxyState>,
    app: AppHandle,
    peer: String,
) {
    let host = parsed.host.clone();
    let (host_name, port) = if let Some(idx) = host.rfind(':') {
        let port: u16 = host[idx+1..].parse().unwrap_or(80);
        (host[..idx].to_string(), port)
    } else {
        (host.clone(), 80)
    };

    let id = Uuid::new_v4().to_string();
    let mut capture = CapturedRequest::new(
        &id, "http", &parsed.method, &host, &parsed.path, &parsed.query, &peer);
    capture.req_headers = parsed.headers.clone();

    let body_data = {
        let mut body_buf = Vec::new();
        if let Some(cl) = parsed.content_length {
            if cl > 0 {
                body_buf.resize(cl.min(MAX_CAPTURE_BYTES), 0);
                let _ = client_stream.read_exact(&mut body_buf).await;
            }
        }
        body_buf
    };

    capture.req_body = body_to_string(&body_data, "");
    capture.req_body_size = body_data.len() as u64;

    // Emit pending
    emit_capture(&app, &capture).await;
    add_capture(&state.captures, capture.clone()).await;

    let client_cfg = {
        let lock = state.client_tls_config.lock().await;
        match lock.as_ref() {
            Some(c) => Arc::clone(c),
            None => build_client_tls_config(),
        }
    };

    let fwd_head = build_forwarded_request_head(&parsed, body_data.len());
    let start = Instant::now();

    match forward_request(&host_name, port, false, &fwd_head, &body_data, client_cfg).await {
        Ok((resp_head_raw, resp_body, resp_body_size)) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            let resp_parsed = parse_response_head(&resp_head_raw);

            // Forward to client
            let _ = client_stream.write_all(&resp_head_raw).await;
            let _ = client_stream.write_all(&resp_body).await;

            if let Some(rp) = resp_parsed {
                let ct = rp.headers.iter()
                    .find(|[k, _]| k.to_lowercase() == "content-type")
                    .map(|[_, v]| v.clone())
                    .unwrap_or_default();
                capture.state = "done".to_string();
                capture.res_status = rp.status;
                capture.res_status_text = rp.status_text;
                capture.res_headers = rp.headers;
                capture.res_body = body_to_string(&resp_body, &ct);
                capture.res_body_size = resp_body_size;
                capture.res_content_type = ct;
                capture.duration_ms = duration_ms;
            }
        }
        Err(e) => {
            capture.state = "error".to_string();
            capture.error = e.clone();
            let err_body = format!("HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{}", e.len(), e);
            let _ = client_stream.write_all(err_body.as_bytes()).await;
        }
    }

    update_capture(&state.captures, &capture).await;
    emit_capture(&app, &capture).await;
}

/// Handle HTTPS MITM: perform TLS handshake with client, then proxy plaintext HTTP.
async fn handle_tls_mitm(
    tcp: TcpStream,
    host: String,
    port: u16,
    state: Arc<ProxyState>,
    app: AppHandle,
    peer: String,
) {
    let ca_cert_der = state.ca_cert_der.lock().await.clone();
    let ca_key_der  = state.ca_key_der.lock().await.clone();

    if ca_cert_der.is_empty() {
        return;
    }

    let server_cfg = match get_server_config(
        &host, &ca_cert_der, &ca_key_der, &state.server_config_cache) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[proxy] cert gen error for {}: {}", host, e);
            return;
        }
    };

    let acceptor = TlsAcceptor::from(server_cfg);
    let mut tls = match acceptor.accept(tcp).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[proxy] TLS accept error for {}: {}", host, e);
            return;
        }
    };

    let client_cfg = {
        let lock = state.client_tls_config.lock().await;
        match lock.as_ref() {
            Some(c) => Arc::clone(c),
            None => build_client_tls_config(),
        }
    };

    // Handle keep-alive loop inside the TLS tunnel
    loop {
        let raw_head = match read_headers_raw(&mut tls).await {
            Ok(h) => h,
            Err(_) => break,
        };

        let parsed = match parse_request_head(&raw_head) {
            Some(p) => p,
            None => break,
        };

        let keep_alive = parsed.keep_alive;

        // Read request body
        let (req_body, req_body_size) = match
            read_body_capped(&mut tls, parsed.content_length, parsed.is_chunked).await {
            Ok(b) => b,
            Err(_) => break,
        };

        let id = Uuid::new_v4().to_string();
        let mut capture = CapturedRequest::new(
            &id, "https", &parsed.method, &host,
            &parsed.path, &parsed.query, &peer);
        capture.req_headers = parsed.headers.clone();
        capture.req_body = body_to_string(&req_body, "");
        capture.req_body_size = req_body_size;

        emit_capture(&app, &capture).await;
        add_capture(&state.captures, capture.clone()).await;

        let fwd_head = build_forwarded_request_head(&parsed, req_body.len());
        let start = Instant::now();

        match forward_request(&host, port, true, &fwd_head, &req_body, Arc::clone(&client_cfg)).await {
            Ok((resp_head_raw, resp_body, resp_body_size)) => {
                let duration_ms = start.elapsed().as_millis() as u64;
                let resp_parsed = parse_response_head(&resp_head_raw);

                // Forward full response to client
                if tls.write_all(&resp_head_raw).await.is_err() { break; }
                if tls.write_all(&resp_body).await.is_err() { break; }

                if let Some(rp) = resp_parsed {
                    let ct = rp.headers.iter()
                        .find(|[k, _]| k.to_lowercase() == "content-type")
                        .map(|[_, v]| v.clone())
                        .unwrap_or_default();
                    let server_keep_alive = rp.keep_alive;
                    capture.state = "done".to_string();
                    capture.res_status = rp.status;
                    capture.res_status_text = rp.status_text;
                    capture.res_headers = rp.headers;
                    capture.res_body = body_to_string(&resp_body, &ct);
                    capture.res_body_size = resp_body_size;
                    capture.res_content_type = ct;
                    capture.duration_ms = duration_ms;

                    if !keep_alive || !server_keep_alive {
                        update_capture(&state.captures, &capture).await;
                        emit_capture(&app, &capture).await;
                        break;
                    }
                } else {
                    break;
                }
            }
            Err(e) => {
                capture.state = "error".to_string();
                capture.error = e.clone();
                let err_body = format!("HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", e.len(), e);
                let _ = tls.write_all(err_body.as_bytes()).await;
                update_capture(&state.captures, &capture).await;
                emit_capture(&app, &capture).await;
                break;
            }
        }

        update_capture(&state.captures, &capture).await;
        emit_capture(&app, &capture).await;
    }
}

// ── Capture helpers ───────────────────────────────────────────────────────────

async fn emit_capture(app: &AppHandle, capture: &CapturedRequest) {
    let _ = app.emit("proxy:capture", capture.clone());
}

async fn add_capture(captures: &Arc<Mutex<Vec<CapturedRequest>>>, capture: CapturedRequest) {
    let mut lock = captures.lock().await;
    lock.push(capture);
    // Keep last 5000 captures
    if lock.len() > 5000 {
        let drain = lock.len() - 5000;
        lock.drain(..drain);
    }
}

async fn update_capture(captures: &Arc<Mutex<Vec<CapturedRequest>>>, capture: &CapturedRequest) {
    let mut lock = captures.lock().await;
    if let Some(c) = lock.iter_mut().find(|c| c.id == capture.id) {
        *c = capture.clone();
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxy_start(
    port: u16,
    app: AppHandle,
    state: tauri::State<'_, ProxyState>,
) -> Result<(), String> {
    // Stop existing
    {
        let mut tx = state.shutdown_tx.lock().await;
        if let Some(sender) = tx.take() {
            let _ = sender.send(());
        }
    }

    // Ensure CA cert is ready
    ensure_ca(&app, &state).await?;

    // Build outbound TLS config
    {
        let mut lock = state.client_tls_config.lock().await;
        *lock = Some(build_client_tls_config());
    }

    *state.port.lock().await = port;

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await
        .map_err(|e| format!("Cannot bind port {}: {}", port, e))?;

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    *state.shutdown_tx.lock().await = Some(tx);

    let captures = Arc::clone(&state.captures);
    let ca_cert_pem = Arc::clone(&state.ca_cert_pem);
    let ca_cert_der = Arc::clone(&state.ca_cert_der);
    let ca_key_der  = Arc::clone(&state.ca_key_der);
    let cert_cache  = Arc::clone(&state.server_config_cache);
    let client_tls  = Arc::clone(&state.client_tls_config);
    let running     = Arc::clone(&state.running);

    running.store(true, Ordering::Relaxed);

    let shared_state = Arc::new(ProxyState {
        running: Arc::clone(&running),
        port: Arc::new(Mutex::new(port)),
        captures,
        ca_cert_pem,
        ca_cert_der,
        ca_key_der,
        ca_cert_path: Arc::new(Mutex::new(PathBuf::new())),
        server_config_cache: cert_cache,
        shutdown_tx: Mutex::new(None),
        client_tls_config: client_tls,
    });

    tokio::spawn(async move {
        tokio::pin!(rx);
        loop {
            tokio::select! {
                result = listener.accept() => {
                    if let Ok((stream, _)) = result {
                        let s = Arc::clone(&shared_state);
                        let a = app.clone();
                        tokio::spawn(handle_connection(stream, s, a));
                    }
                }
                _ = &mut rx => { break; }
            }
        }
        running.store(false, Ordering::Relaxed);
        let _ = app.emit("proxy:status", serde_json::json!({ "running": false }));
    });

    Ok(())
}

#[tauri::command]
pub async fn proxy_stop(state: tauri::State<'_, ProxyState>) -> Result<(), String> {
    let mut tx = state.shutdown_tx.lock().await;
    if let Some(sender) = tx.take() {
        let _ = sender.send(());
    }
    state.running.store(false, Ordering::Relaxed);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatusResult {
    pub running: bool,
    pub port: u16,
    pub capture_count: usize,
    pub ca_cert_pem: String,
    pub ca_cert_path: String,
}

#[tauri::command]
pub async fn proxy_status(state: tauri::State<'_, ProxyState>) -> Result<ProxyStatusResult, String> {
    Ok(ProxyStatusResult {
        running: state.running.load(Ordering::Relaxed),
        port: *state.port.lock().await,
        capture_count: state.captures.lock().await.len(),
        ca_cert_pem: state.ca_cert_pem.lock().await.clone(),
        ca_cert_path: state.ca_cert_path.lock().await.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn proxy_get_captures(
    state: tauri::State<'_, ProxyState>,
) -> Result<Vec<CapturedRequest>, String> {
    Ok(state.captures.lock().await.clone())
}

#[tauri::command]
pub async fn proxy_clear_captures(state: tauri::State<'_, ProxyState>) -> Result<(), String> {
    state.captures.lock().await.clear();
    Ok(())
}

#[tauri::command]
pub async fn proxy_get_ca_cert_pem(state: tauri::State<'_, ProxyState>) -> Result<String, String> {
    Ok(state.ca_cert_pem.lock().await.clone())
}

#[tauri::command]
pub async fn proxy_get_ca_cert_path(state: tauri::State<'_, ProxyState>) -> Result<String, String> {
    Ok(state.ca_cert_path.lock().await.to_string_lossy().to_string())
}

/// Install the CA cert to the system trust store.
///
/// macOS strategy (three-tier fallback):
///   1. Login keychain — no admin required; macOS shows a native password dialog.
///      This works on Monterey / Ventura / Sonoma where the old osascript approach
///      fails with "SecTrustSettingsSetTrustSettings: authorization denied".
///   2. System keychain via osascript with-administrator-privileges (legacy path).
///   3. Open the cert file so the user can add it manually in Keychain Access.
#[tauri::command]
pub async fn proxy_install_ca_cert(
    _app: AppHandle,
    state: tauri::State<'_, ProxyState>,
) -> Result<(), String> {
    let cert_path = state.ca_cert_path.lock().await.clone();
    if cert_path.as_os_str().is_empty() {
        return Err("CA cert not generated yet. Start the proxy first.".into());
    }
    let path_str = cert_path.to_string_lossy().into_owned();

    #[cfg(target_os = "macos")]
    {
        // ── Tier 1: login keychain (user-level, no admin, native dialog) ──────
        let home = std::env::var("HOME").unwrap_or_else(|_| String::from("~"));
        let login_kc_db  = format!("{}/Library/Keychains/login.keychain-db", home);
        let login_kc_old = format!("{}/Library/Keychains/login.keychain", home);
        let login_kc = if std::path::Path::new(&login_kc_db).exists() {
            login_kc_db
        } else {
            login_kc_old
        };

        // security add-trusted-cert prompts the user with a native macOS
        // "Keychain Access wants to make changes" dialog — no osascript needed.
        let out1 = std::process::Command::new("security")
            .args([
                "add-trusted-cert",
                "-d",
                "-r", "trustRoot",
                "-k", &login_kc,
                &path_str,
            ])
            .output();

        match out1 {
            Ok(o) if o.status.success() => return Ok(()),
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                // User explicitly cancelled the dialog
                if stderr.contains("cancel") || stderr.contains("-128") {
                    return Err("Trust dialog cancelled by user.".into());
                }
                // Fall through to tier 2
                eprintln!("[proxy] login keychain install failed ({}): {}", o.status, stderr.trim());
            }
            Err(e) => eprintln!("[proxy] security binary not found: {}", e),
        }

        // ── Tier 2: system keychain via osascript (admin password dialog) ────
        let escaped = path_str.replace('\'', "'\\''");
        let script = format!(
            "do shell script \"security add-trusted-cert -d -r trustRoot -k '/Library/Keychains/System.keychain' '{}'\" with administrator privileges",
            escaped
        );
        let out2 = std::process::Command::new("osascript")
            .args(["-e", &script])
            .output();

        match out2 {
            Ok(o) if o.status.success() => return Ok(()),
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                if stderr.contains("-128") || stderr.contains("cancel") {
                    return Err("Authorization cancelled by user.".into());
                }
                eprintln!("[proxy] system keychain install failed: {}", stderr.trim());
            }
            Err(e) => eprintln!("[proxy] osascript not found: {}", e),
        }

        // ── Tier 3: open in Keychain Access for manual trust ─────────────────
        let _ = std::process::Command::new("open").arg(&path_str).spawn();
        Err(
            "Automatic install failed. The certificate has been opened in Finder — \
             double-click it to add to Keychain Access, then set Trust to 'Always Trust'."
                .into(),
        )
    }

    #[cfg(target_os = "windows")]
    {
        // certutil requires admin; wrap in a UAC-elevated process
        let output = std::process::Command::new("powershell")
            .args([
                "-Command",
                &format!(
                    "Start-Process certutil -ArgumentList '-addstore','ROOT','{}' -Verb RunAs -Wait",
                    path_str.replace('\'', "''")
                ),
            ])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        // Try update-ca-certificates (Debian/Ubuntu) and update-ca-trust (RHEL/Arch)
        let dest_debian = "/usr/local/share/ca-certificates/zapi-proxy-ca.crt";
        let dest_rhel   = "/etc/pki/ca-trust/source/anchors/zapi-proxy-ca.crt";

        let script = format!(
            "cp '{path}' '{d}' && update-ca-certificates 2>/dev/null; \
             cp '{path}' '{r}' && update-ca-trust extract 2>/dev/null; true",
            path = path_str.replace('\'', "'\\''"),
            d = dest_debian,
            r = dest_rhel,
        );
        let output = std::process::Command::new("pkexec")
            .args(["sh", "-c", &script])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn proxy_pin_request(
    id: String,
    pinned: bool,
    state: tauri::State<'_, ProxyState>,
) -> Result<(), String> {
    let mut captures = state.captures.lock().await;
    if let Some(c) = captures.iter_mut().find(|c| c.id == id) {
        c.pinned = pinned;
    }
    Ok(())
}

#[tauri::command]
pub async fn proxy_delete_capture(
    id: String,
    state: tauri::State<'_, ProxyState>,
) -> Result<(), String> {
    let mut captures = state.captures.lock().await;
    captures.retain(|c| c.id != id);
    Ok(())
}
