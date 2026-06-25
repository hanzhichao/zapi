mod proxy;
mod plugins;
pub use proxy::ProxyState;

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

#[tauri::command]
fn greet() -> String {
  let now = std::time::SystemTime::now();
  let epoch_ms = now
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap()
    .as_millis();
  format!("Hello world from Rust! Current epoch: {}", epoch_ms)
}

// ── Performance test ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
pub struct SingleRequestConfig {
  pub url: String,
  pub method: String,
  pub headers: Vec<(String, String)>,
  pub body: Option<String>,
  pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct PerfTestRequest {
  pub requests: Vec<SingleRequestConfig>,
  pub concurrency: u32,
  pub duration_secs: u64,
  pub rate_limit: u32,
  pub timeout_ms: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerfProgress {
  pub elapsed_ms: u64,
  pub requests_total: u64,
  pub errors: u64,
  pub requests_per_sec: f64,
  pub avg_latency_ms: f64,
  pub bytes_per_sec: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerRequestStats {
  pub name: String,
  pub url: String,
  pub requests_total: u64,
  pub errors: u64,
  pub avg_latency_ms: f64,
  pub p99_ms: f64,
  pub status_codes: HashMap<String, u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfStats {
  pub requests_total: u64,
  pub requests_per_sec: f64,
  pub avg_latency_ms: f64,
  pub min_latency_ms: f64,
  pub max_latency_ms: f64,
  pub p50_ms: f64,
  pub p75_ms: f64,
  pub p90_ms: f64,
  pub p99_ms: f64,
  pub p999_ms: f64,
  pub bytes_total: u64,
  pub bytes_per_sec: f64,
  pub errors: u64,
  pub duration_ms: u64,
  pub status_codes: HashMap<String, u64>,
  pub per_request: Vec<PerRequestStats>,
}

struct WorkerStats {
  latencies_us: Vec<u64>,
  errors: u64,
  bytes: u64,
  status_codes: HashMap<u16, u64>,
  // Per-request: index → stats
  per_req: Vec<ReqStats>,
}

#[derive(Default)]
struct ReqStats {
  latencies_us: Vec<u64>,
  errors: u64,
  status_codes: HashMap<u16, u64>,
}

impl WorkerStats {
  fn new(n_requests: usize) -> Self {
    Self {
      latencies_us: Vec::new(),
      errors: 0,
      bytes: 0,
      status_codes: HashMap::new(),
      per_req: (0..n_requests).map(|_| ReqStats::default()).collect(),
    }
  }
}

fn percentile(sorted: &[u64], p: f64) -> f64 {
  if sorted.is_empty() {
    return 0.0;
  }
  let idx = ((p / 100.0) * sorted.len() as f64) as usize;
  sorted[idx.min(sorted.len() - 1)] as f64 / 1000.0
}

#[tauri::command]
async fn run_performance_test(
  app: tauri::AppHandle,
  config: PerfTestRequest,
) -> Result<PerfStats, String> {
  if config.requests.is_empty() {
    return Err("No requests provided".into());
  }

  let client = reqwest::Client::builder()
    .timeout(Duration::from_millis(config.timeout_ms))
    .pool_max_idle_per_host(config.concurrency as usize)
    .build()
    .map_err(|e| e.to_string())?;

  let client = Arc::new(client);
  let config = Arc::new(config);
  let done = Arc::new(AtomicBool::new(false));

  // Atomic counters for real-time reporting
  let rt_requests = Arc::new(AtomicU64::new(0));
  let rt_errors = Arc::new(AtomicU64::new(0));
  let rt_bytes = Arc::new(AtomicU64::new(0));
  let rt_latency_sum = Arc::new(AtomicU64::new(0)); // sum in microseconds
  let rt_latency_count = Arc::new(AtomicU64::new(0));

  // Full stats collector (for final percentiles)
  let all_stats: Arc<Mutex<Vec<WorkerStats>>> = Arc::new(Mutex::new(Vec::new()));

  let n_requests = config.requests.len();
  let duration = Duration::from_secs(config.duration_secs);

  let rate_interval: Option<Duration> = if config.rate_limit > 0 {
    Some(Duration::from_secs_f64(
      config.concurrency as f64 / config.rate_limit as f64,
    ))
  } else {
    None
  };

  let start = Instant::now();

  // ── Spawn progress reporter ──────────────────────────────────────────────
  let reporter = {
    let done = Arc::clone(&done);
    let rt_requests = Arc::clone(&rt_requests);
    let rt_errors = Arc::clone(&rt_errors);
    let rt_bytes = Arc::clone(&rt_bytes);
    let rt_latency_sum = Arc::clone(&rt_latency_sum);
    let rt_latency_count = Arc::clone(&rt_latency_count);
    let app = app.clone();

    tauri::async_runtime::spawn(async move {
      let mut interval = tokio::time::interval(Duration::from_millis(500));
      loop {
        interval.tick().await;
        if done.load(Ordering::Relaxed) {
          break;
        }
        let elapsed_ms = start.elapsed().as_millis() as u64;
        let elapsed_s = elapsed_ms as f64 / 1000.0;
        let reqs = rt_requests.load(Ordering::Relaxed);
        let errs = rt_errors.load(Ordering::Relaxed);
        let bytes = rt_bytes.load(Ordering::Relaxed);
        let lat_sum = rt_latency_sum.load(Ordering::Relaxed);
        let lat_count = rt_latency_count.load(Ordering::Relaxed);
        let avg_lat_ms = if lat_count > 0 {
          lat_sum as f64 / lat_count as f64 / 1000.0
        } else {
          0.0
        };

        let progress = PerfProgress {
          elapsed_ms,
          requests_total: reqs,
          errors: errs,
          requests_per_sec: if elapsed_s > 0.0 { reqs as f64 / elapsed_s } else { 0.0 },
          avg_latency_ms: avg_lat_ms,
          bytes_per_sec: if elapsed_s > 0.0 { bytes as f64 / elapsed_s } else { 0.0 },
        };

        let _ = app.emit("perf:progress", progress);
      }
    })
  };

  // ── Spawn worker tasks ───────────────────────────────────────────────────
  let mut handles = Vec::new();
  for conn_id in 0..config.concurrency {
    let client = Arc::clone(&client);
    let config = Arc::clone(&config);
    let _done = Arc::clone(&done);
    let all_stats = Arc::clone(&all_stats);
    let rt_requests = Arc::clone(&rt_requests);
    let rt_errors = Arc::clone(&rt_errors);
    let rt_bytes = Arc::clone(&rt_bytes);
    let rt_latency_sum = Arc::clone(&rt_latency_sum);
    let rt_latency_count = Arc::clone(&rt_latency_count);

    let handle = tauri::async_runtime::spawn(async move {
      let mut worker = WorkerStats::new(n_requests);
      let mut attempt: u64 = 0;

      loop {
        if start.elapsed() >= duration {
          break;
        }

        if let Some(interval) = rate_interval {
          tokio::time::sleep(interval).await;
        }

        if start.elapsed() >= duration {
          break;
        }

        // Round-robin across requests
        let req_idx = (attempt as usize + conn_id as usize) % n_requests;
        attempt += 1;
        let req_cfg = &config.requests[req_idx];

        let req_start = Instant::now();

        let method = reqwest::Method::from_bytes(req_cfg.method.as_bytes())
          .unwrap_or(reqwest::Method::GET);

        let mut builder = client.request(method, &req_cfg.url);
        for (k, v) in &req_cfg.headers {
          builder = builder.header(k, v);
        }
        if let Some(body) = &req_cfg.body {
          builder = builder.body(body.clone());
        }

        match builder.send().await {
          Ok(resp) => {
            let status = resp.status().as_u16();
            let is_error = status >= 400;
            let bytes = resp.bytes().await.map(|b| b.len() as u64).unwrap_or(0);
            let lat_us = req_start.elapsed().as_micros() as u64;

            rt_requests.fetch_add(1, Ordering::Relaxed);
            rt_bytes.fetch_add(bytes, Ordering::Relaxed);
            rt_latency_sum.fetch_add(lat_us, Ordering::Relaxed);
            rt_latency_count.fetch_add(1, Ordering::Relaxed);
            if is_error {
              rt_errors.fetch_add(1, Ordering::Relaxed);
            }

            if worker.latencies_us.len() < 500_000 {
              worker.latencies_us.push(lat_us);
            }
            worker.bytes += bytes;
            *worker.status_codes.entry(status).or_insert(0) += 1;
            if is_error {
              worker.errors += 1;
            }

            // Per-request
            let pr = &mut worker.per_req[req_idx];
            if pr.latencies_us.len() < 100_000 {
              pr.latencies_us.push(lat_us);
            }
            *pr.status_codes.entry(status).or_insert(0) += 1;
            if is_error {
              pr.errors += 1;
            }
          }
          Err(_) => {
            rt_requests.fetch_add(1, Ordering::Relaxed);
            rt_errors.fetch_add(1, Ordering::Relaxed);
            worker.errors += 1;
            worker.per_req[req_idx].errors += 1;
          }
        }
      }

      all_stats.lock().await.push(worker);
    });

    handles.push(handle);
  }

  for h in handles {
    let _ = h.await;
  }

  done.store(true, Ordering::Relaxed);
  let _ = reporter.await;

  let elapsed_ms = start.elapsed().as_millis() as u64;
  let elapsed_secs = elapsed_ms as f64 / 1000.0;

  // ── Merge stats ───────────────────────────────────────────────────────────
  let collected = all_stats.lock().await;

  let mut all_lats: Vec<u64> = Vec::new();
  let mut total_errors: u64 = 0;
  let mut total_bytes: u64 = 0;
  let mut status_map: HashMap<u16, u64> = HashMap::new();
  let mut per_req_lats: Vec<Vec<u64>> = vec![Vec::new(); n_requests];
  let mut per_req_errors: Vec<u64> = vec![0; n_requests];
  let mut per_req_status: Vec<HashMap<u16, u64>> = vec![HashMap::new(); n_requests];

  for w in collected.iter() {
    all_lats.extend_from_slice(&w.latencies_us);
    total_errors += w.errors;
    total_bytes += w.bytes;
    for (&code, &count) in &w.status_codes {
      *status_map.entry(code).or_insert(0) += count;
    }
    for (i, pr) in w.per_req.iter().enumerate() {
      per_req_lats[i].extend_from_slice(&pr.latencies_us);
      per_req_errors[i] += pr.errors;
      for (&code, &count) in &pr.status_codes {
        *per_req_status[i].entry(code).or_insert(0) += count;
      }
    }
  }

  all_lats.sort_unstable();
  let n = all_lats.len();
  let avg_ms = if n > 0 { all_lats.iter().sum::<u64>() as f64 / n as f64 / 1000.0 } else { 0.0 };
  let requests_total = n as u64 + total_errors;

  // Per-request stats
  let per_request = config
    .requests
    .iter()
    .enumerate()
    .map(|(i, req_cfg)| {
      let mut lats = per_req_lats[i].clone();
      lats.sort_unstable();
      let n_req = lats.len();
      let avg = if n_req > 0 { lats.iter().sum::<u64>() as f64 / n_req as f64 / 1000.0 } else { 0.0 };
      let p99 = percentile(&lats, 99.0);
      let status_codes = per_req_status[i]
        .iter()
        .map(|(k, v)| (k.to_string(), *v))
        .collect();
      PerRequestStats {
        name: req_cfg.name.clone(),
        url: req_cfg.url.clone(),
        requests_total: n_req as u64 + per_req_errors[i],
        errors: per_req_errors[i],
        avg_latency_ms: avg,
        p99_ms: p99,
        status_codes,
      }
    })
    .collect();

  let status_codes: HashMap<String, u64> =
    status_map.into_iter().map(|(k, v)| (k.to_string(), v)).collect();

  Ok(PerfStats {
    requests_total,
    requests_per_sec: requests_total as f64 / elapsed_secs,
    avg_latency_ms: avg_ms,
    min_latency_ms: percentile(&all_lats, 0.0),
    max_latency_ms: all_lats.last().copied().unwrap_or(0) as f64 / 1000.0,
    p50_ms: percentile(&all_lats, 50.0),
    p75_ms: percentile(&all_lats, 75.0),
    p90_ms: percentile(&all_lats, 90.0),
    p99_ms: percentile(&all_lats, 99.0),
    p999_ms: percentile(&all_lats, 99.9),
    bytes_total: total_bytes,
    bytes_per_sec: total_bytes as f64 / elapsed_secs,
    errors: total_errors,
    duration_ms: elapsed_ms,
    status_codes,
    per_request,
  })
}

// ── Mock Server ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MockEndpointData {
  pub id: String,
  pub name: String,
  pub method: String,
  pub path: String,
  pub status_code: u16,
  pub response_headers: Vec<(String, String)>,
  pub response_body: String,
  pub content_type: String,
  pub delay: u64,  // ms
  pub enabled: bool,
}

pub struct MockServerState {
  pub endpoints: Arc<tokio::sync::Mutex<Vec<MockEndpointData>>>,
  pub shutdown_tx: tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
  pub running: Arc<AtomicBool>,
}

impl MockServerState {
  pub fn new() -> Self {
    MockServerState {
      endpoints: Arc::new(tokio::sync::Mutex::new(Vec::new())),
      shutdown_tx: tokio::sync::Mutex::new(None),
      running: Arc::new(AtomicBool::new(false)),
    }
  }
}

fn http_status_text(code: u16) -> &'static str {
  match code {
    200 => "OK", 201 => "Created", 204 => "No Content",
    301 => "Moved Permanently", 302 => "Found",
    400 => "Bad Request", 401 => "Unauthorized", 403 => "Forbidden",
    404 => "Not Found", 405 => "Method Not Allowed", 409 => "Conflict",
    422 => "Unprocessable Entity", 429 => "Too Many Requests",
    500 => "Internal Server Error", 502 => "Bad Gateway", 503 => "Service Unavailable",
    _ => "Unknown",
  }
}

async fn handle_mock_connection(
  mut stream: tokio::net::TcpStream,
  endpoints: Arc<tokio::sync::Mutex<Vec<MockEndpointData>>>,
) {
  let mut buf = vec![0u8; 8192];
  let n = match stream.read(&mut buf).await {
    Ok(n) if n > 0 => n,
    _ => return,
  };

  let req_str = String::from_utf8_lossy(&buf[..n]);
  let first_line = req_str.lines().next().unwrap_or("");
  let parts: Vec<&str> = first_line.split_whitespace().collect();
  let method = parts.first().copied().unwrap_or("GET").to_uppercase();
  let raw_path = parts.get(1).copied().unwrap_or("/");
  // Strip query string
  let path = raw_path.split('?').next().unwrap_or("/");

  // CORS preflight
  if method == "OPTIONS" {
    let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\n\r\n";
    let _ = stream.write_all(resp.as_bytes()).await;
    return;
  }

  let eps = endpoints.lock().await;
  let ep = eps.iter().find(|e| {
    if !e.enabled { return false; }
    let method_ok = e.method == "*" || e.method.eq_ignore_ascii_case(&method);
    let path_ok = e.path == path || {
      // Wildcard suffix: /api/users/* matches /api/users/1
      e.path.ends_with("/*") && path.starts_with(e.path.trim_end_matches("/*"))
    };
    method_ok && path_ok
  }).cloned();
  drop(eps);

  if let Some(ep) = ep {
    if ep.delay > 0 {
      tokio::time::sleep(Duration::from_millis(ep.delay)).await;
    }
    let body = ep.response_body.as_bytes();
    let extra: String = ep.response_headers.iter()
      .filter(|(k, _)| !k.is_empty())
      .map(|(k, v)| format!("{}: {}\r\n", k, v))
      .collect();
    let status_text = http_status_text(ep.status_code);
    let head = format!(
      "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n{}",
      ep.status_code, status_text, ep.content_type, body.len(), extra
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(b"\r\n").await;
    let _ = stream.write_all(body).await;
  } else {
    let body = format!(r#"{{"error":"Not Found","path":"{}"}}"#, path);
    let head = format!(
      "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
      body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
  }
}

#[tauri::command]
async fn mock_server_start(
  port: u16,
  state: tauri::State<'_, MockServerState>,
) -> Result<(), String> {
  // Stop existing server if running
  {
    let mut tx = state.shutdown_tx.lock().await;
    if let Some(sender) = tx.take() {
      let _ = sender.send(());
    }
  }

  let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
    .await
    .map_err(|e| format!("Cannot bind port {}: {}", port, e))?;

  let endpoints = state.endpoints.clone();
  let running = state.running.clone();

  let (tx, rx) = tokio::sync::oneshot::channel::<()>();
  {
    let mut guard = state.shutdown_tx.lock().await;
    *guard = Some(tx);
  }

  running.store(true, Ordering::Relaxed);

  tokio::spawn(async move {
    tokio::pin!(rx);
    loop {
      tokio::select! {
        result = listener.accept() => {
          if let Ok((stream, _)) = result {
            let eps = endpoints.clone();
            tokio::spawn(handle_mock_connection(stream, eps));
          }
        }
        _ = &mut rx => { break; }
      }
    }
    running.store(false, Ordering::Relaxed);
  });

  Ok(())
}

#[tauri::command]
async fn mock_server_stop(
  state: tauri::State<'_, MockServerState>,
) -> Result<(), String> {
  let mut tx = state.shutdown_tx.lock().await;
  if let Some(sender) = tx.take() {
    let _ = sender.send(());
  }
  state.running.store(false, Ordering::Relaxed);
  Ok(())
}

#[tauri::command]
async fn mock_server_status(
  state: tauri::State<'_, MockServerState>,
) -> Result<bool, String> {
  Ok(state.running.load(Ordering::Relaxed))
}

#[derive(Debug, Deserialize)]
pub struct MockEndpointInput {
  pub id: String,
  pub name: String,
  pub method: String,
  pub path: String,
  #[serde(rename = "statusCode")]
  pub status_code: u16,
  #[serde(rename = "responseHeaders")]
  pub response_headers: Vec<(String, String)>,
  #[serde(rename = "responseBody")]
  pub response_body: String,
  #[serde(rename = "contentType")]
  pub content_type: String,
  pub delay: u64,
  pub enabled: bool,
}

#[tauri::command]
async fn mock_update_endpoints(
  endpoints: Vec<MockEndpointInput>,
  state: tauri::State<'_, MockServerState>,
) -> Result<(), String> {
  let mut eps = state.endpoints.lock().await;
  *eps = endpoints
    .into_iter()
    .map(|e| MockEndpointData {
      id: e.id,
      name: e.name,
      method: e.method,
      path: e.path,
      status_code: e.status_code,
      response_headers: e.response_headers,
      response_body: e.response_body,
      content_type: e.content_type,
      delay: e.delay,
      enabled: e.enabled,
    })
    .collect();
  Ok(())
}

// ── Hosts Manager ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HostsProfile {
  pub id: String,
  pub name: String,
  pub content: String,
  pub created_at: u64,
}

fn hosts_file_path() -> PathBuf {
  #[cfg(target_os = "windows")]
  return PathBuf::from("C:\\Windows\\System32\\drivers\\etc\\hosts");
  #[cfg(not(target_os = "windows"))]
  PathBuf::from("/etc/hosts")
}

fn backup_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir.join("hosts.backup"))
}

fn profiles_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("hosts_profiles");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

fn write_hosts_elevated(src: &str, dst: &str) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let script = format!(
      "do shell script \"cp '{}' '{}'\" with administrator privileges",
      src.replace('\'', "'\\''"),
      dst.replace('\'', "'\\''")
    );
    let output = std::process::Command::new("osascript")
      .arg("-e")
      .arg(&script)
      .output()
      .map_err(|e| e.to_string())?;

    if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(if stderr.contains("-128") || stderr.contains("cancel") {
        "Authorization cancelled by user".to_string()
      } else {
        format!("Failed to write hosts: {}", stderr.trim())
      });
    }
    Ok(())
  }

  #[cfg(target_os = "linux")]
  {
    let output = std::process::Command::new("pkexec")
      .args(["cp", src, dst])
      .output()
      .map_err(|e| e.to_string())?;
    if !output.status.success() {
      return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
  }

  #[cfg(target_os = "windows")]
  {
    fs::copy(src, dst).map(|_| ()).map_err(|e| format!("Failed to write hosts (run as administrator): {}", e))
  }
}

