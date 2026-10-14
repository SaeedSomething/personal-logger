use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub source_path: String,
    pub working_copy_path: String,
    pub original_sha256: String,
    pub original_bytes: u64,
    pub tasks_imported: u32,
    pub spans_imported: u32,
    pub open_spans_imported: u32,
    pub skipped: bool,
    pub message: String,
}

fn sha256_file(path: &Path) -> Result<(String, u64), String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let len = bytes.len() as u64;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok((hex::encode(hasher.finalize()), len))
}

fn legacy_candidates(app: &AppHandle<impl Runtime>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        paths.push(PathBuf::from(local).join("personal-logger").join("logger.db"));
    }
    if let Ok(dir) = app.path().app_local_data_dir() {
        // Android FilesDir equivalent often surfaces here under Tauri mobile.
        paths.push(dir.join("logger.db"));
        paths.push(dir.join("legacy").join("logger.db"));
    }
    paths
}

fn target_db_path(app: &AppHandle<impl Runtime>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("logger.db"))
}

fn target_is_empty(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(true);
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    let has_tasks: Option<String> = conn
        .query_row(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if has_tasks.is_none() {
        return Ok(true);
    }
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(count == 0)
}

fn import_legacy(source: &Path, target: &Path, work_dir: &Path) -> Result<MigrationReport, String> {
    let (original_sha256, original_bytes) = sha256_file(source)?;
    let working_copy = work_dir.join(format!("legacy-import-{}.db", Uuid::new_v4()));
    fs::copy(source, &working_copy).map_err(|e| e.to_string())?;

    let legacy = Connection::open_with_flags(
        &working_copy,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;

    let table_count: i64 = legacy
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('tasks','spans')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if table_count != 2 {
        return Err("Unexpected legacy schema: expected tasks and spans".into());
    }

    let mut target_conn = Connection::open(target).map_err(|e| e.to_string())?;
    target_conn
        .execute_batch(include_str!("../migrations/001_v1.sql"))
        .map_err(|e| e.to_string())?;
    target_conn
        .execute_batch("PRAGMA user_version = 1;")
        .map_err(|e| e.to_string())?;

    let mut tasks_imported = 0u32;
    let mut spans_imported = 0u32;
    let mut open_spans_imported = 0u32;
    let mut task_map = std::collections::HashMap::<i64, String>::new();

    let tx = target_conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = legacy
            .prepare("SELECT id, name, expected_secs, created_at FROM tasks ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (id, name, expected, created) = row.map_err(|e| e.to_string())?;
            let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
            if name.is_empty() {
                continue;
            }
            let uuid = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO tasks (id, name, expected_secs, notes, created_at) VALUES (?1, ?2, ?3, '', ?4)",
                params![uuid, name, expected, created],
            )
            .map_err(|e| e.to_string())?;
            task_map.insert(id, uuid);
            tasks_imported += 1;
        }
    }

    {
        let mut stmt = legacy
            .prepare(
                "SELECT id, task_id, started_at, ended_at, expected_secs FROM spans ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (_id, task_id, started, ended, expected) = row.map_err(|e| e.to_string())?;
            let Some(task_uuid) = task_map.get(&task_id) else {
                continue;
            };
            let uuid = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO entries (id, task_id, started_at, ended_at, expected_secs, notes) VALUES (?1, ?2, ?3, ?4, ?5, '')",
                params![uuid, task_uuid, started, ended, expected],
            )
            .map_err(|e| e.to_string())?;
            spans_imported += 1;
            if ended.is_none() {
                open_spans_imported += 1;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    let (after_sha, _) = sha256_file(source)?;
    if after_sha != original_sha256 {
        return Err("Original legacy database changed during import".into());
    }

    Ok(MigrationReport {
        source_path: source.display().to_string(),
        working_copy_path: working_copy.display().to_string(),
        original_sha256,
        original_bytes,
        tasks_imported,
        spans_imported,
        open_spans_imported,
        skipped: false,
        message: format!(
            "Imported {tasks_imported} tasks and {spans_imported} spans ({open_spans_imported} open)"
        ),
    })
}

#[tauri::command]
pub async fn migrate_legacy_if_needed<R: Runtime>(
    app: AppHandle<R>,
) -> Result<MigrationReport, String> {
    let target = target_db_path(&app)?;
    if !target_is_empty(&target)? {
        return Ok(MigrationReport {
            source_path: String::new(),
            working_copy_path: String::new(),
            original_sha256: String::new(),
            original_bytes: 0,
            tasks_imported: 0,
            spans_imported: 0,
            open_spans_imported: 0,
            skipped: true,
            message: "Target database already has data".into(),
        });
    }

    let work_dir = target
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "invalid target path".to_string())?;

    for source in legacy_candidates(&app) {
        if source.exists() {
            return import_legacy(&source, &target, &work_dir);
        }
    }

    Ok(MigrationReport {
        source_path: String::new(),
        working_copy_path: String::new(),
        original_sha256: String::new(),
        original_bytes: 0,
        tasks_imported: 0,
        spans_imported: 0,
        open_spans_imported: 0,
        skipped: true,
        message: "No legacy logger.db found".into(),
    })
}

/// Smoke helper used by PoC / CI: insert one task + one open entry via rusqlite.
#[tauri::command]
pub async fn smoke_insert_task_entry<R: Runtime>(
    app: AppHandle<R>,
) -> Result<String, String> {
    let path = target_db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch(include_str!("../migrations/001_v1.sql"))
        .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA user_version = 1;")
        .map_err(|e| e.to_string())?;

    let task_id = Uuid::new_v4().to_string();
    let entry_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO tasks (id, name, expected_secs, notes, created_at) VALUES (?1, ?2, ?3, '', ?4)",
        params![task_id, "Smoke task", 1800i64, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO entries (id, task_id, started_at, ended_at, expected_secs, notes) VALUES (?1, ?2, ?3, NULL, ?4, '')",
        params![entry_id, task_id, now, 1800i64],
    )
    .map_err(|e| e.to_string())?;

    Ok(format!("ok task={task_id} entry={entry_id}"))
}
