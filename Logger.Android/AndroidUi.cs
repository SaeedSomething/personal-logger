using Android.Content;
using Android.Graphics;
using Android.Util;
using Android.Views;
using Android.Widget;

namespace Logger.Android;

static class AndroidUi
{
    public static readonly Color Bg = Color.ParseColor("#FF12141A");
    public static readonly Color Card = Color.ParseColor("#FF1A1D27");
    public static readonly Color Line = Color.ParseColor("#FF2C3140");
    public static readonly Color Text = Color.ParseColor("#FFE8E6E3");
    public static readonly Color Muted = Color.ParseColor("#FF8B909C");
    public static readonly Color Accent = Color.ParseColor("#FFE4B07A");
    public static readonly Color Expect = Color.ParseColor("#FF8EA2FF");
    public static readonly Color Select = Color.ParseColor("#FF232734");

    public static int Dp(Context context, int value) =>
        (int)Math.Round(value * (context.Resources?.DisplayMetrics?.Density ?? 1f));

    public static TextView Label(Context context, string value, float sp, Color color)
    {
        var view = new TextView(context);
        view.Text = value;
        view.SetTextSize(ComplexUnitType.Sp, sp);
        view.SetTextColor(color);
        return view;
    }

    public static LinearLayout Card(Context context)
    {
        var card = new LinearLayout(context) { Orientation = Orientation.Vertical };
        card.SetBackgroundColor(Card);
        var pad = Dp(context, 12);
        card.SetPadding(pad, Dp(context, 10), pad, Dp(context, 10));
        var layout = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MatchParent, ViewGroup.LayoutParams.WrapContent);
        layout.BottomMargin = Dp(context, 8);
        card.LayoutParameters = layout;
        return card;
    }

    public static void Section(Context context, LinearLayout parent, string title)
    {
        var label = Label(context, title, 11, Muted);
        label.SetPadding(0, Dp(context, 12), 0, Dp(context, 6));
        parent.AddView(label);
    }
}