#[tauri::command]
fn hosts_get_content() -> Result<String, String> {
  fs::read_to_string(hosts_file_path()).map_err(|e| e.to_string())
}

#[tauri::command]
fn hosts_apply(app: AppHandle, content: String) -> Result<(), String> {
  let current = fs::read_to_string(hosts_file_path()).map_err(|e| e.to_string())?;
  let bp = backup_path(&app)?;
  // Only backup if no backup exists yet (preserve original system hosts)
  if !bp.exists() {
    fs::write(&bp, &current).map_err(|e| e.to_string())?;
  }

  let tmp = std::env::temp_dir().join("zapi_hosts_apply.tmp");
  fs::write(&tmp, &content).map_err(|e| e.to_string())?;
  let result = write_hosts_elevated(&tmp.to_string_lossy(), &hosts_file_path().to_string_lossy());
  let _ = fs::remove_file(&tmp);
  result
}

#[tauri::command]
fn hosts_restore(app: AppHandle) -> Result<(), String> {
  let bp = backup_path(&app)?;
  if !bp.exists() {
    return Err("No backup found".to_string());
  }
  let content = fs::read_to_string(&bp).map_err(|e| e.to_string())?;
  let tmp = std::env::temp_dir().join("zapi_hosts_restore.tmp");
  fs::write(&tmp, &content).map_err(|e| e.to_string())?;
  let result = write_hosts_elevated(&tmp.to_string_lossy(), &hosts_file_path().to_string_lossy());
  let _ = fs::remove_file(&tmp);
  if result.is_ok() {
    // Remove backup after successful restore
    let _ = fs::remove_file(&bp);
  }
  result
}

