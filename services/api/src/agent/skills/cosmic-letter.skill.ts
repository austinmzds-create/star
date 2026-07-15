import { Logger } from '@nestjs/common';
import { OccasionType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppError, ErrorCodes } from '../../common/errors/app-error';
import { CosmicLetterDto } from '../dto/cosmic-letter.dto';
import type { Skill, SkillContext, SkillResult } from '../skill.types';

/** cosmic-letter 输入类型（parseInput 后的强类型）。 */
export interface CosmicLetterInput {
  starNameZh: string;
  constellationZh: string;
  occasion: OccasionType;
  memorialName: string;
  relationTo?: string;
  tone?: 'gentle' | 'warm' | 'solemn' | 'hopeful';
}

export interface CosmicLetterOutput {
  letter: string;
}

/** 场景枚举 → 中文名（用于 user prompt）。 */
const OCCASION_ZH: Record<OccasionType, string> = {
  LOVE: '情侣纪念',
  BIRTHDAY: '生日',
  WEDDING: '婚礼',
  GRADUATION: '毕业',
  NEWBORN: '新生宝宝',
  PET_MEMORIAL: '宠物纪念',
  IN_MEMORIAM: '逝者追思',
  OTHER: '其他纪念',
};

/** 分场景模板（120–160 字，克制温柔，含「登记/安放/纪念」，绝不含官方命名/产权字样）。 */
const TEMPLATES: Record<OccasionType, (i: CosmicLetterInput) => string> = {
  LOVE: (i) =>
    `致${i.relationTo ? i.relationTo : '我心爱的人'}：\n` +
    `今夜，我在${i.constellationZh}为你寻到一颗星，把它以「${i.memorialName}」的名义郑重登记、悄悄安放。` +
    `${i.starNameZh}离我们很远，却年复一年地亮着，像我从不曾说出口、却始终为你留着的那份心意。` +
    `往后每个想你的夜里，抬头就能找到它——那是属于我们的坐标，也是我愿意守望一生的方向。`,

  BIRTHDAY: (i) =>
    `亲爱的${i.relationTo ? i.relationTo : '寿星'}：\n` +
    `生日快乐。我在${i.constellationZh}挑了${i.starNameZh}这颗星，以「${i.memorialName}」的名义为你纪念这一天。` +
    `愿你如它一般，在属于自己的夜空里安静而坚定地发光。` +
    `新的一岁，愿你所求皆有回响，所行皆有星光引路。`,

  WEDDING: (i) =>
    `致${i.memorialName}：\n` +
    `在${i.constellationZh}，${i.starNameZh}被我们共同登记、安放为今日的见证。` +
    `星辰不语，却把此刻的相守记进了漫长的时间里。` +
    `愿这段婚姻如星轨般恒久，纵有岁月流转，你们始终并肩、彼此照亮。`,

  GRADUATION: (i) =>
    `致${i.relationTo ? i.relationTo : '即将启程的你'}：\n` +
    `以「${i.memorialName}」的名义，我把${i.constellationZh}的${i.starNameZh}为你郑重纪念。` +
    `四季寒暑终有尽，而你眼里的光才刚刚开始。` +
    `愿你带着这颗星前行，无论走多远，都记得自己曾如此闪耀，也终将抵达更辽阔的夜空。`,

  NEWBORN: (i) =>
    `致${i.memorialName}：\n` +
    `你来到这个世界的时候，我们在${i.constellationZh}为你安放了${i.starNameZh}，把这份初见郑重登记下来。` +
    `它会一直亮着，像我们对你从不熄灭的祝福。` +
    `愿你慢慢长大，眼里有光，心里有暖，一生被温柔以待。`,

  PET_MEMORIAL: (i) =>
    `致${i.relationTo ? i.relationTo : '最想念的小家伙'}：\n` +
    `我在${i.constellationZh}为你留了一颗星，以「${i.memorialName}」的名义静静安放、纪念。` +
    `${i.starNameZh}会替我继续守着你曾撒欢的那片夜空。` +
    `谢谢你陪过我的那段时光，往后每次抬头，我都知道你在那里，安稳而快乐。`,

  IN_MEMORIAM: (i) =>
    `致${i.relationTo ? i.relationTo : '深深怀念的你'}：\n` +
    `我把${i.constellationZh}的${i.starNameZh}以「${i.memorialName}」的名义郑重纪念、安放。` +
    `它离得很远，却始终亮着，像你从未真正离开，只是换了一种方式陪着我们。` +
    `想你的时候，我便抬头找它——那里有我说不完的话，和永远的思念。`,

  OTHER: (i) =>
    `致${i.memorialName}：\n` +
    `我在${i.constellationZh}为这段心意寻到${i.starNameZh}，郑重登记、静静安放。` +
    `星光穿越漫长的距离抵达此刻，也把这份纪念留在了时间里。` +
    `愿每次抬头，都能想起此刻的珍重与温柔。`,
};

