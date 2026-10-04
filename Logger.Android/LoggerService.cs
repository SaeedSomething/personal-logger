using Android.App;
using Android.Content;
using Android.Content.PM;
using Android.OS;

namespace Logger.Android;

[Service(Exported = false, ForegroundServiceType = ForegroundService.TypeSpecialUse)]
public class LoggerService : Service
{
    public const int NotificationId = 41;
    private const string ChannelId = "logger";

    public override void OnCreate()
    {
        base.OnCreate();
        if (!OperatingSystem.IsAndroidVersionAtLeast(26))
            return;

        var channel = new NotificationChannel(ChannelId, "Logger", NotificationImportance.Low)
        {
            Description = "Ongoing shortcut for the logger",
        };
        var manager = (NotificationManager?)GetSystemService(NotificationService);
        manager?.CreateNotificationChannel(channel);
    }

    public override StartCommandResult OnStartCommand(Intent? intent, StartCommandFlags flags, int startId)
    {
        var notification = BuildNotification();
        if (OperatingSystem.IsAndroidVersionAtLeast(34))
            StartForeground(NotificationId, notification, ForegroundService.TypeSpecialUse);
        else
            StartForeground(NotificationId, notification);

        return StartCommandResult.Sticky;
    }

    public override IBinder? OnBind(Intent? intent) => null;

    private Notification BuildNotification()
    {
        var open = new Intent(this, typeof(CaptureActivity));
        open.SetFlags(ActivityFlags.SingleTop | ActivityFlags.ReorderToFront);
        var pending = PendingIntent.GetActivity(
            this,
            0,
            open,
            PendingIntentFlags.Immutable | PendingIntentFlags.UpdateCurrent);

        return new Notification.Builder(this, ChannelId)
            .SetContentTitle("Logger")
            .SetContentText("Tap to log a task")
            .SetSmallIcon(Resource.Drawable.ic_notification)
            .SetOngoing(true)
            .SetContentIntent(pending)!
            .Build();
    }
}
