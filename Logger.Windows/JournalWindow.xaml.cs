using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shell;
using System.Windows.Threading;
using Logger.Core.Logging;
using Color = System.Windows.Media.Color;
using ColorConverter = System.Windows.Media.ColorConverter;
using FontFamily = System.Windows.Media.FontFamily;
using Cursors = System.Windows.Input.Cursors;
using HorizontalAlignment = System.Windows.HorizontalAlignment;
using Orientation = System.Windows.Controls.Orientation;
using VerticalAlignment = System.Windows.VerticalAlignment;
using WpfButton = System.Windows.Controls.Button;

namespace Logger.Windows;

public partial class JournalWindow : Window
{
    private readonly DispatcherTimer _ticker;
    private readonly List<(SpanRecord Span, TextBlock Label)> _openLabels = [];
    private int _days = 7;
    private string? _focus;
    private bool _reloading;

    public JournalWindow()
    {
        InitializeComponent();
        _ticker = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _ticker.Tick += (_, _) => RefreshOpenElapsed();
    }

    public void ShowFocus(string? name)
    {
        _focus = string.IsNullOrWhiteSpace(name) ? null : name.Trim();
        if (!IsVisible)
            Show();

        Reload();
        Activate();
        _ticker.Start();
    }

    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        if (IsVisible)
            Reload();
    }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        if (!App.IsExiting)
        {
            e.Cancel = true;
            _ticker.Stop();
            Hide();
            return;
        }

        _ticker.Stop();
        base.OnClosing(e);
    }

    private void Title_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
        {
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
            return;
        }

        if (e.LeftButton == MouseButtonState.Pressed)
            DragMove();
    }

    private void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void Maximize_Click(object sender, RoutedEventArgs e) =>
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        _ticker.Stop();
        Hide();
    }

    private void Range_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string tag } && int.TryParse(tag, out var days))
        {
            _days = days;
            Reload();
        }
    }

    private void ClearFocus_Click(object sender, RoutedEventArgs e)
    {
        _focus = null;
        Reload();
    }

    private void Reload()
    {
        if (!IsLoaded || _reloading)
            return;

        _reloading = true;
        try
        {
            ReloadCore();
        }
        finally
        {
            _reloading = false;
        }
    }

    private void ReloadCore()
    {

        var offset = Scroller.VerticalOffset;
        var from = _days == 0 ? (long?)null : DateTimeOffset.Now.AddDays(-_days).ToUnixTimeMilliseconds();
        var journal = App.Store.LoadJournal(from, _focus, TimeZoneInfo.Local);
        var focused = string.IsNullOrWhiteSpace(_focus) ? null : SqliteLogStore.Normalize(_focus);

        FocusLabel.Text = focused ?? "All tasks";
        ClearFocus.Visibility = focused is null ? Visibility.Collapsed : Visibility.Visible;
        PaintRange();

        var actual = journal.Tasks.Sum(task => task.ActualSecs);
        var expected = journal.Tasks.Sum(task => task.ExpectedSecs);
        Totals.Text = journal.Tasks.Count == 0
            ? "No time logged in this range."
            : $"{journal.Tasks.Count} tasks  ·  {DurationText.Format(actual)} actual  ·  {DurationText.Format(expected)} expected";

        OpenHost.Children.Clear();
        _openLabels.Clear();
        OpenEmpty.Visibility = journal.OpenSpans.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        foreach (var span in journal.OpenSpans)
            OpenHost.Children.Add(OpenRow(span));

        ChartHost.Children.Clear();
        ChartEmpty.Visibility = journal.Tasks.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        var max = journal.Tasks.Select(task => Math.Max(task.ActualSecs, task.ExpectedSecs)).DefaultIfEmpty(1).Max();
        if (max <= 0)
            max = 1;

        foreach (var task in journal.Tasks)
            ChartHost.Children.Add(ChartRow(task, max, focused));

        HabitDays.Children.Clear();
        if (focused is null || journal.Days.Count == 0)
        {
            HabitSummary.Text = "Select a task to see which days it shows up.";
        }
        else
        {
            var active = journal.Days.Count(day => day.Active);
            var total = journal.Days.Sum(day => day.ActualSecs);
            HabitSummary.Text = $"{focused}  ·  {active} days  ·  {DurationText.Format(total)}";
            foreach (var day in journal.Days)
                HabitDays.Children.Add(DayCell(day));
        }

        LogHost.Children.Clear();
        LogEmpty.Visibility = journal.Spans.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        foreach (var span in journal.Spans)
            LogHost.Children.Add(LogRow(span));

        Scroller.ScrollToVerticalOffset(offset);
    }

    private void PaintRange()
    {
        PaintRangeButton(Range7, _days == 7);
        PaintRangeButton(Range30, _days == 30);
        PaintRangeButton(RangeAll, _days == 0);
    }

    private static void PaintRangeButton(WpfButton button, bool selected)
    {
        button.Background = selected ? Brush("#FFE4B07A") : Brush("#FF1A1D27");
        button.Foreground = selected ? Brush("#FF12141A") : Brush("#FFE8E6E3");
    }

    private UIElement OpenRow(SpanRecord span)
    {
        var grid = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = Text(DurationText.Format(span.ActualSeconds(NowMs())), 14, "#FFE4B07A", new Thickness(12, 0, 0, 0));
        label.VerticalAlignment = VerticalAlignment.Center;
        _openLabels.Add((span, label));

        var end = new WpfButton
        {
            Content = "End",
            Style = (Style)FindResource("GhostButton"),
            Margin = new Thickness(12, 0, 0, 0),
            Focusable = false,
        };
        end.Click += (_, _) =>
        {
            try
            {
                App.Store.End(span.Id);
            }
            catch (InvalidOperationException)
            {
            }

            Reload();
        };

        var title = Text(span.Name, 14, "#FFE8E6E3", new Thickness(0));
        var since = Text("since " + Clock(span.StartedAt), 11, "#FF8B909C", new Thickness(0, 2, 0, 0));
        var stack = new StackPanel();
        stack.Children.Add(title);
        stack.Children.Add(since);
        grid.Children.Add(stack);
        Grid.SetColumn(label, 1);
        Grid.SetColumn(end, 2);
        grid.Children.Add(label);
        grid.Children.Add(end);
        return Card(grid);
    }

    private UIElement ChartRow(TaskRollup task, long max, string? focused)
    {
        var button = new Border
        {
            Background = Brush(focused != null && string.Equals(focused, task.Name, StringComparison.OrdinalIgnoreCase) ? "#FF232734" : "#FF1A1D27"),
            BorderBrush = Brush("#FF2C3140"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(12, 10, 12, 10),
            Margin = new Thickness(0, 0, 0, 8),
            CornerRadius = new CornerRadius(10),
            Cursor = Cursors.Hand,
        };
        button.MouseLeftButtonUp += (_, _) =>
        {
            _focus = task.Name;
            Reload();
        };

        var root = new Grid();
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(180) });
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(88) });

        var name = Text(task.Name, 14, "#FFE8E6E3", new Thickness(0));
        name.TextTrimming = TextTrimming.CharacterEllipsis;
        var meta = Text($"{task.SpanCount} spans", 11, "#FF8B909C", new Thickness(0, 2, 0, 0));
        var left = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(name);
        left.Children.Add(meta);

        var bars = new StackPanel { Margin = new Thickness(12, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center };
        bars.Children.Add(Bar(task.ActualSecs, max, "#FFE4B07A", "actual"));
        bars.Children.Add(Bar(task.ExpectedSecs, max, "#FF8EA2FF", "expect"));

        var delta = task.EstimatedCount == 0
            ? "no estimate"
            : DurationText.FormatSigned(task.ActualSecs - task.ExpectedSecs);
        if (task.EstimatedCount > 0 && task.EstimatedCount < task.SpanCount)
            delta += "  ·  partial";

        var deltaText = Text(delta, 13, "#FFE8E6E3", new Thickness(0));
        deltaText.HorizontalAlignment = HorizontalAlignment.Right;
        deltaText.VerticalAlignment = VerticalAlignment.Center;

        Grid.SetColumn(bars, 1);
        Grid.SetColumn(deltaText, 2);
        root.Children.Add(left);
        root.Children.Add(bars);
        root.Children.Add(deltaText);
        button.Child = root;
        return button;
    }

    private static UIElement Bar(long seconds, long max, string color, string caption)
    {
        var width = Math.Max(0, 220.0 * seconds / max);
        var track = new Grid { Width = 220, Height = 8, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 3, 0, 3) };
        track.Children.Add(new Border
        {
            Background = Brush("#FF2A2E3A"),
            CornerRadius = new CornerRadius(4),
        });
        track.Children.Add(new Border
        {
            Width = width,
            HorizontalAlignment = HorizontalAlignment.Left,
            Background = Brush(color),
            CornerRadius = new CornerRadius(4),
        });

        var row = new StackPanel { Orientation = Orientation.Horizontal };
        row.Children.Add(track);
        var label = Text($"{caption}  {DurationText.Format(seconds)}", 11, "#FF8B909C", new Thickness(8, 0, 0, 0));
        label.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(label);
        return row;
    }

    private static UIElement DayCell(DayMark day)
    {
        var cell = new Border
        {
            Width = 16,
            Height = 22,
            Margin = new Thickness(2),
            CornerRadius = new CornerRadius(4),
            Background = day.Active ? Brush("#FFE4B07A") : Brush("#FF232734"),
            ToolTip = $"{day.Day:MMM d}  ·  {(day.Active ? DurationText.Format(day.ActualSecs) : "none")}",
        };
        return cell;
    }

    private UIElement LogRow(SpanRecord span)
    {
        var now = NowMs();
        var actual = span.ActualSeconds(now);
        var when = span.EndedAt is long ended
            ? $"{Clock(span.StartedAt)}  –  {Clock(ended)}"
            : $"{Clock(span.StartedAt)}  –  open";
        var expect = span.ExpectedSecs is long expected ? DurationText.Format(expected) : "—";
        var delta = span.ExpectedSecs is long estimate
            ? DurationText.FormatSigned(actual - estimate)
            : "";

        var grid = new Grid { Margin = new Thickness(2, 6, 2, 6) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(220) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(72) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(72) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(72) });

        var cells = new[]
        {
            Text(when, 12, "#FF8B909C", new Thickness(0)),
            Text(span.Name, 13, "#FFE8E6E3", new Thickness(8, 0, 0, 0)),
            Text(DurationText.Format(actual), 12, "#FFE4B07A", new Thickness(0)),
            Text(expect, 12, "#FF8EA2FF", new Thickness(0)),
            Text(delta, 12, "#FFE8E6E3", new Thickness(0)),
        };
        for (var i = 0; i < cells.Length; i++)
        {
            cells[i].VerticalAlignment = VerticalAlignment.Center;
            if (i >= 2)
                cells[i].HorizontalAlignment = HorizontalAlignment.Right;

            Grid.SetColumn(cells[i], i);
            grid.Children.Add(cells[i]);
        }

        var row = new Border
        {
            Child = grid,
            Background = Brush("#FF12141A"),
            BorderThickness = new Thickness(0),
            Cursor = Cursors.Hand,
            Padding = new Thickness(0),
        };
        row.MouseLeftButtonUp += (_, _) =>
        {
            _focus = span.Name;
            Reload();
        };
        return row;
    }

    private void RefreshOpenElapsed()
    {
        var now = NowMs();
        foreach (var (span, label) in _openLabels)
            label.Text = DurationText.Format(span.ActualSeconds(now));
    }

    private static UIElement Card(UIElement child)
    {
        return new Border
        {
            Background = Brush("#FF1A1D27"),
            BorderBrush = Brush("#FF2C3140"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(12, 8, 12, 8),
            Margin = new Thickness(0, 0, 0, 8),
            Child = child,
        };
    }

    private static TextBlock Text(string value, double size, string color, Thickness margin) => new()
    {
        Text = value,
        FontSize = size,
        FontFamily = new FontFamily("Segoe UI"),
        Foreground = Brush(color),
        Margin = margin,
    };

    private static SolidColorBrush Brush(string hex)
    {
        var color = (Color)ColorConverter.ConvertFromString(hex);
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static string Clock(long unixMs) =>
        DateTimeOffset.FromUnixTimeMilliseconds(unixMs).ToLocalTime().ToString("MMM d, HH:mm");
}
