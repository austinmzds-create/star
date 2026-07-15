import { Module } from '@nestjs/common';
import { CelestialModule } from '../celestial/celestial.module';
import { KeywordModeration } from './moderation/keyword-moderation';
import { CONTENT_MODERATION } from './moderation/moderation.types';
import { MemorialController } from './memorial.controller';
import { MemorialService } from './memorial.service';

/** 纪念登记模块。内容审核经 DI token 绑定占位实现，Phase 3 换云端实现零改动。 */
@Module({
  imports: [CelestialModule],
  controllers: [MemorialController],
  providers: [MemorialService, { provide: CONTENT_MODERATION, useClass: KeywordModeration }],
  exports: [MemorialService],
})
export class MemorialModule {}
