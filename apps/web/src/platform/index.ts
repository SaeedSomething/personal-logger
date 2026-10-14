export type PlatformKind = 'web' | 'tauri-desktop' | 'tauri-android';

export type PlatformAdapter = {
  kind: PlatformKind;
  isCompactCapture: boolean;
  showCaptureWindow(): Promise<void>;
  hideCaptureWindow(): Promise<void>;
  toggleCaptureWindow(): Promise<void>;
  ensureOngoingNotification(): Promise<void>;
  migrateLegacyIfNeeded(): Promise<{ skipped: boolean; message: string } | null>;
};

function queryFlag(name: string): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(name) === '1';
}

function detectKind(): PlatformKind {
  const w = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (!w.__TAURI_INTERNALS__) return 'web';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'tauri-android';
  return 'tauri-desktop';
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export function createPlatformAdapter(): PlatformAdapter {
  const kind = detectKind();
  const isCompactCapture = queryFlag('compact');

  if (kind === 'web') {
    return {
      kind,
      isCompactCapture,
      async showCaptureWindow() {},
      async hideCaptureWindow() {},
      async toggleCaptureWindow() {},
      async ensureOngoingNotification() {},
      async migrateLegacyIfNeeded() {
        return null;
      },
    };
  }

  return {
    kind,
    isCompactCapture,
    async showCaptureWindow() {
      await invoke('show_capture_window');
    },
    async hideCaptureWindow() {
      await invoke('hide_capture_window');
    },
    async toggleCaptureWindow() {
      await invoke('toggle_capture_window');
    },
    async ensureOngoingNotification() {
      if (kind === 'tauri-android') {
        await invoke('ensure_android_ongoing_notification');
      }
    },
    async migrateLegacyIfNeeded() {
      return invoke('migrate_legacy_if_needed');
    },
  };
}
