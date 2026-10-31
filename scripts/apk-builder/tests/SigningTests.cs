using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Chipmunks.ApkBuilder
{
    internal static class SigningTests
    {
        // All credentials here are generated fixture values, never the user's release signing configuration.
        private const string FixturePassword = "temporary-signing-fixture-347";
        private const string BackupPassword = "temporary-backup-fixture-782";
        private static readonly List<object> Results = new List<object>();
        private static string root, repo, managed, keyA, keyB;
        private static SigningStore store;
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length != 2) { Console.WriteLine("Usage: SigningTests.exe <isolated-output-root> <keytool-path>"); return 2; }
            root = Path.GetFullPath(args[0]);
            repo = Path.Combine(root, "fixture project 中文"); managed = Path.Combine(root, "managed");
            Directory.CreateDirectory(repo); Directory.CreateDirectory(managed);
            keyA = Path.Combine(root, "temporary-A.p12"); keyB = Path.Combine(root, "temporary-B.p12");
            try { GenerateKey(args[1], keyA, "Fixture-A"); GenerateKey(args[1], keyB, "Fixture-B"); }
            catch { Console.WriteLine("Could not create isolated test certificates."); return 2; }
            store = new SigningStore(repo, managed);

            Test("initial status is empty and metadata contains no secrets", delegate {
                SigningStatus status = store.GetStatus(); Assert(!status.IsConfigured && status.ErrorMessage == null, "empty status");
                foreach (PropertyInfo property in typeof(SigningStatus).GetProperties())
                    Assert(property.Name.IndexOf("password", StringComparison.OrdinalIgnoreCase) < 0 && property.Name.IndexOf("base64", StringComparison.OrdinalIgnoreCase) < 0, "safe DTO");
            });
            Test("managed path uses normalized project SHA256", delegate {
                byte[] hash; using (var sha = SHA256.Create()) hash = sha.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(repo).TrimEnd('\\').ToUpperInvariant()));
                Assert(Path.GetFileName(store.ManagedPath) == BitConverter.ToString(hash).Replace("-", "") + ".dat", "identity path");
            });
            Test("invalid password and absent private key are rejected", delegate {
                ExpectFailure(delegate { store.ImportPkcs12(keyA, "wrong-test-password", "release-test", FixturePassword); });
                ExpectFailure(delegate { store.ImportPkcs12(keyA, "", "release-test", FixturePassword); });
                ExpectFailure(delegate { store.ImportPkcs12(keyA, FixturePassword, "release-test", " "); });
                var cert = new X509Certificate2(keyA, FixturePassword, (X509KeyStorageFlags)32);
                string publicOnly = Path.Combine(root, "public-only.p12"); File.WriteAllBytes(publicOnly, cert.Export(X509ContentType.Cert)); cert.Reset();
                ExpectFailure(delegate { store.ImportPkcs12(publicOnly, FixturePassword, "release-test", FixturePassword); });
                Assert(!File.Exists(store.ManagedPath), "no partial managed file");
            });
            Test("first import checks the original configured certificate", delegate {
                WriteLegacy(keyA);
                ExpectFailure(delegate { store.ImportPkcs12(keyB, FixturePassword, "release-test", FixturePassword); });
                Assert(!File.Exists(store.ManagedPath), "wrong identity blocked");
                store.ImportExistingConfiguration();
                Assert(store.GetStatus().IsConfigured, "legacy import");
            });
            Test("DPAPI payload matches the PowerShell contract and is not plaintext", delegate {
                byte[] cipher = File.ReadAllBytes(store.ManagedPath);
                Assert(Encoding.UTF8.GetString(cipher).IndexOf(FixturePassword, StringComparison.Ordinal) < 0, "cipher only");
                byte[] plain = ProtectedData.Unprotect(cipher, Encoding.UTF8.GetBytes("Chipmunks.Build.Signing.v1"), DataProtectionScope.CurrentUser);
                var payload = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(plain));
                Assert(Convert.ToInt32(payload["schemaVersion"], CultureInfo.InvariantCulture) == 1 && (string)payload["storeExtension"] == ".p12", "schema fields");
                Assert((string)payload["storePassword"] == FixturePassword && (string)payload["keyPassword"] == FixturePassword && (string)payload["keyAlias"] == "release-test", "credential contract");
                Assert(payload.ContainsKey("certificateSha256") && payload.ContainsKey("importedAtUtc") && payload.ContainsKey("storeBase64"), "contract complete");
                Array.Clear(plain, 0, plain.Length);
            });
            Test("different certificate cannot replace managed signing", delegate {
                byte[] before = File.ReadAllBytes(store.ManagedPath);
                ExpectFailure(delegate { store.ImportPkcs12(keyB, FixturePassword, "release-test", FixturePassword); });
                Assert(Equal(before, File.ReadAllBytes(store.ManagedPath)), "original preserved");
            });
            Test("short backup passwords cannot create files", delegate {
                string path = Path.Combine(root, "short.cwsign");
                ExpectFailure(delegate { store.ExportBackup(path, "short"); }); Assert(!File.Exists(path), "short password blocked");
            });
            Test("export cannot overwrite original key configuration or local data", delegate {
                foreach (string destination in new[] { keyA, Path.Combine(root, "fixture-signing.json"), store.ManagedPath })
                {
                    byte[] before = File.ReadAllBytes(destination);
                    ExpectFailure(delegate { store.ExportBackup(destination, BackupPassword); });
                    Assert(Equal(before, File.ReadAllBytes(destination)), "protected extension preserved");
                }
            });
            string backup = Path.Combine(root, "backup.cwsign");
            Test("encrypted backups use randomized salt and ciphertext", delegate {
                store.ExportBackup(backup, BackupPassword);
                string second = Path.Combine(root, "backup-second.cwsign"); store.ExportBackup(second, BackupPassword);
                Assert(!Equal(File.ReadAllBytes(backup), File.ReadAllBytes(second)), "randomized encryption");
                string text = Encoding.UTF8.GetString(File.ReadAllBytes(backup));
                Assert(!text.Contains(FixturePassword) && !text.Contains("storeBase64") && !text.Contains("certificateSha256"), "no secret payload plaintext");
            });
            Test("portable restore re-encrypts for destination project without legacy config", delegate {
                var destination = new SigningStore(Path.Combine(root, "new computer project"), Path.Combine(root, "destination-user"));
                SigningStatus restored = destination.RestoreBackup(backup, BackupPassword);
                Assert(restored.IsConfigured && restored.CertificateSha256 == store.GetStatus().CertificateSha256, "identity restored");
                Assert(!Equal(File.ReadAllBytes(destination.ManagedPath), File.ReadAllBytes(store.ManagedPath)), "local encryption refreshed");
            });
            Test("wrong backup password preserves existing signing exactly", delegate {
                byte[] before = File.ReadAllBytes(store.ManagedPath);
                ExpectFailure(delegate { store.RestoreBackup(backup, "wrong-backup-password"); });
                Assert(Equal(before, File.ReadAllBytes(store.ManagedPath)), "wrong password safe");
            });
            Test("tampered IV ciphertext and authentication tag are rejected", delegate {
                foreach (int location in new[] { 65, 100, File.ReadAllBytes(backup).Length - 1 })
                {
                    byte[] bytes = File.ReadAllBytes(backup); bytes[location] ^= 0x43;
                    string path = Path.Combine(root, "tampered-" + location + ".cwsign"); File.WriteAllBytes(path, bytes);
                    byte[] before = File.ReadAllBytes(store.ManagedPath);
                    ExpectFailure(delegate { store.RestoreBackup(path, BackupPassword); });
                    Assert(Equal(before, File.ReadAllBytes(store.ManagedPath)), "tampering safe");
                }
            });
            Test("unsupported versions and hostile KDF counts fail before derivation", delegate {
                byte[] bytes = File.ReadAllBytes(backup); int countOffset = Encoding.ASCII.GetBytes("CHIPMUNKS-SIGNING-BACKUP\r\n").Length + 4;
                Buffer.BlockCopy(BitConverter.GetBytes(Int32.MaxValue), 0, bytes, countOffset, 4);
                string path = Path.Combine(root, "invalid-count.cwsign"); File.WriteAllBytes(path, bytes);
                var stopwatch = Stopwatch.StartNew(); ExpectFailure(delegate { store.RestoreBackup(path, BackupPassword); });
                Assert(stopwatch.ElapsedMilliseconds < 1500, "bounded KDF metadata");
                bytes = File.ReadAllBytes(backup); bytes[countOffset - 4] = 17; File.WriteAllBytes(path, bytes);
                ExpectFailure(delegate { store.RestoreBackup(path, BackupPassword); });
            });
            Test("truncated and oversized backup inputs are rejected", delegate {
                string path = Path.Combine(root, "invalid-length.cwsign"); File.WriteAllBytes(path, new byte[17]);
                ExpectFailure(delegate { store.RestoreBackup(path, BackupPassword); });
                using (var file = new FileStream(path, FileMode.Create, FileAccess.Write)) file.SetLength(8 * 1024 * 1024 + 1);
                ExpectFailure(delegate { store.RestoreBackup(path, BackupPassword); });
            });
            Test("valid foreign certificate backup cannot replace existing signing", delegate {
                var foreign = new SigningStore(Path.Combine(root, "foreign project"), Path.Combine(root, "foreign-user"));
                foreign.ImportPkcs12(keyB, FixturePassword, "release-test", FixturePassword);
                string path = Path.Combine(root, "foreign.cwsign"); foreign.ExportBackup(path, BackupPassword);
                byte[] before = File.ReadAllBytes(store.ManagedPath);
                ExpectFailure(delegate { store.RestoreBackup(path, BackupPassword); });
                Assert(Equal(before, File.ReadAllBytes(store.ManagedPath)), "foreign backup rejected");
            });
            Test("locked destination leaves existing encrypted file unchanged", delegate {
                byte[] before = File.ReadAllBytes(store.ManagedPath);
                using (var locked = new FileStream(store.ManagedPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                    ExpectFailure(delegate { store.ImportPkcs12(keyA, FixturePassword, "release-test", FixturePassword); });
                Assert(Equal(before, File.ReadAllBytes(store.ManagedPath)), "atomic failure preserved");
                Assert(Directory.GetFiles(managed, ".signing-*.tmp").Length == 0, "temporary files cleaned");
            });
            Test("corrupted local store reports an error without deleting it", delegate {
                string destinationRepo = Path.Combine(root, "corrupted project"); var destination = new SigningStore(destinationRepo, managed);
                Directory.CreateDirectory(Path.GetDirectoryName(destination.ManagedPath)); File.WriteAllBytes(destination.ManagedPath, new byte[] { 1, 2, 3 });
                Assert(!destination.GetStatus().IsConfigured && !String.IsNullOrEmpty(destination.GetStatus().ErrorMessage), "corruption surfaced");
                ExpectFailure(delegate { destination.ImportPkcs12(keyA, FixturePassword, "release-test", FixturePassword); });
                Assert(File.ReadAllBytes(destination.ManagedPath).Length == 3, "corrupted evidence preserved");
                SigningStatus preview = destination.InspectBackup(backup, BackupPassword);
                Assert(preview.NeedsIdentityConfirmation && preview.CertificateSha256 == store.GetStatus().CertificateSha256, "recovery preview needs confirmation");
                ExpectFailure(delegate { destination.RestoreBackup(backup, BackupPassword); });
                Assert(File.ReadAllBytes(destination.ManagedPath).Length == 3, "unconfirmed restore preserved");
                destination.RestoreBackup(backup, BackupPassword, true);
                Assert(destination.GetStatus().IsConfigured, "explicitly confirmed restore works");
            });
            Test("damaged local signing can recover against readable original configuration", delegate {
                string recoveryRepo = Path.Combine(root, "legacy recovery project"); Directory.CreateDirectory(recoveryRepo);
                File.Copy(Path.Combine(repo, "android-build.local"), Path.Combine(recoveryRepo, "android-build.local"), true);
                var destination = new SigningStore(recoveryRepo, managed); File.WriteAllBytes(destination.ManagedPath, new byte[] { 5, 6, 7 });
                Assert(!destination.InspectBackup(backup, BackupPassword).NeedsIdentityConfirmation, "legacy identity anchors recovery");
                destination.RestoreBackup(backup, BackupPassword);
                Assert(destination.GetStatus().CertificateSha256 == store.GetStatus().CertificateSha256, "trusted recovery restored");
            });
            Test("signing UI and password dialogs use masked entries", delegate {
                Application.EnableVisualStyles();
                using (var form = new SigningWindow(store))
                {
                    EnsureHandles(form); form.PerformLayout();
                    Assert(form.Text.Contains("发布签名"), "signing window");
                    using (var bitmap = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size)); bitmap.Save(Path.Combine(root, "signing-window.png")); }
                    form.Size = form.MinimumSize; form.PerformLayout();
                    Control[] notes = form.Controls.Find("SigningInstructions", true); Assert(notes.Length == 1, "instruction block exists");
                    Size needed = TextRenderer.MeasureText(notes[0].Text, notes[0].Font, new Size(notes[0].Width - notes[0].Padding.Horizontal, Int32.MaxValue), TextFormatFlags.WordBreak | TextFormatFlags.TextBoxControl);
                    Assert(notes[0].Height - notes[0].Padding.Vertical >= needed.Height, "instructions fit at minimum size");
                    using (var bitmap = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size)); bitmap.Save(Path.Combine(root, "signing-window-minimum.png")); }
                }
                foreach (SigningWindow.SigningSecretMode mode in Enum.GetValues(typeof(SigningWindow.SigningSecretMode)))
                using (var prompt = new SigningWindow.SigningSecretWindow(mode)) { Assert(prompt.PasswordMasked, "password masked"); prompt.ClearSecrets(); }
            });
            int failures = 0;
            foreach (Dictionary<string, object> result in Results) if (!(bool)result["passed"]) failures++;
            File.WriteAllText(Path.Combine(root, "results.json"), new JavaScriptSerializer().Serialize(new { total = Results.Count, failed = failures, tests = Results }), new UTF8Encoding(false));
            Console.WriteLine("Signing tests: " + (Results.Count - failures) + "/" + Results.Count + " passed.");
            return failures == 0 ? 0 : 1;
        }

        private static void WriteLegacy(string key)
        {
            string config = Path.Combine(root, "fixture-signing.json");
            File.WriteAllText(config, new JavaScriptSerializer().Serialize(new { storeFile = key, storePassword = FixturePassword, keyAlias = "release-test", keyPassword = FixturePassword }), new UTF8Encoding(false));
            File.WriteAllText(Path.Combine(repo, "android-build.local"), new JavaScriptSerializer().Serialize(new { signingFile = config }), new UTF8Encoding(false));
        }
        private static void GenerateKey(string executable, string path, string name)
        {
            if (File.Exists(path)) return;
            var info = new ProcessStartInfo { FileName = executable, Arguments = "-genkeypair -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 365 -dname CN=" + name + " -alias release-test -storepass " + FixturePassword + " -keypass " + FixturePassword + " -keystore \"" + path + "\" -noprompt", UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
            using (Process process = Process.Start(info)) { process.StandardError.ReadToEnd(); process.StandardOutput.ReadToEnd(); if (!process.WaitForExit(30000) || process.ExitCode != 0) throw new Exception("fixture creation failed"); }
        }
        private static void Test(string name, Action body)
        {
            bool passed = false; string failure = null;
            try { body(); passed = true; } catch (Exception ex) { failure = ex is InvalidOperationException ? ex.Message : ex.GetType().Name; }
            Results.Add(new Dictionary<string, object> { { "name", name }, { "passed", passed }, { "failure", failure } });
            Console.WriteLine((passed ? "PASS " : "FAIL ") + name + (passed ? "" : " (" + failure + ")"));
        }
        private static void Assert(bool condition, string description) { if (!condition) throw new InvalidOperationException("Assertion: " + description); }
        private static void EnsureHandles(Control control) { IntPtr handle = control.Handle; foreach (Control child in control.Controls) EnsureHandles(child); }
        private static void ExpectFailure(Action action) { try { action(); } catch (InvalidOperationException) { return; } throw new InvalidOperationException("Expected rejection"); }
        private static bool Equal(byte[] left, byte[] right) { if (left.Length != right.Length) return false; for (int i = 0; i < left.Length; i++) if (left[i] != right[i]) return false; return true; }
    }
}
