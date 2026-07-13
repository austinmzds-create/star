// 达人 H5 展示用的共享映射与小工具(寄样状态 / 物流 / 快递公司)。
export const SAMPLE_STATUS = {
  pending: '待审批', approved: '待发货', shipped: '已发货',
  in_transit: '运输中', signed: '已签收', rejected: '已拒绝',
}
export const SAMPLE_STATUS_TYPE = {
  pending: 'info', approved: 'warning', shipped: 'primary',
  in_transit: 'primary', signed: 'success', rejected: 'danger',
}
export const VIDEO_STATUS_TYPE = {
  submitted: 'info', approved: 'success', rejected: 'danger', blocked: 'warning',
}
const COURIERS = {
  yuantong: '圆通', zhongtong: '中通', shentong: '申通', yunda: '韵达', shunfeng: '顺丰',
  jtexpress: '极兔', ems: 'EMS', youzhengguonei: '邮政', jd: '京东', huitongkuaidi: '百世',
}

// 寄样状态:已发货时优先用物流态(运输中/已签收)
export function sampleEffStatus(s) {
  if (s.status === 'shipped' && s.logistics_status?.status) return s.logistics_status.status
  return s.status
}
export const sampleLabel = (s) => SAMPLE_STATUS[sampleEffStatus(s)] || sampleEffStatus(s)
export const sampleTagType = (s) => SAMPLE_STATUS_TYPE[sampleEffStatus(s)] || 'info'
export const courierName = (c) => COURIERS[c] || c || ''
export const logiEvents = (s) => s.logistics_status?.events || []
export const logiLast = (s) => s.logistics_status?.last_event || logiEvents(s)[0] || null
