using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Chipmunks.ApkBuilder;

// Isolated component tests: never Show a window, alter the system clipboard,
// read private settings, download tools, or call the actual APK build script.
internal static class WindowTests
{
    private static string root;
    private static string selectedTest;
    private static int passed;
    private static int failed;
    private static readonly List<object> results = new List<object>();
    private static readonly Color Good = Color.FromArgb(32, 133, 108);
    private static readonly TestUiContext UiContext = new TestUiContext();

    private sealed class TestUiContext : SynchronizationContext
    {
        private readonly Queue<Action> pending = new Queue<Action>();
        public override void Post(SendOrPostCallback callback, object state)
        {
            lock (pending) pending.Enqueue(delegate { callback(state); });
        }
        public void Drain()
        {
            while (true)
            {
                Action callback;
                lock (pending) { if (pending.Count == 0) return; callback = pending.Dequeue(); }
                callback();
            }
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        root = Path.GetFullPath(args.Length > 0 ? args[0] : "output/apk-builder-gui-20261019/ui-tests");
        selectedTest = args.Length > 1 ? args[1] : null;
        Directory.CreateDirectory(root);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Control.CheckForIllegalCrossThreadCalls = true;
        using (Control messageOwner = new Control())
        {
            IntPtr handle = messageOwner.Handle;
            SynchronizationContext.SetSynchronizationContext(UiContext);
            Run("idle-buttons-and-branded-layout", Idle);
            Run("running-stage-and-success-artifact", Success);
            Run("failed-next-task-clears-previous-artifact", FailureAfterSuccess);
            Run("sdk-attention-exposes-prepare-and-no-artifact", Attention);
            Run("selected-log-copy-does-not-block-worker", SelectedLog);
            Run("background-completes-with-no-ui-polling", Background);
            Run("stop-then-restart-same-window", CancelAndRestart);
            Run("busy-window-refuses-duplicate-start", DuplicateStart);
            Run("environment-check-only-paints-environment", CheckEnvironment);
            Run("completed-task-in-open-close-dialog-can-exit", CompletedCloseDecision);
            Run("program-second-launch-signals-same-user-fake-repository", SingleInstanceWake);
            Run("minimum-window-layout-has-no-clipped-buttons", MinimumLayout);
            Run("scaled-150-percent-layout-has-no-clipped-buttons", ScaledLayout);
            Run("target-switch-clears-result-and-builds-exe", SyncTarget);
            Run("running-task-locks-target-and-signing-manager", TargetLock);
            Run("signing-manager-callback-and-no-cmd-control", SigningEntry);
            if (selectedTest == null) RealProjectIdlePreview();
        }
        File.WriteAllText(Path.Combine(root, selectedTest == null ? "results.json" : "results.selected.json"), new JavaScriptSerializer().Serialize(new {
            passed = passed, failed = failed, fixturesOnly = true, visibleWindowShown = false,
            systemClipboardChanged = false, notes = new[] {
                "Uses a real hidden WinForms object and real redirected BuildRunner with isolated fake scripts.",
                "DrawToBitmap screenshots are control renders, not screenshots of the user's desktop.",
                "150 percent coverage uses Control.Scale; cross-monitor OS DPI switching is not claimed."
            }, tests = results
        }), new UTF8Encoding(true));
        Console.WriteLine("Window tests: " + passed + " passed, " + failed + " failed.");
        return failed == 0 ? 0 : 1;
    }

    private static void Run(string name, Action test)
    {
        if (selectedTest != null && name != selectedTest) return;
        Stopwatch watch = Stopwatch.StartNew();
        try { test(); passed++; results.Add(new { name = name, passed = true, milliseconds = watch.ElapsedMilliseconds }); Console.WriteLine("PASS " + name); }
        catch (Exception error) { failed++; results.Add(new { name = name, passed = false, error = error.ToString() }); Console.WriteLine("FAIL " + name + "\n" + error); }
        PumpEvents();
    }