/** 系统提示词（合规红线内嵌）。 */
const SYSTEM_PROMPT = `你是「星辰纪念」平台的文案助手，为用户撰写一封寄往星空的「宇宙来信」。

【任务】
根据用户提供的星体名、星座名、纪念场景、纪念对象与关系，写一封中文短信件。

【硬性要求】
1. 字数：120–200 个汉字（不含标点也大致落在此区间），一段或最多两段，可含一句称呼。
2. 语气：克制、温柔、真诚，避免夸张煽情与华丽堆砌；契合用户给定的场景（情侣/生日/婚礼/毕业/新生/宠物纪念/逝者追思/其他）。
3. 用词：可以使用「登记」「安放」「纪念」「守望」「命名（作为私人纪念）」等措辞。
4. 结尾自然收束，可留一句抬头看星的意象，不要署名、不要日期。

【合规红线（违反视为失败）】
- 不得声称这是官方命名、国际天文学联合会（IAU）认可、政府或任何机构的正式命名。
- 不得声称用户「购买了星星」「拥有星星产权」「永久所有」。
- 这是一份「基于真实星体坐标的私人纪念命名」礼物，只具纪念意义。措辞须体现「以…名义登记/安放/纪念」，而非「买下/拥有」。

【输出】
只输出信件正文本身，不要输出任何解释、标题、Markdown 标记或引号包裹。`;

/**
 * 宇宙来信 Skill：LLM 可用则真调，失败/无 key 回退分场景模板。绝不崩。
 */
export class CosmicLetterSkill implements Skill<CosmicLetterInput, CosmicLetterOutput> {
  readonly code = 'cosmic-letter';
  private readonly logger = new Logger(CosmicLetterSkill.name);

  async parseInput(raw: unknown): Promise<CosmicLetterInput> {
    const dto = plainToInstance(CosmicLetterDto, raw);
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      const details = errors.flatMap((e) => Object.values(e.constraints ?? {}));
      throw new AppError(ErrorCodes.VALIDATION_FAILED, '参数校验失败', details);
    }
    return {
      starNameZh: dto.starNameZh,
      constellationZh: dto.constellationZh,
      occasion: dto.occasion,
      memorialName: dto.memorialName,
      relationTo: dto.relationTo,
      tone: dto.tone,
    };
  }

  async run(
    input: CosmicLetterInput,
    ctx: SkillContext,
  ): Promise<SkillResult<CosmicLetterOutput>> {
    if (ctx.llm.isAvailable() && ctx.llm.kind === 'llm') {
      try {
        const r = await ctx.llm.complete({
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(input) }],
          maxTokens: 512,
          temperature: 0.85,
        });
        return {
          output: { letter: clampLength(r.text) },
          mode: 'llm',
          modelName: r.modelName,
        };
      } catch (e) {
        this.logger.warn(`宇宙来信 LLM 调用失败，降级模板: ${(e as Error).message}`);
        // 落穿到模板
      }
    }
    return {
      output: { letter: renderTemplate(input) },
      mode: 'template',
      modelName: 'template',
    };
  }
}

/** 分场景模板渲染。 */
export function renderTemplate(i: CosmicLetterInput): string {
  return (TEMPLATES[i.occasion] ?? TEMPLATES.OTHER)(i);
}

/** 用户 prompt 拼装。 */
function buildUserPrompt(input: CosmicLetterInput): string {
  return (
    `请为以下场景写一封宇宙来信：\n` +
    `- 星体：${input.starNameZh}（位于${input.constellationZh}）\n` +
    `- 场景：${OCCASION_ZH[input.occasion] ?? '其他纪念'}\n` +
    `- 纪念对象/命名：${input.memorialName}\n` +
    `- 关系：${input.relationTo ?? '未提供'}\n` +
    `- 期望语气：${input.tone ?? '由场景自定'}`
  );
}

/**
 * LLM 偶发超长时按句末标点/换行截到 ≤200 字；保底 ≥120 字不强补（低于则原样返回，不阻断）。
 */
export function clampLength(text: string, max = 200): string {
  const trimmed = text.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= max) return trimmed;
  // 在 max 之前寻找最后一个句末标点/换行断句
  const head = chars.slice(0, max);
  const joined = head.join('');
  const lastBreak = Math.max(
    joined.lastIndexOf('。'),
    joined.lastIndexOf('！'),
    joined.lastIndexOf('？'),
    joined.lastIndexOf('\n'),
  );
  if (lastBreak >= 100) {
    return joined.slice(0, lastBreak + 1);
  }
  return joined;
}
