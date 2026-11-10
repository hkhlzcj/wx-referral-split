import type * as wx from "wx-server-sdk";
// 说明：这是给云函数用的 4 张表的"结构定义"（类型提示）。
// 微信云开发里这些不是真实 DDL，只是"契约"：告诉每个云函数读写字段时该写什么。
// 非程序员可以完全忽略本文件，真实字段以 schema/tables.json.md 为准。

/** users */
export interface User {
  _id?: string;
  openid: string;
  unionid?: string;
  nickname?: string;
  inviteCode: string;      // 该用户的专属推荐码
  inviterOpenid?: string; // 谁推荐了我（我的上级）
  createTime: Date;
}

/** orders */
export interface Order {
  _id?: string;
  orderNo: string;
  mchOrderNo: string;
  openid: string;         // 付款人
  inviterOpenid?: string; // 分账对象（推荐人）
  goodsName: string;
  amount: number;         // 单位：分
  commissionRatio: number;
  commissionAmount: number;
  status: "created" | "paid" | "profitsharing" | "finished";
  wxTransactionId?: string;
  wxProfitsharingOrderNo?: string;
  profitShareStatus?: "pending" | "success" | "failed" | "partial";
  payTime?: Date;
  profitShareTime?: Date;
}

/** referrals */
export interface Referral {
  _id?: string;
  openid: string;        // 被推荐人（唯一）
  inviterOpenid: string; // 推荐人
  ratio: number;
  bindTime: Date;
  totalCommission?: number;
}

/** commission_logs */
export interface CommissionLog {
  _id?: string;
  orderNo: string;
  openid: string;
  inviterOpenid: string;
  amount: number;
  wxProfitsharingOrderNo: string;
  wxTransactionId: string;
  status: "pending" | "success" | "failed" | "timeout";
  remark?: string;
  createdTime: Date;
  updatedTime?: Date;
}
