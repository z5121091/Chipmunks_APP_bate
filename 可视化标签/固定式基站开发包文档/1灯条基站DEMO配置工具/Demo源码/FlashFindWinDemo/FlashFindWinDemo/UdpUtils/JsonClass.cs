using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace FlashFindWinDemo.UdpUtils
{
    public class UdpNetConfigJsonData
    {
        public string SyC { get; set; }
        public string ID { get; set; }
        public string ResultCode { get; set; }

        /// <summary>
        /// 基站版本
        /// </summary>
        public string BaseVersion { get; set; }

        /// <summary>
        /// APP是否处于禁用状态(0:不允许交互；1:允许交互)
        /// </summary>
        public string AppControlStatu { get; set; }

        /// <summary>
        /// 基站与MQTT服务器通信状态(0:无法通信；1:可以通信；2:已连接MQTT服务器)
        /// </summary>
        public string MqttConnectStatu { get; set; }

        public string Mac { get; set; }
        public string Ri { get; set; }
        public string Rp { get; set; }
        public string Sb { get; set; }
        public string Gw { get; set; }
        public string Dns { get; set; }
        public string Si { get; set; }
        public string Sp { get; set; }
        public string Np { get; set; }
        public string Nm { get; set; }

        public string ConnectCount { get; set; }
    }


    public class UdpBaseStationConfigSetJsonData
    {
        public string SyC { get; set; }
        public string SN { get; set; }
        public string MqttUrl { get; set; }
        public string HttpUrl { get; set; }
        public string HttpAppKey { get; set; }
        public string HttpAppSecret { get; set; }
    }

}
