/**
 * 首页 - 用户进小程序的落地页
 * ----------------------------
 * 职责：
 *   1. 从启动参数里拿到邀请人 inviterOpenid（扫码/分享链接进入时携带）
 *   2. 调 bindReferrer 云函数完成"推荐关系绑定"（幂等，已绑定不覆盖）
 *   3. 展示当前用户身份、绑定的推荐人、专属推荐码
 *   4. 入口跳转到：下单页 / 佣金页
 */
Page({
  data: {
    loading: true,
    // 当前用户信息
    inviteCode: "",
    inviterOpenid: "", // 我的上级（推荐我进来的人，openid）
    bound: false,      // 是否已绑定推荐关系
    bindMsg: "",
  },

  onLoad(options) {
    // 扫码/分享进入，options 里可能带：
    //   inviterOpenid / inviter —— 直接带推荐人 openid
    //   inviteCode              —— 带推荐人专属推荐码（正式分享场景）
    this.pendingInviter = options.inviterOpenid || options.inviter || "";
    this.pendingInviteCode = options.inviteCode || "";
    this.bindReferrer(this.pendingInviter, this.pendingInviteCode);
  },

  onShow() {
    // 每次回到首页刷新绑定状态 + 拉取自己的推荐码
    this.bindReferrer(this.pendingInviter, this.pendingInviteCode);
    this.loadInviteCode();
  },

  // 调云函数绑定推荐关系（异步，不阻塞渲染）
  async bindReferrer(inviterOpenid, inviteCode) {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: "bindReferrer",
        data: { inviterOpenid: inviterOpenid || undefined, inviteCode: inviteCode || undefined },
      });
      const r = res.result || {};
      if (r.code === 0) {
        this.setData({
          bound: !!r.inviterOpenid,
          inviterOpenid: r.inviterOpenid || this.data.inviterOpenid,
          inviteCode: r.inviteCode || this.data.inviteCode,
          bindMsg: r.msg,
        });
      } else {
        wx.showToast({ title: r.msg || "绑定失败", icon: "none" });
      }
    } catch (e) {
      wx.showToast({ title: "网络异常，请稍后重试", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 获取/生成自己的专属推荐码（用于分享给别人）
  async loadInviteCode() {
    try {
      const res = await wx.cloud.callFunction({
        name: "bindReferrer", // 复用：函数内若 users 无记录会自动补一条
        data: {},
      });
      this.setData({
        inviteCode:
          res.result && res.result.inviteCode ? res.result.inviteCode : this.data.inviteCode,
      });
    } catch (e) {
      // 非关键路径，忽略
    }
  },

  // 分享给好友：把我的专属推荐码带过去（对方进入时 bindReferrer 据此解析出推荐人）
  onShareAppMessage() {
    return {
      title: "推荐给我，下单享福利",
      path: `/pages/index/index?inviteCode=${encodeURIComponent(this.data.inviteCode)}`,
    };
  },

  // ============ 页面交互 ============

  // 去下单
  goOrder() {
    wx.navigateTo({ url: "/pages/order/order" });
  },

  // 看佣金
  goCommission() {
    wx.navigateTo({ url: "/pages/commission/commission" });
  },

  // 复制推荐码到剪贴板
  copyInviteCode() {
    if (!this.data.inviteCode) {
      return wx.showToast({ title: "暂无推荐码", icon: "none" });
    }
    wx.setClipboardData({
      data: this.data.inviteCode,
      success: () => wx.showToast({ title: "已复制推荐码" }),
    });
  },
});
