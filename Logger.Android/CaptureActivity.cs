using Android.Content;
using Android.Content.PM;
using Android.OS;
using Android.Views;
using Android.Views.InputMethods;
using Android.Widget;
using Logger.Core.Logging;

namespace Logger.Android;

[Activity(Label = "@string/app_name", MainLauncher = true, Exported = true, Theme = "@style/Theme.Logger", LaunchMode = LaunchMode.SingleTop)]
public class CaptureActivity : Activity
{
    private readonly List<(long Started, TextView Label)> _elapsed = [];
    private long? _soleOpenSpan;
    private readonly Handler _handler = new(Looper.MainLooper!);
    private EditText _search = null!;
    private EditText _expectBox = null!;
    private TextView _openHeader = null!;
    private TextView _taskHeader = null!;
    private TextView _emptyText = null!;
    private TextView _expectHint = null!;
    private LinearLayout _openList = null!;
    private LinearLayout _taskList = null!;
    private LinearLayout _expectPanel = null!;
    private Button _end = null!;
    private SearchHit? _selected;
    private bool _alive;
    private bool _reloadLock;

    private readonly Action _tick;

    public CaptureActivity()
    {
        _tick = () =>
        {
            if (!_alive)
                return;

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            foreach (var (started, label) in _elapsed)
                label.Text = DurationText.Format(Math.Max(0, now - started) / 1000);

            _handler.PostDelayed(_tick, 1000);
        };
    }

    protected override void OnCreate(Bundle? savedInstanceState)
    {
        base.OnCreate(savedInstanceState);
        SetContentView(Resource.Layout.activity_capture);
        _search = Require<EditText>(Resource.Id.search);
        _expectBox = Require<EditText>(Resource.Id.expectBox);
        _openHeader = Require<TextView>(Resource.Id.openHeader);
        _taskHeader = Require<TextView>(Resource.Id.taskHeader);
        _emptyText = Require<TextView>(Resource.Id.emptyText);
        _expectHint = Require<TextView>(Resource.Id.expectHint);
        _openList = Require<LinearLayout>(Resource.Id.openList);
        _taskList = Require<LinearLayout>(Resource.Id.taskList);
        _expectPanel = Require<LinearLayout>(Resource.Id.expectPanel);
        _end = Require<Button>(Resource.Id.btnEnd);

        _search.AfterTextChanged += (_, _) =>
        {
            if (!_reloadLock)
                Reload();
        };
        _search.EditorAction += (_, args) =>
        {
            if (args.ActionId == ImeAction.Done)
            {
                StartCurrent();
                args.Handled = true;
            }
        };

        Require<Button>(Resource.Id.btnStart).Click += (_, _) => StartCurrent();
        _end.Click += (_, _) =>
        {
            if (ResolveEnd() is long spanId)
                EndSpan(spanId);
        };
        Require<Button>(Resource.Id.btnExpect).Click += (_, _) => ToggleExpect();
        Require<Button>(Resource.Id.btnJournal).Click += (_, _) => OpenJournal();
        Require<Button>(Resource.Id.applyExpect).Click += (_, _) => ApplyExpected(_expectBox.Text);

        var presets = Require<LinearLayout>(Resource.Id.presets);
        foreach (var preset in new[] { "15m", "30m", "1h", "2h", "4h", "8h", "1d" })
        {
            var button = new Button(this) { Text = preset };
            button.SetBackgroundResource(Resource.Drawable.chip);
            button.SetTextColor(AndroidUi.Text);
            button.SetAllCaps(false);
            var layout = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WrapContent, ViewGroup.LayoutParams.WrapContent);
            layout.MarginEnd = AndroidUi.Dp(this, 8);
            button.LayoutParameters = layout;
            button.Click += (_, _) => ApplyExpected(preset);
            presets.AddView(button);
        }

