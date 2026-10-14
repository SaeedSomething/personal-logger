# Personal Logger

Offline-first time capture for **Windows** and **Android**, built on **Tauri 2 + React/TypeScript** with a shared TypeScript domain package and local SQLite.

The legacy .NET apps (`Logger.Windows`, `Logger.Android`, `Logger.Core`) remain in-repo as a behavioral reference and migration source. They are **not** the primary release path.

## Architecture

| Path | Role |
|------|------|
| `apps/web` | React UI (capture + journal) |
| `apps/desktop` | Tauri 2 shell (`src-tauri`), tray, notifications, SQL plugin |
| `packages/domain` | Domain rules, SQLite schema v1, Vitest, .NET DB migrator |
| `Logger.*` | Legacy .NET reference (do not delete user DBs) |

**Persistence:** local SQLite only for v1 (no Supabase runtime). Durations are stored as **integer seconds**; UI helpers convert minutes. Open entry = `ended_at IS NULL`. Multi-open executions are allowed.

**Delta convention:** `actual_secs - expected_secs` (positive = over estimate).

**Task delete** cascades entries; **entry delete** leaves the task.

## Database paths

| Platform | New DB | Legacy (.NET) source (read-only import) |
|----------|--------|----------------------------------------|
| Windows | Tauri app data dir / `logger.db` | `%LocalApplicationData%\personal-logger\logger.db` |
| Android | Tauri app data / files dir / `logger.db` | `{FilesDir}/logger.db` |

On first launch, if a legacy DB is found and the new DB is empty, the importer copies the legacy file, maps `tasks`/`spans` → `tasks`/`entries` (UUID ids), and leaves the original bytes unchanged.

## Development

### Web UI

```bash
cd apps/web
npm ci
npm run typecheck && npm run lint && npm test && npm run build
npm run dev
```

### Domain package

```bash
cd packages/domain
npm ci
npm test
```

### Tauri desktop (Windows)

Requires a working Rust stable toolchain (`rustc` / `cargo`), [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/), and the **MSVC** C++ build tools (Visual Studio Build Tools “Desktop development with C++”). GitHub `windows-latest` runners already provide MSVC; local `cargo check` / `tauri build` need the same.

```bash
# from repo root
npm ci --prefix apps/web
npm ci --prefix apps/desktop
npm run tauri:dev
# or
npm run tauri:build
```

Shell smoke (from the running app / invoke): `smoke_insert_task_entry` inserts one task + one open entry. Domain migration fixtures and `cargo check` in `apps/desktop/src-tauri` are the automated PoC gates; tray/notification behave as listed in the checklist below.

### Android

Requires Android SDK/NDK and Tauri Android init (`npx tauri android init` under `apps/desktop`). Official docs: [Tauri mobile](https://v2.tauri.app/start/migrate/from-tauri-1/) / Android guides.

```bash
cd apps/desktop
npx tauri android init   # once
npx tauri android dev
npx tauri android build --apk
```

## Platform entry

- **Windows:** system tray left-click toggles the compact capture window (`/?view=capture&compact=1`). Closing the main journal window hides to tray (does not quit).
- **Android:** `ensure_android_ongoing_notification` requests `POST_NOTIFICATIONS` (API 33+) and shows an `ongoing: true` notification that opens capture. No foreground service in this milestone.

## Releases & secrets

Triggers: push to `main` (auto bump) or `workflow_dispatch` on `.github/workflows/release.yml`.

Primary artifacts (Tauri):

- `Logger-Setup-{version}.exe` (NSIS)
- `Logger-{version}.apk`

Secret **names** (values never logged): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, plus `GITHUB_TOKEN`.

If Android signing secrets are missing, CI signs with a **throwaway** keystore (will not upgrade an existing signed install).

Optional input `legacy_dotnet` (default **false**) can still produce obsolete .NET publish output; it is gated so .NET is not the sole release payload after cutover.

PR CI runs domain + web gates, legacy `Logger.Core.Tests`, and `cargo check` for the Tauri shell.

## End-to-end checklist

- [ ] `cd packages/domain && npm test` — duration, multi-open, journal, migration fixture
- [ ] `cd apps/web && npm ci && npm run typecheck && npm run lint && npm test && npm run build`
- [ ] `dotnet test Logger.Core.Tests` — still green while .NET is retained
- [ ] Windows: tray left-click opens compact capture; main close hides to tray; multi-open start does not end another
- [ ] Android: ongoing notification visible after leave; tap → capture; grant notifications on API 33+
- [ ] Migration: fixture legacy DB (≥2 tasks, multi-open spans) imports with matching counts; original `logger.db` hash unchanged
- [ ] Journal: filters, 7d/30d/year/all, delta = actual − expected, edit + confirm delete (cascade vs entry-only)
- [ ] Release dry-run: GitHub Release contains versioned `.exe` and `.apk`; not .NET-only

## Product version

Current product version: **1.3.0** (`Directory.Build.props` / package versions). Release automation bumps via existing `scripts/*.ps1`.
