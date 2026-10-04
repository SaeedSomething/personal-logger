namespace Logger.Core.Logging;

public enum HitKind
{
    OpenSpan,
    Task,
}

public sealed record SearchHit(
    HitKind Kind,
    long TaskId,
    string Name,
    long? SpanId,
    long? StartedAt,
    long? ExpectedSecs);

public sealed record SpanRecord(
    long Id,
    long TaskId,
    string Name,
    long StartedAt,
    long? EndedAt,
    long? ExpectedSecs)
{
    public bool IsOpen => EndedAt is null;

    public long ActualSeconds(long nowMs)
    {
        var end = EndedAt ?? nowMs;
        var elapsed = Math.Max(0, end - StartedAt);
        return elapsed / 1000;
    }
}

public abstract record ExpectedTarget
{
    public sealed record ForTask(long TaskId) : ExpectedTarget;

    public sealed record ForSpan(long SpanId) : ExpectedTarget;

    public sealed record ForName(string Name) : ExpectedTarget;
}

public sealed record TaskRollup(
    long TaskId,
    string Name,
    int SpanCount,
    long ActualSecs,
    long ExpectedSecs,
    int OpenCount,
    int EstimatedCount);

public sealed record DayMark(DateOnly Day, bool Active, long ActualSecs);

public sealed record JournalSnapshot(
    IReadOnlyList<SpanRecord> OpenSpans,
    IReadOnlyList<SpanRecord> Spans,
    IReadOnlyList<TaskRollup> Tasks,
    IReadOnlyList<DayMark> Days);
