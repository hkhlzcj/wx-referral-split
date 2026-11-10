/**
 * app.js - 小程序入口
 * 初始化云开发环境（首次进入时执行）
 */
App({
  onLaunch() {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }
    // 初始化云开发环境（env 可留空走默认环境，或指定你的环境 ID）
    wx.cloud.init({
       env: "你的云环境ID",
      traceUser: true,
    });
  },

  globalData: {
    // 当前用户的 openid 缓存（首次拿到后存这里，避免各页重复查）
    openid: "",
  },
});
