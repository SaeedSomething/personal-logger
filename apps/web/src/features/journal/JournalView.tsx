import { useMemo, useState, type FormEvent } from 'react';
import {
  Archive,
  ArrowDownUp,
  Hash,
  Pencil,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatMinutes,
  relativeDate,
  type Entry,
  type SortKey,
  type Task,
  type WindowKey,
} from '../../lib/types';
import {
  aggregateSelected,
  consistencyCells,
  filterJournalEntries,
  groupByTask,
} from './metrics';

type Props = {
  tasks: Task[];
  entries: Entry[];
  tags: string[];
  onBackToCapture: () => void;
  onUpdateTask: (taskId: string, patch: { title: string; notes: string; tags: string[] }) => void;
  onUpdateEntryNotes: (entryId: string, notes: string) => void;
  onDeleteEntry: (entryId: string) => void;
  onDeleteTask: (taskId: string) => void;
};

type ConfirmState =
  | { type: 'entry'; id: string; title: string }
  | { type: 'task'; id: string; title: string }
  | null;

export function JournalView({
  tasks,
  entries,
  tags,
  onBackToCapture,
  onUpdateTask,
  onUpdateEntryNotes,
  onDeleteEntry,
  onDeleteTask,
}: Props) {
  const [journalQuery, setJournalQuery] = useState('');
  const [journalTag, setJournalTag] = useState('all');
  const [windowKey, setWindowKey] = useState<WindowKey>('7d');
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [editing, setEditing] = useState<{ type: 'task' | 'entry'; id: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<'ready' | 'error'>('ready');

  const journalEntries = useMemo(
    () =>
      filterJournalEntries(entries, tasks, {
        windowKey,
        query: journalQuery,
        tag: journalTag,
      }),
    [entries, journalQuery, journalTag, tasks, windowKey],
  );

  const grouped = useMemo(
    () => groupByTask(journalEntries, tasks, sortBy),
    [journalEntries, sortBy, tasks],
  );

  const selectedEntries =
    selectedIds.size === 0
      ? journalEntries
      : journalEntries.filter((entry) => selectedIds.has(entry.id));
  const metrics = aggregateSelected(selectedEntries);
  const empty = journalEntries.length === 0;

  const updateTask = (event: FormEvent<HTMLFormElement>, taskId: string) => {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const title = String(form.get('title') ?? '').trim();
      const notes = String(form.get('notes') ?? '');
      const nextTags = String(form.get('tags') ?? '')
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
      if (title) onUpdateTask(taskId, { title, notes, tags: nextTags });
      setEditing(null);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  };

  const updateEntry = (event: FormEvent<HTMLFormElement>, entryId: string) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onUpdateEntryNotes(entryId, String(form.get('notes') ?? ''));
    setEditing(null);
  };

  const toggleSelect = (entryId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  return (
    <>
      <div className="page-head journal-head">
        <div>
          <p className="eyebrow">Journal / signal</p>
          <h2>See what time teaches you.</h2>
          <p className="page-subtitle">
            Delta is actual − expected (positive means over estimate).
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onBackToCapture}>
          <Play size={15} /> log a task
        </button>
      </div>

      <div className="journal-toolbar">
        <div className="journal-search">
          <Search size={16} />
          <input
            value={journalQuery}
            onChange={(event) => setJournalQuery(event.target.value)}
            placeholder="Search tasks or notes"
          />
        </div>
        <div className="tag-filter">
          <Hash size={15} />
          <select value={journalTag} onChange={(event) => setJournalTag(event.target.value)}>
            <option value="all">all tags</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
        </div>
        <div className="window-switcher">
          {(['7d', '30d', 'year', 'all'] as WindowKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={windowKey === key ? 'selected' : ''}
              onClick={() => setWindowKey(key)}
            >
              {key === 'all' ? 'all time' : key === 'year' ? 'year' : key}
            </button>
          ))}
        </div>
      </div>

      <div className="metric-strip" aria-live="polite">
        <div>
          <span>sessions</span>
          <strong>{metrics.sessions}</strong>
        </div>
        <div>
          <span>actual time</span>
          <strong>{formatMinutes(metrics.actual)}</strong>
        </div>
        <div>
          <span>expected</span>
          <strong>{formatMinutes(metrics.expected)}</strong>
        </div>
        <div className={metrics.delta > 0 ? 'metric-warn' : 'metric-good'}>
          <span>delta</span>
          <strong>
            {metrics.delta >= 0 ? '+' : ''}
            {formatMinutes(metrics.delta)}
          </strong>
        </div>
      </div>

      {status === 'error' && (
        <div className="empty-state" role="alert">
          Could not save that edit. Try again.
        </div>
      )}

      <div className="journal-section-title">
        <div>
          <span className="eyebrow">by task</span>
          <h3>Consistency, not perfection.</h3>
        </div>
        <div className="list-sort">
          <ArrowDownUp size={14} />
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}>
            <option value="recent">most recent</option>
            <option value="name">name A–Z</option>
            <option value="tag">tag</option>
          </select>
        </div>
      </div>

      <div className="journal-list">
        {empty ? (
          <div className="empty-state">
            <Archive size={17} /> No entries match this view.
          </div>
        ) : (
          grouped.map(({ task, entries: taskEntries, total, average, days, delta }) => (
            <div className="journal-card" key={task.id}>
              <div className="journal-card-top">
                <div>
                  <div className="title-with-tags">
                    <h3>{task.title}</h3>
                    {task.tags.map((tag) => (
                      <span className="mini-tag" key={tag}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                  <p>
                    {taskEntries.length} session{taskEntries.length === 1 ? '' : 's'} · avg{' '}
                    {formatMinutes(average)} · {formatMinutes(total)} total · delta{' '}
                    {delta >= 0 ? '+' : ''}
                    {formatMinutes(delta)}
                  </p>
                </div>
                <div className="card-menu">
                  <button type="button" onClick={() => setEditing({ type: 'task', id: task.id })}>
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm({ type: 'task', id: task.id, title: task.title })}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="consistency-row">
                <div className="week-grid">
                  {consistencyCells(taskEntries).map((cell) => (
                    <div className={cell.count ? 'day-box filled' : 'day-box'} key={cell.day}>
                      <span>{cell.label}</span>
                      {cell.count > 1 && <b>{cell.count}</b>}
                    </div>
                  ))}
                </div>
                <div className="days-count">
                  <strong>{days}/7</strong>
                  <span>days active</span>
                </div>
              </div>
              <div className="entry-history">
                {taskEntries.slice(0, 5).map((entry) => (
                  <div className="history-row" key={entry.id}>
                    <label className="history-select">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === 0 || selectedIds.has(entry.id)}
                        onChange={() => toggleSelect(entry.id)}
                        aria-label={`Select session ${relativeDate(entry.startedAt)}`}
                      />
                    </label>
                    <span>{relativeDate(entry.startedAt)}</span>
                    <span className="history-note">{entry.notes || 'no note yet'}</span>
                    <strong>
                      {formatMinutes(
                        Math.max(
                          0,
                          Math.round(
                            ((entry.endedAt
                              ? new Date(entry.endedAt).getTime()
                              : Date.now()) -
                              new Date(entry.startedAt).getTime()) /
                              60_000,
                          ),
                        ),
                      )}
                    </strong>
                    <button type="button" onClick={() => setEditing({ type: 'entry', id: entry.id })}>
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirm({
                          type: 'entry',
                          id: entry.id,
                          title: relativeDate(entry.startedAt),
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {editing && (
        <div className="modal-backdrop" onMouseDown={() => setEditing(null)}>
          <div className="edit-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">edit record</span>
                <h3>{editing.type === 'task' ? 'Shape the task' : 'Add context'}</h3>
              </div>
              <button type="button" onClick={() => setEditing(null)}>
                <X size={18} />
              </button>
            </div>
            {editing.type === 'task'
              ? (() => {
                  const task = tasks.find((item) => item.id === editing.id);
                  return task ? (
                    <form onSubmit={(event) => updateTask(event, task.id)}>
                      <label>
                        task title
                        <input name="title" defaultValue={task.title} required />
                      </label>
                      <label>
                        tags
                        <input name="tags" defaultValue={task.tags.join(', ')} placeholder="work, focus" />
                      </label>
                      <label>
                        notes
                        <textarea
                          name="notes"
                          defaultValue={task.notes}
                          placeholder="What should future-you remember?"
                        />
                      </label>
                      <button className="primary-button" type="submit">
                        save changes
                      </button>
                    </form>
                  ) : null;
                })()
              : (() => {
                  const entry = entries.find((item) => item.id === editing.id);
                  return entry ? (
                    <form onSubmit={(event) => updateEntry(event, entry.id)}>
                      <label>
                        session note
                        <textarea
                          name="notes"
                          defaultValue={entry.notes}
                          placeholder="What changed, felt difficult, or helped?"
                        />
                      </label>
                      <button className="primary-button" type="submit">
                        save note
                      </button>
                    </form>
                  ) : null;
                })()}
          </div>
        </div>
      )}

      {confirm && (
        <div className="modal-backdrop" onMouseDown={() => setConfirm(null)}>
          <div className="edit-modal" onMouseDown={(event) => event.stopPropagation()} role="alertdialog">
            <div className="modal-head">
              <div>
                <span className="eyebrow">confirm delete</span>
                <h3>
                  {confirm.type === 'task'
                    ? `Delete task “${confirm.title}”?`
                    : `Delete session ${confirm.title}?`}
                </h3>
              </div>
              <button type="button" onClick={() => setConfirm(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="page-subtitle">
              {confirm.type === 'task'
                ? 'Task delete cascades to all of its entries.'
                : 'Entry delete leaves the task definition.'}
            </p>
            <div className="capture-top">
              <button className="secondary-button" type="button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  if (confirm.type === 'task') onDeleteTask(confirm.id);
                  else onDeleteEntry(confirm.id);
                  setConfirm(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
