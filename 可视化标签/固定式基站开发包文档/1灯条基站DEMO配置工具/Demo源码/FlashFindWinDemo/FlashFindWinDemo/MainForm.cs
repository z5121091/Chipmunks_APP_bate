using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using FlashFindWinDemo.AssistUtils;
using FlashFindWinDemo.UdpUtils;
using NetFrame.Net.TCP.Sock.Asynchronous;

namespace FlashFindWinDemo
{
    public partial class MainForm : Form
    {
        /// <summary>
        /// 设备接口库
        /// </summary>
        public Reader ReaderControllor = new Reader();

        /// <summary>
        /// 设备对象
        /// </summary>
        public AsyncSocketState currentclient;

        /// <summary>
        /// 是否处于盘点过程中
        /// </summary>
        public bool multingFlag = false;

        /// <summary>
        /// 盘点灯条信息列表
        /// </summary>
        public static List<string> multiTagsList = new List<string>();

        /// <summary>
        /// 当前连接基站设备信息
        /// </summary>
        public UdpNetConfigJsonData connectBaseMessage;

        /// <summary>
        /// 是否查询模块版本
        /// </summary>
        public bool isGetModuleVer = false;


        public MainForm()
        {
            InitializeComponent();
        }

        private void MainForm_Load(object sender, EventArgs e)
        {
            initView();
            initReaderControllor();
            //System.Diagnostics.Debug.Print("Load");
        }


        /// <summary>
        /// 初始化加载界面
        /// </summary>
        public void initView()
        {
            Control.CheckForIllegalCrossThreadCalls = false;
            CheckForIllegalCrossThreadCalls = false;
            //初始化控件值
            label_baseSN.Text = label_baseState.Text = label_baseVer.Text =
             label_baseMac.Text = label_baseTcp.Text = label_moduleVer.Text = "-";
            cB_GroupLabel1Rule.SelectedIndex = cB_GroupLabel2Rule.SelectedIndex =
                cB_GroupLabel3Rule.SelectedIndex = 0;

            this.Text = "FlashFindWinDemo " + "SDK Ver：" + ReaderControllor.Get_SDK();
        }


        /// <summary>
        /// 初始化设备接口
        /// </summary>
        public void initReaderControllor()
        {
            ReaderControllor.SetDevType(DevTypes.Module);
            ReaderControllor.cmd.MultiEPC_Event += ShowData;
            ReaderControllor.StartKeepAlive(2000);//检测设备异常离线
        }


        #region 页面按钮点击事件


        /// <summary>
        /// 连接基站or断开连接
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void baseConnectActionBtn_Click(object sender, EventArgs e)
        {
            string btnText = baseConnectActionBtn.Text;
            if (btnText == "连接基站")
            {
                SearchForm searchForm = new SearchForm();
                searchForm.init(this);
                searchForm.ShowDialog();
            }
            else
            {
                connectBaseMessage = null;
                label_baseSN.Text = label_baseState.Text = label_baseVer.Text =
                label_baseMac.Text = label_baseTcp.Text = label_moduleVer.Text = "-";
                ReaderControllor.DisConnectToServer_V2();
                baseConnectActionBtn.Text = "连接基站";
                baseConnectActionBtn.ForeColor = Color.DarkCyan;
            }
        }


        /// <summary>
        /// 连接基站
        /// </summary>
        /// <param name="connectBaseMessage"></param>
        public void connectBase(UdpNetConfigJsonData connectBaseMessage)
        {
            isGetModuleVer = false;
            this.connectBaseMessage = connectBaseMessage;

            string baseIp = connectBaseMessage.Ri;
            int basePort = int.Parse(connectBaseMessage.Rp);
            ReaderControllor.ConnectToServer_V2(baseIp, basePort, true);
            baseConnectActionBtn.Text = "断开连接";
            baseConnectActionBtn.ForeColor = Color.DarkRed;
            label_baseSN.Text = connectBaseMessage.ID;
            label_baseVer.Text = connectBaseMessage.BaseVersion;
            label_baseMac.Text = connectBaseMessage.Mac;
            label_baseTcp.Text = connectBaseMessage.Ri + ":" + connectBaseMessage.Rp;
        }


