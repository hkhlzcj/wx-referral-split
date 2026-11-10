/**
 * 佣金页 - 展示"我作为推荐人"的累计分账流水
 * --------------------------------------------
 * 数据全部走 queryCommission 云函数（服务端注入 openid，安全鉴权），
 * 前端不再直接读数据库，避免越权 / 数据泄露。
 */
Page({
  data: {
    loading: true,
    inviteCode: "",
    logs: [],
    totalSuccess: 0, // 累计分账成功金额（分）
    totalPending: 0, // 分账中金额（分）
    failedCount: 0,  // 异常笔数
  },

  onShow() {
    this.loadAll();
  },

  async loadAll() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({ name: "queryCommission" });
      const r = res.result || {};
      if (r.code !== 0) {
        wx.showToast({ title: r.msg || "加载失败", icon: "none" });
        return;
      }
      this.setData({
        inviteCode: r.inviteCode || "",
        totalSuccess: r.totalSuccess || 0,
        totalPending: r.totalPending || 0,
        failedCount: r.failedCount || 0,
        logs: this.formatLogs(r.logs || []),
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 金额分→元、时间可读、状态文案
  formatLogs(logs) {
    return logs.map((l) => ({
      ...l,
      amountYuan: ((l.amount || 0) / 100).toFixed(2),
      timeText: this.fmtTime(l.createdTime),
      statusText:
        { success: "已到账", pending: "分账中", failed: "失败", timeout: "超时" }[l.status] ||
        l.status,
    }));
  },

  fmtTime(v) {
    if (!v) return "";
    const d = new Date(v);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  onShareAppMessage() {
    // 把"我的推荐码"带过去，对方进首页后由 bindReferrer 解析成推荐人
    const code = encodeURIComponent(this.data.inviteCode || "");
    return {
      title: "帮我下单，自动分佣",
      path: code ? `/pages/index/index?inviteCode=${code}` : "/pages/index/index",
    };
  },
});
