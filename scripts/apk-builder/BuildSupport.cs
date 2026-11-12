using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace Chipmunks.ApkBuilder
{
    internal static class BuildStateFiles
    {
        private static readonly object Gate = new object();

        internal static string ProjectPath(string repository, string name)
        {
            string root = Path.GetFullPath(repository).TrimEnd(Path.DirectorySeparatorChar);
            string identity = Hash(Encoding.UTF8.GetBytes(root.ToUpperInvariant()));
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ChipmunksBuildTools", "projects", identity, name);
        }

        internal static string Hash(byte[] bytes)
        {
            using (SHA256 hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

        internal static T Read<T>(string file) where T : new()
        {
            lock (Gate) {
                if (!File.Exists(file)) return new T();
                var info = new FileInfo(file);
                if (info.Length > 16 * 1024 * 1024) throw new IOException("构建记录文件过大，请检查文件内容。");
                try { return new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 }.Deserialize<T>(File.ReadAllText(file, Encoding.UTF8)); }
                catch (Exception error) { throw new IOException("无法读取构建记录，请检查文件。", error); }
            }
        }

        internal static void Write<T>(string file, T value)
        {
            lock (Gate) {
                Directory.CreateDirectory(Path.GetDirectoryName(file));
                string temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try {
                    string json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 }.Serialize(value);
                    File.WriteAllText(temporary, json, new UTF8Encoding(false));
                    if (File.Exists(file)) File.Replace(temporary, file, null);
                    else File.Move(temporary, file);
                } finally { if (File.Exists(temporary)) File.Delete(temporary); }
            }
        }

        internal static bool IsReparsePoint(string path)
        {
            return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;
        }
    }

    public sealed class BuildHistoryEntry
    {
        public string Date { get; set; }
        public string Target { get; set; }
        public string Mode { get; set; }
        public string State { get; set; }
        public string ArtifactPath { get; set; }
        public string LogPath { get; set; }
        public string UpdateId { get; set; }
        public long Size { get; set; }
        public string Runtime { get; set; }
        public string Summary { get; set; }
    }

    public static class BuildHistory
    {
        private static readonly object Gate = new object();

        public static List<BuildHistoryEntry> Load(string repository)
        {
            return BuildStateFiles.Read<List<BuildHistoryEntry>>(BuildStateFiles.ProjectPath(repository, "history.json"))
                ?? new List<BuildHistoryEntry>();
        }

        public static void Append(string repository, BuildHistoryEntry entry)
        {
            if (entry == null) throw new ArgumentNullException("entry");
            lock (Gate) {
                var entries = Load(repository);
                if (String.IsNullOrWhiteSpace(entry.Date)) entry.Date = DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture);
                entry.Summary = BuildRunner.ProtectOutput(entry.Summary ?? "");
                entries.Insert(0, entry);
                BuildStateFiles.Write(BuildStateFiles.ProjectPath(repository, "history.json"), entries.Take(100).ToList());
            }
        }
    }

    public sealed class BuildSourceState
    {
        public Dictionary<string, string> Native { get; set; }
        public Dictionary<string, string> App { get; set; }
        public Dictionary<string, string> Published { get; set; }
        public Dictionary<string, string> Sync { get; set; }
    }

    public static class ChangeAssessment
    {
        private static readonly string[] NativeInputs = { "client/android", "client/plugins", "patches", "client/package.json",
            "client/app.config.ts", "client/constants/motionTiming.json", "pnpm-lock.yaml" };
        private static readonly string[] AppInputs = { "client/app", "client/screens", "client/components", "client/hooks", "client/contexts",
            "client/utils", "client/constants", "client/assets", "client/heroui", "client/resources", "client/global.css", "client/metro.config.js", "client/babel.config.js",
            "client/version.json", "client/update-server.json", "client/tsconfig.json" };
        private static readonly string[] SyncInputs = { "scripts/label_sync_server.py", "scripts/label_templates", "scripts/assets", "scripts/icon.ico",
            "scripts/sync_export_folders.py", "scripts/sync_log_window.py", "scripts/sync_notifications.py", "scripts/sync_connection_qr.py",
            "scripts/sync_pairing_settings.py", "scripts/sync-build-requirements.txt", "scripts/build.ps1" };
        private static readonly HashSet<string> IgnoredDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "build", ".gradle", ".cxx", "node_modules", ".git", ".expo", "__pycache__", "__tests__", "testFixtures"
        };

        private static Dictionary<string, string> Capture(string repository, IEnumerable<string> inputs, bool native)
        {
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (string input in inputs) Collect(repository, input, native, values);
            if (native) {
                string versionFile = Path.Combine(repository, "client", "version.json");
                if (File.Exists(versionFile)) {
                    var version = BuildStateFiles.Read<Dictionary<string, object>>(versionFile);
                    foreach (string key in new[] { "version", "versionCode", "appName", "androidPackage", "selfUpdateEnabled" }) {
                        object value;
                        if (version != null && version.TryGetValue(key, out value))
                            values["client/version.json [" + key + "]"] = BuildStateFiles.Hash(Encoding.UTF8.GetBytes(Convert.ToString(value, CultureInfo.InvariantCulture)));
                    }
                }
            }
            return values;
        }

        private static void Collect(string repository, string relative, bool native, Dictionary<string, string> values)
        {
            string full = Path.Combine(repository, relative.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(full) && !Directory.Exists(full)) return;
            if (BuildStateFiles.IsReparsePoint(full)) throw new IOException("源码包含目录链接，无法可靠核对改动：" + relative);
            if (Directory.Exists(full)) {
                foreach (string entry in Directory.EnumerateFileSystemEntries(full).OrderBy(value => value, StringComparer.Ordinal)) {
                    string name = Path.GetFileName(entry);
                    if (native ? new[] { "build", ".gradle", ".cxx", "node_modules" }.Contains(name) : IgnoredDirectories.Contains(name)) continue;
                    Collect(repository, relative + "/" + name, native, values);
                }
                return;
            }
            if (relative.EndsWith(".pyc", StringComparison.OrdinalIgnoreCase) ||
                (native && (relative.EndsWith("local.properties", StringComparison.Ordinal) || relative.EndsWith("warehouse_ota.xml", StringComparison.Ordinal)))) return;
            values[relative] = BuildStateFiles.Hash(File.ReadAllBytes(full));
        }

        private static string Stamp(params Dictionary<string, string>[] inputs)
        {
            var text = new StringBuilder();
            foreach (var group in inputs) {
                foreach (var item in group.OrderBy(pair => pair.Key, StringComparer.Ordinal)) text.Append(item.Key).Append('\0').Append(item.Value).Append('\n');
                text.Append('\0');
            }
            return BuildStateFiles.Hash(Encoding.UTF8.GetBytes(text.ToString()));
        }

        public static string SourceStamp(string repository, BuildTarget target)
        {
            return target == BuildTarget.SyncHelper ? Stamp(Capture(repository, SyncInputs, false))
                : Stamp(Capture(repository, NativeInputs, true), Capture(repository, AppInputs, false));
        }

        public static void RecordSuccess(string repository, BuildTarget target, bool publish)
        {
            RecordSuccess(repository, target, publish, SourceStamp(repository, target));
        }

        public static bool RecordSuccess(string repository, BuildTarget target, bool publish, string expectedStamp)
        {
            var native = target == BuildTarget.Apk ? Capture(repository, NativeInputs, true) : null;
            var app = target == BuildTarget.Apk ? Capture(repository, AppInputs, false) : null;
            var sync = target == BuildTarget.SyncHelper ? Capture(repository, SyncInputs, false) : null;
            string current = target == BuildTarget.Apk ? Stamp(native, app) : Stamp(sync);
            if (String.IsNullOrEmpty(expectedStamp) || !String.Equals(current, expectedStamp, StringComparison.Ordinal)) return false;
            string file = BuildStateFiles.ProjectPath(repository, "source-baselines.json");
            var state = BuildStateFiles.Read<BuildSourceState>(file) ?? new BuildSourceState();
            if (target == BuildTarget.SyncHelper) state.Sync = sync;
            else if (publish) state.Published = app;
            else { state.Native = native; state.App = app; state.Published = app; }
            BuildStateFiles.Write(file, state);
            return true;
        }

        private static List<string> Changes(Dictionary<string, string> previous, Dictionary<string, string> current)
        {
            var keys = new HashSet<string>(current.Keys, StringComparer.Ordinal);
            if (previous != null) keys.UnionWith(previous.Keys);
            return keys.Where(key => previous == null || !previous.ContainsKey(key) || !current.ContainsKey(key) || previous[key] != current[key])
                .OrderBy(key => key, StringComparer.Ordinal).ToList();
        }

        private static void AppendChanges(StringBuilder output, List<string> changes)
        {
            foreach (string file in changes.Take(8)) output.AppendLine("  · " + file);
            if (changes.Count > 8) output.AppendLine("  另有 " + (changes.Count - 8) + " 个文件变化");
        }

        public static string Read(string repository)
        {
            var state = BuildStateFiles.Read<BuildSourceState>(BuildStateFiles.ProjectPath(repository, "source-baselines.json")) ?? new BuildSourceState();
            var native = Capture(repository, NativeInputs, true);
            var app = Capture(repository, AppInputs, false);
            var sync = Capture(repository, SyncInputs, false);
            var result = new StringBuilder();
            result.AppendLine("项目：" + Path.GetFullPath(repository));
            var nativeChanges = Changes(state.Native, native);
            if (state.Native == null) result.AppendLine("完整 APK：尚无文件改动基线。成功构建一次后可列出具体变化；发布仍会执行原生兼容校验。");
            else if (nativeChanges.Count > 0) { result.AppendLine("需要完整 APK：原生代码、依赖或配置有变化。"); AppendChanges(result, nativeChanges); }
            else result.AppendLine("原生输入与最近成功 APK 一致。");

            var appChanges = Changes(state.Published ?? state.App, app);
            if (state.Published == null && state.App == null) result.AppendLine("APP 页面：尚无成功构建或发布的文件基线。");
            else if (appChanges.Count > 0) {
                result.AppendLine(state.Native != null && nativeChanges.Count == 0
                    ? "可尝试发布热更新：APP 页面或业务代码有变化，正式发布时会再次校验。"
                    : "APP 页面或业务代码有变化，需结合原生兼容结果选择交付。");
                AppendChanges(result, appChanges);
            } else result.AppendLine("APP 页面与最近成功交付一致，未发现需要重复发布的变化。");

            var syncChanges = Changes(state.Sync, sync);
            if (state.Sync == null) result.AppendLine("同步助手：尚无成功构建的文件基线。");
            else if (syncChanges.Count > 0) { result.AppendLine("需要同步助手 EXE：打印模板或同步服务有变化。"); AppendChanges(result, syncChanges); }
            else result.AppendLine("同步助手源码与最近成功构建一致。");
            result.Append("结果依据本机最近成功交付的文件摘要；PDA 是否已安装或应用，请在设备上核对。");
            return result.ToString();
        }
    }

    public static class BuildDiagnostics
    {
        public static string Explain(string raw)
        {
            string safe = BuildRunner.ProtectOutput(raw ?? "");
            string lower = safe.ToLowerInvariant();
            string advice = null;
            if (ContainsAny(lower, "enospc", "not enough space", "disk full", "磁盘空间")) advice = "磁盘空间不足。打开存储管理核对占用，释放空间后重试。";
            else if (ContainsAny(lower, "being used by another process", "used by another process", "文件被占用", "正在使用", "无法更新 掌上仓库构建工具")) advice = "输出文件正被使用。退出对应程序及托盘窗口后重试。";
            else if (ContainsAny(lower, "credentials", "credential", "unauthorized", "401", "403", "凭证", "凭据")) advice = "发布连接或权限校验失败。到设置测试发布连接，必要时恢复发布连接备份。";
            else if (ContainsAny(lower, "license", "licence", "sdk_license", "许可证")) advice = "Android SDK 许可尚未就绪。点击准备环境，在提示窗口完成许可确认。";
            else if (ContainsAny(lower, "keystore", "signing", "pkcs", "证书", "签名")) advice = "APK 签名未通过。到设置核对发布签名和证书，使用原有构建配置备份恢复。";
            else if (ContainsAny(lower, "timeout", "timed out", "enotfound", "econnreset", "could not resolve", "unable to resolve", "network", "download", "下载", "网络", "连接超时")) advice = "网络请求或依赖下载失败。检查网络、代理和服务器连接后重试。";
            else if (ContainsAny(lower, "runtime", "原生配置", "apk 版本发生变化")) advice = "原生运行环境已变化。查看本次改动分析，构建并安装兼容的完整 APK。";
            else if (ContainsAny(lower, "pnpm", "node.js", "node was not found")) advice = "Node.js、pnpm 或前端依赖步骤失败。先检查环境，再查看日志中该命令之前的第一条具体错误。";
            else if (ContainsAny(lower, "gradle", "gradlew")) advice = "Android 编译阶段失败。查看日志中的 What went wrong 或首条 error，修正后重试。";
            else if (ContainsAny(lower, "permission", "access denied", "unauthorizedaccess", "拒绝访问", "权限")) advice = "文件访问失败。核对目标目录权限和文件占用后重试。";
            if (advice == null || safe.Contains(advice)) return safe;
            return advice + Environment.NewLine + safe;
        }

        private static bool ContainsAny(string value, params string[] terms)
        {
            return terms.Any(value.Contains);
        }
    }

    public sealed class BuildStorageItem
    {
        public string Path { get; set; }
        public string Kind { get; set; }
        public long Bytes { get; set; }
        public string Description { get; set; }
        public bool CanDelete { get; set; }
        public bool SizeKnown { get; set; }
        public bool IsDirectory { get; set; }
    }

    public static class BuildStorage
    {
        private static readonly Regex OtaDirectoryName = new Regex(@"\A\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:_\d+)?\z");

        private static string Full(string path) { return System.IO.Path.GetFullPath(path).TrimEnd(System.IO.Path.DirectorySeparatorChar); }
        private static bool IsBelow(string parent, string path)
        {
            return Full(path).StartsWith(Full(parent) + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }
        private static void AssertNoLinks(string path) { AssertNoLinks(path, null); }
        private static void AssertNoLinks(string path, HashSet<string> verified)
        {
            string current = Full(path);
            while (!String.IsNullOrEmpty(current)) {
                if (verified != null && verified.Contains(current)) break;
                if ((File.Exists(current) || Directory.Exists(current)) && BuildStateFiles.IsReparsePoint(current))
                    throw new IOException("目录含链接，无法安全清理：" + path);
                if (verified != null) verified.Add(current);
                var parent = Directory.GetParent(current);
                if (parent == null) break;
                current = parent.FullName;
            }
        }
        private static bool IsLink(FileAttributes attributes) { return (attributes & FileAttributes.ReparsePoint) != 0; }
        private static DirectoryInfo SafeDirectory(string path, HashSet<string> verified, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            var directory = new DirectoryInfo(path);
            if (!directory.Exists || IsLink(directory.Attributes)) return null;
            AssertNoLinks(path, verified);
            return directory;
        }
        private static void Add(List<BuildStorageItem> list, FileSystemInfo info, string kind, string description,
            bool protectedItem, HashSet<string> verified, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (!info.Exists) return;
            var item = new BuildStorageItem { Path = Full(info.FullName), Kind = kind, Description = description,
                CanDelete = !protectedItem, IsDirectory = info is DirectoryInfo };
            try {
                FileAttributes attributes = info.Attributes;
                item.IsDirectory = (attributes & FileAttributes.Directory) != 0;
                if (IsLink(attributes)) throw new IOException("目录或文件含链接，无法安全清理");
                AssertNoLinks(System.IO.Path.GetDirectoryName(item.Path), verified);
                // Enumeration already returns the native file metadata. Directories
                // intentionally remain unmeasured until requested by the caller.
                if (!item.IsDirectory) { item.Bytes = ((FileInfo)info).Length; item.SizeKnown = true; }
            } catch (OperationCanceledException) { throw; }
            catch (Exception error) { item.CanDelete = false; item.Description += "（无法完整核对：" + BuildRunner.ProtectOutput(error.Message) + "）"; }
            list.Add(item);
        }
        private static void AddFile(List<BuildStorageItem> list, string path, string kind, string description,
            bool protectedItem, HashSet<string> verified, CancellationToken token)
        {
            Add(list, new FileInfo(path), kind, description, protectedItem, verified, token);
        }
        private static void AddDirectory(List<BuildStorageItem> list, string path, string kind, string description,
            bool protectedItem, HashSet<string> verified, CancellationToken token)
        {
            Add(list, new DirectoryInfo(path), kind, description, protectedItem, verified, token);
        }

        public static List<BuildStorageItem> Inventory(string repository) { return Inventory(repository, CancellationToken.None); }
        public static List<BuildStorageItem> Inventory(string repository, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            string root = Full(repository);
            var list = new List<BuildStorageItem>();
            var verified = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            AssertNoLinks(root, verified);
            var protectedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var group in BuildHistory.Load(root).Where(entry => entry.State == "Succeeded" || entry.State == "成功").GroupBy(entry => (entry.Target ?? "") + "|" + (entry.Mode ?? ""))) {
                token.ThrowIfCancellationRequested();
                var entry = group.First();
                if (!String.IsNullOrWhiteSpace(entry.ArtifactPath)) protectedPaths.Add(Full(entry.ArtifactPath));
                if (!String.IsNullOrWhiteSpace(entry.LogPath)) protectedPaths.Add(Full(entry.LogPath));
            }
            var apkRoot = SafeDirectory(System.IO.Path.Combine(root, "dist", "apk"), verified, token);
            if (apkRoot != null) {
                var apks = apkRoot.EnumerateFiles("*.apk").OrderByDescending(info => new[] { info.CreationTimeUtc, info.LastWriteTimeUtc }.Max()).ToList();
                if (apks.Count > 0) protectedPaths.Add(Full(apks[0].FullName));
                foreach (var info in apks) {
                    bool keep = protectedPaths.Contains(Full(info.FullName));
                    Add(list, info, "APK", keep ? "保留最近成功或最新 APK" : "历史 APK，可按需清理", keep, verified, token);
                    AddFile(list, info.FullName + ".sha256", "APK 校验", keep ? "保留最新 APK 校验" : "历史 APK 校验", keep, verified, token);
                }
                foreach (var info in apkRoot.EnumerateFiles("*-verification.txt")) {
                    token.ThrowIfCancellationRequested();
                    string stamp = info.Name.Replace("-verification.txt", "");
                    bool keep = apks.Any(apk => protectedPaths.Contains(Full(apk.FullName)) && System.IO.Path.GetFileNameWithoutExtension(apk.Name).EndsWith("_" + stamp, StringComparison.Ordinal));
                    Add(list, info, "APK 校验记录", keep ? "保留最新 APK 验证记录" : "历史安装包验证记录", keep, verified, token);
                }
            }
            var otaRoot = SafeDirectory(System.IO.Path.Combine(root, "dist", "ota"), verified, token);
            if (otaRoot != null) {
                var folders = otaRoot.EnumerateDirectories().Where(info => OtaDirectoryName.IsMatch(info.Name))
                    .OrderByDescending(info => info.LastWriteTimeUtc).ToList();
                foreach (var info in folders) {
                    bool keep = info == folders[0] || protectedPaths.Any(value => IsBelow(info.FullName, value) || String.Equals(Full(info.FullName), value, StringComparison.OrdinalIgnoreCase));
                    Add(list, info, "热更新", keep ? "保留最新或最近成功发布包" : "历史生成包，删除后不能从本机重传此包", keep, verified, token);
                }
            }
            var syncRoot = SafeDirectory(System.IO.Path.Combine(root, "scripts", "dist"), verified, token);
            if (syncRoot != null) {
                foreach (var info in syncRoot.EnumerateFiles("*.exe"))
                    Add(list, info, "同步助手 EXE", "保留当前同步助手产物", true, verified, token);
            }
            foreach (string name in new[] { "android-build", "sync-build", "ota-publish" }) {
                var directory = SafeDirectory(System.IO.Path.Combine(root, "logs", name), verified, token);
                if (directory == null) continue;
                foreach (var info in EnumerateLogFiles(directory, token)) {
                    bool keep = protectedPaths.Contains(Full(info.FullName));
                    Add(list, info, "构建日志", keep ? "保留最近成功任务日志" : "历史构建或发布日志", keep, verified, token);
                }
            }
            AddDirectory(list, System.IO.Path.Combine(root, "client", ".expo"), "预览缓存", "保留预览运行缓存，避免与外部预览进程冲突，并加快下次启动", true, verified, token);
            AddDirectory(list, System.IO.Path.Combine(root, "dist", "expo57-web"), "网页产物", "已导出的网页，可重新生成", false, verified, token);
            var temporaryRoot = SafeDirectory(System.IO.Path.Combine(root, "scripts", ".sync-build-temp"), verified, token);
            if (temporaryRoot != null) {
                foreach (var info in temporaryRoot.EnumerateDirectories()) {
                    token.ThrowIfCancellationRequested();
                    if (IsLink(info.Attributes)) continue;
                    var marker = new FileInfo(System.IO.Path.Combine(info.FullName, ".chipmunks-sync-build-run"));
                    if (marker.Exists && !IsLink(marker.Attributes) && File.ReadAllText(marker.FullName).Trim() == "chipmunks-sync-build-v1")
                        Add(list, info, "EXE 构建缓存", "有本项目任务标记的临时构建目录", false, verified, token);
                }
            }
            string localConfig = System.IO.Path.Combine(root, "android-build.local");
            if (File.Exists(localConfig)) {
                var config = BuildStateFiles.Read<Dictionary<string, object>>(localConfig);
                object configuredRoot;
                if (config != null && config.TryGetValue("buildRoot", out configuredRoot) && configuredRoot is string) {
                    string cache = Full((string)configuredRoot);
                    if (Regex.IsMatch(cache, @"\A[A-Za-z]:\\cw-[A-Za-z0-9_-]+\z") && !IsBelow(cache, root) && !String.Equals(cache, root, StringComparison.OrdinalIgnoreCase)) {
                        var directory = SafeDirectory(cache, verified, token);
                        var marker = new FileInfo(System.IO.Path.Combine(cache, ".chipmunks-build-cache"));
                        if (directory != null && marker.Exists && !IsLink(marker.Attributes) && File.ReadAllText(marker.FullName).Trim() == "chipmunks-android-build-v1")
                            AddDirectory(list, System.IO.Path.Combine(cache, "client", "android", "app", "build"), "APK 编译缓存", "有构建目录归属标记；下次 APK 构建会重新生成", false, verified, token);
                    }
                }
            }
            token.ThrowIfCancellationRequested();
            return list.OrderByDescending(item => item.CanDelete).ThenBy(item => item.Kind, StringComparer.Ordinal).ThenBy(item => item.Path, StringComparer.OrdinalIgnoreCase).ToList();
        }

        // Compatibility entry point for callers that explicitly need full sizes.
        // The interactive manager uses Inventory and measures only eligible items.
        public static List<BuildStorageItem> Scan(string repository)
        {
            var items = Inventory(repository);
            foreach (var item in items.Where(value => !value.SizeKnown)) MeasureItem(item, CancellationToken.None);
            return items;
        }
        public static void MeasureItem(BuildStorageItem item) { MeasureItem(item, CancellationToken.None); }
        public static void MeasureItem(BuildStorageItem item, CancellationToken token)
        {
            if (item == null || String.IsNullOrWhiteSpace(item.Path)) throw new ArgumentException("请选择需要统计的项目。");
            token.ThrowIfCancellationRequested();
            try {
                string path = Full(item.Path);
                AssertNoLinks(path);
                FileAttributes attributes = File.GetAttributes(path);
                item.IsDirectory = (attributes & FileAttributes.Directory) != 0;
                long bytes = 0;
                if (!item.IsDirectory) bytes = new FileInfo(path).Length;
                else {
                    var pending = new Stack<DirectoryInfo>();
                    pending.Push(new DirectoryInfo(path));
                    while (pending.Count > 0) {
                        token.ThrowIfCancellationRequested();
                        var directory = pending.Pop(); directory.Refresh();
                        if (IsLink(directory.Attributes)) throw new IOException("目录含链接，无法安全清理");
                        foreach (var child in directory.EnumerateFileSystemInfos()) {
                            token.ThrowIfCancellationRequested();
                            FileAttributes childAttributes = child.Attributes;
                            if (IsLink(childAttributes)) throw new IOException("目录或文件含链接，无法安全清理");
                            if ((childAttributes & FileAttributes.Directory) != 0) pending.Push((DirectoryInfo)child);
                            else bytes = checked(bytes + ((FileInfo)child).Length);
                        }
                    }
                }
                token.ThrowIfCancellationRequested();
                item.Bytes = bytes; item.SizeKnown = true;
            } catch (OperationCanceledException) { throw; }
            catch (Exception error) {
                item.CanDelete = false; item.SizeKnown = false; item.Bytes = 0;
                item.Description += "（无法完整核对：" + BuildRunner.ProtectOutput(error.Message) + "）";
            }
        }
        private static IEnumerable<FileInfo> EnumerateLogFiles(DirectoryInfo directory, CancellationToken token)
        {
            foreach (var info in directory.EnumerateFileSystemInfos()) {
                token.ThrowIfCancellationRequested();
                FileAttributes attributes = info.Attributes;
                if (IsLink(attributes)) continue;
                if ((attributes & FileAttributes.Directory) != 0) {
                    foreach (var child in EnumerateLogFiles((DirectoryInfo)info, token)) yield return child;
                } else if (String.Equals(info.Extension, ".log", StringComparison.OrdinalIgnoreCase)) yield return (FileInfo)info;
            }
        }
        private static List<FileStream> AcquireLocks(string repository)
        {
            var locks = new List<FileStream>();
            try {
                string root = Full(repository);
                foreach (string name in new[] { "ota-publish", "android-build", "sync-build" }) {
                    string directory = System.IO.Path.Combine(root, "logs", name);
                    AssertNoLinks(directory); Directory.CreateDirectory(directory);
                    string file = System.IO.Path.Combine(directory, name == "ota-publish" ? "publish.lock" : "build.lock");
                    AssertNoLinks(file);
                    locks.Add(File.Open(file, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None));
                }
                return locks;
            } catch { foreach (var handle in locks) handle.Dispose(); throw; }
        }
        public static void Delete(string repository, BuildStorageItem item)
        {
            if (item == null || String.IsNullOrWhiteSpace(item.Path)) throw new ArgumentException("请选择清理项目。");
            Exception failure = null;
            DeleteBatch(repository, new[] { item }, delegate(BuildStorageItem selected, Exception error) { failure = error; });
            if (failure != null) throw failure;
        }
        public static void DeleteBatch(string repository, IEnumerable<BuildStorageItem> items, Action<BuildStorageItem, Exception> completed)
        {
            if (items == null) throw new ArgumentNullException("items");
            var selected = items.ToList();
            if (selected.Any(item => item == null || String.IsNullOrWhiteSpace(item.Path))) throw new ArgumentException("请选择有效清理项目。");
            var locks = AcquireLocks(repository);
            try {
                // Refresh protection metadata once while publication/build leases
                // are held. Only selected trees are walked; no full inventory scan
                // is multiplied by the number of checked rows.
                var allowed = Inventory(repository).ToDictionary(item => item.Path, StringComparer.OrdinalIgnoreCase);
                var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var item in selected) {
                    Exception failure = null;
                    try {
                        string requested = Full(item.Path);
                        if (!visited.Add(requested)) continue;
                        BuildStorageItem verified;
                        if (!allowed.TryGetValue(requested, out verified) || !verified.CanDelete)
                            throw new InvalidOperationException("此路径不在可清理清单中，或属于需要保留的构建产物。");
                        MeasureItem(verified, CancellationToken.None);
                        if (!verified.CanDelete || !verified.SizeKnown) throw new IOException(verified.Description);
                        AssertNoLinks(requested);
                        DeleteTree(requested);
                    } catch (Exception error) { failure = error; }
                    if (completed != null) completed(item, failure);
                }
            } finally { foreach (var handle in locks) handle.Dispose(); }
        }
        private static void DeleteTree(string path)
        {
            if (BuildStateFiles.IsReparsePoint(path)) throw new IOException("清理途中检测到目录链接，已停止。");
            if (File.Exists(path)) { File.Delete(path); return; }
            foreach (string child in Directory.EnumerateFileSystemEntries(path)) DeleteTree(child);
            Directory.Delete(path);
        }
    }
}
