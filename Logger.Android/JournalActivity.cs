using Android.App;
using Android.Content;
using Android.Graphics;
using Android.OS;
using Android.Views;
using Android.Widget;
using Logger.Core.Logging;

namespace Logger.Android;

[Activity(Label = "@string/app_name", Theme = "@style/Theme.Logger", Exported = false)]
public class JournalActivity : Activity
{
    private TextView _focusLabel = null!;
    private TextView _totals = null!;
    private Button _clear = null!;
    private Button _range7 = null!;
    private Button _range30 = null!;
    private Button _rangeAll = null!;
    private LinearLayout _content = null!;
    private int _days = 7;
    private string? _focus;

    protected override void OnCreate(Bundle? savedInstanceState)
    {
        base.OnCreate(savedInstanceState);
        SetContentView(Resource.Layout.activity_journal);
        _focus = Intent?.GetStringExtra("focus");
        _focusLabel = RequireView<TextView>(Resource.Id.focusLabel);
        _totals = RequireView<TextView>(Resource.Id.totals);
        _clear = RequireView<Button>(Resource.Id.clearFocus);
        _range7 = RequireView<Button>(Resource.Id.range7);
        _range30 = RequireView<Button>(Resource.Id.range30);
        _rangeAll = RequireView<Button>(Resource.Id.rangeAll);
        _content = RequireView<LinearLayout>(Resource.Id.content);

        _range7.Click += (_, _) => SetRange(7);
        _range30.Click += (_, _) => SetRange(30);
        _rangeAll.Click += (_, _) => SetRange(0);
        _clear.Click += (_, _) =>
        {
            _focus = null;
            Reload();
        };
    }

    protected override void OnResume()
    {
        base.OnResume();
        Reload();
    }

    private void SetRange(int days)
    {
        _days = days;
        Reload();
    }

    private void Reload()
    {
        var from = _days == 0 ? (long?)null : DateTimeOffset.Now.AddDays(-_days).ToUnixTimeMilliseconds();
        var journal = LoggerApp.Store.LoadJournal(from, _focus, TimeZoneInfo.Local);
        var focused = string.IsNullOrWhiteSpace(_focus) ? null : SqliteLogStore.Normalize(_focus);
        _focusLabel.Text = focused ?? "All tasks";
        _clear.Visibility = focused is null ? ViewStates.Gone : ViewStates.Visible;
        Paint(_range7, _days == 7);
        Paint(_range30, _days == 30);
        Paint(_rangeAll, _days == 0);

        var actual = journal.Tasks.Sum(task => task.ActualSecs);
        var expected = journal.Tasks.Sum(task => task.ExpectedSecs);
        _totals.Text = journal.Tasks.Count == 0
            ? "No time logged in this range."
            : $"{journal.Tasks.Count} tasks  ·  {DurationText.Format(actual)} actual  ·  {DurationText.Format(expected)} expected";

        _content.RemoveAllViews();
        AndroidUi.Section(this, _content, "OPEN");
        if (journal.OpenSpans.Count == 0)
            _content.AddView(AndroidUi.Label(this, "Nothing running.", 14, AndroidUi.Muted));
        foreach (var span in journal.OpenSpans)
            _content.AddView(OpenRow(span));

        AndroidUi.Section(this, _content, "EXPECTED VS ACTUAL");
        if (journal.Tasks.Count == 0)
            _content.AddView(AndroidUi.Label(this, "No spans in this range yet.", 14, AndroidUi.Muted));

        var max = journal.Tasks.Select(task => Math.Max(task.ActualSecs, task.ExpectedSecs)).DefaultIfEmpty(1).Max();
        if (max <= 0)
            max = 1;
        foreach (var task in journal.Tasks)
            _content.AddView(ChartRow(task, max, focused));

        AndroidUi.Section(this, _content, "HABIT");
        if (focused is null || journal.Days.Count == 0)
        {
            _content.AddView(AndroidUi.Label(this, "Select a task to see which days it shows up.", 14, AndroidUi.Muted));
        }
        else
        {
            var active = journal.Days.Count(day => day.Active);
            var total = journal.Days.Sum(day => day.ActualSecs);
            _content.AddView(AndroidUi.Label(this, $"{focused}  ·  {active} days  ·  {DurationText.Format(total)}", 14, AndroidUi.Muted));
            var days = new LinearLayout(this) { Orientation = Orientation.Horizontal };
            days.SetPadding(0, AndroidUi.Dp(this, 8), 0, AndroidUi.Dp(this, 8));
            var scroller = new HorizontalScrollView(this);
            foreach (var day in journal.Days)
                days.AddView(DayCell(day));
            scroller.AddView(days);
            _content.AddView(scroller);
        }

        AndroidUi.Section(this, _content, "LOG");
        if (journal.Spans.Count == 0)
            _content.AddView(AndroidUi.Label(this, "No spans in this range.", 14, AndroidUi.Muted));
        foreach (var span in journal.Spans)
            _content.AddView(LogRow(span));
    }

