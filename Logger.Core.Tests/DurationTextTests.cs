using Logger.Core.Logging;
using Xunit;

namespace Logger.Core.Tests;

public class DurationTextTests
{
    [Theory]
    [InlineData("90m", 5_400)]
    [InlineData("2h30m", 9_000)]
    [InlineData("1d", 86_400)]
    [InlineData("1d 4h", 100_800)]
    [InlineData("15", 900)]
    [InlineData("1.5h", 5_400)]
    [InlineData("2h", 7_200)]
    public void Parses_estimates(string text, long seconds)
    {
        Assert.True(DurationText.TryParse(text, out var parsed));
        Assert.Equal(seconds, parsed);
    }

    [Theory]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("-5")]
    [InlineData("1x")]
    public void Rejects_empty_or_nonsense(string text)
    {
        Assert.False(DurationText.TryParse(text, out _));
    }

    [Theory]
    [InlineData(30, "<1m")]
    [InlineData(18 * 60, "18m")]
    [InlineData(3 * 3600 + 20 * 60, "3h 20m")]
    [InlineData(2 * 86_400 + 4 * 3600, "2d 4h")]
    public void Formats_from_minutes_through_days(long seconds, string text)
    {
        Assert.Equal(text, DurationText.Format(seconds));
    }
}
