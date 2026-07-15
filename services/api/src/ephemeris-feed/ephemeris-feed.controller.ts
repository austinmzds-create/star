import { Controller, Get } from '@nestjs/common';
import { EphemerisFeedService } from './ephemeris-feed.service';
import type { MinorBodiesResponse, TleResponse } from './feed.types';

/**
 * 星历订阅接口（跨域冻结契约，全局前缀 /api 由 main.ts 设置）：
 * - GET /api/v1/minor-bodies —— 现役亮彗星 + 三大主带小行星根数（后端只存根数不算轨道）
 * - GET /api/v1/tle —— ISS/CSS/HST 的 TLE（服务端代理 Celestrak，前端不再直连）
 * 两端点三级降级（缓存 → DB → 内置快照），上游宕机时仍 200 且 updatedAt 如实反映批次时间。
 */
@Controller('v1')
export class EphemerisFeedController {
  constructor(private readonly feed: EphemerisFeedService) {}

  @Get('minor-bodies')
  async getMinorBodies(): Promise<MinorBodiesResponse> {
    return this.feed.getMinorBodies();
  }

  @Get('tle')
  async getTle(): Promise<TleResponse> {
    return this.feed.getTle();
  }
}
