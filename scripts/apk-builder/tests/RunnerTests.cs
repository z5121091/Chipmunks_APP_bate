using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Chipmunks.ApkBuilder;

// Compile with the system .NET Framework csc.exe and BuildRunner.cs. Fixtures only:
// no real APK build, package installation, private config, or network access.
internal static class RunnerTests
{
    private static string root;
    private static int passed;
    private static int failed;
    private static readonly List<string> results = new List<string>();

    private static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        root = Path.GetFullPath(args.Length > 0 ? args[0] : "output/apk-builder-gui-20261019/runner-tests");
        Directory.CreateDirectory(root);
        Run("large-dual-output-ui-not-polled-redaction-unicode-path", LargeOutput);
        Run("nonzero-exit-rejects-fake-success", NonzeroExit);
        Run("zero-exit-without-marker-fails", NoMarker);
        Run("success-with-missing-apk-fails", MissingApk);
        Run("success-with-empty-apk-fails", EmptyApk);
        Run("old-apk-cannot-impersonate-new-delivery", OldApk);
        Run("new-copy-with-old-modified-time-is-valid", NewCopyOldModifiedTime);
        Run("check-environment-success", CheckSuccess);
        Run("check-environment-requires-marker", CheckNoMarker);
        Run("hidden-prepare-success", HiddenPrepare);
        Run("sdk-license-needs-attention", NeedsAttention);
        Run("same-instance-prevents-duplicate", SameRunnerDuplicate);
        Run("separate-window-mutex-prevents-duplicate", SeparateRunnerDuplicate);
        Run("shared-cmd-script-lock-is-respected", SharedScriptLock);
        Run("cancel-kills-child-tree-preserves-unrelated-process", CancelTree);
        Run("immediate-cancel-does-not-run-script", ImmediateCancel);
        Run("dispose-cancels-and-returns-without-ui-block", DisposeCancel);
        Run("interactive-preparation-removes-gui-flag", InteractivePrepare);
        Run("windows-powershell-builtins-with-pwsh7-module-path", BuiltInModules);
        Run("write-host-lines-stay-text-no-clixml", HostOutput);
        Run("ansi-colour-cursor-output-is-clean-in-log-and-ui", AnsiOutput);
        Run("sync-target-build-check-prepare-and-artifact", SyncTarget);
        Run("sync-target-rejects-apk-protocol-and-nonzero", SyncProtocolFailure);
        Run("sync-fixed-name-replacement-allows-old-creation-time", SyncFixedName);
        Run("sync-task-receipt-is-required-and-reset-between-builds", SyncReceiptReset);
        Run("sync-stale-task-receipt-is-rejected", SyncStaleReceipt);
        Run("sync-missing-malformed-or-mismatched-hash-is-rejected", SyncHashFailure);
        Run("sync-cancel-and-dispose-wait-for-atomic-publication", SyncPublicationCancellation);
        Run("sync-abandoned-publication-mutex-does-not-block-cleanup", SyncAbandonedPublicationMutex);
        Run("cross-target-single-task-and-stage-denominator", CrossTargetTask);
        Run("signing-workspace-cleanup-is-owned-and-nonrecursive", SigningCleanup);
        Run("default-target-script-dispatch-and-log-separation", TargetDefaults);
        string summary = "{\"passed\":" + passed + ",\"failed\":" + failed + ",\"fixturesOnly\":true,\"tests\":[" + String.Join(",", results.ToArray()) + "]}";
        File.WriteAllText(Path.Combine(root, "results.json"), summary, new UTF8Encoding(true));
        Console.WriteLine("Runner tests: " + passed + " passed, " + failed + " failed.");
        return failed == 0 ? 0 : 1;
    }

    private static void Run(string name, Action test)
    {
        Stopwatch watch = Stopwatch.StartNew();
        try { test(); passed++; results.Add("{\"name\":\"" + name + "\",\"passed\":true,\"milliseconds\":" + watch.ElapsedMilliseconds + "}"); Console.WriteLine("PASS " + name); }
        catch (Exception error)
        {
            failed++;
            string message = error.ToString();
            results.Add("{\"name\":\"" + name + "\",\"passed\":false,\"error\":" + Json(message) + "}");
            Console.WriteLine("FAIL " + name + "\n" + message);
        }
    }

    private static string Json(string value) { return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\""; }
    private static void Assert(bool value, string message) { if (!value) throw new Exception(message); }

    private sealed class Fixture : IDisposable
    {
        public string DirectoryPath;
        public string Script;
        public string Apk;
        public string Sync;
        public BuildRunner Runner;
        public Fixture(string script)
        {
            DirectoryPath = Path.Combine(root, "测试 空格 ' " + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(DirectoryPath);
            Script = Path.Combine(DirectoryPath, "构建 fixture.ps1");
            Apk = Path.Combine(DirectoryPath, "掌上仓库 测试.apk");
            Sync = Path.Combine(DirectoryPath, "同步 测试.exe");
            SetScript(script);
            Runner = NewRunner();
        }
        public void SetScript(string script) { File.WriteAllText(Script, "param([switch]$CheckOnly,[switch]$PrepareOnly)\r\n$ErrorActionPreference='Stop'\r\n" + script.Replace("__APK__", Quote(Apk)).Replace("__SYNC__", Quote(Sync)).Replace("__DIR__", Quote(DirectoryPath)), new UTF8Encoding(true)); }
        public BuildRunner NewRunner() { return new BuildRunner(new BuildRunnerOptions { RepositoryPath = DirectoryPath, ScriptPath = Script, SyncScriptPath = Script, LogDirectory = Path.Combine(DirectoryPath, "日志 空格") }); }
        public void Dispose() { Runner.Dispose(); }
    }
    private static string Quote(string value) { return "'" + value.Replace("'", "''") + "'"; }
    private static BuildResult Finish(Task<BuildResult> task)
    {
        Assert(task.Wait(30000), "Fixture did not finish within 30 seconds.");
        return task.Result;
    }
    private static bool WaitUntil(Func<bool> predicate, int milliseconds)
    {
        Stopwatch watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < milliseconds) { if (predicate()) return true; Thread.Sleep(25); }
        return predicate();
    }
    private static readonly string SuccessScript = "[IO.File]::WriteAllBytes(__APK__,[byte[]](1,2,3,4)); [Console]::WriteLine('BUILD SUCCEEDED'); [Console]::WriteLine('APK: ' + __APK__); exit 0";

    private static void LargeOutput()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('[1/5] syncing'); for($i=0;$i -lt 12000;$i++){ [Console]::Out.WriteLine('OUT ' + $i); [Console]::Error.WriteLine('ERR ' + $i) }; [Console]::WriteLine('https://person:p%40ss@example.invalid/files'); [Console]::Error.WriteLine('http://u:secret@example.invalid/file'); [Console]::WriteLine('[5/5] complete'); " + SuccessScript))
        {
            BuildResult result = Finish(f.Runner.StartAsync(BuildMode.Build));
            Assert(result.State == BuildState.Succeeded, result.ErrorMessage);
            Assert(result.ApkPath == f.Apk, "Unicode/spaces/apostrophe APK path changed.");
            BuildSnapshot state = f.Runner.GetSnapshot();
            Assert(state.Stage == 5 && state.State == BuildState.Succeeded, "Stage/state not tracked.");
            Assert(state.OutputLineCount >= 24006 && state.DroppedDisplayLines > 20000, "Output queue was not bounded independently of UI.");
            string log = File.ReadAllText(result.LogPath, Encoding.UTF8);
            Assert(log.Contains("OUT 11999") && log.Contains("ERR 11999"), "One output stream was blocked/lost.");
            Assert(!log.Contains("person:") && !log.Contains("secret@") && log.Contains("https://***@example.invalid"), "Credential redaction failed.");
            Assert(!log.Contains("CLIXML"), "Text output unexpectedly serialized as CLIXML.");
            Assert(f.Runner.DrainLines(5000).Length == 2000 && f.Runner.DrainLines(1).Length == 0, "Display drain queue incorrect.");
            File.Copy(result.LogPath, Path.Combine(root, "large-dual-output.log"), true);
        }
    }
    private static void NonzeroExit()
    {
        using (Fixture f = new Fixture(SuccessScript.Replace("exit 0", "[Console]::Error.WriteLine('BUILD FAILED: fixture expected'); exit 7")))
        { BuildResult r = Finish(f.Runner.StartAsync(BuildMode.Build)); Assert(r.State == BuildState.Failed && r.ExitCode == 7 && r.ErrorMessage.Contains("fixture expected"), "Nonzero exit was accepted."); }
    }
    private static void NoMarker() { using (Fixture f = new Fixture("[IO.File]::WriteAllBytes(__APK__,[byte[]](1)); [Console]::WriteLine('APK: ' + __APK__); exit 0")) { Assert(Finish(f.Runner.StartAsync(BuildMode.Build)).State == BuildState.Failed, "No marker accepted."); } }
    private static void MissingApk() { using (Fixture f = new Fixture("[Console]::WriteLine('BUILD SUCCEEDED'); [Console]::WriteLine('APK: ' + __APK__); exit 0")) { Assert(Finish(f.Runner.StartAsync(BuildMode.Build)).State == BuildState.Failed, "Missing APK accepted."); } }
    private static void EmptyApk() { using (Fixture f = new Fixture("[IO.File]::WriteAllBytes(__APK__,[byte[]]@()); [Console]::WriteLine('BUILD SUCCEEDED'); [Console]::WriteLine('APK: ' + __APK__); exit 0")) { Assert(Finish(f.Runner.StartAsync(BuildMode.Build)).State == BuildState.Failed, "Empty APK accepted."); } }
    private static void OldApk()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('BUILD SUCCEEDED'); [Console]::WriteLine('APK: ' + __APK__); exit 0"))
        {
            File.WriteAllBytes(f.Apk, new byte[] { 1, 2, 3 });
            File.SetCreationTimeUtc(f.Apk, DateTime.UtcNow.AddDays(-1));
            BuildResult r = Finish(f.Runner.StartAsync(BuildMode.Build));
            Assert(r.State == BuildState.Failed && r.ErrorMessage.Contains("此前"), "Old artifact was accepted as new delivery.");
        }
    }
    private static void NewCopyOldModifiedTime()
    {
        using (Fixture f = new Fixture("Copy-Item -LiteralPath (Join-Path __DIR__ 'cached-source.apk') -Destination __APK__; [Console]::WriteLine('BUILD SUCCEEDED'); [Console]::WriteLine('APK: ' + __APK__); exit 0"))
        {
            string source = Path.Combine(f.DirectoryPath, "cached-source.apk");
            File.WriteAllBytes(source, new byte[] { 1, 2, 3 });
            File.SetCreationTimeUtc(source, DateTime.UtcNow.AddDays(-2));
            File.SetLastWriteTimeUtc(source, DateTime.UtcNow.AddDays(-1));
            BuildResult r = Finish(f.Runner.StartAsync(BuildMode.Build));
            Assert(r.State == BuildState.Succeeded, r.ErrorMessage);
            Assert(File.GetLastWriteTimeUtc(f.Apk) < DateTime.UtcNow.AddHours(-23), "Fixture failed to preserve cached modification time.");
        }
    }
    private static void CheckSuccess() { using (Fixture f = new Fixture("if(-not $CheckOnly){exit 12}; [Console]::WriteLine('CHECK PASSED: fixture'); exit 0")) { Assert(Finish(f.Runner.StartAsync(BuildMode.CheckEnvironment)).State == BuildState.Succeeded, "Check failed."); } }
    private static void CheckNoMarker() { using (Fixture f = new Fixture("exit 0")) { Assert(Finish(f.Runner.StartAsync(BuildMode.CheckEnvironment)).State == BuildState.Failed, "Check marker missing but accepted."); } }
    private static void HiddenPrepare() { using (Fixture f = new Fixture("if(-not $PrepareOnly){exit 12}; [Console]::WriteLine('APK ENVIRONMENT READY. No APK build started.'); exit 0")) { Assert(Finish(f.Runner.StartAsync(BuildMode.PrepareEnvironment)).State == BuildState.Succeeded, "Prepare failed."); } }
    private static void NeedsAttention() { using (Fixture f = new Fixture("[Console]::WriteLine('[GUI:ATTENTION:SDK_LICENSE]'); exit 2")) { BuildResult r = Finish(f.Runner.StartAsync(BuildMode.Build)); Assert(r.State == BuildState.NeedsAttention && r.AttentionCode == "SDK_LICENSE" && r.ExitCode == 2, "License attention not recognized."); } }
    private static void SameRunnerDuplicate()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('READY'); Start-Sleep -Seconds 60"))
        {
            Task<BuildResult> first = f.Runner.StartAsync(BuildMode.Build);
            bool rejected = false;
            try { f.Runner.StartAsync(BuildMode.Build); } catch (InvalidOperationException) { rejected = true; }
            f.Runner.Cancel(); Finish(first);
            Assert(rejected, "Duplicate start accepted.");
        }
    }
    private static void SeparateRunnerDuplicate()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('READY'); Start-Sleep -Seconds 60"))
        using (BuildRunner other = f.NewRunner())
        {
            Task<BuildResult> first = f.Runner.StartAsync(BuildMode.Build);
            try
            {
                Assert(WaitUntil(delegate { return f.Runner.GetSnapshot().OutputLineCount >= 2; }, 8000), "First runner not ready.");
                BuildResult r = Finish(other.StartAsync(BuildMode.Build));
                Assert(r.State == BuildState.Failed && r.ErrorMessage.Contains("已有"), "Second window was not rejected.");
            }
            finally { f.Runner.Cancel(); Finish(first); }
        }
    }
    private static void SharedScriptLock()
    {
        using (Fixture f = new Fixture("try{$l=[IO.File]::Open((Join-Path __DIR__ 'build.lock'),'OpenOrCreate','ReadWrite','None')}catch{[Console]::WriteLine('BUILD FAILED: Another APK build is running.');exit 11}; try{" + SuccessScript + "}finally{$l.Dispose()}"))
        {
            using (FileStream existingCmdLock = new FileStream(Path.Combine(f.DirectoryPath, "build.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
            { BuildResult r = Finish(f.Runner.StartAsync(BuildMode.Build)); Assert(r.State == BuildState.Failed && r.ExitCode == 11, "CMD shared file lock ignored."); }
            Assert(Finish(f.Runner.StartAsync(BuildMode.Build)).State == BuildState.Succeeded, "Lock not released for next task.");
        }
    }
    private static Process StartSentinel()
    {
        ProcessStartInfo info = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell/v1.0/powershell.exe"), "-NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 60\"");
        info.UseShellExecute = false; info.CreateNoWindow = true;
        return Process.Start(info);
    }
    private static void CancelTree()
    {
        using (Fixture f = new Fixture("$code=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Start-Sleep -Seconds 60')); $p=Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-EncodedCommand',$code) -PassThru; [IO.File]::WriteAllText((Join-Path __DIR__ 'child.pid'),[string]$p.Id); [Console]::WriteLine('CHILD: '+$p.Id); Start-Sleep -Seconds 60"))
        using (Process sentinel = StartSentinel())
        {
            Task<BuildResult> task = f.Runner.StartAsync(BuildMode.Build);
            try
            {
                string pidFile = Path.Combine(f.DirectoryPath, "child.pid");
                Assert(WaitUntil(delegate { return File.Exists(pidFile) && new FileInfo(pidFile).Length > 0; }, 8000), "Child did not start.");
                int childPid = Int32.Parse(File.ReadAllText(pidFile));
                using (Process child = Process.GetProcessById(childPid))
                {
                    f.Runner.Cancel();
                    BuildResult r = Finish(task);
                    Assert(r.State == BuildState.Cancelled, "Cancellation state incorrect.");
                    Assert(child.WaitForExit(5000), "Task child escaped cancellation.");
                    Assert(!sentinel.HasExited, "Unrelated process was terminated.");
                }
            }
            finally { f.Runner.Cancel(); Finish(task); if (!sentinel.HasExited) sentinel.Kill(); sentinel.WaitForExit(); }
        }
    }
    private static void ImmediateCancel()
    {
        using (Fixture f = new Fixture("[IO.File]::WriteAllText((Join-Path __DIR__ 'ran.txt'),'started'); Start-Sleep -Seconds 60"))
        {
            Task<BuildResult> task = f.Runner.StartAsync(BuildMode.Build);
            f.Runner.Cancel();
            Assert(Finish(task).State == BuildState.Cancelled, "Immediate cancellation not recognized.");
            Assert(!File.Exists(Path.Combine(f.DirectoryPath, "ran.txt")), "Cancelled task entered script.");
        }
    }
    private static void DisposeCancel()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('READY'); Start-Sleep -Seconds 60"))
        {
            Task<BuildResult> task = f.Runner.StartAsync(BuildMode.Build);
            Assert(WaitUntil(delegate { return f.Runner.GetSnapshot().OutputLineCount >= 2; }, 8000), "Runner not ready.");
            Stopwatch watch = Stopwatch.StartNew(); f.Runner.Dispose();
            Assert(watch.ElapsedMilliseconds < 1000, "Dispose blocked UI.");
            Assert(Finish(task).State == BuildState.Cancelled && !f.Runner.IsRunning, "Dispose did not release task.");
        }
    }
    private static void InteractivePrepare()
    {
        using (Fixture f = new Fixture("if(-not $PrepareOnly){exit 12}; [IO.File]::WriteAllText((Join-Path __DIR__ 'interactive.txt'),('gui='+$env:CHIPMUNKS_APK_GUI+';in='+[Console]::IsInputRedirected+';out='+[Console]::IsOutputRedirected)); exit 0"))
        {
            string before = Environment.GetEnvironmentVariable("CHIPMUNKS_APK_GUI");
            try
            {
                Environment.SetEnvironmentVariable("CHIPMUNKS_APK_GUI", "1");
                BuildResult r = Finish(f.Runner.StartInteractivePreparationAsync());
                Assert(r.State == BuildState.Succeeded && r.ExitCode == 0, r.ErrorMessage);
                string flags = File.ReadAllText(Path.Combine(f.DirectoryPath, "interactive.txt"));
                Assert(flags.StartsWith("gui=;"), "Interactive task inherited noninteractive GUI flag.");
                // This fixture executable may itself run with redirected handles; the real
                // WinForms host has no console, so Windows supplies the visible child console.
                Assert(File.ReadAllText(r.LogPath).Contains("退出码：0"), "Interactive lifecycle was not logged.");
            }
            finally { Environment.SetEnvironmentVariable("CHIPMUNKS_APK_GUI", before); }
        }
    }
    private static void BuiltInModules()
    {
        using (Fixture f = new Fixture("if($PSVersionTable.PSVersion.Major -ne 5){throw 'Expected system PowerShell 5'}; [IO.File]::WriteAllText((Join-Path __DIR__ 'hash.txt'),'abc',[Text.Encoding]::ASCII); $cmd=Get-Command Get-FileHash -ErrorAction Stop; $h=Get-FileHash -LiteralPath (Join-Path __DIR__ 'hash.txt') -Algorithm SHA256; if($h.Hash -ne 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD'){throw 'SHA256 mismatch'}; [Console]::WriteLine('HASH COMMAND: '+$cmd.Name); [Console]::WriteLine('CHECK PASSED: built-in modules'); exit 0"))
        {
            string inherited = Environment.GetEnvironmentVariable("PSModulePath");
            string poisonRoot = Path.Combine(f.DirectoryPath, "PowerShell7-only-modules");
            string poisonModule = Path.Combine(poisonRoot, "Microsoft.PowerShell.Utility");
            Directory.CreateDirectory(poisonModule);
            File.WriteAllText(Path.Combine(poisonModule, "Microsoft.PowerShell.Utility.psd1"), "@{ModuleVersion='7.0.0';PowerShellVersion='7.0';GUID='61a4e582-5324-4211-804e-3b1ad0ac4f61'}", new UTF8Encoding(true));
            try
            {
                Environment.SetEnvironmentVariable("PSModulePath", poisonRoot);
                BuildResult r = Finish(f.Runner.StartAsync(BuildMode.CheckEnvironment));
                Assert(r.State == BuildState.Succeeded, r.ErrorMessage);
                Assert(File.ReadAllText(r.LogPath).Contains("HASH COMMAND: Get-FileHash"), "Built-in command was not resolved.");
                Assert(Environment.GetEnvironmentVariable("PSModulePath") == poisonRoot, "Runner modified the parent environment.");
            }
            finally { Environment.SetEnvironmentVariable("PSModulePath", inherited); }
        }
    }
    private static void HostOutput()
    {
        using (Fixture f = new Fixture("Write-Host '[1/5] checking'; Write-Host 'HOST unique marker'; Write-Host ('BUILD SUCCEEDED' + [Environment]::NewLine + 'APK: ' + __APK__) -ForegroundColor Green; [IO.File]::WriteAllBytes(__APK__,[byte[]](1)); exit 0"))
        {
            BuildResult r = Finish(f.Runner.StartAsync(BuildMode.Build));
            Assert(r.State == BuildState.Succeeded, r.ErrorMessage);
            string log = File.ReadAllText(r.LogPath);
            Assert(!log.Contains("CLIXML") && !log.Contains("<Objs"), "Write-Host was serialized to XML.");
            Assert(log.Split(new[] { "HOST unique marker" }, StringSplitOptions.None).Length == 2, "Write-Host content was duplicated.");
        }
    }
    private static void AnsiOutput()
    {
        using (Fixture f = new Fixture("$esc=[char]27; $csi=[char]155; [Console]::WriteLine($esc+'[32m[3/5] 正在编译中文内容'+$esc+'[0m'); [Console]::WriteLine($esc+'[2K'+$esc+'[G'+'清理光标 / C:\\仓库\\标签 [正常括号]'); [Console]::Error.WriteLine($csi+'31m'+'错误流彩色文字'+$csi+'0m'); [IO.File]::WriteAllBytes(__APK__,[byte[]](1)); [Console]::WriteLine($esc+'[1;32mBUILD SUCCEEDED'+$esc+'[0m'); [Console]::WriteLine($esc+'[36mAPK: '+__APK__+$esc+'[0m'); exit 0"))
        {
            BuildResult r = Finish(f.Runner.StartAsync(BuildMode.Build));
            Assert(r.State == BuildState.Succeeded && r.ApkPath == f.Apk, r.ErrorMessage ?? "ANSI-wrapped marker/path not recognized.");
            Assert(f.Runner.GetSnapshot().Stage == 3, "ANSI-wrapped stage was not recognized.");
            string log = File.ReadAllText(r.LogPath);
            string ui = String.Join("\n", f.Runner.DrainLines(2000));
            foreach (string text in new[] { log, ui })
            {
                Assert(!text.Contains("\u001b") && !text.Contains("\u009b"), "ANSI control sequence leaked to output.");
                Assert(text.Contains("正在编译中文内容") && text.Contains("C:\\仓库\\标签 [正常括号]") && text.Contains("错误流彩色文字"), "Ordinary Unicode/path/text changed during normalization.");
            }
        }
    }

    private const string SyncReceiptScript = "[Console]::WriteLine('EXE: '+__SYNC__); [Console]::WriteLine('SHA256: '+(Get-FileHash -LiteralPath __SYNC__ -Algorithm SHA256).Hash.ToLowerInvariant()); [Console]::WriteLine('EXE-BUILD-ID: '+$env:CHIPMUNKS_BUILD_TASK_ID); [Console]::WriteLine('BUILD SUCCEEDED'); ";
    private const string SyncSuccessScript = "[IO.File]::WriteAllBytes(__SYNC__,[byte[]](1,2)); " + SyncReceiptScript + "exit 0";

    private static void SyncTarget()
    {
        using (Fixture f = new Fixture("if($CheckOnly){[Console]::WriteLine('CHECK PASSED: sync fixture');exit 0}; if($PrepareOnly){[Console]::WriteLine('SYNC ENVIRONMENT READY. No EXE build started.');exit 0}; if($env:CHIPMUNKS_BUILD_TASK_ID -ne $env:CHIPMUNKS_SIGNING_TASK_ID){throw 'Task IDs differ'}; [Console]::WriteLine('[1/4] check'); [Console]::WriteLine('[2/4] dependencies'); [Console]::WriteLine('[3/4] compile'); [Console]::WriteLine('[4/4] save'); [IO.File]::WriteAllText((Join-Path __DIR__ 'task-id.txt'),$env:CHIPMUNKS_BUILD_TASK_ID); " + SyncSuccessScript)) {
            BuildResult r = Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper));
            Assert(r.State == BuildState.Succeeded && r.Target == BuildTarget.SyncHelper && r.ArtifactPath.EndsWith(".exe") && r.ApkPath == null, r.ErrorMessage ?? "Sync artifact incorrect.");
            Assert(f.Runner.GetSnapshot().Stage == 4 && f.Runner.GetSnapshot().Target == BuildTarget.SyncHelper, "Sync snapshot stage/target lost.");
            string taskId = File.ReadAllText(Path.Combine(f.DirectoryPath, "task-id.txt"));
            Assert(System.Text.RegularExpressions.Regex.IsMatch(taskId, "^[a-f0-9]{32}$"), "Child signing ID missing.");
            Assert(Finish(f.Runner.StartAsync(BuildMode.CheckEnvironment, BuildTarget.SyncHelper)).State == BuildState.Succeeded, "Sync check failed.");
            Assert(Finish(f.Runner.StartAsync(BuildMode.PrepareEnvironment, BuildTarget.SyncHelper)).State == BuildState.Succeeded, "Sync prepare failed.");
            Assert(Finish(f.Runner.StartInteractivePreparationAsync(BuildTarget.SyncHelper)).State == BuildState.Succeeded, "Sync visible prepare failed.");
        }
    }

    private static void SyncProtocolFailure()
    {
        using (Fixture f = new Fixture("[IO.File]::WriteAllBytes(__APK__,[byte[]](1)); [Console]::WriteLine('APK: '+__APK__); [Console]::WriteLine('BUILD SUCCEEDED'); exit 0")) {
            BuildResult r = Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper));
            Assert(r.State == BuildState.Failed && r.ArtifactPath == null, "APK path accepted for EXE target.");
        }
        using (Fixture f = new Fixture("[Console]::WriteLine('BUILD FAILED: sync fixture failure'); exit 7")) {
            BuildResult r = Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper));
            Assert(r.State == BuildState.Failed && r.ErrorMessage.Contains("sync fixture failure"), "Sync failure not propagated.");
        }
    }

    private static void SyncFixedName()
    {
        using (Fixture f = new Fixture(SyncSuccessScript)) {
            File.WriteAllBytes(f.Sync, new byte[] { 9, 9 });
            DateTime originalCreation = DateTime.UtcNow.AddDays(-3);
            File.SetCreationTimeUtc(f.Sync, originalCreation);
            BuildResult first = Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper));
            Assert(first.State == BuildState.Succeeded && first.ArtifactPath == f.Sync, first.ErrorMessage ?? "Fixed-name delivery failed.");
            Assert(File.GetCreationTimeUtc(f.Sync) < DateTime.UtcNow.AddDays(-2), "Fixture did not preserve the destination's old creation time.");
            f.SetScript(SyncSuccessScript.Replace("(1,2)", "(3,4,5)"));
            BuildResult second = Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper));
            Assert(second.State == BuildState.Succeeded && second.ArtifactPath == first.ArtifactPath, second.ErrorMessage ?? "Repeated fixed-name delivery failed.");
            Assert(new FileInfo(f.Sync).Length == 3 && Directory.GetFiles(f.DirectoryPath, "*.exe").Length == 1, "Repeated delivery exposed duplicate EXEs or old bytes.");
        }
    }

    private static void SyncReceiptReset()
    {
        using (Fixture f = new Fixture(SyncSuccessScript)) {
            Assert(Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper)).State == BuildState.Succeeded, "Receipt-reset setup failed.");
            f.SetScript("[Console]::WriteLine('EXE: '+__SYNC__); [Console]::WriteLine('BUILD SUCCEEDED'); exit 0");
            BuildResult missing = Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper));
            Assert(missing.State == BuildState.Failed && missing.ArtifactPath == null && missing.ErrorMessage.Contains("任务标识"), "The previous task's receipt was reused.");
            f.SetScript("[Console]::WriteLine('EXE-BUILD-ID: '+$env:CHIPMUNKS_BUILD_TASK_ID); [Console]::WriteLine('EXE: '+__SYNC__); [Console]::WriteLine('BUILD SUCCEEDED'); exit 0");
            BuildResult missingHash = Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper));
            Assert(missingHash.State == BuildState.Failed && missingHash.ErrorMessage.Contains("SHA256"), "The previous task's hash was reused.");
        }
    }

    private static void SyncStaleReceipt()
    {
        using (Fixture f = new Fixture("[IO.File]::WriteAllText((Join-Path __DIR__ 'receipt-id.txt'),$env:CHIPMUNKS_BUILD_TASK_ID); " + SyncSuccessScript)) {
            Assert(Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper)).State == BuildState.Succeeded, "Stale-receipt setup failed.");
            f.SetScript(SyncReceiptScript.Replace("$env:CHIPMUNKS_BUILD_TASK_ID", "([IO.File]::ReadAllText((Join-Path __DIR__ 'receipt-id.txt')))" ) + "exit 0");
            BuildResult stale = Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper));
            Assert(stale.State == BuildState.Failed && stale.ArtifactPath == null && stale.ErrorMessage.Contains("任务标识"), "An earlier build receipt impersonated the current task.");
        }
    }

    private static void SyncHashFailure()
    {
        string[] invalidHashes = { "", new string('0', 64), "aabbcc", new string('A', 64) };
        foreach (string invalidHash in invalidHashes)
        using (Fixture f = new Fixture("[IO.File]::WriteAllBytes(__SYNC__,[byte[]](1,2)); " + SyncReceiptScript.Replace("(Get-FileHash -LiteralPath __SYNC__ -Algorithm SHA256).Hash.ToLowerInvariant()", Quote(invalidHash)) + "exit 0")) {
            BuildResult result = Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper));
            Assert(result.State == BuildState.Failed && result.ArtifactPath == null && result.ErrorMessage.Contains("SHA256"), "A missing, malformed, or incorrect digest was accepted.");
        }
    }

    private static void SyncPublicationCancellation()
    {
        string script = "$guard=[Threading.Mutex]::new($false,('Local\\ChipmunksSyncPublish_'+$env:CHIPMUNKS_BUILD_TASK_ID)); $owned=$false; " +
            "try { $owned=$guard.WaitOne(); [IO.File]::WriteAllText((Join-Path __DIR__ 'delivery-sidecar.txt'),'new'); " +
            "[IO.File]::WriteAllText((Join-Path __DIR__ 'publish-entered.txt'),'entered'); [Console]::WriteLine('PUBLISH ENTERED'); " +
            "[Threading.Thread]::Sleep(1000); [IO.File]::WriteAllBytes(__SYNC__,[byte[]](1,2)); " +
            "[IO.File]::WriteAllText((Join-Path __DIR__ 'publish-complete.txt'),'complete'); " + SyncReceiptScript +
            "} finally { if($owned){$guard.ReleaseMutex()}; $guard.Dispose() }; exit 0";
        foreach (bool dispose in new[] { false, true })
        using (Fixture f = new Fixture(script))
        {
            File.WriteAllBytes(f.Sync, new byte[] { 9 });
            string sidecar = Path.Combine(f.DirectoryPath, "delivery-sidecar.txt");
            File.WriteAllText(sidecar, "old");
            Task<BuildResult> task = f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper);
            Assert(WaitUntil(delegate { return File.Exists(Path.Combine(f.DirectoryPath, "publish-entered.txt")); }, 10000), "Publication fixture did not enter its commit section.");
            Assert(File.ReadAllText(sidecar) == "new" && new FileInfo(f.Sync).Length == 1, "Fixture did not exercise the interval between sidecar and EXE publication.");
            Stopwatch watch = Stopwatch.StartNew();
            if (dispose) f.Runner.Dispose(); else f.Runner.Cancel();
            Assert(watch.ElapsedMilliseconds < 500, "Cancellation or disposal blocked the UI during publication.");
            Assert(f.Runner.IsRunning && f.Runner.GetSnapshot().StageText.Contains("交付"), "Cancellation killed the task instead of deferring through publication.");
            BuildResult result = Finish(task);
            Assert(result.State == BuildState.Cancelled && result.ArtifactPath == null, "Deferred cancellation was not reported as cancelled.");
            Assert(File.Exists(Path.Combine(f.DirectoryPath, "publish-complete.txt")) &&
                File.ReadAllText(sidecar) == "new" && new FileInfo(f.Sync).Length == 2,
                "Cancellation left sidecar and EXE publication inconsistent.");
        }
    }

    private static void SyncAbandonedPublicationMutex()
    {
        using (Fixture f = new Fixture("$guard=[Threading.Mutex]::new($false,('Local\\ChipmunksSyncPublish_'+$env:CHIPMUNKS_BUILD_TASK_ID)); " +
            "$null=$guard.WaitOne(); " + SyncSuccessScript))
        {
            // The fixture intentionally exits without releasing the mutex. The
            // runner still owns a handle and must treat abandonment as acquired.
            BuildResult result = Finish(f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper));
            Assert(result.State == BuildState.Succeeded && result.ArtifactPath == f.Sync,
                result.ErrorMessage ?? "Abandoned publication guard prevented cleanup.");
        }
    }

    private static void CrossTargetTask()
    {
        using (Fixture f = new Fixture("[Console]::WriteLine('[5/5] wrong target'); [Console]::WriteLine('[3/4] right target'); [Console]::WriteLine('READY'); Start-Sleep -Seconds 60")) {
            Task<BuildResult> task = f.Runner.StartAsync(BuildMode.Build, BuildTarget.SyncHelper);
            Assert(WaitUntil(delegate { return f.Runner.GetSnapshot().Stage == 3; }, 8000), "Sync stage not read.");
            bool refused = false;
            try { f.Runner.StartAsync(BuildMode.Build, BuildTarget.Apk); } catch (InvalidOperationException) { refused = true; }
            Assert(refused && f.Runner.GetSnapshot().Target == BuildTarget.SyncHelper, "Switching target replaced a running task.");
            f.Runner.Cancel();
            Assert(Finish(task).State == BuildState.Cancelled, "Sync cancel not recognized.");
        }
    }

    private static void SigningCleanup()
    {
        string rootPath = Path.Combine(root, "signing-cleanup-" + Guid.NewGuid().ToString("N"));
        string id = Guid.NewGuid().ToString("N");
        string work = Path.Combine(rootPath, "work-" + id);
        Directory.CreateDirectory(work);
        File.WriteAllText(Path.Combine(work, "release.p12"), "fixture");
        Assert(BuildRunner.CleanupSigningWorkspace(id, rootPath) != null && File.Exists(Path.Combine(work, "release.p12")), "Unowned temporary file deleted.");
        File.WriteAllText(Path.Combine(work, "owned.marker"), "chipmunks-signing-work-v1");
        File.WriteAllText(Path.Combine(work, "unrelated.txt"), "keep");
        Assert(BuildRunner.CleanupSigningWorkspace(id, rootPath) != null && File.Exists(Path.Combine(work, "unrelated.txt")) && !File.Exists(Path.Combine(work, "release.p12")), "Cleanup recursed or failed to remove owned P12.");
        Assert(BuildRunner.CleanupSigningWorkspace("../bad", rootPath) != null, "Invalid workspace ID accepted.");
        string cleanId = Guid.NewGuid().ToString("N");
        string clean = Path.Combine(rootPath, "work-" + cleanId);
        Directory.CreateDirectory(clean);
        File.WriteAllText(Path.Combine(clean, "owned.marker"), "chipmunks-signing-work-v1");
        File.WriteAllText(Path.Combine(clean, "release.p12"), "fixture");
        Assert(BuildRunner.CleanupSigningWorkspace(cleanId, rootPath) == null && !Directory.Exists(clean), "Owned workspace was not removed.");
    }

    private static void TargetDefaults()
    {
        string repo = Path.Combine(root, "dual-defaults-" + Guid.NewGuid().ToString("N"));
        string scripts = Path.Combine(repo, "scripts"); Directory.CreateDirectory(scripts);
        File.WriteAllText(Path.Combine(scripts, "build-android-release.ps1"), "param([switch]$CheckOnly,[switch]$PrepareOnly)\r\n[Console]::WriteLine('APK SCRIPT ONLY'); [Console]::WriteLine('CHECK PASSED: apk fixture'); exit 0", new UTF8Encoding(true));
        File.WriteAllText(Path.Combine(scripts, "build.ps1"), "param([switch]$CheckOnly,[switch]$PrepareOnly)\r\n[Console]::WriteLine('SYNC SCRIPT ONLY'); [Console]::WriteLine('CHECK PASSED: sync fixture'); exit 0", new UTF8Encoding(true));
        using (BuildRunner runner = new BuildRunner(new BuildRunnerOptions { RepositoryPath = repo })) {
            BuildResult apk = Finish(runner.StartAsync(BuildMode.CheckEnvironment, BuildTarget.Apk));
            BuildResult exe = Finish(runner.StartAsync(BuildMode.CheckEnvironment, BuildTarget.SyncHelper));
            Assert(apk.State == BuildState.Succeeded && exe.State == BuildState.Succeeded, "Default script dispatch failed.");
            string apkLog = File.ReadAllText(apk.LogPath), exeLog = File.ReadAllText(exe.LogPath);
            Assert(apk.LogPath.Contains("android-build") && exe.LogPath.Contains("sync-build"), "Target log directories were not separated.");
            Assert(apkLog.Contains("APK SCRIPT ONLY") && !apkLog.Contains("SYNC SCRIPT ONLY") && exeLog.Contains("SYNC SCRIPT ONLY") && !exeLog.Contains("APK SCRIPT ONLY"), "A target invoked the wrong script.");
        }
    }
}
