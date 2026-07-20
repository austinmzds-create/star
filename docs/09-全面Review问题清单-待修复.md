# 全面 Review 问题清单(待修复)

> 生成日期:2026-07-20 · 生产环境:talent.jisheng.yun(单台 ECS 北京 5Mbps + nginx + 阿里云 OSS 上海)
>
> 标注说明:`【实测】`= 已在生产或本地实机验证;`【读码】`= 精读源码确认;`【待确认】`= 需生产环境/产品决策。
> 优先级:**P0** = 丢数据/越权/安全漏洞/状态错乱;**P1** = 边界出错/明显性能;**P2** = 可维护性/体验小问题。

---

## ✅ 实施进度(2026-07-20)

已提交到 PR #1 的批次(均含单测,后端 88 / 前端 27 通过):

- **P0(1–8、10)已完成**:商品图封面残留、清空佣金白改、投流失败截图只落 1 张、千川解绑、
  saveInfo 静默、raw_intro 脱敏、停用达人重开、**手机号归一化绑定**、上传白名单(存储型 XSS)。
- **P1 状态机/一致性已完成**:投流防重、删视频留证、签收终态、建联审批快照/失效、寄样并发、
  达人字段校验与置空、H5 抖音号归一化、详情页调级联动佣金。
- **前端加载已完成**:路由懒加载 + vendor 分包(入口从 ~408KB→~5KB gz,刷新命中缓存)。
- **静默失败/竞态已完成**:~20 处写操作补错误提示,5 处列表加 seq 竞态保护。
- **后端性能/完整性已完成**:达人列表 tag 过滤正确性 + 去 N+1、硬删除完整性、热列索引、多 worker、SQLite 告警。

**待用户配合的运维项(代码侧已就绪/无关):见文末「附录 B:生产运维待办」。**

- **P0-9(OSS 公共读写→私有)** 仍需:①你在阿里云改 bucket ACL;②直传链路改签名(单传已可,分片需逐片签名)。
  项 10 已在公共 bucket 现状下先堵死 XSS 出口。
- **索引**:代码已加 `index=True`,但已存在的生产表需手动 `CREATE INDEX`(见附录 B)。
- **index.html 缓存头 / API 走 CDN**:nginx 配置项(见附录 B)。

---

## 〇、先回答你最关心的:刷新后列表 >1s 到底慢在哪

**结论:后端不慢,慢在前端首屏。** 【实测】

| 实测项 | 数据 |
|---|---|
| 后端各列表接口服务端净耗时 | **<30ms**(products/influencers/videos/samples/workbench 全部 <30ms;生产仅 6 产品 2 达人,SQL 不可能慢) |
| JS 主包 | **1.26MB 原始 / 408KB gzip** |
| CSS | 387KB 原始 / 53KB gzip |
| 静态资源 gzip / HTTP/2 / immutable 缓存 | 均已开启 ✅ |
| API JSON gzip | 已开启 ✅ |
| `secret_key` 是否默认值 | 已改,签名不可伪造 ✅ |

**归因链(按影响排序):**
1. **【实测·主因】5Mbps 出口 + 461KB gzip 首屏静态资源**:纯传输就要 ≥0.74s,加 TLS 握手 + TCP 慢启动实际 1–1.5s。SPA 必须先下完并解析 1.26MB JS 才会发第一个列表请求——你在 DevTools 看到的"接口 >1s",大概率是 `stalled/queued`(带宽被 JS/CSS 占满排队),不是接口 TTFB 慢。
2. **【实测】element-plus 全量引入**(`web/src/main.js:1-2`):占 bundle 60–70%。改按需引入预计 JS 408KB→200–250KB gz、CSS 53KB→15–20KB gz,首屏省约 0.37s。
3. **【读码】缩略图带宽竞争**:列表每行 1 张缩略图与 JS/CSS 抢同一条 5Mbps;冷生成时后端要把整张原图从上海 OSS 跨地域拉回北京(见 P1-存储)。
4. **【读码】请求冗余**:workbench 每次进页被打 2 次;Samples 首屏 7 个请求(含全量 products);BlockRecords 有 `await products → 再发 tags/list` 串行链。

> 单靠"后端优化"解决不了这个体感;**要害是前端分包 + 缓存 + 缩略图策略**,详见第五节。

---

## 一、P0 —— 安全 / 丢数据 / 越权(必须优先)

### 落库缺陷(用户改了等于白改)

