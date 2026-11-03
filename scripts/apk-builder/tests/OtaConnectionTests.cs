using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Chipmunks.ApkBuilder;

class OtaConnectionTests
{
    static int passed;
    static void Assert(bool value, string name) { if (!value) throw new Exception(name); passed++; Console.WriteLine("PASS: " + name); }
    static void Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Assert(OtaConnection.EvaluateResponse(200, "{\"ok\":true,\"canPublish\":true,\"service\":\"warehouse-ota\"}").Success, "valid permission response");
        Assert(!OtaConnection.EvaluateResponse(200, "<html>proxy</html>").Success, "HTML response is not accepted");
        Assert(!OtaConnection.EvaluateResponse(200, "{\"ok\":true,\"canPublish\":false,\"service\":\"warehouse-ota\"}").Success, "missing publish permission rejected");
        Assert(!OtaConnection.EvaluateResponse(200, "{\"ok\":true,\"canPublish\":true,\"service\":\"other\"}").Success, "wrong service rejected");
        Assert(OtaConnection.EvaluateResponse(401, null).Message.Contains("凭据"), "authentication failure identified");
        Assert(OtaConnection.EvaluateResponse(404, null).Message.Contains("404"), "missing deployment identified");
        Assert(OtaConnection.EvaluateResponse(503, null).Message.Contains("503"), "server failure identified");
        Assert(!OtaConnection.EvaluateResponse(413, null).Success, "upload errors no longer count as connection success");
        Assert(!OtaConnection.EvaluateResponse(302, null).Success, "unexpected redirect rejected");
        if (args.Length > 0 && args[0] == "--live") {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChipmunksBuildTools", "ota", "publish-token.bin");
            var token = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser));
            var result = OtaConnection.Test(token);
            Assert(result.Success, "real .NET EXE TLS and current credential");
            var invalid = OtaConnection.Test("invalid-credential-for-permission-test");
            Assert(!invalid.Success && invalid.Message.Contains("凭据"), "real .NET EXE rejects invalid credential");
        }
        Console.WriteLine("Passed: " + passed);
    }
}
