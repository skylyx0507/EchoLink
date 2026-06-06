using System.Media;
using System.Windows;

namespace VoiceChat;

public partial class ErrorDialog : Window
{
    public ErrorDialog(string message, Window? owner = null)
    {
        InitializeComponent();
        ErrorTextBox.Text = message;
        if (owner != null)
        {
            Owner = owner;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
        }
        Loaded += (_, _) => SystemSounds.Hand.Play();
    }

    private void CopyBtn_Click(object sender, RoutedEventArgs e)
    {
        Clipboard.SetText(ErrorTextBox.Text);
    }

    private void CloseBtn_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }
}