    private static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    private static string Quote(string value) { return "'" + value.Replace("'", "''") + "'"; }
    private const string SuccessScript = "[IO.File]::WriteAllBytes(__APK__, [byte[]](1,2,3,4)); [Console]::WriteLine('BUILD SUCCEEDED'); [Console]::WriteLine('APK: ' + __APK__); exit 0";

    private sealed class Fixture : IDisposable
    {
        public readonly string DirectoryPath;
        public readonly string Script;
        public readonly string Apk;
        public readonly BuildRunner Runner;
        public readonly BuildWindow Window;

        public Fixture(string script)
        {
            DirectoryPath = Path.Combine(root, "隔离 UI 空格 ' " + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(DirectoryPath);
            Directory.CreateDirectory(Path.Combine(DirectoryPath, "client"));
            File.WriteAllText(Path.Combine(DirectoryPath, "client", "version.json"),
                "{\"appName\":\"掌上仓库（界面测试）\",\"version\":\"V1.0\"}", new UTF8Encoding(true));
            Script = Path.Combine(DirectoryPath, "fixture.ps1");
            Apk = Path.Combine(DirectoryPath, "测试安装包.apk");
            SetScript(script);
            Runner = new BuildRunner(new BuildRunnerOptions {
                RepositoryPath = DirectoryPath, ScriptPath = Script, SyncScriptPath = Script, LogDirectory = Path.Combine(DirectoryPath, "logs")
            });
            Window = new BuildWindow(DirectoryPath, Runner, false);
            EnsureHandles(Window);
            Window.PerformLayout();
            SynchronizationContext.SetSynchronizationContext(UiContext);
        }

        public void Start(BuildMode mode)
        {
            SynchronizationContext.SetSynchronizationContext(UiContext);
            Window.StartForTest(mode);
        }

        public void SetScript(string script)
        {
            File.WriteAllText(Script, "param([switch]$CheckOnly,[switch]$PrepareOnly)\r\n$ErrorActionPreference='Stop'\r\n" +
                script.Replace("__APK__", Quote(Apk)).Replace("__DIR__", Quote(DirectoryPath)), new UTF8Encoding(true));
        }

        public void Dispose()
        {
            Runner.Cancel();
            Stopwatch watch = Stopwatch.StartNew();
            while ((Runner.IsRunning || Window.TaskRunning) && watch.ElapsedMilliseconds < 10000)
            {
                PumpEvents();
                Thread.Sleep(20);
            }
            Window.Dispose();
            Runner.Dispose();
        }
    }

    private static void EnsureHandles(Control control)
    {
        IntPtr handle = control.Handle;
        foreach (Control child in control.Controls) EnsureHandles(child);
    }

    private static void PumpUntil(Func<bool> predicate, int timeout, string reason)
    {
        Stopwatch watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < timeout)
        {
            PumpEvents();
            if (predicate()) return;
            Thread.Sleep(15);
        }
        Assert(predicate(), reason);
    }

    private static void Finish(Fixture fixture)
    {
        PumpUntil(delegate { return !fixture.Window.TaskRunning && fixture.Window.RunningTask.IsCompleted; }, 30000, "Window continuation did not complete.");
        Assert(fixture.Window.RunningTask.IsCompleted, "Window task was left pending after completion.");
        fixture.Window.TickForTest();
    }

    private static void PumpEvents()
    {
        // Unshown forms do not have Application.Run's lifetime-managed context.
        // Keep continuations on this STA thread while pumping only test-owned controls.
        UiContext.Drain();
        Application.DoEvents();
        UiContext.Drain();
        SynchronizationContext.SetSynchronizationContext(UiContext);
    }

    private static T Find<T>(BuildWindow window, string name) where T : Control
    {
        T control = window.Controls.Find(name, true).OfType<T>().FirstOrDefault();
        Assert(control != null, "Missing control " + name);
        return control;
    }

    private static IEnumerable<Control> Descendants(Control control)
    {
        foreach (Control child in control.Controls)
        {
            yield return child;
            foreach (Control nested in Descendants(child)) yield return nested;
        }
    }

