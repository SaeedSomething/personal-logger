using System.ComponentModel;
using System.Runtime.CompilerServices;
using Logger.Core.Logging;

namespace Logger.Windows;

public sealed class HitRow : INotifyPropertyChanged
{
    private string _trailing;
    private bool _isSelected;

    public HitRow(SearchHit hit, long nowMs)
    {
        Hit = hit;
        Subtitle = Describe(hit);
        _trailing = hit.Kind == HitKind.OpenSpan && hit.StartedAt is long started
            ? DurationText.Format(Math.Max(0, nowMs - started) / 1000)
            : "start";
    }

    public SearchHit Hit { get; }

    public string Title => Hit.Name;

    public string Subtitle { get; }

    public string Trailing
    {
        get => _trailing;
        private set => Set(ref _trailing, value);
    }

    public bool IsSelected
    {
        get => _isSelected;
        private set => Set(ref _isSelected, value);
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public void RefreshElapsed(long nowMs)
    {
        if (Hit.Kind != HitKind.OpenSpan || Hit.StartedAt is not long started)
            return;

        Trailing = DurationText.Format(Math.Max(0, nowMs - started) / 1000);
    }

    public void Select(bool selected) => IsSelected = selected;

    private void Set(ref bool field, bool value, [CallerMemberName] string? name = null)
    {
        if (field == value)
            return;

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }

    private void Set(ref string field, string value, [CallerMemberName] string? name = null)
    {
        if (field == value)
            return;

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }

    private static string Describe(SearchHit hit)
    {
        if (hit.Kind == HitKind.OpenSpan && hit.StartedAt is long started)
        {
            var when = DateTimeOffset.FromUnixTimeMilliseconds(started).ToLocalTime().ToString("HH:mm");
            return hit.ExpectedSecs is long expected
                ? $"click to end  ·  since {when}  ·  {DurationText.Format(expected)}"
                : $"click to end  ·  since {when}";
        }

        return hit.ExpectedSecs is long taskExpected
            ? $"start another  ·  expect {DurationText.Format(taskExpected)}"
            : "start another";
    }
}
