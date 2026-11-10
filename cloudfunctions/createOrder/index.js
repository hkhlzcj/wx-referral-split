/**
 * createOrder 云函数
 * ------------------
 * 职责：
 *   1. 前端传入商品 + 推荐人(inviterOpenid)，生成业务订单（落库 orders）
 *   2. 计算分账金额（按固定比例，如 10%）
 *   3. 调微信"统一下单"拿到支付参数（prepay），返回给前端去 wx.requestPayment
 *
 * 合规要点（二清规避）：
 *   - 本函数【不碰钱】，只生成订单 + 记账 + 发起微信支付
 *   - 钱由用户付给"商户号"，后续由 payCallback 触发"官方分账"给推荐人
 *   - 你的服务器永远没有资金池，只有"该给谁分、分没分成功"的流水
 *
 * 调用方式（小程序端）：
 *   const { data } = await wx.cloud.callFunction({
 *     name: 'createOrder',
 *     data: { goodsName, amount, inviterOpenid }
 *   })
 *   data.payParams → 传给 wx.requestPayment
 */

// 微信云开发 SDK（云函数运行时自带，不用额外装）
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 数据库句柄
const db = cloud.database();
const _ = db.command; // 数据库操作符（用于 $set / $in 等）

// ============ 你填的业务参数（建议放到云环境变量，这里写默认值） ============
const CONFIG = {
  // 微信支付商户号（企业主体）
  MCH_ID: "你的商户号",
  // 小程序 appid
  APPID: "你的小程序appid",
  // 统一下单接口（微信支付 v2/v3 二选一，示例用 v2 更简单）
  // 金额单位：分
  COMMISSION_RATIO: 0.10, // 分账比例 10%
};

// ------------------------------------------------------------------
// 工具：生成一个"唯一业务订单号"（时间戳 + 随机，避免撞号）
// 实际生产建议用雪花ID/Redis自增，非程序员用这个够用
// ------------------------------------------------------------------
function genOrderNo(openid) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  // 微信 mchOrderNo 有长度/字符限制，这里截短一点保证安全
  return `ORD_${ts}_${rand}${openid.slice(-4)}`;
}

// 微信统一下单（v2 XML 接口，最省事）需要的签名
// 注意：v2 用 MD5 签名 + 明文；金额单位分
const CryptoJS = require("crypto-js");
function makeSign(plain, key) {
  // 规则：把 key=value 按 ASCII 升序拼成 & 串，末尾 &key=xxx，再 MD5 转大写
  const arr = Object.keys(plain)
    .filter((k) => plain[k] !== "" && plain[k] != null && k !== "key")
    .sort()
    .map((k) => `${k}=${plain[k]}`);
  arr.push(`key=${key}`);
  const md5 = CryptoJS.MD5(arr.join("&")).toString(CryptoJS.enc.UpperCase);
  return md5;
}

// 把 JS 对象转成 v2 需要的 XML（只处理简单标量，够用）
function toXml(obj) {
  let s = `<xml>`;
  for (const k in obj) {
    if (obj[k] === null || obj[k] === undefined) continue;
    s += `<${k}><![CDATA[${obj[k]}]]></${k}>`;
  }
  s += `</xml>`;
  return s;
}

// 解析 v2 返回的 XML → 对象
function parseXml(xml) {
  const out = {};
  const re = /<(\w+)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/\1>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

// ------------------------------------------------------------------
// 云函数入口
// event 里含： goodsName, amount(分), inviterOpenid(可选)
// ------------------------------------------------------------------
exports.main = async (event) => {
  // ① 拿到当前用户 openid（云函数带 openid 权限时自动注入）
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const goodsName = event.goodsName || "商品";
  const amount = Number(event.amount); // 分
  let inviterOpenid = event.inviterOpenid || null;

  // 解析推荐人：分享链接只带推荐码 inviteCode，需查出对应 openid
  if (!inviterOpenid && event.inviteCode) {
    const byCode = await db
      .collection("users")
      .where({ inviteCode: event.inviteCode })
      .limit(1)
      .get();
    inviterOpenid = byCode.data.length > 0 ? byCode.data[0].openid : null;
  }

  // 基础校验
  if (!openid) return { code: 401, msg: "未获取到用户身份" };
  if (!(amount > 0)) return { code: 400, msg: "金额必须大于0" };

  // ② 生成订单号 + 计算分账金额
  const orderNo = genOrderNo(openid);
  const mchOrderNo = orderNo; // 微信商户单号，这里跟业务号一致即可（唯一）
  const commissionRatio = CONFIG.COMMISSION_RATIO;
  const commissionAmount = Math.floor(amount * commissionRatio); // 向下取整，单位分

  // ③ 写 orders 集合
  const orderDoc = {
    orderNo,
    mchOrderNo,
    openid,
    inviterOpenid, // 可能是 null
    goodsName,
    amount,
    commissionRatio,
    commissionAmount,
    status: "created", // 还没支付
    profitShareStatus: "pending",
    createTime: db.serverDate(),
  };
  await db.collection("orders").add({ data: orderDoc });

  // ④ 调微信"统一下单"（v2），拿到 prepay_id，再组 wx.requestPayment 参数
  // 注意：v2 需要商户 API 密钥（CONFIG.MCH_KEY），签名用
  const MCH_KEY = "你的商户API密钥v2";

  // 统一下单需要"openid"（用户在本商户下的 openid）
  const plain = {
    appid: CONFIG.APPID,
    mch_id: CONFIG.MCH_ID,
    nonce_str: Math.random().toString(36).slice(2),
    body: goodsName.slice(0, 40),
    out_trade_no: mchOrderNo,
    total_fee: amount, // 分
    spbill_create_ip: "127.0.0.1", // 微信要求，填 127.0.0.1 通常可过
    openid: openid,
    trade_type: "JSAPI",
  };
  plain.sign = makeSign(plain, MCH_KEY);

  // 发 HTTPS 请求到微信统一下单接口
  const axios = require("axios");
  let payParams;
  try {
    const resp = await axios.post(
      "https://api.mch.weixin.qq.com/pay/unifiedorder",
      toXml(plain),
      { headers: { "Content-Type": "text/xml" } }
    );
    const r = parseXml(resp.data);
    if (r.return_code !== "SUCCESS" || r.result_code !== "SUCCESS") {
      return {
        code: 500,
        msg: `统一下单失败: ${r.return_msg || ""} ${r.err_code_des || ""}`,
        raw: r,
      };
    }
    // 组装 wx.requestPayment 需要的 5 个字段
    // time/nonce 前端要按微信格式再签一次（下面生成好给前端）
    const t = Math.floor(Date.now() / 1000);
    const nonce2 = Math.random().toString(36).slice(2, 10);
    const signRaw = {
      appId: CONFIG.APPID,
      timeStamp: String(t),
      nonceStr: nonce2,
      package: `prepay_id=${r.prepay_id}`,
      signType: "MD5",
    };
    signRaw.paySign = makeSign(signRaw, MCH_KEY);
    payParams = {
      timeStamp: signRaw.timeStamp,
      nonceStr: signRaw.nonceStr,
      package: signRaw["package"],
      signType: signRaw.signType,
      paySign: signRaw.paySign,
    };
  } catch (e) {
    return { code: 500, msg: "统一下单网络异常", detail: String(e) };
  }

  // ⑤ 返回：订单号 + 前端可直接喂给 wx.requestPayment 的参数
  return {
    code: 0,
    msg: "ok",
    orderNo,
    commissionAmount,
    payParams,
  };
};