        /// <summary>
        /// 点亮
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void setLightWorkBtn_Click(object sender, EventArgs e)
        {
            try
            {
                //灯光
                byte rgb = getRgbValue();
                //声音
                byte beep = getBeepValue();
                //亮灯时长
                byte lightWorkTime = getLightWorkTime();
                //闪光间隔
                byte lightIntervalTime = getLightIntervalTime();
                //灯条号
                List<byte[]> lightCodeList = getLightCodeList(tB_LightCode.Text);

                ReaderControllor.SetAcoustOpticTagsWork(currentclient, rgb, beep, lightCodeList,
                    lightWorkTime, lightIntervalTime);
            }
            catch (Exception ex)
            {
                showLog("点亮异常=" + ex.Message);
            }
        }

        /// <summary>
        /// 停止
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void setLightStopBtn_Click(object sender, EventArgs e)
        {
            try
            {
                //灯光
                byte rgb = 0x08;//默认值：不亮灯
                //声音
                byte beep = 0x00;
                //亮灯时长
                byte lightWorkTime = getLightWorkTime();
                //闪光间隔
                byte lightIntervalTime = getLightIntervalTime();
                //灯条号
                List<byte[]> lightCodeList = getLightCodeList(tB_LightCode.Text);

                ReaderControllor.SetAcoustOpticTagsWork(currentclient, rgb, beep, lightCodeList,
                    lightWorkTime, lightIntervalTime);
            }
            catch (Exception ex)
            {
                showLog("停止异常=" + ex.Message);
            }
        }

        /// <summary>
        /// 全部点亮
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void setAllLightWorkBtn_Click(object sender, EventArgs e)
        {
            try
            {
                //灯光
                byte rgb = getRgbValue();
                //声音
                byte beep = getBeepValue();
                //亮灯时长
                byte lightWorkTime = getLightWorkTime();
                //闪光间隔
                byte lightIntervalTime = getLightIntervalTime();
                //灯条号
                List<byte[]> lightCodeList = getLightCodeList("0000000000");

                ReaderControllor.SetAcoustOpticTagsWork(currentclient, rgb, beep, lightCodeList,
                    lightWorkTime, lightIntervalTime);
            }
            catch (Exception ex)
            {
                showLog("全部点亮异常=" + ex.Message);
            }
        }

        /// <summary>
        /// 全部停止
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void setAllLightStopBtn_Click(object sender, EventArgs e)
        {
            try
            {
                //灯光
                byte rgb = 0x08;//默认值：不亮灯
                //声音
                byte beep = 0x00;
                //亮灯时长
                byte lightWorkTime = getLightWorkTime();
                //闪光间隔
                byte lightIntervalTime = getLightIntervalTime();
                //灯条号
                List<byte[]> lightCodeList = getLightCodeList("0000000000");

                ReaderControllor.SetAcoustOpticTagsWork(currentclient, rgb, beep, lightCodeList,
                    lightWorkTime, lightIntervalTime);
            }
            catch (Exception ex)
            {
                showLog("全部停止异常=" + ex.Message);
            }
        }

        /// <summary>
        /// 更新分组
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void updateTagGroupBtn_Click(object sender, EventArgs e)
        {
            try
            {
                //灯条号
                List<byte[]> lightCodeList = getLightCodeList(tB_LightCode.Text);
                if (lightCodeList.Count != 1)
                {
                    showLog("请保证灯条号输入处有且只有一个灯条号后再试！");
                    return;
                }
                if (tB_GroupLabel1.Text.Length != 2)
                {
                    showLog("快递公司信息需填入长度为2的十六进制字符！");
                    return;
                }
                if (tB_GroupLabel2.Text.Length != 4)
                {
                    showLog("货架号信息需填入长度为4的十六进制字符！");
                    return;
                }
                if (tB_GroupLabel3.Text.Length != 8)
                {
                    showLog("时间信息需填入长度为8的十六进制字符！");
                    return;
                }

                //分组灯条号
                byte[] tagID = lightCodeList[0];
                //分组标签1
                byte label1 = tools.HexStrToBytes(tB_GroupLabel1.Text)[0];
                //分组标签2
                byte[] label2 = tools.HexStrToBytes(tB_GroupLabel2.Text);
                //分组标签3
                byte[] label3 = tools.HexStrToBytes(tB_GroupLabel3.Text);

                ReaderControllor.UpdateAcoustOpticTagsGroup(currentclient,
                 tagID, label1, label2, label3);
            }
            catch (Exception ex)
            {
                showLog("更新分组异常=" + ex.Message);
            }
        }

