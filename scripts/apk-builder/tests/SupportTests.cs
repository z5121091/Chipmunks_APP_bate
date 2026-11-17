using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

namespace Chipmunks.ApkBuilder
{
    internal static class SupportTests
    {
        private static string root, repo;
        private static int count;

        private static int Main(string[] args)
        {
            if (args.Length == 2 && args[0] == "--inventory") {
                var watch = Stopwatch.StartNew();
                var inventory = BuildStorage.Inventory(args[1]);
                Console.WriteLine("Quick inventory: " + inventory.Count + " items, " + inventory.Count(item => item.CanDelete) +
                    " clearable, " + inventory.Count(item => item.IsDirectory && !item.SizeKnown) + " directories deferred; " + watch.ElapsedMilliseconds + " ms.");
                return 0;
            }
            if (args.Length != 1) { Console.Error.WriteLine("Usage: SupportTests.exe <isolated-fixture-root>"); return 2; }
            root = Path.GetFullPath(args[0]);
            repo = Path.Combine(root, "support-project-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(repo);
            try {
                Test("absent baselines never claim a past source comparison", delegate {
                    Assert(ChangeAssessment.Read(repo).Contains("尚无文件改动基线"), "Unknown baseline incorrectly inferred.");
                });
                Write("client/screens/home/index.tsx", "first");
                Write("client/android/app/main.kt", "native");
                Write("client/version.json", "{\"version\":\"V1\",\"changelog\":[]}");
                Write("scripts/sync_pairing_settings.py", "pairing");
                Test("successful APK and sync snapshots include untracked content", delegate {
                    Assert(ChangeAssessment.RecordSuccess(repo, BuildTarget.Apk, false, ChangeAssessment.SourceStamp(repo, BuildTarget.Apk)), "APK snapshot failed.");
                    ChangeAssessment.RecordSuccess(repo, BuildTarget.SyncHelper, false);
                    Assert(ChangeAssessment.Read(repo).Contains("未发现需要重复发布"), "Source baseline not saved.");
                    Write("client/screens/new/index.tsx", "untracked");
                    string report = ChangeAssessment.Read(repo);
                    Assert(report.Contains("可尝试发布热更新") && report.Contains("client/screens/new/index.tsx"), "Untracked app source was missed.");
                    Write("scripts/sync_pairing_settings.py", "new pairing");
                    Assert(ChangeAssessment.Read(repo).Contains("需要同步助手 EXE"), "Imported sync module was missed.");
                    ChangeAssessment.RecordSuccess(repo, BuildTarget.SyncHelper, false);
                    Write("scripts/sync_window_icon.py", "shared window icon");
                    Assert(ChangeAssessment.Read(repo).Contains("scripts/sync_window_icon.py"), "Shared sync icon module was missed.");
                    Write("scripts/sync_assets.py", "embedded asset reader");
                    Write("scripts/build_sync_embedded_assets.py", "embedded asset generator and verifier");
                    string syncReport = ChangeAssessment.Read(repo);
                    Assert(syncReport.Contains("scripts/sync_assets.py") && syncReport.Contains("scripts/build_sync_embedded_assets.py"),
                        "Embedded resource build inputs were missed.");
                });
                Test("publication resets app changes but never overwrites APK native baseline", delegate {
                    ChangeAssessment.RecordSuccess(repo, BuildTarget.Apk, true);
                    Assert(ChangeAssessment.Read(repo).Contains("未发现需要重复发布"), "OTA app baseline not stored.");
                    Write("client/android/app/main.kt", "changed native");
                    ChangeAssessment.RecordSuccess(repo, BuildTarget.Apk, true);
                    Assert(ChangeAssessment.Read(repo).Contains("需要完整 APK"), "OTA incorrectly claimed native APK delivery.");
                });
                Test("source edits during build reject the task-start snapshot", delegate {
                    string stamp = ChangeAssessment.SourceStamp(repo, BuildTarget.Apk);
                    Write("client/android/app/main.kt", "changed during build");
                    Assert(!ChangeAssessment.RecordSuccess(repo, BuildTarget.Apk, false, stamp), "Stale snapshot accepted.");
                    Assert(ChangeAssessment.Read(repo).Contains("需要完整 APK"), "Rejected snapshot altered baseline.");
                    ChangeAssessment.RecordSuccess(repo, BuildTarget.Apk, false);
                });
                Test("generated native outputs do not change source stamp", delegate {
                    string before = ChangeAssessment.SourceStamp(repo, BuildTarget.Apk);
                    Write("client/android/app/build/output.bin", "generated");
                    Write("client/android/app/src/main/res/values/warehouse_ota.xml", "generated runtime");
                    Write("client/ota-runtime.json", "generated runtime");
                    Write("dist/ota/2026-11-11_01-01/update.zip", "generated archive");
                    Assert(ChangeAssessment.SourceStamp(repo, BuildTarget.Apk) == before, "Generated outputs counted as source.");
                });
                Test("version changelog remains an app change while APK version is native", delegate {
                    Write("client/version.json", "{\"version\":\"V1\",\"changelog\":[\"new\"]}");
                    Assert(ChangeAssessment.Read(repo).Contains("可尝试发布热更新"), "Metadata-only change requires APK.");
                    Write("client/version.json", "{\"version\":\"V2\",\"changelog\":[\"new\"]}");
                    Assert(ChangeAssessment.Read(repo).Contains("需要完整 APK"), "APK version change missed.");
                });
                Test("history keeps newest hundred records in per-project storage", delegate {
                    for (int i = 0; i < 105; i++) BuildHistory.Append(repo, new BuildHistoryEntry { Target = "fixture", State = "Failed", Summary = "entry-" + i });
                    var list = BuildHistory.Load(repo);
                    Assert(list.Count == 100 && list[0].Summary == "entry-104" && list[99].Summary == "entry-5", "History cap/order incorrect.");
                    Assert(BuildHistory.Load(Path.Combine(root, "separate-project")).Count == 0, "Different projects share history.");
                });
                Test("storage preserves newest and most recent successful APK with metadata", delegate {
                    Write("dist/apk/old_20260101_010101.apk", "old");
                    Write("dist/apk/success_20260102_010101.apk", "last successful");
                    Write("dist/apk/new_20260103_010101.apk", "newest");
                    foreach (string stamp in new[] { "20260101_010101", "20260102_010101", "20260103_010101" }) Write("dist/apk/" + stamp + "-verification.txt", "checked");
                    File.SetLastWriteTimeUtc(At("dist/apk/old_20260101_010101.apk"), DateTime.UtcNow.AddHours(-3));
                    File.SetLastWriteTimeUtc(At("dist/apk/success_20260102_010101.apk"), DateTime.UtcNow.AddHours(-2));
                    File.SetLastWriteTimeUtc(At("dist/apk/new_20260103_010101.apk"), DateTime.UtcNow.AddHours(-1));
                    Write("dist/apk/ota-baseline.json", "keep compatibility");
                    Write("logs/android-build/gui/last-success.log", "success");
                    BuildHistory.Append(repo, new BuildHistoryEntry { Target = "APK", Mode = "Build", State = "成功", Summary = "产物已核验；日志通道收尾超时", ArtifactPath = At("dist/apk/success_20260102_010101.apk"), LogPath = At("logs/android-build/gui/last-success.log") });
                    var items = BuildStorage.Scan(repo);
                    Assert(Find(items, "dist/apk/old_20260101_010101.apk").CanDelete, "Old artifact not clearable.");
                    Assert(!Find(items, "dist/apk/success_20260102_010101.apk").CanDelete, "Most recent success with a warning was unprotected.");
                    Assert(!Find(items, "dist/apk/new_20260103_010101.apk").CanDelete, "Newest artifact unprotected.");
                    Assert(!Find(items, "dist/apk/20260102_010101-verification.txt").CanDelete, "Success verification unprotected.");
                    Assert(!Find(items, "logs/android-build/gui/last-success.log").CanDelete, "Success log unprotected.");
                    Assert(items.All(item => item.Path != At("dist/apk/ota-baseline.json")), "Compatibility baseline exposed for cleanup.");
                    BuildStorage.Delete(repo, Find(items, "dist/apk/old_20260101_010101.apk"));
                    Assert(!File.Exists(At("dist/apk/old_20260101_010101.apk")) && File.Exists(At("dist/apk/new_20260103_010101.apk")), "Selective deletion incorrect.");
                });
                Test("source credentials compatibility and arbitrary paths cannot be deleted", delegate {
                    Write("private-signing.p12", "fixture private key");
                    foreach (string file in new[] { "private-signing.p12", "client/screens/home/index.tsx", "dist/apk/ota-baseline.json", "dist/apk/new_20260103_010101.apk" })
                        Throws(delegate { BuildStorage.Delete(repo, new BuildStorageItem { Path = At(file), CanDelete = true }); });
                    Throws(delegate { BuildStorage.Delete(repo, new BuildStorageItem { Path = repo, CanDelete = true }); });
                    Assert(File.Exists(At("private-signing.p12")), "Private material deleted.");
                });
                Test("OTA same-minute suffixes are inventoried and latest package is preserved", delegate {
                    Write("dist/ota/2026-11-11_01-01_02/update.zip", "second archive");
                    Directory.SetLastWriteTimeUtc(At("dist/ota/2026-11-11_01-01"), DateTime.UtcNow.AddHours(-2));
                    Directory.SetLastWriteTimeUtc(At("dist/ota/2026-11-11_01-01_02"), DateTime.UtcNow.AddHours(-1));
                    var items = BuildStorage.Scan(repo);
                    Assert(Find(items, "dist/ota/2026-11-11_01-01").CanDelete, "Historical OTA not clearable.");
                    Assert(!Find(items, "dist/ota/2026-11-11_01-01_02").CanDelete, "Latest OTA suffix folder unprotected.");
                    BuildStorage.Delete(repo, Find(items, "dist/ota/2026-11-11_01-01"));
                    Assert(File.Exists(At("dist/ota/2026-11-11_01-01_02/update.zip")), "Wrong OTA package deleted.");
                });
                Test("cache ownership marker and build lock are required", delegate {
                    Write("scripts/.sync-build-temp/owned/.chipmunks-sync-build-run", "chipmunks-sync-build-v1");
                    Write("scripts/.sync-build-temp/owned/temp.bin", "cache");
                    Write("scripts/.sync-build-temp/unowned/temp.bin", "unowned");
                    var items = BuildStorage.Scan(repo);
                    Assert(items.All(item => item.Path != At("scripts/.sync-build-temp/unowned")), "Unowned directory listed.");
                    using (var held = File.Open(At("logs/android-build/build.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
                        Throws(delegate { BuildStorage.Delete(repo, Find(items, "scripts/.sync-build-temp/owned")); });
                    Assert(Directory.Exists(At("scripts/.sync-build-temp/owned")), "Active-build cache deleted.");
                    BuildStorage.Delete(repo, Find(items, "scripts/.sync-build-temp/owned"));
                    Assert(!Directory.Exists(At("scripts/.sync-build-temp/owned")), "Owned cache not deleted.");
                });
                Test("redirected cache paths refuse cleanup and preserve their target", delegate {
                    string outside = Path.Combine(root, "junction-target-" + Guid.NewGuid().ToString("N"));
                    Directory.CreateDirectory(outside); File.WriteAllText(Path.Combine(outside, "sentinel.txt"), "preserve");
                    string link = At("client/.expo");
                    string command = "New-Item -ItemType Junction -Path '" + link.Replace("'", "''") + "' -Target '" + outside.Replace("'", "''") + "' -ErrorAction Stop | Out-Null";
                    var start = new ProcessStartInfo {
                        FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                        Arguments = "-NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(command)),
                        UseShellExecute = false, CreateNoWindow = true
                    };
                    using (var process = Process.Start(start)) { Assert(process.WaitForExit(15000), "Junction fixture creation timed out."); Assert(process.ExitCode == 0, "Junction fixture creation failed."); }
                    try {
                        Assert(!Find(BuildStorage.Scan(repo), "client/.expo").CanDelete, "Junction cache was clearable.");
                        Throws(delegate { BuildStorage.Delete(repo, new BuildStorageItem { Path = link, CanDelete = true }); });
                        Assert(File.ReadAllText(Path.Combine(outside, "sentinel.txt")) == "preserve", "Linked target altered.");
                    } finally {
                        if (Directory.Exists(link) && BuildStateFiles.IsReparsePoint(link)) Directory.Delete(link);
                    }
                });
                Test("publication lease blocks cleanup and preview cache is preserved", delegate {
                    Write("scripts/.sync-build-temp/publish-owned/.chipmunks-sync-build-run", "chipmunks-sync-build-v1");
                    Write("client/.expo/retained.txt", "preview cache");
                    var item = Find(BuildStorage.Scan(repo), "scripts/.sync-build-temp/publish-owned");
                    using (var held = File.Open(At("logs/ota-publish/publish.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
                        Throws(delegate { BuildStorage.Delete(repo, item); });
                    Assert(Directory.Exists(item.Path), "Package lease failed to protect cleanup.");
                    Assert(!Find(BuildStorage.Scan(repo), "client/.expo").CanDelete, "Preview cache not protected.");
                    Throws(delegate { BuildStorage.Delete(repo, new BuildStorageItem { Path = At("client/.expo"), CanDelete = true }); });
                    Assert(File.Exists(At("client/.expo/retained.txt")), "Active-preview cache was removed.");
                });
                Test("diagnostics retain original detail and add actionable guidance", delegate {
                    string raw = "Gradlew.bat failed (exit 1): network download timed out";
                    string message = BuildDiagnostics.Explain(raw);
                    Assert(message.Contains(raw) && message.Contains("网络请求或依赖下载失败"), "Original error or cause missing.");
                    Assert(BuildDiagnostics.Explain("ENOENT: pnpm missing").Contains("Node.js"), "pnpm explanation missing.");
                });
                Test("quick inventory defers directory traversal but provides file sizes", delegate {
                    Write("dist/ota/2026-11-10_00-01/nested/content.bin", "fixture-data");
                    Directory.SetLastWriteTimeUtc(At("dist/ota/2026-11-10_00-01"), DateTime.UtcNow.AddDays(-5));
                    var inventory = BuildStorage.Inventory(repo);
                    var folder = Find(inventory, "dist/ota/2026-11-10_00-01");
                    Assert(folder.CanDelete && folder.IsDirectory && !folder.SizeKnown, "Inventory eagerly counted a directory.");
                    var retained = Find(inventory, "client/.expo");
                    Assert(!retained.CanDelete && !retained.SizeKnown, "Protected cache was eagerly counted.");
                    var file = Find(inventory, "dist/apk/new_20260103_010101.apk");
                    Assert(file.SizeKnown && !file.IsDirectory && file.Bytes > 0, "File metadata size missing.");
                    BuildStorage.MeasureItem(folder);
                    Assert(folder.SizeKnown && folder.CanDelete && folder.Bytes == Encoding.UTF8.GetByteCount("fixture-data"), "Deferred directory size incorrect.");
                });
                Test("inventory and directory measurement honor cancellation", delegate {
                    using (var source = new System.Threading.CancellationTokenSource()) {
                        source.Cancel(); bool inventoryCancelled = false, sizeCancelled = false;
                        try { BuildStorage.Inventory(repo, source.Token); } catch (OperationCanceledException) { inventoryCancelled = true; }
                        try { BuildStorage.MeasureItem(new BuildStorageItem { Path = At("client/.expo") }, source.Token); } catch (OperationCanceledException) { sizeCancelled = true; }
                        Assert(inventoryCancelled && sizeCancelled, "Storage scan ignored cancellation.");
                    }
                });
                Test("batch cleanup rechecks protections and reports each selected result", delegate {
                    Write("logs/android-build/batch-a.log", "a"); Write("logs/android-build/batch-b.log", "b");
                    var inventory = BuildStorage.Inventory(repo);
                    var chosen = new[] { Find(inventory, "logs/android-build/batch-a.log"), Find(inventory, "logs/android-build/batch-b.log"),
                        new BuildStorageItem { Path = At("dist/apk/new_20260103_010101.apk"), CanDelete = true } };
                    int succeeded = 0, failed = 0;
                    BuildStorage.DeleteBatch(repo, chosen, delegate(BuildStorageItem item, Exception error) { if (error == null) succeeded++; else failed++; });
                    Assert(succeeded == 2 && failed == 1, "Batch result counts incorrect.");
                    Assert(!File.Exists(chosen[0].Path) && !File.Exists(chosen[1].Path) && File.Exists(chosen[2].Path), "Batch deleted a protected file or missed selected files.");
                });
                Console.WriteLine("SUPPORT TESTS PASSED: " + count);
                return 0;
            } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
            finally {
                string stateFile = BuildStateFiles.ProjectPath(repo, "history.json");
                string ownedState = Path.GetDirectoryName(stateFile);
                string expectedParent = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChipmunksBuildTools", "projects");
                if (ownedState.StartsWith(expectedParent + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(ownedState).Length == 64 && Directory.Exists(ownedState))
                    Directory.Delete(ownedState, true);
                // The caller owns the isolated fixture directory and any junction fixtures.
            }
        }

        private static string At(string relative) { return Path.Combine(repo, relative.Replace('/', Path.DirectorySeparatorChar)); }
        private static void Write(string relative, string text) { string file = At(relative); Directory.CreateDirectory(Path.GetDirectoryName(file)); File.WriteAllText(file, text, new UTF8Encoding(false)); }
        private static BuildStorageItem Find(List<BuildStorageItem> items, string relative) { return items.Single(item => String.Equals(item.Path, At(relative), StringComparison.OrdinalIgnoreCase)); }
        private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
        private static void Throws(Action action) { bool thrown = false; try { action(); } catch (IOException) { thrown = true; } catch (InvalidOperationException) { thrown = true; } Assert(thrown, "Expected safe refusal."); }
        private static void Test(string name, Action test) { test(); count++; Console.WriteLine("PASS: " + name); }
    }
}
