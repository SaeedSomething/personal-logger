using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using Logger.Core.Logging;
using Key = System.Windows.Input.Key;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using MouseEventArgs = System.Windows.Input.MouseEventArgs;

namespace Logger.Windows;

public partial class CaptureWindow : Window
{
    private readonly DispatcherTimer _ticker;
    private readonly List<HitRow> _rows = [];
    private HitRow? _selected;
    private TrayHost? _host;
    private bool _armed;

    public CaptureWindow()
    {
        InitializeComponent();
        _ticker = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _ticker.Tick += (_, _) =>
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            foreach (var row in _rows)
                row.RefreshElapsed(now);
        };
    }

    public void ShowAtCursor()
    {
        _armed = false;
        Reload();
        if (!IsVisible)
            Show();

        UpdateLayout();
        var dpi = System.Windows.Media.VisualTreeHelper.GetDpi(this);
        var cursor = System.Windows.Forms.Cursor.Position;
        var x = cursor.X / dpi.DpiScaleX;
        var y = cursor.Y / dpi.DpiScaleY;
        var area = SystemParameters.WorkArea;
        var left = x - ActualWidth + 28;
        var top = y - ActualHeight - 6;
        if (left < area.Left)
            left = area.Left + 8;
        if (top < area.Top)
            top = y + 12;
        if (left + ActualWidth > area.Right)
            left = area.Right - ActualWidth - 8;
        if (top + ActualHeight > area.Bottom)
            top = area.Bottom - ActualHeight - 8;

        Left = left;
        Top = top;
        Activate();
        SearchBox.Focus();
        Keyboard.Focus(SearchBox);
        _armed = true;
        _ticker.Start();
    }

    protected override void OnDeactivated(EventArgs e)
    {
        base.OnDeactivated(e);
        if (!_armed)
            return;

        _armed = false;
        _ticker.Stop();
        Hide();
        TrayGate.SuppressBriefly();
    }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        if (!App.IsExiting)
        {
            e.Cancel = true;
            _armed = false;
            _ticker.Stop();
            Hide();
            return;
        }

        base.OnClosing(e);
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            _armed = false;
            _ticker.Stop();
            Hide();
            TrayGate.SuppressBriefly();
            e.Handled = true;
            return;
        }

        if (e.Key == Key.Enter)
        {
            if (ExpectBox.IsKeyboardFocused)
                ApplyExpect_Click(this, e);
            else
                Start_Click(this, e);

            e.Handled = true;
            return;
        }

        if (e.Key is Key.Down or Key.Up)
        {
            Move(e.Key == Key.Down ? 1 : -1);
            e.Handled = true;
        }
    }

    private void SearchBox_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e)
    {
        Placeholder.Visibility = string.IsNullOrEmpty(SearchBox.Text) ? Visibility.Visible : Visibility.Collapsed;
        if (IsLoaded)
            Reload();
    }

    private void Row_MouseEnter(object sender, MouseEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: HitRow row })
            Select(row);
    }

    private void Row_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { DataContext: HitRow row })
            return;

        Select(row);
        if (row.Hit.Kind == HitKind.OpenSpan && row.Hit.SpanId is long spanId)
            EndSpan(spanId);
        else
            StartName(row.Hit.Name);
    }

    private void Start_Click(object sender, RoutedEventArgs e)
    {
        var name = SearchBox.Text;
        if (string.IsNullOrWhiteSpace(name))
            name = _selected?.Hit.Name ?? "";

        StartName(name);
    }

    private void End_Click(object sender, RoutedEventArgs e)
    {
        if (ResolveEndTarget() is long spanId)
            EndSpan(spanId);
    }

    private void Expect_Click(object sender, RoutedEventArgs e)
    {
        var open = ExpectPanel.Visibility != Visibility.Visible;
        ExpectPanel.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
        ExpectHint.Text = _selected?.Hit.Kind == HitKind.OpenSpan
            ? "This run only"
            : "Default for the next start";
        if (open)
            ExpectBox.Focus();
    }

    private void Journal_Click(object sender, RoutedEventArgs e)
    {
        var name = CurrentName();
        _armed = false;
        _ticker.Stop();
        Hide();
        _host?.ShowJournal(string.IsNullOrWhiteSpace(name) ? null : name);
    }

    private void Preset_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string text })
            ApplyExpected(text);
    }

    private void ApplyExpect_Click(object sender, RoutedEventArgs e) => ApplyExpected(ExpectBox.Text);

    public void Attach(TrayHost host) => _host = host;

    private void StartName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return;

        try
        {
            App.Store.Start(name);
            SearchBox.Clear();
            ExpectPanel.Visibility = Visibility.Collapsed;
            Reload();
        }
        catch (ArgumentException)
        {
        }
    }

    private void EndSpan(long spanId)
    {
        try
        {
            App.Store.End(spanId);
            ExpectPanel.Visibility = Visibility.Collapsed;
            Reload();
        }
        catch (InvalidOperationException)
        {
        }
    }

    private void ApplyExpected(string text)
    {
        if (!DurationText.TryParse(text, out var seconds))
            return;

        try
        {
            if (_selected?.Hit.Kind == HitKind.OpenSpan && _selected.Hit.SpanId is long spanId)
                App.Store.SetExpected(new ExpectedTarget.ForSpan(spanId), seconds);
            else
            {
                var name = CurrentName();
                if (string.IsNullOrWhiteSpace(name))
                    return;

                App.Store.SetExpected(new ExpectedTarget.ForName(name), seconds);
            }

            ExpectBox.Clear();
            ExpectPanel.Visibility = Visibility.Collapsed;
            Reload();
        }
        catch (ArgumentException)
        {
        }
    }

    private void Reload()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var selectedKey = _selected is null ? null : KeyOf(_selected);
        _rows.Clear();
        var opens = new List<HitRow>();
        var tasks = new List<HitRow>();
        foreach (var hit in App.Store.Search(SearchBox.Text))
        {
            var row = new HitRow(hit, now);
            _rows.Add(row);
            if (hit.Kind == HitKind.OpenSpan)
                opens.Add(row);
            else
                tasks.Add(row);
        }

        OpenList.ItemsSource = opens;
        TaskList.ItemsSource = tasks;
        OpenHeader.Visibility = opens.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
        TaskHeader.Visibility = tasks.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
        EmptyText.Visibility = _rows.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

        HitRow? keep = null;
        if (selectedKey is not null)
            keep = _rows.FirstOrDefault(row => KeyOf(row) == selectedKey);

        Select(keep);
    }

    private void Move(int delta)
    {
        if (_rows.Count == 0)
            return;

        var index = _selected is null ? -1 : _rows.IndexOf(_selected);
        if (index < 0)
            index = delta > 0 ? 0 : _rows.Count - 1;
        else
            index = Math.Clamp(index + delta, 0, _rows.Count - 1);

        Select(_rows[index]);
    }

    private void Select(HitRow? row)
    {
        foreach (var item in _rows)
            item.Select(ReferenceEquals(item, row));

        _selected = row;
        EndButton.IsEnabled = ResolveEndTarget() is not null;
        ExpectHint.Text = row?.Hit.Kind == HitKind.OpenSpan
            ? "This run only"
            : "Default for the next start";
    }

    private long? ResolveEndTarget()
    {
        if (_selected?.Hit.Kind == HitKind.OpenSpan)
            return _selected.Hit.SpanId;

        var opens = _rows.Where(row => row.Hit.Kind == HitKind.OpenSpan).ToArray();
        return opens.Length == 1 ? opens[0].Hit.SpanId : null;
    }

    private string CurrentName()
    {
        if (!string.IsNullOrWhiteSpace(SearchBox.Text))
            return SearchBox.Text;

        return _selected?.Hit.Name ?? "";
    }

    private static string KeyOf(HitRow row) =>
        row.Hit.Kind == HitKind.OpenSpan ? "s" + row.Hit.SpanId : "t" + row.Hit.TaskId;
}