        /// <summary>
        /// 点亮分组
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void setGroupTagsWorkBtn_Click(object sender, EventArgs e)
        {
            try
            {
                if (tB_GroupLabel1.Text.Length != 2)
                {
                    showLog("快递公司信息需填入长度为2的十六进制字符！");
                    return;
                }
                if (tB_GroupLabel2.Text.Length != 4)
                {
                    showLog("货架号信息需填入长度为4的十六进制字符！");
                    return;
                }
                if (tB_GroupLabel3.Text.Length != 8)
                {
                    showLog("时间信息需填入长度为8的十六进制字符！");
                    return;
                }

                //分组标签1
                byte label1 = tools.HexStrToBytes(tB_GroupLabel1.Text)[0];
                //分组标签2
                byte[] label2 = tools.HexStrToBytes(tB_GroupLabel2.Text);
                //分组标签3
                byte[] label3 = tools.HexStrToBytes(tB_GroupLabel3.Text);
                //标签1匹配规则
                byte label1Rule = (byte)cB_GroupLabel1Rule.SelectedIndex;
                //标签2匹配规则
                byte label2Rule = (byte)cB_GroupLabel2Rule.SelectedIndex;
                //标签3匹配规则
                byte label3Rule = (byte)cB_GroupLabel3Rule.SelectedIndex;

                //灯光
                byte rgb = getRgbValue();
                //声音
                byte beep = getBeepValue();
                //亮灯时长
                byte lightWorkTime = getLightWorkTime();
                //闪光间隔
                byte lightIntervalTime = getLightIntervalTime();

                ReaderControllor.SetGroupAcoustOpticTagsWork(currentclient, label1, label2, label3, label1Rule, label2Rule, label3Rule,
                                              rgb, beep, lightWorkTime, lightIntervalTime);
            }
            catch (Exception ex)
            {
                showLog("点亮分组异常=" + ex.Message);
            }
        }

        /// <summary>
        /// 清除灯条号输入框
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void Bn_ClearLightCode_Click(object sender, EventArgs e)
        {
            tB_LightCode.Text = "在此输入需要控制的灯条号，多个灯条号则以;号分割开来。" +
                "例：2503190006;2503190007";

            label_InventoryLightCount.Text = "0";
            lv_LightMessage.Items.Clear();
            multiTagsList = new List<string>();
        }

        /// <summary>
        /// 盘点
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void inventoryLightBtn_Click(object sender, EventArgs e)
        {
            try
            {
                multingFlag = true;
                //盘点灯条数目置0
                label_InventoryLightCount.Text = "0";
                //清空列表
                lv_LightMessage.Items.Clear();
                multiTagsList = new List<string>();
                //窗口不可点击
                this.Enabled = false;
                //执行盘点
                inventoryLight();

                showLog("盘点开始");
            }
            catch (Exception ex)
            {
                multingFlag = false;
                this.Enabled = true;
                showLog("盘点异常=" + ex.Message);
            }
        }


        /// <summary>
        /// 盘点
        /// </summary>
        public void inventoryLight()
        {
            //间隔时间，最小值1000，最大值10000
            int inventoryInterval = int.Parse(tB_InventoryInterval.Text);
            if (inventoryInterval < 1000) tB_InventoryInterval.Text = "1000";//最小值1000
            else if (inventoryInterval > 10000) tB_InventoryInterval.Text = "10000";//最大值10000
            inventoryInterval = int.Parse(tB_InventoryInterval.Text);

            //次数，默认为3
            int inventoryCount = int.Parse(tB_InventoryCount.Text);

            //总次数，最小值1，最大值255
            int inventoryTotal = int.Parse(tB_InventoryTotal.Text);
            if (inventoryTotal < 1) tB_InventoryTotal.Text = "1";//最小值1
            else if (inventoryTotal > 255) tB_InventoryTotal.Text = "255";//最大值255
            inventoryTotal = int.Parse(tB_InventoryTotal.Text);

            ReaderControllor.MultiAcoustOpticTags(currentclient, inventoryInterval,
                inventoryCount, inventoryTotal);
            //启动盘点倒计时
            resetMultiRemainingTimeAndStartTimer(inventoryInterval, inventoryTotal);
        }


        #region 盘点倒计时