#[tauri::command]
fn hosts_get_backup(app: AppHandle) -> Result<Option<String>, String> {
  let bp = backup_path(&app)?;
  if bp.exists() {
    Ok(Some(fs::read_to_string(bp).map_err(|e| e.to_string())?))
  } else {
    Ok(None)
  }
}

#[tauri::command]
fn hosts_list_profiles(app: AppHandle) -> Result<Vec<HostsProfile>, String> {
  let dir = profiles_dir(&app)?;
  let mut profiles: Vec<HostsProfile> = Vec::new();
  if let Ok(entries) = fs::read_dir(&dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if path.extension().and_then(|e| e.to_str()) == Some("json") {
        if let Ok(data) = fs::read_to_string(&path) {
          if let Ok(p) = serde_json::from_str::<HostsProfile>(&data) {
            profiles.push(p);
          }
        }
      }
    }
  }
  profiles.sort_by_key(|p| p.created_at);
  Ok(profiles)
}

#[tauri::command]
fn hosts_save_profile(app: AppHandle, id: String, name: String, content: String) -> Result<(), String> {
  let dir = profiles_dir(&app)?;
  // Read existing to preserve created_at if editing
  let existing_created_at = {
    let path = dir.join(format!("{}.json", id));
    if path.exists() {
      fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<HostsProfile>(&s).ok())
        .map(|p| p.created_at)
    } else {
      None
    }
  };
  let created_at = existing_created_at.unwrap_or_else(|| {
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_millis() as u64
  });
  let profile = HostsProfile { id: id.clone(), name, content, created_at };
  let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
  fs::write(dir.join(format!("{}.json", id)), json).map_err(|e| e.to_string())
}

