/**
 * payCallback 云函数 —— 整个项目"合规"的核心
 * --------------------------------------------
 * 微信支付成功后，微信会异步 POST 一个通知到你的 URL。
 * 本函数做三件事：
 *   1. 验签（必须！防止伪造通知）
 *   2. 把订单状态更新为 paid
 *   3. 调微信"官方分账 API"，把佣金(如 10%) 分给推荐人
 *
 * 合规关键（二清规避）：
 *   - 钱从头到尾在你的服务器之外（商户号 → 分账接收方）
 *   - 本函数只"发分账指令 + 记账"，不碰资金池
 *   - 如果订单没有推荐人(inviterOpenid=null)，就跳过分账
 *
 * 暴露方式（非程序员重点）：
 *   微信云开发 → 云函数 → payCallback → 触发器 → "HTTP 触发器"
 *   建好后拿到一个 https://xxx.cloudfunctions.net/payCallback 地址
 *   把这个地址填到【微信支付商户后台 → 账户中心 → 开发参数/密钥 → 支付结果通知 URL】
 */

const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ============ 你填的参数 ============
const CONFIG = {
  MCH_ID: "你的商户号",
  APPID: "你的小程序appid",
  MCH_KEY: "你的商户API密钥v2", // 验签用
  PROFIT_SHARING_KEY: "你的分账API密钥", // 分账接口签名用（若与上面不同）
};

// ------------------------------------------------------------------
// 工具：v2 XML 签名 / 解析
// ------------------------------------------------------------------
const CryptoJS = require("crypto-js");
function makeSign(plain, key) {
  const arr = Object.keys(plain)
    .filter((k) => plain[k] !== "" && plain[k] != null && k !== "key")
    .sort()
    .map((k) => `${k}=${plain[k]}`);
  arr.push(`key=${key}`);
  return CryptoJS.MD5(arr.join("&")).toString(CryptoJS.enc.UpperCase);
}
function parseXml(xml) {
  const out = {};
  const re = /<(\w+)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/\1>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out[m[1]] = m[2];
  return out;
}

// ------------------------------------------------------------------
// 云函数入口（HTTP 触发器会把 body 放在 event 里）
// 微信 v2 回调：body 是 XML，返回必须回 XML（<xml><return_code>SUCCESS</...>）
// ------------------------------------------------------------------
exports.main = async (event, context) => {
  // ① 取请求体（HTTP 触发器下，rawBody 是微信发来的 XML）
  const rawBody = event.rawBody || event.body || event;
  const xml = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);

  // ② 验签：把 XML 解成对象，重算 MD5 与回传的 sign 比对
  const data = parseXml(xml);
  const gotSign = data.sign;
  const delSign = { ...data, sign: undefined }; // 签名不参与验签
  const calcSign = makeSign(delSign, CONFIG.MCH_KEY);
  if (calcSign.toUpperCase() !== (gotSign || "").toUpperCase()) {
    // 验签失败 → 返回 FAIL，微信会重试；同时打日志人工介入
    return { msgtype: "text", content: "FAIL" };
  }

  // ③ 业务判断：只处理"支付成功"
  if (data.return_code === "SUCCESS" && data.result_code === "SUCCESS") {
    const outTradeNo = data.out_trade_no;
    const transactionId = data.transaction_id; // 微信支付交易号（分账要用）

    // ④ 找到订单
    const orderRes = await db.collection("orders")
      .where({ orderNo: outTradeNo })
      .limit(1)
      .get();
    if (orderRes.data.length === 0) {
      // 订单不存在（可能未走本函数创建）→ 记录后返回成功避免微信狂重试
      await db.collection("commission_logs")
        .add({ data: { orderNo: outTradeNo, remark: "orphan_pay_notify", createdTime: db.serverDate() } });
      return { msgtype: "text", content: "SUCCESS" };
    }
    const order = orderRes.data[0];

    // 防重复：若订单已是 paid/profitsharing/finished 直接回成功
    if (["paid", "profitsharing", "finished"].includes(order.status)) {
      return { msgtype: "text", content: "SUCCESS" };
    }

    // ⑤ 更新订单为 paid
    await db.collection("orders")
      .where({ _id: order._id })
      .update({
        data: {
          status: "paid",
          wxTransactionId: transactionId,
          payTime: db.serverDate(),
        },
      });

    // ⑥ 触发"官方分账"（核心合规动作）
    if (order.inviterOpenid && order.commissionAmount > 0) {
      const r = await profitShare({
        outOrderNo: order.orderNo,
        transactionId,
        receiverOpenid: order.inviterOpenid,
        amount: order.commissionAmount,
        remark: `推荐佣金 ${order.goodsName}`,
      });
      // 记录流水
      await db.collection("commission_logs").add({
        data: {
          orderNo: order.orderNo,
          openid: order.openid,
          inviterOpenid: order.inviterOpenid,
          amount: order.commissionAmount,
          wxProfitsharingOrderNo: r.wxProfitsharingOrderNo,
          wxTransactionId: transactionId,
          status: r.status, // success / pending
          remark: r.remark,
          createdTime: db.serverDate(),
        },
      });
      // 更新订单分账状态
      await db.collection("orders")
        .where({ _id: order._id })
        .update({
          data: {
            status: "profitsharing",
            wxProfitsharingOrderNo: r.wxProfitsharingOrderNo,
            profitShareStatus: r.status === "success" ? "success" : "pending",
            profitShareTime: db.serverDate(),
          },
        });
    } else {
      // 无推荐人 → 订单直接 finished
      await db.collection("orders")
        .where({ _id: order._id })
        .update({ data: { status: "finished" } });
    }

    return { msgtype: "text", content: "SUCCESS" }; // 告诉微信"处理成功，别再重发"
  }

  // 非成功通知（退款、关单等）→ 原样回 SUCCESS 防重试，日志留痕
  await db.collection("commission_logs").add({
    data: { remark: "pay_notify_other", data: data, createdTime: db.serverDate() },
  });
  return { msgtype: "text", content: "SUCCESS" };
};