    private static Label[] Stages(BuildWindow window)
    {
        return Descendants(window).OfType<Label>().Where(delegate(Label label) {
            return label.Text.Length > 3 && label.Text[0] >= '1' && label.Text[0] <= '6' && label.Text.Substring(1, 2) == "  ";
        }).OrderBy(delegate(Label label) { return label.Text[0]; }).ToArray();
    }

    private static void Screenshot(BuildWindow window, string name)
    {
        window.PerformLayout();
        EnsureHandles(window);
        using (Bitmap bitmap = new Bitmap(window.Width, window.Height))
        {
            window.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
            bitmap.Save(Path.Combine(root, name + ".png"), ImageFormat.Png);
        }
    }

    private static void Idle()
    {
        using (Fixture f = new Fixture("exit 0"))
        {
            Assert(f.Window.StatusTitle == "准备就绪", "Idle title incorrect.");
            Assert(Find<Button>(f.Window, "startBuild").Enabled && Find<Button>(f.Window, "checkEnvironment").Enabled &&
                Find<Button>(f.Window, "prepareEnvironment").Enabled && Find<Button>(f.Window, "manageSigning").Enabled,
                "Idle entry buttons were disabled.");
            Assert(!Find<Button>(f.Window, "cancelBuild").Enabled && !Find<Button>(f.Window, "openApk").Enabled &&
                !Find<Button>(f.Window, "copyError").Enabled, "Idle result buttons were active.");
            Assert(Stages(f.Window).Length == 6, "Missing stage labels.");
            Assert(!f.Window.Visible, "The component test unexpectedly showed a window.");
            Screenshot(f.Window, "idle");
        }
    }

    private static void Success()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('[1/5] 同步源码'); [Console]::WriteLine('[2/5] 安装依赖'); [Console]::WriteLine('[3/5] 编译测试'); while(-not [IO.File]::Exists((Join-Path __DIR__ 'continue.fixture'))){[Threading.Thread]::Sleep(20)}; [Console]::WriteLine('[4/5] 校验测试'); [Console]::WriteLine('[5/5] 保存测试'); " + SuccessScript))
        {
            f.Start(BuildMode.Build);
            Assert(!Find<Button>(f.Window, "startBuild").Enabled && Find<Button>(f.Window, "cancelBuild").Enabled,
                "Busy commands not updated immediately.");
            HashSet<string> observedStages = new HashSet<string>();
            PumpUntil(delegate {
                f.Window.TickForTest();
                BuildSnapshot observed = f.Runner.GetSnapshot();
                string description = observed.Stage + "|" + observed.State + "|" + observed.StageText + "|" + f.Window.StatusTitle + "|" + f.Window.StatusDetail;
                if (observedStages.Add(description)) File.AppendAllText(Path.Combine(root, "running-stage-observations.txt"), description + Environment.NewLine, Encoding.UTF8);
                return observed.Stage == 3 && f.Window.StatusDetail.Contains("编译");
            }, 10000, "No stage 3 output. See running-stage-observations.txt.");
            Assert(f.Window.StatusDetail.Contains("编译") && f.Window.StatusDetail.Contains("ARM64"), "Current stage detail was not shown in the friendly UI wording.");
            Screenshot(f.Window, "running");
            File.WriteAllText(Path.Combine(f.DirectoryPath, "continue.fixture"), "continue");
            Finish(f);
            Assert(f.Window.StatusTitle == "构建成功" && f.Window.DisplayedApk == f.Apk, "Success result did not expose the actual fixture APK.");
            Assert(Find<Button>(f.Window, "openApk").Enabled && Find<Button>(f.Window, "openLog").Enabled &&
                !Find<Button>(f.Window, "cancelBuild").Enabled && Find<Button>(f.Window, "startBuild").Enabled,
                "Success button state incorrect.");
            Assert(Stages(f.Window).All(delegate(Label label) { return label.ForeColor == Good; }), "A successful full build left incomplete stages.");
            Screenshot(f.Window, "success");
        }
    }

