using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Chipmunks.ApkBuilder
{
    // This DTO is intentionally safe for the UI and logs. It never exposes credentials or key bytes.
    public sealed class SigningStatus
    {
        public bool IsConfigured { get; internal set; }
        public bool LegacyConfigurationAvailable { get; internal set; }
        public string CertificateSha256 { get; internal set; }
        public string ImportedAtUtc { get; internal set; }
        public string ErrorMessage { get; internal set; }
        public bool NeedsIdentityConfirmation { get; internal set; }
    }

    public sealed class SigningStore
    {
        private const int MaxStoreBytes = 4 * 1024 * 1024;
        private const int MaxPayloadBytes = 6 * 1024 * 1024;
        private const int MaxBackupBytes = 8 * 1024 * 1024;
        private const int BackupIterations = 210000;
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Chipmunks.Build.Signing.v1");
        private static readonly byte[] BackupMagic = Encoding.ASCII.GetBytes("CHIPMUNKS-SIGNING-BACKUP\r\n");
        private readonly string repository;
        private readonly string mutexName;
        public string ManagedPath { get; private set; }

        public SigningStore(string repositoryPath)
            : this(repositoryPath, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChipmunksBuildTools", "signing")) { }

        // A separate root allows tests to remain completely independent of the user's signing store.
        internal SigningStore(string repositoryPath, string managedRoot)
        {
            if (String.IsNullOrWhiteSpace(repositoryPath)) throw new ArgumentException("项目目录不能为空。");
            repository = Path.GetFullPath(repositoryPath).TrimEnd('\\');
            string identity = Hash(Encoding.UTF8.GetBytes(repository.ToUpperInvariant())).ToUpperInvariant();
            ManagedPath = Path.Combine(Path.GetFullPath(managedRoot), identity + ".dat");
            mutexName = "Local\\Chipmunks.Signing." + Hash(Encoding.UTF8.GetBytes(ManagedPath.ToUpperInvariant()));
        }

        public SigningStatus GetStatus()
        {
            var status = new SigningStatus { LegacyConfigurationAvailable = File.Exists(Path.Combine(repository, "android-build.local")) };
            if (!File.Exists(ManagedPath)) return status;
            try
            {
                Payload data = ReadManaged();
                status.IsConfigured = true;
                status.CertificateSha256 = data.certificateSha256;
                status.ImportedAtUtc = data.importedAtUtc;
            }
            catch { status.ErrorMessage = "本机托管签名无法解密或校验。请使用原 Windows 账户，或恢复加密备份；现有文件未修改。"; }
            return status;
        }

        public SigningStatus ImportExistingConfiguration()
        {
            return Change(delegate {
                Payload data;
                if (!TryReadLegacy(out data)) throw new InvalidOperationException("无法读取原发布签名配置。请确认原签名文件仍在，或从加密备份恢复。");
                VerifyIdentity(data);
                SaveManaged(data);
                return Status(data);
            });
        }

        public SigningStatus ImportPkcs12(string filePath, string storePassword, string keyAlias, string keyPassword)
        {
            return Change(delegate {
                string extension = Path.GetExtension(filePath ?? "").ToLowerInvariant();
                if (extension != ".p12" && extension != ".pfx") throw new InvalidOperationException("当前仅支持 PKCS#12 格式（.p12 / .pfx）。");
                byte[] bytes = ReadLimited(filePath, MaxStoreBytes, "签名文件");
                var data = new Payload { schemaVersion = 1, storeBase64 = Convert.ToBase64String(bytes), storeExtension = extension,
                    storePassword = storePassword ?? "", keyAlias = keyAlias, keyPassword = keyPassword ?? storePassword ?? "",
                    importedAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) };
                try { Validate(data, true); }
                finally { Array.Clear(bytes, 0, bytes.Length); }
                VerifyIdentity(data);
                SaveManaged(data);
                return Status(data);
            });
        }

        public void ExportBackup(string filePath, string backupPassword)
        {
            ValidatePassword(backupPassword);
            if (!String.Equals(Path.GetExtension(filePath ?? ""), ".cwsign", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("备份文件必须使用 .cwsign 扩展名，不能覆盖原签名或配置文件。");
            Change(delegate {
                if (String.Equals(Path.GetFullPath(filePath), ManagedPath, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("备份文件不能覆盖本机托管签名。");
                byte[] plain = Encode(ReadManaged());
                byte[] encrypted = null;
                try { encrypted = EncryptBackup(plain, backupPassword); AtomicWrite(filePath, encrypted); }
                finally { Array.Clear(plain, 0, plain.Length); if (encrypted != null) Array.Clear(encrypted, 0, encrypted.Length); }
                return true;
            });
        }

        public SigningStatus InspectBackup(string filePath, string backupPassword)
        {
            ValidatePassword(backupPassword);
            return Change(delegate {
                byte[] encrypted = ReadLimited(filePath, MaxBackupBytes, "备份文件");
                byte[] plain = null;
                try
                {
                    plain = DecryptBackup(encrypted, backupPassword);
                    Payload data = Decode(plain); Validate(data, false);
                    SigningStatus result = Status(data);
                    result.NeedsIdentityConfirmation = CheckRecoveryIdentity(data);
                    return result;
                }
                finally { Array.Clear(encrypted, 0, encrypted.Length); if (plain != null) Array.Clear(plain, 0, plain.Length); }
            });
        }

        public SigningStatus RestoreBackup(string filePath, string backupPassword, bool confirmUnverifiedIdentity = false)
        {
            ValidatePassword(backupPassword);
            return Change(delegate {
                byte[] encrypted = ReadLimited(filePath, MaxBackupBytes, "备份文件");
                byte[] plain = null;
                try
                {
                    plain = DecryptBackup(encrypted, backupPassword);
                    Payload data = Decode(plain);
                    Validate(data, false);
                    if (CheckRecoveryIdentity(data) && !confirmUnverifiedIdentity)
                        throw new InvalidOperationException("本机旧签名已损坏，且原签名配置不可读取。请先查看备份证书指纹，并明确确认后恢复。");
                    // Keep the historical import date from the authenticated backup.
                    SaveManaged(data);
                    return Status(data);
                }
                finally { Array.Clear(encrypted, 0, encrypted.Length); if (plain != null) Array.Clear(plain, 0, plain.Length); }
            });
        }

        private static SigningStatus Status(Payload data)
        {
            return new SigningStatus { IsConfigured = true, CertificateSha256 = data.certificateSha256, ImportedAtUtc = data.importedAtUtc };
        }

        private T Change<T>(Func<T> action)
        {
            using (var mutex = new Mutex(false, mutexName))
            {
                bool held = false;
                try
                {
                    try { held = mutex.WaitOne(0); } catch (AbandonedMutexException) { held = true; }
                    if (!held) throw new InvalidOperationException("签名正在由另一个窗口处理，请稍后再试。");
                    return action();
                }
                finally { if (held) mutex.ReleaseMutex(); }
            }
        }

        private void VerifyIdentity(Payload incoming)
        {
            if (File.Exists(ManagedPath))
            {
                Payload current = ReadManaged();
                AssertSameCertificate(current, incoming);
            }
            Payload legacy;
            if (TryReadLegacy(out legacy)) AssertSameCertificate(legacy, incoming);
        }

        private static void AssertSameCertificate(Payload expected, Payload incoming)
        {
            if (!String.Equals(expected.certificateSha256, incoming.certificateSha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("这份签名与当前项目的发布证书不一致，已拒绝导入，避免 APK 无法覆盖安装。现有签名未修改。");
        }

        // A broken local DPAPI file must be recoverable. Keep identity checks when either
        // trusted reference is readable; otherwise the UI must show the backup fingerprint
        // and obtain an explicit recovery confirmation before replacing the broken file.
        private bool CheckRecoveryIdentity(Payload incoming)
        {
            bool hadManaged = File.Exists(ManagedPath), trusted = false;
            Payload current = null;
            if (hadManaged)
            {
                try { current = ReadManaged(); } catch (InvalidOperationException) { }
                if (current != null) { AssertSameCertificate(current, incoming); trusted = true; }
            }
            Payload legacy;
            if (TryReadLegacy(out legacy)) { AssertSameCertificate(legacy, incoming); trusted = true; }
            return hadManaged && !trusted;
        }

        private bool TryReadLegacy(out Payload data)
        {
            data = null;
            try
            {
                var config = ParseMap(ReadLimited(Path.Combine(repository, "android-build.local"), MaxPayloadBytes, "构建配置"));
                string signingFile = Text(config, "signingFile");
                if (String.IsNullOrWhiteSpace(signingFile)) return false;
                if (!Path.IsPathRooted(signingFile)) signingFile = Path.Combine(repository, signingFile);
                var legacy = ParseMap(ReadLimited(signingFile, MaxPayloadBytes, "签名配置"));
                string keyFile = Text(legacy, "storeFile");
                if (!Path.IsPathRooted(keyFile)) keyFile = Path.Combine(Path.GetDirectoryName(signingFile), keyFile);
                string extension = Path.GetExtension(keyFile).ToLowerInvariant();
                byte[] bytes = ReadLimited(keyFile, MaxStoreBytes, "签名文件");
                try
                {
                    data = new Payload { schemaVersion = 1, storeBase64 = Convert.ToBase64String(bytes), storeExtension = extension,
                        storePassword = Text(legacy, "storePassword"), keyAlias = Text(legacy, "keyAlias"), keyPassword = Text(legacy, "keyPassword"),
                        importedAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) };
                    Validate(data, true);
                    return true;
                }
                finally { Array.Clear(bytes, 0, bytes.Length); }
            }
            catch { data = null; return false; }
        }

        private Payload ReadManaged()
        {
            byte[] cipher = ReadLimited(ManagedPath, MaxBackupBytes, "本机托管签名");
            byte[] plain = null;
            try
            {
                plain = ProtectedData.Unprotect(cipher, Entropy, DataProtectionScope.CurrentUser);
                Payload data = Decode(plain);
                Validate(data, false);
                return data;
            }
            catch (InvalidOperationException) { throw; }
            catch { throw new InvalidOperationException("本机托管签名无法解密或校验。请恢复正确的加密备份；现有文件未修改。"); }
            finally { Array.Clear(cipher, 0, cipher.Length); if (plain != null) Array.Clear(plain, 0, plain.Length); }
        }

        private void SaveManaged(Payload data)
        {
            byte[] plain = Encode(data);
            byte[] cipher = null;
            try { cipher = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser); AtomicWrite(ManagedPath, cipher); }
            finally { Array.Clear(plain, 0, plain.Length); if (cipher != null) Array.Clear(cipher, 0, cipher.Length); }
        }

        private static void Validate(Payload data, bool setFingerprint)
        {
            if (data == null || data.schemaVersion != 1 || (data.storeExtension != ".p12" && data.storeExtension != ".pfx") ||
                String.IsNullOrWhiteSpace(data.keyAlias) || data.keyAlias.Length > 200 || HasControl(data.keyAlias) ||
                String.IsNullOrWhiteSpace(data.storePassword) || String.IsNullOrWhiteSpace(data.keyPassword) || data.storePassword.Length > 1024 || data.keyPassword.Length > 1024 ||
                String.IsNullOrEmpty(data.storeBase64) || data.storeBase64.Length > (MaxStoreBytes + 2) / 3 * 4)
                throw new InvalidOperationException("签名内容不完整或格式不受支持。");
            DateTimeOffset date;
            if (!DateTimeOffset.TryParseExact(data.importedAtUtc, "o", CultureInfo.InvariantCulture, DateTimeStyles.None, out date))
                throw new InvalidOperationException("签名导入时间无效。");
            byte[] bytes = null;
            var certificates = new X509Certificate2Collection();
            try
            {
                bytes = Convert.FromBase64String(data.storeBase64);
                if (bytes.Length == 0 || bytes.Length > MaxStoreBytes) throw new CryptographicException();
                // EphemeralKeySet avoids writing imported private keys to the Windows certificate stores.
                certificates.Import(bytes, data.storePassword, (X509KeyStorageFlags)32);
                X509Certificate2 signing = null;
                foreach (X509Certificate2 certificate in certificates)
                {
                    if (!certificate.HasPrivateKey) continue;
                    if (signing != null) throw new InvalidOperationException("此文件包含多个私钥，请使用只含一个发布密钥的 PKCS#12 文件。");
                    signing = certificate;
                }
                if (signing == null) throw new InvalidOperationException("签名文件中没有私钥，不能用于发布 APK。");
                string fingerprint = Hash(signing.RawData);
                if (setFingerprint) data.certificateSha256 = fingerprint;
                else if (!String.Equals(fingerprint, data.certificateSha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("签名证书指纹不一致，文件可能已损坏。");
            }
            catch (InvalidOperationException) { throw; }
            catch { throw new InvalidOperationException("无法解开 PKCS#12 签名文件，请检查文件格式和签名密码。"); }
            finally
            {
                foreach (X509Certificate2 certificate in certificates) certificate.Reset();
                if (bytes != null) Array.Clear(bytes, 0, bytes.Length);
            }
        }

        private static bool HasControl(string value)
        {
            foreach (char c in value) if (Char.IsControl(c)) return true;
            return false;
        }

        private static void ValidatePassword(string password)
        {
            if (password == null || password.Length < 8 || password.Length > 256)
                throw new InvalidOperationException("备份密码须为 8～256 个字符。请牢记密码，工具无法找回。");
        }

        private static byte[] EncryptBackup(byte[] plain, string password)
        {
            byte[] salt = RandomBytes(32), iv = RandomBytes(16), keys = null, encrypted = null;
            try
            {
                keys = Derive(password, salt);
                using (var aes = new AesCryptoServiceProvider())
                {
                    aes.KeySize = 256; aes.Mode = CipherMode.CBC; aes.Padding = PaddingMode.PKCS7;
                    aes.Key = Slice(keys, 0, 32); aes.IV = iv;
                    using (ICryptoTransform transform = aes.CreateEncryptor()) encrypted = transform.TransformFinalBlock(plain, 0, plain.Length);
                }
                using (var stream = new MemoryStream())
                {
                    using (var writer = new BinaryWriter(stream, Encoding.UTF8, true))
                    {
                        writer.Write(BackupMagic); writer.Write(1); writer.Write(BackupIterations); writer.Write(salt); writer.Write(iv);
                        writer.Write(encrypted.Length); writer.Write(encrypted); writer.Flush();
                    }
                    byte[] body = stream.ToArray();
                    using (var mac = new HMACSHA256(Slice(keys, 32, 32))) { byte[] tag = mac.ComputeHash(body); stream.Write(tag, 0, tag.Length); }
                    return stream.ToArray();
                }
            }
            finally { if (keys != null) Array.Clear(keys, 0, keys.Length); if (encrypted != null) Array.Clear(encrypted, 0, encrypted.Length); }
        }

        private static byte[] DecryptBackup(byte[] bytes, string password)
        {
            byte[] keys = null;
            try
            {
                int headerLength = BackupMagic.Length + 4 + 4 + 32 + 16 + 4;
                if (bytes.Length < headerLength + 16 + 32 || bytes.Length > MaxBackupBytes) throw new InvalidOperationException("备份文件格式不正确或文件不完整。");
                using (var stream = new MemoryStream(bytes, false))
                using (var reader = new BinaryReader(stream, Encoding.UTF8))
                {
                    if (!Equal(reader.ReadBytes(BackupMagic.Length), BackupMagic) || reader.ReadInt32() != 1 || reader.ReadInt32() != BackupIterations)
                        throw new InvalidOperationException("备份文件版本或加密参数不受支持。");
                    byte[] salt = reader.ReadBytes(32), iv = reader.ReadBytes(16);
                    int length = reader.ReadInt32();
                    if (length <= 0 || length > MaxPayloadBytes + 16 || length % 16 != 0 || bytes.Length != headerLength + length + 32)
                        throw new InvalidOperationException("备份文件长度无效，可能已损坏。");
                    keys = Derive(password, salt);
                    byte[] expected;
                    using (var mac = new HMACSHA256(Slice(keys, 32, 32))) expected = mac.ComputeHash(bytes, 0, bytes.Length - 32);
                    if (!Equal(expected, Slice(bytes, bytes.Length - 32, 32)))
                        throw new InvalidOperationException("备份密码不正确，或文件已被修改。现有签名未修改。");
                    // Verify the complete authenticated envelope before attempting CBC decryption.
                    using (var aes = new AesCryptoServiceProvider())
                    {
                        aes.KeySize = 256; aes.Mode = CipherMode.CBC; aes.Padding = PaddingMode.PKCS7;
                        aes.Key = Slice(keys, 0, 32); aes.IV = iv;
                        using (ICryptoTransform transform = aes.CreateDecryptor())
                            return transform.TransformFinalBlock(bytes, headerLength, length);
                    }
                }
            }
            catch (InvalidOperationException) { throw; }
            catch { throw new InvalidOperationException("备份密码不正确，或文件已损坏。现有签名未修改。"); }
            finally { if (keys != null) Array.Clear(keys, 0, keys.Length); }
        }

        private static byte[] Derive(string password, byte[] salt)
        {
            using (var derive = new Rfc2898DeriveBytes(password, salt, BackupIterations, HashAlgorithmName.SHA256)) return derive.GetBytes(64);
        }
        private static byte[] RandomBytes(int count) { var value = new byte[count]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(value); return value; }
        private static byte[] Slice(byte[] bytes, int offset, int count) { var value = new byte[count]; Buffer.BlockCopy(bytes, offset, value, 0, count); return value; }
        private static bool Equal(byte[] left, byte[] right) { if (left.Length != right.Length) return false; int difference = 0; for (int i = 0; i < left.Length; i++) difference |= left[i] ^ right[i]; return difference == 0; }
        private static string Hash(byte[] bytes) { using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }

        private static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength = MaxPayloadBytes, RecursionLimit = 12 }; }
        private static byte[] Encode(Payload data) { return Encoding.UTF8.GetBytes(Serializer().Serialize(data)); }
        private static Payload Decode(byte[] plain)
        {
            if (plain.Length == 0 || plain.Length > MaxPayloadBytes) throw new InvalidOperationException("签名内容大小无效。");
            try { return Serializer().Deserialize<Payload>(new UTF8Encoding(false, true).GetString(plain).TrimStart('\uFEFF')); }
            catch { throw new InvalidOperationException("签名内容格式不正确。"); }
        }
        private static Dictionary<string, object> ParseMap(byte[] bytes)
        {
            try { return Serializer().Deserialize<Dictionary<string, object>>(new UTF8Encoding(false, true).GetString(bytes).TrimStart('\uFEFF')); }
            finally { Array.Clear(bytes, 0, bytes.Length); }
        }
        private static string Text(Dictionary<string, object> values, string name) { object value; return values != null && values.TryGetValue(name, out value) ? value as string : null; }

        private static byte[] ReadLimited(string filePath, int maximum, string description)
        {
            try
            {
                using (var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    if (stream.Length <= 0 || stream.Length > maximum) throw new InvalidOperationException(description + "大小无效。");
                    byte[] bytes = new byte[(int)stream.Length]; int offset = 0;
                    while (offset < bytes.Length) { int read = stream.Read(bytes, offset, bytes.Length - offset); if (read == 0) throw new EndOfStreamException(); offset += read; }
                    return bytes;
                }
            }
            catch (InvalidOperationException) { throw; }
            catch { throw new InvalidOperationException("无法读取" + description + "，请检查文件是否存在及访问权限。"); }
        }

        private static void AtomicWrite(string filePath, byte[] data)
        {
            string fullPath = Path.GetFullPath(filePath), directory = Path.GetDirectoryName(fullPath);
            string temporary = Path.Combine(directory, ".signing-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                Directory.CreateDirectory(directory);
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { stream.Write(data, 0, data.Length); stream.Flush(true); }
                if (File.Exists(fullPath)) File.Replace(temporary, fullPath, null); else File.Move(temporary, fullPath);
            }
            catch { throw new InvalidOperationException("无法保存签名或备份，请检查目标位置及文件占用。已有文件未修改。"); }
            finally { try { if (File.Exists(temporary)) File.Delete(temporary); } catch { } }
        }

        internal sealed class Payload
        {
            public int schemaVersion { get; set; }
            public string storeBase64 { get; set; }
            public string storeExtension { get; set; }
            public string storePassword { get; set; }
            public string keyAlias { get; set; }
            public string keyPassword { get; set; }
            public string certificateSha256 { get; set; }
            public string importedAtUtc { get; set; }
        }
    }
}
