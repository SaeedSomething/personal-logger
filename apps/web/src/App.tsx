import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Command, MoreHorizontal, NotebookPen, Play, Sparkles } from 'lucide-react';
import { CaptureView } from './features/capture/CaptureView';
import { JournalView } from './features/journal/JournalView';
import { formatMinutes } from './lib/types';
import { seedEntries, seedTags, seedTasks } from './lib/seed';
import { MemoryLoggerStore, type LoggerStore } from './lib/store';
import { createPlatformAdapter } from './platform';

function readInitialView(): 'capture' | 'journal' {
  if (typeof window === 'undefined') return 'capture';
  const params = new URLSearchParams(window.location.search);
  return params.get('view') === 'journal' ? 'journal' : 'capture';
}

function syncViewParam(view: 'capture' | 'journal', compact: boolean) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  params.set('view', view);
  if (compact) params.set('compact', '1');
  else params.delete('compact');
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', next);
}

function createDefaultStore(): LoggerStore {
  return new MemoryLoggerStore({
    tasks: seedTasks,
    entries: seedEntries,
    tags: seedTags,
  });
}

function App() {
  const platform = useMemo(() => createPlatformAdapter(), []);
  const store = useMemo(() => createDefaultStore(), []);
  const snapshot = useSyncExternalStore(
    (onStoreChange) => store.subscribe(onStoreChange),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );

  const [view, setView] = useState<'capture' | 'journal'>(readInitialView);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationNote, setMigrationNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await platform.ensureOngoingNotification();
        const report = await platform.migrateLegacyIfNeeded();
        if (!cancelled && report && !report.skipped) {
          setMigrationNote(report.message);
        }
        if (!cancelled) setLoadState('ready');
      } catch (error) {
        console.warn('platform bootstrap failed', error);
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load workspace');
          setLoadState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  useEffect(() => {
    syncViewParam(view, platform.isCompactCapture);
  }, [view, platform.isCompactCapture]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === '1') {
        event.preventDefault();
        setView('capture');
      }
      if (event.key === '2' && !platform.isCompactCapture) {
        event.preventDefault();
        setView('journal');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [platform.isCompactCapture]);

  const weekActual = snapshot.entries.reduce((sum, entry) => {
    if (!entry.endedAt) return sum;
    const mins = Math.max(
      0,
      Math.round(
        (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 60_000,
      ),
    );
    return sum + mins;
  }, 0);

  const openCount = snapshot.entries.filter((e) => !e.endedAt).length;

  return (
    <main className={platform.isCompactCapture ? 'app-shell compact-shell' : 'app-shell'}>
      {!platform.isCompactCapture && (
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <Sparkles size={14} />
            </span>
            <span>minute / log</span>
          </div>
          <div className="topbar-right">
            <span className="sync-state">
              <span className={`sync-dot${loadState === 'loading' ? ' syncing' : ''}`} />
              {loadState === 'loading'
                ? 'loading…'
                : platform.kind === 'web'
                  ? 'local workspace'
                  : platform.kind}
            </span>
            <button className="icon-button" type="button" aria-label="More">
              <MoreHorizontal size={18} />
            </button>
          </div>
        </header>
      )}

      <div className="workspace">
        {!platform.isCompactCapture && (
          <aside className="sidebar">
            <div className="side-intro">
              <p className="eyebrow">Personal time lab</p>
              <h1>
                Make time
                <br />
                <em>visible.</em>
              </h1>
              <p className="side-copy">
                A tiny place to start, stop, and learn what your days actually take.
              </p>
            </div>
            <nav className="view-nav">
              <button
                className={view === 'capture' ? 'nav-item active' : 'nav-item'}
                type="button"
                onClick={() => setView('capture')}
              >
                <Play size={16} /> Capture <span>⌘ 1</span>
              </button>
              <button
                className={view === 'journal' ? 'nav-item active' : 'nav-item'}
                type="button"
                onClick={() => setView('journal')}
              >
                <NotebookPen size={16} /> Journal <span>⌘ 2</span>
              </button>
            </nav>
            <div className="side-footer">
              <div className="weekly-pulse">
                <div className="pulse-top">
                  <span>logged (ended)</span>
                  <strong>{formatMinutes(weekActual)}</strong>
                </div>
                <small>
                  {openCount} open · multi-open allowed
                </small>
              </div>
              <div className="keyboard-hint">
                <Command size={13} /> tray / notification opens capture
              </div>
              {migrationNote && <small className="migrate-note">{migrationNote}</small>}
            </div>
          </aside>
        )}

        <section className="content">
          {loadState === 'loading' && (
            <div className="empty-state" role="status">
              Loading workspace…
            </div>
          )}
          {loadState === 'error' && (
            <div className="empty-state" role="alert">
              {loadError ?? 'Something went wrong.'} Showing local seed data.
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setLoadError(null);
                  setLoadState('ready');
                }}
              >
                Continue
              </button>
            </div>
          )}
          {loadState !== 'loading' &&
            (view === 'capture' || platform.isCompactCapture ? (
              <CaptureView
                tasks={snapshot.tasks}
                entries={snapshot.entries}
                tags={snapshot.tags}
                compact={platform.isCompactCapture}
                onCreateTask={(input) => {
                  const task = store.createTask({
                    title: input.title,
                    estimateMinutes: input.estimate,
                    tags: input.tags,
                  });
                  if (input.startImmediately) store.startTask(task.id);
                }}
                onStartTask={(task) => store.startTask(task.id)}
                onEndEntry={(entry) => store.endEntry(entry.id)}
                onEnsureTag={(name) => store.ensureTag(name)}
              />
            ) : (
              <JournalView
                tasks={snapshot.tasks}
                entries={snapshot.entries}
                tags={snapshot.tags}
                onBackToCapture={() => setView('capture')}
                onUpdateTask={(taskId, patch) => store.updateTask(taskId, patch)}
                onUpdateEntryNotes={(entryId, notes) => store.updateEntryNotes(entryId, notes)}
                onDeleteEntry={(entryId) => store.deleteEntry(entryId)}
                onDeleteTask={(taskId) => store.deleteTask(taskId)}
              />
            ))}
        </section>
      </div>
    </main>
  );
}

export default App;
