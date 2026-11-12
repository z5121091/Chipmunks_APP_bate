using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace FlashFindWinDemo.UdpUtils
{
    public class UdpHandle
    {
        /// <summary>
        /// Network card collection
        /// </summary>
        UdpClient[] udpClientArray;

        /// <summary>
        /// 发送IP和端口
        /// </summary>
        IPEndPoint targetIpe = new IPEndPoint(IPAddress.Parse("255.255.255.255"), 9002);


        #region UDP接收消息事件

        public event EventHandler<UdpRecvMsgEventArgs> UdpRecvMsgEvent;

        public class UdpRecvMsgEventArgs : EventArgs
        {
            public string msg;

            public UdpRecvMsgEventArgs(string msg)
            {
                this.msg = msg;
            }
        }

        void udpRecvMsgEventLog(UdpRecvMsgEventArgs e)
        {
            if (UdpRecvMsgEvent != null) UdpRecvMsgEvent(this, e);
        }

        #endregion


        /// <summary>
        /// 启动UDP
        /// </summary>
        /// <param name="listenPort"></param>
        public bool startUdp(int listenPort)
        {
            bool ret = false;
            try
            {
                string[] ipStrArray = GetNetIP();
                udpClientArray = new UdpClient[ipStrArray.Length];

                for (int i = 0; i < ipStrArray.Length; i++)
                {
                    IPEndPoint ipe = new IPEndPoint(IPAddress.Parse(ipStrArray[i]), listenPort);
                    udpClientArray[i] = new UdpClient(ipe);
                }

                startRecvDataThread(listenPort);
                ret = true;
            }
            catch (Exception ex)
            { 
            
            }
            return ret;
        }


        /// <summary>
        /// 停止UDP
        /// </summary>
        public void stopUdp()
        {
            try
            {
                stopRecvDataThread();
                if (udpClientArray != null)
                {
                    for (int i = 0; i < udpClientArray.Length; i++)
                    {
                        udpClientArray[i].Close();
                    }
                }
            }
            catch (Exception ex)
            {

            }
        }


        /// <summary>
        /// 广播消息
        /// </summary>
        /// <param name="msg"></param>
        /// <returns></returns>
        public bool sendMsg(string msg)
        {
            bool ret = false;
            try
            {
                int len = 0;
                byte[] msgData = Encoding.UTF8.GetBytes(msg);
                for (int i = 0; i < udpClientArray.Length; i++)
                {
                    len += udpClientArray[i].Send(msgData, msgData.Length, targetIpe);
                }
                ret = true;
            }
            catch (Exception ex)
            {

            }
            return ret;
        }


        #region 接收线程


        Thread recvThread;
        public static UdpClient recvUdpClient;
        public static IPEndPoint RemoteIpEndPoint;
        public static bool ThreadExit = false;

        /// <summary>
        /// 启动接收线程
        /// </summary>
        /// <param name="listenPort"></param>
        public void startRecvDataThread(int listenPort)
        {
            if (recvUdpClient == null)
            {
                //  IPAddress ipaddress = IPAddress.Parse(dev_ip);
                recvUdpClient = new UdpClient(listenPort);
                RemoteIpEndPoint = new IPEndPoint(IPAddress.Any, 0);
                //Create a thread with no parameters
                ThreadExit = false;
                //recvThread = new Thread(new ThreadStart(Thread));
                recvThread = new Thread(recvMsgThread);
                recvThread.Start();
            }
        }

        /// <summary>
        /// 停止接收线程
        /// </summary>
        public void stopRecvDataThread()
        {
            if (recvUdpClient != null)
            {
                recvUdpClient.Close();
                recvUdpClient = null;
                ThreadExit = true;
                recvThread = null;
            }
        }


        /// <summary>
        /// 接收消息
        /// </summary>
        public void recvMsgThread()
        {
            while (!ThreadExit)
            {
                try
                {
                    byte[] receiveBytes = new byte[0];
                    if (recvUdpClient != null) receiveBytes = recvUdpClient.Receive(ref RemoteIpEndPoint);
                    if (receiveBytes.Length > 0)
                    {
                        udpRecvMsgHandle(Encoding.ASCII.GetString(receiveBytes));
                        //recvDataHandle(Encoding.ASCII.GetString(receiveBytes));
                    }
                }
                catch (Exception ex)
                {
                    
                }
            }
        }

        #endregion



        /// <summary>
        /// UDP接收消息事件消息
        /// </summary>
        void udpRecvMsgHandle(string msg)
        {
            udpRecvMsgEventLog(new UdpRecvMsgEventArgs(msg));
        }



        /// <summary>
        /// Obtain the local IPV4 address
        /// </summary>
        public string[] GetNetIP()
        {
            string[] ipStrArray;
            string HostName = Dns.GetHostName(); //Get the host name
            IPHostEntry IpEntry = Dns.GetHostEntry(HostName);

            int count = 0;
            for (int i = 0; i < IpEntry.AddressList.Length; i++)
            {
                if (IpEntry.AddressList[i].AddressFamily == AddressFamily.InterNetwork) count++;
            }

            ipStrArray = new string[count];
            int ipStrArrayWriteIndex = 0;
            for (int i = 0; i < IpEntry.AddressList.Length; i++)
            {
                if (IpEntry.AddressList[i].AddressFamily == AddressFamily.InterNetwork)
                {
                    ipStrArray[ipStrArrayWriteIndex] = IpEntry.AddressList[i].ToString();
                    ipStrArrayWriteIndex++;
                }
            }

            if (ipStrArray.Length == 0 || ipStrArray == null)
            {
                ipStrArray = new string[1];
                ipStrArray[0] = "192.168.1.168";
            }
            return ipStrArray;
        }

    }
}