1. **【实测】商品图删光后,封面 `product_image` 残留旧失效图**
   `products.py:84-89`。`saveInfo` 发 `product_images: []`,后端 `if data.get("product_images")` 对 `[]` 判假 → 不更新封面;`product_image=None` 又被 `if v is None: continue` 跳过。**结果:列表页/详情头/H5 一直显示已删除的失效封面。这就是"失效图反复出现"的根因之一。** → 修:`product_images==[]` 时显式 `p.product_image = None`。

2. **【实测】清空佣金"保存成功"但没落库**
   `Products.vue:853-866` + `products.py:86-89`。el-input-number 清空为 `null` → 后端 `if v is None: continue` 跳过 → 旧值保留,刷新后回来。同类受影响字段:`allow_promotion`、`auto_audit_type`、两个佣金档、`product_image`。 → 修:后端 update 用 `model_dump(exclude_unset=True)` 区分"没传"与"传了null"。

3. **【读码】投流失败上传 3 张截图只落库第 1 张**
   `Videos.vue:404`(`failProofKeys.value[0]`)+ `videos.py:234,249`(`fail_proof_oss_key` 单值)。UI `:max="3"` 允许传 3 张,后 2 张静默丢弃。 → 修:后端改 `fail_proof_oss_keys: list[str]`,或前端 `:max="1"`。

4. **【读码】千川已绑定店铺无法解绑**
   `Products.vue:872` + `products.py:493-500`。清空下拉发 `shop_auth_id: undefined`,后端仅 `is not None` 时赋值 → 解绑无效,响应把旧值回填,用户看到"选择弹回"。 → 修:用 `model_fields_set` 接受显式置空。

5. **【实测】`saveInfo` 整段无 try/catch,保存失败无提示**
   `Products.vue:853-866`。后端 400(如名称全空格)或断网时无任何反馈,用户以为已存 → 关抽屉 → 整表编辑丢失。 → 修:包 try/catch + `ElMessage.error(detail)`。

### 越权 / 隐私

6. **【读码】非归属商务能读到被脱敏的手机号/地址**
   `influencers.py:781`。详情接口对非归属商务把 `real_name/phone/default_address` 脱敏了,但 `raw_intro`(粘贴的自我介绍原文,常含手机号+收件人+地址)**原样返回**,脱敏形同虚设。 → 修:`raw_intro` 也按 `owned` 脱敏。

7. **【读码】停用(archived)达人可用同手机号重新开户,绕过停用**
   `h5.py:75-84`。`sms_verify` 查询带 `archived.is_not(True)`,停用达人查不到 → 走"新建"分支建一条全新档案并发 token。与 `auth.py:106-116`(查到 archived 则 403)口径相反,还会产生同 phone 重复档案。 → 修:查到 archived 直接 403,不新建。

8. **【实测】管理员建档的手机号格式不规范时,达人短信登录进不了那条档案(建重复空号)**
   `h5.py:75-84` + `influencers.py:145`(`_clean_identity` 只 `strip()` 不归一化)。这是你确认的那个点,详见 **第六节专题**。 → 修:手机号入库和登录匹配都统一 normalize(去所有空格/连字符/+86、全角转半角)。

### 安全漏洞

9. **【实测】OSS bucket 公共读写 + 匿名直传 = 全网可覆盖/删除/遍历所有文件**
   `storage.py:53-57`(未配 AK 时 `AnonymousAuth`)。direct-ticket 不签名,URL 规则可枚举,任何人可匿名 PUT/DELETE 整个 bucket(素材、产品图、截图),甚至挂马。 → 修:切私有 bucket + 后端签名 PUT(或 STS);至少关匿名写。**代码已预留 `oss_access_key_id/secret`,配上即走 AK 鉴权。**

10. **【实测】上传无类型白名单 → 存储型 XSS 可偷 token**
   `uploads.py` direct-ticket + `storage.py`。实测:请求 `evil.html` 直接拿到 `materials/xxx.html` 票据、`content_type: text/html`、`preview_url` 走 `/api/files/...html` **inline 下发**。上传 html/svg → 受害者点开 → 执行 JS → 读 `localStorage` 里的 Bearer token(`api.js:6`)。 → 修:服务端强制扩展名+MIME 白名单;非白名单一律 `attachment` + `application/octet-stream`。

### 性能"先炸点"(当前数据量小不慢,量一上来最先出事)

