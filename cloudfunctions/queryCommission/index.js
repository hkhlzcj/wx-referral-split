/**
 * queryCommission 云函数
 * ----------------------
 * 职责：以"我作为推荐人(inviterOpenid)"的视角，安全查询我的分账流水与汇总。
 *       服务端自动注入 openid，避免前端直读数据库带来的越权/泄露风险。
 *
 * 调用方式（小程序端）：
 *   const { data } = await wx.cloud.callFunction({ name: "queryCommission" })
 *   data => {
 *     code: 0,
 *     inviteCode: "INV_xxxx",       // 我的专属推荐码（可能为空）
 *     totalSuccess: 分,             // 累计分账成功
 *     totalPending: 分,             // 分账中
 *     failedCount: 笔数,
 *     logs: [ ...commission_logs   // 近 N 条，按时间倒序
 *     ]
 *   }
 */
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID; // 当前用户（被推荐人）
  if (!openid) return { code: 401, msg: "未获取到用户身份" };

  // ① 取我的推荐码（users 表里我的记录）
  const me = await db.collection("users").where({ openid }).limit(1).get();
  const inviteCode = me.data[0] ? me.data[0].inviteCode || "" : "";

  // ② 查"我作为推荐人"的分账流水（别人下单、我拿佣金）
  const logRes = await db.collection("commission_logs")
    .where({ inviterOpenid: openid })
    .limit(50)
    .get();
  const logs = logRes.data || [];

  // ③ 汇总
  let totalSuccess = 0;
  let totalPending = 0;
  let failedCount = 0;
  logs.forEach((l) => {
    if (l.status === "success") totalSuccess += l.amount || 0;
    else if (l.status === "pending") totalPending += l.amount || 0;
    else if (l.status === "failed" || l.status === "timeout") failedCount += 1;
  });

  return {
    code: 0,
    msg: "ok",
    inviteCode,
    totalSuccess,
    totalPending,
    failedCount,
    logs,
  };
};
