# 微信小程序 · 推荐人分账项目 - 开发骨架

> 技术栈：微信小程序 + 微信云开发 CloudBase（云函数 + 云数据库 + 云存储 + 云调用）
> 合规核心：**微信支付商户 + 官方分账（Profit Sharing）**，你的服务器全程不碰钱，只做"记账 + 发分账指令"，避免二清。
> 面向非程序员：所有代码尽量带中文注释，可直接复制到微信开发者工具里。

## 本目录内容（已生成）

- `schema/tables.json.md` —— 4 张数据库表结构 + 索引说明 + 导入步骤
- `schema/types.d.ts` —— 字段类型契约（可选，供参考）
- `cloudfunctions/createOrder/` —— 云函数1：创建订单 + 统一下单
- `cloudfunctions/payCallback/` —— 云函数2：支付回调验签 + 触发分账
- `cloudfunctions/bindReferrer/` —— 云函数3：扫码绑定推荐人

## 执行顺序（务必按这个走）

**第0步 合规准备（人工，不写代码）**
1. 企业主体注册小程序并认证（300元/年）
2. 开通微信支付商户号，绑定小程序，拿到 `appid / mchid / APIv2密钥 / 分账密钥`
3. 商户后台开通"分账"权限
4. 把"推荐人"加入分账接收方（个人用 openid；大额/高频开特约商户）
5. 确认 10% 分账比例在默认上限(30%)内

**第1步 建云环境**
- 微信开发者工具 → 云开发 → 开通一个云环境（cloud 环境 ID 自动写入 project.config.json）

**第2步 导入 4 张表**
- 读 `schema/tables.json.md`，手动建 4 个集合：`users / orders / referrals / commission_logs` + 索引

**第3步 部署 3 个云函数**
- 逐个右键 `createOrder / payCallback / bindReferrer` → "上传并部署：云端安装依赖"
- 在两个函数的 `index.js` 顶部 `CONFIG` 里填商户号、密钥、appid

**第4步 配支付回调**
- payCallback → 触发器 → 建"HTTP 触发器" → 拿到 `https://xxx.cloudfunctions.net/payCallback`
- 填到【微信支付商户后台 → 开发参数 → 支付结果通知 URL】

**第5步 前端接线**
- 首页 `pages/index`：读 `?inviter=xxx`，调 `bindReferrer`
- 下单页 `pages/goods`：调 `createOrder` → 拿 `payParams` → `wx.requestPayment`
- 佣金页 `pages/commission`：读 `commission_logs` 只读展示

**第6步 验证**
- 1 元小额：扫自己推荐码 → 下单 → 支付 → 看 payCallback 是否自动分账 0.1 元给推荐人

**第7步 提审上线**
- 附合规说明：无资金池、官方分账、仅一级、基于真实商品

## 关键合规提醒（务必读）
- **服务器不碰钱**：分账由微信直接结算到各商户号，你只"发指令 + 记账"
- **只做一级推荐**（本例 10%），别做 2 级以上返利（传销红线）
- 分账接收方要**实名**；个人大额/高频要开**特约商户号**
- 回调**必须验签**（payCallback 已实现），否则订单可被伪造
- 退款要**先回退分账再退款**（`commission_logs` 预留了流水字段，便于对账）
