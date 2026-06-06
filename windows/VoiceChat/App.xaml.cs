using System.Configuration;
using System.Data;
using System.Windows;

namespace VoiceChat;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // 全局异常捕获：输出到控制台
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            var ex = args.ExceptionObject as Exception;
            Console.WriteLine($"[UnhandledException] {ex?.GetType().Name}: {ex?.Message}");
            Console.WriteLine(ex?.StackTrace);
        };

        DispatcherUnhandledException += (_, args) =>
        {
            Console.WriteLine($"[DispatcherUnhandledException] {args.Exception.GetType().Name}: {args.Exception.Message}");
            Console.WriteLine(args.Exception.StackTrace);
            args.Handled = true;
        };

        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            Console.WriteLine($"[UnobservedTaskException] {args.Exception.GetType().Name}: {args.Exception.Message}");
            Console.WriteLine(args.Exception.StackTrace);
            args.SetObserved();
        };
    }
}