11. **【读码】寄样列表/计数全表拉进内存去重再分页,无 SQL limit**
    `samples.py:60-65,80-91`。10 万单 × 4 实体 join 全量载入 Python;Samples 页并行同时打 list + status-counts = 双份全表扫。 → 修:去重下沉 SQL(窗口函数),count 用 GROUP BY,加 LIMIT/OFFSET。

12. **【读码】workbench 三级 `IN` 全量拉取,还被 30s 轮询 + 每次写操作触发**
    `dashboard.py:29-51` + `AdminLayout.vue:110` + `api.js:11-17`。全部 influencer_id→coop_id→video_id 逐级 `.all()` 再拼巨型 IN;每客户端 30s 一次 + 每次 POST/PUT/DELETE 后再一次。是后台负载放大器。 → 修:改 JOIN + 子查询一条 SQL;badge 用轻量专用接口。

---

## 二、P1 —— 边界出错 / 明显性能

### 状态机 / 并发

- **【读码】投流可重复发起**:`videos.py:209-228` `create_promotion` 无"进行中"校验,双击建两条 Promotion,状态机各自流转产生脏数据。 → 创建前查是否已有非终态 Promotion,有则 409。
- **【读码】已签收单会被退回在途,导致催拍漏扫**:`services/tracking.py:67-73` `_apply_status` 的 elif 含 `"signed"`,已签收单被再次查询可退回 in_transit,而 `followup.py:31` 只扫 `status=="signed"` → 该单从此不再催拍。 → elif 去掉 signed,签收态只进不退。
- **【读码】建联审批基于过期快照,可静默改归属**:`connection_requests.py:98-115`。同一达人多个 pending 申请,先批 A(归属→A)后批 B → 归属被从 A 静默转走,A 无感知。 → 审批通过时作废其余 pending;审批前校验当前归属未变。
- **【读码】视频删除无状态限制,连带删掉已投流留证**:`videos.py:83-92`。与自身 docstring 矛盾,静默删所有 Promotion(含 promoted/done),且无留痕。 → 有非终态/已投流 Promotion 时拒删;删除写 log_op。
- **【读码】寄样并发双审无锁**:`samples.py:176-178` 两请求都读到 pending 时重复写 log_op,且"已处理"返回 404 语义应为 409。 → 乐观更新 `UPDATE...WHERE status='pending'` 判 rowcount。

### 落库 / 数据一致性

- **【读码】PATCH 达人普遍"None 即跳过",可空字段永远无法清空**:`influencers.py:625-651`。phone/uid/tags/gmv_30d/粉丝数 等录错后清不掉。`admin_note` 已用 `model_fields_set` 做对了,其余照抄即可。
- **【读码】更新达人 level/promo_mode 无合法值校验**:`influencers.py:625-634`。传 `level:"L9"` 直接落库,后续 `effective_config` 查不到 → 快照/权益全乱。 → 更新前校验白名单。
- **【读码】详情页保存定级的联动佣金永不生效**:`InfluencerDetail.vue:544-547` + `influencers.py:644-648`。前端总带旧 `commission_tier`,后端"仅当其为 None 才联动"的分支进不去 → L1→L2 佣金不变。 → 用户没手动改佣金时前端不传该字段。
- **【读码】H5 落 douyin_id 未 normalize,撞库口径不一致**:`h5.py:137-141`。内部端去前导 @、H5 没去 → 同一达人两条档案。 → 抽公共 normalize service 统一调用。

### 静默失败(约 25 处写操作无 try/catch)

