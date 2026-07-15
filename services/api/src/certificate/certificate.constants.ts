/** 证书模块常量：队列名、job 名、存储 DI token、模板版本。 */

/** BullMQ 队列名（有 Redis 时注册）。 */
export const CERT_QUEUE = 'certificate';

/** 证书生成 job 名。 */
export const CERT_JOB = 'generate-certificate';

/** 当前证书模板版本（幂等锚点的一部分：registrationId + templateVersion 唯一）。 */
export const TEMPLATE_VERSION = 'v1';

/** 写文件时拼在 SVG 前的 XML 声明。 */
export const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';
