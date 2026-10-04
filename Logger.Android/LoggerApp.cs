using Android.App;
using Android.Runtime;
using Logger.Core.Logging;

namespace Logger.Android;

[Application]
public class LoggerApp : Application
{
    public static ILogStore Store { get; private set; } = null!;

    public LoggerApp(IntPtr handle, JniHandleOwnership ownership) : base(handle, ownership)
    {
    }

    public override void OnCreate()
    {
        base.OnCreate();
        SQLitePCL.Batteries_V2.Init();
        var path = Path.Combine(FilesDir!.AbsolutePath, "logger.db");
        Store = new SqliteLogStore(path);
    }
}