    private static void FailureAfterSuccess()
    {
        using (Fixture f = new Fixture(SuccessScript))
        {
            f.Start(BuildMode.Build);
            Finish(f);
            Assert(f.Window.DisplayedApk != null, "Prerequisite success failed.");
            f.SetScript("[Console]::WriteLine('BUILD FAILED: fixture 编译错误'); exit 7");
            f.Start(BuildMode.Build);
            Assert(f.Window.DisplayedApk == null && !Find<Button>(f.Window, "openApk").Enabled, "Previous APK remained active during a new task.");
            Finish(f);
            Assert(f.Window.StatusTitle == "任务未完成" && f.Window.StatusDetail.Contains("fixture 编译错误"), "Failure explanation was lost.");
            Assert(f.Window.DisplayedApk == null && !Find<Button>(f.Window, "openApk").Enabled &&
                Find<Button>(f.Window, "copyError").Enabled, "A failed task exposed a stale APK or disabled its error action.");
            Screenshot(f.Window, "failed");
        }
    }

    private static void Attention()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('[GUI:ATTENTION:SDK_LICENSE]'); exit 2"))
        {
            f.Start(BuildMode.Build);
            Finish(f);
            Assert(f.Window.StatusTitle == "需要先准备环境" && f.Window.StatusDetail.Contains("准备环境"), "SDK action was not visible.");
            Assert(Find<Button>(f.Window, "prepareEnvironment").Enabled && Find<Button>(f.Window, "copyError").Enabled &&
                !Find<Button>(f.Window, "openApk").Enabled && f.Window.DisplayedApk == null, "SDK attention button state incorrect.");
            Screenshot(f.Window, "needsattention");
        }
    }

    private static void SelectedLog()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('[3/5] 连续日志'); for($i=0;$i -lt 500;$i++){ [Console]::WriteLine('日志行 '+$i); [Threading.Thread]::Sleep(3) }; " + SuccessScript))
        {
            f.Start(BuildMode.Build);
            PumpUntil(delegate { f.Window.TickForTest(); return f.Window.DisplayedLog.Contains("日志行 20"); }, 10000, "No initial logs.");
            RichTextBox log = Find<RichTextBox>(f.Window, "buildLog");
            int start = log.Text.IndexOf("日志行 1", StringComparison.Ordinal);
            log.Select(start, 5);
            string selectedCopy = log.SelectedText;
            Finish(f);
            Assert(log.SelectedText == selectedCopy && log.SelectionStart == start, "Incoming output disturbed selected log text.");
            Assert(f.Window.StatusTitle == "构建成功" && f.Window.DisplayedLog.Contains("日志行 499"), "Selecting/reading a log copy blocked background output.");
        }
    }

    private static void Background()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('[3/5] 后台测试'); [Threading.Thread]::Sleep(400); for($i=0;$i -lt 3500;$i++){[Console]::WriteLine('BG '+$i)}; " + SuccessScript))
        {
            f.Start(BuildMode.Build);
            f.Window.ContinueInBackground();
            Assert(f.Window.IsInBackground && !f.Window.Visible, "Continue-in-background did not hide the window.");
            Stopwatch watch = Stopwatch.StartNew();
            // No DoEvents, UI timer, or TickForTest while the real worker produces all output.
            while (f.Runner.IsRunning && watch.ElapsedMilliseconds < 15000) Thread.Sleep(25);
            Assert(!f.Runner.IsRunning && f.Runner.GetSnapshot().State == BuildState.Succeeded,
                "Background worker depended on UI polling.");
            Assert(f.Runner.GetSnapshot().DroppedDisplayLines > 0, "Fixture did not exercise its bounded display queue.");
            Finish(f);
            Assert(f.Window.StatusTitle == "构建成功" && f.Window.IsInBackground, "Completion did not preserve hidden background state.");
        }
    }

    private static void CancelAndRestart()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('[3/5] 等待停止'); [Threading.Thread]::Sleep(60000); " + SuccessScript))
        {
            f.Start(BuildMode.Build);
            PumpUntil(delegate { return f.Runner.GetSnapshot().Stage == 3; }, 10000, "Cancellation fixture never started.");
            Stopwatch watch = Stopwatch.StartNew();
            f.Window.StopTask();
            Assert(watch.ElapsedMilliseconds < 1000, "Stop blocked the UI thread.");
            Finish(f);
            Assert(f.Window.StatusTitle == "任务已停止" && !Find<Button>(f.Window, "openApk").Enabled &&
                Find<Button>(f.Window, "startBuild").Enabled, "Cancellation did not restore commands.");
            f.SetScript(SuccessScript);
            f.Start(BuildMode.Build);
            Finish(f);
            Assert(f.Window.StatusTitle == "构建成功", "The same window could not start again after cancellation.");
        }
    }

    private static void DuplicateStart()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('[3/5] single'); [Threading.Thread]::Sleep(350); " + SuccessScript))
        {
            f.Start(BuildMode.Build);
            f.Start(BuildMode.CheckEnvironment);
            Finish(f);
            Assert(f.Runner.GetSnapshot().Mode == BuildMode.Build && f.Window.StatusTitle == "构建成功", "Duplicate UI start replaced the running task.");
        }
    }

    private static void CheckEnvironment()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('CHECK PASSED: fixture only'); exit 0"))
        {
            f.Start(BuildMode.CheckEnvironment);
            Finish(f);
            Assert(f.Window.StatusTitle == "环境检查通过" && !Find<Button>(f.Window, "openApk").Enabled && f.Window.DisplayedApk == null,
                "Environment-only operation exposed a build artifact.");
            Label[] stages = Stages(f.Window);
            Assert(stages.Count(delegate(Label label) { return label.ForeColor == Good; }) == 1 && stages[0].ForeColor == Good,
                "Environment check incorrectly marked compilation/delivery stages complete.");
            Screenshot(f.Window, "environment-checked");
        }
    }

    private static void CompletedCloseDecision()
    {
        using (Fixture f = new Fixture(SuccessScript))
        {
            f.Start(BuildMode.Build);
            Finish(f);
            Assert(f.Window.ApplyCloseDecision(DialogResult.Yes), "A background choice made after completion kept the close request blocked.");
            Assert(f.Window.ApplyCloseDecision(DialogResult.No), "A stop-and-exit choice made after completion kept the close request blocked.");
            Assert(!f.Window.ApplyCloseDecision(DialogResult.Cancel), "Cancel unexpectedly allowed the window to close.");
        }
    }

    private static void SingleInstanceWake()
    {
        using (Fixture f = new Fixture("exit 0"))
        using (ManualResetEvent ready = new ManualResetEvent(false))
        {
            string identity;
            using (SHA256 hash = SHA256.Create())
                identity = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(
                    f.DirectoryPath.ToUpperInvariant() + "|" + WindowsIdentity.GetCurrent().User.Value))).Replace("-", String.Empty);
            string mutexName = @"Local\ChipmunksApkBuilderWindow_" + identity;
            string wakeName = @"Local\ChipmunksApkBuilderWake_" + identity;
            bool signaled = false;
            Exception ownerError = null;
            Thread owner = new Thread(delegate()
            {
                try
                {
                    using (Mutex mutex = new Mutex(false, mutexName))
                    {
                        Assert(mutex.WaitOne(0), "Fake repository window mutex was not unique.");
                        try
                        {
                            using (EventWaitHandle wake = new EventWaitHandle(false, EventResetMode.AutoReset, wakeName))
                            {
                                ready.Set();
                                signaled = wake.WaitOne(5000);
                            }
                        }
                        finally { mutex.ReleaseMutex(); }
                    }
                }
                catch (Exception error) { ownerError = error; ready.Set(); }
            });
            owner.IsBackground = true;
            owner.Start();
            Assert(ready.WaitOne(5000), "Fake owner did not prepare its IPC handles.");
            if (ownerError != null) throw ownerError;
            MethodInfo run = typeof(Chipmunks.ApkBuilder.Program).GetMethod("RunSingleInstance", BindingFlags.Static | BindingFlags.NonPublic);
            Assert(run != null, "Program instance coordinator is missing.");
            int exit = (int)run.Invoke(null, new object[] { f.DirectoryPath });
            Assert(owner.Join(6000), "Fake owner did not finish receiving its wake event.");
            if (ownerError != null) throw ownerError;
            Assert(exit == 0 && signaled, "The second launch did not signal the existing window.");
        }
    }

    private static void VerifyLayout(BuildWindow window)
    {
        window.PerformLayout();
        foreach (Button button in Descendants(window).OfType<Button>())
        {
            Rectangle bounds = button.Parent.ClientRectangle;
            Assert(button.Left >= -1 && button.Top >= -1 && button.Right <= bounds.Right + 1 && button.Bottom <= bounds.Bottom + 1,
                "Button clipped: " + button.Name + " " + button.Bounds + " parent=" + bounds);
            Size text = TextRenderer.MeasureText(button.Text, button.Font, Size.Empty, TextFormatFlags.NoPadding);
            Assert(text.Width + 8 <= button.ClientSize.Width && text.Height <= button.ClientSize.Height,
                "Button text clipped: " + button.Name + " text=" + text + " client=" + button.ClientSize);
            foreach (Button other in button.Parent.Controls.OfType<Button>())
                if (other != button) Assert(!button.Bounds.IntersectsWith(other.Bounds), "Buttons overlap: " + button.Name + "/" + other.Name);
        }
        RichTextBox log = Find<RichTextBox>(window, "buildLog");
        Assert(log.Width > 100 && log.Height > 50, "Log area became unusable.");
        foreach (Control sibling in log.Parent.Controls)
            if (sibling != log) Assert(!log.Bounds.IntersectsWith(sibling.Bounds), "Log header overlays the log area.");
    }

    private static void MinimumLayout()
    {
        using (Fixture f = new Fixture("exit 0"))
        {
            f.Window.Size = f.Window.MinimumSize;
            VerifyLayout(f.Window);
            Screenshot(f.Window, "minimum-size");
        }
    }

    private static void ScaledLayout()
    {
        using (Fixture f = new Fixture("exit 0"))
        {
            f.Window.AutoScaleMode = AutoScaleMode.None;
            f.Window.Scale(new SizeF(1.5F, 1.5F));
            VerifyLayout(f.Window);
            Screenshot(f.Window, "scaled-150-percent");
        }
    }

    private static void RealProjectIdlePreview()
    {
        const string repository = @"D:\Chipmunks_APP";
        using (BuildRunner runner = new BuildRunner(new BuildRunnerOptions { RepositoryPath = repository }))
        using (BuildWindow window = new BuildWindow(repository, runner, false))
        {
            EnsureHandles(window);
            Screenshot(window, "real-project-idle");
            window.SelectTargetForTest(BuildTarget.SyncHelper);
            Screenshot(window, "real-project-sync-idle");
            Assert(!runner.IsRunning && !window.Visible, "Idle preview started a task or showed a desktop window.");
            Console.WriteLine("PREVIEW real-project-idle.png (idle render only; no build started)");
        }
    }

    private static void SyncTarget()
    {
        using (Fixture f = new Fixture(SuccessScript)) {
            f.Start(BuildMode.Build); Finish(f);
            Assert(f.Window.DisplayedArtifact != null, "APK setup failed.");
            Assert(f.Window.SelectTargetForTest(BuildTarget.SyncHelper), "Could not select sync target.");
            Assert(f.Window.DisplayedArtifact == null && !Find<Button>(f.Window, "openApk").Enabled && !Find<Button>(f.Window, "openLog").Enabled && f.Window.DisplayedLog == "", "Target switch kept stale APK/log result.");
            Assert(Find<Button>(f.Window, "openApk").Text.Contains("EXE"), "Artifact command still refers to APK.");
            f.SetScript("[Console]::WriteLine('[1/4] dependencies'); while(-not [IO.File]::Exists((Join-Path __DIR__ 'stage1.continue'))){[Threading.Thread]::Sleep(20)}; [Console]::WriteLine('[2/4] check sources'); while(-not [IO.File]::Exists((Join-Path __DIR__ 'stage2.continue'))){[Threading.Thread]::Sleep(20)}; [Console]::WriteLine('[3/4] compile'); [IO.File]::WriteAllBytes((Join-Path __DIR__ 'sync.exe'),[byte[]](1)); [Console]::WriteLine('[4/4] save'); [Console]::WriteLine('BUILD SUCCEEDED'); [Console]::WriteLine('EXE: '+(Join-Path __DIR__ 'sync.exe')); [Console]::WriteLine('EXE-BUILD-ID: '+$env:CHIPMUNKS_BUILD_TASK_ID); [Console]::WriteLine('SHA256: '+(Get-FileHash -LiteralPath (Join-Path __DIR__ 'sync.exe') -Algorithm SHA256).Hash.ToLowerInvariant()); exit 0");
            f.Start(BuildMode.Build);
            PumpUntil(delegate { f.Window.TickForTest(); return f.Runner.GetSnapshot().Stage == 1 && f.Window.StatusDetail.Contains("Python"); }, 10000, "Sync stage 1 did not describe Python dependencies.");
            Assert(Stages(f.Window)[1].Text.Contains("准备依赖"), "Sync stage 1 label differs from actual script order.");
            File.WriteAllText(Path.Combine(f.DirectoryPath, "stage1.continue"), "continue");
            PumpUntil(delegate { f.Window.TickForTest(); return f.Runner.GetSnapshot().Stage == 2 && f.Window.StatusDetail.Contains("源码"); }, 10000, "Sync stage 2 did not describe source/resource checks.");
            Assert(Stages(f.Window)[2].Text.Contains("检查源码"), "Sync stage 2 label differs from actual script order.");
            File.WriteAllText(Path.Combine(f.DirectoryPath, "stage2.continue"), "continue");
            Finish(f);
            Assert(f.Window.StatusTitle == "构建成功" && f.Window.StatusDetail.Contains("同步助手 EXE") && f.Window.DisplayedArtifact.EndsWith("sync.exe"), "Sync success UI/artifact incorrect.");
            Assert(Stages(f.Window).Take(5).All(delegate(Label label) { return label.ForeColor == Good; }), "Sync stage progression incomplete.");
            VerifyLayout(f.Window);
            Screenshot(f.Window, "sync-success");
            f.Window.SelectTargetForTest(BuildTarget.Apk);
            Assert(f.Window.DisplayedArtifact == null && Find<Button>(f.Window, "openApk").Text.Contains("APK"), "Returning to APK retained EXE result.");
        }
    }

    private static void TargetLock()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('[3/4] compiling'); Start-Sleep -Seconds 60")) {
            f.Window.SelectTargetForTest(BuildTarget.SyncHelper);
            f.Start(BuildMode.Build);
            Assert(!Find<ComboBox>(f.Window, "buildTarget").Enabled && !Find<Button>(f.Window, "manageSigning").Enabled, "Target/signing still interactive while running.");
            Assert(!f.Window.SelectTargetForTest(BuildTarget.Apk) && f.Window.SelectedTarget == BuildTarget.SyncHelper, "Running target was changed.");
            f.Window.StopTask(); Finish(f);
            Assert(Find<ComboBox>(f.Window, "buildTarget").Enabled && Find<Button>(f.Window, "manageSigning").Enabled, "Target/signing stayed disabled after stop.");
        }
    }

    private static void SigningEntry()
    {
        using (Fixture f = new Fixture("exit 0")) {
            Assert(!Descendants(f.Window).Any(delegate(Control c) { return c.Name == "openBackupCmd" || c.Text.Contains("CMD") || c.Text.Contains(".bat"); }), "A removed CMD entry remains.");
            int calls = 0;
            f.Window.ManageSigningRequested += delegate(IWin32Window owner) { Assert(owner == f.Window, "Signing dialog owner mismatch."); calls++; };
            // Invoke the test-owned button handler without showing a desktop form.
            typeof(Button).GetMethod("OnClick", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(Find<Button>(f.Window, "manageSigning"), new object[] { EventArgs.Empty });
            Assert(calls == 1, "Signing event was not raised.");
        }
    }
}
