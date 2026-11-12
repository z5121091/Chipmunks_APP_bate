using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace Chipmunks.ApkBuilder
{
    public sealed class WebPreviewRunnerOptions
    {
        public string RepositoryPath { get; set; }
        public string ScriptPath { get; set; }
        public string LogDirectory { get; set; }
        public int Port { get; set; }
        public int ProxyPort { get; set; }
        public int StartupTimeoutMilliseconds { get; set; }
        public WebPreviewRunnerOptions() { Port = 19006; ProxyPort = 19007; StartupTimeoutMilliseconds = 600000; }
    }

    // Preview is a long-lived service, independent from finite build/publish jobs.
    // Only the process tree started here belongs to this runner.
    public sealed class WebPreviewRunner : IDisposable
    {
        private readonly object sync = new object();
        private readonly Queue<string> displayLines = new Queue<string>();
        private readonly string repository, script, logDirectory, mutexName, powerShellPath;
        private readonly int port, proxyPort, startupTimeout;
        private CancellationTokenSource cancellation;
        private Task worker;
        private TaskCompletionSource<bool> readiness;
        private JobObject currentJob;
        private StreamWriter logWriter;
        private string logPath = String.Empty, status = "未启动";
        private long logBytes;
        private bool starting, running, disposed, stopping;
        private const int DisplayLimit = 1500;
        private const long MaximumLogBytes = 8 * 1024 * 1024;

        public WebPreviewRunner(string repository) : this(new WebPreviewRunnerOptions { RepositoryPath = repository }) { }
        public WebPreviewRunner(WebPreviewRunnerOptions options)
        {
            if (options == null || String.IsNullOrWhiteSpace(options.RepositoryPath)) throw new ArgumentException("缺少项目目录。");
            repository = Path.GetFullPath(options.RepositoryPath).TrimEnd(Path.DirectorySeparatorChar);
            script = options.ScriptPath ?? Path.Combine(repository, "scripts", "start-local-web.ps1");
            logDirectory = options.LogDirectory ?? Path.Combine(repository, "logs", "web-preview");
            port = options.Port; proxyPort = options.ProxyPort; startupTimeout = options.StartupTimeoutMilliseconds;
            if (port < 1 || port > 65535 || proxyPort < 1 || proxyPort > 65535 || port == proxyPort || startupTimeout < 100) throw new ArgumentException("网页预览端口或启动超时不正确。");
            powerShellPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            using (SHA256 hash = SHA256.Create())
                mutexName = @"Local\ChipmunksWebPreview_" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(repository.ToUpperInvariant()))).Replace("-", String.Empty);
        }

        public bool IsRunning { get { lock (sync) { return running; } } }
        public bool IsStarting { get { lock (sync) { return starting; } } }
        public bool IsStopping { get { lock (sync) { return stopping && worker != null && !worker.IsCompleted; } } }
        public string Url { get { return "http://localhost:" + port.ToString(CultureInfo.InvariantCulture); } }
        public string Status { get { lock (sync) { return status; } } }
        public string LogPath { get { lock (sync) { return logPath; } } }

        public Task StartAsync()
        {
            lock (sync)
            {
                if (disposed) throw new ObjectDisposedException("WebPreviewRunner");
                if (starting || running) return readiness.Task;
                if (worker != null && !worker.IsCompleted) throw new InvalidOperationException("网页预览正在停止，请稍后重新启动。");
                cancellation = new CancellationTokenSource();
                readiness = new TaskCompletionSource<bool>();
                starting = true; stopping = false; status = "正在启动网页预览…";
                CancellationToken token = cancellation.Token;
                TaskCompletionSource<bool> ready = readiness;
                // This worker stays alive for the entire preview session. Keep it
                // off the shared pool used by HttpWebRequest and build UI tasks.
                worker = Task.Factory.StartNew(delegate { Run(token, ready); }, CancellationToken.None,
                    TaskCreationOptions.LongRunning, TaskScheduler.Default);
                return readiness.Task;
            }
        }

        public void Stop()
        {
            lock (sync)
            {
                if (!starting && !running && (worker == null || worker.IsCompleted)) return;
                stopping = true; running = false; status = "正在停止网页预览…";
                if (cancellation != null) cancellation.Cancel();
                if (currentJob != null) currentJob.Terminate();
            }
        }

        public string[] DrainLines(int maximum)
        {
            if (maximum <= 0) return new string[0];
            lock (sync)
            {
                int count = Math.Min(maximum, displayLines.Count);
                string[] lines = new string[count];
                for (int index = 0; index < count; index++) lines[index] = displayLines.Dequeue();
                return lines;
            }
        }

        public void OpenBrowser()
        {
            if (!IsRunning) throw new InvalidOperationException("网页预览尚未就绪，请先启动预览。");
            Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
        }

        public void Dispose()
        {
            lock (sync) { if (disposed) return; disposed = true; }
            Stop(); // Do not block the window; the worker owns stream draining and handle release.
        }

        private void Run(CancellationToken token, TaskCompletionSource<bool> ready)
        {
            Mutex instanceMutex = null;
            bool ownsMutex = false;
            JobObject job = null;
            Process process = null;
            EventWaitHandle gate = null;
            ManualResetEvent stdoutEnded = new ManualResetEvent(false), stderrEnded = new ManualResetEvent(false);
            string session = Guid.NewGuid().ToString("N");
            try
            {
                instanceMutex = new Mutex(false, mutexName);
                try { ownsMutex = instanceMutex.WaitOne(0); } catch (AbandonedMutexException) { ownsMutex = true; }
                if (!ownsMutex) throw new InvalidOperationException("此项目已有网页预览在其他构建工具窗口中运行，请回到原窗口打开或停止预览。");
                token.ThrowIfCancellationRequested();
                if (!File.Exists(script)) throw new FileNotFoundException("找不到网页预览脚本，请在完整项目目录中运行构建工具。", script);
                if (PortInUse(port) || PortInUse(proxyPort)) throw new InvalidOperationException("网页预览端口 " + port + " 或代理端口 " + proxyPort + " 已被其他程序占用。请关闭原预览后再启动；工具不会结束其他进程。");
                Directory.CreateDirectory(logDirectory);
                lock (sync)
                {
                    logPath = Path.Combine(logDirectory, "preview_" + DateTime.Now.ToString("yyyyMMdd_HHmmss_fff", CultureInfo.InvariantCulture) + "_" + session.Substring(0, 8) + ".log");
                    logWriter = new StreamWriter(new FileStream(logPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read), new UTF8Encoding(true));
                    logWriter.AutoFlush = true; logBytes = 0;
                }
                PruneOldLogs();
                WriteLine("网页预览：保留缓存，最多 2 个 Metro worker，就绪后转为后台低优先级。");
                string gateName = @"Local\ChipmunksPreviewGate_" + session;
                gate = new EventWaitHandle(false, EventResetMode.ManualReset, gateName);
                string command = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; " +
                    "$g=[System.Threading.EventWaitHandle]::OpenExisting('" + gateName + "'); if(-not $g.WaitOne(30000)){exit 91}; $g.Dispose(); " +
                    "& '" + script.Replace("'", "''") + "' -Managed -NoOpen -MaxWorkers 2 -Port " + port + " -ProxyPort " + proxyPort + "; if($null -eq $LASTEXITCODE){exit 0}else{exit $LASTEXITCODE}";
                ProcessStartInfo info = new ProcessStartInfo(powerShellPath, "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -OutputFormat Text -Command " + QuoteArgument(command));
                info.WorkingDirectory = repository; info.UseShellExecute = false; info.CreateNoWindow = true;
                info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = true;
                info.StandardOutputEncoding = info.StandardErrorEncoding = Encoding.UTF8;
                info.EnvironmentVariables["CHIPMUNKS_WEB_PREVIEW_SESSION"] = session;
                info.EnvironmentVariables["CHIPMUNKS_WEB_PREVIEW_LOG_DIRECTORY"] = logDirectory;
                info.EnvironmentVariables.Remove("CI");
                info.EnvironmentVariables["BROWSER"] = "none";
                info.EnvironmentVariables["COREPACK_ENABLE_DOWNLOAD_PROMPT"] = "0";
                info.EnvironmentVariables["PSModulePath"] = String.Join(Path.PathSeparator.ToString(), new[] {
                    Path.Combine(Path.GetDirectoryName(powerShellPath), "Modules"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WindowsPowerShell", "Modules"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "WindowsPowerShell", "Modules") });
                info.EnvironmentVariables.Remove("PSModuleAnalysisCachePath");
                job = new JobObject();
                lock (sync) { currentJob = job; }
                token.ThrowIfCancellationRequested();
                process = new Process { StartInfo = info };
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data == null) SignalEnded(stdoutEnded); else WriteLine(e.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data == null) SignalEnded(stderrEnded); else WriteLine(e.Data); };
                if (!process.Start()) throw new InvalidOperationException("无法启动网页预览进程。");
                // Block script execution until its process is safely assigned to our Job.
                try { job.Assign(process); }
                catch { try { process.Kill(); } catch { } throw; }
                process.BeginOutputReadLine(); process.BeginErrorReadLine(); process.StandardInput.Close();
                token.ThrowIfCancellationRequested(); gate.Set();
                Stopwatch watch = Stopwatch.StartNew();
                long nextReadinessLog = 3000;
                while (true)
                {
                    token.ThrowIfCancellationRequested();
                    if (process.HasExited) throw new InvalidOperationException("网页预览启动进程提前退出（代码 " + process.ExitCode + "），请查看日志。");
                    // Verify both the proxy identity and actual Metro HTML response.
                    // A listening TCP socket alone can belong to another application.
                    string reason;
                    bool proxyReady = IsReady("http://127.0.0.1:" + proxyPort + "/_chipmunks/preview", session, false, out reason);
                    // Expo serves the root document before Metro's enhancer. Its
                    // fallback document passes through our session header middleware;
                    // verify that identity first, then the actual browser root page.
                    if (proxyReady && IsReady("http://127.0.0.1:" + port + "/_chipmunks/preview", session, true, out reason) &&
                        IsReady("http://127.0.0.1:" + port + "/", null, true, out reason)) break;
                    lock (sync) { status = "正在等待" + (proxyReady ? "网页" : "代理") + "就绪：" + reason; }
                    if (watch.ElapsedMilliseconds >= nextReadinessLog) { WriteLine(status); nextReadinessLog = watch.ElapsedMilliseconds + 5000; }
                    if (watch.ElapsedMilliseconds >= startupTimeout) throw new TimeoutException("网页预览启动超时，未收到本次实例的页面与代理就绪确认。请查看日志后重试。");
                    if (token.WaitHandle.WaitOne(250)) token.ThrowIfCancellationRequested();
                }
                token.ThrowIfCancellationRequested();
                // Cold PowerShell/Node loading must not be starved by an already
                // busy desktop. Limit workers while starting, then lower the whole
                // ready service tree for ongoing use.
                job.LowerPriority();
                lock (sync) { token.ThrowIfCancellationRequested(); starting = false; running = true; status = "网页预览已就绪"; }
                WriteLine("网页预览已就绪：" + Url + "（关闭浏览器不会停止预览）。");
                ready.TrySetResult(true);
                while (!process.WaitForExit(250)) token.ThrowIfCancellationRequested();
                token.ThrowIfCancellationRequested();
                throw new InvalidOperationException("网页预览已退出（代码 " + process.ExitCode + "），可以重新启动。请查看日志了解原因。");
            }
            catch (OperationCanceledException) { ready.TrySetCanceled(); }
            catch (Exception error)
            {
                string message = BuildRunner.ProtectOutput(error.Message);
                lock (sync) { status = message; }
                WriteLine("网页预览错误：" + message);
                ready.TrySetException(new InvalidOperationException(message, error));
            }
            finally
            {
                // Watcher I/O can take longer to unwind than a simple fixture.
                // Keep IsStopping true on this worker while descendants exit;
                // Stop/Dispose themselves still return immediately to the UI.
                if (job != null) { job.Terminate(); job.WaitUntilEmpty(30000); }
                if (process != null)
                {
                    try { if (!process.HasExited) process.Kill(); process.WaitForExit(1000); } catch { }
                    stdoutEnded.WaitOne(1000); stderrEnded.WaitOne(1000);
                }
                lock (sync)
                {
                    currentJob = null; running = false; starting = false;
                    if (stopping || token.IsCancellationRequested) status = "网页预览已停止";
                    if (logWriter != null) { logWriter.Dispose(); logWriter = null; }
                }
                if (process != null) process.Dispose();
                if (gate != null) gate.Dispose();
                if (job != null) job.Dispose();
                stdoutEnded.Dispose(); stderrEnded.Dispose();
                if (ownsMutex) instanceMutex.ReleaseMutex();
                if (instanceMutex != null) instanceMutex.Dispose();
            }
        }

        private static bool IsReady(string address, string session, bool html, out string reason)
        {
            reason = "尚未响应";
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(address);
                request.Proxy = null; request.Timeout = request.ReadWriteTimeout = 1500; request.AllowAutoRedirect = false;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    if (response.StatusCode != HttpStatusCode.OK) { reason = "HTTP " + (int)response.StatusCode; return false; }
                    if (session != null && response.Headers["X-Chipmunks-Preview-Session"] != session) { reason = "响应不属于本次启动的实例"; return false; }
                    if (html && (response.ContentType ?? String.Empty).IndexOf("text/html", StringComparison.OrdinalIgnoreCase) < 0) { reason = "尚未返回网页内容"; return false; }
                    using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    {
                        char[] buffer = new char[8192]; int count = reader.Read(buffer, 0, buffer.Length);
                        string body = new string(buffer, 0, count);
                        bool ready = html ? body.IndexOf("<html", StringComparison.OrdinalIgnoreCase) >= 0 : body.IndexOf("chipmunks-preview-proxy", StringComparison.Ordinal) >= 0;
                        reason = ready ? "已就绪" : "响应内容未完成";
                        return ready;
                    }
                }
            }
            catch (WebException error) { reason = error.Status.ToString(); return false; }
            catch (IOException) { reason = "响应中断"; return false; }
        }

        private static bool PortInUse(int targetPort)
        {
            using (TcpClient client = new TcpClient())
            {
                try { IAsyncResult result = client.BeginConnect("127.0.0.1", targetPort, null, null); if (!result.AsyncWaitHandle.WaitOne(200)) return false; client.EndConnect(result); return true; }
                catch (SocketException) { return false; }
            }
        }

        private void WriteLine(string raw)
        {
            string line = BuildRunner.ProtectOutput(raw);
            lock (sync)
            {
                if (displayLines.Count >= DisplayLimit) displayLines.Dequeue();
                displayLines.Enqueue(line);
                if (logWriter == null) return;
                try
                {
                    if (logBytes >= MaximumLogBytes)
                    {
                        logWriter.Dispose();
                        string previous = logPath + ".previous";
                        if (File.Exists(previous)) File.Delete(previous);
                        File.Move(logPath, previous);
                        logWriter = new StreamWriter(new FileStream(logPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read), new UTF8Encoding(true));
                        logWriter.AutoFlush = true; logBytes = 0;
                    }
                    logWriter.WriteLine(line); logBytes += Encoding.UTF8.GetByteCount(line) + 2;
                }
                catch (IOException) { logWriter = null; /* Keep the preview usable when a log is locked. */ }
                catch (UnauthorizedAccessException) { logWriter = null; }
                catch (ObjectDisposedException) { logWriter = null; }
            }
        }

        private void PruneOldLogs()
        {
            try
            {
                FileInfo[] files = new DirectoryInfo(logDirectory).GetFiles("preview_*.log");
                Array.Sort(files, delegate(FileInfo a, FileInfo b) { return b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc); });
                for (int index = 10; index < files.Length; index++)
                {
                    if (String.Equals(files[index].FullName, logPath, StringComparison.OrdinalIgnoreCase)) continue;
                    files[index].Delete();
                    if (File.Exists(files[index].FullName + ".previous")) File.Delete(files[index].FullName + ".previous");
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        private static void SignalEnded(EventWaitHandle signal) { try { signal.Set(); } catch (ObjectDisposedException) { } }
        private static string QuoteArgument(string value)
        {
            StringBuilder quoted = new StringBuilder("\""); int slashes = 0;
            foreach (char character in value)
            {
                if (character == '\\') { slashes++; continue; }
                quoted.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
                quoted.Append(character); slashes = 0;
            }
            return quoted.Append('\\', slashes * 2).Append('"').ToString();
        }

        private sealed class JobObject : IDisposable
        {
            private SafeJobHandle handle;
            public JobObject()
            {
                handle = CreateJobObject(IntPtr.Zero, null);
                if (handle.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "无法创建预览进程组。");
                JobExtendedLimitInformation information = new JobExtendedLimitInformation();
                information.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                if (!SetInformationJobObject(handle, 9, ref information, (uint)Marshal.SizeOf(typeof(JobExtendedLimitInformation))))
                { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new System.ComponentModel.Win32Exception(error, "无法配置预览进程组。"); }
            }
            public void LowerPriority()
            {
                JobExtendedLimitInformation information = new JobExtendedLimitInformation();
                information.BasicLimitInformation.LimitFlags = 0x2000 | 0x20;
                information.BasicLimitInformation.PriorityClass = 0x00004000;
                if (!SetInformationJobObject(handle, 9, ref information, (uint)Marshal.SizeOf(typeof(JobExtendedLimitInformation))))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "无法调整预览后台优先级。");
            }
            public void Assign(Process process) { if (!AssignProcessToJobObject(handle, process.Handle)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "无法隔离网页预览进程，已停止启动。"); }
            public void Terminate() { try { if (!handle.IsClosed && !handle.IsInvalid) TerminateJobObject(handle, 1223); } catch (ObjectDisposedException) { } }
            public void WaitUntilEmpty(int timeout)
            {
                Stopwatch watch = Stopwatch.StartNew();
                while (watch.ElapsedMilliseconds < timeout)
                {
                    JobBasicAccountingInformation information;
                    if (!QueryInformationJobObject(handle, 1, out information, (uint)Marshal.SizeOf(typeof(JobBasicAccountingInformation)), IntPtr.Zero) || information.ActiveProcesses == 0) return;
                    Thread.Sleep(25);
                }
            }
            public void Dispose() { handle.Dispose(); }
            [StructLayout(LayoutKind.Sequential)] private struct JobBasicAccountingInformation { public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime; public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
            [StructLayout(LayoutKind.Sequential)] private struct JobBasicLimitInformation { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
            [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
            [StructLayout(LayoutKind.Sequential)] private struct JobExtendedLimitInformation { public JobBasicLimitInformation BasicLimitInformation; public IoCounters IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
            private sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid { public SafeJobHandle() : base(true) { } protected override bool ReleaseHandle() { return CloseHandle(handle); } }
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeJobHandle CreateJobObject(IntPtr attributes, string name);
            [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(SafeJobHandle job, int informationClass, ref JobExtendedLimitInformation information, uint length);
            [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AssignProcessToJobObject(SafeJobHandle job, IntPtr process);
            [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateJobObject(SafeJobHandle job, uint exitCode);
            [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryInformationJobObject(SafeJobHandle job, int informationClass, out JobBasicAccountingInformation information, uint length, IntPtr returnLength);
            [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr value);
        }
    }
}