        /// <summary>
        /// 重置盘点剩余时间并启动盘点倒计时定时器
        /// </summary>
        /// <param name="inventoryInterval"></param>
        /// <param name="inventoryTotal"></param>
        public void resetMultiRemainingTimeAndStartTimer(int inventoryInterval, int inventoryTotal)
        {
            int multiTimeForSecond = (1500 + inventoryInterval) * inventoryTotal + 10000 + 10000;
            multiTimeForSecond = (multiTimeForSecond + (multiTimeForSecond / 60000) * 10000) / 1000;
            label_InventoryLightCountDownSeconds.Text = multiTimeForSecond.ToString();
            timer_InventoryCountDown.Enabled = true;
        }

        /// <summary>
        /// 盘点倒计时定时器
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void timer_InventoryCountDown_Tick(object sender, EventArgs e)
        {
            int secondTime = int.Parse(label_InventoryLightCountDownSeconds.Text) - 1;
            if (secondTime > 0)//盘点倒计时中
            {
                label_InventoryLightCountDownSeconds.Text = secondTime.ToString();
            }
            else//盘点已结束
            {
                timer_InventoryCountDown.Enabled = false;
                label_InventoryLightCountDownSeconds.Text = "0";
                //盘点标志置为false
                multingFlag = false;
                //恢复窗口可点击状态
                this.Enabled = true;
                showLog("盘点结束");
            }
        }


        #endregion


        /// <summary>
        /// 导出excel
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void exportExcelBtn_Click(object sender, EventArgs e)
        {
            DataTable dt = new DataTable();
            int i, j;
            DataRow dr;
            dt.Clear();
            dt.Columns.Clear();
            //生成DataTable列头
            for (i = 0; i < lv_LightMessage.Columns.Count; i++)
            {
                dt.Columns.Add(lv_LightMessage.Columns[i].Text.Trim(), typeof(String));
            }
            //每行内容
            for (i = 0; i < lv_LightMessage.Items.Count; i++)
            {
                dr = dt.NewRow();
                for (j = 0; j < lv_LightMessage.Columns.Count; j++)
                {
                    dr[j] = lv_LightMessage.Items[i].SubItems[j].Text.Trim();
                }
                dt.Rows.Add(dr);
            }

            SaveFileDialog sfd = new SaveFileDialog();
            sfd.DefaultExt = "xls";
            sfd.Filter = "Excel文件(*.xls)|*.xls";
            // 构造默认文件名
            string defaultFileName = "灯条信息表" + DateTime.Now.ToString("yyyyMMddHHmmss") + ".xls";
            sfd.FileName = defaultFileName;
            if (sfd.ShowDialog() == DialogResult.OK)
            {
                string filename = "灯条信息表";
                NPOIHelper.Export(dt, filename, sfd.FileName);
            }
        }


        #endregion


        /// <summary>
        /// 接收基站设备响应数据
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void ShowData(object sender, Command.ShowEPCEventArgs e)
        {
            System.Diagnostics.Debug.Print("e.CommandRespond=" + e.CommandRespond);
            string[] result = e.CommandRespond.Split(',');
            byte type = tools.HexStrToBytes(result[1])[0];
            switch (type)
            {
                case Types.GET_FIRM_VERSION_RESPOND:
                    label_moduleVer.Text = result[3];
                    break;
                case Types.ACOUSTO_OPTIC_TAGS_WORK://点亮灯条、盘点操作响应(收到该数据表示基站已接受该命令执行)
                case Types.ACOUSTO_OPTIC_TAGS_FUNCTION://更新灯条分组、点亮分组灯条响应(收到该数据表示基站已接受该命令执行)
                    updateControlActionRespond(result);
                    break;
                case Types.ACOUSTO_OPTIC_TAGS_ALARM_RESPOND://灯条低电量预警(低于2.5V)
                    updateMultiTagsNumMessage(result[3], result[4]);
                    updateRecvTagsAlarmRespond(result);
                    break;
            }
        }

        #region 处理响应数据


        /// <summary>
        /// 更新控制结果信息
        /// </summary>
        /// <param name="String"></param>
        /// <param name=""></param>
        public void updateControlActionRespond(string[] result)
        {
            string resultMsg = "";
            if (result[2] == "1") resultMsg = "操作成功";
            else resultMsg = "操作失败";
            showLog(resultMsg);
        }

