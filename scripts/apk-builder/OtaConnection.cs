using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Web.Script.Serialization;

namespace Chipmunks.ApkBuilder
{
    public sealed class OtaConnectionResult
    {
        public bool Success { get; private set; }
        public string Message { get; private set; }
        public OtaConnectionResult(bool success, string message) { Success = success; Message = message; }
    }

    public static class OtaConnection
    {
        public const string CheckUrl = "https://erp.chipmunks.fun/app-updates/publish/check";

        public static OtaConnectionResult Test(string token)
        {
            if (String.IsNullOrWhiteSpace(token)) return new OtaConnectionResult(false, "尚未配置发布凭据。");
            // The system C# compiler targets an older framework by default, whose
            // TLS defaults are SSL3/TLS1.0. Require TLS1.2; keep certificate validation.
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            var request = (HttpWebRequest)WebRequest.Create(CheckUrl);
            request.Method = "GET";
            request.AllowAutoRedirect = false;
            request.Timeout = 15000;
            request.ReadWriteTimeout = 15000;
            request.Accept = "application/json";
            request.Headers["Authorization"] = "Bearer " + token.Trim();
            try {
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream()))
                    return EvaluateResponse((int)response.StatusCode, reader.ReadToEnd());
            } catch (WebException error) {
                using (var response = error.Response as HttpWebResponse) {
                    if (response != null) return EvaluateResponse((int)response.StatusCode, null);
                }
                if (error.Status == WebExceptionStatus.Timeout)
                    return new OtaConnectionResult(false, "连接超时，请检查网络后重试。");
                if (error.Status == WebExceptionStatus.SecureChannelFailure || error.Status == WebExceptionStatus.TrustFailure)
                    return new OtaConnectionResult(false, "HTTPS 安全连接失败，请检查系统时间、证书或网络代理。");
                if (error.Status == WebExceptionStatus.NameResolutionFailure || error.Status == WebExceptionStatus.ProxyNameResolutionFailure)
                    return new OtaConnectionResult(false, "无法解析服务器地址，请检查网络或代理设置。");
                return new OtaConnectionResult(false, "无法连接热更新服务器，请检查网络后重试。");
            }
        }

        public static OtaConnectionResult EvaluateResponse(int status, string body)
        {
            if (status == 401) return new OtaConnectionResult(false, "发布凭据不正确或已失效，请核对发布连接设置。");
            if (status == 403) return new OtaConnectionResult(false, "服务器或网络代理拒绝访问（HTTP 403）。");
            if (status == 404) return new OtaConnectionResult(false, "服务器未提供发布权限检查接口（HTTP 404），请检查服务部署。");
            if (status != 200) return new OtaConnectionResult(false, "服务器返回异常状态（HTTP " + status + "），请稍后重试。");
            try {
                var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(body ?? "");
                object ok, service, canPublish;
                if (data != null && data.TryGetValue("ok", out ok) && ok is bool && (bool)ok &&
                    data.TryGetValue("canPublish", out canPublish) && canPublish is bool && (bool)canPublish &&
                    data.TryGetValue("service", out service) && Convert.ToString(service) == "warehouse-ota")
                    return new OtaConnectionResult(true, "连接正常，发布凭据验证通过。");
            } catch (ArgumentException) { }
            catch (InvalidOperationException) { }
            return new OtaConnectionResult(false, "服务器响应内容不正确，请检查服务地址或网络代理。");
        }
    }
}
