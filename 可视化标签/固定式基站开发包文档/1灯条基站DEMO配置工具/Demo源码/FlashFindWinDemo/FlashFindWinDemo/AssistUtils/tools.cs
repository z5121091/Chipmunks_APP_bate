using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace FlashFindWinDemo.AssistUtils
{
    public class tools
    {

        /// <summary>
        /// 获取毫秒级时间
        /// </summary>
        /// <returns></returns>
        public static string getDateTime()
        {
            string time = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            //time = time.Replace("-", "").Replace(" ", "").Replace(":", "");
            return time;
        }

        /// <summary>
        /// 字符串转16进制字节数组
        /// </summary>
        /// <param name="hexString"></param>
        /// <returns></returns>
        public static byte[] HexStrToBytes(string hexString)
        {
            hexString = hexString.Replace(" ", "");
            if ((hexString.Length % 2) != 0)
                hexString += " ";
            byte[] returnBytes = new byte[hexString.Length / 2];
            for (int i = 0; i < returnBytes.Length; i++)
                returnBytes[i] = Convert.ToByte(hexString.Substring(i * 2, 2), 16);
            return returnBytes;
        }











    }
}
