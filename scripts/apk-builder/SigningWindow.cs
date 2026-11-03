using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Chipmunks.ApkBuilder
{
    public sealed class SigningWindow : Form
    {
        private static readonly Color Navy = Color.FromArgb(25, 59, 96);
        private static readonly Color Ink = Color.FromArgb(16, 35, 59);
        private static readonly Color Muted = Color.FromArgb(114, 131, 154);
        private readonly SigningStore store;
        private readonly Label state = new Label();
        private readonly Label fingerprint = new Label();
        private readonly Label imported = new Label();
        private readonly Label result = new Label();
        private readonly Button fromExisting;
        private readonly Button fromFile;
        private readonly Button export;
        private readonly Button restore;
        private readonly Button done;
        private bool busy;
        private TabControl settingsTabs;
        private OtaConnectionPanel connectionPanel;

        public static void ShowFor(IWin32Window owner, string repositoryPath)
        {
            using (var window = new SigningWindow(repositoryPath)) window.ShowDialog(owner);
        }

        public SigningWindow(string repositoryPath) : this(new SigningStore(repositoryPath)) { }

        internal SigningWindow(SigningStore signingStore)
        {
            if (signingStore == null) throw new ArgumentNullException("signingStore");
            store = signingStore;
            Text = "掌上仓库 · 构建工具设置";
            Name = "SigningWindow";
            StartPosition = FormStartPosition.CenterParent;
            Font = new Font("Microsoft YaHei UI", 9F);
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            ClientSize = new Size(660, 690);
            MinimumSize = new Size(620, 710);
            MaximizeBox = false;
            BackColor = Color.FromArgb(238, 243, 248);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { Icon = SystemIcons.Application; }

            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 6, Padding = new Padding(20) };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 67));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 132));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 102));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 39));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));

            var title = Label("APK 签名与构建配置备份", 18F, Ink, true);
            title.AutoSize = false;
            var titlePanel = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, Margin = new Padding(0) };
            titlePanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 35));
            titlePanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            titlePanel.Controls.Add(title, 0, 0);
            titlePanel.Controls.Add(Label("保持原发布证书，后续 APK 才能覆盖安装。", 9F, Muted, false), 0, 1);
            layout.Controls.Add(titlePanel, 0, 0);

            var card = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, BackColor = Color.White, Padding = new Padding(15, 10, 15, 10), Margin = new Padding(0, 0, 0, 12) };
            card.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
            card.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            card.RowStyles.Add(new RowStyle(SizeType.Absolute, 23));
            Configure(state, 12F, Ink, true);
            Configure(fingerprint, 9F, Muted, false);
            Configure(imported, 8.5F, Muted, false);
            fingerprint.AutoEllipsis = true;
            card.Controls.Add(state, 0, 0); card.Controls.Add(fingerprint, 0, 1); card.Controls.Add(imported, 0, 2);
            layout.Controls.Add(card, 0, 1);

            var buttons = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 2, Margin = new Padding(0) };
            buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50)); buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            buttons.RowStyles.Add(new RowStyle(SizeType.Percent, 50)); buttons.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
            fromExisting = Button("导入原发布签名", false);
            fromFile = Button("选择签名文件", false);
            export = Button("导出构建配置备份", true);
            restore = Button("恢复构建配置备份", false);
            buttons.Controls.Add(fromExisting, 0, 0); buttons.Controls.Add(fromFile, 1, 0); buttons.Controls.Add(export, 0, 1); buttons.Controls.Add(restore, 1, 1);
            layout.Controls.Add(buttons, 0, 2);

            var note = Label("备份包含：APK 发布签名，以及本机已配置的热更新发布连接。\r\n\r\n换电脑：导出一份构建配置备份，在新电脑恢复，输入备份密码即可。无需分别备份。\r\n\r\n请单独保管备份密码，工具无法找回；项目源码和 NAS 配置需另外迁移。\r\n\r\n兼容旧版 .cwsign 签名备份。旧备份不含发布连接时，只恢复签名，保留本机现有连接。", 9F, Muted, false);
            note.Name = "SigningInstructions";
            note.TextAlign = ContentAlignment.TopLeft;
            note.Padding = new Padding(2, 9, 2, 0);
            layout.Controls.Add(note, 0, 3);
            Configure(result, 9F, Navy, false); result.AutoEllipsis = true;
            layout.Controls.Add(result, 0, 4);
            done = Button("完成", true); done.Margin = new Padding(0, 4, 0, 0);
            done.Click += delegate { Close(); };
            layout.Controls.Add(done, 0, 5);
            settingsTabs = new TabControl { Dock = DockStyle.Fill, Name = "apkPublishTabs" };
            var tabs = settingsTabs;
            var signaturePage = new TabPage("APK 发布签名");
            signaturePage.Controls.Add(layout);
            var connectionPage = new TabPage("热更新发布连接");
            connectionPanel = new OtaConnectionPanel { Dock = DockStyle.Top };
            connectionPage.Controls.Add(connectionPanel);
            connectionPanel.BusyChanged += delegate { settingsTabs.Enabled = !connectionPanel.IsBusy; };
            tabs.TabPages.Add(signaturePage); tabs.TabPages.Add(connectionPage);
            Controls.Add(tabs);

            fromExisting.Click += async delegate {
                if (MessageBox.Show(this, "将原发布签名导入本机加密存储。原签名文件及原配置均会保留。", "导入发布签名", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
                await Run(delegate { store.ImportExistingConfiguration(); }, "发布签名已导入。建议现在导出一份加密备份。");
            };
            fromFile.Click += async delegate {
                using (var picker = new OpenFileDialog { Title = "选择原发布签名", Filter = "PKCS#12 签名 (*.p12;*.pfx)|*.p12;*.pfx", CheckFileExists = true, Multiselect = false })
                {
                    if (picker.ShowDialog(this) != DialogResult.OK) return;
                    using (var prompt = new SigningSecretWindow(SigningSecretMode.KeyFile))
                    {
                        if (prompt.ShowDialog(this) != DialogResult.OK) return;
                        string password = prompt.Secret, alias = prompt.KeyAlias;
                        try { await Run(delegate { store.ImportPkcs12(picker.FileName, password, alias, password); }, "发布签名已导入。建议导出加密备份。"); }
                        finally { password = null; prompt.ClearSecrets(); }
                    }
                }
            };
            export.Click += async delegate {
                using (var picker = new SaveFileDialog { Title = "保存构建配置备份", Filter = "加密构建配置备份 (*.cwbuild)|*.cwbuild", DefaultExt = "cwbuild", AddExtension = true, OverwritePrompt = true, FileName = "掌上仓库-构建配置-" + DateTime.Now.ToString("yyyyMMdd", CultureInfo.InvariantCulture) + ".cwbuild" })
                {
                    if (picker.ShowDialog(this) != DialogResult.OK) return;
                    using (var prompt = new SigningSecretWindow(SigningSecretMode.BackupExport))
                    {
                        if (prompt.ShowDialog(this) != DialogResult.OK) return;
                        string password = prompt.Secret;
                        try { await Run(delegate { store.ExportBackup(picker.FileName, password); }, "构建配置备份已保存。请单独保管备份密码。"); }
                        finally { password = null; prompt.ClearSecrets(); }
                    }
                }
            };
            restore.Click += async delegate {
                using (var picker = new OpenFileDialog { Title = "选择构建配置备份", Filter = "构建配置及旧签名备份 (*.cwbuild;*.cwsign)|*.cwbuild;*.cwsign|所有文件 (*.*)|*.*", CheckFileExists = true, Multiselect = false })
                {
                    if (picker.ShowDialog(this) != DialogResult.OK) return;
                    using (var prompt = new SigningSecretWindow(SigningSecretMode.BackupRestore))
                    {
                        if (prompt.ShowDialog(this) != DialogResult.OK) return;
                        string password = prompt.Secret;
                        try
                        {
                            bool confirmed = false;
                            await Run(async delegate {
                                SigningStatus preview = await Task.Run(delegate { return store.InspectBackup(picker.FileName, password); });
                                if (preview.NeedsIdentityConfirmation)
                                {
                                    confirmed = MessageBox.Show(this, "本机旧签名已损坏，且无法从原配置核对证书。\r\n\r\n备份证书 SHA256：\r\n" + preview.CertificateSha256 + "\r\n\r\n请确认这是原发布签名。恢复将替换损坏的本机加密文件。", "确认恢复发布签名", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) == DialogResult.OK;
                                    if (!confirmed) return false;
                                }
                                await Task.Run(delegate { store.RestoreBackup(picker.FileName, password, confirmed); });
                                return true;
                            }, "构建配置已恢复，签名和备份内的发布连接已使用当前 Windows 用户加密。");
                        }
                        finally { password = null; prompt.ClearSecrets(); }
                    }
                }
            };
            FormClosing += delegate(object sender, FormClosingEventArgs e) { if (busy || connectionPanel.IsBusy) e.Cancel = true; };
            RefreshStatus();
        }

        private async Task Run(Action operation, string success)
        {
            await Run(async delegate { await Task.Run(operation); return true; }, success);
        }

        private async Task Run(Func<Task<bool>> operation, string success)
        {
            if (busy) return;
            busy = true;
            settingsTabs.Enabled = false;
            fromExisting.Enabled = fromFile.Enabled = export.Enabled = restore.Enabled = done.Enabled = false;
            UseWaitCursor = true;
            result.Text = "正在校验并处理，请稍候…";
            try { bool completed = await operation(); result.ForeColor = Navy; result.Text = completed ? success : "已取消，现有签名未修改。"; }
            catch (Exception ex)
            {
                result.ForeColor = Color.FromArgb(190, 63, 63);
                result.Text = "操作未完成，现有签名未修改。";
                // SigningStore's public failures contain fixed descriptions, never raw crypto or file content.
                MessageBox.Show(this, ex is InvalidOperationException ? ex.Message : "操作未完成，请检查文件与访问权限。现有签名未修改。", "签名处理失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally { busy = false; settingsTabs.Enabled = true; UseWaitCursor = false; fromExisting.Enabled = fromFile.Enabled = restore.Enabled = done.Enabled = true; RefreshStatus(); }
        }

        private void RefreshStatus()
        {
            if (connectionPanel != null) connectionPanel.RefreshConfigurationStatus();
            SigningStatus status = store.GetStatus();
            state.Text = status.IsConfigured ? "已启用本机签名管理" : String.IsNullOrEmpty(status.ErrorMessage) ? "尚未导入发布签名" : "本机签名需要恢复";
            fingerprint.Text = status.IsConfigured ? "证书 SHA256：\r\n" + status.CertificateSha256 : status.ErrorMessage ?? "导入现有发布签名后，构建时会自动使用。";
            imported.Text = "";
            DateTimeOffset date;
            if (status.IsConfigured && DateTimeOffset.TryParse(status.ImportedAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.None, out date)) imported.Text = "首次导入：" + date.ToLocalTime().ToString("yyyy/MM/dd HH:mm", CultureInfo.InvariantCulture);
            export.Enabled = status.IsConfigured && !busy;
            if (status.IsConfigured) imported.Text += status.HasPublishConnection ? " · 备份将包含发布连接" : " · 尚未配置发布连接";
        }

        private static Label Label(string text, float size, Color color, bool bold) { var label = new Label { Text = text }; Configure(label, size, color, bold); return label; }
        private static void Configure(Label label, float size, Color color, bool bold) { label.Dock = DockStyle.Fill; label.Margin = new Padding(0); label.ForeColor = color; label.Font = new Font("Microsoft YaHei UI", size, bold ? FontStyle.Bold : FontStyle.Regular); label.TextAlign = ContentAlignment.MiddleLeft; }
        private static Button Button(string text, bool primary)
        {
            var button = new Button { Text = text, Dock = DockStyle.Fill, FlatStyle = FlatStyle.Flat, BackColor = primary ? Navy : Color.White, ForeColor = primary ? Color.White : Navy, Margin = new Padding(0, 0, 10, 8), Cursor = Cursors.Hand, UseVisualStyleBackColor = false };
            button.FlatAppearance.BorderColor = Color.FromArgb(215, 224, 234); button.FlatAppearance.BorderSize = primary ? 0 : 1;
            return button;
        }

        internal enum SigningSecretMode { BackupExport, BackupRestore, KeyFile }

        internal sealed class SigningSecretWindow : Form
        {
            private readonly TextBox secret = new TextBox();
            private readonly TextBox second = new TextBox();
            private readonly Label error = new Label();
            internal string Secret { get { return secret.Text; } }
            internal string KeyAlias { get { return second.Text.Trim(); } }
            internal bool PasswordMasked { get { return secret.UseSystemPasswordChar; } }
            internal SigningSecretWindow(SigningSecretMode mode)
            {
                Text = mode == SigningSecretMode.KeyFile ? "导入 PKCS#12 签名" : mode == SigningSecretMode.BackupExport ? "设置备份密码" : "输入备份密码";
                Name = "SigningSecretWindow"; StartPosition = FormStartPosition.CenterParent; FormBorderStyle = FormBorderStyle.FixedDialog;
                try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { Icon = SystemIcons.Application; }
                MaximizeBox = MinimizeBox = false; Font = new Font("Microsoft YaHei UI", 9F); ClientSize = new Size(465, mode == SigningSecretMode.BackupRestore ? 223 : 295);
                BackColor = Color.White; AutoScaleMode = AutoScaleMode.Dpi; AutoScaleDimensions = new SizeF(96F, 96F);
                var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(20), RowCount = mode == SigningSecretMode.BackupRestore ? 5 : 7 };
                layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
                layout.Controls.Add(Label(mode == SigningSecretMode.KeyFile ? "请输入原签名密码与密钥别名。不会创建新证书。" : "至少 8 个字符。请牢记密码，工具无法找回。", 9F, Muted, false));
                layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
                layout.Controls.Add(Label(mode == SigningSecretMode.KeyFile ? "签名密码" : "备份密码", 9F, Ink, false)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 25));
                secret.UseSystemPasswordChar = true; secret.MaxLength = mode == SigningSecretMode.KeyFile ? 1024 : 256; secret.Dock = DockStyle.Fill; layout.Controls.Add(secret); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
                if (mode != SigningSecretMode.BackupRestore)
                {
                    layout.Controls.Add(Label(mode == SigningSecretMode.KeyFile ? "密钥别名（与原配置一致）" : "再次输入密码", 9F, Ink, false)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 25));
                    second.UseSystemPasswordChar = mode == SigningSecretMode.BackupExport; second.MaxLength = mode == SigningSecretMode.KeyFile ? 200 : 256; second.Dock = DockStyle.Fill;
                    layout.Controls.Add(second); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
                }
                Configure(error, 8.5F, Color.FromArgb(190, 63, 63), false); layout.Controls.Add(error); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                var actions = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = new Padding(0) };
                actions.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50)); actions.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                var cancel = Button("取消", false); cancel.DialogResult = DialogResult.Cancel;
                var ok = Button("确定", true);
                actions.Controls.Add(cancel, 0, 0); actions.Controls.Add(ok, 1, 0); layout.Controls.Add(actions); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
                ok.Click += delegate {
                    if (mode == SigningSecretMode.KeyFile)
                    {
                        if (String.IsNullOrWhiteSpace(secret.Text)) { error.Text = "请输入原签名密码。"; return; }
                        if (String.IsNullOrWhiteSpace(second.Text)) { error.Text = "请输入原发布密钥的别名。"; return; }
                    }
                    else
                    {
                        if (secret.Text.Length < 8) { error.Text = "备份密码至少需要 8 个字符。"; return; }
                        if (mode == SigningSecretMode.BackupExport && secret.Text != second.Text) { error.Text = "两次输入的备份密码不一致。"; return; }
                    }
                    DialogResult = DialogResult.OK;
                };
                CancelButton = cancel; AcceptButton = ok; Controls.Add(layout);
                Shown += delegate { secret.Focus(); };
            }
            internal void ClearSecrets() { secret.Clear(); second.Clear(); }
            protected override void Dispose(bool disposing) { if (disposing) ClearSecrets(); base.Dispose(disposing); }
        }
    }
}