        EnsureNotification();
    }

    protected override void OnResume()
    {
        base.OnResume();
        _alive = true;
        Reload();
        _handler.PostDelayed(_tick, 1000);
    }

    protected override void OnPause()
    {
        _alive = false;
        _handler.RemoveCallbacks(_tick);
        base.OnPause();
    }

    protected override void OnNewIntent(Intent? intent)
    {
        base.OnNewIntent(intent);
        Reload();
    }

    public override void OnRequestPermissionsResult(int requestCode, string[] permissions, Permission[] grantResults)
    {
        base.OnRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 41 && grantResults.Length > 0 && grantResults[0] == Permission.Granted)
            StartLogger();
    }

    private void Reload()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var selectedKey = _selected is null ? null : KeyOf(_selected);
        var hits = LoggerApp.Store.Search(_search.Text);
        _openList.RemoveAllViews();
        _taskList.RemoveAllViews();
        _elapsed.Clear();

        var opens = 0;
        var tasks = 0;
        long? soleOpen = null;
        SearchHit? keep = null;
        foreach (var hit in hits)
        {
            if (selectedKey is not null && KeyOf(hit) == selectedKey)
                keep = hit;

            var row = BuildRow(hit, now);
            if (hit.Kind == HitKind.OpenSpan)
            {
                _openList.AddView(row);
                opens++;
                soleOpen = hit.SpanId;
            }
            else
            {
                _taskList.AddView(row);
                tasks++;
            }
        }

        _selected = keep;
        _soleOpenSpan = opens == 1 ? soleOpen : null;
        _openHeader.Visibility = opens == 0 ? ViewStates.Gone : ViewStates.Visible;
        _taskHeader.Visibility = tasks == 0 ? ViewStates.Gone : ViewStates.Visible;
        _emptyText.Visibility = opens + tasks == 0 ? ViewStates.Visible : ViewStates.Gone;
        var canEnd = ResolveEnd() is not null;
        _end.Enabled = canEnd;
        _end.Alpha = canEnd ? 1f : 0.38f;
        _expectHint.Text = _selected?.Kind == HitKind.OpenSpan
            ? "This run only. Long-press a row to choose it."
            : "Default for the next start. Long-press an open run to set that run only.";
    }

    private View BuildRow(SearchHit hit, long now)
    {
        var row = new LinearLayout(this) { Orientation = Orientation.Horizontal };
        row.SetPadding(AndroidUi.Dp(this, 8), AndroidUi.Dp(this, 10), AndroidUi.Dp(this, 8), AndroidUi.Dp(this, 10));
        if (_selected is not null && KeyOf(_selected) == KeyOf(hit))
            row.SetBackgroundColor(AndroidUi.Select);

        var text = new LinearLayout(this) { Orientation = Orientation.Vertical };
        text.LayoutParameters = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WrapContent, 1f);
        text.AddView(AndroidUi.Label(this, hit.Name, 16, AndroidUi.Text));
        text.AddView(AndroidUi.Label(this, Describe(hit), 12, AndroidUi.Muted));

        var trailing = AndroidUi.Label(this, Trailing(hit, now), 14, AndroidUi.Accent);
        trailing.Gravity = GravityFlags.CenterVertical;
        if (hit.Kind == HitKind.OpenSpan && hit.StartedAt is long started)
            _elapsed.Add((started, trailing));

        row.AddView(text);
        row.AddView(trailing);
        row.Clickable = true;
        row.Click += (_, _) =>
        {
            _selected = hit;
            if (hit.Kind == HitKind.OpenSpan && hit.SpanId is long spanId)
                EndSpan(spanId);
            else
                StartName(hit.Name);
        };
        row.LongClick += (_, args) =>
        {
            _selected = hit;
            _expectPanel.Visibility = ViewStates.Visible;
            Reload();
            args.Handled = true;
        };
        return row;
    }

    private void StartCurrent()
    {
        var name = _search.Text;
        if (string.IsNullOrWhiteSpace(name))
            name = _selected?.Name ?? "";

        StartName(name ?? "");
    }

    private void StartName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return;

        try
        {
            LoggerApp.Store.Start(name);
            _reloadLock = true;
            _search.Text = "";
            _reloadLock = false;
            _expectPanel.Visibility = ViewStates.Gone;
            HideKeyboard();
            Reload();
        }
        catch (ArgumentException)
        {
            _reloadLock = false;
        }
    }

    private void EndSpan(long spanId)
    {
        try
        {
            LoggerApp.Store.End(spanId);
            _selected = null;
            _expectPanel.Visibility = ViewStates.Gone;
            Reload();
        }
        catch (InvalidOperationException)
        {
        }
    }

    private void ToggleExpect()
    {
        var show = _expectPanel.Visibility != ViewStates.Visible;
        _expectPanel.Visibility = show ? ViewStates.Visible : ViewStates.Gone;
        if (show)
            _expectBox.RequestFocus();
    }

    private void ApplyExpected(string? text)
    {
        if (!DurationText.TryParse(text, out var seconds))
            return;

        try
        {
            if (_selected?.Kind == HitKind.OpenSpan && _selected.SpanId is long spanId)
                LoggerApp.Store.SetExpected(new ExpectedTarget.ForSpan(spanId), seconds);
            else
            {
                var name = string.IsNullOrWhiteSpace(_search.Text) ? _selected?.Name : _search.Text;
                if (string.IsNullOrWhiteSpace(name))
                    return;

                LoggerApp.Store.SetExpected(new ExpectedTarget.ForName(name), seconds);
            }

            _expectBox.Text = "";
            _expectPanel.Visibility = ViewStates.Gone;
            Reload();
        }
        catch (ArgumentException)
        {
        }
    }

    private void OpenJournal()
    {
        var name = string.IsNullOrWhiteSpace(_search.Text) ? _selected?.Name : _search.Text;
        var intent = new Intent(this, typeof(JournalActivity));
        if (!string.IsNullOrWhiteSpace(name))
            intent.PutExtra("focus", name);

        StartActivity(intent);
    }

    private long? ResolveEnd()
    {
        if (_selected?.Kind == HitKind.OpenSpan)
            return _selected.SpanId;

        return _soleOpenSpan;
    }

    private void EnsureNotification()
    {
        if (OperatingSystem.IsAndroidVersionAtLeast(33) &&
            CheckSelfPermission(global::Android.Manifest.Permission.PostNotifications) != Permission.Granted)
        {
            RequestPermissions([global::Android.Manifest.Permission.PostNotifications], 41);
            return;
        }

        StartLogger();
    }

    private void StartLogger()
    {
        var intent = new Intent(this, typeof(LoggerService));
        if (OperatingSystem.IsAndroidVersionAtLeast(26))
            StartForegroundService(intent);
        else
            StartService(intent);
    }

    private void HideKeyboard()
    {
        var input = (InputMethodManager?)GetSystemService(InputMethodService);
        input?.HideSoftInputFromWindow(_search.WindowToken, HideSoftInputFlags.None);
    }

    private T Require<T>(int id) where T : View =>
        FindViewById<T>(id) ?? throw new InvalidOperationException("Missing view " + id);

    private static string Describe(SearchHit hit)
    {
        if (hit.Kind == HitKind.OpenSpan && hit.StartedAt is long started)
        {
            var when = DateTimeOffset.FromUnixTimeMilliseconds(started).ToLocalTime().ToString("HH:mm");
            return hit.ExpectedSecs is long expected
                ? $"tap to end  ·  since {when}  ·  {DurationText.Format(expected)}"
                : $"tap to end  ·  since {when}";
        }

        return hit.ExpectedSecs is long taskExpected
            ? $"tap to start  ·  expect {DurationText.Format(taskExpected)}"
            : "tap to start";
    }

    private static string Trailing(SearchHit hit, long now)
    {
        if (hit.Kind == HitKind.OpenSpan && hit.StartedAt is long started)
            return DurationText.Format(Math.Max(0, now - started) / 1000);

        return "start";
    }

    private static string KeyOf(SearchHit hit) =>
        hit.Kind == HitKind.OpenSpan ? "s" + hit.SpanId : "t" + hit.TaskId;
}
