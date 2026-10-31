using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Chipmunks.ApkBuilder
{
    internal static class Program
    {
        [STAThread]
        private static int Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
            try
            {
                return RunSingleInstance(FindRepositoryPath());
            }
            catch (Exception error)
            {
                MessageBox.Show("无法打开掌上仓库构建工具。\r\n\r\n" + BuildRunner.ProtectOutput(error.Message) +
                    "\r\n\r\n请确认工具仍位于完整项目根目录。", "掌上仓库构建工具",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static string FindRepositoryPath()
        {
            string executableDirectory = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
            DirectoryInfo candidate = new DirectoryInfo(executableDirectory);
            for (int level = 0; candidate != null && level < 2; level++, candidate = candidate.Parent)
            {
                if (File.Exists(Path.Combine(candidate.FullName, "scripts", "build-android-release.ps1")) &&
                    File.Exists(Path.Combine(candidate.FullName, "package.json")))
                    return candidate.FullName.TrimEnd(Path.DirectorySeparatorChar);
            }
            throw new DirectoryNotFoundException("找不到完整项目中的 scripts\\build-android-release.ps1。" +
                "请把构建工具放回项目根目录，不要单独复制 EXE 使用。");
        }

        private static int RunSingleInstance(string repositoryPath)
        {
            SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
            if (user == null) throw new InvalidOperationException("无法确认当前 Windows 用户，请使用正常登录的桌面账户运行。");
            string identity;
            using (SHA256 hash = SHA256.Create())
                identity = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(
                    repositoryPath.ToUpperInvariant() + "|" + user.Value))).Replace("-", String.Empty);
            string mutexName = @"Local\ChipmunksApkBuilderWindow_" + identity;
            string wakeName = @"Local\ChipmunksApkBuilderWake_" + identity;
            MutexSecurity mutexSecurity = new MutexSecurity();
            mutexSecurity.SetAccessRuleProtection(true, false);
            mutexSecurity.AddAccessRule(new MutexAccessRule(user, MutexRights.FullControl, AccessControlType.Allow));
            bool created;
            using (Mutex instance = new Mutex(false, mutexName, out created, mutexSecurity))
            {
                bool ownsMutex = false;
                try
                {
                    try { ownsMutex = instance.WaitOne(0); }
                    catch (AbandonedMutexException) { ownsMutex = true; }
                    if (!ownsMutex) return WakeExistingWindow(wakeName);

                    EventWaitHandleSecurity eventSecurity = new EventWaitHandleSecurity();
                    eventSecurity.SetAccessRuleProtection(true, false);
                    eventSecurity.AddAccessRule(new EventWaitHandleAccessRule(user,
                        EventWaitHandleRights.FullControl, AccessControlType.Allow));
                    using (EventWaitHandle wake = new EventWaitHandle(false, EventResetMode.AutoReset,
                        wakeName, out created, eventSecurity))
                    using (BuildRunner runner = new BuildRunner(new BuildRunnerOptions { RepositoryPath = repositoryPath }))
                    using (BuildWindow window = new BuildWindow(repositoryPath, runner))
                    {
                        window.ManageSigningRequested = delegate(IWin32Window owner) { SigningWindow.ShowFor(owner, repositoryPath); };
                        // A real handle lets an early second launch queue its restore safely before Run begins.
                        IntPtr windowHandle = window.Handle;
                        RegisteredWaitHandle registration = ThreadPool.RegisterWaitForSingleObject(wake,
                            delegate(object state, bool timedOut)
                            {
                                try
                                {
                                    if (!window.IsDisposed && window.IsHandleCreated)
                                        window.BeginInvoke((MethodInvoker)delegate
                                        {
                                            if (!window.IsDisposed) window.RestoreWindow();
                                        });
                                }
                                catch (ObjectDisposedException) { }
                                catch (InvalidOperationException) { }
                            }, null, Timeout.Infinite, false);
                        try { Application.Run(window); }
                        finally { registration.Unregister(null); }
                    }
                    return 0;
                }
                finally { if (ownsMutex) instance.ReleaseMutex(); }
            }
        }

        private static int WakeExistingWindow(string wakeName)
        {
            // The owner may have acquired its mutex just before creating the wake event.
            for (int attempt = 0; attempt < 50; attempt++)
            {
                try
                {
                    using (EventWaitHandle wake = EventWaitHandle.OpenExisting(wakeName, EventWaitHandleRights.Modify))
                        wake.Set();
                    return 0;
                }
                catch (WaitHandleCannotBeOpenedException) { Thread.Sleep(100); }
            }
            MessageBox.Show("构建工具正在启动或退出，请稍后重新打开。\r\n不会启动第二个构建窗口。",
                "掌上仓库 · APK 构建工具", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 2;
        }
    }
}
