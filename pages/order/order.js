/**
 * 下单页 - 商品 + 金额 + 推荐人，发起支付
 * ----------------------------------------
 * 职责：
 *   1. 用户填写/选择商品名、金额（元，前端输入 → 转分）
 *   2. 携带推荐人 inviterOpenid（来自首页绑定或 URL 参数）
 *   3. 调 createOrder 云函数：落库 + 统一下单，拿到 payParams
 *   4. wx.requestPayment 发起微信支付
 *   5. 支付成功 → 订单状态由 payCallback 回调推进，前端只展示"已提交支付"
 *
 * 合规要点：
 *   - 前端不直接碰钱，只发起支付；分账逻辑全在云函数（payCallback）
 *   - 金额单位：前端收"元"，云函数收"分"，这里负责 ×100 取整
 */
Page({
  data: {
    goodsName: "",      // 商品名
    amountYuan: "",     // 金额（元，字符串，允许输入）
    amountFen: 0,       // 金额（分，提交用）
    inviteCode: "",     // 推荐人专属推荐码（分享链接带过来的）
    inviterOpenid: "",  // 推荐人 openid（内部/调试）
    submitting: false,  // 提交中
    lastOrderNo: "",    // 最近一次订单号（展示用）
  },

  onLoad(options) {
    // 分享/首页传进来的推荐标识：优先 inviteCode，其次 inviterOpenid
    this.setData({
      inviteCode: options.inviteCode || "",
      inviterOpenid: options.inviterOpenid || "",
    });
  },

  // 输入事件
  onGoodsInput(e) {
    this.setData({ goodsName: e.detail.value });
  },

  onAmountInput(e) {
    const yuan = e.detail.value;
    // 限制只能输数字和小数点，最多两位小数
    const cleaned = yuan.replace(/[^\d.]/g, "").replace(/(\.\d{2})\d+/, "$1");
    const amountFen = Math.round(Number(cleaned || 0) * 100); // 元 → 分
    this.setData({
      amountYuan: cleaned,
      amountFen: amountFen,
    });
  },

  // 手动填写推荐码（兜底；正常场景走首页扫码绑定）
  onInviterInput(e) {
    this.setData({ inviteCode: e.detail.value.trim() });
  },

  // 提交下单
  async submitOrder() {
    const { goodsName, amountFen, inviterOpenid, submitting } = this.data;
    if (submitting) return;

    // 基础校验
    if (!goodsName.trim()) {
      return wx.showToast({ title: "请填写商品名", icon: "none" });
    }
    if (!(amountFen > 0)) {
      return wx.showToast({ title: "金额必须大于0", icon: "none" });
    }

    this.setData({ submitting: true });
    try {
      // 调云函数：落库 + 统一下单（推荐标识优先 inviteCode，云函数内解析为 openid）
      const res = await wx.cloud.callFunction({
        name: "createOrder",
        data: {
          goodsName: goodsName.trim(),
          amount: amountFen,
          inviteCode: this.data.inviteCode || null,
          inviterOpenid: this.data.inviterOpenid || null,
        },
      });
      const r = res.result || {};
      if (r.code !== 0 || !r.payParams) {
        wx.showToast({ title: r.msg || "下单失败", icon: "none" });
        return;
      }

      // 发起微信支付
      await this.requestPayment(r.payParams, r.orderNo);
    } catch (e) {
      // 用户取消支付 / 网络异常
      const msg = e.errMsg && e.errMsg.indexOf("cancel") > -1 ? "已取消支付" : "支付发起失败";
      wx.showToast({ title: msg, icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // 封装 wx.requestPayment
  requestPayment(payParams, orderNo) {
    return new Promise((resolve, reject) => {
      wx.requestPayment({
        ...payParams,
        success: () => {
          this.setData({ lastOrderNo: orderNo });
          wx.showToast({ title: "支付成功，等待分账", icon: "success" });
          // 重置金额与商品，方便继续下单；保留推荐人
          this.setData({ goodsName: "", amountYuan: "", amountFen: 0 });
          resolve();
        },
        fail: reject,
      });
    });
  },

  onShareAppMessage() {
    // 分享时带上“我”的推荐码（从首页绑定后缓存到 globalData，这里简化直接拼）
    const code = encodeURIComponent(
      (wx.getStorageSync("myInviteCode") || this.data.inviteCode || "").toString()
    );
    return {
      title: "一起来下单享佣金",
      path: code ? `/pages/index/index?inviteCode=${code}` : "/pages/index/index",
    };
  },
});
