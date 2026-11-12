using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace FlashFindWinDemo.AssistUtils
{
    // ListViewItemComparer 类用于比较ListView中的项
    public class ListViewItemComparer : IComparer
    {
        private int col;
        private SortOrder order;

        public ListViewItemComparer()
        {
            col = 0;
            order = SortOrder.Ascending;
        }

        public ListViewItemComparer(int column, SortOrder sortOrder)
        {
            col = column;
            order = sortOrder;
        }

        public int Compare(object x, object y)
        {
            int returnVal = string.Compare(((ListViewItem)x).SubItems[col].Text, ((ListViewItem)y).SubItems[col].Text);
            // 根据排序顺序决定返回值
            if (order == SortOrder.Descending)
                returnVal *= -1;
            return returnVal;
        }
    }
}
