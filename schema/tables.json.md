# 数据库表结构 - 微信云开发 CloudBase

> 微信云数据库（MongoDB 风格）**不强制建表**，"表" = "集合(collection)"，字段靠代码动态写入。
> 但为了非程序员好维护，下面把 4 张集合的字段、类型、建议索引都列清楚。

---

## 导入方法（非程序员最省事：手动建集合）

1. 微信开发者工具 → 顶部"云开发"按钮 → 打开控制台
2. 左侧"数据库" → "集合" → 点"添加集合"，依次建 4 个：
   - `users`
   - `orders`
   - `referrals`
   - `commission_logs`
3. 给关键字段**建索引**（右键集合 → 索引管理 → 添加）：
   - `users.openid` 唯一
   - `users.inviteCode` 唯一（分享链路靠它把推荐码解析成推荐人 openid，务必唯一）
   - `orders.orderNo` 唯一
   - `orders.mchOrderNo` 唯一
   - `orders.status` 普通
   - `referrals.openid` 唯一
   - `commission_logs.wxProfitsharingOrderNo` 唯一（分账结果去重用）

> 建完集合就够用了，**不用**手动插入数据；字段会随云函数运行自动产生。

---

## 各集合字段说明

### 1. users（用户表）
| 字段 | 类型 | 说明 |
|---|---|---|
| `openid` | string | 微信 openid，**唯一** |
| `unionid` | string | 可选，跨应用 |
| `nickname` | string | 昵称 |
| `inviteCode` | string | 该用户的专属推荐码（别人扫他时用），建议用 base62(自增id)，**唯一** |
| `inviterOpenid` | string | 谁推荐了我（我的上级），null = 自然流量 |
| `createTime` | date | 注册时间 |

### 2. orders（订单表）
| 字段 | 类型 | 说明 |
|---|---|---|
| `orderNo` | string | 业务订单号（自己生成，唯一） |
| `mchOrderNo` | string | 微信侧商户单号，分账要用，**必须唯一** |
| `openid` | string | 付款人 |
| `inviterOpenid` | string | 该单归属的推荐人（分账对象），null=无推荐 |
| `goodsName` | string | 商品名 |
| `amount` | int | 订单金额，单位**分**（微信要求分） |
| `commissionRatio` | number | 分账比例，0.10 = 10% |
| `commissionAmount` | int | 应分账金额(分) = floor(amount * ratio) |
| `status` | string | created / paid / profitsharing / finished |
| `wxTransactionId` | string | 微信支付成功后回调给的交易号 |
| `wxProfitsharingOrderNo` | string | 发起分账时微信返回的分账单号 |
| `profitShareStatus` | string | pending / success / failed / partial |
| `payTime` / `profitShareTime` | date | 时间 |

### 3. referrals（推荐关系表）
| 字段 | 类型 | 说明 |
|---|---|---|
| `openid` | string | 被推荐人（唯一） |
| `inviterOpenid` | string | 推荐人 |
| `ratio` | number | 该推荐关系适用的分账比例，默认 0.10 |
| `bindTime` | date | 绑定时间（首次扫码） |
| `totalCommission` | int | 该推荐人从此人累计应得佣金(分)，仅展示用 |
| 说明 | - | **绑定后不可改**，防刷 |

### 4. commission_logs（分账流水表）
| 字段 | 类型 | 说明 |
|---|---|---|
| `orderNo` | string | 关联订单 |
| `openid` | string | 付款人 |
| `inviterOpenid` | string | 分账接收方 |
| `amount` | int | 本次分账金额(分) |
| `wxProfitsharingOrderNo` | string | 微信分账单号（**唯一**，去重用） |
| `wxTransactionId` | string | 微信交易号 |
| `status` | string | pending / success / failed / timeout |
| `remark` | string | 备注（对账用） |
| `createdTime` / `updatedTime` | date | 时间 |
