/**
 * bindReferrer 云函数
 * -------------------
 * 职责：用户扫码进小程序时，把"推荐人"绑定到"被推荐人"。
 *
 * 规则（防刷、合规）：
 *   - 首次进入才绑定，绑定后不可改（referrals.openid 唯一）
 *   - inviterOpenid 不能是"自己"（不能推荐自己给自己）
 *   - 推荐人必须已存在于 users 表（合法用户）
 *   - 记录分账比例（默认 10%，后续可扩展）
 *
 * 调用方式（小程序端）：
 *   // 扫码或链接进入时，event 带 inviterOpenid
 *   await wx.cloud.callFunction({
 *     name: "bindReferrer",
 *     data: { inviterOpenid }
 *   })
 */
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID; // 被推荐人（当前用户）

  // 支持两种入参：
  //   event.inviteCode  - 分享链接里带的“推荐人专属推荐码”（前端只能拿到这个）
  //   event.inviterOpenid - 直接带推荐人 openid（内部/调试用）
  let inviterOpenid = (event.inviterOpenid || "").trim();
  if (!inviterOpenid && event.inviteCode) {
    const byCode = await db
      .collection("users")
      .where({ inviteCode: event.inviteCode })
      .limit(1)
      .get();
    inviterOpenid = byCode.data[0] ? byCode.data[0].openid : "";
  }
  if (!inviterOpenid) return { code: 0, msg: "无推荐人，不绑定" };
  if (inviterOpenid === openid) return { code: 400, msg: "不能推荐自己" };

  // ② 幂等：如果该用户已经绑定过，直接返回"已绑定"，不覆盖
  const exist = await db.collection("referrals").where({ openid }).limit(1).get();
  if (exist.data.length > 0) {
    return {
      code: 0,
      msg: "已绑定，不可更改",
      inviterOpenid: exist.data[0].inviterOpenid,
    };
  }

  // ③ 校验推荐人存在（是合法用户）
  const inviter = await db.collection("users").where({ openid: inviterOpenid }).limit(1).get();
  if (inviter.data.length === 0) {
    return { code: 404, msg: "推荐人不存在" };
  }

  // ④ 写推荐关系
  await db.collection("referrals").add({
    data: {
      openid,
      inviterOpenid,
      ratio: 0.10, // 默认 10%
      bindTime: db.serverDate(),
      totalCommission: 0,
    },
  });

  // ⑤ 若当前用户在 users 里还没有记录，顺手补一条（保证下单时能查到）
  const me = await db.collection("users").where({ openid }).limit(1).get();
  let inviteCode = me.data[0] ? me.data[0].inviteCode : "";
  const bindMsg = "绑定成功";
  if (me.data.length === 0) {
    inviteCode = `INV_${openid.slice(-8)}`; // 简单生成，正式建议用自增
    await db.collection("users").add({
      data: {
        openid,
        inviterOpenid,
        inviteCode,
        createTime: db.serverDate(),
      },
    });
  }

  return { code: 0, msg: bindMsg, inviterOpenid, inviteCode };
};
