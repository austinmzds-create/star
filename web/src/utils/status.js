// 统一状态 → 中文标签 + Element Plus tag 类型(颜色)

export const SAMPLE_STATUS = {
  pending: { label: '待审批', type: 'warning' },
  approved: { label: '待发货', type: 'primary' },
  shipped: { label: '已发货', type: 'info' },
  in_transit: { label: '运输中', type: 'info' },
  signed: { label: '已签收', type: 'success' },
  rejected: { label: '已拒绝', type: 'danger' },
}

export const VIDEO_STATUS = {
  submitted: { label: '待审', type: 'warning' },
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已拒绝', type: 'danger' },
  blocked: { label: '卡审', type: 'warning' },
}

export const PROMO_STATUS = {
  pending_request: { label: '待发起授权', type: 'info' },
  pending_confirm: { label: '待达人确认', type: 'info' },
  authorized: { label: '已授权', type: 'primary' },
  promoted: { label: '已投流', type: 'success' },
  failed: { label: '投流失败', type: 'danger' },
  refused: { label: '达人拒绝', type: 'danger' },
  done: { label: '完成', type: 'success' },
}

export const LOGISTICS_STATUS = {
  shipped: '已揽收', in_transit: '运输中', signed: '已签收',
}

export const PROMO_MODE = { merchant: '商家投流', self: '达人自投' }

export function tag(map, key) {
  return map[key] || { label: key || '—', type: 'info' }
}
