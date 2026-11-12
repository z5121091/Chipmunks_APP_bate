
namespace FlashFindWinDemo
{
    partial class MainForm
    {
        /// <summary>
        /// 必需的设计器变量。
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// 清理所有正在使用的资源。
        /// </summary>
        /// <param name="disposing">如果应释放托管资源，为 true；否则为 false。</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows 窗体设计器生成的代码

        /// <summary>
        /// 设计器支持所需的方法 - 不要修改
        /// 使用代码编辑器修改此方法的内容。
        /// </summary>
        private void InitializeComponent()
        {
            this.components = new System.ComponentModel.Container();
            System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(MainForm));
            this.label1 = new System.Windows.Forms.Label();
            this.label2 = new System.Windows.Forms.Label();
            this.label_baseSN = new System.Windows.Forms.Label();
            this.label_baseState = new System.Windows.Forms.Label();
            this.baseConnectActionBtn = new System.Windows.Forms.Button();
            this.groupBox1 = new System.Windows.Forms.GroupBox();
            this.Bn_ClearLightCode = new System.Windows.Forms.Button();
            this.setAllLightStopBtn = new System.Windows.Forms.Button();
            this.setAllLightWorkBtn = new System.Windows.Forms.Button();
            this.setLightStopBtn = new System.Windows.Forms.Button();
            this.groupBox7 = new System.Windows.Forms.GroupBox();
            this.setGroupTagsWorkBtn = new System.Windows.Forms.Button();
            this.cB_GroupLabel3Rule = new System.Windows.Forms.ComboBox();
            this.cB_GroupLabel2Rule = new System.Windows.Forms.ComboBox();
            this.cB_GroupLabel1Rule = new System.Windows.Forms.ComboBox();
            this.label17 = new System.Windows.Forms.Label();
            this.updateTagGroupBtn = new System.Windows.Forms.Button();
            this.label15 = new System.Windows.Forms.Label();
            this.tB_GroupLabel3 = new System.Windows.Forms.TextBox();
            this.label13 = new System.Windows.Forms.Label();
            this.tB_GroupLabel2 = new System.Windows.Forms.TextBox();
            this.label11 = new System.Windows.Forms.Label();
            this.tB_GroupLabel1 = new System.Windows.Forms.TextBox();
            this.label10 = new System.Windows.Forms.Label();
            this.tB_LightCode = new System.Windows.Forms.TextBox();
            this.groupBox4 = new System.Windows.Forms.GroupBox();
            this.rB_WhiteLight = new System.Windows.Forms.RadioButton();
            this.rB_PurpleLight = new System.Windows.Forms.RadioButton();
            this.rB_CyanLight = new System.Windows.Forms.RadioButton();
            this.rB_GreenLight = new System.Windows.Forms.RadioButton();
            this.rB_BlueLight = new System.Windows.Forms.RadioButton();
            this.rB_YellowLight = new System.Windows.Forms.RadioButton();
            this.rB_RedLight = new System.Windows.Forms.RadioButton();
            this.groupBox3 = new System.Windows.Forms.GroupBox();
            this.cB_LightState = new System.Windows.Forms.CheckBox();
            this.tB_TagsWorkTime = new System.Windows.Forms.TextBox();
            this.label_TagsIntervalTime = new System.Windows.Forms.Label();
            this.tB_TagsIntervalTime = new System.Windows.Forms.TextBox();
            this.cB_BeepState = new System.Windows.Forms.CheckBox();
            this.label5 = new System.Windows.Forms.Label();
            this.label_TagsIntervalTimeUnit = new System.Windows.Forms.Label();
            this.label7 = new System.Windows.Forms.Label();
            this.setLightWorkBtn = new System.Windows.Forms.Button();
            this.groupBox2 = new System.Windows.Forms.GroupBox();
            this.label6 = new System.Windows.Forms.Label();
            this.label_InventoryLightCountDownSeconds = new System.Windows.Forms.Label();
            this.label4 = new System.Windows.Forms.Label();
            this.label_InventoryLightCount = new System.Windows.Forms.Label();
            this.label9 = new System.Windows.Forms.Label();
            this.groupBox5 = new System.Windows.Forms.GroupBox();
            this.exportExcelBtn = new System.Windows.Forms.Button();
            this.label8 = new System.Windows.Forms.Label();
            this.tB_InventoryCount = new System.Windows.Forms.TextBox();
            this.label14 = new System.Windows.Forms.Label();
            this.label12 = new System.Windows.Forms.Label();
            this.label16 = new System.Windows.Forms.Label();
            this.tB_InventoryTotal = new System.Windows.Forms.TextBox();
            this.tB_InventoryInterval = new System.Windows.Forms.TextBox();
            this.inventoryLightBtn = new System.Windows.Forms.Button();
            this.lv_LightMessage = new System.Windows.Forms.ListView();
            this.columnHeader1 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.columnHeader2 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.columnHeader3 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.columnHeader4 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.lv_Log = new System.Windows.Forms.ListView();
            this.columnHeader5 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.columnHeader6 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.columnHeader7 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.timer_InventoryCountDown = new System.Windows.Forms.Timer(this.components);
            this.timer_CheckBaseConnectState = new System.Windows.Forms.Timer(this.components);
            this.label_baseMac = new System.Windows.Forms.Label();
            this.label18 = new System.Windows.Forms.Label();
            this.label_baseTcp = new System.Windows.Forms.Label();
            this.label20 = new System.Windows.Forms.Label();
            this.label_baseVer = new System.Windows.Forms.Label();
            this.label24 = new System.Windows.Forms.Label();
            this.label_moduleVer = new System.Windows.Forms.Label();
            this.label19 = new System.Windows.Forms.Label();
            this.groupBox1.SuspendLayout();
            this.groupBox7.SuspendLayout();
            this.groupBox4.SuspendLayout();
            this.groupBox3.SuspendLayout();
            this.groupBox2.SuspendLayout();
            this.groupBox5.SuspendLayout();
            this.SuspendLayout();
            // 
            // label1
            // 
            this.label1.AutoSize = true;
            this.label1.Font = new System.Drawing.Font("宋体", 12F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label1.Location = new System.Drawing.Point(28, 12);
            this.label1.Name = "label1";
            this.label1.Size = new System.Drawing.Size(64, 16);
            this.label1.TabIndex = 0;
            this.label1.Text = "基站SN:";
            this.label1.TextAlign = System.Drawing.ContentAlignment.TopRight;
            // 
            // label2
            // 
            this.label2.AutoSize = true;
            this.label2.Location = new System.Drawing.Point(280, 13);
            this.label2.Name = "label2";
            this.label2.Size = new System.Drawing.Size(70, 14);
            this.label2.TabIndex = 1;
            this.label2.Text = "连接状态:";
            this.label2.TextAlign = System.Drawing.ContentAlignment.TopRight;
            // 
            // label_baseSN
            // 
            this.label_baseSN.AutoSize = true;
            this.label_baseSN.Font = new System.Drawing.Font("宋体", 15.75F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label_baseSN.ForeColor = System.Drawing.Color.FromArgb(((int)(((byte)(7)))), ((int)(((byte)(87)))), ((int)(((byte)(152)))));
            this.label_baseSN.Location = new System.Drawing.Point(93, 11);
            this.label_baseSN.Name = "label_baseSN";
            this.label_baseSN.Size = new System.Drawing.Size(178, 21);
            this.label_baseSN.TabIndex = 2;
            this.label_baseSN.Text = "XY202504270001";
            // 
            // label_baseState
            // 
            this.label_baseState.AutoSize = true;
            this.label_baseState.Font = new System.Drawing.Font("宋体", 12F, System.Drawing.FontStyle.Bold);
            this.label_baseState.Location = new System.Drawing.Point(354, 13);
            this.label_baseState.Name = "label_baseState";
            this.label_baseState.Size = new System.Drawing.Size(76, 16);
            this.label_baseState.TabIndex = 3;
            this.label_baseState.Text = "连接正常";
            // 
            // baseConnectActionBtn
            // 
            this.baseConnectActionBtn.Font = new System.Drawing.Font("宋体", 15.75F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.baseConnectActionBtn.ForeColor = System.Drawing.Color.DarkCyan;
            this.baseConnectActionBtn.Location = new System.Drawing.Point(728, 13);
            this.baseConnectActionBtn.Name = "baseConnectActionBtn";
            this.baseConnectActionBtn.Size = new System.Drawing.Size(130, 49);
            this.baseConnectActionBtn.TabIndex = 4;
            this.baseConnectActionBtn.Text = "连接基站";
            this.baseConnectActionBtn.UseVisualStyleBackColor = true;
            this.baseConnectActionBtn.Click += new System.EventHandler(this.baseConnectActionBtn_Click);
            // 
            // groupBox1
            // 
            this.groupBox1.Controls.Add(this.Bn_ClearLightCode);
            this.groupBox1.Controls.Add(this.setAllLightStopBtn);
            this.groupBox1.Controls.Add(this.setAllLightWorkBtn);
            this.groupBox1.Controls.Add(this.setLightStopBtn);
            this.groupBox1.Controls.Add(this.groupBox7);
            this.groupBox1.Controls.Add(this.tB_LightCode);
            this.groupBox1.Controls.Add(this.groupBox4);
            this.groupBox1.Controls.Add(this.groupBox3);
            this.groupBox1.Controls.Add(this.setLightWorkBtn);
            this.groupBox1.Location = new System.Drawing.Point(12, 71);
            this.groupBox1.Name = "groupBox1";
            this.groupBox1.Size = new System.Drawing.Size(847, 280);
            this.groupBox1.TabIndex = 5;
            this.groupBox1.TabStop = false;
            this.groupBox1.Text = "灯条控制";
            // 
            // Bn_ClearLightCode
            // 
            this.Bn_ClearLightCode.Location = new System.Drawing.Point(744, 204);
            this.Bn_ClearLightCode.Name = "Bn_ClearLightCode";
            this.Bn_ClearLightCode.Size = new System.Drawing.Size(83, 32);
            this.Bn_ClearLightCode.TabIndex = 32;
            this.Bn_ClearLightCode.Text = "清除↓";
            this.Bn_ClearLightCode.UseVisualStyleBackColor = true;
            this.Bn_ClearLightCode.Click += new System.EventHandler(this.Bn_ClearLightCode_Click);
            // 
            // setAllLightStopBtn
            // 
            this.setAllLightStopBtn.Font = new System.Drawing.Font("宋体", 10.5F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.setAllLightStopBtn.ForeColor = System.Drawing.Color.Firebrick;
            this.setAllLightStopBtn.Location = new System.Drawing.Point(487, 118);
            this.setAllLightStopBtn.Name = "setAllLightStopBtn";
            this.setAllLightStopBtn.Size = new System.Drawing.Size(147, 32);
            this.setAllLightStopBtn.TabIndex = 31;
            this.setAllLightStopBtn.Text = "全部停止";
            this.setAllLightStopBtn.UseVisualStyleBackColor = true;
            this.setAllLightStopBtn.Click += new System.EventHandler(this.setAllLightStopBtn_Click);
            // 
            // setAllLightWorkBtn
            // 
            this.setAllLightWorkBtn.Font = new System.Drawing.Font("宋体", 10.5F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.setAllLightWorkBtn.ForeColor = System.Drawing.Color.RoyalBlue;
            this.setAllLightWorkBtn.Location = new System.Drawing.Point(325, 118);
            this.setAllLightWorkBtn.Name = "setAllLightWorkBtn";
            this.setAllLightWorkBtn.Size = new System.Drawing.Size(147, 32);
            this.setAllLightWorkBtn.TabIndex = 30;
            this.setAllLightWorkBtn.Text = "全部点亮";
            this.setAllLightWorkBtn.UseVisualStyleBackColor = true;
            this.setAllLightWorkBtn.Click += new System.EventHandler(this.setAllLightWorkBtn_Click);
            // 
            // setLightStopBtn
            // 
            this.setLightStopBtn.Font = new System.Drawing.Font("宋体", 10.5F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.setLightStopBtn.ForeColor = System.Drawing.Color.IndianRed;
            this.setLightStopBtn.Location = new System.Drawing.Point(167, 118);
            this.setLightStopBtn.Name = "setLightStopBtn";
            this.setLightStopBtn.Size = new System.Drawing.Size(147, 32);
            this.setLightStopBtn.TabIndex = 29;
            this.setLightStopBtn.Text = "停止";
            this.setLightStopBtn.UseVisualStyleBackColor = true;
            this.setLightStopBtn.Click += new System.EventHandler(this.setLightStopBtn_Click);
            // 
            // groupBox7
            // 
            this.groupBox7.Controls.Add(this.setGroupTagsWorkBtn);
            this.groupBox7.Controls.Add(this.cB_GroupLabel3Rule);
            this.groupBox7.Controls.Add(this.cB_GroupLabel2Rule);
            this.groupBox7.Controls.Add(this.cB_GroupLabel1Rule);
            this.groupBox7.Controls.Add(this.label17);
            this.groupBox7.Controls.Add(this.updateTagGroupBtn);
            this.groupBox7.Controls.Add(this.label15);
            this.groupBox7.Controls.Add(this.tB_GroupLabel3);
            this.groupBox7.Controls.Add(this.label13);
            this.groupBox7.Controls.Add(this.tB_GroupLabel2);
            this.groupBox7.Controls.Add(this.label11);
            this.groupBox7.Controls.Add(this.tB_GroupLabel1);
            this.groupBox7.Controls.Add(this.label10);
            this.groupBox7.Location = new System.Drawing.Point(15, 157);
            this.groupBox7.Name = "groupBox7";
            this.groupBox7.Size = new System.Drawing.Size(619, 80);
            this.groupBox7.TabIndex = 28;
            this.groupBox7.TabStop = false;
            this.groupBox7.Text = "分组相关";
            // 
            // setGroupTagsWorkBtn
            // 
            this.setGroupTagsWorkBtn.Font = new System.Drawing.Font("宋体", 10.5F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.setGroupTagsWorkBtn.ForeColor = System.Drawing.Color.RoyalBlue;
            this.setGroupTagsWorkBtn.Location = new System.Drawing.Point(485, 49);
            this.setGroupTagsWorkBtn.Name = "setGroupTagsWorkBtn";
            this.setGroupTagsWorkBtn.Size = new System.Drawing.Size(125, 25);
            this.setGroupTagsWorkBtn.TabIndex = 37;
            this.setGroupTagsWorkBtn.Text = "点亮分组";
            this.setGroupTagsWorkBtn.UseVisualStyleBackColor = true;
            this.setGroupTagsWorkBtn.Click += new System.EventHandler(this.setGroupTagsWorkBtn_Click);
            // 
            // cB_GroupLabel3Rule
            // 
            this.cB_GroupLabel3Rule.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.cB_GroupLabel3Rule.FormattingEnabled = true;
            this.cB_GroupLabel3Rule.Items.AddRange(new object[] {
            "=",
            ">",
            "<",
            "≠",
            "∅"});
            this.cB_GroupLabel3Rule.Location = new System.Drawing.Point(334, 50);
            this.cB_GroupLabel3Rule.Name = "cB_GroupLabel3Rule";
            this.cB_GroupLabel3Rule.Size = new System.Drawing.Size(139, 22);
            this.cB_GroupLabel3Rule.TabIndex = 36;
            // 
            // cB_GroupLabel2Rule
            // 
            this.cB_GroupLabel2Rule.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.cB_GroupLabel2Rule.FormattingEnabled = true;
            this.cB_GroupLabel2Rule.Items.AddRange(new object[] {
            "=",
            ">",
            "<",
            "≠",
            "∅"});
            this.cB_GroupLabel2Rule.Location = new System.Drawing.Point(203, 50);
            this.cB_GroupLabel2Rule.Name = "cB_GroupLabel2Rule";
            this.cB_GroupLabel2Rule.Size = new System.Drawing.Size(123, 22);
            this.cB_GroupLabel2Rule.TabIndex = 35;
            // 
            // cB_GroupLabel1Rule
            // 
            this.cB_GroupLabel1Rule.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.cB_GroupLabel1Rule.FormattingEnabled = true;
            this.cB_GroupLabel1Rule.Items.AddRange(new object[] {
            "=",
            ">",
            "<",
            "≠",
            "∅"});
            this.cB_GroupLabel1Rule.Location = new System.Drawing.Point(86, 50);
            this.cB_GroupLabel1Rule.Name = "cB_GroupLabel1Rule";
            this.cB_GroupLabel1Rule.Size = new System.Drawing.Size(110, 22);
            this.cB_GroupLabel1Rule.TabIndex = 34;
            // 
            // label17
            // 
            this.label17.AutoSize = true;
            this.label17.Location = new System.Drawing.Point(9, 54);
            this.label17.Name = "label17";
            this.label17.Size = new System.Drawing.Size(63, 14);
            this.label17.TabIndex = 33;
            this.label17.Text = "匹配规则";
            // 
            // updateTagGroupBtn
            // 
            this.updateTagGroupBtn.Font = new System.Drawing.Font("宋体", 10.5F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.updateTagGroupBtn.ForeColor = System.Drawing.Color.Green;
            this.updateTagGroupBtn.Location = new System.Drawing.Point(485, 17);
            this.updateTagGroupBtn.Name = "updateTagGroupBtn";
            this.updateTagGroupBtn.Size = new System.Drawing.Size(125, 25);
            this.updateTagGroupBtn.TabIndex = 32;
            this.updateTagGroupBtn.Text = "更新分组";
            this.updateTagGroupBtn.UseVisualStyleBackColor = true;
            this.updateTagGroupBtn.Click += new System.EventHandler(this.updateTagGroupBtn_Click);
            // 
            // label15
            // 
            this.label15.AutoSize = true;
            this.label15.Location = new System.Drawing.Point(330, 24);
            this.label15.Name = "label15";
            this.label15.Size = new System.Drawing.Size(63, 14);
            this.label15.TabIndex = 23;
            this.label15.Text = "时间信息";
            // 
            // tB_GroupLabel3
            // 
            this.tB_GroupLabel3.Location = new System.Drawing.Point(399, 18);
            this.tB_GroupLabel3.Name = "tB_GroupLabel3";
            this.tB_GroupLabel3.Size = new System.Drawing.Size(74, 23);
            this.tB_GroupLabel3.TabIndex = 24;
            this.tB_GroupLabel3.Text = "FFFFFFFF";
            // 
            // label13
            // 
            this.label13.AutoSize = true;
            this.label13.Location = new System.Drawing.Point(200, 25);
            this.label13.Name = "label13";
            this.label13.Size = new System.Drawing.Size(63, 14);
            this.label13.TabIndex = 21;
            this.label13.Text = "货架信息";
            // 
            // tB_GroupLabel2
            // 
            this.tB_GroupLabel2.Location = new System.Drawing.Point(269, 19);
            this.tB_GroupLabel2.Name = "tB_GroupLabel2";
            this.tB_GroupLabel2.Size = new System.Drawing.Size(57, 23);
            this.tB_GroupLabel2.TabIndex = 22;
            this.tB_GroupLabel2.Text = "FFFF";
            // 
            // label11
            // 
            this.label11.AutoSize = true;
            this.label11.Location = new System.Drawing.Point(83, 26);
            this.label11.Name = "label11";
            this.label11.Size = new System.Drawing.Size(63, 14);
            this.label11.TabIndex = 19;
            this.label11.Text = "快递公司";
            // 
            // tB_GroupLabel1
            // 
            this.tB_GroupLabel1.Location = new System.Drawing.Point(152, 20);
            this.tB_GroupLabel1.Name = "tB_GroupLabel1";
            this.tB_GroupLabel1.Size = new System.Drawing.Size(44, 23);
            this.tB_GroupLabel1.TabIndex = 20;
            this.tB_GroupLabel1.Text = "FF";
            // 
            // label10
            // 
            this.label10.AutoSize = true;
            this.label10.Location = new System.Drawing.Point(9, 26);
            this.label10.Name = "label10";
            this.label10.Size = new System.Drawing.Size(63, 14);
            this.label10.TabIndex = 14;
            this.label10.Text = "分组标签";
            // 
            // tB_LightCode
            // 
            this.tB_LightCode.Location = new System.Drawing.Point(14, 246);
            this.tB_LightCode.Name = "tB_LightCode";
            this.tB_LightCode.Size = new System.Drawing.Size(814, 23);
            this.tB_LightCode.TabIndex = 26;
            this.tB_LightCode.Text = "在此输入需要控制的灯条号，多个灯条号则以;号分割开来。例：2503190006;2503190007";
            // 
            // groupBox4
            // 
            this.groupBox4.Controls.Add(this.rB_WhiteLight);
            this.groupBox4.Controls.Add(this.rB_PurpleLight);
            this.groupBox4.Controls.Add(this.rB_CyanLight);
            this.groupBox4.Controls.Add(this.rB_GreenLight);
            this.groupBox4.Controls.Add(this.rB_BlueLight);
            this.groupBox4.Controls.Add(this.rB_YellowLight);
            this.groupBox4.Controls.Add(this.rB_RedLight);
            this.groupBox4.Font = new System.Drawing.Font("宋体", 10.5F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.groupBox4.Location = new System.Drawing.Point(286, 15);
            this.groupBox4.Name = "groupBox4";
            this.groupBox4.Size = new System.Drawing.Size(348, 97);
            this.groupBox4.TabIndex = 20;
            this.groupBox4.TabStop = false;
            // 
            // rB_WhiteLight
            // 
            this.rB_WhiteLight.AutoSize = true;
            this.rB_WhiteLight.ForeColor = System.Drawing.Color.DarkGray;
            this.rB_WhiteLight.Location = new System.Drawing.Point(104, 64);
            this.rB_WhiteLight.Name = "rB_WhiteLight";
            this.rB_WhiteLight.Size = new System.Drawing.Size(55, 18);
            this.rB_WhiteLight.TabIndex = 14;
            this.rB_WhiteLight.Text = "白灯";
            this.rB_WhiteLight.UseVisualStyleBackColor = true;
            // 
            // rB_PurpleLight
            // 
            this.rB_PurpleLight.AutoSize = true;
            this.rB_PurpleLight.ForeColor = System.Drawing.Color.Purple;
            this.rB_PurpleLight.Location = new System.Drawing.Point(195, 64);
            this.rB_PurpleLight.Name = "rB_PurpleLight";
            this.rB_PurpleLight.Size = new System.Drawing.Size(55, 18);
            this.rB_PurpleLight.TabIndex = 13;
            this.rB_PurpleLight.Text = "紫灯";
            this.rB_PurpleLight.UseVisualStyleBackColor = true;
            // 
            // rB_CyanLight
            // 
            this.rB_CyanLight.AutoSize = true;
            this.rB_CyanLight.ForeColor = System.Drawing.Color.DarkTurquoise;
            this.rB_CyanLight.Location = new System.Drawing.Point(13, 64);
            this.rB_CyanLight.Name = "rB_CyanLight";
            this.rB_CyanLight.Size = new System.Drawing.Size(55, 18);
            this.rB_CyanLight.TabIndex = 12;
            this.rB_CyanLight.Text = "青灯";
            this.rB_CyanLight.UseVisualStyleBackColor = true;
            // 
            // rB_GreenLight
            // 
            this.rB_GreenLight.AutoSize = true;
            this.rB_GreenLight.ForeColor = System.Drawing.Color.MediumSeaGreen;
            this.rB_GreenLight.Location = new System.Drawing.Point(286, 23);
            this.rB_GreenLight.Name = "rB_GreenLight";
            this.rB_GreenLight.Size = new System.Drawing.Size(55, 18);
            this.rB_GreenLight.TabIndex = 11;
            this.rB_GreenLight.Text = "绿灯";
            this.rB_GreenLight.UseVisualStyleBackColor = true;
            // 
            // rB_BlueLight
            // 
            this.rB_BlueLight.AutoSize = true;
            this.rB_BlueLight.ForeColor = System.Drawing.Color.DodgerBlue;
            this.rB_BlueLight.Location = new System.Drawing.Point(195, 23);
            this.rB_BlueLight.Name = "rB_BlueLight";
            this.rB_BlueLight.Size = new System.Drawing.Size(55, 18);
            this.rB_BlueLight.TabIndex = 10;
            this.rB_BlueLight.Text = "蓝灯";
            this.rB_BlueLight.UseVisualStyleBackColor = true;
            // 
            // rB_YellowLight
            // 
            this.rB_YellowLight.AutoSize = true;
            this.rB_YellowLight.ForeColor = System.Drawing.Color.Gold;
            this.rB_YellowLight.Location = new System.Drawing.Point(104, 23);
            this.rB_YellowLight.Name = "rB_YellowLight";
            this.rB_YellowLight.Size = new System.Drawing.Size(55, 18);
            this.rB_YellowLight.TabIndex = 9;
            this.rB_YellowLight.Text = "黄灯";
            this.rB_YellowLight.UseVisualStyleBackColor = true;
            // 
            // rB_RedLight
            // 
            this.rB_RedLight.AutoSize = true;
            this.rB_RedLight.Checked = true;
            this.rB_RedLight.ForeColor = System.Drawing.Color.Red;
            this.rB_RedLight.Location = new System.Drawing.Point(13, 23);
            this.rB_RedLight.Name = "rB_RedLight";
            this.rB_RedLight.Size = new System.Drawing.Size(55, 18);
            this.rB_RedLight.TabIndex = 8;
            this.rB_RedLight.TabStop = true;
            this.rB_RedLight.Text = "红灯";
            this.rB_RedLight.UseVisualStyleBackColor = true;
            // 
            // groupBox3
            // 
            this.groupBox3.Controls.Add(this.cB_LightState);
            this.groupBox3.Controls.Add(this.tB_TagsWorkTime);
            this.groupBox3.Controls.Add(this.label_TagsIntervalTime);
            this.groupBox3.Controls.Add(this.tB_TagsIntervalTime);
            this.groupBox3.Controls.Add(this.cB_BeepState);
            this.groupBox3.Controls.Add(this.label5);
            this.groupBox3.Controls.Add(this.label_TagsIntervalTimeUnit);
            this.groupBox3.Controls.Add(this.label7);
            this.groupBox3.Location = new System.Drawing.Point(15, 15);
            this.groupBox3.Name = "groupBox3";
            this.groupBox3.Size = new System.Drawing.Size(265, 97);
            this.groupBox3.TabIndex = 19;
            this.groupBox3.TabStop = false;
            // 
            // cB_LightState
            // 
            this.cB_LightState.AutoSize = true;
            this.cB_LightState.Checked = true;
            this.cB_LightState.CheckState = System.Windows.Forms.CheckState.Checked;
            this.cB_LightState.Location = new System.Drawing.Point(11, 62);
            this.cB_LightState.Name = "cB_LightState";
            this.cB_LightState.Size = new System.Drawing.Size(82, 18);
            this.cB_LightState.TabIndex = 22;
            this.cB_LightState.Text = "闪光提示";
            this.cB_LightState.UseVisualStyleBackColor = true;
            // 
            // tB_TagsWorkTime
            // 
            this.tB_TagsWorkTime.Location = new System.Drawing.Point(177, 17);
            this.tB_TagsWorkTime.Name = "tB_TagsWorkTime";
            this.tB_TagsWorkTime.Size = new System.Drawing.Size(44, 23);
            this.tB_TagsWorkTime.TabIndex = 15;
            this.tB_TagsWorkTime.Text = "60";
            // 
            // label_TagsIntervalTime
            // 
            this.label_TagsIntervalTime.AutoSize = true;
            this.label_TagsIntervalTime.Location = new System.Drawing.Point(103, 65);
            this.label_TagsIntervalTime.Name = "label_TagsIntervalTime";
            this.label_TagsIntervalTime.Size = new System.Drawing.Size(63, 14);
            this.label_TagsIntervalTime.TabIndex = 16;
            this.label_TagsIntervalTime.Text = "闪光间隔";
            // 
            // tB_TagsIntervalTime
            // 
            this.tB_TagsIntervalTime.Location = new System.Drawing.Point(177, 59);
            this.tB_TagsIntervalTime.Name = "tB_TagsIntervalTime";
            this.tB_TagsIntervalTime.Size = new System.Drawing.Size(44, 23);
            this.tB_TagsIntervalTime.TabIndex = 18;
            this.tB_TagsIntervalTime.Text = "1";
            // 
            // cB_BeepState
            // 
            this.cB_BeepState.AutoSize = true;
            this.cB_BeepState.Checked = true;
            this.cB_BeepState.CheckState = System.Windows.Forms.CheckState.Checked;
            this.cB_BeepState.Location = new System.Drawing.Point(11, 22);
            this.cB_BeepState.Name = "cB_BeepState";
            this.cB_BeepState.Size = new System.Drawing.Size(82, 18);
            this.cB_BeepState.TabIndex = 2;
            this.cB_BeepState.Text = "声音提示";
            this.cB_BeepState.UseVisualStyleBackColor = true;
            // 
            // label5
            // 
            this.label5.AutoSize = true;
            this.label5.Location = new System.Drawing.Point(103, 22);
            this.label5.Name = "label5";
            this.label5.Size = new System.Drawing.Size(63, 14);
            this.label5.TabIndex = 13;
            this.label5.Text = "亮灯时间";
            // 
            // label_TagsIntervalTimeUnit
            // 
            this.label_TagsIntervalTimeUnit.AutoSize = true;
            this.label_TagsIntervalTimeUnit.Location = new System.Drawing.Point(227, 65);
            this.label_TagsIntervalTimeUnit.Name = "label_TagsIntervalTimeUnit";
            this.label_TagsIntervalTimeUnit.Size = new System.Drawing.Size(21, 14);
            this.label_TagsIntervalTimeUnit.TabIndex = 17;
            this.label_TagsIntervalTimeUnit.Text = "秒";
            // 
            // label7
            // 
            this.label7.AutoSize = true;
            this.label7.Location = new System.Drawing.Point(227, 22);
            this.label7.Name = "label7";
            this.label7.Size = new System.Drawing.Size(21, 14);
            this.label7.TabIndex = 14;
            this.label7.Text = "秒";
            // 
            // setLightWorkBtn
            // 
            this.setLightWorkBtn.Font = new System.Drawing.Font("宋体", 10.5F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.setLightWorkBtn.ForeColor = System.Drawing.Color.CornflowerBlue;
            this.setLightWorkBtn.Location = new System.Drawing.Point(14, 118);
            this.setLightWorkBtn.Name = "setLightWorkBtn";
            this.setLightWorkBtn.Size = new System.Drawing.Size(147, 32);
            this.setLightWorkBtn.TabIndex = 22;
            this.setLightWorkBtn.Text = "点亮";
            this.setLightWorkBtn.UseVisualStyleBackColor = true;
            this.setLightWorkBtn.Click += new System.EventHandler(this.setLightWorkBtn_Click);
            // 
            // groupBox2
            // 
            this.groupBox2.Controls.Add(this.label6);
            this.groupBox2.Controls.Add(this.label_InventoryLightCountDownSeconds);
            this.groupBox2.Controls.Add(this.label4);
            this.groupBox2.Controls.Add(this.label_InventoryLightCount);
            this.groupBox2.Controls.Add(this.label9);
            this.groupBox2.Controls.Add(this.groupBox5);
            this.groupBox2.Controls.Add(this.lv_LightMessage);
            this.groupBox2.Location = new System.Drawing.Point(12, 357);
            this.groupBox2.Name = "groupBox2";
            this.groupBox2.Size = new System.Drawing.Size(847, 332);
            this.groupBox2.TabIndex = 6;
            this.groupBox2.TabStop = false;
            this.groupBox2.Text = "盘点信息";
            // 
            // label6
            // 
            this.label6.AutoSize = true;
            this.label6.Location = new System.Drawing.Point(167, 25);
            this.label6.Name = "label6";
            this.label6.Size = new System.Drawing.Size(21, 14);
            this.label6.TabIndex = 33;
            this.label6.Text = "秒";
            // 
            // label_InventoryLightCountDownSeconds
            // 
            this.label_InventoryLightCountDownSeconds.AutoSize = true;
            this.label_InventoryLightCountDownSeconds.Font = new System.Drawing.Font("宋体", 14.25F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label_InventoryLightCountDownSeconds.Location = new System.Drawing.Point(120, 21);
            this.label_InventoryLightCountDownSeconds.Name = "label_InventoryLightCountDownSeconds";
            this.label_InventoryLightCountDownSeconds.Size = new System.Drawing.Size(20, 19);
            this.label_InventoryLightCountDownSeconds.TabIndex = 32;
            this.label_InventoryLightCountDownSeconds.Text = "0";
            // 
            // label4
            // 
            this.label4.AutoSize = true;
            this.label4.Location = new System.Drawing.Point(12, 25);
            this.label4.Name = "label4";
            this.label4.Size = new System.Drawing.Size(105, 14);
            this.label4.TabIndex = 31;
            this.label4.Text = "盘点剩余时间：";
            this.label4.TextAlign = System.Drawing.ContentAlignment.TopRight;
            // 
            // label_InventoryLightCount
            // 
            this.label_InventoryLightCount.AutoSize = true;
            this.label_InventoryLightCount.Font = new System.Drawing.Font("宋体", 14.25F, System.Drawing.FontStyle.Bold);
            this.label_InventoryLightCount.Location = new System.Drawing.Point(120, 52);
            this.label_InventoryLightCount.Name = "label_InventoryLightCount";
            this.label_InventoryLightCount.Size = new System.Drawing.Size(20, 19);
            this.label_InventoryLightCount.TabIndex = 30;
            this.label_InventoryLightCount.Text = "0";
            // 
            // label9
            // 
            this.label9.AutoSize = true;
            this.label9.Location = new System.Drawing.Point(12, 54);
            this.label9.Name = "label9";
            this.label9.Size = new System.Drawing.Size(105, 14);
            this.label9.TabIndex = 29;
            this.label9.Text = "盘点灯条数目：";
            this.label9.TextAlign = System.Drawing.ContentAlignment.TopRight;
            // 
            // groupBox5
            // 
            this.groupBox5.Controls.Add(this.exportExcelBtn);
            this.groupBox5.Controls.Add(this.label8);
            this.groupBox5.Controls.Add(this.tB_InventoryCount);
            this.groupBox5.Controls.Add(this.label14);
            this.groupBox5.Controls.Add(this.label12);
            this.groupBox5.Controls.Add(this.label16);
            this.groupBox5.Controls.Add(this.tB_InventoryTotal);
            this.groupBox5.Controls.Add(this.tB_InventoryInterval);
            this.groupBox5.Controls.Add(this.inventoryLightBtn);
            this.groupBox5.Location = new System.Drawing.Point(368, 14);
            this.groupBox5.Name = "groupBox5";
            this.groupBox5.Size = new System.Drawing.Size(473, 54);
            this.groupBox5.TabIndex = 28;
            this.groupBox5.TabStop = false;
            // 
            // exportExcelBtn
            // 
            this.exportExcelBtn.Font = new System.Drawing.Font("宋体", 10.5F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.exportExcelBtn.ForeColor = System.Drawing.Color.LightCoral;
            this.exportExcelBtn.Location = new System.Drawing.Point(376, 15);
            this.exportExcelBtn.Name = "exportExcelBtn";
            this.exportExcelBtn.Size = new System.Drawing.Size(83, 32);
            this.exportExcelBtn.TabIndex = 35;
            this.exportExcelBtn.Text = "导出";
            this.exportExcelBtn.UseVisualStyleBackColor = true;
            this.exportExcelBtn.Click += new System.EventHandler(this.exportExcelBtn_Click);
            // 
            // label8
            // 
            this.label8.AutoSize = true;
            this.label8.Location = new System.Drawing.Point(8, 25);
            this.label8.Name = "label8";
            this.label8.Size = new System.Drawing.Size(35, 14);
            this.label8.TabIndex = 28;
            this.label8.Text = "间隔";
            // 
            // tB_InventoryCount
            // 
            this.tB_InventoryCount.Location = new System.Drawing.Point(158, 21);
            this.tB_InventoryCount.Name = "tB_InventoryCount";
            this.tB_InventoryCount.Size = new System.Drawing.Size(38, 23);
            this.tB_InventoryCount.TabIndex = 34;
            this.tB_InventoryCount.Text = "3";
            // 
            // label14
            // 
            this.label14.AutoSize = true;
            this.label14.Location = new System.Drawing.Point(198, 24);
            this.label14.Name = "label14";
            this.label14.Size = new System.Drawing.Size(35, 14);
            this.label14.TabIndex = 30;
            this.label14.Text = "总数";
            // 
            // label12
            // 
            this.label12.AutoSize = true;
            this.label12.Location = new System.Drawing.Point(98, 25);
            this.label12.Name = "label12";
            this.label12.Size = new System.Drawing.Size(21, 14);
            this.label12.TabIndex = 29;
            this.label12.Text = "MS";
            // 
            // label16
            // 
            this.label16.AutoSize = true;
            this.label16.Location = new System.Drawing.Point(122, 25);
            this.label16.Name = "label16";
            this.label16.Size = new System.Drawing.Size(35, 14);
            this.label16.TabIndex = 33;
            this.label16.Text = "次数";
            // 
            // tB_InventoryTotal
            // 
            this.tB_InventoryTotal.Location = new System.Drawing.Point(236, 20);
            this.tB_InventoryTotal.Name = "tB_InventoryTotal";
            this.tB_InventoryTotal.Size = new System.Drawing.Size(38, 23);
            this.tB_InventoryTotal.TabIndex = 31;
            this.tB_InventoryTotal.Text = "20";
            // 
            // tB_InventoryInterval
            // 
            this.tB_InventoryInterval.Location = new System.Drawing.Point(46, 21);
            this.tB_InventoryInterval.Name = "tB_InventoryInterval";
            this.tB_InventoryInterval.Size = new System.Drawing.Size(48, 23);
            this.tB_InventoryInterval.TabIndex = 27;
            this.tB_InventoryInterval.Text = "1000";
            // 
            // inventoryLightBtn
            // 
            this.inventoryLightBtn.Font = new System.Drawing.Font("宋体", 10.5F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.inventoryLightBtn.ForeColor = System.Drawing.Color.SteelBlue;
            this.inventoryLightBtn.Location = new System.Drawing.Point(284, 15);
            this.inventoryLightBtn.Name = "inventoryLightBtn";
            this.inventoryLightBtn.Size = new System.Drawing.Size(83, 32);
            this.inventoryLightBtn.TabIndex = 32;
            this.inventoryLightBtn.Text = "盘点";
            this.inventoryLightBtn.UseVisualStyleBackColor = true;
            this.inventoryLightBtn.Click += new System.EventHandler(this.inventoryLightBtn_Click);
            // 
            // lv_LightMessage
            // 
            this.lv_LightMessage.Columns.AddRange(new System.Windows.Forms.ColumnHeader[] {
            this.columnHeader1,
            this.columnHeader2,
            this.columnHeader3,
            this.columnHeader4});
            this.lv_LightMessage.FullRowSelect = true;
            this.lv_LightMessage.GridLines = true;
            this.lv_LightMessage.HideSelection = false;
            this.lv_LightMessage.Location = new System.Drawing.Point(6, 74);
            this.lv_LightMessage.Name = "lv_LightMessage";
            this.lv_LightMessage.Size = new System.Drawing.Size(835, 252);
            this.lv_LightMessage.TabIndex = 8;
            this.lv_LightMessage.UseCompatibleStateImageBehavior = false;
            this.lv_LightMessage.View = System.Windows.Forms.View.Details;
            this.lv_LightMessage.ColumnClick += new System.Windows.Forms.ColumnClickEventHandler(this.lv_LightMessage_ColumnClick);
            // 
            // columnHeader1
            // 
            this.columnHeader1.Text = "序号";
            // 
            // columnHeader2
            // 
            this.columnHeader2.Text = "灯条号";
            this.columnHeader2.Width = 160;
            // 
            // columnHeader3
            // 
            this.columnHeader3.Text = "灯条电压(mV)";
            this.columnHeader3.Width = 120;
            // 
            // columnHeader4
            // 
            this.columnHeader4.Text = "盘点时间";
            this.columnHeader4.Width = 240;
            // 
            // lv_Log
            // 
            this.lv_Log.BackColor = System.Drawing.Color.FromArgb(((int)(((byte)(255)))), ((int)(((byte)(255)))), ((int)(((byte)(192)))));
            this.lv_Log.Columns.AddRange(new System.Windows.Forms.ColumnHeader[] {
            this.columnHeader5,
            this.columnHeader6,
            this.columnHeader7});
            this.lv_Log.FullRowSelect = true;
            this.lv_Log.GridLines = true;
            this.lv_Log.HideSelection = false;
            this.lv_Log.Location = new System.Drawing.Point(12, 698);
            this.lv_Log.Name = "lv_Log";
            this.lv_Log.Size = new System.Drawing.Size(847, 95);
            this.lv_Log.TabIndex = 7;
            this.lv_Log.UseCompatibleStateImageBehavior = false;
            this.lv_Log.View = System.Windows.Forms.View.Details;
            // 
            // columnHeader5
            // 
            this.columnHeader5.Text = "序号";
            this.columnHeader5.Width = 67;
            // 
            // columnHeader6
            // 
            this.columnHeader6.Text = "时间";
            this.columnHeader6.Width = 240;
            // 
            // columnHeader7
            // 
            this.columnHeader7.Text = "操作结果";
            this.columnHeader7.Width = 500;
            // 
            // timer_InventoryCountDown
            // 
            this.timer_InventoryCountDown.Interval = 1000;
            this.timer_InventoryCountDown.Tick += new System.EventHandler(this.timer_InventoryCountDown_Tick);
            // 
            // timer_CheckBaseConnectState
            // 
            this.timer_CheckBaseConnectState.Enabled = true;
            this.timer_CheckBaseConnectState.Interval = 500;
            this.timer_CheckBaseConnectState.Tick += new System.EventHandler(this.timer_CheckBaseConnectState_Tick);
            // 
            // label_baseMac
            // 
            this.label_baseMac.AutoSize = true;
            this.label_baseMac.Font = new System.Drawing.Font("宋体", 12F, System.Drawing.FontStyle.Bold);
            this.label_baseMac.ForeColor = System.Drawing.Color.DarkViolet;
            this.label_baseMac.Location = new System.Drawing.Point(93, 46);
            this.label_baseMac.Name = "label_baseMac";
            this.label_baseMac.Size = new System.Drawing.Size(161, 16);
            this.label_baseMac.TabIndex = 9;
            this.label_baseMac.Text = "11-22-33-44-55-66";
            // 
            // label18
            // 
            this.label18.AutoSize = true;
            this.label18.Location = new System.Drawing.Point(54, 47);
            this.label18.Name = "label18";
            this.label18.Size = new System.Drawing.Size(35, 14);
            this.label18.TabIndex = 8;
            this.label18.Text = "MAC:";
            this.label18.TextAlign = System.Drawing.ContentAlignment.TopRight;
            // 
            // label_baseTcp
            // 
            this.label_baseTcp.AutoSize = true;
            this.label_baseTcp.Font = new System.Drawing.Font("宋体", 12F, System.Drawing.FontStyle.Bold);
            this.label_baseTcp.ForeColor = System.Drawing.Color.CornflowerBlue;
            this.label_baseTcp.Location = new System.Drawing.Point(354, 48);
            this.label_baseTcp.Name = "label_baseTcp";
            this.label_baseTcp.Size = new System.Drawing.Size(196, 16);
            this.label_baseTcp.TabIndex = 11;
            this.label_baseTcp.Text = "255.255.255.255：5000";
            // 
            // label20
            // 
            this.label20.AutoSize = true;
            this.label20.Location = new System.Drawing.Point(294, 49);
            this.label20.Name = "label20";
            this.label20.Size = new System.Drawing.Size(56, 14);
            this.label20.TabIndex = 10;
            this.label20.Text = "IP信息:";
            this.label20.TextAlign = System.Drawing.ContentAlignment.TopRight;
            // 
            // label_baseVer
            // 
            this.label_baseVer.AutoSize = true;
            this.label_baseVer.Font = new System.Drawing.Font("宋体", 12F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label_baseVer.ForeColor = System.Drawing.Color.Teal;
            this.label_baseVer.Location = new System.Drawing.Point(636, 11);
            this.label_baseVer.Name = "label_baseVer";
            this.label_baseVer.Size = new System.Drawing.Size(71, 16);
            this.label_baseVer.TabIndex = 15;
            this.label_baseVer.Text = "3.3.9-2";
            // 
            // label24
            // 
            this.label24.AutoSize = true;
            this.label24.Location = new System.Drawing.Point(560, 12);
            this.label24.Name = "label24";
            this.label24.Size = new System.Drawing.Size(70, 14);
            this.label24.TabIndex = 14;
            this.label24.Text = "软件版本:";
            this.label24.TextAlign = System.Drawing.ContentAlignment.TopRight;
            // 
            // label_moduleVer
            // 
            this.label_moduleVer.AutoSize = true;
            this.label_moduleVer.Font = new System.Drawing.Font("宋体", 12F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label_moduleVer.ForeColor = System.Drawing.Color.Teal;
            this.label_moduleVer.Location = new System.Drawing.Point(636, 48);
            this.label_moduleVer.Name = "label_moduleVer";
            this.label_moduleVer.Size = new System.Drawing.Size(53, 16);
            this.label_moduleVer.TabIndex = 17;
            this.label_moduleVer.Text = "1.0.0";
            // 
            // label19
            // 
            this.label19.AutoSize = true;
            this.label19.Location = new System.Drawing.Point(560, 49);
            this.label19.Name = "label19";
            this.label19.Size = new System.Drawing.Size(70, 14);
            this.label19.TabIndex = 16;
            this.label19.Text = "固件版本:";
            this.label19.TextAlign = System.Drawing.ContentAlignment.TopRight;
            // 
            // MainForm
            // 
            this.AutoScaleDimensions = new System.Drawing.SizeF(96F, 96F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Dpi;
            this.ClientSize = new System.Drawing.Size(871, 806);
            this.Controls.Add(this.label_moduleVer);
            this.Controls.Add(this.label19);
            this.Controls.Add(this.label_baseVer);
            this.Controls.Add(this.label24);
            this.Controls.Add(this.label_baseTcp);
            this.Controls.Add(this.label20);
            this.Controls.Add(this.label_baseMac);
            this.Controls.Add(this.label18);
            this.Controls.Add(this.lv_Log);
            this.Controls.Add(this.groupBox2);
            this.Controls.Add(this.groupBox1);
            this.Controls.Add(this.baseConnectActionBtn);
            this.Controls.Add(this.label_baseState);
            this.Controls.Add(this.label_baseSN);
            this.Controls.Add(this.label2);
            this.Controls.Add(this.label1);
            this.Font = new System.Drawing.Font("宋体", 10.5F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.FormBorderStyle = System.Windows.Forms.FormBorderStyle.FixedSingle;
            this.Icon = ((System.Drawing.Icon)(resources.GetObject("$this.Icon")));
            this.MaximizeBox = false;
            this.Name = "MainForm";
            this.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
            this.Text = "FlashFindWinDemo";
            this.Load += new System.EventHandler(this.MainForm_Load);
            this.groupBox1.ResumeLayout(false);
            this.groupBox1.PerformLayout();
            this.groupBox7.ResumeLayout(false);
            this.groupBox7.PerformLayout();
            this.groupBox4.ResumeLayout(false);
            this.groupBox4.PerformLayout();
            this.groupBox3.ResumeLayout(false);
            this.groupBox3.PerformLayout();
            this.groupBox2.ResumeLayout(false);
            this.groupBox2.PerformLayout();
            this.groupBox5.ResumeLayout(false);
            this.groupBox5.PerformLayout();
            this.ResumeLayout(false);
            this.PerformLayout();

        }

        #endregion

        private System.Windows.Forms.Label label1;
        private System.Windows.Forms.Label label2;
        private System.Windows.Forms.Label label_baseSN;
        private System.Windows.Forms.Label label_baseState;
        private System.Windows.Forms.Button baseConnectActionBtn;
        private System.Windows.Forms.GroupBox groupBox1;
        private System.Windows.Forms.GroupBox groupBox2;
        private System.Windows.Forms.ListView lv_Log;
        private System.Windows.Forms.ListView lv_LightMessage;
        private System.Windows.Forms.GroupBox groupBox3;
        private System.Windows.Forms.Label label5;
        private System.Windows.Forms.TextBox tB_TagsIntervalTime;
        private System.Windows.Forms.Label label7;
        private System.Windows.Forms.Label label_TagsIntervalTimeUnit;
        private System.Windows.Forms.TextBox tB_TagsWorkTime;
        private System.Windows.Forms.Label label_TagsIntervalTime;
        private System.Windows.Forms.Button setLightWorkBtn;
        private System.Windows.Forms.CheckBox cB_LightState;
        private System.Windows.Forms.CheckBox cB_BeepState;
        private System.Windows.Forms.GroupBox groupBox4;
        private System.Windows.Forms.RadioButton rB_WhiteLight;
        private System.Windows.Forms.RadioButton rB_PurpleLight;
        private System.Windows.Forms.RadioButton rB_CyanLight;
        private System.Windows.Forms.RadioButton rB_GreenLight;
        private System.Windows.Forms.RadioButton rB_BlueLight;
        private System.Windows.Forms.RadioButton rB_YellowLight;
        private System.Windows.Forms.RadioButton rB_RedLight;
        private System.Windows.Forms.TextBox tB_LightCode;
        private System.Windows.Forms.GroupBox groupBox5;
        private System.Windows.Forms.TextBox tB_InventoryCount;
        private System.Windows.Forms.Label label16;
        private System.Windows.Forms.Label label8;
        private System.Windows.Forms.Button inventoryLightBtn;
        private System.Windows.Forms.TextBox tB_InventoryInterval;
        private System.Windows.Forms.TextBox tB_InventoryTotal;
        private System.Windows.Forms.Label label12;
        private System.Windows.Forms.Label label14;
        private System.Windows.Forms.GroupBox groupBox7;
        private System.Windows.Forms.Label label_InventoryLightCount;
        private System.Windows.Forms.Label label9;
        private System.Windows.Forms.Button Bn_ClearLightCode;
        private System.Windows.Forms.Button setAllLightStopBtn;
        private System.Windows.Forms.Button setAllLightWorkBtn;
        private System.Windows.Forms.Button setLightStopBtn;
        private System.Windows.Forms.Label label10;
        private System.Windows.Forms.Label label11;
        private System.Windows.Forms.TextBox tB_GroupLabel1;
        private System.Windows.Forms.Label label15;
        private System.Windows.Forms.TextBox tB_GroupLabel3;
        private System.Windows.Forms.Label label13;
        private System.Windows.Forms.TextBox tB_GroupLabel2;
        private System.Windows.Forms.Label label17;
        private System.Windows.Forms.Button updateTagGroupBtn;
        private System.Windows.Forms.Button setGroupTagsWorkBtn;
        private System.Windows.Forms.ComboBox cB_GroupLabel3Rule;
        private System.Windows.Forms.ComboBox cB_GroupLabel2Rule;
        private System.Windows.Forms.ComboBox cB_GroupLabel1Rule;
        private System.Windows.Forms.ColumnHeader columnHeader1;
        private System.Windows.Forms.ColumnHeader columnHeader2;
        private System.Windows.Forms.ColumnHeader columnHeader3;
        private System.Windows.Forms.ColumnHeader columnHeader4;
        private System.Windows.Forms.ColumnHeader columnHeader5;
        private System.Windows.Forms.ColumnHeader columnHeader6;
        private System.Windows.Forms.ColumnHeader columnHeader7;
        private System.Windows.Forms.Label label_InventoryLightCountDownSeconds;
        private System.Windows.Forms.Label label4;
        private System.Windows.Forms.Label label6;
        private System.Windows.Forms.Timer timer_InventoryCountDown;
        private System.Windows.Forms.Timer timer_CheckBaseConnectState;
        private System.Windows.Forms.Label label_baseMac;
        private System.Windows.Forms.Label label18;
        private System.Windows.Forms.Label label_baseTcp;
        private System.Windows.Forms.Label label20;
        private System.Windows.Forms.Label label_baseVer;
        private System.Windows.Forms.Label label24;
        private System.Windows.Forms.Button exportExcelBtn;
        private System.Windows.Forms.Label label_moduleVer;
        private System.Windows.Forms.Label label19;
    }
}

