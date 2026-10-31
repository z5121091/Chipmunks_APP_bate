using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Chipmunks.ApkBuilder
{
    public sealed class BuildWindow : Form
    {
        private static readonly Color Navy = Color.FromArgb(25, 59, 96);
        private static readonly Color Ink = Color.FromArgb(16, 35, 59);
        private static readonly Color Muted = Color.FromArgb(114, 131, 154);
        private static readonly Color Border = Color.FromArgb(215, 224, 234);
        private static readonly Color Page = Color.FromArgb(238, 243, 248);
        private static readonly Color Good = Color.FromArgb(32, 133, 108);
        private static readonly Color Bad = Color.FromArgb(190, 63, 63);
        private readonly string repository;
        private readonly BuildRunner runner;
        private readonly bool enableTray;
        private readonly System.Windows.Forms.Timer refreshTimer;
        private readonly NotifyIcon tray;
        private readonly Label stateTitle = new Label();
        private readonly Label stateDetail = new Label();
        private readonly Label activity = new Label();
        private readonly Label resultText = new Label();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly Label[] stageLabels = new Label[6];
        private readonly TableLayoutPanel stages;
        private readonly ComboBox targetSelector;
        private readonly Label versionLabel;
        private readonly Button signingButton;
        private readonly RichTextBox logBox = new RichTextBox();
        private readonly CheckBox followLog = new CheckBox();
        private readonly Button startButton;
        private readonly Button checkButton;
        private readonly Button prepareButton;
        private readonly Button cancelButton;
        private readonly Button apkButton;
        private readonly Button logButton;
        private readonly Button errorButton;
        private BuildTarget selectedTarget;
        private bool busy;
        private bool exitAfterTask;
        private bool disposing;
        private bool background;
        private string currentLog;
        private string currentApk;
        private string errorSummary;
        private Task currentTask;
        private BuildState shownState = BuildState.Idle;
        private int shownStage = -1;
        private long shownDropped;

        public Action<IWin32Window> ManageSigningRequested { get; set; }

        public BuildWindow(string repositoryPath, BuildRunner buildRunner, bool enableTray = true)
        {
            if (buildRunner == null) throw new ArgumentNullException("buildRunner");
            repository = Path.GetFullPath(repositoryPath);
            runner = buildRunner;
            this.enableTray = enableTray;
            Text = "掌上仓库构建工具";
            Name = "WarehouseBuildWindow";
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            Font = new Font("Microsoft YaHei UI", 9F);
            ClientSize = new Size(960, 760);
            MinimumSize = new Size(830, 690);
            BackColor = Page;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { Icon = SystemIcons.Application; }

            // Size the parent before anchoring children; a default 200px panel would
            // add its later growth to the right-anchored signing button position.
            var header = new Panel { Dock = DockStyle.Top, Width = ClientSize.Width, Height = 103, BackColor = Navy };
            var title = MakeLabel("掌上仓库构建工具", 21F, Color.White, true);
            title.Dock = DockStyle.None;
            title.SetBounds(24, 17, 620, 37);
            title.Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Right;
            targetSelector = new ComboBox { Name = "buildTarget", DropDownStyle = ComboBoxStyle.DropDownList,
                Left = 26, Top = 62, Width = 236, Height = 28, BackColor = Color.White, ForeColor = Ink,
                DrawMode = DrawMode.OwnerDrawFixed, ItemHeight = 24, AccessibleName = "构建目标" };
            targetSelector.Items.AddRange(new object[] { "APK（Android）", "同步助手（Windows EXE）" });
            targetSelector.DrawItem += delegate(object sender, DrawItemEventArgs e) {
                e.DrawBackground();
                string text = e.Index >= 0 ? Convert.ToString(targetSelector.Items[e.Index]) : Convert.ToString(targetSelector.SelectedItem);
                TextRenderer.DrawText(e.Graphics, text, e.Font, new Rectangle(e.Bounds.Left + 5, e.Bounds.Top, Math.Max(0, e.Bounds.Width - 10), e.Bounds.Height),
                    (e.State & DrawItemState.Selected) != 0 ? SystemColors.HighlightText : Ink, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                e.DrawFocusRectangle();
            };
            targetSelector.SelectedIndex = 0;
            targetSelector.SelectedIndexChanged += delegate { ChangeTarget(); };
            versionLabel = MakeLabel(ReadVersion(BuildTarget.Apk), 9F, Color.FromArgb(209, 223, 238), false);
            versionLabel.Dock = DockStyle.None;
            versionLabel.SetBounds(278, 63, 650, 24);
            versionLabel.AutoEllipsis = true;
            versionLabel.Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Right;
            signingButton = MakeButton("APK 发布签名…", "manageSigning", false, 156);
            signingButton.SetBounds(778, 18, 156, 35);
            signingButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            signingButton.Click += delegate { var handler = ManageSigningRequested; if (!busy && handler != null) handler(this); };
            header.Controls.Add(title);
            header.Controls.Add(versionLabel);
            header.Controls.Add(targetSelector);
            header.Controls.Add(signingButton);

            var body = new TableLayoutPanel {
                Dock = DockStyle.Fill, Padding = new Padding(20, 16, 20, 16),
                ColumnCount = 1, RowCount = 6, BackColor = Page
            };
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 118));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));
            body.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));

            var status = new CardPanel { Dock = DockStyle.Fill, Padding = new Padding(16, 12, 16, 10), Margin = new Padding(0) };
            var statusGrid = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 4, ColumnCount = 1, BackColor = Color.White };
            statusGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            statusGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 31));
            statusGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 25));
            statusGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
            statusGrid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            ConfigureLabel(stateTitle, "准备就绪", 16F, Ink, true);
            ConfigureLabel(stateDetail, "点击开始构建。切换窗口或最小化后，任务会继续运行。", 9F, Muted, false);
            ConfigureLabel(activity, "项目：" + repository, 8.5F, Muted, false);
            progress.Dock = DockStyle.Fill;
            progress.Height = 5;
            progress.Margin = new Padding(0, 3, 0, 0);
            progress.Style = ProgressBarStyle.Blocks;
            statusGrid.Controls.Add(stateTitle, 0, 0);
            statusGrid.Controls.Add(stateDetail, 0, 1);
            statusGrid.Controls.Add(activity, 0, 2);
            statusGrid.Controls.Add(progress, 0, 3);
            status.Controls.Add(statusGrid);
            body.Controls.Add(status, 0, 0);

            stages = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 6, RowCount = 1, Margin = new Padding(0, 8, 0, 0) };
            var stageNames = new[] { "环境检查", "同步源码", "准备依赖", "编译 APK", "验证安装包", "保存产物" };
            for (int i = 0; i < stageNames.Length; i++) {
                stages.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F / 6));
                stageLabels[i] = MakeLabel((i + 1) + "  " + stageNames[i], 9F, Muted, false);
                stageLabels[i].Dock = DockStyle.Fill;
                stageLabels[i].TextAlign = ContentAlignment.MiddleCenter;
                stageLabels[i].Margin = new Padding(i == 0 ? 0 : 3, 0, i == 5 ? 0 : 3, 0);
                stages.Controls.Add(stageLabels[i], i, 0);
            }
            body.Controls.Add(stages, 0, 1);

            var commands = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Margin = new Padding(0, 8, 0, 5) };
            startButton = MakeButton("开始构建", "startBuild", true, 126);
            checkButton = MakeButton("检查环境", "checkEnvironment", false, 114);
            prepareButton = MakeButton("准备环境…", "prepareEnvironment", false, 128);
            cancelButton = MakeButton("停止任务", "cancelBuild", false, 112);
            cancelButton.Enabled = false;
            commands.Controls.AddRange(new Control[] { startButton, checkButton, prepareButton, cancelButton });
            startButton.Click += delegate { StartTask(BuildMode.Build, false); };
            checkButton.Click += delegate { StartTask(BuildMode.CheckEnvironment, false); };
            prepareButton.Click += delegate { StartTask(BuildMode.PrepareEnvironment, true); };
            cancelButton.Click += delegate { StopTask(); };
            body.Controls.Add(commands, 0, 2);

            var logCard = new CardPanel { Dock = DockStyle.Fill, Padding = new Padding(12), Margin = new Padding(0, 3, 0, 5) };
            var logHeader = new Panel { Dock = DockStyle.Top, Height = 33, BackColor = Color.White };
            var logTitle = MakeLabel("构建日志", 10F, Ink, true);
            logTitle.Dock = DockStyle.Left;
            logTitle.Width = 150;
            followLog.Text = "自动滚动";
            followLog.Checked = true;
            followLog.Dock = DockStyle.Right;
            followLog.Width = 110;
            followLog.ForeColor = Muted;
            logHeader.Controls.Add(followLog);
            logHeader.Controls.Add(logTitle);
            logBox.Name = "buildLog";
            logBox.Dock = DockStyle.Fill;
            logBox.BackColor = Color.White;
            logBox.ForeColor = Ink;
            logBox.BorderStyle = BorderStyle.None;
            logBox.ReadOnly = true;
            logBox.DetectUrls = false;
            logBox.WordWrap = false;
            logBox.Font = new Font("Consolas", 9F);
            logBox.Text = "等待开始。完整日志会自动保存，选择或复制这里的文字不会暂停后台构建。\n";
            var logMenu = new ContextMenuStrip();
            logMenu.Items.Add("复制选中内容", null, delegate { if (logBox.SelectionLength > 0) TryCopy(logBox.SelectedText); });
            logMenu.Items.Add("全选", null, delegate { logBox.SelectAll(); });
            logBox.ContextMenuStrip = logMenu;
            logCard.Controls.Add(logBox);
            logCard.Controls.Add(logHeader);
            body.Controls.Add(logCard, 0, 3);

            var fileActions = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Margin = new Padding(0, 4, 0, 4) };
            apkButton = MakeButton("打开 APK 文件夹", "openApk", false, 158);
            logButton = MakeButton("查看完整日志", "openLog", false, 140);
            errorButton = MakeButton("复制错误摘要", "copyError", false, 140);
            apkButton.Enabled = false;
            logButton.Enabled = false;
            errorButton.Enabled = false;
            fileActions.Controls.AddRange(new Control[] { apkButton, logButton, errorButton });
            apkButton.Click += delegate { OpenPath(currentApk, true); };
            logButton.Click += delegate { OpenPath(currentLog, false); };
            errorButton.Click += delegate { TryCopy(errorSummary); };
            body.Controls.Add(fileActions, 0, 4);
            ConfigureLabel(resultText, "请选择构建目标。APK 发布签名可在右上方管理、加密备份或恢复。", 8.5F, Muted, false);
            resultText.Name = "buildResult";
            resultText.Dock = DockStyle.Fill;
            resultText.AutoEllipsis = true;
            body.Controls.Add(resultText, 0, 5);
            Controls.Add(body);
            Controls.Add(header);

            tray = new NotifyIcon { Icon = Icon, Text = "掌上仓库构建工具", Visible = false };
            var trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("打开构建窗口", null, delegate { RestoreWindow(); });
            trayMenu.Items.Add("查看本次日志", null, delegate { OpenPath(currentLog, false); });
            trayMenu.Items.Add("退出", null, delegate { Close(); });
            tray.ContextMenuStrip = trayMenu;
            tray.DoubleClick += delegate { RestoreWindow(); };
            tray.BalloonTipClicked += delegate { RestoreWindow(); };
            refreshTimer = new System.Windows.Forms.Timer { Interval = 180 };
            refreshTimer.Tick += delegate { RefreshProgress(); };
            refreshTimer.Start();
            FormClosing += OnClosing;
        }

        public void RestoreWindow()
        {
            if (IsDisposed || disposing) return;
            background = false;
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
            BringToFront();
            tray.Visible = false;
        }

        internal bool TaskRunning { get { return busy; } }
        internal Task RunningTask { get { return currentTask ?? Task.FromResult(0); } }
        internal string StatusTitle { get { return stateTitle.Text; } }
        internal string StatusDetail { get { return stateDetail.Text; } }
        internal string DisplayedLog { get { return logBox.Text; } }
        internal string DisplayedApk { get { return currentApk; } }
        internal string DisplayedArtifact { get { return currentApk; } }
        internal BuildTarget SelectedTarget { get { return selectedTarget; } }
        internal bool IsInBackground { get { return background; } }

        internal void StartForTest(BuildMode mode) { StartTask(mode, false); }
        internal void TickForTest() { RefreshProgress(); }
        internal bool SelectTargetForTest(BuildTarget target)
        {
            if (busy || runner.IsRunning) return false;
            targetSelector.SelectedIndex = target == BuildTarget.Apk ? 0 : 1;
            return true;
        }

        private void ChangeTarget()
        {
            if (busy || runner.IsRunning) { targetSelector.SelectedIndex = selectedTarget == BuildTarget.Apk ? 0 : 1; return; }
            selectedTarget = targetSelector.SelectedIndex == 1 ? BuildTarget.SyncHelper : BuildTarget.Apk;
            currentApk = currentLog = errorSummary = null;
            shownStage = -1;
            shownState = BuildState.Idle;
            shownDropped = 0;
            logBox.Clear();
            stateTitle.Text = "准备就绪";
            stateTitle.ForeColor = Ink;
            stateDetail.Text = "已选择" + TargetName + "，点击开始构建。";
            activity.Text = "项目：" + repository;
            resultText.Text = "仅显示当前目标的本次结果；构建期间不能切换目标。";
            progress.Value = 0;
            versionLabel.Text = ReadVersion(selectedTarget);
            apkButton.Text = selectedTarget == BuildTarget.Apk ? "打开 APK 文件夹" : "打开 EXE 文件夹";
            var names = selectedTarget == BuildTarget.Apk
                ? new[] { "环境检查", "同步源码", "准备依赖", "编译 APK", "验证安装包", "保存产物" }
                : new[] { "环境检查", "准备依赖", "检查源码", "构建 EXE", "验证并保存", "" };
            for (int i = 0; i < stageLabels.Length; i++) {
                stageLabels[i].Text = (i + 1) + "  " + names[i];
                stageLabels[i].Visible = i < StageCount;
                stages.ColumnStyles[i].Width = i < StageCount ? 100F / StageCount : 0;
                stageLabels[i].ForeColor = Muted;
                stageLabels[i].BackColor = Color.Transparent;
            }
            SetCommands();
        }

        private string TargetName { get { return selectedTarget == BuildTarget.Apk ? "APK" : "同步助手 EXE"; } }
        private int StageCount { get { return selectedTarget == BuildTarget.Apk ? 6 : 5; } }

        private void StartTask(BuildMode mode, bool interactive)
        {
            if (busy || runner.IsRunning || disposing) return;
            busy = true;
            exitAfterTask = false;
            currentApk = null;
            errorSummary = null;
            currentLog = null;
            shownDropped = 0;
            shownStage = -1;
            shownState = BuildState.Idle;
            logBox.Clear();
            stateTitle.ForeColor = Ink;
            stateTitle.Text = mode == BuildMode.Build ? "正在启动构建" : interactive ? "正在打开环境准备窗口" : "正在检查环境";
            stateDetail.Text = interactive ? "请在新打开的窗口中查看并处理环境提示，完成后这里会更新结果。" : "任务已在后台运行，可以继续使用其他窗口。";
            resultText.Text = "本次任务的日志会自动保存。";
            progress.Style = ProgressBarStyle.Marquee;
            progress.MarqueeAnimationSpeed = 35;
            SetCommands();
            currentTask = RunTaskAsync(mode, interactive);
        }

        private async Task RunTaskAsync(BuildMode mode, bool interactive)
        {
            BuildResult result;
            try {
                result = interactive ? await runner.StartInteractivePreparationAsync(selectedTarget) : await runner.StartAsync(mode, selectedTarget);
            } catch (Exception error) {
                result = new BuildResult {
                    State = BuildState.Failed, ExitCode = -1,
                    ErrorMessage = BuildRunner.ProtectOutput(error.Message)
                };
            }
            if (disposing || IsDisposed) return;
            RefreshProgress();
            busy = false;
            progress.MarqueeAnimationSpeed = 0;
            progress.Style = ProgressBarStyle.Blocks;
            progress.Value = result.State == BuildState.Succeeded ? 100 : 0;
            currentLog = result.LogPath ?? currentLog;
            currentApk = result.State == BuildState.Succeeded && mode == BuildMode.Build ? result.ArtifactPath : null;
            switch (result.State) {
                case BuildState.Succeeded:
                    stateTitle.Text = mode == BuildMode.Build ? "构建成功" : mode == BuildMode.PrepareEnvironment ? "环境准备完成" : "环境检查通过";
                    stateTitle.ForeColor = Good;
                    stateDetail.Text = mode == BuildMode.Build ? "本次" + TargetName + "已完成构建及校验，可以打开文件夹查看。" : "可以开始构建" + TargetName + "。";
                    resultText.Text = currentApk ?? "环境就绪，返回主窗口后可开始构建。";
                    PaintStages(mode == BuildMode.Build ? StageCount - 1 : 0, true);
                    break;
                case BuildState.NeedsAttention:
                    stateTitle.Text = "需要先准备环境";
                    stateTitle.ForeColor = Color.FromArgb(165, 105, 25);
                    stateDetail.Text = "点击“准备环境…”，在可见窗口中处理提示，完成后再开始构建。";
                    errorSummary = result.ErrorMessage;
                    resultText.Text = "本次未生成可用" + TargetName + "。具体原因可查看完整日志。";
                    break;
                case BuildState.Cancelled:
                    stateTitle.Text = "任务已停止";
                    stateTitle.ForeColor = Muted;
                    stateDetail.Text = "已停止本次任务，可查看日志或重新开始。";
                    resultText.Text = "本次未交付新的" + TargetName + "。";
                    break;
                default:
                    stateTitle.Text = "任务未完成";
                    stateTitle.ForeColor = Bad;
                    errorSummary = BuildRunner.ProtectOutput(result.ErrorMessage ?? "构建失败，请查看完整日志。");
                    stateDetail.Text = FirstLine(errorSummary);
                    resultText.Text = "本次未生成可用" + TargetName + "。点击“查看完整日志”了解具体原因。";
                    break;
            }
            SetCommands();
            if (background && enableTray) {
                tray.BalloonTipTitle = stateTitle.Text;
                tray.BalloonTipText = mode == BuildMode.Build && currentApk != null ? "点击返回窗口查看安装包。" : stateDetail.Text;
                tray.ShowBalloonTip(5000);
            }
            if (exitAfterTask) { exitAfterTask = false; Close(); }
        }

        private void RefreshProgress()
        {
            if (disposing || IsDisposed) return;
            var snapshot = runner.GetSnapshot();
            if (snapshot != null) {
                currentLog = snapshot.LogPath ?? currentLog;
                if (busy) {
                    if (snapshot.Stage != shownStage || snapshot.State != shownState) {
                        shownStage = snapshot.Stage;
                        shownState = snapshot.State;
                        PaintStages(snapshot.Stage, false);
                        if (snapshot.State == BuildState.Running) {
                            stateTitle.Text = snapshot.Mode == BuildMode.Build ? "正在构建" + TargetName : snapshot.Mode == BuildMode.CheckEnvironment ? "正在检查环境" : "正在准备环境";
                            if (snapshot.Mode != BuildMode.PrepareEnvironment) stateDetail.Text = StageDescription(snapshot.Stage);
                        }
                    }
                    var elapsed = DateTime.UtcNow - snapshot.StartedAtUtc;
                    var sinceOutput = DateTime.UtcNow - snapshot.LastOutputAtUtc;
                    activity.Text = "已用时 " + FormatDuration(elapsed) + (snapshot.Mode == BuildMode.PrepareEnvironment
                        ? "   ·   请查看环境准备窗口"
                        : sinceOutput.TotalSeconds >= 20 ? "   ·   当前阶段暂未输出新日志，任务仍在运行" : "   ·   日志持续保存中");
                }
                if (snapshot.DroppedDisplayLines > shownDropped) {
                    AppendLog("[显示提示] 较早的日志已省略，完整内容仍保存在日志文件。\n");
                    shownDropped = snapshot.DroppedDisplayLines;
                }
            }
            var lines = runner.DrainLines(250);
            if (lines.Length > 0) AppendLog(String.Join(Environment.NewLine, lines) + Environment.NewLine);
            logButton.Enabled = !String.IsNullOrEmpty(currentLog) && File.Exists(currentLog);
        }

        private void AppendLog(string text)
        {
            int oldStart = logBox.SelectionStart;
            int oldLength = logBox.SelectionLength;
            logBox.AppendText(text);
            if (logBox.TextLength > 180000) {
                int remove = logBox.TextLength - 140000;
                logBox.Select(0, remove);
                logBox.SelectedText = "";
                oldStart = Math.Max(0, oldStart - remove);
            }
            if (followLog.Checked && oldLength == 0) {
                logBox.Select(logBox.TextLength, 0);
                logBox.ScrollToCaret();
            } else {
                logBox.Select(Math.Min(oldStart, logBox.TextLength), Math.Min(oldLength, Math.Max(0, logBox.TextLength - oldStart)));
            }
        }

        private void PaintStages(int stage, bool success)
        {
            for (int i = 0; i < stageLabels.Length; i++) {
                stageLabels[i].ForeColor = i < stage || (success && i == stage) ? Good : i == stage ? Navy : Muted;
                stageLabels[i].BackColor = i == stage && busy ? Color.FromArgb(218, 230, 243) : Color.Transparent;
            }
        }

        private void SetCommands()
        {
            startButton.Enabled = checkButton.Enabled = prepareButton.Enabled = targetSelector.Enabled = signingButton.Enabled = !busy;
            cancelButton.Enabled = busy;
            apkButton.Enabled = !busy && !String.IsNullOrEmpty(currentApk) && File.Exists(currentApk);
            errorButton.Enabled = !busy && !String.IsNullOrEmpty(errorSummary);
            logButton.Enabled = !String.IsNullOrEmpty(currentLog) && File.Exists(currentLog);
        }

        internal void StopTask()
        {
            if (!busy) return;
            cancelButton.Enabled = false;
            stateTitle.Text = "正在停止任务";
            stateDetail.Text = "正在结束本次构建及其子任务，请稍候。";
            runner.Cancel();
        }

        internal void ContinueInBackground()
        {
            if (!busy) return;
            background = true;
            if (enableTray) {
                tray.Visible = true;
                tray.BalloonTipTitle = "构建继续运行";
                tray.BalloonTipText = "双击托盘图标，或再次打开构建工具，即可查看同一个任务。";
                tray.ShowBalloonTip(4000);
            }
            Hide();
        }

        private void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (disposing || !busy) return;
            if (e.CloseReason == CloseReason.WindowsShutDown || e.CloseReason == CloseReason.TaskManagerClosing) {
                runner.Cancel();
                return;
            }
            e.Cancel = true;
            using (var choice = new CloseTaskDialog()) {
                var decision = choice.ShowDialog(this);
                e.Cancel = !ApplyCloseDecision(decision);
            }
        }

        internal bool ApplyCloseDecision(DialogResult decision)
        {
            if (decision != DialogResult.Yes && decision != DialogResult.No) return false;
            // ShowDialog pumps messages: the build may finish while this choice is open.
            if (!busy) return true;
            if (decision == DialogResult.Yes) ContinueInBackground();
            else { exitAfterTask = true; StopTask(); }
            return false;
        }

        private void OpenPath(string path, bool selectFile)
        {
            if (String.IsNullOrEmpty(path) || !File.Exists(path)) { ShowError("文件尚未生成，或已经被移动。请先查看本次任务状态。"); return; }
            try {
                if (selectFile) Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + path + "\"") { UseShellExecute = true });
                else Process.Start(new ProcessStartInfo("notepad.exe", "\"" + path + "\"") { UseShellExecute = true });
            } catch (Exception error) { ShowError(error.Message); }
        }

        private void TryCopy(string text)
        {
            if (String.IsNullOrEmpty(text)) return;
            try { Clipboard.SetText(BuildRunner.ProtectOutput(text)); }
            catch { ShowError("剪贴板正被其他程序占用，请稍后再试。"); }
        }

        private void ShowError(string message)
        {
            MessageBox.Show(this, BuildRunner.ProtectOutput(message), "掌上仓库构建工具", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private string ReadVersion(BuildTarget target)
        {
            if (target == BuildTarget.SyncHelper) {
                try {
                    var source = File.ReadAllText(Path.Combine(repository, "scripts", "label_sync_server.py"), Encoding.UTF8);
                    var match = Regex.Match(source, @"(?m)^SYNC_VERSION\s*=\s*['"" ]?([^'""\r\n ]+)");
                    return "桌面同步助手  ·  " + (match.Success ? match.Groups[1].Value : "Windows") + "  ·  Windows EXE";
                } catch { return "桌面同步助手  ·  Windows EXE"; }
            }
            try {
                var json = File.ReadAllText(Path.Combine(repository, "client/version.json"), Encoding.UTF8);
                var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                return Convert.ToString(data["appName"]) + "  ·  " + Convert.ToString(data["version"]) + "  ·  ARM64 发布安装包";
            } catch { return "ARM64 发布安装包"; }
        }

        private static string FirstLine(string text)
        {
            return (text ?? "").Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Length == 0
                ? "请查看完整日志。" : text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)[0];
        }
        private static string FormatDuration(TimeSpan value)
        {
            return ((int)value.TotalHours).ToString("00") + ":" + value.Minutes.ToString("00") + ":" + value.Seconds.ToString("00");
        }
        private string StageDescription(int stage)
        {
            var descriptions = selectedTarget == BuildTarget.SyncHelper ? new[] {
                "检查并准备同步助手构建环境。", "正在准备 Python 打包依赖，已有缓存会自动复用。",
                "正在检查同步助手源码和构建资源。", "正在构建同步助手 EXE，这个阶段可能较久。", "正在验证并保存本次 EXE 与校验结果。"
            } : new[] {
                "检查并准备本机构建环境。",
                "正在同步最新源码到构建缓存。",
                "正在准备项目依赖，已有缓存会自动复用。",
                "正在编译 ARM64 安装包，这个阶段可能较久。",
                "正在检查签名、版本和安装包结构。",
                "正在保存本次安装包与校验结果。"
            };
            return descriptions[Math.Max(0, Math.Min(stage, descriptions.Length - 1))];
        }
        private static Label MakeLabel(string text, float size, Color color, bool bold)
        {
            var label = new Label();
            ConfigureLabel(label, text, size, color, bold);
            return label;
        }
        private static void ConfigureLabel(Label label, string text, float size, Color color, bool bold)
        {
            label.Text = text;
            label.Font = new Font("Microsoft YaHei UI", size, bold ? FontStyle.Bold : FontStyle.Regular);
            label.ForeColor = color;
            label.TextAlign = ContentAlignment.MiddleLeft;
            label.Dock = DockStyle.Fill;
            label.AutoEllipsis = true;
            label.Margin = new Padding(0);
        }
        private static Button MakeButton(string text, string name, bool primary, int width)
        {
            return new Button {
                Name = name, Text = text, Width = width, Height = 38, Margin = new Padding(0, 0, 9, 0),
                FlatStyle = FlatStyle.Flat, BackColor = primary ? Navy : Color.White,
                ForeColor = primary ? Color.White : Ink, Cursor = Cursors.Hand,
                FlatAppearance = { BorderColor = primary ? Navy : Border, BorderSize = 1 }
            };
        }

        protected override void Dispose(bool disposingResources)
        {
            if (disposingResources && !disposing) {
                disposing = true;
                refreshTimer.Stop();
                refreshTimer.Dispose();
                tray.Visible = false;
                tray.Dispose();
            }
            base.Dispose(disposingResources);
        }

        private sealed class CardPanel : Panel
        {
            internal CardPanel() { DoubleBuffered = true; BackColor = Color.White; }
            protected override void OnPaint(PaintEventArgs e)
            {
                base.OnPaint(e);
                using (var pen = new Pen(Border)) e.Graphics.DrawRectangle(pen, 0, 0, Math.Max(0, Width - 1), Math.Max(0, Height - 1));
            }
        }

        private sealed class CloseTaskDialog : Form
        {
            internal CloseTaskDialog()
            {
                Text = "任务正在运行";
                FormBorderStyle = FormBorderStyle.FixedDialog;
                StartPosition = FormStartPosition.CenterParent;
                MaximizeBox = MinimizeBox = false;
                ShowInTaskbar = false;
                Font = new Font("Microsoft YaHei UI", 9F);
                AutoScaleMode = AutoScaleMode.Dpi;
                ClientSize = new Size(482, 156);
                BackColor = Page;
                var message = MakeLabel("本次任务还没有结束。请选择如何处理：", 10F, Ink, true);
                message.Dock = DockStyle.None;
                message.SetBounds(20, 16, 440, 38);
                var buttons = new FlowLayoutPanel { Left = 20, Top = 78, Width = 450, Height = 48, WrapContents = false };
                var background = MakeButton("继续后台运行", "continueBackground", true, 142);
                var stop = MakeButton("停止并退出", "stopAndExit", false, 132);
                var stay = MakeButton("留在窗口", "stayHere", false, 126);
                background.DialogResult = DialogResult.Yes;
                stop.DialogResult = DialogResult.No;
                stay.DialogResult = DialogResult.Cancel;
                CancelButton = stay;
                buttons.Controls.AddRange(new Control[] { background, stop, stay });
                Controls.Add(message);
                Controls.Add(buttons);
            }
        }
    }
}
