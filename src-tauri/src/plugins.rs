/// Plugin filesystem commands.
///
/// Plugins live in `<app_data>/plugins/<plugin-id>/`.
/// Each folder must contain:
///   - plugin.json  (PluginManifest)
///   - index.js     (CommonJS module)

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

// ── Plugin manifest (mirrors plugin-types.ts PluginManifest) ───────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginConfigField {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    pub hooks: Vec<String>,
    pub config: Vec<PluginConfigField>,
    pub path: String,
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// ── Commands ───────────────────────────────────────────────────────────────

/// Returns the absolute path to the plugins directory (for "Open folder" button).
#[tauri::command]
pub fn plugin_get_dir(app: AppHandle) -> Result<String, String> {
    plugins_dir(&app).map(|p| p.to_string_lossy().to_string())
}

/// Lists all installed plugins by scanning `<plugins_dir>/*/plugin.json`.
#[tauri::command]
pub fn plugin_list(app: AppHandle) -> Result<Vec<PluginEntry>, String> {
    let dir = plugins_dir(&app)?;
    let mut entries: Vec<PluginEntry> = Vec::new();

    let read = match fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(vec![]),
    };

    for entry in read.flatten() {
        let plugin_dir = entry.path();
        if !plugin_dir.is_dir() {
            continue;
        }
        let manifest_path = plugin_dir.join("plugin.json");
        if !manifest_path.exists() {
            continue;
        }
        let json = match fs::read_to_string(&manifest_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut manifest: serde_json::Value = match serde_json::from_str(&json) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Ensure index.js exists
        if !plugin_dir.join("index.js").exists() {
            continue;
        }

        let id = manifest
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| plugin_dir.file_name().unwrap_or_default().to_str().unwrap_or(""))
            .to_string();

        // Inject path into manifest for convenience
        manifest["path"] = serde_json::Value::String(plugin_dir.to_string_lossy().to_string());

        let pe = PluginEntry {
            id: id.clone(),
            name: manifest.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string(),
            version: manifest.get("version").and_then(|v| v.as_str()).unwrap_or("0.0.0").to_string(),
            description: manifest.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            author: manifest.get("author").and_then(|v| v.as_str()).map(String::from),
            homepage: manifest.get("homepage").and_then(|v| v.as_str()).map(String::from),
            hooks: manifest
                .get("hooks")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            config: manifest
                .get("config")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default(),
            path: plugin_dir.to_string_lossy().to_string(),
        };

        entries.push(pe);
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Read a file from disk (used to load index.js content into the frontend sandbox).
/// Restricted to files inside the plugins directory for safety.
#[tauri::command]
pub fn plugin_read_file(app: AppHandle, path: String) -> Result<String, String> {
    let plugins = plugins_dir(&app)?;
    let resolved = PathBuf::from(&path);

    // Safety: only allow reading from within the plugins directory
    if !resolved.starts_with(&plugins) {
        return Err(format!("Access denied: '{}' is outside the plugins directory", path));
    }

    fs::read_to_string(&resolved).map_err(|e| format!("Cannot read {}: {}", path, e))
}

/// Copy a plugin folder (selected by the user) into the plugins directory.
/// The source folder must contain plugin.json + index.js.
#[tauri::command]
pub fn plugin_install(app: AppHandle, src_path: String) -> Result<PluginEntry, String> {
    let src = PathBuf::from(&src_path);
    if !src.is_dir() {
        return Err(format!("'{}' is not a directory", src_path));
    }
    if !src.join("plugin.json").exists() {
        return Err("plugin.json not found in selected folder".to_string());
    }
    if !src.join("index.js").exists() {
        return Err("index.js not found in selected folder".to_string());
    }

    // Read manifest to get the id
    let manifest_json = fs::read_to_string(src.join("plugin.json"))
        .map_err(|e| format!("Cannot read plugin.json: {}", e))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("Invalid plugin.json: {}", e))?;
    let id = manifest
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("plugin.json must contain an 'id' field")?
        .to_string();

    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(format!("Invalid plugin id: '{}'", id));
    }

    let dest = plugins_dir(&app)?.join(&id);
    // Remove old version if present
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("Cannot remove old version: {}", e))?;
    }
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    // Copy all .js and .json files from src into dest
    copy_dir_recursive(&src, &dest)?;

    // Return the installed entry
    let entries = plugin_list(app)?;
    entries
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("Plugin '{}' installed but could not be read back", id))
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            fs::create_dir_all(&dst_path).map_err(|e| e.to_string())?;
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Delete an installed plugin folder.
#[tauri::command]
pub fn plugin_delete(app: AppHandle, id: String) -> Result<(), String> {
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(format!("Invalid plugin id: '{}'", id));
    }
    let path = plugins_dir(&app)?.join(&id);
    if path.exists() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open the plugins directory in the system file manager.
#[tauri::command]
pub fn plugin_open_dir(app: AppHandle) -> Result<(), String> {
    let dir = plugins_dir(&app)?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