#[tauri::command]
fn hosts_delete_profile(app: AppHandle, id: String) -> Result<(), String> {
  let dir = profiles_dir(&app)?;
  let path = dir.join(format!("{}.json", id));
  if path.exists() {
    fs::remove_file(path).map_err(|e| e.to_string())?;
  }
  Ok(())
}

// ── Workspace file I/O ───────────────────────────────────────────────────────

#[tauri::command]
fn workspace_file_read(path: String) -> Result<Option<String>, String> {
  let p = std::path::Path::new(&path);
  if !p.exists() {
    return Ok(None);
  }
  fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn workspace_file_write(path: String, content: String) -> Result<(), String> {
  let p = std::path::Path::new(&path);
  if let Some(parent) = p.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::write(p, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn workspace_ensure_dir(path: String) -> Result<(), String> {
  fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_data_dir(app: AppHandle) -> Result<String, String> {
  app.path()
    .app_data_dir()
    .map(|p| p.to_string_lossy().to_string())
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn workspace_pick_directory() -> Result<Option<String>, String> {
  #[cfg(target_os = "macos")]
  {
    let output = tokio::process::Command::new("osascript")
      .arg("-e")
      .arg("POSIX path of (choose folder with prompt \"Select Workspace Folder\")")
      .output()
      .await
      .map_err(|e| e.to_string())?;
    if output.status.success() {
      let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
      if !path.is_empty() {
        return Ok(Some(path));
      }
    }
    return Ok(None);
  }
  #[cfg(target_os = "windows")]
  {
    let output = tokio::process::Command::new("powershell")
      .args(["-NoProfile", "-Command",
        "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; \
         $f = New-Object System.Windows.Forms.FolderBrowserDialog; \
         $f.Description = 'Select Workspace Folder'; \
         if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }"])
      .output()
      .await
      .map_err(|e| e.to_string())?;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !path.is_empty() {
      return Ok(Some(path));
    }
    return Ok(None);
  }
  #[cfg(not(any(target_os = "macos", target_os = "windows")))]
  {
    Ok(None)
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(MockServerState::new())
    .manage(ProxyState::new())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      greet,
      run_performance_test,
      hosts_get_content,
      hosts_apply,
      hosts_restore,
      hosts_get_backup,
      hosts_list_profiles,
      hosts_save_profile,
      hosts_delete_profile,
      mock_server_start,
      mock_server_stop,
      mock_server_status,
      mock_update_endpoints,
      // ── Plugins
      plugins::plugin_get_dir,
      plugins::plugin_list,
      plugins::plugin_read_file,
      plugins::plugin_install,
      plugins::plugin_delete,
      plugins::plugin_open_dir,
      // ── Proxy
      proxy::proxy_start,
      proxy::proxy_stop,
      proxy::proxy_status,
      proxy::proxy_get_captures,
      proxy::proxy_clear_captures,
      proxy::proxy_get_ca_cert_pem,
      proxy::proxy_get_ca_cert_path,
      proxy::proxy_install_ca_cert,
      proxy::proxy_pin_request,
      proxy::proxy_delete_capture,
      // ── Workspace
      workspace_file_read,
      workspace_file_write,
      workspace_ensure_dir,
      get_app_data_dir,
      workspace_pick_directory,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
