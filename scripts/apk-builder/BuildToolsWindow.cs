using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Chipmunks.ApkBuilder
{
    // Infrequent maintenance actions stay out of the main build workflow.
    internal sealed class BuildToolsWindow : Form
    {
        private readonly string repository;
        private readonly string kind;
        private readonly DataGridView grid = new SmoothGrid();
        private readonly TextBox details = new TextBox();
        private readonly Label status = new Label();
        private readonly FlowLayoutPanel actions = new FlowLayoutPanel();
        private bool working;
        private bool deleting;
        private bool sizing;
        private bool refreshingStorage;
        private bool settingSort;
        private string storageSort = "Size";
        private bool sortAscending;
        private readonly CheckBox onlyClean = new CheckBox();
        private readonly ComboBox sortSelector = new ComboBox();
        private readonly HashSet<string> checkedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private List<BuildStorageItem> storageItems = new List<BuildStorageItem>();
        private List<BuildStorageItem> visibleItems = new List<BuildStorageItem>();
        private CancellationTokenSource storageCancellation;
        private int storageGeneration;
        private Button rescanButton, stopSizeButton, deleteButton;
        private Control storageToolbar;
        internal string RetryPackage { get; private set; }

        internal BuildToolsWindow(string repo, string mode)
        {
            repository = repo; kind = mode;
            Text = mode == "storage" ? "存储管理" : mode == "history" ? "最近任务" : "改动与交付建议";
            Font = new Font("Microsoft YaHei UI", 9F);
            BackColor = Color.FromArgb(238, 243, 248);
            StartPosition = FormStartPosition.CenterParent;
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(900, 600); MinimumSize = new Size(720, 480);
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Padding = new Padding(16) };
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, mode == "assessment" ? 0 : 140));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
            status.Dock = DockStyle.Fill; status.TextAlign = ContentAlignment.MiddleLeft;
            status.Text = "正在读取，请稍候…";
            grid.Dock = DockStyle.Fill; grid.BackgroundColor = Color.White; grid.BorderStyle = BorderStyle.None;
            grid.AllowUserToAddRows = grid.AllowUserToDeleteRows = false;
            grid.RowHeadersVisible = false; grid.AutoGenerateColumns = false;
            grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect; grid.MultiSelect = false;
            grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
            grid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(218, 230, 243);
            grid.DefaultCellStyle.SelectionForeColor = Color.FromArgb(16, 35, 59);
            details.Multiline = true; details.ReadOnly = true; details.ScrollBars = ScrollBars.Both;
            details.WordWrap = true; details.Dock = DockStyle.Fill; details.BackColor = Color.White;
            details.BorderStyle = BorderStyle.FixedSingle;
            actions.Dock = DockStyle.Fill; actions.WrapContents = false; actions.Padding = new Padding(0, 6, 0, 0);
            layout.Controls.Add(status, 0, 0);
            Control content = mode == "assessment" ? (Control)details : grid;
            if (mode == "storage") {
                var storagePanel = new Panel { Dock = DockStyle.Fill };
                var toolbar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 36, WrapContents = false };
                storageToolbar = toolbar;
                onlyClean.Name = "onlyClearable"; onlyClean.Text = "只看可清理"; onlyClean.Checked = true;
                onlyClean.Width = 112; onlyClean.Height = 28;
                toolbar.Controls.Add(onlyClean);
                toolbar.Controls.Add(new Label { Text = "排序", Width = 36, Height = 28, TextAlign = ContentAlignment.MiddleLeft });
                sortSelector.Name = "storageSort"; sortSelector.DropDownStyle = ComboBoxStyle.DropDownList;
                sortSelector.Width = 170; sortSelector.Items.AddRange(new object[] { "大小：从大到小", "大小：从小到大", "类型", "路径" });
                sortSelector.SelectedIndex = 0; toolbar.Controls.Add(sortSelector);
                var selectAll = new Button { Name = "selectClearable", Text = "全选可清理", Width = 100, Height = 28, FlatStyle = FlatStyle.Flat, BackColor = Color.White };
                var clearAll = new Button { Name = "clearStorageSelection", Text = "取消选择", Width = 90, Height = 28, FlatStyle = FlatStyle.Flat, BackColor = Color.White };
                selectAll.Click += delegate { foreach (var item in visibleItems.Where(x => x.CanDelete)) checkedPaths.Add(item.Path); grid.Invalidate(); UpdateStorageStatus(); };
                clearAll.Click += delegate { checkedPaths.Clear(); grid.Invalidate(); UpdateStorageStatus(); };
                toolbar.Controls.Add(selectAll); toolbar.Controls.Add(clearAll);
                onlyClean.CheckedChanged += delegate { ApplyStorageView(); };
                sortSelector.SelectedIndexChanged += delegate {
                    if (settingSort) return;
                    storageSort = sortSelector.SelectedIndex == 2 ? "Kind" : sortSelector.SelectedIndex == 3 ? "Path" : "Size";
                    sortAscending = sortSelector.SelectedIndex != 0; ApplyStorageView();
                };
                storagePanel.Controls.Add(grid); storagePanel.Controls.Add(toolbar); content = storagePanel;
            }
            layout.Controls.Add(content, 0, 1);
            if (mode != "assessment") layout.Controls.Add(details, 0, 2);
            layout.Controls.Add(actions, 0, 3); Controls.Add(layout);
            if (mode == "history") {
                Column("时间", "Date", 140); Column("目标 / 任务", "Task", 150); Column("结果", "State", 90);
                Column("更新编号", "UpdateId", 170); Column("大小", "Size", 80);
                Button("打开产物文件夹", delegate { OpenSelected(false); });
                Button("查看日志", delegate { OpenSelected(true); });
                Button("重新上传此热更新", delegate { SelectRetry(); });
                grid.SelectionChanged += delegate { ShowHistoryDetails(); };
            } else if (mode == "storage") {
                grid.Columns.Add(new DataGridViewCheckBoxColumn { HeaderText = "选择", Width = 52, MinimumWidth = 52, FillWeight = 52, Name = "selected" });
                Column("类型", "Kind", 120); Column("路径", "Path", 450); Column("大小", "Size", 90);
                Column("保护状态", "Protection", 140);
                grid.VirtualMode = true;
                grid.CellValueNeeded += StorageCellValue;
                grid.CellValuePushed += delegate(object sender, DataGridViewCellValueEventArgs e) {
                    if (refreshingStorage || e.RowIndex < 0 || e.RowIndex >= visibleItems.Count || e.ColumnIndex != 0) return;
                    var item = visibleItems[e.RowIndex];
                    if (item.CanDelete && Convert.ToBoolean(e.Value)) checkedPaths.Add(item.Path); else checkedPaths.Remove(item.Path);
                    UpdateStorageStatus();
                };
                grid.CellBeginEdit += delegate(object sender, DataGridViewCellCancelEventArgs e) {
                    if (deleting || e.RowIndex < 0 || e.RowIndex >= visibleItems.Count || !visibleItems[e.RowIndex].CanDelete) e.Cancel = true;
                };
                grid.CurrentCellDirtyStateChanged += delegate { if (grid.IsCurrentCellDirty) grid.CommitEdit(DataGridViewDataErrorContexts.Commit); };
                grid.CellToolTipTextNeeded += delegate(object sender, DataGridViewCellToolTipTextNeededEventArgs e) {
                    if (e.RowIndex >= 0 && e.RowIndex < visibleItems.Count) e.ToolTipText = visibleItems[e.RowIndex].Path + "\r\n" + visibleItems[e.RowIndex].Description;
                };
                foreach (string name in new[] { "Kind", "Path", "Size" }) grid.Columns[name].SortMode = DataGridViewColumnSortMode.Programmatic;
                grid.ColumnHeaderMouseClick += delegate(object sender, DataGridViewCellMouseEventArgs e) {
                    if (e.ColumnIndex < 0) return;
                    string name = grid.Columns[e.ColumnIndex].Name;
                    if (name != "Kind" && name != "Path" && name != "Size") return;
                    sortAscending = storageSort == name ? !sortAscending : name != "Size";
                    storageSort = name; settingSort = true;
                    sortSelector.SelectedIndex = name == "Kind" ? 2 : name == "Path" ? 3 : sortAscending ? 1 : 0;
                    settingSort = false; ApplyStorageView();
                };
                rescanButton = Button("重新扫描", async delegate { await LoadContent(); });
                stopSizeButton = Button("停止统计", delegate { if (storageCancellation != null) storageCancellation.Cancel(); });
                stopSizeButton.Enabled = false;
                deleteButton = Button("清理选中项…", async delegate { await DeleteSelected(); });
                grid.SelectionChanged += delegate {
                    var item = Selected<BuildStorageItem>();
                    details.Text = item == null ? "" : item.Path + Environment.NewLine + item.Description;
                };
            }
            Button("关闭", delegate { Close(); });
            Shown += async delegate { await LoadContent(); };
            FormClosing += delegate(object sender, FormClosingEventArgs e) {
                if (deleting || (working && kind != "storage")) e.Cancel = true;
                else if (storageCancellation != null) storageCancellation.Cancel();
            };
        }

        private void Column(string title, string name, int weight)
        {
            grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = title, Name = name, FillWeight = weight, ReadOnly = true, SortMode = DataGridViewColumnSortMode.NotSortable });
        }
        private Button Button(string text, EventHandler handler)
        {
            var button = new Button { Text = text, AutoSize = true, Height = 32, FlatStyle = FlatStyle.Flat, BackColor = Color.White, Margin = new Padding(0, 0, 8, 0) };
            button.FlatAppearance.BorderColor = Color.FromArgb(215, 224, 234); button.Click += handler; actions.Controls.Add(button);
            return button;
        }
        private T Selected<T>() where T : class
        {
            if (kind == "storage") return grid.CurrentRow == null || grid.CurrentRow.Index >= visibleItems.Count ? null : visibleItems[grid.CurrentRow.Index] as T;
            return grid.CurrentRow == null ? null : grid.CurrentRow.Tag as T;
        }
        private async Task LoadContent()
        {
            if (working) return;
            working = true; actions.Enabled = kind == "storage";
            UpdateStorageButtons();
            CancellationTokenSource cancellation = null;
            bool inventoryLoaded = false;
            int generation = storageGeneration;
            if (kind == "storage") {
                if (storageCancellation != null) storageCancellation.Cancel();
                cancellation = new CancellationTokenSource(); storageCancellation = cancellation;
                generation = ++storageGeneration; sizing = false;
                status.Text = "正在读取文件清单，不递归统计目录…";
            }
            try {
                if (kind == "assessment") {
                    string report = await Task.Run(delegate { return ChangeAssessment.Read(repository); });
                    if (IsDisposed || Disposing) return;
                    details.Text = report;
                    status.Text = "根据上次成功交付的源码快照比较；首次使用会建立基线。";
                } else if (kind == "history") {
                    var entries = await Task.Run(delegate { return BuildHistory.Load(repository); });
                    if (IsDisposed || Disposing) return;
                    grid.Rows.Clear();
                    foreach (var entry in entries) {
                        int row = grid.Rows.Add(entry.Date, entry.Target + " / " + entry.Mode, entry.State, entry.UpdateId ?? "—", SizeText(entry.Size));
                        grid.Rows[row].Tag = entry;
                    }
                    status.Text = "保留最近任务及结果；重新上传会校验并沿用已生成包的更新编号。";
                    ShowHistoryDetails();
                } else {
                    var items = await Task.Run(delegate { return BuildStorage.Inventory(repository, cancellation.Token); });
                    if (IsDisposed || Disposing || generation != storageGeneration) return;
                    storageItems = items;
                    inventoryLoaded = true;
                    checkedPaths.IntersectWith(items.Where(item => item.CanDelete).Select(item => item.Path));
                    ApplyStorageView();
                }
            } catch (OperationCanceledException) { }
            catch (Exception error) {
                if (!IsDisposed && !Disposing) { status.Text = "读取未完成"; details.Text = BuildRunner.ProtectOutput(error.Message); }
            }
            finally {
                if (!IsDisposed && !Disposing) { working = false; actions.Enabled = true; UpdateStorageButtons(); }
                if (cancellation != null && (!inventoryLoaded || IsDisposed || Disposing)) {
                    ReleaseStorageCancellation(cancellation); cancellation = null;
                }
            }
            if (kind == "storage" && inventoryLoaded && !IsDisposed && !Disposing && cancellation != null && !cancellation.IsCancellationRequested && generation == storageGeneration)
                StartSizeMeasurement(cancellation, generation);
            else if (cancellation != null) ReleaseStorageCancellation(cancellation);
        }

        private void StorageCellValue(object sender, DataGridViewCellValueEventArgs e)
        {
            if (e.RowIndex < 0 || e.RowIndex >= visibleItems.Count) return;
            var item = visibleItems[e.RowIndex];
            switch (grid.Columns[e.ColumnIndex].Name) {
                case "selected": e.Value = checkedPaths.Contains(item.Path); break;
                case "Kind": e.Value = item.Kind; break;
                case "Path": e.Value = item.Path; break;
                case "Size": e.Value = item.SizeKnown ? SizeText(item.Bytes) : item.CanDelete ? "待统计" : "未统计"; break;
                case "Protection": e.Value = item.CanDelete ? "可清理" : "受保护"; break;
            }
        }

        private void ApplyStorageView()
        {
            if (kind != "storage" || IsDisposed || Disposing || refreshingStorage) return;
            grid.EndEdit();
            string focused = Selected<BuildStorageItem>() == null ? null : Selected<BuildStorageItem>().Path;
            var ordered = storageItems.Where(item => !onlyClean.Checked || item.CanDelete).OrderByDescending(item => item.CanDelete);
            if (storageSort == "Size") {
                var knownFirst = ordered.ThenBy(item => !item.SizeKnown);
                ordered = sortAscending ? knownFirst.ThenBy(item => item.Bytes) : knownFirst.ThenByDescending(item => item.Bytes);
            } else if (storageSort == "Kind")
                ordered = sortAscending ? ordered.ThenBy(item => item.Kind, StringComparer.OrdinalIgnoreCase) : ordered.ThenByDescending(item => item.Kind, StringComparer.OrdinalIgnoreCase);
            else ordered = sortAscending ? ordered.ThenBy(item => item.Path, StringComparer.OrdinalIgnoreCase) : ordered.ThenByDescending(item => item.Path, StringComparer.OrdinalIgnoreCase);
            refreshingStorage = true;
            try {
                visibleItems = ordered.ThenBy(item => item.Path, StringComparer.OrdinalIgnoreCase).ToList();
                grid.RowCount = visibleItems.Count;
                foreach (DataGridViewColumn column in grid.Columns) column.HeaderCell.SortGlyphDirection = SortOrder.None;
                grid.Columns[storageSort].HeaderCell.SortGlyphDirection = sortAscending ? SortOrder.Ascending : SortOrder.Descending;
                int index = focused == null ? -1 : visibleItems.FindIndex(item => String.Equals(item.Path, focused, StringComparison.OrdinalIgnoreCase));
                if (index >= 0) grid.CurrentCell = grid.Rows[index].Cells[1];
                grid.Invalidate();
            } finally { refreshingStorage = false; }
            UpdateStorageStatus();
        }

        private void UpdateStorageButtons()
        {
            if (kind != "storage" || IsDisposed || Disposing) return;
            if (rescanButton != null) rescanButton.Enabled = !working && !deleting;
            if (stopSizeButton != null) stopSizeButton.Enabled = sizing && !working && !deleting;
            if (deleteButton != null) deleteButton.Enabled = !working && !deleting && checkedPaths.Count > 0;
            onlyClean.Enabled = sortSelector.Enabled = !deleting;
            if (storageToolbar != null) storageToolbar.Enabled = !working && !deleting;
        }

        private void UpdateStorageStatus()
        {
            if (kind != "storage" || IsDisposed || Disposing) return;
            var clean = storageItems.Where(item => item.CanDelete).ToList();
            long known = clean.Where(item => item.SizeKnown).Sum(item => item.Bytes);
            int pending = clean.Count(item => !item.SizeKnown);
            status.Text = "可清理 " + clean.Count + " 项 · 已知大小 " + SizeText(known) +
                (pending > 0 ? " · " + pending + " 个文件夹" + (sizing ? "后台统计中" : "未统计") : "") +
                " · 已选 " + checkedPaths.Count + " 项。受保护项始终保留。";
            UpdateStorageButtons();
        }

        private static BuildStorageItem CopyItem(BuildStorageItem item)
        {
            return new BuildStorageItem { Path = item.Path, Kind = item.Kind, Bytes = item.Bytes, Description = item.Description,
                CanDelete = item.CanDelete, SizeKnown = item.SizeKnown, IsDirectory = item.IsDirectory };
        }

        private void AcceptSize(BuildStorageItem item, BuildStorageItem measured)
        {
            item.Bytes = measured.Bytes; item.Description = measured.Description;
            item.SizeKnown = measured.SizeKnown; item.CanDelete = measured.CanDelete;
            if (!item.CanDelete) checkedPaths.Remove(item.Path);
            int row = visibleItems.IndexOf(item);
            if (row >= 0) grid.InvalidateRow(row);
        }

        private async void StartSizeMeasurement(CancellationTokenSource cancellation, int generation)
        {
            sizing = true; UpdateStorageStatus();
            try {
                var folders = storageItems.Where(item => item.CanDelete && item.IsDirectory && !item.SizeKnown)
                    .OrderBy(item => item.Kind == "APK 编译缓存" ? 1 : 0).ToArray();
                foreach (var item in folders) {
                    cancellation.Token.ThrowIfCancellationRequested();
                    var measured = CopyItem(item);
                    await Task.Run(delegate { BuildStorage.MeasureItem(measured, cancellation.Token); });
                    if (IsDisposed || Disposing || generation != storageGeneration) return;
                    AcceptSize(item, measured); UpdateStorageStatus();
                    // Sizes update in place; rows are not moved while the user is
                    // selecting checkboxes. Apply the chosen sort once at the end.
                }
            } catch (OperationCanceledException) { }
            catch (Exception error) {
                if (!IsDisposed && !Disposing && generation == storageGeneration) details.Text = BuildRunner.ProtectOutput(error.Message);
            } finally {
                if (!IsDisposed && !Disposing && generation == storageGeneration) { sizing = false; ApplyStorageView(); }
                ReleaseStorageCancellation(cancellation);
            }
        }

        private void ReleaseStorageCancellation(CancellationTokenSource cancellation)
        {
            if (Object.ReferenceEquals(storageCancellation, cancellation)) storageCancellation = null;
            cancellation.Dispose();
        }
        private void ShowHistoryDetails()
        {
            var entry = Selected<BuildHistoryEntry>();
            details.Text = entry == null ? "暂无任务记录。" : BuildRunner.ProtectOutput((entry.Summary ?? "") +
                "\r\n产物：" + (entry.ArtifactPath ?? "—") + "\r\n日志：" + (entry.LogPath ?? "—") +
                "\r\n更新编号：" + (entry.UpdateId ?? "—") + "\r\n兼容版本：" + (entry.Runtime ?? "—"));
        }
        private void OpenSelected(bool log)
        {
            var entry = Selected<BuildHistoryEntry>(); if (entry == null) return;
            string path = log ? entry.LogPath : entry.ArtifactPath;
            try {
                if (String.IsNullOrEmpty(path) || !File.Exists(path)) throw new IOException("文件已移动或尚未生成。");
                Process.Start(new ProcessStartInfo(log ? "notepad.exe" : "explorer.exe", log ? "\"" + path + "\"" : "/select,\"" + path + "\"") { UseShellExecute = true });
            } catch (Exception error) { MessageBox.Show(this, error.Message, Text); }
        }
        private void SelectRetry()
        {
            var entry = Selected<BuildHistoryEntry>();
            if (entry == null || !String.Equals(Path.GetExtension(entry.ArtifactPath ?? ""), ".zip", StringComparison.OrdinalIgnoreCase) || !File.Exists(entry.ArtifactPath)) {
                MessageBox.Show(this, "请先选择仍保留 update.zip 的热更新任务。", Text); return;
            }
            if (MessageBox.Show(this, "将重新校验并上传这份已生成的更新包，沿用原更新编号，不重新导出项目。继续？", "重新上传热更新", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
            RetryPackage = entry.ArtifactPath; DialogResult = DialogResult.OK; Close();
        }
        private async Task DeleteSelected()
        {
            if (working) return; grid.EndEdit();
            var items = storageItems.Where(item => item.CanDelete && checkedPaths.Contains(item.Path)).ToList();
            if (items.Count == 0) { MessageBox.Show(this, "请勾选需要清理的生成文件。", Text); return; }
            if (storageCancellation != null) storageCancellation.Cancel();
            var cancellation = new CancellationTokenSource(); storageCancellation = cancellation;
            int generation = ++storageGeneration; sizing = false;
            working = true; UpdateStorageButtons();
            try {
                foreach (var item in items.Where(item => !item.SizeKnown)) {
                    status.Text = "正在核对所选目录：" + Path.GetFileName(item.Path) + "。可关闭窗口取消。";
                    var measured = CopyItem(item);
                    await Task.Run(delegate { BuildStorage.MeasureItem(measured, cancellation.Token); });
                    if (IsDisposed || Disposing) return;
                    AcceptSize(item, measured);
                }
                cancellation.Token.ThrowIfCancellationRequested();
                items = items.Where(item => item.CanDelete && item.SizeKnown).ToList();
            } catch (OperationCanceledException) { return; }
            catch (Exception error) { if (!IsDisposed && !Disposing) MessageBox.Show(this, BuildRunner.ProtectOutput(error.Message), Text); return; }
            finally {
                if (!IsDisposed && !Disposing) { working = false; ApplyStorageView(); }
                ReleaseStorageCancellation(cancellation);
            }
            if (IsDisposed || Disposing || generation != storageGeneration) return;
            if (items.Count == 0) { MessageBox.Show(this, "所选目录未通过核对，已标为受保护，未执行清理。", Text); return; }
            string listing = String.Join("\r\n", items.Select(x => x.Path + "  (" + SizeText(x.Bytes) + ")"));
            using (var confirmation = new CleanupReview(listing, items.Count, items.Sum(item => item.Bytes)))
                if (confirmation.ShowDialog(this) != DialogResult.OK) return;
            deleting = working = true; actions.Enabled = false; grid.Enabled = false; UpdateStorageButtons();
            status.Text = "正在清理 " + items.Count + " 项生成文件，请稍候…";
            var failures = new List<string>();
            int finished = 0;
            var clock = Stopwatch.StartNew(); long lastNotice = 0;
            var cleanupProgress = new Progress<int>(delegate(int value) {
                if (!IsDisposed && !Disposing) status.Text = "正在清理 " + value + " / " + items.Count + " 项生成文件…";
            });
            try {
                await Task.Run(delegate {
                    BuildStorage.DeleteBatch(repository, items, delegate(BuildStorageItem item, Exception error) {
                        if (error != null) failures.Add(item.Path + "：" + BuildRunner.ProtectOutput(error.Message));
                        finished++;
                        if (finished == items.Count || clock.ElapsedMilliseconds - lastNotice >= 200) {
                            lastNotice = clock.ElapsedMilliseconds; ((IProgress<int>)cleanupProgress).Report(finished);
                        }
                    });
                });
            } catch (Exception error) { failures.Add(BuildRunner.ProtectOutput(error.Message)); }
            finally {
                deleting = working = false;
                if (!IsDisposed && !Disposing) { actions.Enabled = true; grid.Enabled = true; }
            }
            if (IsDisposed || Disposing) return;
            await LoadContent();
            if (failures.Count > 0) { details.Text = String.Join("\r\n", failures); MessageBox.Show(this, "部分文件未清理，具体原因见下方。", Text); }
        }
        internal static string SizeText(long bytes)
        {
            return bytes >= 1024 * 1024 ? (bytes / 1048576D).ToString("0.00") + " MB" : bytes >= 1024 ? (bytes / 1024D).ToString("0.0") + " KB" : bytes + " B";
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing && storageCancellation != null) storageCancellation.Cancel();
            base.Dispose(disposing);
        }
        private sealed class SmoothGrid : DataGridView
        {
            internal SmoothGrid() { DoubleBuffered = true; }
        }
        private sealed class CleanupReview : Form
        {
            internal CleanupReview(string listing, int count, long bytes)
            {
                Text = "确认清理"; Font = new Font("Microsoft YaHei UI", 9F);
                StartPosition = FormStartPosition.CenterParent; AutoScaleMode = AutoScaleMode.Dpi;
                ClientSize = new Size(760, 440); MinimumSize = new Size(620, 360);
                Padding = new Padding(16); BackColor = Color.FromArgb(238, 243, 248);
                var description = new Label { Dock = DockStyle.Top, Height = 42,
                    Text = "将删除以下 " + count + " 项生成文件，合计 " + SizeText(bytes) + "。请核对完整路径。", TextAlign = ContentAlignment.MiddleLeft };
                var paths = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both,
                    WordWrap = false, Text = listing, BackColor = Color.White };
                var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 44, Padding = new Padding(0, 8, 0, 0) };
                var cancel = new Button { Text = "取消", Width = 90, Height = 30, DialogResult = DialogResult.Cancel };
                var confirm = new Button { Text = "确认清理", Width = 110, Height = 30, DialogResult = DialogResult.OK };
                buttons.Controls.Add(cancel); buttons.Controls.Add(confirm);
                Controls.Add(paths); Controls.Add(buttons); Controls.Add(description);
                CancelButton = cancel; AcceptButton = cancel;
            }
        }
    }
}
