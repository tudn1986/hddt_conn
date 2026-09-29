using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        string baseDir = Application.StartupPath;
        string scriptPath = Path.Combine(baseDir, "Start-HDDT.vbs");
        if (!File.Exists(scriptPath))
        {
            MessageBox.Show(
                "Không tìm thấy Start-HDDT.vbs trong thư mục phát hành.",
                "hddt_conn",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "wscript.exe",
                Arguments = "\"" + scriptPath + "\"",
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Không thể khởi động hddt_conn.\r\n\r\n" + ex.Message,
                "hddt_conn",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}