    private View OpenRow(SpanRecord span)
    {
        var row = new LinearLayout(this) { Orientation = Orientation.Horizontal };
        var text = new LinearLayout(this) { Orientation = Orientation.Vertical };
        text.LayoutParameters = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WrapContent, 1f);
        text.AddView(AndroidUi.Label(this, span.Name, 16, AndroidUi.Text));
        text.AddView(AndroidUi.Label(this, "since " + Clock(span.StartedAt), 12, AndroidUi.Muted));
        var elapsed = AndroidUi.Label(this, DurationText.Format(span.ActualSeconds(Now())), 14, AndroidUi.Accent);
        elapsed.Gravity = GravityFlags.CenterVertical;
        var end = new Button(this) { Text = "End" };
        end.SetAllCaps(false);
        end.SetTextColor(AndroidUi.Text);
        end.SetBackgroundResource(Resource.Drawable.chip);
        end.Click += (_, _) =>
        {
            try
            {
                LoggerApp.Store.End(span.Id);
            }
            catch (InvalidOperationException)
            {
            }

            Reload();
        };
        row.AddView(text);
        row.AddView(elapsed);
        row.AddView(end);
        var card = AndroidUi.Card(this);
        card.AddView(row);
        return card;
    }

    private View ChartRow(TaskRollup task, long max, string? focused)
    {
        var card = AndroidUi.Card(this);
        if (focused is not null && string.Equals(focused, task.Name, StringComparison.OrdinalIgnoreCase))
            card.SetBackgroundColor(AndroidUi.Select);

        card.Clickable = true;
        card.Click += (_, _) =>
        {
            _focus = task.Name;
            Reload();
        };
        card.AddView(AndroidUi.Label(this, task.Name, 16, AndroidUi.Text));
        card.AddView(AndroidUi.Label(this, $"{task.SpanCount} spans", 12, AndroidUi.Muted));
        card.AddView(Bar(task.ActualSecs, max, AndroidUi.Accent, "actual"));
        card.AddView(Bar(task.ExpectedSecs, max, AndroidUi.Expect, "expect"));
        var delta = task.EstimatedCount == 0
            ? "no estimate"
            : DurationText.FormatSigned(task.ActualSecs - task.ExpectedSecs);
        if (task.EstimatedCount > 0 && task.EstimatedCount < task.SpanCount)
            delta += "  ·  partial";
        card.AddView(AndroidUi.Label(this, delta, 13, AndroidUi.Text));
        return card;
    }

    private View Bar(long seconds, long max, Color color, string caption)
    {
        var row = new LinearLayout(this)
        {
            Orientation = Orientation.Horizontal,
        };
        row.SetPadding(0, AndroidUi.Dp(this, 4), 0, AndroidUi.Dp(this, 4));
        var track = new LinearLayout(this) { Orientation = Orientation.Horizontal };
        track.LayoutParameters = new LinearLayout.LayoutParams(AndroidUi.Dp(this, 160), AndroidUi.Dp(this, 8))
        {
            Gravity = GravityFlags.CenterVertical,
        };
        var fraction = max <= 0 ? 0f : (float)seconds / max;
        var fill = new View(this);
        fill.SetBackgroundColor(color);
        fill.LayoutParameters = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MatchParent, seconds <= 0 ? 0f : fraction);
        var rest = new View(this);
        rest.SetBackgroundColor(AndroidUi.Line);
        rest.LayoutParameters = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MatchParent, seconds <= 0 ? 1f : Math.Max(0f, 1f - fraction));
        track.AddView(fill);
        track.AddView(rest);
        row.AddView(track);
        var label = AndroidUi.Label(this, $"{caption}  {DurationText.Format(seconds)}", 12, AndroidUi.Muted);
        label.SetPadding(AndroidUi.Dp(this, 8), 0, 0, 0);
        row.AddView(label);
        return row;
    }

    private View DayCell(DayMark day)
    {
        var cell = new View(this);
        var layout = new LinearLayout.LayoutParams(AndroidUi.Dp(this, 14), AndroidUi.Dp(this, 22));
        layout.MarginEnd = AndroidUi.Dp(this, 3);
        cell.LayoutParameters = layout;
        cell.SetBackgroundColor(day.Active ? AndroidUi.Accent : AndroidUi.Select);
        cell.ContentDescription = day.Active
            ? $"{day.Day:MMM d}, {DurationText.Format(day.ActualSecs)}"
            : $"{day.Day:MMM d}, none";
        return cell;
    }

    private View LogRow(SpanRecord span)
    {
        var actual = span.ActualSeconds(Now());
        var when = span.EndedAt is long ended
            ? $"{Clock(span.StartedAt)}  –  {Clock(ended)}"
            : $"{Clock(span.StartedAt)}  –  open";
        var expect = span.ExpectedSecs is long expected ? DurationText.Format(expected) : "—";
        var delta = span.ExpectedSecs is long estimate ? DurationText.FormatSigned(actual - estimate) : "";
        var card = AndroidUi.Card(this);
        card.Clickable = true;
        card.Click += (_, _) =>
        {
            _focus = span.Name;
            Reload();
        };
        card.AddView(AndroidUi.Label(this, span.Name, 15, AndroidUi.Text));
        card.AddView(AndroidUi.Label(this, when, 12, AndroidUi.Muted));
        card.AddView(AndroidUi.Label(this, $"{DurationText.Format(actual)}   expect {expect}   {delta}", 13, AndroidUi.Accent));
        return card;
    }

    private void Paint(Button button, bool selected)
    {
        if (selected)
        {
            button.SetBackgroundColor(AndroidUi.Accent);
            button.SetTextColor(AndroidUi.Bg);
            return;
        }

        button.SetBackgroundResource(Resource.Drawable.chip);
        button.SetTextColor(AndroidUi.Text);
    }

    private T RequireView<T>(int id) where T : View =>
        FindViewById<T>(id) ?? throw new InvalidOperationException("Missing view " + id);

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static string Clock(long unixMs) =>
        DateTimeOffset.FromUnixTimeMilliseconds(unixMs).ToLocalTime().ToString("MMM d, HH:mm");
}
