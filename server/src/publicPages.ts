const page = (title: string, content: string): string => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; font-family: Arial, "Microsoft YaHei", sans-serif; color: #14263a; background: #f5f7fa; }
    * { box-sizing: border-box; }
    body { margin: 0; line-height: 1.7; }
    header, main, footer { width: min(760px, calc(100% - 32px)); margin: 0 auto; }
    header { padding: 48px 0 24px; border-bottom: 1px solid #d8e0e8; }
    h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 28px 0 8px; font-size: 19px; letter-spacing: 0; }
    p, li { font-size: 15px; }
    main { padding: 18px 0 36px; }
    ul { padding-left: 22px; }
    a { color: #175f9d; }
    footer { padding: 20px 0 40px; border-top: 1px solid #d8e0e8; color: #526577; font-size: 13px; }
  </style>
</head>
<body>${content}</body>
</html>`;

export const HOME_PAGE_HTML = page(
  '掌上仓库',
  `<header>
    <h1>掌上仓库</h1>
    <p>上海花栗鼠科技有限公司仓库作业系统</p>
  </header>
  <main>
    <h2>系统说明</h2>
    <p>本系统用于授权员工完成扫码入库、扫码出库、库存盘点、物料绑定及 ERP 库存查询。</p>
    <p><a href="/privacy">隐私政策</a></p>
  </main>
  <footer>
    <div>上海花栗鼠科技有限公司</div>
    <div><a href="https://beian.miit.gov.cn/">苏ICP备2026059103号</a></div>
  </footer>`
);

export const PRIVACY_POLICY_HTML = page(
  '掌上仓库隐私政策',
  `<header>
    <h1>掌上仓库隐私政策</h1>
    <p>更新日期：2026年8月20日</p>
  </header>
  <main>
    <p>掌上仓库是上海花栗鼠科技有限公司供授权仓库人员使用的作业工具。我们只处理完成仓库业务所需的数据。</p>

    <h2>一、处理的数据</h2>
    <ul>
      <li>扫码取得的型号、批次、数量、追溯码、箱号及其他由用户配置的物料字段。</li>
      <li>采购入库单、销售出库单、库存数量、客户或供应商等 ERP 业务数据。</li>
      <li>仓库、物料绑定、解析规则、同步地址和作业记录等应用配置及业务记录。</li>
    </ul>

    <h2>二、处理方式和用途</h2>
    <p>数据用于扫码校验、入库出库、盘点差异、标签与 Excel 导出、数据备份及 ERP 查询。业务记录主要保存在设备本地 SQLite 数据库；启用电脑同步、NAS 备份或 ERP 功能时，相关数据会传输到用户自行配置的服务器、存储设备或畅捷通开放平台。</p>

    <h2>三、设备权限</h2>
    <p>应用使用网络权限连接 ERP、同步服务器及更新服务器。内部部署版本可使用安装应用权限完成用户主动触发的 APK 更新；应用不申请定位、通讯录、相机或麦克风权限。</p>

    <h2>四、共享、保存与删除</h2>
    <p>我们不出售数据，不接入广告或行为分析服务。数据保存期限由企业业务需要和用户配置决定。用户可在应用中清理业务记录，或删除应用以移除设备本地数据；服务器、NAS 和 ERP 中的数据由对应系统管理员管理。</p>

    <h2>五、联系我们</h2>
    <p>
      联系人：刘龙<br>
      手机：17366453168<br>
      邮箱：liulong@chipmunks.com.cn<br>
      上海花栗鼠科技有限公司<br>
      官网：www.chipmunks.com.cn<br>
      地址：江苏省无锡市惠山区国慧商务广场A栋17楼1712室
    </p>
  </main>
  <footer>
    <div>上海花栗鼠科技有限公司</div>
    <div><a href="https://beian.miit.gov.cn/">苏ICP备2026059103号</a></div>
  </footer>`
);
