use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tauri::Emitter;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![greet, run_performance_test])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
