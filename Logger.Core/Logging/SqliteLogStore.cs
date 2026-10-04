using Microsoft.Data.Sqlite;

namespace Logger.Core.Logging;

public sealed class SqliteLogStore : ILogStore
{
    private readonly SqliteConnection _db;
    private readonly TimeProvider _clock;
    private readonly object _gate = new();
    private bool _disposed;

    public SqliteLogStore(string path, TimeProvider? clock = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        _clock = clock ?? TimeProvider.System;

        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
        };

        _db = new SqliteConnection(builder.ConnectionString);
        _db.Open();
        Migrate();
    }

    public IReadOnlyList<SearchHit> Search(string? query)
    {
        lock (_gate)
        {
            var q = Normalize(query);
            var opens = ReadOpen(q);
            var tasks = ReadTasks(q);

            IEnumerable<SearchHit> orderedOpens = q.Length == 0
                ? opens.OrderByDescending(hit => hit.StartedAt)
                : opens.OrderBy(hit => Rank(hit.Name, q)).ThenByDescending(hit => hit.StartedAt);

            IEnumerable<SearchHit> orderedTasks = q.Length == 0
                ? tasks.OrderByDescending(hit => hit.StartedAt ?? 0)
                : tasks.OrderBy(hit => Rank(hit.Name, q)).ThenByDescending(hit => hit.StartedAt ?? 0);

            return orderedOpens.Take(20).Concat(orderedTasks.Take(20)).ToArray();
        }
    }

    public SpanRecord Start(string name)
    {
        lock (_gate)
        {
            var normalized = RequireName(name);
            using var tx = _db.BeginTransaction();
            var task = GetOrCreateTask(normalized, tx);
            var now = NowMs();
            using var cmd = _db.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText =
                """
                INSERT INTO spans(task_id, started_at, ended_at, expected_secs)
                VALUES ($task, $started, NULL, $expected)
                RETURNING id;
                """;
            cmd.Parameters.AddWithValue("$task", task.Id);
            cmd.Parameters.AddWithValue("$started", now);
            cmd.Parameters.AddWithValue("$expected", (object?)task.ExpectedSecs ?? DBNull.Value);
            var id = (long)(cmd.ExecuteScalar() ?? throw new InvalidOperationException("Span was not created."));
            tx.Commit();
            return new SpanRecord(id, task.Id, task.Name, now, null, task.ExpectedSecs);
        }
    }

    public SpanRecord End(long spanId)
    {
        lock (_gate)
        {
            var now = NowMs();
            using var cmd = _db.CreateCommand();
            cmd.CommandText =
                """
                UPDATE spans
                SET ended_at = $now
                WHERE id = $id AND ended_at IS NULL;
                """;
            cmd.Parameters.AddWithValue("$now", now);
            cmd.Parameters.AddWithValue("$id", spanId);
            if (cmd.ExecuteNonQuery() != 1)
                throw new InvalidOperationException("That span is not open.");

            return ReadSpan(spanId) ?? throw new InvalidOperationException("That span is not open.");
        }
    }

    public void SetExpected(ExpectedTarget target, long seconds)
    {
        ArgumentNullException.ThrowIfNull(target);
        if (seconds <= 0)
            throw new ArgumentOutOfRangeException(nameof(seconds));

        lock (_gate)
        {
            switch (target)
            {
                case ExpectedTarget.ForTask task:
                    UpdateIfExists(
                        "UPDATE tasks SET expected_secs = $seconds WHERE id = $id;",
                        "SELECT COUNT(*) FROM tasks WHERE id = $id;",
                        ("$seconds", seconds),
                        ("$id", task.TaskId));
                    break;
                case ExpectedTarget.ForSpan span:
                    UpdateIfExists(
                        "UPDATE spans SET expected_secs = $seconds WHERE id = $id;",
                        "SELECT COUNT(*) FROM spans WHERE id = $id;",
                        ("$seconds", seconds),
                        ("$id", span.SpanId));
                    break;
                case ExpectedTarget.ForName named:
                    using (var tx = _db.BeginTransaction())
                    {
                        var task = GetOrCreateTask(RequireName(named.Name), tx);
                        using var cmd = _db.CreateCommand();
                        cmd.Transaction = tx;
                        cmd.CommandText = "UPDATE tasks SET expected_secs = $seconds WHERE id = $id;";
                        cmd.Parameters.AddWithValue("$seconds", seconds);
                        cmd.Parameters.AddWithValue("$id", task.Id);
                        cmd.ExecuteNonQuery();
                        tx.Commit();
                    }

                    break;
                default:
                    throw new ArgumentOutOfRangeException(nameof(target));
            }
        }
    }

    public JournalSnapshot LoadJournal(long? fromMs, string? focusName, TimeZoneInfo timeZone)
    {
        ArgumentNullException.ThrowIfNull(timeZone);
        lock (_gate)
        {
            var now = NowMs();
            var open = ReadSpanList(
                """
                SELECT s.id, s.task_id, t.name, s.started_at, s.ended_at, s.expected_secs
                FROM spans s
                JOIN tasks t ON t.id = s.task_id
                WHERE s.ended_at IS NULL
                ORDER BY s.started_at DESC;
                """);

            var spans = fromMs is long from
                ? ReadSpanList(
                    """
                    SELECT s.id, s.task_id, t.name, s.started_at, s.ended_at, s.expected_secs
                    FROM spans s
                    JOIN tasks t ON t.id = s.task_id
                    WHERE s.started_at >= $from
                    ORDER BY s.started_at DESC;
                    """,
                    ("$from", from))
                : ReadSpanList(
                    """
                    SELECT s.id, s.task_id, t.name, s.started_at, s.ended_at, s.expected_secs
                    FROM spans s
                    JOIN tasks t ON t.id = s.task_id
                    ORDER BY s.started_at DESC;
                    """);

            var rollups = spans
                .GroupBy(span => span.TaskId)
                .Select(group =>
                {
                    var estimated = group.Where(span => span.ExpectedSecs is not null).ToArray();
                    return new TaskRollup(
                        group.Key,
                        group.First().Name,
                        group.Count(),
                        group.Sum(span => span.ActualSeconds(now)),
                        estimated.Sum(span => span.ExpectedSecs ?? 0),
                        group.Count(span => span.IsOpen),
                        estimated.Length);
                })
                .OrderByDescending(task => task.ActualSecs)
                .ThenBy(task => task.Name, StringComparer.OrdinalIgnoreCase)
                .ToArray();

            var requested = string.IsNullOrWhiteSpace(focusName) ? null : Normalize(focusName);
            var focus = string.IsNullOrEmpty(requested) ? null : FindTask(requested);
            var log = requested is null
                ? spans
                : focus is null
                    ? Array.Empty<SpanRecord>()
                    : spans.Where(span => span.TaskId == focus.Id).ToArray();

            var days = focus is null
                ? Array.Empty<DayMark>()
                : HabitDays(focus.Id, fromMs, now, timeZone);

            return new JournalSnapshot(open, log, rollups, days);
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;
        _db.Dispose();
    }

    private void Migrate()
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText =
            """
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                expected_secs INTEGER NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS spans (
                id INTEGER PRIMARY KEY,
                task_id INTEGER NOT NULL REFERENCES tasks(id),
                started_at INTEGER NOT NULL,
                ended_at INTEGER NULL,
                expected_secs INTEGER NULL
            );

            CREATE INDEX IF NOT EXISTS ix_spans_task ON spans(task_id);
            CREATE INDEX IF NOT EXISTS ix_spans_started ON spans(started_at);
            """;
        cmd.ExecuteNonQuery();
    }

    private IReadOnlyList<SearchHit> ReadOpen(string query)
    {
        var sql =
            """
            SELECT s.id, t.id, t.name, s.started_at, s.expected_secs
            FROM spans s
            JOIN tasks t ON t.id = s.task_id
            WHERE s.ended_at IS NULL
            """;
        if (query.Length > 0)
            sql += " AND t.name LIKE $like ESCAPE '\\'";

        SearchHit Map(SqliteDataReader reader) => new(
            HitKind.OpenSpan,
            reader.GetInt64(1),
            reader.GetString(2),
            reader.GetInt64(0),
            reader.GetInt64(3),
            reader.IsDBNull(4) ? null : reader.GetInt64(4));

        return query.Length == 0
            ? Query(sql, Map)
            : Query(sql, Map, ("$like", LikeContains(query)));
    }

    private IReadOnlyList<SearchHit> ReadTasks(string query)
    {
        var sql =
            """
            SELECT t.id, t.name, t.expected_secs, MAX(s.started_at)
            FROM tasks t
            LEFT JOIN spans s ON s.task_id = t.id
            """;
        if (query.Length > 0)
            sql += " WHERE t.name LIKE $like ESCAPE '\\'";

        sql += " GROUP BY t.id;";

        SearchHit Map(SqliteDataReader reader) => new(
            HitKind.Task,
            reader.GetInt64(0),
            reader.GetString(1),
            null,
            reader.IsDBNull(3) ? null : reader.GetInt64(3),
            reader.IsDBNull(2) ? null : reader.GetInt64(2));

        return query.Length == 0
            ? Query(sql, Map)
            : Query(sql, Map, ("$like", LikeContains(query)));
    }

    private IReadOnlyList<SpanRecord> ReadSpanList(string sql, params (string Name, object Value)[] parameters)
    {
        return Query(sql, ReadSpanRow, parameters);
    }

    private SpanRecord? ReadSpan(long id)
    {
        return ReadSpanList(
            """
            SELECT s.id, s.task_id, t.name, s.started_at, s.ended_at, s.expected_secs
            FROM spans s
            JOIN tasks t ON t.id = s.task_id
            WHERE s.id = $id;
            """,
            ("$id", id)).FirstOrDefault();
    }

    private static SpanRecord ReadSpanRow(SqliteDataReader reader)
    {
        return new SpanRecord(
            reader.GetInt64(0),
            reader.GetInt64(1),
            reader.GetString(2),
            reader.GetInt64(3),
            reader.IsDBNull(4) ? null : reader.GetInt64(4),
            reader.IsDBNull(5) ? null : reader.GetInt64(5));
    }

    private IReadOnlyList<DayMark> HabitDays(long taskId, long? fromMs, long now, TimeZoneInfo zone)
    {
        var today = LocalDate(now, zone);
        var startDay = fromMs is long from ? LocalDate(from, zone) : today.AddDays(-41);
        if (startDay > today)
            startDay = today;

        if (today.DayNumber - startDay.DayNumber > 62)
            startDay = DateOnly.FromDayNumber(today.DayNumber - 62);

        var windowStart = LocalDayStartMs(startDay, zone);
        var windowEnd = LocalDayStartMs(today.AddDays(1), zone);
        var spans = ReadSpanList(
            """
            SELECT s.id, s.task_id, t.name, s.started_at, s.ended_at, s.expected_secs
            FROM spans s
            JOIN tasks t ON t.id = s.task_id
            WHERE s.task_id = $task
              AND s.started_at < $end
              AND (s.ended_at IS NULL OR s.ended_at > $start);
            """,
            ("$task", taskId),
            ("$end", windowEnd),
            ("$start", windowStart));

        var days = new List<DayMark>();
        for (var day = startDay; day <= today; day = day.AddDays(1))
        {
            var dayStart = LocalDayStartMs(day, zone);
            var dayEnd = LocalDayStartMs(day.AddDays(1), zone);
            long actual = 0;
            foreach (var item in spans)
            {
                var end = item.EndedAt ?? now;
                var overlapStart = Math.Max(item.StartedAt, dayStart);
                var overlapEnd = Math.Min(end, dayEnd);
                if (overlapEnd > overlapStart)
                    actual += (overlapEnd - overlapStart) / 1000;
            }

            days.Add(new DayMark(day, actual > 0, actual));
        }

        return days;
    }

    private TaskRow GetOrCreateTask(string name, SqliteTransaction tx)
    {
        var existing = FindTask(name, tx);
        if (existing is not null)
            return existing;

        var now = NowMs();
        using var insert = _db.CreateCommand();
        insert.Transaction = tx;
        insert.CommandText =
            """
            INSERT INTO tasks(name, expected_secs, created_at)
            VALUES ($name, NULL, $now)
            RETURNING id;
            """;
        insert.Parameters.AddWithValue("$name", name);
        insert.Parameters.AddWithValue("$now", now);
        var id = (long)(insert.ExecuteScalar() ?? throw new InvalidOperationException("Task was not created."));
        return new TaskRow(id, name, null, now);
    }

    private TaskRow? FindTask(string name, SqliteTransaction? tx = null)
    {
        using var cmd = _db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT id, name, expected_secs, created_at FROM tasks WHERE name = $name COLLATE NOCASE LIMIT 1;";
        cmd.Parameters.AddWithValue("$name", name);
        using var reader = cmd.ExecuteReader();
        if (!reader.Read())
            return null;

        return new TaskRow(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetInt64(2),
            reader.GetInt64(3));
    }

    private void UpdateIfExists(string updateSql, string existsSql, params (string Name, object Value)[] parameters)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = updateSql;
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value);

        cmd.ExecuteNonQuery();
        cmd.CommandText = existsSql;
        var count = (long)(cmd.ExecuteScalar() ?? 0L);
        if (count != 1)
            throw new InvalidOperationException("Nothing was updated.");
    }

    private IReadOnlyList<T> Query<T>(string sql, Func<SqliteDataReader, T> map, params (string Name, object Value)[] parameters)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value);

        using var reader = cmd.ExecuteReader();
        var rows = new List<T>();
        while (reader.Read())
            rows.Add(map(reader));

        return rows;
    }

    private long NowMs() => _clock.GetUtcNow().ToUnixTimeMilliseconds();

    private static int Rank(string name, string query)
    {
        if (name.StartsWith(query, StringComparison.OrdinalIgnoreCase))
            return 0;

        if (name.Contains(query, StringComparison.OrdinalIgnoreCase))
            return 1;

        return 2;
    }

    private static string LikeContains(string query) => "%" + EscapeLike(query) + "%";

    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);

    public static string Normalize(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return "";

        var parts = name.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return string.Join(' ', parts);
    }

    private static string RequireName(string name)
    {
        var normalized = Normalize(name);
        if (normalized.Length == 0)
            throw new ArgumentException("A task needs a name.", nameof(name));

        if (normalized.Length > 80)
            throw new ArgumentException("Keep the name under 80 characters.", nameof(name));

        return normalized;
    }

    private static DateOnly LocalDate(long unixMs, TimeZoneInfo zone)
    {
        var local = TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(unixMs), zone);
        return DateOnly.FromDateTime(local.DateTime);
    }

    private static long LocalDayStartMs(DateOnly day, TimeZoneInfo zone)
    {
        var local = day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        var offset = zone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset).ToUnixTimeMilliseconds();
    }

    private sealed record TaskRow(long Id, string Name, long? ExpectedSecs, long CreatedAt);
}
