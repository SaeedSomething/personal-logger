using System.IO;
using Logger.Core.Logging;

namespace Logger.Windows;

public partial class App : System.Windows.Application
{
    private TrayHost? _tray;

    public static bool IsExiting { get; private set; }

    public static ILogStore Store { get; private set; } = null!;

    protected override void OnStartup(System.Windows.StartupEventArgs e)
    {
        base.OnStartup(e);
        SQLitePCL.Batteries_V2.Init();
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "personal-logger");
        Directory.CreateDirectory(dir);
        Store = new SqliteLogStore(Path.Combine(dir, "logger.db"));
        _tray = new TrayHost();
    }

    protected override void OnExit(System.Windows.ExitEventArgs e)
    {
        IsExiting = true;
        _tray?.Dispose();
        Store.Dispose();
        base.OnExit(e);
    }

    public static void ExitApp()
    {
        IsExiting = true;
        Current.Shutdown();
    }
}
