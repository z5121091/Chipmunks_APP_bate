
namespace FlashFindWinDemo
{
    partial class SearchForm
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            this.components = new System.ComponentModel.Container();
            this.searchBaseActionBtn = new System.Windows.Forms.Button();
            this.groupBox1 = new System.Windows.Forms.GroupBox();
            this.cB_TcpType = new System.Windows.Forms.ComboBox();
            this.label4 = new System.Windows.Forms.Label();
            this.cB_NetType = new System.Windows.Forms.ComboBox();
            this.label5 = new System.Windows.Forms.Label();
            this.label46 = new System.Windows.Forms.Label();
            this.label42 = new System.Windows.Forms.Label();
            this.tB_ServerPort = new System.Windows.Forms.TextBox();
            this.tB_Dns = new System.Windows.Forms.TextBox();
            this.tB_BasePort = new System.Windows.Forms.TextBox();
            this.tB_Mask = new System.Windows.Forms.TextBox();
            this.label45 = new System.Windows.Forms.Label();
            this.label40 = new System.Windows.Forms.Label();
            this.tB_BaseIp = new System.Windows.Forms.TextBox();
            this.tB_MAC = new System.Windows.Forms.TextBox();
            this.tB_ServerIp = new System.Windows.Forms.TextBox();
            this.tB_Gateway = new System.Windows.Forms.TextBox();
            this.label44 = new System.Windows.Forms.Label();
            this.label43 = new System.Windows.Forms.Label();
            this.label38 = new System.Windows.Forms.Label();
            this.label39 = new System.Windows.Forms.Label();
            this.groupBox2 = new System.Windows.Forms.GroupBox();
            this.setBaseNetConfigBtn = new System.Windows.Forms.Button();
            this.groupBox3 = new System.Windows.Forms.GroupBox();
            this.tB_HttpAppSecret = new System.Windows.Forms.TextBox();
            this.label9 = new System.Windows.Forms.Label();
            this.tB_HttpAppKey = new System.Windows.Forms.TextBox();
            this.label8 = new System.Windows.Forms.Label();
            this.tB_HttpUrl = new System.Windows.Forms.TextBox();
            this.label7 = new System.Windows.Forms.Label();
            this.tB_MqttUrl = new System.Windows.Forms.TextBox();
            this.label6 = new System.Windows.Forms.Label();
            this.tB_SN = new System.Windows.Forms.TextBox();
            this.label2 = new System.Windows.Forms.Label();
            this.connectBaseBtn = new System.Windows.Forms.Button();
            this.lv_BaseMessage = new System.Windows.Forms.ListView();
            this.columnHeader1 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.columnHeader2 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.columnHeader3 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.columnHeader4 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.columnHeader5 = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.label_baseSN = new System.Windows.Forms.Label();
            this.label1 = new System.Windows.Forms.Label();
            this.timer_Search = new System.Windows.Forms.Timer(this.components);
            this.progressBar = new System.Windows.Forms.ProgressBar();
            this.groupBox1.SuspendLayout();
            this.groupBox2.SuspendLayout();
            this.groupBox3.SuspendLayout();
            this.SuspendLayout();
            // 
            // searchBaseActionBtn
            // 
            this.searchBaseActionBtn.Font = new System.Drawing.Font("宋体", 15.75F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.searchBaseActionBtn.Location = new System.Drawing.Point(84, 6);
            this.searchBaseActionBtn.Name = "searchBaseActionBtn";
            this.searchBaseActionBtn.Size = new System.Drawing.Size(380, 45);
            this.searchBaseActionBtn.TabIndex = 1;
            this.searchBaseActionBtn.Text = "搜寻基站";
            this.searchBaseActionBtn.UseVisualStyleBackColor = true;
            this.searchBaseActionBtn.Click += new System.EventHandler(this.searchBaseActionBtn_Click);
            // 
            // groupBox1
            // 
            this.groupBox1.Controls.Add(this.cB_TcpType);
            this.groupBox1.Controls.Add(this.label4);
            this.groupBox1.Controls.Add(this.cB_NetType);
            this.groupBox1.Controls.Add(this.label5);
            this.groupBox1.Controls.Add(this.label46);
            this.groupBox1.Controls.Add(this.label42);
            this.groupBox1.Controls.Add(this.tB_ServerPort);
            this.groupBox1.Controls.Add(this.tB_Dns);
            this.groupBox1.Controls.Add(this.tB_BasePort);
            this.groupBox1.Controls.Add(this.tB_Mask);
            this.groupBox1.Controls.Add(this.label45);
            this.groupBox1.Controls.Add(this.label40);
            this.groupBox1.Controls.Add(this.tB_BaseIp);
            this.groupBox1.Controls.Add(this.tB_MAC);
            this.groupBox1.Controls.Add(this.tB_ServerIp);
            this.groupBox1.Controls.Add(this.tB_Gateway);
            this.groupBox1.Controls.Add(this.label44);
            this.groupBox1.Controls.Add(this.label43);
            this.groupBox1.Controls.Add(this.label38);
            this.groupBox1.Controls.Add(this.label39);
            this.groupBox1.Enabled = false;
            this.groupBox1.ForeColor = System.Drawing.Color.Black;
            this.groupBox1.Location = new System.Drawing.Point(21, 300);
            this.groupBox1.Name = "groupBox1";
            this.groupBox1.Size = new System.Drawing.Size(510, 175);
            this.groupBox1.TabIndex = 2;
            this.groupBox1.TabStop = false;
            this.groupBox1.Text = "网络参数信息";
            // 
            // cB_TcpType
            // 
            this.cB_TcpType.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.cB_TcpType.Enabled = false;
            this.cB_TcpType.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.cB_TcpType.ForeColor = System.Drawing.Color.Black;
            this.cB_TcpType.FormattingEnabled = true;
            this.cB_TcpType.Items.AddRange(new object[] {
            "客户端",
            "服务端",
            "服务端、客户端共用"});
            this.cB_TcpType.Location = new System.Drawing.Point(345, 138);
            this.cB_TcpType.Name = "cB_TcpType";
            this.cB_TcpType.Size = new System.Drawing.Size(136, 23);
            this.cB_TcpType.TabIndex = 50;
            // 
            // label4
            // 
            this.label4.AutoSize = true;
            this.label4.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label4.ForeColor = System.Drawing.Color.Black;
            this.label4.Location = new System.Drawing.Point(279, 143);
            this.label4.Margin = new System.Windows.Forms.Padding(2, 0, 2, 0);
            this.label4.Name = "label4";
            this.label4.Size = new System.Drawing.Size(58, 15);
            this.label4.TabIndex = 49;
            this.label4.Text = "网络模式:";
            // 
            // cB_NetType
            // 
            this.cB_NetType.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.cB_NetType.Enabled = false;
            this.cB_NetType.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.cB_NetType.ForeColor = System.Drawing.Color.Black;
            this.cB_NetType.FormattingEnabled = true;
            this.cB_NetType.Items.AddRange(new object[] {
            "标准",
            "WIFI",
            "RJ45-DHCP",
            "WIFI-DHCP"});
            this.cB_NetType.Location = new System.Drawing.Point(96, 138);
            this.cB_NetType.Name = "cB_NetType";
            this.cB_NetType.Size = new System.Drawing.Size(136, 23);
            this.cB_NetType.TabIndex = 48;
            // 
            // label5
            // 
            this.label5.AutoSize = true;
            this.label5.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label5.ForeColor = System.Drawing.Color.Black;
            this.label5.Location = new System.Drawing.Point(20, 143);
            this.label5.Margin = new System.Windows.Forms.Padding(2, 0, 2, 0);
            this.label5.Name = "label5";
            this.label5.Size = new System.Drawing.Size(58, 15);
            this.label5.TabIndex = 47;
            this.label5.Text = "通信接口:";
            // 
            // label46
            // 
            this.label46.AutoSize = true;
            this.label46.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label46.ForeColor = System.Drawing.Color.Black;
            this.label46.Location = new System.Drawing.Point(267, 113);
            this.label46.Margin = new System.Windows.Forms.Padding(2, 0, 2, 0);
            this.label46.Name = "label46";
            this.label46.Size = new System.Drawing.Size(70, 15);
            this.label46.TabIndex = 45;
            this.label46.Text = "服务器端口:";
            // 
            // label42
            // 
            this.label42.AutoSize = true;
            this.label42.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label42.ForeColor = System.Drawing.Color.Black;
            this.label42.Location = new System.Drawing.Point(38, 113);
            this.label42.Margin = new System.Windows.Forms.Padding(2, 0, 2, 0);
            this.label42.Name = "label42";
            this.label42.Size = new System.Drawing.Size(36, 15);
            this.label42.TabIndex = 44;
            this.label42.Text = "DNS:";
            // 
            // tB_ServerPort
            // 
            this.tB_ServerPort.Enabled = false;
            this.tB_ServerPort.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.tB_ServerPort.ForeColor = System.Drawing.Color.Black;
            this.tB_ServerPort.Location = new System.Drawing.Point(345, 109);
            this.tB_ServerPort.Margin = new System.Windows.Forms.Padding(2, 3, 2, 3);
            this.tB_ServerPort.Name = "tB_ServerPort";
            this.tB_ServerPort.Size = new System.Drawing.Size(136, 21);
            this.tB_ServerPort.TabIndex = 35;
            this.tB_ServerPort.Text = "6000";
            // 
            // tB_Dns
            // 
            this.tB_Dns.Enabled = false;
            this.tB_Dns.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.tB_Dns.ForeColor = System.Drawing.Color.Black;
            this.tB_Dns.Location = new System.Drawing.Point(96, 109);
            this.tB_Dns.Margin = new System.Windows.Forms.Padding(2, 3, 2, 3);
            this.tB_Dns.Name = "tB_Dns";
            this.tB_Dns.Size = new System.Drawing.Size(136, 21);
            this.tB_Dns.TabIndex = 36;
            this.tB_Dns.Text = "114.114.114.114";
            // 
            // tB_BasePort
            // 
            this.tB_BasePort.Enabled = false;
            this.tB_BasePort.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.tB_BasePort.ForeColor = System.Drawing.Color.Black;
            this.tB_BasePort.Location = new System.Drawing.Point(345, 51);
            this.tB_BasePort.Margin = new System.Windows.Forms.Padding(2, 3, 2, 3);
            this.tB_BasePort.Name = "tB_BasePort";
            this.tB_BasePort.Size = new System.Drawing.Size(136, 21);
            this.tB_BasePort.TabIndex = 37;
            this.tB_BasePort.Text = "5000";
            // 
            // tB_Mask
            // 
            this.tB_Mask.Enabled = false;
            this.tB_Mask.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.tB_Mask.ForeColor = System.Drawing.Color.Black;
            this.tB_Mask.Location = new System.Drawing.Point(96, 51);
            this.tB_Mask.Margin = new System.Windows.Forms.Padding(2, 3, 2, 3);
            this.tB_Mask.Name = "tB_Mask";
            this.tB_Mask.Size = new System.Drawing.Size(136, 21);
            this.tB_Mask.TabIndex = 31;
            this.tB_Mask.Text = "255.255.255.0";
            // 
            // label45
            // 
            this.label45.AutoSize = true;
            this.label45.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label45.ForeColor = System.Drawing.Color.Black;
            this.label45.Location = new System.Drawing.Point(280, 84);
            this.label45.Margin = new System.Windows.Forms.Padding(2, 0, 2, 0);
            this.label45.Name = "label45";
            this.label45.Size = new System.Drawing.Size(57, 15);
            this.label45.TabIndex = 46;
            this.label45.Text = "服务器IP:";
            // 
            // label40
            // 
            this.label40.AutoSize = true;
            this.label40.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label40.ForeColor = System.Drawing.Color.Black;
            this.label40.Location = new System.Drawing.Point(20, 84);
            this.label40.Margin = new System.Windows.Forms.Padding(2, 0, 2, 0);
            this.label40.Name = "label40";
            this.label40.Size = new System.Drawing.Size(58, 15);
            this.label40.TabIndex = 41;
            this.label40.Text = "默认网关:";
            // 
            // tB_BaseIp
            // 
            this.tB_BaseIp.Enabled = false;
            this.tB_BaseIp.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.tB_BaseIp.ForeColor = System.Drawing.Color.Black;
            this.tB_BaseIp.Location = new System.Drawing.Point(345, 22);
            this.tB_BaseIp.Margin = new System.Windows.Forms.Padding(2, 3, 2, 3);
            this.tB_BaseIp.Name = "tB_BaseIp";
            this.tB_BaseIp.Size = new System.Drawing.Size(136, 21);
            this.tB_BaseIp.TabIndex = 38;
            this.tB_BaseIp.Text = "192.168.1.209";
            // 
            // tB_MAC
            // 
            this.tB_MAC.Enabled = false;
            this.tB_MAC.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.tB_MAC.ForeColor = System.Drawing.Color.Black;
            this.tB_MAC.Location = new System.Drawing.Point(96, 22);
            this.tB_MAC.Margin = new System.Windows.Forms.Padding(2, 3, 2, 3);
            this.tB_MAC.Name = "tB_MAC";
            this.tB_MAC.Size = new System.Drawing.Size(136, 21);
            this.tB_MAC.TabIndex = 34;
            this.tB_MAC.Text = "00-00-00-00-00-00";
            // 
            // tB_ServerIp
            // 
            this.tB_ServerIp.Enabled = false;
            this.tB_ServerIp.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.tB_ServerIp.ForeColor = System.Drawing.Color.Black;
            this.tB_ServerIp.Location = new System.Drawing.Point(345, 80);
            this.tB_ServerIp.Margin = new System.Windows.Forms.Padding(2, 3, 2, 3);
            this.tB_ServerIp.Name = "tB_ServerIp";
            this.tB_ServerIp.Size = new System.Drawing.Size(136, 21);
            this.tB_ServerIp.TabIndex = 33;
            this.tB_ServerIp.Text = "192.168.1.168";
            // 
            // tB_Gateway
            // 
            this.tB_Gateway.Enabled = false;
            this.tB_Gateway.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.tB_Gateway.ForeColor = System.Drawing.Color.Black;
            this.tB_Gateway.Location = new System.Drawing.Point(96, 80);
            this.tB_Gateway.Margin = new System.Windows.Forms.Padding(2, 3, 2, 3);
            this.tB_Gateway.Name = "tB_Gateway";
            this.tB_Gateway.Size = new System.Drawing.Size(136, 21);
            this.tB_Gateway.TabIndex = 32;
            this.tB_Gateway.Text = "192.168.1.1";
            // 
            // label44
            // 
            this.label44.AutoSize = true;
            this.label44.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label44.ForeColor = System.Drawing.Color.Black;
            this.label44.Location = new System.Drawing.Point(292, 26);
            this.label44.Margin = new System.Windows.Forms.Padding(2, 0, 2, 0);
            this.label44.Name = "label44";
            this.label44.Size = new System.Drawing.Size(45, 15);
            this.label44.TabIndex = 40;
            this.label44.Text = "基站IP:";
            // 
            // label43
            // 
            this.label43.AutoSize = true;
            this.label43.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label43.ForeColor = System.Drawing.Color.Black;
            this.label43.Location = new System.Drawing.Point(279, 54);
            this.label43.Margin = new System.Windows.Forms.Padding(2, 0, 2, 0);
            this.label43.Name = "label43";
            this.label43.Size = new System.Drawing.Size(58, 15);
            this.label43.TabIndex = 39;
            this.label43.Text = "基站端口:";
            // 
            // label38
            // 
            this.label38.AutoSize = true;
            this.label38.Enabled = false;
            this.label38.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label38.ForeColor = System.Drawing.Color.Black;
            this.label38.Location = new System.Drawing.Point(20, 26);
            this.label38.Margin = new System.Windows.Forms.Padding(2, 0, 2, 0);
            this.label38.Name = "label38";
            this.label38.Size = new System.Drawing.Size(60, 15);
            this.label38.TabIndex = 43;
            this.label38.Text = "MAC地址:";
            // 
            // label39
            // 
            this.label39.AutoSize = true;
            this.label39.Font = new System.Drawing.Font("Microsoft Sans Serif", 8.999999F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label39.ForeColor = System.Drawing.Color.Black;
            this.label39.Location = new System.Drawing.Point(20, 55);
            this.label39.Margin = new System.Windows.Forms.Padding(2, 0, 2, 0);
            this.label39.Name = "label39";
            this.label39.Size = new System.Drawing.Size(58, 15);
            this.label39.TabIndex = 42;
            this.label39.Text = "子网掩码:";
            // 
            // groupBox2
            // 
            this.groupBox2.Controls.Add(this.setBaseNetConfigBtn);
            this.groupBox2.Controls.Add(this.groupBox3);
            this.groupBox2.Controls.Add(this.tB_MqttUrl);
            this.groupBox2.Controls.Add(this.label6);
            this.groupBox2.Controls.Add(this.tB_SN);
            this.groupBox2.Controls.Add(this.label2);
            this.groupBox2.ForeColor = System.Drawing.Color.SteelBlue;
            this.groupBox2.Location = new System.Drawing.Point(22, 482);
            this.groupBox2.Name = "groupBox2";
            this.groupBox2.Size = new System.Drawing.Size(510, 214);
            this.groupBox2.TabIndex = 3;
            this.groupBox2.TabStop = false;
            this.groupBox2.Text = "基站连接配置";
            // 
            // setBaseNetConfigBtn
            // 
            this.setBaseNetConfigBtn.Font = new System.Drawing.Font("宋体", 12F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.setBaseNetConfigBtn.Location = new System.Drawing.Point(396, 18);
            this.setBaseNetConfigBtn.Name = "setBaseNetConfigBtn";
            this.setBaseNetConfigBtn.Size = new System.Drawing.Size(84, 33);
            this.setBaseNetConfigBtn.TabIndex = 10;
            this.setBaseNetConfigBtn.Text = "设置";
            this.setBaseNetConfigBtn.UseVisualStyleBackColor = true;
            this.setBaseNetConfigBtn.Click += new System.EventHandler(this.setBaseNetConfigBtn_Click);
            // 
            // groupBox3
            // 
            this.groupBox3.Controls.Add(this.tB_HttpAppSecret);
            this.groupBox3.Controls.Add(this.label9);
            this.groupBox3.Controls.Add(this.tB_HttpAppKey);
            this.groupBox3.Controls.Add(this.label8);
            this.groupBox3.Controls.Add(this.tB_HttpUrl);
            this.groupBox3.Controls.Add(this.label7);
            this.groupBox3.ForeColor = System.Drawing.Color.SteelBlue;
            this.groupBox3.Location = new System.Drawing.Point(11, 87);
            this.groupBox3.Name = "groupBox3";
            this.groupBox3.Size = new System.Drawing.Size(493, 115);
            this.groupBox3.TabIndex = 9;
            this.groupBox3.TabStop = false;
            this.groupBox3.Text = "HTTP";
            // 
            // tB_HttpAppSecret
            // 
            this.tB_HttpAppSecret.Location = new System.Drawing.Point(84, 82);
            this.tB_HttpAppSecret.Name = "tB_HttpAppSecret";
            this.tB_HttpAppSecret.Size = new System.Drawing.Size(403, 21);
            this.tB_HttpAppSecret.TabIndex = 10;
            // 
            // label9
            // 
            this.label9.AutoSize = true;
            this.label9.Location = new System.Drawing.Point(9, 85);
            this.label9.Name = "label9";
            this.label9.Size = new System.Drawing.Size(59, 12);
            this.label9.TabIndex = 9;
            this.label9.Text = "appSecret";
            // 
            // tB_HttpAppKey
            // 
            this.tB_HttpAppKey.Location = new System.Drawing.Point(84, 52);
            this.tB_HttpAppKey.Name = "tB_HttpAppKey";
            this.tB_HttpAppKey.Size = new System.Drawing.Size(403, 21);
            this.tB_HttpAppKey.TabIndex = 8;
            // 
            // label8
            // 
            this.label8.AutoSize = true;
            this.label8.Location = new System.Drawing.Point(21, 55);
            this.label8.Name = "label8";
            this.label8.Size = new System.Drawing.Size(41, 12);
            this.label8.TabIndex = 7;
            this.label8.Text = "appKey";
            // 
            // tB_HttpUrl
            // 
            this.tB_HttpUrl.Location = new System.Drawing.Point(84, 20);
            this.tB_HttpUrl.Name = "tB_HttpUrl";
            this.tB_HttpUrl.Size = new System.Drawing.Size(403, 21);
            this.tB_HttpUrl.TabIndex = 6;
            // 
            // label7
            // 
            this.label7.AutoSize = true;
            this.label7.Location = new System.Drawing.Point(11, 23);
            this.label7.Name = "label7";
            this.label7.Size = new System.Drawing.Size(53, 12);
            this.label7.TabIndex = 5;
            this.label7.Text = "HTTP地址";
            // 
            // tB_MqttUrl
            // 
            this.tB_MqttUrl.Location = new System.Drawing.Point(95, 60);
            this.tB_MqttUrl.Name = "tB_MqttUrl";
            this.tB_MqttUrl.Size = new System.Drawing.Size(403, 21);
            this.tB_MqttUrl.TabIndex = 8;
            // 
            // label6
            // 
            this.label6.AutoSize = true;
            this.label6.Location = new System.Drawing.Point(20, 65);
            this.label6.Name = "label6";
            this.label6.Size = new System.Drawing.Size(53, 12);
            this.label6.TabIndex = 7;
            this.label6.Text = "MQTT地址";
            // 
            // tB_SN
            // 
            this.tB_SN.Location = new System.Drawing.Point(95, 25);
            this.tB_SN.Name = "tB_SN";
            this.tB_SN.Size = new System.Drawing.Size(152, 21);
            this.tB_SN.TabIndex = 6;
            this.tB_SN.Text = "TS000000000001";
            // 
            // label2
            // 
            this.label2.AutoSize = true;
            this.label2.Location = new System.Drawing.Point(52, 30);
            this.label2.Name = "label2";
            this.label2.Size = new System.Drawing.Size(17, 12);
            this.label2.TabIndex = 5;
            this.label2.Text = "SN";
            // 
            // connectBaseBtn
            // 
            this.connectBaseBtn.Font = new System.Drawing.Font("宋体", 15.75F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.connectBaseBtn.ForeColor = System.Drawing.Color.DarkGreen;
            this.connectBaseBtn.Location = new System.Drawing.Point(84, 702);
            this.connectBaseBtn.Name = "connectBaseBtn";
            this.connectBaseBtn.Size = new System.Drawing.Size(380, 45);
            this.connectBaseBtn.TabIndex = 4;
            this.connectBaseBtn.Text = "连接";
            this.connectBaseBtn.UseVisualStyleBackColor = true;
            this.connectBaseBtn.Click += new System.EventHandler(this.connectBaseBtn_Click);
            // 
            // lv_BaseMessage
            // 
            this.lv_BaseMessage.Columns.AddRange(new System.Windows.Forms.ColumnHeader[] {
            this.columnHeader1,
            this.columnHeader2,
            this.columnHeader3,
            this.columnHeader4,
            this.columnHeader5});
            this.lv_BaseMessage.FullRowSelect = true;
            this.lv_BaseMessage.GridLines = true;
            this.lv_BaseMessage.HideSelection = false;
            this.lv_BaseMessage.Location = new System.Drawing.Point(21, 87);
            this.lv_BaseMessage.Name = "lv_BaseMessage";
            this.lv_BaseMessage.Size = new System.Drawing.Size(510, 166);
            this.lv_BaseMessage.TabIndex = 5;
            this.lv_BaseMessage.UseCompatibleStateImageBehavior = false;
            this.lv_BaseMessage.View = System.Windows.Forms.View.Details;
            this.lv_BaseMessage.SelectedIndexChanged += new System.EventHandler(this.lv_BaseMessage_SelectedIndexChanged);
            // 
            // columnHeader1
            // 
            this.columnHeader1.Text = "序号";
            // 
            // columnHeader2
            // 
            this.columnHeader2.Text = "基站SN(连接数)";
            this.columnHeader2.Width = 160;
            // 
            // columnHeader3
            // 
            this.columnHeader3.Text = "基站版本";
            this.columnHeader3.Width = 90;
            // 
            // columnHeader4
            // 
            this.columnHeader4.Text = "APP交互";
            this.columnHeader4.Width = 80;
            // 
            // columnHeader5
            // 
            this.columnHeader5.Text = "MQTT交互";
            this.columnHeader5.Width = 80;
            // 
            // label_baseSN
            // 
            this.label_baseSN.AutoSize = true;
            this.label_baseSN.Font = new System.Drawing.Font("宋体", 12F, System.Drawing.FontStyle.Bold);
            this.label_baseSN.ForeColor = System.Drawing.Color.FromArgb(((int)(((byte)(7)))), ((int)(((byte)(87)))), ((int)(((byte)(152)))));
            this.label_baseSN.Location = new System.Drawing.Point(114, 266);
            this.label_baseSN.Name = "label_baseSN";
            this.label_baseSN.Size = new System.Drawing.Size(134, 16);
            this.label_baseSN.TabIndex = 7;
            this.label_baseSN.Text = "XY202504270001";
            // 
            // label1
            // 
            this.label1.AutoSize = true;
            this.label1.Font = new System.Drawing.Font("宋体", 12F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(134)));
            this.label1.Location = new System.Drawing.Point(44, 266);
            this.label1.Name = "label1";
            this.label1.Size = new System.Drawing.Size(64, 16);
            this.label1.TabIndex = 6;
            this.label1.Text = "基站SN:";
            this.label1.TextAlign = System.Drawing.ContentAlignment.TopRight;
            // 
            // timer_Search
            // 
            this.timer_Search.Interval = 1000;
            this.timer_Search.Tick += new System.EventHandler(this.timer_Search_Tick);
            // 
            // progressBar
            // 
            this.progressBar.Location = new System.Drawing.Point(22, 57);
            this.progressBar.Name = "progressBar";
            this.progressBar.Size = new System.Drawing.Size(510, 23);
            this.progressBar.TabIndex = 8;
            // 
            // SearchForm
            // 
            this.AutoScaleDimensions = new System.Drawing.SizeF(96F, 96F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Dpi;
            this.ClientSize = new System.Drawing.Size(554, 756);
            this.Controls.Add(this.progressBar);
            this.Controls.Add(this.label_baseSN);
            this.Controls.Add(this.label1);
            this.Controls.Add(this.lv_BaseMessage);
            this.Controls.Add(this.connectBaseBtn);
            this.Controls.Add(this.groupBox2);
            this.Controls.Add(this.groupBox1);
            this.Controls.Add(this.searchBaseActionBtn);
            this.FormBorderStyle = System.Windows.Forms.FormBorderStyle.FixedSingle;
            this.Name = "SearchForm";
            this.StartPosition = System.Windows.Forms.FormStartPosition.CenterParent;
            this.Text = "Search";
            this.FormClosing += new System.Windows.Forms.FormClosingEventHandler(this.SearchForm_FormClosing);
            this.groupBox1.ResumeLayout(false);
            this.groupBox1.PerformLayout();
            this.groupBox2.ResumeLayout(false);
            this.groupBox2.PerformLayout();
            this.groupBox3.ResumeLayout(false);
            this.groupBox3.PerformLayout();
            this.ResumeLayout(false);
            this.PerformLayout();

        }

        #endregion

        private System.Windows.Forms.Button searchBaseActionBtn;
        private System.Windows.Forms.GroupBox groupBox1;
        private System.Windows.Forms.GroupBox groupBox2;
        private System.Windows.Forms.Button connectBaseBtn;
        private System.Windows.Forms.ListView lv_BaseMessage;
        private System.Windows.Forms.ComboBox cB_TcpType;
        private System.Windows.Forms.Label label4;
        private System.Windows.Forms.ComboBox cB_NetType;
        private System.Windows.Forms.Label label5;
        private System.Windows.Forms.Label label46;
        private System.Windows.Forms.Label label42;
        private System.Windows.Forms.TextBox tB_ServerPort;
        private System.Windows.Forms.TextBox tB_Dns;
        private System.Windows.Forms.TextBox tB_BasePort;
        private System.Windows.Forms.TextBox tB_Mask;
        private System.Windows.Forms.Label label45;
        private System.Windows.Forms.Label label40;
        private System.Windows.Forms.TextBox tB_BaseIp;
        private System.Windows.Forms.TextBox tB_MAC;
        private System.Windows.Forms.TextBox tB_ServerIp;
        private System.Windows.Forms.TextBox tB_Gateway;
        private System.Windows.Forms.Label label44;
        private System.Windows.Forms.Label label43;
        private System.Windows.Forms.Label label38;
        private System.Windows.Forms.Label label39;
        private System.Windows.Forms.Label label_baseSN;
        private System.Windows.Forms.Label label1;
        private System.Windows.Forms.Button setBaseNetConfigBtn;
        private System.Windows.Forms.GroupBox groupBox3;
        private System.Windows.Forms.TextBox tB_HttpAppSecret;
        private System.Windows.Forms.Label label9;
        private System.Windows.Forms.TextBox tB_HttpAppKey;
        private System.Windows.Forms.Label label8;
        private System.Windows.Forms.TextBox tB_HttpUrl;
        private System.Windows.Forms.Label label7;
        private System.Windows.Forms.TextBox tB_MqttUrl;
        private System.Windows.Forms.Label label6;
        private System.Windows.Forms.TextBox tB_SN;
        private System.Windows.Forms.Label label2;
        private System.Windows.Forms.ColumnHeader columnHeader1;
        private System.Windows.Forms.ColumnHeader columnHeader2;
        private System.Windows.Forms.ColumnHeader columnHeader3;
        private System.Windows.Forms.ColumnHeader columnHeader4;
        private System.Windows.Forms.ColumnHeader columnHeader5;
        private System.Windows.Forms.Timer timer_Search;
        private System.Windows.Forms.ProgressBar progressBar;
    }
}