        /// <summary>
        /// 更新盘点标签数目统计信息
        /// </summary>
        /// <param name="tagsID"></param>
        public void updateMultiTagsNumMessage(string tagsID, string voltage)
        {
            if (!multingFlag) return;//不在盘点中，不统计信息

            if (multiTagsList.Count == 0)
            {
                addLightData(tagsID, voltage);
            }
            else
            {
                bool isExist = false;
                for (int i = 0; i < multiTagsList.Count; i++)
                {
                    if (multiTagsList[i] == tagsID)
                    {
                        isExist = true;
                        break;
                    }
                }

                if (!isExist)
                {
                    addLightData(tagsID, voltage);
                }
            }
        }

        /// <summary>
        /// 添加灯条数据
        /// </summary>
        /// <param name="tagsID"></param>
        /// <param name="voltage"></param>
        public void addLightData(string tagsID, string voltage)
        {
            multiTagsList.Add(tagsID);
            label_InventoryLightCount.Text = multiTagsList.Count.ToString();

            ListViewItem item = new ListViewItem((lv_LightMessage.Items.Count + 1).ToString("D6"));
            item.SubItems.Add(tagsID);//灯条号
            item.SubItems.Add(voltage + "mV");//电压
            item.SubItems.Add(tools.getDateTime());//盘点时间
            lv_LightMessage.Items.Add(item);
            lv_LightMessage.Items[lv_LightMessage.Items.Count - 1].EnsureVisible();
        }

        private int currentColumn = -1; // 当前排序的列索引
        private SortOrder currentSortOrder = SortOrder.None; // 当前排序顺序

        /// <summary>
        /// 列表排序
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void lv_LightMessage_ColumnClick(object sender, ColumnClickEventArgs e)
        {
            // 检查是否点击了相同的列
            if (e.Column == currentColumn)
            {
                // 切换排序顺序
                if (currentSortOrder == SortOrder.Ascending)
                {
                    currentSortOrder = SortOrder.Descending;
                }
                else
                {
                    currentSortOrder = SortOrder.Ascending;
                }
            }
            else
            {
                // 设置新的排序列和顺序
                currentColumn = e.Column;
                currentSortOrder = SortOrder.Ascending;
            }

            // 调用排序方法
            this.lv_LightMessage.ListViewItemSorter = new ListViewItemComparer(e.Column, currentSortOrder);
        }


        /// <summary>
        /// 更新声光标签低电压预警信息
        /// </summary>
        /// <param name="String"></param>
        /// <param name=""></param>
        public void updateRecvTagsAlarmRespond(string[] result)
        {
            if (multingFlag) return;//盘点中时不在信息输出处显示相关信息

            if (lv_Log.Items.Count >= 200) lv_Log.Items.Clear();

            string resultMsg = "";
            if (result[2] == "1")
            {
                resultMsg = "灯条[" + result[3] + "]电压值[" + result[4] + "mv]";
            }
            showLog(resultMsg);
        }


        #endregion


        /// <summary>
        /// 检查更新基站连接状态
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void timer_CheckBaseConnectState_Tick(object sender, EventArgs e)
        {
            if (connectBaseMessage != null)
            {
                string baseIp = connectBaseMessage.Ri;
                string basePort = connectBaseMessage.Rp;

                string baseConnectState = "NG";
                List<AsyncSocketState> baseClients = ReaderControllor.GetClientInfo();
                for (int i = 0; i < baseClients.Count; i++)
                {
                    if (baseClients[i].ip_addr == baseIp &&
                        baseClients[i].port == basePort)
                    {
                        baseConnectState = baseClients[i].state;
                        currentclient = baseClients[i];
                        currentclient.dev_mode = DevTypes.Module;
                    }
                }

                if (baseConnectState == "OK")
                {
                    label_baseState.Text = "连接正常";
                    label_baseState.ForeColor = Color.DarkGreen;

                    if (!isGetModuleVer)
                    {
                        isGetModuleVer = true;//查询模块版本
                        ReaderControllor.GetFirmVersion(currentclient);
                    }
                }
                else
                {
                    label_baseState.Text = "连接异常";
                    label_baseState.ForeColor = Color.DarkRed;
                }
            }
        }


        #region 辅助函数

