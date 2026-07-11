/** 纪念册模块常量：队列名、job 名、模板版本。 */

/** BullMQ 队列名（有 Redis 时注册）。 */
export const ALBUM_QUEUE = 'album';

/** 纪念册生成 job 名。 */
export const ALBUM_JOB = 'generate-album';

/** 当前纪念册模板版本（幂等锚点的一部分：registrationId + templateVersion 唯一）。 */
export const TEMPLATE_VERSION = 'v1';
