using FlashFindWinDemo.AssistUtils;
using FlashFindWinDemo.UdpUtils;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using static FlashFindWinDemo.UdpUtils.UdpHandle;

namespace FlashFindWinDemo
{
    public partial class SearchForm : Form
    {

        /// <summary>
        /// 主窗体
        /// </summary>
        public MainForm mainForm;

        /// <summary>
        /// UDP广播搜索基站
        /// </summary>
        public UdpHandle udpHandle;

        /// <summary>
        /// 本地程序使用UDP端口
        /// </summary>
        public int localUdpPort = 9001;

        /// <summary>
        /// 当前选中基站信息
        /// </summary>
        UdpNetConfigJsonData selectBaseMessage;

        /// <summary>
        /// 基站信息
        /// </summary>
        public List<UdpNetConfigJsonData> readerConfigList = new List<UdpNetConfigJsonData>();


        public SearchForm()
        {
            InitializeComponent();
        }


        /// <summary>
        /// 初始化
        /// </summary>
        /// <param name="mainForm"></param>
        public void init(MainForm mainForm)
        {
            label_baseSN.Text = "-";

            this.mainForm = mainForm;
            udpHandle = new UdpHandle();
            udpHandle.UdpRecvMsgEvent += recvDataHandle;

            searchBaseActionBtn_Click(searchBaseActionBtn, new EventArgs());
        }



        #region 页面按钮点击事件


        /// <summary>
        /// 搜寻基站or停止搜寻
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void searchBaseActionBtn_Click(object sender, EventArgs e)
        {
            string btnText = searchBaseActionBtn.Text;
            if (btnText == "搜寻基站")
            {
                //清空列表和保存的基站设备信息
                label_baseSN.Text = "-";
                lv_BaseMessage.Items.Clear();
                readerConfigList = new List<UdpNetConfigJsonData>();

                bool ret = udpHandle.startUdp(localUdpPort);
                if (ret)
                {
                    timer_Search.Enabled = true;
                    searchBaseActionBtn.Text = "停止搜寻";
                    showProgressBar(true);
                }
                else
                {
                    MessageBox.Show("请检查该电脑是否已有程序正在搜寻基站设备","提示");            
                }
            }
            else
            {
                timer_Search.Enabled = false;
                udpHandle.stopUdp();
                searchBaseActionBtn.Text = "搜寻基站";
                showProgressBar(false);
            }
        }


        /// <summary>
        /// 展示or隐藏 进度
        /// </summary>
        /// <param name="showState"></param>
        public void showProgressBar(bool showState)
        {
            if (showState)
            {
                progressBar.Visible = true;
                progressBar.Style = System.Windows.Forms.ProgressBarStyle.Marquee;
                // 如果需要调整 Marquee 动画速度，可以通过以下属性（值越小越快）
                progressBar.MarqueeAnimationSpeed = 20; // 默认值是 30 毫秒
            }
            else
            {
                progressBar.Visible = false;
                // 切换回连续模式以显示具体的进度
                progressBar.Style = System.Windows.Forms.ProgressBarStyle.Continuous;
                // 更新进度条的值，比如当前进度为50%
                progressBar.Value = 0;
            }     
        }


        /// <summary>
        /// 广播搜索基站
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void timer_Search_Tick(object sender, EventArgs e)
        {
            udpHandle.sendMsg("{\"SyC\":\"GetNetConfig\"}");
            //mainForm.showLog("搜索基站中...");
        }


        /// <summary>
        /// 设置基站连接配置
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void setBaseNetConfigBtn_Click(object sender, EventArgs e)
        {
            if (label_baseSN.Text == "-")
            {
                MessageBox.Show("请在顶部列表先选择要设置的基站设备", "提示");
            }
            else
            {
                if (label_baseSN.Text.Length > 2 &&
                    label_baseSN.Text.Substring(0, 2) == "TJ")
                {
                    MessageBox.Show("该基站设备已配置过SN等参数，请勿重复设置，本次操作失败！", "提示");
                }
                else
                {
                    UdpBaseStationConfigSetJsonData jsonData = new UdpBaseStationConfigSetJsonData();
                    jsonData.SyC = "SetBaseStationConfig";
                    jsonData.SN = tB_SN.Text;
                    jsonData.MqttUrl = tB_MqttUrl.Text;
                    jsonData.HttpUrl = tB_HttpUrl.Text;
                    jsonData.HttpAppKey = tB_HttpAppKey.Text;
                    jsonData.HttpAppSecret = tB_HttpAppSecret.Text;

                    string strJsonData = JsonHelper.SerializeObject(jsonData).Replace(" ", "");
                    udpHandle.sendMsg(strJsonData);
                    //System.Diagnostics.Debug.Print("设置strJsonData数据为=" + strJsonData);
                }
            }
        }


        /// <summary>
        /// 连接基站
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void connectBaseBtn_Click(object sender, EventArgs e)
        {
            if (label_baseSN.Text.Length == 14)//已选择基站
            {
                timer_Search.Enabled = false;
                udpHandle.stopUdp();

                mainForm.connectBase(selectBaseMessage);
                this.Close();
            }
            else
            {
                MessageBox.Show("请在顶部列表先选择要设置的基站设备后再进行连接!", "提示");
            }
        }