// ------------------------------------------------------------------
// 调微信支付"分账"API（v2 简化，用 out_order_no 标识）
// 真实场景可用 v3 /profitsharing/orders，逻辑一致
// ------------------------------------------------------------------
async function profitShare({ outOrderNo, transactionId, receiverOpenid, amount, remark }) {
  const plain = {
    appid: CONFIG.APPID,
    mch_id: CONFIG.MCH_ID,
    out_order_no: outOrderNo, // 分账业务号（唯一）
    transaction_id: transactionId, // 微信支付成功给的交易号
    receivers: [
      {
        type: "openid", // 个人接收方；若特约商户用 "merchant"
        account: receiverOpenid,
        amount: amount, // 分
        remark: (remark || "佣金").slice(0, 32),
      },
    ],
    nonce_str: Math.random().toString(36).slice(2),
  };
  plain.sign = makeSign(plain, CONFIG.PROFIT_SHARING_KEY);

  const axios = require("axios");
  let result;
  try {
    const resp = await axios.post(
      "https://api.mch.weixin.qq.com/mmpaymkttransapis/profitsharing",
      toXml(plain),
      { headers: { "Content-Type": "text/xml" } }
    );
    const r = parseXml(resp.data);
    if (r.return_code === "SUCCESS") {
      result = {
        status: "success",
        wxProfitsharingOrderNo: r.out_order_no || outOrderNo,
        remark: "分账受理成功",
      };
    } else {
      result = {
        status: "failed",
        wxProfitsharingOrderNo: outOrderNo,
        remark: `分账失败: ${r.return_msg || ""}`,
      };
    }
  } catch (e) {
    result = {
      status: "pending", // 网络异常时不标 failed，等后续对账/重试
      wxProfitsharingOrderNo: outOrderNo,
      remark: "分账请求异常，待人工对账",
    };
  }
  return result;
}

// 复用 toXml（与 createOrder 相同的简化版）
function toXml(obj) {
  let s = `<xml>`;
  for (const k in obj) {
    if (obj[k] === null || obj[k] === undefined) continue;
    // receivers 是数组，需展开
    if (Array.isArray(obj[k])) {
      s += `<${k}>`;
      obj[k].forEach((item, i) => {
        s += `<item>${toXml(item)}</item>`;
      });
      s += `</${k}>`;
    } else {
      s += `<${k}><![CDATA[${obj[k]}]]></${k}>`;
    }
  }
  s += `</xml>`;
  return s;
}
