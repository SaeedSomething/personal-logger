namespace Logger.Core.Logging;

public interface ILogStore : IDisposable
{
    IReadOnlyList<SearchHit> Search(string? query);

    SpanRecord Start(string name);

    SpanRecord End(long spanId);

    void SetExpected(ExpectedTarget target, long seconds);

    JournalSnapshot LoadJournal(long? fromMs, string? focusName, TimeZoneInfo timeZone);
}
