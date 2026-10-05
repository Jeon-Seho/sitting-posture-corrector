using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows.Forms;

// 압축 해제 없이 이미 패키징된 앱을 시작한다. 경로는 현재 작업 폴더가 아닌 실행기 위치 기준이다.
internal static class Launcher
{
    private static string Quote(string value)
    {
        string escaped = Regex.Replace(value, "(\\\\*)\"", "$1$1\\\"");
        return "\"" + Regex.Replace(escaped, "(\\\\+)$", "$1$1") + "\"";
    }

    [STAThread]
    private static int Main(string[] args)
    {
        string executable = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "release", "win-unpacked", "PoseGood.exe");
        try
        {
            if (!File.Exists(executable)) throw new FileNotFoundException("release\\win-unpacked 폴더를 실행기와 함께 보관해 주세요.");
            Process.Start(new ProcessStartInfo(executable, String.Join(" ", args.Select(Quote))) {
                UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(executable)
            });
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "PoseGood 실행 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
