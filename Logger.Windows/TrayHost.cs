using System.Drawing;
using System.Drawing.Drawing2D;

namespace Logger.Windows;

public sealed class TrayHost : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly CaptureWindow _capture;
    private readonly JournalWindow _journal;
    private readonly Icon _image;

    public TrayHost()
    {
        _capture = new CaptureWindow();
        _journal = new JournalWindow();
        _capture.Attach(this);
        _image = CreateIcon();
        _icon = new NotifyIcon
        {
            Icon = _image,
            Text = "Logger",
            Visible = true,
            ContextMenuStrip = BuildMenu(),
        };
        _icon.MouseClick += OnMouseClick;
    }

    public void ShowJournal(string? name)
    {
        _journal.ShowFocus(name);
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
        _capture.Close();
        _journal.Close();
        _image.Dispose();
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Journal", null, (_, _) => Dispatch(() => ShowJournal(null)));
        menu.Items.Add("Exit", null, (_, _) => Dispatch(App.ExitApp));
        return menu;
    }

    private void OnMouseClick(object? sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left || TrayGate.IsSuppressed)
            return;

        Dispatch(ToggleCapture);
    }

    private void ToggleCapture()
    {
        if (TrayGate.IsSuppressed)
            return;

        if (_capture.IsVisible)
            _capture.Hide();
        else
            _capture.ShowAtCursor();
    }

    private static void Dispatch(Action action)
    {
        System.Windows.Application.Current.Dispatcher.BeginInvoke(action);
    }

    private static Icon CreateIcon()
    {
        using var bmp = new Bitmap(32, 32, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var fill = new SolidBrush(Color.FromArgb(228, 176, 122));
            g.FillEllipse(fill, 1, 1, 30, 30);
            using var ink = new Pen(Color.FromArgb(18, 20, 26), 2.6f)
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.Round,
            };
            g.DrawLine(ink, 16, 17, 16, 8);
            g.DrawLine(ink, 16, 17, 23, 21);
        }

        return Icon.FromHandle(bmp.GetHicon());
    }
}

internal static class TrayGate
{
    private static long _until;

    public static bool IsSuppressed => Environment.TickCount64 < _until;

    public static void SuppressBriefly() => _until = Environment.TickCount64 + 250;
}
