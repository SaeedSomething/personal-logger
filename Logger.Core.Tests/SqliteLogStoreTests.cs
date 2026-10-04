using Logger.Core.Logging;
using Xunit;

namespace Logger.Core.Tests;

public class SqliteLogStoreTests : IDisposable
{
    private readonly string _path;
    private readonly ManualClock _clock;
    private readonly SqliteLogStore _store;

    public SqliteLogStoreTests()
    {
        SQLitePCL.Batteries_V2.Init();
        _path = Path.Combine(Path.GetTempPath(), "personal-logger-" + Guid.NewGuid().ToString("N") + ".db");
        _clock = new ManualClock(new DateTimeOffset(2026, 10, 1, 8, 0, 0, TimeSpan.Zero));
        _store = new SqliteLogStore(_path, _clock);
    }

    [Fact]
    public void Start_keeps_the_first_spelling_and_can_reopen_without_closing()
    {
        var first = _store.Start("Running");
        _clock.Advance(TimeSpan.FromMinutes(10));
        var second = _store.Start("  running ");

        Assert.Equal(first.TaskId, second.TaskId);
        Assert.Equal("Running", second.Name);
        Assert.NotEqual(first.Id, second.Id);

        var hits = _store.Search("runn");
        Assert.Equal(2, hits.Count(hit => hit.Kind == HitKind.OpenSpan));
        Assert.Contains(hits, hit => hit.Kind == HitKind.Task && hit.Name == "Running");
    }

    [Fact]
    public void End_closes_only_the_chosen_span()
    {
        var first = _store.Start("laundry");
        var second = _store.Start("laundry");
        _clock.Advance(TimeSpan.FromMinutes(25));

        var closed = _store.End(first.Id);

        Assert.NotNull(closed.EndedAt);
        var open = _store.Search(null).Where(hit => hit.Kind == HitKind.OpenSpan).ToArray();
        Assert.Single(open);
        Assert.Equal(second.Id, open[0].SpanId);
    }

    [Fact]
    public void Expected_on_a_task_is_snapshotted_onto_the_next_start()
    {
        var started = _store.Start("refactor");
        _store.SetExpected(new ExpectedTarget.ForName("refactor"), 3_600);
        _clock.Advance(TimeSpan.FromMinutes(5));
        var next = _store.Start("refactor");

        Assert.Null(started.ExpectedSecs);
        Assert.Equal(3_600, next.ExpectedSecs);

        _store.SetExpected(new ExpectedTarget.ForSpan(next.Id), 1_800);
        var third = _store.Start("refactor");
        Assert.Equal(3_600, third.ExpectedSecs);

        var journal = _store.LoadJournal(null, "refactor", TimeZoneInfo.Utc);
        var updated = Assert.Single(journal.Spans, span => span.Id == next.Id);
        var original = Assert.Single(journal.Spans, span => span.Id == started.Id);
        Assert.Equal(1_800, updated.ExpectedSecs);
        Assert.Null(original.ExpectedSecs);
    }

    [Fact]
    public void Rollup_compares_actual_time_with_the_estimate()
    {
        _store.SetExpected(new ExpectedTarget.ForName("laundry"), 30 * 60);
        var span = _store.Start("laundry");
        _clock.Advance(TimeSpan.FromMinutes(40));
        _store.End(span.Id);

        var journal = _store.LoadJournal(null, "laundry", TimeZoneInfo.Utc);
        var task = Assert.Single(journal.Tasks);
        Assert.Equal(40 * 60, task.ActualSecs);
        Assert.Equal(30 * 60, task.ExpectedSecs);
        Assert.Equal(1, task.EstimatedCount);

        var day = Assert.Single(journal.Days, mark => mark.Day == new DateOnly(2026, 10, 1));
        Assert.True(day.Active);
        Assert.Equal(40 * 60, day.ActualSecs);
    }

    [Fact]
    public void Empty_search_lists_open_spans_before_recent_names()
    {
        _store.Start("laundry");
        _clock.Advance(TimeSpan.FromMinutes(1));
        var open = _store.Start("inbox");
        _store.End(open.Id);

        var hits = _store.Search("  ");
        Assert.Equal(HitKind.OpenSpan, hits[0].Kind);
        Assert.Equal("laundry", hits[0].Name);
        Assert.Contains(hits, hit => hit.Kind == HitKind.Task && hit.Name == "inbox");
    }

    public void Dispose()
    {
        _store.Dispose();
        TryDelete(_path);
        TryDelete(_path + "-wal");
        TryDelete(_path + "-shm");
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch (IOException)
        {
        }
    }

    private sealed class ManualClock(DateTimeOffset utcNow) : TimeProvider
    {
        public DateTimeOffset UtcNow { get; private set; } = utcNow;

        public override DateTimeOffset GetUtcNow() => UtcNow;

        public void Advance(TimeSpan by) => UtcNow = UtcNow.Add(by);
    }
}
