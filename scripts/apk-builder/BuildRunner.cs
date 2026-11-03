using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace Chipmunks.ApkBuilder
{
    public enum BuildMode { Build, CheckEnvironment, PrepareEnvironment, PublishUpdate }
    public enum BuildTarget { Apk, SyncHelper }
    public enum BuildState { Idle, Running, Succeeded, Failed, Cancelled, NeedsAttention }

    public sealed class BuildRunnerOptions
    {
        public string RepositoryPath { get; set; }
        public string ScriptPath { get; set; }
        public string SyncScriptPath { get; set; }
        public string LogDirectory { get; set; }
        public string PowerShellPath { get; set; }
    }

    public sealed class BuildSnapshot
    {
        public BuildState State { get; internal set; }
        public BuildMode Mode { get; internal set; }
        public BuildTarget Target { get; internal set; }
        public int Stage { get; internal set; }
        public string StageText { get; internal set; }
        public DateTime StartedAtUtc { get; internal set; }
        public DateTime LastOutputAtUtc { get; internal set; }
        public string LogPath { get; internal set; }
        public long OutputLineCount { get; internal set; }
        public long DroppedDisplayLines { get; internal set; }
    }

    public sealed class BuildResult
    {
        public BuildState State { get; internal set; }
        public int ExitCode { get; internal set; }
        public string ErrorMessage { get; internal set; }
        public string ApkPath { get; internal set; }
        public string ArtifactPath { get; internal set; }
        public BuildTarget Target { get; internal set; }
        public string LogPath { get; internal set; }
        public string AttentionCode { get; internal set; }
    }

    /// <summary>
    /// Owns one build task and its process tree. The UI only polls copies: it cannot
    /// block process output by selecting text, hiding its window, or not polling.
    /// Dispose means cancel; minimizing/hiding the form must keep this object alive.
    /// </summary>
    public sealed class BuildRunner : IDisposable
    {
        private const int DisplayLineLimit = 2000;
        private readonly object sync = new object();
        private readonly string repositoryPath;
        private readonly string scriptPath;
        private readonly string syncScriptPath;
        private readonly string logDirectory;
        private readonly string powerShellPath;
        private readonly string mutexName;
        private readonly Queue<string> displayLines = new Queue<string>();
        private static readonly Regex AnsiCsi = new Regex(@"(?:\x1B\[|\u009B)[0-?]*[ -/]*[@-~]", RegexOptions.Compiled);
        private static readonly Regex Credentials = new Regex(@"(?i)(https?://)[^/\s@]+@", RegexOptions.Compiled);
        private static readonly Regex Stage = new Regex(@"^\[([1-5])/([45])\]\s*(.*)$", RegexOptions.Compiled);
        private BuildSnapshot snapshot = new BuildSnapshot { State = BuildState.Idle, StageText = "尚未开始" };
        private bool running;
        private bool disposed;
        private bool cancellationRequested;
        private bool sawPublish;
        private string publishNotesFile;
        private bool sawSuccess;
        private bool sawCheckSuccess;
        private bool sawPrepareSuccess;
        private string apkPath;
        private string exeBuildId;
        private string exeSha256;
        private string attentionCode;
        private string failureLine;
        private string logFailure;
        private StreamWriter logWriter;
        private JobObject currentJob;
        private Mutex currentPublicationMutex;

        public BuildRunner(BuildRunnerOptions options)
        {
            if (options == null) throw new ArgumentNullException("options");
            if (String.IsNullOrWhiteSpace(options.RepositoryPath)) throw new ArgumentException("RepositoryPath is required.");
            repositoryPath = Path.GetFullPath(options.RepositoryPath).TrimEnd(Path.DirectorySeparatorChar);
            scriptPath = Path.GetFullPath(options.ScriptPath ?? Path.Combine(repositoryPath, "scripts", "build-android-release.ps1"));
            syncScriptPath = Path.GetFullPath(options.SyncScriptPath ?? Path.Combine(repositoryPath, "scripts", "build.ps1"));
            logDirectory = options.LogDirectory == null ? null : Path.GetFullPath(options.LogDirectory);
            powerShellPath = options.PowerShellPath ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            using (SHA256 hash = SHA256.Create())
            {
                byte[] digest = hash.ComputeHash(Encoding.UTF8.GetBytes(repositoryPath.ToUpperInvariant()));
                mutexName = @"Local\ChipmunksApkBuilder_" + BitConverter.ToString(digest).Replace("-", "");
            }
        }

        public bool IsRunning { get { lock (sync) { return running; } } }

        public BuildSnapshot GetSnapshot()
        {
            lock (sync)
            {
                return new BuildSnapshot {
                    State = snapshot.State, Mode = snapshot.Mode, Target = snapshot.Target, Stage = snapshot.Stage,
                    StageText = snapshot.StageText, StartedAtUtc = snapshot.StartedAtUtc,
                    LastOutputAtUtc = snapshot.LastOutputAtUtc, LogPath = snapshot.LogPath,
                    OutputLineCount = snapshot.OutputLineCount, DroppedDisplayLines = snapshot.DroppedDisplayLines
                };
            }
        }

        public string[] DrainLines(int maximum)
        {
            if (maximum < 1) throw new ArgumentOutOfRangeException("maximum");
            lock (sync)
            {
                List<string> result = new List<string>(Math.Min(maximum, displayLines.Count));
                while (result.Count < maximum && displayLines.Count > 0) result.Add(displayLines.Dequeue());
                return result.ToArray();
            }
        }

        public Task<BuildResult> StartAsync(BuildMode mode)
        {
            return StartAsync(mode, BuildTarget.Apk);
        }

        public Task<BuildResult> StartPublishAsync(string notesFile)
        {
            lock (sync) {
                if (running) throw new InvalidOperationException("当前任务尚未结束。");
                publishNotesFile = Path.GetFullPath(notesFile);
                return StartInternal(BuildMode.PublishUpdate, BuildTarget.Apk, false);
            }
        }

        public Task<BuildResult> StartAsync(BuildMode mode, BuildTarget target)
        {
            return StartInternal(mode, target, false);
        }

        public Task<BuildResult> StartInteractivePreparationAsync()
        {
            return StartInteractivePreparationAsync(BuildTarget.Apk);
        }

        public Task<BuildResult> StartInteractivePreparationAsync(BuildTarget target)
        {
            return StartInternal(BuildMode.PrepareEnvironment, target, true);
        }

        private Task<BuildResult> StartInternal(BuildMode mode, BuildTarget target, bool interactive)
        {
            if (!Enum.IsDefined(typeof(BuildMode), mode)) throw new ArgumentOutOfRangeException("mode");
            if (!Enum.IsDefined(typeof(BuildTarget), target)) throw new ArgumentOutOfRangeException("target");
            if (mode == BuildMode.PublishUpdate && (target != BuildTarget.Apk || String.IsNullOrEmpty(publishNotesFile) || !File.Exists(publishNotesFile)))
                throw new InvalidOperationException("热更新只能从 APK 目标使用有效更新说明发布。");
            lock (sync)
            {
                if (disposed) throw new ObjectDisposedException("BuildRunner");
                if (running) throw new InvalidOperationException("当前构建任务尚未结束。请等待完成或停止后再试。");
                running = true;
                cancellationRequested = sawPublish = sawSuccess = sawCheckSuccess = sawPrepareSuccess = false;
                apkPath = exeBuildId = exeSha256 = attentionCode = failureLine = logFailure = null;
                displayLines.Clear();
                snapshot = new BuildSnapshot { State = BuildState.Running, Mode = mode, Target = target, Stage = 0,
                    StageText = "准备构建环境", StartedAtUtc = DateTime.UtcNow, LastOutputAtUtc = DateTime.UtcNow };
                // A dedicated worker owns the named mutex from acquisition through release.
                return Task.Factory.StartNew(delegate { return Run(mode, target, interactive); }, CancellationToken.None,
                    TaskCreationOptions.LongRunning, TaskScheduler.Default);
            }
        }

        public void Cancel()
        {
            lock (sync)
            {
                if (!running) return;
                cancellationRequested = true;
                snapshot.StageText = "正在停止本次任务…";
            }
            TryTerminateCurrentTask();
        }

        private bool TryTerminateCurrentTask()
        {
            lock (sync)
            {
                if (currentJob == null) return true;
                bool ownsPublicationMutex = false;
                try
                {
                    if (currentPublicationMutex != null)
                    {
                        // Never wait on the UI thread. The build worker retries after
                        // the script finishes the short metadata/EXE commit section.
                        try { ownsPublicationMutex = currentPublicationMutex.WaitOne(0); }
                        catch (AbandonedMutexException) { ownsPublicationMutex = true; }
                        if (!ownsPublicationMutex)
                        {
                            snapshot.StageText = cancellationRequested
                                ? "正在完成同步助手文件交付，完成后停止…"
                                : "正在完成同步助手文件交付，请稍候…";
                            return false;
                        }
                    }
                    currentJob.Terminate();
                    return true;
                }
                finally
                {
                    if (ownsPublicationMutex) currentPublicationMutex.ReleaseMutex();
                }
            }
        }

        public void Dispose()
        {
            lock (sync) { if (disposed) return; disposed = true; }
            Cancel(); // The worker drains output and releases its own handles; never block the UI here.
        }

        public static string ProtectOutput(string line)
        {
            // RichTextBox does not interpret terminal colour/cursor CSI sequences.
            // Normalize the same text before log persistence and UI queue insertion.
            return Credentials.Replace(AnsiCsi.Replace(line ?? String.Empty, String.Empty), "$1***@");
        }

        private BuildResult Run(BuildMode mode, BuildTarget target, bool interactive)
        {
            BuildResult result = new BuildResult { State = BuildState.Failed, ExitCode = -1, Target = target };
            string selectedScript = mode == BuildMode.PublishUpdate ? Path.Combine(repositoryPath, "scripts", "publish-ota.ps1") : target == BuildTarget.Apk ? scriptPath : syncScriptPath;
            string selectedLogDirectory = logDirectory ?? Path.Combine(repositoryPath, "logs", mode == BuildMode.PublishUpdate ? "ota-publish" : target == BuildTarget.Apk ? "android-build" : "sync-build", "gui");
            string signingTaskId = Guid.NewGuid().ToString("N");
            Process process = null;
            JobObject job = null;
            EventWaitHandle gate = null;
            Mutex taskMutex = null;
            Mutex publicationMutex = null;
            bool ownsMutex = false;
            ManualResetEvent stdoutEnded = new ManualResetEvent(false);
            ManualResetEvent stderrEnded = new ManualResetEvent(false);
            try
            {
                Directory.CreateDirectory(selectedLogDirectory);
                string logPath = Path.Combine(selectedLogDirectory, DateTime.Now.ToString("yyyyMMdd_HHmmss_fff", CultureInfo.InvariantCulture) + "_" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".log");
                lock (sync)
                {
                    logWriter = new StreamWriter(new FileStream(logPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read), new UTF8Encoding(true));
                    logWriter.AutoFlush = true;
                    snapshot.LogPath = result.LogPath = logPath;
                }
                taskMutex = new Mutex(false, mutexName);
                try { ownsMutex = taskMutex.WaitOne(0); }
                catch (AbandonedMutexException) { ownsMutex = true; }
                if (!ownsMutex) throw new InvalidOperationException("此项目已有图形构建任务运行。请回到已有窗口查看进度。");
                if (!File.Exists(selectedScript)) throw new FileNotFoundException("找不到所选目标的构建脚本。请将构建工具放回完整项目后再试。", selectedScript);
                if (Cancelled()) { result.State = BuildState.Cancelled; return result; }
                WriteLine("目标：" + target + "；任务：" + mode + "；启动时间：" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture));
                if (interactive) WriteLine(target == BuildTarget.Apk ? "已打开可见环境准备窗口；请在该窗口阅读并确认 SDK 许可证。详细步骤显示在该窗口，本日志记录任务开始和结果。" : "已打开可见环境准备窗口；请查看并处理同步助手构建环境提示。");
                string gateName = @"Local\ChipmunksApkGate_" + Guid.NewGuid().ToString("N");
                gate = new EventWaitHandle(false, EventResetMode.ManualReset, gateName);
                string modeSwitch = mode == BuildMode.CheckEnvironment ? " -CheckOnly" : mode == BuildMode.PrepareEnvironment ? " -PrepareOnly" : String.Empty;
                if (mode == BuildMode.PublishUpdate) modeSwitch = " -NotesFile '" + publishNotesFile.Replace("'", "''") + "'";
                string command = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; " +
                    "$g=[System.Threading.EventWaitHandle]::OpenExisting('" + gateName + "'); if(-not $g.WaitOne(30000)){exit 91}; $g.Dispose(); " +
                    "& '" + selectedScript.Replace("'", "''") + "'" + modeSwitch + "; if($null -eq $LASTEXITCODE){exit 0}else{exit $LASTEXITCODE}";
                ProcessStartInfo info = new ProcessStartInfo(powerShellPath,
                    "-NoLogo -NoProfile " + (interactive ? String.Empty : "-NonInteractive ") + "-ExecutionPolicy Bypass -OutputFormat Text -Command " + QuoteProcessArgument(command));
                info.WorkingDirectory = repositoryPath;
                info.UseShellExecute = false;
                info.CreateNoWindow = !interactive;
                info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = !interactive;
                // A GUI launched from PowerShell 7 can inherit its incompatible module
                // directory ahead of Windows PowerShell 5's built-ins (Get-FileHash is
                // then unavailable). Isolate only this child's module search path.
                info.EnvironmentVariables["PSModulePath"] = String.Join(Path.PathSeparator.ToString(), new[] {
                    Path.Combine(Path.GetDirectoryName(powerShellPath), "Modules"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WindowsPowerShell", "Modules"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "WindowsPowerShell", "Modules")
                });
                info.EnvironmentVariables.Remove("PSModuleAnalysisCachePath");
                info.EnvironmentVariables["CHIPMUNKS_SIGNING_TASK_ID"] = signingTaskId;
                info.EnvironmentVariables["CHIPMUNKS_BUILD_TASK_ID"] = signingTaskId;
                if (!interactive)
                {
                    info.StandardOutputEncoding = info.StandardErrorEncoding = Encoding.UTF8;
                    info.EnvironmentVariables["CHIPMUNKS_APK_GUI"] = "1";
                    info.EnvironmentVariables["CHIPMUNKS_BUILD_GUI"] = "1";
                    info.EnvironmentVariables["CI"] = "1";
                    info.EnvironmentVariables["COREPACK_ENABLE_DOWNLOAD_PROMPT"] = "0";
                }
                else
                {
                    info.EnvironmentVariables.Remove("CHIPMUNKS_APK_GUI");
                    info.EnvironmentVariables.Remove("CHIPMUNKS_BUILD_GUI");
                }
                if (target == BuildTarget.SyncHelper && mode == BuildMode.Build)
                    publicationMutex = new Mutex(false, @"Local\ChipmunksSyncPublish_" + signingTaskId);
                job = new JobObject();
                lock (sync) { currentJob = job; currentPublicationMutex = publicationMutex; }
                if (Cancelled()) { result.State = BuildState.Cancelled; return result; }
                process = new Process { StartInfo = info };
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data == null) SignalEnded(stdoutEnded); else WriteLine(e.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data == null) SignalEnded(stderrEnded); else WriteLine(e.Data); };
                if (!process.Start()) throw new InvalidOperationException("无法启动构建进程。");
                // The PowerShell wrapper is held at the gate and cannot spawn script children yet.
                try { job.Assign(process); }
                catch { try { process.Kill(); } catch { } throw; }
                if (!interactive)
                {
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    process.StandardInput.Close();
                }
                if (Cancelled()) TryTerminateCurrentTask(); else gate.Set();
                while (!process.WaitForExit(200))
                {
                    if (Cancelled() || HasLogFailure()) TryTerminateCurrentTask();
                }
                result.ExitCode = process.ExitCode;
                // End only descendants of this task, including any daemon holding a pipe open.
                while (!TryTerminateCurrentTask()) Thread.Sleep(25);
                if (!interactive && (!stdoutEnded.WaitOne(10000) || !stderrEnded.WaitOne(10000)))
                    throw new IOException("构建进程已退出，但日志管道未正常关闭。请检查完整日志。");
                if (interactive)
                {
                    WriteLine("环境准备窗口已退出，退出码：" + result.ExitCode);
                    if (Cancelled()) result.State = BuildState.Cancelled;
                    else if (HasLogFailure()) result.ErrorMessage = "无法保存任务日志，请检查日志目录。";
                    else if (result.ExitCode == 0) result.State = BuildState.Succeeded;
                    else result.ErrorMessage = "环境准备未完成（退出码 " + result.ExitCode + "）。请重新打开准备环境窗口查看提示。";
                }
                else result = Evaluate(mode, result, signingTaskId);
            }
            catch (Exception error)
            {
                result.State = Cancelled() ? BuildState.Cancelled : BuildState.Failed;
                result.ErrorMessage = ProtectOutput(error.Message);
                WriteLine("构建工具：" + result.ErrorMessage);
            }
            finally
            {
                bool ownedProcessesExited = true;
                if (job != null)
                {
                    // Closing a kill-on-close job is also a termination. Keep its
                    // handle alive until publication has released the same guard.
                    while (!TryTerminateCurrentTask()) Thread.Sleep(25);
                    ownedProcessesExited = job.WaitUntilEmpty(5000);
                    lock (sync) { currentJob = null; currentPublicationMutex = null; }
                    job.Dispose();
                }
                if (publicationMutex != null) publicationMutex.Dispose();
                if (process != null) process.Dispose();
                string cleanupWarning = ownedProcessesExited
                    ? CleanupSigningWorkspace(signingTaskId, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChipmunksBuildTools", "signing"))
                    : "本任务进程尚未完全退出，临时签名文件暂未清理。请查看任务日志。";
                if (cleanupWarning != null) WriteLine("[清理提示] " + cleanupWarning);
                if (gate != null) gate.Dispose();
                stdoutEnded.Dispose(); stderrEnded.Dispose();
                if (ownsMutex && taskMutex != null) taskMutex.ReleaseMutex();
                if (taskMutex != null) taskMutex.Dispose();
                lock (sync)
                {
                    currentJob = null;
                    if (result.State == BuildState.Cancelled) result.ErrorMessage = "本次任务已停止。未终止其他构建或 Java 进程。";
                    if (logWriter != null)
                    {
                        try { logWriter.Dispose(); }
                        catch (Exception error) { if (result.State != BuildState.Cancelled) { result.State = BuildState.Failed; result.ErrorMessage = "无法保存任务日志：" + ProtectOutput(error.Message); } }
                        logWriter = null;
                    }
                    snapshot.State = result.State;
                    snapshot.StageText = result.State == BuildState.Succeeded ? "任务完成" : result.State == BuildState.Cancelled ? "已停止" : result.State == BuildState.NeedsAttention ? "需要手动处理" : "任务失败";
                    running = false;
                }
            }
            return result;
        }

        internal static string CleanupSigningWorkspace(string taskId, string signingRoot)
        {
            if (!Regex.IsMatch(taskId ?? "", @"\A[a-f0-9]{32}\z")) return "临时签名目录标识无效，未执行清理。";
            string directory = Path.Combine(signingRoot, "work-" + taskId);
            try {
                if (!Directory.Exists(directory)) return null;
                foreach (string path in new[] { signingRoot, directory })
                    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) return "临时签名目录包含重解析点，未执行清理。";
                string marker = Path.Combine(directory, "owned.marker");
                if (!File.Exists(marker) || (File.GetAttributes(marker) & FileAttributes.ReparsePoint) != 0 || File.ReadAllText(marker) != "chipmunks-signing-work-v1")
                    return "临时签名目录没有本任务所有权标记，未执行清理。";
                string certificate = Path.Combine(directory, "release.p12");
                if (File.Exists(certificate)) {
                    if ((File.GetAttributes(certificate) & FileAttributes.ReparsePoint) != 0) return "临时签名文件包含重解析点，未执行清理。";
                    File.Delete(certificate);
                }
                File.Delete(marker);
                Directory.Delete(directory, false);
                return null;
            } catch (Exception error) { return "本任务临时签名文件未能完全清理：" + ProtectOutput(error.Message); }
        }

        private BuildResult Evaluate(BuildMode mode, BuildResult result, string expectedBuildId)
        {
            lock (sync)
            {
                if (cancellationRequested) { result.State = BuildState.Cancelled; return result; }
                if (!String.IsNullOrEmpty(logFailure)) { result.ErrorMessage = "无法继续保存构建日志：" + logFailure; return result; }
                if (!String.IsNullOrEmpty(attentionCode))
                {
                    result.State = BuildState.NeedsAttention;
                    result.AttentionCode = attentionCode;
                    result.ErrorMessage = "需要手动确认 Android SDK 许可证。请使用“准备环境”打开可见窗口，阅读并确认后重新构建。";
                    return result;
                }
                if (result.ExitCode != 0) { result.ErrorMessage = failureLine ?? ("任务失败，退出码 " + result.ExitCode + "。请查看完整日志。"); return result; }
                if (mode == BuildMode.PublishUpdate) {
                    result.State = sawPublish ? BuildState.Succeeded : BuildState.Failed;
                    result.ErrorMessage = sawPublish ? null : "未收到服务器确认发布成功，请查看日志。";
                    return result;
                }
                if (mode == BuildMode.Build)
                {
                    if (!sawSuccess) { result.ErrorMessage = "进程已退出，但没有构建成功标记。请查看日志，当前不认定为成功。"; return result; }
                    if (String.IsNullOrWhiteSpace(apkPath) || !Path.IsPathRooted(apkPath) || !File.Exists(apkPath)) { result.ErrorMessage = "收到构建成功标记，但找不到本次产物文件。请查看日志。"; return result; }
                    FileInfo artifact = new FileInfo(apkPath);
                    if (artifact.Length == 0) { result.ErrorMessage = "本次产物文件为空，当前不认定为成功。"; return result; }
                    if (snapshot.Target == BuildTarget.SyncHelper)
                    {
                        // File.Replace can preserve the fixed destination's CreationTime.
                        // Bind this delivery to the current task and verify its actual bytes.
                        if (!String.Equals(exeBuildId, expectedBuildId, StringComparison.Ordinal)) { result.ErrorMessage = "同步助手交付缺少本次任务标识，或标识不匹配。请查看日志后重新构建。"; return result; }
                        if (!Regex.IsMatch(exeSha256 ?? String.Empty, @"\A[a-f0-9]{64}\z")) { result.ErrorMessage = "同步助手交付缺少有效的 SHA256 校验值。请查看日志后重新构建。"; return result; }
                        string actualHash;
                        using (FileStream stream = new FileStream(apkPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                        using (SHA256 hash = SHA256.Create())
                            actualHash = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", String.Empty).ToLowerInvariant();
                        if (!String.Equals(actualHash, exeSha256, StringComparison.Ordinal)) { result.ErrorMessage = "同步助手产物的 SHA256 校验不一致，当前不认定为成功。请重新构建。"; return result; }
                    }
                    else
                    {
                        // Copy-Item preserves LastWriteTime for cached source APKs, while
                        // a newly delivered target has a new CreationTime.
                        if (artifact.CreationTimeUtc < snapshot.StartedAtUtc.AddSeconds(-2)) { result.ErrorMessage = "成功提示指向此前已存在的产物，未找到本次新交付的文件。请查看日志。"; return result; }
                    }
                    result.ArtifactPath = apkPath;
                    result.ApkPath = snapshot.Target == BuildTarget.Apk ? apkPath : null;
                }
                else if (mode == BuildMode.CheckEnvironment && !sawCheckSuccess) { result.ErrorMessage = "检查进程已退出，但没有检查通过标记。请查看完整日志。"; return result; }
                else if (mode == BuildMode.PrepareEnvironment && !sawPrepareSuccess) { result.ErrorMessage = "准备进程已退出，但没有环境准备完成标记。请查看完整日志。"; return result; }
                result.State = BuildState.Succeeded;
                return result;
            }
        }

        private bool Cancelled() { lock (sync) { return cancellationRequested; } }
        private bool HasLogFailure() { lock (sync) { return logFailure != null; } }
        private static void SignalEnded(EventWaitHandle signal) { try { signal.Set(); } catch (ObjectDisposedException) { } }

        private static string QuoteProcessArgument(string value)
        {
            // Windows argv quoting, independent of PowerShell syntax. The embedded
            // script path is separately escaped as a PowerShell single-quoted literal.
            StringBuilder quoted = new StringBuilder("\"");
            int backslashes = 0;
            foreach (char character in value)
            {
                if (character == '\\') { backslashes++; continue; }
                if (character == '"') quoted.Append('\\', backslashes * 2 + 1);
                else quoted.Append('\\', backslashes);
                quoted.Append(character);
                backslashes = 0;
            }
            quoted.Append('\\', backslashes * 2);
            return quoted.Append('"').ToString();
        }

        private void WriteLine(string rawLine)
        {
            string line = ProtectOutput(rawLine);
            lock (sync)
            {
                snapshot.LastOutputAtUtc = DateTime.UtcNow;
                snapshot.OutputLineCount++;
                if (displayLines.Count >= DisplayLineLimit) { displayLines.Dequeue(); snapshot.DroppedDisplayLines++; }
                displayLines.Enqueue(line);
                try { if (logWriter != null) logWriter.WriteLine(line); }
                catch (Exception error) { if (logFailure == null) logFailure = ProtectOutput(error.Message); }
                Match stage = Stage.Match(line.Trim());
                if (stage.Success && stage.Groups[2].Value == (snapshot.Target == BuildTarget.Apk ? "5" : "4")) {
                    int number = Int32.Parse(stage.Groups[1].Value, CultureInfo.InvariantCulture);
                    if (number <= (snapshot.Target == BuildTarget.Apk ? 5 : 4)) { snapshot.Stage = number; snapshot.StageText = stage.Groups[3].Value; }
                }
                string trimmed = line.Trim();
                if (Regex.IsMatch(trimmed, @"^PUBLISHED: [a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$")) sawPublish = true;
                if (trimmed == "BUILD SUCCEEDED") sawSuccess = true;
                if (trimmed.StartsWith("CHECK PASSED:", StringComparison.Ordinal)) sawCheckSuccess = true;
                if (trimmed == (snapshot.Target == BuildTarget.Apk ? "APK ENVIRONMENT READY. No APK build started." : "SYNC ENVIRONMENT READY. No EXE build started.")) sawPrepareSuccess = true;
                if (trimmed.StartsWith(snapshot.Target == BuildTarget.Apk ? "APK:" : "EXE:", StringComparison.Ordinal)) apkPath = trimmed.Substring(4).Trim();
                if (snapshot.Target == BuildTarget.SyncHelper && trimmed.StartsWith("EXE-BUILD-ID:", StringComparison.Ordinal)) exeBuildId = trimmed.Substring(13).Trim();
                if (snapshot.Target == BuildTarget.SyncHelper && trimmed.StartsWith("SHA256:", StringComparison.Ordinal)) exeSha256 = trimmed.Substring(7).Trim();
                if (trimmed == "[GUI:ATTENTION:SDK_LICENSE]") attentionCode = "SDK_LICENSE";
                if (trimmed.StartsWith("BUILD FAILED:", StringComparison.Ordinal)) failureLine = trimmed.Substring(13).Trim();
            }
        }

        private sealed class JobObject : IDisposable
        {
            private SafeJobHandle handle;
            public JobObject()
            {
                handle = CreateJobObject(IntPtr.Zero, null);
                if (handle.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "无法创建构建任务进程组。");
                JobExtendedLimitInformation information = new JobExtendedLimitInformation();
                information.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                if (!SetInformationJobObject(handle, 9, ref information, (uint)Marshal.SizeOf(typeof(JobExtendedLimitInformation))))
                { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new System.ComponentModel.Win32Exception(error, "无法配置构建任务进程组。"); }
            }
            public void Assign(Process process)
            {
                if (!AssignProcessToJobObject(handle, process.Handle)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "无法隔离构建进程，已停止启动以确保取消安全。");
            }
            public void Terminate()
            {
                try { if (!handle.IsClosed && !handle.IsInvalid) TerminateJobObject(handle, 1223); }
                catch (ObjectDisposedException) { }
            }
            public bool WaitUntilEmpty(int timeoutMilliseconds)
            {
                Stopwatch watch = Stopwatch.StartNew();
                while (true) {
                    JobBasicAccountingInformation information;
                    if (!QueryInformationJobObject(handle, 1, out information, (uint)Marshal.SizeOf(typeof(JobBasicAccountingInformation)), IntPtr.Zero)) return false;
                    if (information.ActiveProcesses == 0) return true;
                    if (watch.ElapsedMilliseconds >= timeoutMilliseconds) return false;
                    Thread.Sleep(25);
                }
            }
            public void Dispose() { handle.Dispose(); }

            [StructLayout(LayoutKind.Sequential)] private struct JobBasicAccountingInformation
            {
                public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
                public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
            }
            [StructLayout(LayoutKind.Sequential)] private struct JobBasicLimitInformation
            {
                public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
                public uint LimitFlags;
                public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
                public uint ActiveProcessLimit;
                public UIntPtr Affinity;
                public uint PriorityClass, SchedulingClass;
            }
            [StructLayout(LayoutKind.Sequential)] private struct IoCounters
            {
                public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
            }
            [StructLayout(LayoutKind.Sequential)] private struct JobExtendedLimitInformation
            {
                public JobBasicLimitInformation BasicLimitInformation;
                public IoCounters IoInfo;
                public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
            }
            private sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid
            {
                public SafeJobHandle() : base(true) { }
                protected override bool ReleaseHandle() { return CloseHandle(handle); }
            }
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeJobHandle CreateJobObject(IntPtr attributes, string name);
            [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(SafeJobHandle job, int informationClass, ref JobExtendedLimitInformation information, uint length);
            [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AssignProcessToJobObject(SafeJobHandle job, IntPtr process);
            [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateJobObject(SafeJobHandle job, uint exitCode);
            [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryInformationJobObject(SafeJobHandle job, int informationClass, out JobBasicAccountingInformation information, uint length, IntPtr returnLength);
            [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr value);
        }
    }
}
