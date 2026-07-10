<template>
  <el-card header="寄样管理">
    <p style="color: #909399">
      P0 骨架:待处理申请审批(拒绝理由库)→ 填单号自动识别快递公司并订阅轨迹(快递100)→
      签收后满 N 天(默认7天,配置中心可调)无视频自动生成催拍待办。
    </p>
    <p style="color: #909399">接口已就绪:POST /api/samples、/audit、/ship、/api/webhooks/kd100;列表页开发中。</p>
  </el-card>
</template>