前端最系统性的问题。失败后弹窗不关、无提示,用户以为成功:
- **关键**:`InfluencerDetail.vue:556-560`(定级/佣金/**归属转移**)、`573-579`(标签,失败后 UI 已改未落库)、`Samples.vue:218-222`(审批通过)、`Products.vue:959-967`(授权增删,且 removeGrant 无二次确认)。
- 其余散见:Videos/BlockRecords/Settings/Workbench/Followups/Influencers 各写操作(详见附录 A)。
- → 建议:封装一个统一的请求 helper(带错误提示),批量替换。

### 竞态(列表页普遍缺保护,仅 Products 抽屉的 openSeq 做对了)

- `Samples.vue:199-214`、`Videos.vue:248-263/367-382`、`Influencers.vue:329-345`、`InfluencerDetail.vue:464-475`、`components/InfluencerSelect.vue:36-45`:快速切分栏/搜索/翻页时旧响应覆盖新响应,列表与选中项不符。 → 加请求序号,`seq !== latest` 丢弃。

### 性能

- **【读码】缩略图冷生成跨地域拉整张原图**:`storage.py:198-214`。本地无缓存时 `b.get_object(key)` 把 1–3MB 原图从上海拉回北京,20 张 = 20–60MB,占满 5Mbps 且占住 uvicorn 线程;还把原图永久写盘(磁盘无限增长)。 → 生成后删原图临时文件;冷启动限并发;THUMB_DIR 定期清理。
- **【读码】缩略图签名每小时轮换 + max-age=3600**:`storage.py` `_stable_exp`。浏览器缓存每小时全失效,缩略图每小时重拉一遍。 → 签名周期拉到天级,`Cache-Control: max-age=86400`。
- **【读码】直传兜底可致同一文件双份 + 孤儿对象**:`materialUpload.js:35-41`。数据已 100% 送达但 onload 迟迟不回 → 20s stall reject → 回退后端用**新 key**再传一份;ticket.key 成孤儿,confirm(10s)vs stall(20s)谁先赢不定。 → stall 前先 HEAD 确认;直传判定成功后不再回退。
- **【读码】缩略图生成失败降级回**整张原图****:`uploads.py:198-204`。96px 位置实际下发几 MB 原图。 → 失败返回占位图或小尺寸。
- **【读码】N+1 与全量下拉**:`influencers.py:552`(`len(r.cooperations)` 每行懒加载)、`influencers.py:884-930`(合作卡每产品 ~11 条 SQL)、`dashboard.py:73-98`(by_bd 每商务 5 条)、`products.py` 无参调用返回全表(Samples/Videos/BlockRecords 下拉全用)。 → group_by 聚合;下拉改分页+搜索。
- **【读码】达人 activity 串行刷物流**:`influencers.py:807-814` + `h5.py:99-100`。逐单 `await refresh_if_needed` 触发外部快递100(15s 超时),多单串行可阻塞详情页数十秒。 → 只读缓存,刷新放后台。

### 部署层

- **【读码/待确认】uvicorn 单 worker**:`Dockerfile:7` 无 `--workers`。冷缩略图/大文件代理会与所有 API 抢同一进程。 → `--workers 2~4` 或 gunicorn。
- **【待确认】生产是否 SQLite**:`config.py:19` 默认 `sqlite`,容器重建即丢数据 + 单写锁(寄样审批/轨迹回调/badge 写并发会 `database is locked`)。 → 进容器执行 `python -c "from app.config import settings; print(settings.database_url)"` 确认;生产强制 Postgres。
- **【读码】素材原文件预览走后端代理**:`uploads.py:115-156`。一个视频预览吃满 5Mbps 拖垮全站。 → 接 OSS 自定义域名/CDN 直连(代码已预留 `oss_public_base_url`)。

---

## 三、P2 —— 可维护性 / 体验小问题(节选)

- **【读码】OSS 孤儿对象**:删素材/产品/内容帖只删 DB 不删 OSS;上传后不保存也留孤儿。 → 后台 GC。(可接受)
- **【读码】MultiUpload remove 不清理 `failed[k]`/`previews[k]`**:`MultiUpload.vue:73-77`,内存微泄漏。
- **【读码】imgPreviewMap 按下标映射,删/调序后 key 与 url 错位**:`Products.vue:501-505`。 → 详情接口返回 `{key:url}` 映射。
- **【读码】saveInfo 成功后只刷列表不刷 detail**:`Products.vue:865`,抽屉头封面/佣金摘要不更新直到重开。`refreshDetail()`(700 行)已定义但从未调用。
- **【读码】撞库大小写口径不一**:导入用 `.lower()`,撞库用 `==`;缺 DB 唯一约束(douyin_id/phone),并发 check-then-insert 可重复建档。
- **【读码】硬删除不清理关联表**:`influencers.py:747-757` 只挡寄样/视频,不管 OrderRecord/OperationLog/ConnectionRequest → PG 下 FK 500 或 SQLite 下孤儿。
- **【读码】缺索引**:`influencers.updated_at`、`products.updated_at`、`sample_orders.status/created_at`、`video_tasks.status/created_at`、`follow_up_tasks.status/assignee`。
- 完整静默失败/竞态清单见附录 A。

---

## 四、前端加载优化(解决"刷新慢"的主战场)

| 项 | 现状 | 收益 | 位置 |
|---|---|---|---|
| element-plus 按需引入 | 全量 408KB gz | JS→200–250KB,CSS→15–20KB,首屏省 ~0.37s | `main.js:1-2` → unplugin-vue-components |
| 路由懒加载 | 18 个视图同步进单包 | H5 与内部端分包,各省 50–100KB | `router.js:1-24` → `()=>import()` |
| vendor 分包 | vue/element-plus 与业务混在一个 hash | 发版只重下业务 chunk(30–60KB)而非全量 | `vite.config.js` → manualChunks |
| index.html 缓存头 | 【待确认】 | 防发版后旧 index 引旧 hash → 404 白屏 | 验证 `curl -sI https://talent.jisheng.yun/ \| grep -i cache-control`;nginx 对 index.html 加 `no-cache` |

---

## 五、建议修复顺序(先不开发,等你拍板)

1. **第一批(安全+丢数据,必做)**:P0 的 1–10。其中 9、10(OSS 私有化+上传白名单)是唯一的对外安全敞口,建议最先;8(手机号绑定)见第六节,和达人登录体验强相关,建议同批做。
2. **第二批(前端体感)**:第四节全部 + P0-12(workbench)+ 缩略图策略(P1-存储 3 条)。这是解决"刷新 >1s"的关键。
3. **第三批(数据一致性)**:P1 状态机 5 条 + PATCH 置空语义 + 统一请求 helper(一次性消掉 25 处静默失败 + 竞态)。
4. **第四批(扩容前)**:全表扫/N+1/缺索引/SQLite→Postgres/多 worker。当前数据量不影响,但上量前必须做。

---

## 六、专题:达人手机号登录绑定(你确认的点)

**你的诉求**:商务/管理员建达人时填了手机号,达人用同一手机号短信验证登录,理应进入那条已建好的档案(而不是新开一个空号)。

**结论:机制方向是对的,但依赖"手机号字符串完全相等",没有格式归一化,所以很容易对不上、悄悄建重复空号。** 下面每条都在本地实机跑过。

### 链路拆解

- 达人登录:`h5.py:71-85` `sms_verify` → `select(Influencer).where(phone == body.phone, archived.is_not(True))`,**精确字符串匹配**;查不到就 `Influencer(nickname="达人后4位", source="h5")` 新建并发 token。
- 短信入口:`h5.py:56-58` `sms_send` 只接受 `len==11 且以 1 开头` 的**裸 11 位号**。
- 管理员建档:`influencers.py:145` `data["phone"] = _clean_identity(...)`,而 `_clean_identity` 只做 `value.strip()`——**只去首尾空格,不动中间空格、连字符、+86、全角数字**。

### 实测结果

| 场景 | 管理员填的手机号 | 达人登录输入 | 结果 |
|---|---|---|---|
| ① 标准格式 | `13900139000` | `13900139000` | ✅ **绑定到管理员那条档案**(id 一致),机制本身没问题 |
| ② 中间带空格 | `138 0013 8002` | `13800138002` | ❌ **新建了一条空号**(source=h5),达人没进准备好的账号,管理员那条(含抖音号/寄样地址)成了孤儿 |

> 场景② 是最常见的踩坑:商务从别处复制手机号,带了空格/`-`/`+86`,或输入法全角数字,就会存成非标准串,达人怎么登都进不去。

### 附带发现(都在本地实测确认)

1. **`is_new` 语义错**(`h5.py:84`):`is_new = inf.raw_intro is None`。场景① 绑定成功,但管理员建档时通常没填 `raw_intro` → **达人虽进对了账号,却被判定为"新用户"提示重新填资料**,体验割裂,还可能让达人覆盖掉管理员填的信息。 → 修:`is_new` 应基于"是否首次登录"(如 `source=='h5' 且从未登录过`),而非 raw_intro。
2. **停用即失效**(P0-7 同源):管理员那条若被 `archived`,`archived.is_not(True)` 过滤掉 → 同样新建空号。
3. **无手机号唯一约束**:一旦产生多条同号,`order_by(id).first()` 取最老那条,不保证是管理员那条;且并发登录可 check-then-insert 出两条空号。
4. **注册顺序依赖**:达人若"先自助注册(空号)、商务后建档",商务建档会被 `_find_duplicate` 以 409 挡下(因为撞库含 phone),商务必须去找那条自动生成的空号编辑,而不是新建——需要在产品流程上明确。

### 建议修法(一处归一化,全链路统一)

- 抽一个 `normalize_phone(raw)`:去所有空格/`-`/`()`、去 `+86`/`86` 前缀、全角转半角,输出裸 11 位;非法返回 None。
- **写入侧**:建档/导入/PATCH/H5 提交,`phone` 一律先过 `normalize_phone` 再落库与撞库比对。
- **读取侧**:`sms_send`/`sms_verify` 收到的 phone 也先 `normalize_phone` 再匹配。
- **存量数据**:上线时跑一次性脚本,把库里已有 phone 归一化(注意归一化后可能撞出重复,需人工合并)。
- 顺带修 `is_new` 语义、给 `phone` 加(归一化后的)唯一约束或部分唯一索引。

---

## 附录 A:静默失败(无 try/catch)完整位置

`InfluencerDetail.vue`:533-554(load)、556-560(save)、561-572(saveAdminNote)、573-579(tag)、381-394(saveEdit)、395-401(toggleArchive)、606-617(delSample/delVideo)、464-491(toggleCollab/loadLogs);
`Products.vue`:507-513(list load)、523-527(saveCreate)、690-710(saveOrder/delOrder)、791-797(delMaterial)、820-829(saveMat)、952-967(grant/qianchuan coop);
`Samples.vue`:179-184、199-214、218-234;
`Videos.vue`:211-222、248-298、367-382;
`BlockRecords.vue`:140-155;`Settings.vue`:99-112;`Workbench.vue`:58;`Followups.vue`:55-65;`Influencers.vue`:329-345、391-399、456-464。

---

## 附录 B:生产运维待办(需在服务器/阿里云控制台执行)

代码侧已就绪或与代码无关,以下需人工操作:

### B1. 补建索引(数据量增长前执行一次)

`create_all` 不会给已存在的表补索引,登录 PostgreSQL 执行:

```sql
CREATE INDEX IF NOT EXISTS ix_sample_orders_status   ON sample_orders(status);
CREATE INDEX IF NOT EXISTS ix_sample_orders_created  ON sample_orders(created_at);
CREATE INDEX IF NOT EXISTS ix_video_tasks_status     ON video_tasks(status);
CREATE INDEX IF NOT EXISTS ix_video_tasks_created    ON video_tasks(created_at);
CREATE INDEX IF NOT EXISTS ix_promotions_auth_status ON promotions(auth_status);
CREATE INDEX IF NOT EXISTS ix_follow_up_tasks_status ON follow_up_tasks(status);
CREATE INDEX IF NOT EXISTS ix_influencers_updated    ON influencers(updated_at);
CREATE INDEX IF NOT EXISTS ix_products_updated       ON products(updated_at);
```

### B2. nginx:index.html 不缓存 + 静态长缓存

保证发版后用户立刻拿到新 index(引用新 hash 资源),而 hash 资源长期缓存:

```nginx
location = /index.html { add_header Cache-Control "no-cache"; }
location /assets/     { add_header Cache-Control "public, max-age=31536000, immutable"; }
client_max_body_size 200m;              # 与后端上传上限一致
```

验证:`curl -sI https://talent.jisheng.yun/ | grep -i cache-control` 应含 `no-cache`。

### B3. 数据库确认为 PostgreSQL

`docker exec <api容器> python -c "from app.config import settings; print(settings.database_url)"`
应为 `postgresql+psycopg://...`;若是 sqlite,启动日志会有 `[启动告警]`,须切 PostgreSQL(否则重建丢数据 + 并发写锁)。

### B4. OSS 私有化(P0-9,需你决策)

现状 bucket「公共读写」= 任何人可匿名上传/覆盖/删除/遍历。建议:
1. 阿里云控制台把 bucket 读写权限改为「私有」;
2. 后端已配 AK(`OSS_ACCESS_KEY_ID/SECRET`),`storage._bucket()` 会用 AK 鉴权;
3. 直传票据需改为签名 PUT URL:单文件直传用 `bucket.sign_url('PUT', key, expires)` 即可;
   大文件分片(视频)需为 initiate/each-part/complete 各签一次——这一步是独立开发项,
   与本轮其余修复解耦,建议约时间一起做(改 bucket ACL 后当前直传会 403,需同步上线签名版)。

### B5. 旧的 0 字节商品图/素材

历史遗留的 0 字节 OSS 对象无法由代码恢复,显示为「图片失效」占位;对应产品/素材请重新上传一次。

### B6. OSS 生命周期规则

给 bucket 配「删除未完成的分片上传(碎片)」规则(如 3 天),回收分片失败残留。
