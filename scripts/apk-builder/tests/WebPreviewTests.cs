using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Chipmunks.ApkBuilder;

// Real isolated processes and local fixture HTTP responses; never starts Expo.
internal static class WebPreviewTests
{
    private static string root;
    private static int passed, failed;
    private static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "serve") return Serve(args);
        if (args.Length > 0 && args[0] == "sleep") { Thread.Sleep(60000); return 0; }
        root = Path.GetFullPath(args.Length > 0 ? args[0] : "output/builder-web-preview-tests");
        Directory.CreateDirectory(root);
        Test("verified-ready-reuses-instance-and-low-resource-flags", ReadyAndReuse);
        Test("occupied-port-preserves-unrelated-server", OccupiedPort);
        Test("mutex-rejects-second-owner", SecondOwner);
        Test("wrong-http-identity-is-not-ready", WrongIdentity);
        Test("non-html-response-is-not-ready", WrongHtml);
        Test("stop-kills-owned-tree-preserves-unrelated-process", StopTree);
        Test("immediate-dispose-cancels-without-ui-wait", ImmediateDispose);
        Test("failed-start-can-restart", FailedRestart);
        Test("bounded-ui-lines-and-log-redaction", BoundedLines);
        Console.WriteLine("Web preview fixtures: " + passed + " passed, " + failed + " failed.");
        File.WriteAllText(Path.Combine(root, "results.json"), "{\"passed\":" + passed + ",\"failed\":" + failed + ",\"realExpoStarted\":false}");
        return failed == 0 ? 0 : 1;
    }
    private static void Test(string name, Action action)
    {
        try { action(); passed++; Console.WriteLine("PASS " + name); }
        catch (Exception error) { failed++; Console.WriteLine("FAIL " + name + " " + error); }
    }
    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static string Quote(string value) { return "'" + value.Replace("'", "''") + "'"; }
    private static int FreePort() { TcpListener listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(); int port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop(); return port; }
    private static void Until(Func<bool> condition, string message)
    {
        Stopwatch watch = Stopwatch.StartNew();
        while (!condition()) { if (watch.ElapsedMilliseconds > 12000) throw new Exception(message); Thread.Sleep(30); }
    }
    private static void Finish(Task task) { Assert(task.Wait(45000), "readiness did not complete"); }
    private static void Fails(Task task, string message)
    {
        try { Finish(task); throw new Exception("expected failure: " + message); }
        catch (AggregateException error) { Assert(error.ToString().Contains(message), "unexpected failure: " + error); }
    }
    private static bool Alive(int pid) { try { using (Process process = Process.GetProcessById(pid)) return !process.HasExited; } catch (ArgumentException) { return false; } }

    private sealed class Fixture : IDisposable
    {
        public string DirectoryPath, ScriptPath;
        public int Port = FreePort(), ProxyPort = FreePort();
        public WebPreviewRunner Runner;
        public Fixture(string mode)
        {
            while (ProxyPort == Port) ProxyPort = FreePort();
            DirectoryPath = Path.Combine(root, "预览 空格 ' " + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(DirectoryPath);
            ScriptPath = Path.Combine(DirectoryPath, "preview fixture.ps1");
            SetScript(mode); Runner = NewRunner();
        }
        public void SetScript(string mode)
        {
            string executable = Process.GetCurrentProcess().MainModule.FileName;
            string body = "param([switch]$Managed,[switch]$NoOpen,[int]$MaxWorkers,[int]$Port,[int]$ProxyPort)\r\n$ErrorActionPreference='Stop'\r\n" +
                "Add-Content -LiteralPath " + Quote(Path.Combine(DirectoryPath, "starts.txt")) + " -Value \"$Managed,$NoOpen,$MaxWorkers\"\r\n" +
                "[IO.File]::WriteAllText(" + Quote(Path.Combine(DirectoryPath, "preview-env.txt")) + ", [string]$env:CI + '|' + [string]$env:BROWSER)\r\n" +
                (mode == "exit" ? "exit 7" :
                "& " + Quote(executable) + " serve $Port $ProxyPort " + Quote(DirectoryPath) + " " + Quote(mode));
            File.WriteAllText(ScriptPath, body, new UTF8Encoding(true));
        }
        public WebPreviewRunner NewRunner() { return new WebPreviewRunner(new WebPreviewRunnerOptions { RepositoryPath = DirectoryPath, ScriptPath = ScriptPath, Port = Port, ProxyPort = ProxyPort, StartupTimeoutMilliseconds = 30000 }); }
        public int[] Pids()
        {
            string path = Path.Combine(DirectoryPath, "pids.txt");
            Until(delegate { return File.Exists(path); }, "fixture did not write pids");
            string[] values = File.ReadAllLines(path); return new[] { Int32.Parse(values[0]), Int32.Parse(values[1]) };
        }
        public void Stop() { Runner.Stop(); Until(delegate { return !Runner.IsRunning && !Runner.IsStarting && Runner.Status == "网页预览已停止"; }, "preview did not stop"); }
        public void Dispose() { Runner.Dispose(); Until(delegate { return !Runner.IsRunning && !Runner.IsStarting; }, "preview did not dispose"); }
    }
    private static void ReadyAndReuse()
    {
        using (Fixture fixture = new Fixture("normal"))
        {
            Task first = fixture.Runner.StartAsync(), second = fixture.Runner.StartAsync();
            Assert(Object.ReferenceEquals(first, second), "duplicate StartAsync should reuse readiness"); Finish(first);
            Assert(fixture.Runner.IsRunning && !fixture.Runner.IsStarting, "runner did not enter ready state");
            Assert(File.ReadAllText(Path.Combine(fixture.DirectoryPath, "starts.txt")).Trim() == "True,True,2", "managed/no-browser/max-worker args missing");
            Assert(File.ReadAllText(Path.Combine(fixture.DirectoryPath, "preview-env.txt")) == "|none", "CI disabled live reload or CLI can open a premature browser.");
            Assert(Object.ReferenceEquals(first, fixture.Runner.StartAsync()), "running start duplicated process");
            Assert(File.ReadAllLines(Path.Combine(fixture.DirectoryPath, "starts.txt")).Length == 1, "duplicate script launch");
            using (Process server = Process.GetProcessById(fixture.Pids()[0])) Assert(server.PriorityClass == ProcessPriorityClass.BelowNormal, "child priority not inherited");
            Assert(File.Exists(fixture.Runner.LogPath), "log missing"); fixture.Stop();
        }
    }
    private static void OccupiedPort()
    {
        using (Fixture fixture = new Fixture("normal"))
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, fixture.Port); listener.Start();
            try { Fails(fixture.Runner.StartAsync(), "占用"); Assert(!File.Exists(Path.Combine(fixture.DirectoryPath, "starts.txt")), "script ran against occupied port"); using (TcpClient client = new TcpClient("127.0.0.1", fixture.Port)) Assert(client.Connected, "unrelated listener was stopped"); }
            finally { listener.Stop(); }
        }
    }
    private static void SecondOwner()
    {
        using (Fixture fixture = new Fixture("normal"))
        using (WebPreviewRunner other = fixture.NewRunner())
        { Finish(fixture.Runner.StartAsync()); Fails(other.StartAsync(), "其他构建工具窗口"); Assert(fixture.Runner.IsRunning, "original owner stopped"); fixture.Stop(); }
    }
    private static void WrongIdentity()
    {
        RejectResponse("other-instance", "text/html", "<html>wrong instance</html>", "响应不属于本次启动的实例");
    }
    private static void WrongHtml()
    {
        RejectResponse("expected-instance", "application/json", "{}", "尚未返回网页内容");
    }
    private static void RejectResponse(string session, string contentType, string body, string expectedReason)
    {
        // Start the responder directly so these tests prove HTTP rejection rather
        // than passing because an unrelated shell has not finished cold startup.
        TcpListener listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        Thread responder = new Thread(new ThreadStart(delegate { Respond(listener, session, contentType, body); }));
        responder.IsBackground = true; responder.Start();
        try {
            var probe = typeof(WebPreviewRunner).GetMethod("IsReady", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
            object[] arguments = { "http://127.0.0.1:" + port + "/", "expected-instance", true, null };
            bool accepted = (bool)probe.Invoke(null, arguments);
            Assert(!accepted && Convert.ToString(arguments[3]).Contains(expectedReason), "Expected specific HTTP rejection, got: " + Convert.ToString(arguments[3]));
        } finally { listener.Stop(); responder.Join(2000); }
    }
    private static void StopTree()
    {
        using (Process unrelated = Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "sleep") { UseShellExecute = false, CreateNoWindow = true }))
        using (Fixture fixture = new Fixture("normal"))
        {
            try { Finish(fixture.Runner.StartAsync()); int[] pids = fixture.Pids(); fixture.Stop(); Until(delegate { return !Alive(pids[0]) && !Alive(pids[1]); }, "owned descendants survived"); Assert(!unrelated.HasExited, "unrelated process killed"); }
            finally { if (!unrelated.HasExited) unrelated.Kill(); }
        }
    }
    private static void ImmediateDispose()
    {
        using (Fixture fixture = new Fixture("normal"))
        {
            Task ready = fixture.Runner.StartAsync(); Stopwatch watch = Stopwatch.StartNew(); fixture.Runner.Dispose(); Assert(watch.ElapsedMilliseconds < 300, "Dispose blocked UI");
            Until(delegate { return ready.IsCompleted; }, "cancelled readiness incomplete"); Assert(ready.IsCanceled, "immediate Dispose was not cancelled");
        }
    }
    private static void FailedRestart()
    {
        using (Fixture fixture = new Fixture("exit"))
        {
            Fails(fixture.Runner.StartAsync(), "提前退出"); Until(delegate { return !fixture.Runner.IsStarting; }, "failure cleanup incomplete"); fixture.SetScript("normal");
            // Final state is set only after process teardown; allow worker's mutex release.
            Thread.Sleep(100); Finish(fixture.Runner.StartAsync()); fixture.Stop();
        }
    }
    private static void BoundedLines()
    {
        using (Fixture fixture = new Fixture("lines"))
        {
            Finish(fixture.Runner.StartAsync()); Until(delegate { return File.Exists(Path.Combine(fixture.DirectoryPath, "output-done")); }, "lines not written"); Thread.Sleep(200);
            List<string> lines = new List<string>(); string[] batch;
            do { batch = fixture.Runner.DrainLines(29); Assert(batch.Length <= 29, "poll ignored limit"); lines.AddRange(batch); } while (batch.Length > 0);
            Assert(lines.Count <= 1500, "UI queue unbounded"); Assert(!String.Join("\n", lines.ToArray()).Contains("secret:password"), "UI credentials leaked");
            using (var stream = new FileStream(fixture.Runner.LogPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (var reader = new StreamReader(stream))
                Assert(!reader.ReadToEnd().Contains("secret:password"), "log credentials leaked");
            fixture.Stop();
        }
    }

    private static int Serve(string[] args)
    {
        int port = Int32.Parse(args[1]), proxy = Int32.Parse(args[2]); string directory = args[3], mode = args[4];
        using (Process child = Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "sleep") { UseShellExecute = false, CreateNoWindow = true }))
        {
            File.WriteAllLines(Path.Combine(directory, "pids.txt"), new[] { Process.GetCurrentProcess().Id.ToString(), child.Id.ToString() });
            TcpListener front = new TcpListener(IPAddress.Loopback, port), backend = new TcpListener(IPAddress.Loopback, proxy); front.Start(); backend.Start();
            string session = mode == "wrong-identity" ? "wrong" : Environment.GetEnvironmentVariable("CHIPMUNKS_WEB_PREVIEW_SESSION");
            Thread a = new Thread(new ThreadStart(delegate { Respond(front, session, mode == "wrong-html" ? "application/json" : "text/html", mode == "wrong-html" ? "{}" : "<!doctype html><html><body>fixture</body></html>"); }));
            Thread b = new Thread(new ThreadStart(delegate { Respond(backend, session, "application/json", "{\"service\":\"chipmunks-preview-proxy\",\"ready\":true}"); }));
            a.IsBackground = b.IsBackground = true; a.Start(); b.Start();
            if (mode == "lines") { for (int index = 0; index < 3000; index++) Console.WriteLine("line " + index + " https://secret:password@example.invalid/test"); File.WriteAllText(Path.Combine(directory, "output-done"), "done"); }
            Thread.Sleep(60000); return 0;
        }
    }
    private static void Respond(TcpListener listener, string session, string contentType, string body)
    {
        while (true)
        {
            TcpClient accepted;
            try { accepted = listener.AcceptTcpClient(); }
            catch (SocketException) { return; }
            catch (ObjectDisposedException) { return; }
            catch (InvalidOperationException) { return; }
            using (TcpClient client = accepted)
            {
                try
                {
                    client.ReceiveTimeout = 1000;
                    using (NetworkStream stream = client.GetStream())
                    {
                        using (StreamReader reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true))
                        { string line = reader.ReadLine(); if (line == null) continue; while ((line = reader.ReadLine()) != null && line.Length > 0) { } }
                        byte[] bytes = Encoding.UTF8.GetBytes(body);
                        byte[] headers = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: " + contentType + "\r\nX-Chipmunks-Preview-Session: " + session + "\r\nContent-Length: " + bytes.Length + "\r\n\r\n");
                        stream.Write(headers, 0, headers.Length); stream.Write(bytes, 0, bytes.Length);
                    }
                }
                catch (IOException) { }
                catch (ObjectDisposedException) { }
            }
        }
    }
}
