import { useMemo, useState, type FormEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  ListFilter,
  Pause,
  Play,
  Plus,
  Search,
  Tag,
  X,
} from 'lucide-react';
import {
  durationMinutes,
  formatMinutes,
  relativeDate,
  type Entry,
  type SortKey,
  type Task,
} from '../../lib/types';
import { entryLifecycle, taskLifecycle } from './lifecycle';

type Props = {
  tasks: Task[];
  entries: Entry[];
  tags: string[];
  compact?: boolean;
  onCreateTask: (input: {
    title: string;
    estimate: number;
    tags: string[];
    startImmediately: boolean;
  }) => void;
  onStartTask: (task: Task) => void;
  onEndEntry: (entry: Entry) => void;
  onEnsureTag: (name: string) => void;
};

export function CaptureView({
  tasks,
  entries,
  tags,
  compact = false,
  onCreateTask,
  onStartTask,
  onEndEntry,
  onEnsureTag,
}: Props) {
  const [query, setQuery] = useState('');
  const [expected, setExpected] = useState(30);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [standby, setStandby] = useState(true);
  const [openCollapsed, setOpenCollapsed] = useState(false);
  const [closedCollapsed, setClosedCollapsed] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [tagDraft, setTagDraft] = useState('');

  const taskMatches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return tasks
      .filter(
        (task) =>
          !trimmed ||
          task.title.toLowerCase().includes(trimmed) ||
          task.tags.some((tag) => tag.includes(trimmed)),
      )
      .sort((a, b) =>
        sortBy === 'name'
          ? a.title.localeCompare(b.title)
          : sortBy === 'tag'
            ? (a.tags[0] ?? '').localeCompare(b.tags[0] ?? '')
            : 0,
      );
  }, [query, sortBy, tasks]);

  const openEntries = entries.filter((entry) => !entry.endedAt);
  const closedEntries = entries.filter((entry) => entry.endedAt);

  const addTag = (name: string) => {
    const clean = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!clean) return;
    onEnsureTag(clean);
    if (!selectedTags.includes(clean)) {
      setSelectedTags((current) => [...current, clean]);
    }
    setTagDraft('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const title = query.trim();
    if (!title) return;
    onCreateTask({
      title,
      estimate: expected,
      tags: selectedTags,
      startImmediately: !standby,
    });
    setQuery('');
    setSelectedTags([]);
    setStandby(true);
  };

  const taskFor = (entry: Entry) => tasks.find((task) => task.id === entry.taskId);

  return (
    <>
      {!compact && (
        <div className="page-head">
          <div>
            <p className="eyebrow">Capture</p>
            <h2>What are you doing?</h2>
            <p className="page-subtitle">Start loose. Tune the estimate before the clock begins.</p>
          </div>
        </div>
      )}

      <form className="capture-card" onSubmit={submit}>
        <div className="capture-top">
          <div className="field-with-icon">
            <Search size={19} />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setStandby(true);
              }}
              placeholder="Name a task or search your history"
              aria-label="Task name"
            />
            <kbd>↵</kbd>
          </div>
          <button className="primary-button" type="submit">
            <Plus size={17} /> {standby ? 'Prepare' : 'Start'}
          </button>
        </div>

        <div className="capture-controls">
          <div className="control-label">
            <Clock3 size={14} />
            <span>expected duration</span>
          </div>
          <div className="duration-pills">
            {[15, 30, 60, 120, 240].map((value) => (
              <button
                type="button"
                key={value}
                className={expected === value ? 'duration active' : 'duration'}
                onClick={() => {
                  setExpected(value);
                  setStandby(true);
                }}
              >
                {formatMinutes(value)}
              </button>
            ))}
            <input
              className="custom-duration"
              value={expected > 240 ? expected : ''}
              onChange={(event) => setExpected(Number(event.target.value) || 30)}
              placeholder="custom"
              aria-label="Custom expected minutes"
            />
          </div>
          <div className="standby-toggle">
            <button
              type="button"
              className={standby ? 'toggle on' : 'toggle'}
              onClick={() => setStandby((value) => !value)}
              aria-pressed={standby}
              aria-label="Stand by before starting"
            >
              <i />
            </button>
            <span>stand by</span>
            <small>{standby ? 'prepared' : 'starts now'}</small>
          </div>
        </div>

        <div className="tag-row">
          <Tag size={14} />
          <span>tags</span>
          {tags.slice(0, 8).map((tag) => (
            <button
              type="button"
              key={tag}
              className={selectedTags.includes(tag) ? 'tag-chip selected' : 'tag-chip'}
              onClick={() =>
                setSelectedTags((current) =>
                  current.includes(tag)
                    ? current.filter((item) => item !== tag)
                    : [...current, tag],
                )
              }
            >
              #{tag}
            </button>
          ))}
          <input
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTag(tagDraft);
              }
            }}
            placeholder="new tag + enter"
          />
        </div>
      </form>

      <div className="section-block">
        <div className="section-heading">
          <button
            className="collapse-button"
            type="button"
            onClick={() => setOpenCollapsed((value) => !value)}
          >
            {openCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            <span>In progress</span>
            <b>{openEntries.length}</b>
          </button>
          <span className="section-note">running · multi-open ok</span>
        </div>
        {!openCollapsed && (
          <div className="entry-list open-list">
            {openEntries.length === 0 ? (
              <div className="empty-state">
                <Pause size={17} /> Nothing running. Prepared tasks wait here after start.
              </div>
            ) : (
              openEntries.map((entry) => (
                <div
                  className="entry-card running"
                  key={entry.id}
                  data-state={entryLifecycle(entry)}
                >
                  <div className="entry-main">
                    <span className="live-pip" />
                    <div>
                      <h3>{taskFor(entry)?.title}</h3>
                      <p>
                        started {relativeDate(entry.startedAt)} · {formatMinutes(entry.expected)}{' '}
                        expected
                      </p>
                    </div>
                  </div>
                  <div className="entry-actions">
                    <strong>{formatMinutes(durationMinutes(entry))}</strong>
                    <button className="end-button" type="button" onClick={() => onEndEntry(entry)}>
                      End <X size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="section-block">
        <div className="section-heading">
          <button
            className="collapse-button"
            type="button"
            onClick={() => setClosedCollapsed((value) => !value)}
          >
            {closedCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            <span>Recent tasks</span>
            <b>{taskMatches.length}</b>
          </button>
          <div className="list-sort">
            <ListFilter size={14} />
            <span>sort</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortKey)}
            >
              <option value="recent">recent</option>
              <option value="name">name</option>
              <option value="tag">tag</option>
            </select>
          </div>
        </div>
        {!closedCollapsed && (
          <div className="task-list">
            {taskMatches.map((task) => {
              const state = taskLifecycle(task, entries);
              return (
                <div className="task-row" key={task.id} data-state={state}>
                  <div className="task-copy">
                    <h3>{task.title}</h3>
                    <div className="meta-line">
                      <span>{formatMinutes(task.estimate)} expected</span>
                      <span className="lifecycle-label">{state}</span>
                      {task.tags.map((tag) => (
                        <span className="mini-tag" key={tag}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button className="start-button" type="button" onClick={() => onStartTask(task)}>
                    <Play size={13} fill="currentColor" /> start
                  </button>
                </div>
              );
            })}
            {closedEntries.length === 0 && taskMatches.length === 0 && (
              <div className="empty-state">No matching tasks yet.</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