        #endregion


        #region 处理UDP接收消息


        /// <summary>
        /// 处理UDP接收数据
        /// </summary>
        /// <param name="recvMsg"></param>
        public void recvDataHandle(object sender, UdpRecvMsgEventArgs e)
        {
            try
            {
                string recvMsg = e.msg;
                UdpNetConfigJsonData jsonData = JsonHelper.DeserializeJsonToObject<UdpNetConfigJsonData>(recvMsg);
                switch (jsonData.SyC)
                {
                    case "GetNetConfigRsp":
                        GetNetConfigRespondHandle(jsonData);
                        break;
                    case "SetBaseStationConfigRsp":
                        SetBaseStationConfigRespondHandle(jsonData);
                        break;
                }
            }
            catch (Exception ex)
            {

            }
        }


        /// <summary>
        /// 处理获取网络配置响应数据
        /// </summary>
        /// <param name="jsonData"></param>
        public void GetNetConfigRespondHandle(UdpNetConfigJsonData jsonData)
        {
            bool isExist = false;
            for (int i = 0; i < readerConfigList.Count; i++)
            {
                if (readerConfigList[i].ID == jsonData.ID)
                {
                    isExist = true;
                    break;
                }
            }

            if (!isExist)
            {
                ListViewItem item = new ListViewItem((readerConfigList.Count + 1).ToString());
                //item.SubItems.Add(PrivateStringFormat.shortTolongNum(jsonData.ID));
                item.SubItems.Add(jsonData.ID + "(" + jsonData.ConnectCount + ")");
                item.SubItems.Add(jsonData.BaseVersion);
                item.SubItems.Add(getAppControlStatu(jsonData.AppControlStatu));
                item.SubItems.Add(getMqttConnectStatu(jsonData.MqttConnectStatu));
                this.lv_BaseMessage.Items.Add(item);//显示

                readerConfigList.Add(jsonData);
            }
        }


        /// <summary>
        /// 处理设置基站连接配置响应数据
        /// </summary>
        /// <param name="jsonData"></param>
        public void SetBaseStationConfigRespondHandle(UdpNetConfigJsonData jsonData)
        {
            string msg = "";
            if (jsonData.ResultCode == "1") msg = tools.getDateTime() + "\r\n" + "设备编码[" + jsonData.ID + "]设置基站连接配置成功";
            else msg = tools.getDateTime() + "\r\n" + "设备编码[" + jsonData.ID + "]设置基站连接配置失败";

            MessageBox.Show(msg, "提示");
        }


        public string getAppControlStatu(string appControlStatu)
        {
            string str = "";
            switch (appControlStatu)
            {
                case "0":
                    str = "禁止交互";
                    break;
                case "1":
                    str = "允许交互";
                    break;
            }
            return str;
        }


        public string getMqttConnectStatu(string mqttConnectStatu)
        {
            string str = "";
            switch (mqttConnectStatu)
            {
                case "0":
                    str = "无法通信";
                    break;
                case "1":
                    str = "可以通信";
                    break;
                case "2":
                    str = "已连接";
                    break;
            }
            return str;
        }

        #endregion


        /// <summary>
        /// 双击列表项
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void lv_BaseMessage_SelectedIndexChanged(object sender, EventArgs e)
        {
            int row = 0;
            if (lv_BaseMessage.SelectedItems.Count > 0)
            {
                row = lv_BaseMessage.SelectedIndices[0];
            }
            label_baseSN.Text = lv_BaseMessage.Items[row].SubItems[1].Text.Split('(')[0];

            UpdateNetConfigTextView();
        }


        /// <summary>
        /// 更新网络配置信息
        /// </summary>
        public void UpdateNetConfigTextView()
        {
            UdpNetConfigJsonData netConfig = null;

            for (int i = 0; i < readerConfigList.Count; i++)
            {
                if (readerConfigList[i].ID == label_baseSN.Text)
                {
                    netConfig = selectBaseMessage = readerConfigList[i];
                    break;
                }
            }

            tB_MAC.Text = netConfig.Mac;
            tB_BaseIp.Text = netConfig.Ri;
            tB_BasePort.Text = netConfig.Rp;
            tB_Mask.Text = netConfig.Sb;
            tB_Gateway.Text = netConfig.Gw;
            tB_Dns.Text = netConfig.Dns;
            tB_ServerIp.Text = netConfig.Si;
            tB_ServerPort.Text = netConfig.Sp;
            //通讯端口
            switch (netConfig.Np)
            {
                case "0":
                    cB_NetType.SelectedIndex = 0;
                    break;
                case "2":
                    cB_NetType.SelectedIndex = 1;
                    break;
                case "9":
                    cB_NetType.SelectedIndex = 2;
                    break;
                case "10":
                    cB_NetType.SelectedIndex = 3;
                    break;
            }
            //网络模式
            cB_TcpType.SelectedIndex = int.Parse(netConfig.Nm);
        }


        /// <summary>
        /// 窗体关闭事件
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void SearchForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            timer_Search.Enabled = false;
            udpHandle.stopUdp();
        }

    }
}