        /// <summary>
        /// 获取颜色RGB值
        /// </summary>
        /// <returns></returns>
        public byte getRgbValue()
        {
            //灯光
            byte rgb = 0x00;
            if (cB_LightState.Checked)//勾选闪灯
            {
                if (rB_RedLight.Checked) rgb = 0x04;
                else if (rB_YellowLight.Checked) rgb = 0x06;
                else if (rB_BlueLight.Checked) rgb = 0x01;
                else if (rB_GreenLight.Checked) rgb = 0x02;
                else if (rB_CyanLight.Checked) rgb = 0x03;
                else if (rB_WhiteLight.Checked) rgb = 0x07;
                else if (rB_PurpleLight.Checked) rgb = 0x05;
            }
            else//不勾选长亮，最高bit置1
            {
                if (rB_RedLight.Checked) rgb = (byte)0x84;
                else if (rB_YellowLight.Checked) rgb = (byte)0x86;
                else if (rB_BlueLight.Checked) rgb = (byte)0x81;
                else if (rB_GreenLight.Checked) rgb = (byte)0x82;
                else if (rB_CyanLight.Checked) rgb = (byte)0x83;
                else if (rB_WhiteLight.Checked) rgb = (byte)0x87;
                else if (rB_PurpleLight.Checked) rgb = (byte)0x85;
            }
            return rgb;
        }

        /// <summary>
        /// 获取是否发声Beep值
        /// </summary>
        /// <returns></returns>
        public byte getBeepValue()
        {
            byte beep = 0x00;
            if (cB_BeepState.Checked) beep = 0x01;
            return beep;
        }

        /// <summary>
        /// 获取灯条亮灯时间
        /// </summary>
        /// <returns></returns>
        public byte getLightWorkTime()
        {
            if (tB_TagsWorkTime.Text == "") tB_TagsWorkTime.Text = "60";
            byte workTime = (byte)60;
            int workTimeValue = int.Parse(tB_TagsWorkTime.Text);
            if (workTimeValue < 10) tB_TagsWorkTime.Text = "10";//最小值10秒
            else if (workTimeValue > 765) tB_TagsWorkTime.Text = "765";//最大值765
            workTimeValue = int.Parse(tB_TagsWorkTime.Text) / 3;
            workTime = (byte)workTimeValue;
            return workTime;
        }

        /// <summary>
        /// 获取灯条闪光间隔
        /// </summary>
        /// <returns></returns>
        public byte getLightIntervalTime()
        {
            if (tB_TagsIntervalTime.Text == "") tB_TagsIntervalTime.Text = "1";
            byte intervalTime = (byte)1;
            int intervalTimeValue = int.Parse(tB_TagsIntervalTime.Text);
            if (intervalTimeValue > 25) tB_TagsIntervalTime.Text = "25";//最大值25
            intervalTimeValue = int.Parse(tB_TagsIntervalTime.Text) * 10;
            intervalTime = (byte)intervalTimeValue;
            return intervalTime;
        }

        /// <summary>
        /// 获取灯条号集合
        /// </summary>
        /// <param name="lightCode"></param>
        /// <returns></returns>
        public List<byte[]> getLightCodeList(string lightCode)
        {
            string[] lightCodeArray = lightCode.Split(';');

            List<byte[]> lightCodeList = new List<byte[]>();
            byte[] sourcedata;
            byte[] enddata;
            string tagCodeString = "";
            for (int i = 0; i < lightCodeArray.Length; i++)
            {
                tagCodeString = lightCodeArray[i];
                sourcedata = System.BitConverter.GetBytes(uint.Parse(tagCodeString));
                Array.Reverse(sourcedata, 0, sourcedata.Length);
                enddata = new byte[] { sourcedata[0], sourcedata[1], sourcedata[2], sourcedata[3] };
                lightCodeList.Add(enddata);

                //tagCodeString = lightCodeArray[i];
                //lightCodeList.Add(tools.HexStrToBytes(tagCodeString));
            }
            return lightCodeList;
        }


        #endregion


        /// <summary>
        /// 显示log
        /// </summary>
        /// <param name="msg"></param>
        public void showLog(string msg)
        {
            try
            {
                lock (lv_Log)
                {
                    string strDateTime = string.Format("{0:yyyy-MM-dd HH:mm:ss fff}", DateTime.Now);
                    ListViewItem item = new ListViewItem((this.lv_Log.Items.Count + 1).ToString());
                    item.SubItems.Add(strDateTime);
                    item.SubItems.Add(msg);
                    this.lv_Log.Items.Add(item);
                    this.lv_Log.Items[this.lv_Log.Items.Count - 1].EnsureVisible();
                    //this.lv_Log.Items[this.lv_Log.Items.Count - 1].Selected = true;
                }
            }
            catch (Exception ex)
            {

            }
        }


    }
}
