using System;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Chipmunks.ApkBuilder
{
    public sealed class OtaConnectionPanel : UserControl
    {
        public bool IsBusy { get; private set; }
        public event Action BusyChanged;
        private readonly Label information = new Label();
        public void RefreshConfigurationStatus()
        {
            information.Text = "热更新发布连接\r\n服务器：erp.chipmunks.fun\r\n通过专用发布凭据连接，无需服务器 root 密码。\r\n状态：" + (File.Exists(TokenPath) ? "本机已配置，留空沿用。" : "尚未配置。");
        }
        static string TokenPath { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChipmunksBuildTools", "ota", "publish-token.bin"); } }
        public OtaConnectionPanel()
        {
            Name = "otaConnectionPanel"; Padding = new Padding(20); Height = 340;
            var info = information; info.Dock = DockStyle.Top; info.Height = 92;
            RefreshConfigurationStatus();
            var field = new TextBox { Name = "otaPublishCredential", Dock = DockStyle.Top, UseSystemPasswordChar = true };
            var description = new Label { Dock = DockStyle.Top, Height = 52, Padding = new Padding(0, 8, 0, 0), Text = "更换凭据时在上方输入；无需修改则保持空白。\r\n保存后使用当前 Windows 用户加密。" };
            var status = new Label { Name = "otaConnectionStatus", Dock = DockStyle.Top, Height = 60 };
            var actions = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 42 };
            var test = new Button { Name = "testOtaConnection", Width = 170, Height = 32, Text = "测试发布连接" };
            var save = new Button { Name = "saveOtaConnection", Width = 140, Height = 32, Text = "保存发布凭据" };
            actions.Controls.AddRange(new Control[] { test, save });
            test.Click += async delegate {
                IsBusy = true; if (BusyChanged != null) BusyChanged(); test.Enabled = save.Enabled = field.Enabled = false; status.Text = "正在核对连接和发布权限…";
                try {
                    string value = field.Text.Trim();
                    if (value.Length == 0) value = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(TokenPath), null, DataProtectionScope.CurrentUser));
                    var result = await Task.Run(() => OtaConnection.Test(value));
                    status.Text = result.Message;
                } catch (FileNotFoundException) { status.Text = "尚未配置发布凭据，请先填写并保存。"; }
                catch (CryptographicException) { status.Text = "无法解密本机凭据，请使用当前 Windows 用户或重新配置。"; }
                catch { status.Text = "连接检查未完成，请检查本机配置和网络。"; }
                finally { IsBusy = false; if (BusyChanged != null) BusyChanged(); test.Enabled = save.Enabled = field.Enabled = true; }
            };
            save.Click += delegate {
                try {
                    if (String.IsNullOrWhiteSpace(field.Text)) { status.Text = "已沿用本机配置。"; return; }
                    if (field.Text.Trim().Length < 32) { status.Text = "请输入有效的专用发布凭据。"; return; }
                    Directory.CreateDirectory(Path.GetDirectoryName(TokenPath));
                    byte[] data = ProtectedData.Protect(Encoding.UTF8.GetBytes(field.Text.Trim()), null, DataProtectionScope.CurrentUser);
                    string temp = TokenPath + ".tmp"; File.WriteAllBytes(temp, data);
                    if (File.Exists(TokenPath)) File.Replace(temp, TokenPath, null); else File.Move(temp, TokenPath);
                    field.Clear(); RefreshConfigurationStatus(); status.Text = "发布凭据已加密保存。";
                } catch { status.Text = "保存失败，请检查访问权限。"; }
            };
            Controls.Add(status); Controls.Add(actions); Controls.Add(description); Controls.Add(field); Controls.Add(info);
        }
    }
}
