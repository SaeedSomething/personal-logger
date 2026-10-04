using System.Globalization;
using System.Text.RegularExpressions;

namespace Logger.Core.Logging;

public static partial class DurationText
{
    public static string Format(long seconds)
    {
        if (seconds < 0)
            seconds = 0;

        if (seconds < 60)
            return "<1m";

        var days = seconds / 86_400;
        var hours = seconds % 86_400 / 3_600;
        var minutes = seconds % 3_600 / 60;

        if (days > 0)
            return hours > 0 ? $"{days}d {hours}h" : $"{days}d";

        if (hours > 0)
            return minutes > 0 ? $"{hours}h {minutes}m" : $"{hours}h";

        return $"{minutes}m";
    }

    public static string FormatSigned(long seconds)
    {
        if (Math.Abs(seconds) < 60)
            return "0m";

        return seconds > 0 ? "+" + Format(seconds) : "−" + Format(-seconds);
    }

    public static bool TryParse(string? text, out long seconds)
    {
        seconds = 0;
        if (string.IsNullOrWhiteSpace(text))
            return false;

        var cleaned = text.Trim().ToLowerInvariant().Replace(" ", "").Replace(",", ".");
        if (cleaned.Length == 0)
            return false;

        var matches = UnitPattern().Matches(cleaned);
        if (matches.Count > 0 && string.Concat(matches.Select(match => match.Value)) == cleaned)
        {
            long total = 0;
            foreach (Match match in matches)
            {
                if (!double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var amount) || amount < 0)
                    return false;

                total += match.Groups[2].Value switch
                {
                    "d" => (long)Math.Round(amount * 86_400),
                    "h" => (long)Math.Round(amount * 3_600),
                    "m" => (long)Math.Round(amount * 60),
                    _ => 0,
                };
            }

            if (total <= 0)
                return false;

            seconds = total;
            return true;
        }

        if (!double.TryParse(cleaned, NumberStyles.Float, CultureInfo.InvariantCulture, out var minutes) || minutes <= 0)
            return false;

        seconds = (long)Math.Round(minutes * 60);
        return seconds > 0;
    }

    [GeneratedRegex(@"(\d+(?:\.\d+)?)([dhm])", RegexOptions.CultureInvariant)]
    private static partial Regex UnitPattern();
}
