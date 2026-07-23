<template>
  <div>
    <div class="page-toolbar" style="display:flex; justify-content:space-between; align-items:center">
      <el-input v-model="search" placeholder="搜产品名/店铺" clearable style="width:220px"
        @keyup.enter="reload" @clear="reload" />
      <el-button type="primary" @click="openCreate">+ 新建产品</el-button>
    </div>

    <el-table :data="rows" @row-click="open" style="cursor: pointer">
      <el-table-column label="产品" min-width="260">
        <template #default="{ row }">
          <div class="prod-cell">
            <el-image v-if="row.product_image" :src="row.product_image" fit="cover" class="prod-img">
              <template #error><div class="prod-img placeholder broken" title="图片失效,请重新上传">失效</div></template>
            </el-image>
            <div v-else class="prod-img placeholder"></div>
            <span class="prod-name">{{ row.name }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="shop_name" label="店铺" width="150" />
      <el-table-column label="千川" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="qianchuanTag(row.qianchuan_status).type">
            {{ qianchuanTag(row.qianchuan_status).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="price_text" label="价格" width="90" />
      <el-table-column label="佣金" width="120">
        <template #default="{ row }">
          <div class="commission-cell">
            <span>自然流 {{ pct(row.default_commission) }}</span>
            <span>商家投流 {{ pct(row.merchant_promotion_commission) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="素材" width="70">
        <template #default="{ row }">{{ row.material_count }}</template>
      </el-table-column>
      <el-table-column label="带货达人" width="90">
        <template #default="{ row }">{{ row.application_count || 0 }}</template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag size="small" :type="row.status === 'on' ? 'success' : 'info'">{{ row.status === 'on' ? '上架' : '下架' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建" width="140">
        <template #default="{ row }">{{ ft(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text @click.stop="open(row)">查看</el-button>
          <el-button size="small" text @click.stop="open(row, 'info')">编辑</el-button>
          <el-button size="small" text :type="row.status === 'on' ? 'warning' : 'success'" @click.stop="toggleProduct(row)">
            {{ row.status === 'on' ? '禁用' : '启用' }}
          </el-button>
          <el-button size="small" text type="danger" @click.stop="removeProduct(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination v-if="total > pageSize" background layout="prev, pager, next, total"
      :total="total" :page-size="pageSize" :current-page="page"
      style="margin-top:12px; justify-content:flex-end" @current-change="onPage" />

    <!-- 新建产品 -->
    <el-dialog v-model="createVisible" title="新建产品" width="520px">
      <el-form label-width="90px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="商品图">
          <MultiUpload v-model="form.product_images" :max="6" prefix="product" />
          <span class="muted" style="font-size:12px">首张作封面,可传多张</span>
        </el-form-item>
        <el-form-item label="店铺"><el-input v-model="form.shop_name" /></el-form-item>
        <el-form-item label="价格"><el-input v-model="form.price_text" placeholder="如 30起" /></el-form-item>
        <el-form-item label="抖店链接"><el-input v-model="form.link" /></el-form-item>
        <el-form-item label="自然流佣金%"><el-input-number v-model="form.default_commission" :min="0" :max="50" :step="0.5" /></el-form-item>
        <el-form-item label="商家投流佣金%"><el-input-number v-model="form.merchant_promotion_commission" :min="0" :max="50" :step="0.5" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCreate">保存</el-button>
      </template>
    </el-dialog>

    <!-- 编辑出单 -->
    <el-dialog v-model="editOrderVisible" title="编辑出单" width="420px" append-to-body>
      <el-form label-width="72px">
        <el-form-item label="日期"><el-date-picker v-model="orderEdit.order_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="金额"><el-input-number v-model="orderEdit.amount" :min="0" :precision="2" :controls="false" style="width:100%" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="orderEdit.note" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editOrderVisible = false">取消</el-button>
        <el-button type="primary" @click="saveOrder">保存</el-button>
      </template>
    </el-dialog>

    <!-- 编辑素材 -->
    <el-dialog v-model="editMatVisible" title="编辑素材" width="480px" append-to-body>
      <el-form label-width="80px">
        <el-form-item v-if="matEdit.type !== 'copy'" label="文件">
          <div class="file-edit-row">
            <span class="file-pick-wrap">
              <el-button size="small" :loading="matUploading" :disabled="matUploading">
                {{ matUploading ? '上传中...' : (matEdit.oss_key ? '替换文件' : '上传文件') }}
              </el-button>
              <input v-if="!matUploading" :id="editFileInputId" ref="editFileInput" class="file-overlay-input"
                type="file" :accept="acceptOf(matEdit.type)" title="选择文件上传" @change="handleEditFileChange" />
            </span>
            <span v-if="matUploading" class="muted upload-progress">{{ uploadStatusText }}</span>
            <span v-if="matEdit.title || matEdit.oss_key" class="muted file-name">{{ matEdit.title || '已上传文件' }}</span>
            <el-button v-if="matEdit.oss_key" size="small" text type="danger" @click="clearEditFile">移除文件</el-button>
          </div>
        </el-form-item>
        <el-form-item :label="matEdit.type === 'copy' ? '文案' : '说明文案'">
          <el-input v-model="matEdit.parsed_text" type="textarea" :rows="4"
            :placeholder="matEdit.type === 'copy' ? '文案内容' : '描述这个素材的用途、亮点或拍摄参考'" />
        </el-form-item>
        <el-form-item v-if="matEdit.type === 'video_hot'" label="爆款链接"><el-input v-model="matEdit.source_link" /></el-form-item>
        <el-form-item v-if="matEdit.type === 'pdf'" label="报告ID"><el-input v-model="matEdit.report_id" /></el-form-item>
        <el-form-item label="允许下载"><el-switch v-model="matEdit.downloadable" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editMatVisible = false">取消</el-button>
        <el-button type="primary" @click="saveMat">保存</el-button>
      </template>
    </el-dialog>

    <!-- 产品详情抽屉 -->
    <el-drawer v-model="drawer" :title="detail?.name || '产品详情'" size="760px">
      <el-skeleton v-if="detailLoading && !detail" :rows="8" animated />
      <template v-else-if="detail">
        <!-- 商品卡 -->
        <div class="prod-head">
          <el-image v-if="detail.product_image" :src="detail.product_image" fit="cover" class="head-img">
            <template #error><div class="head-img placeholder broken" title="图片失效,请重新上传">失效</div></template>
          </el-image>
          <div v-else class="head-img placeholder"></div>
          <div class="head-info">
            <div class="head-name">{{ detail.name }}</div>
            <div class="muted" style="font-size:13px">
              {{ detail.shop_name }} · {{ detail.price_text }} · 自然流佣金 {{ pct(detail.default_commission) }} · 商家投流佣金 {{ pct(detail.merchant_promotion_commission) }}
            </div>
            <CopyText v-if="detail.link" :value="detail.link" style="margin-top:6px" />
          </div>
          <div style="display:flex; flex-direction:column; gap:6px">
            <el-button size="small" :type="detail.status === 'on' ? 'warning' : 'success'" @click="toggleProduct(detail)">
              {{ detail.status === 'on' ? '禁用' : '启用' }}
            </el-button>
            <el-button size="small" type="danger" plain @click="removeProduct(detail)">删除</el-button>
          </div>
        </div>

        <el-tabs v-model="dtab" style="margin-top:8px">
          <!-- 商品信息 -->
          <el-tab-pane label="商品信息" name="info">
            <el-form label-width="88px" style="max-width:560px">
              <el-form-item label="名称"><el-input v-model="detail.name" /></el-form-item>
              <el-form-item label="商品图">
                <MultiUpload v-model="detail.product_images_keys" :max="6" prefix="product"
                  :initial-previews="imgPreviewMap" />
                <span class="muted" style="font-size:12px">首张作封面</span>
              </el-form-item>
              <el-form-item label="店铺"><el-input v-model="detail.shop_name" /></el-form-item>
              <el-form-item label="价格"><el-input v-model="detail.price_text" placeholder="如 30起" /></el-form-item>
              <el-form-item label="抖店商品ID"><el-input v-model="detail.shop_product_id" /></el-form-item>
              <el-form-item label="抖店链接"><el-input v-model="detail.link" /></el-form-item>
              <el-form-item label="自然流佣金%"><el-input-number v-model="detail.default_commission" :min="0" :max="50" :step="0.5" /></el-form-item>
              <el-form-item label="商家投流佣金%"><el-input-number v-model="detail.merchant_promotion_commission" :min="0" :max="50" :step="0.5" /></el-form-item>
              <el-form-item label="卖点"><el-input v-model="detail.selling_points" type="textarea" :rows="2" /></el-form-item>
              <el-form-item label="拍摄要求"><el-input v-model="detail.shooting_notes" type="textarea" :rows="2" /></el-form-item>
              <el-form-item label="寄样备注"><el-input v-model="detail.sample_remark" type="textarea" :rows="2" /></el-form-item>
              <el-form-item label="带货备注"><el-input v-model="detail.promo_remark" type="textarea" :rows="2" placeholder="如:孩子太小的话就不要出镜,打码也不行" /></el-form-item>
              <el-form-item label="一键审核">
                <el-segmented v-model="detail.auto_audit_type" :options="AUDIT_TYPES" />
              </el-form-item>
              <el-form-item label="允许带货">
                <el-segmented v-model="detail.allow_promotion" :options="[{label:'允许',value:true},{label:'不允许',value:false}]" />
              </el-form-item>
              <el-button type="primary" @click="saveInfo">保存</el-button>
            </el-form>
          </el-tab-pane>

          <!-- 素材 -->
          <el-tab-pane :label="`素材 ${materialCount}`" name="materials">
            <!-- 统一上传入口:点开在弹框里选类型,传完直接进对应类型 tab -->
            <div class="tab-toolbar">
              <el-button size="small" type="primary" @click="openUpload()">+ 上传素材</el-button>
            </div>
            <div v-if="detail.application_overview" class="application-overview">
              <div class="overview-stat">
                <span>带货达人</span><b>{{ detail.application_overview.counts?.total || 0 }}</b>
              </div>
              <div class="overview-stat warn">
                <span>审核中</span><b>{{ detail.application_overview.counts?.pending || 0 }}</b>
              </div>
              <div class="overview-stat">
                <span>待发货</span><b>{{ detail.application_overview.counts?.approved || 0 }}</b>
              </div>
              <div class="overview-stat">
                <span>已发货</span><b>{{ detail.application_overview.counts?.shipped || 0 }}</b>
              </div>
              <div class="overview-stat">
                <span>运输中</span><b>{{ detail.application_overview.counts?.in_transit || 0 }}</b>
              </div>
              <div class="overview-stat ok">
                <span>已签收</span><b>{{ detail.application_overview.counts?.signed || 0 }}</b>
              </div>
              <div class="overview-stat danger">
                <span>已拒绝</span><b>{{ detail.application_overview.counts?.rejected || 0 }}</b>
              </div>
              <div class="overview-stat">
                <span>已取消</span><b>{{ detail.application_overview.counts?.cancelled || 0 }}</b>
              </div>
              <div class="overview-stat">
                <span>视频</span><b>{{ detail.application_overview.video_count || 0 }}</b>
              </div>
              <div class="overview-stat">
                <span>GMV</span><b>¥{{ Number(detail.application_overview.gmv || 0).toFixed(2) }}</b>
              </div>
              <router-link class="overview-link" :to="{ path: '/applications', query: { q: detail.name, tab: 'all' } }">
                查看带货管理
              </router-link>
            </div>
            <div v-if="detail.application_overview?.items?.length" class="application-chips">
              <span v-for="item in detail.application_overview.items.slice(0, 8)" :key="item.id" class="app-chip">
                {{ item.nickname }}
                <em>{{ applicationStatusLabel(item.status) }}</em>
              </span>
            </div>
            <el-tabs v-model="mtype" tab-position="left" class="mat-tabs">
              <el-tab-pane v-for="t in visibleMatTypes" :key="t.v" :label="`${t.l} ${countOf(t.v)}`" :name="t.v">
                <!-- 列表 -->
                <div v-for="m in materialsOf(t.v)" :key="m.id" class="material-card">
                  <div class="material-card-head">
                    <el-tag size="small">{{ MAT_TYPES.find((item) => item.v === m.type)?.l }}</el-tag>
                    <el-tag v-if="m.type === 'video_output'" size="small" :type="m.is_public ? 'success' : 'info'">
                      {{ m.is_public ? '已公开' : '未公开' }}
                    </el-tag>
                    <span v-if="m.title" class="muted material-file-name">{{ m.title }}</span>
                    <div class="mat-ops">
                      <el-button v-if="m.type === 'video_output' && isAdmin" size="small" text
                        :type="m.is_public ? 'warning' : 'success'" @click="togglePublish(m)">
                        {{ m.is_public ? '取消公开' : '公开' }}
                      </el-button>
                      <el-button v-if="canMaintainMaterial(m)" size="small" text type="primary" @click="openEditMat(m)">编辑</el-button>
                      <el-button v-if="canMaintainMaterial(m)" size="small" text type="danger" @click="delMaterial(m)">删除</el-button>
                    </div>
                  </div>
                  <MaterialPreview :material="m" />
                  <div v-if="m.type === 'video_output'" class="video-comment-panel">
                    <div class="comment-head">
                      <span>评论 {{ m.comment_count || (m.comments || []).length || 0 }}</span>
                      <span class="muted">商务/管理员反馈会同步给达人端</span>
                    </div>
                    <div v-if="(m.comments || []).length" class="comment-list">
                      <div v-for="c in m.comments" :key="c.id" class="comment-item">
                        <div class="comment-meta">
                          <span class="comment-author">{{ c.author_name || '内部人员' }}</span>
                          <el-tag size="small" effect="plain">{{ c.author_role === 'admin' ? '管理员' : '商务' }}</el-tag>
                          <span class="muted">{{ ft(c.created_at) }}</span>
                        </div>
                        <div v-if="c.body" class="comment-body">{{ c.body }}</div>
                        <div v-if="c.attachments?.length" class="comment-attachments">
                          <a v-for="a in c.attachments" :key="a.id" :href="a.download_url || a.url"
                            target="_blank" rel="noopener" class="comment-file">
                            {{ fileTypeLabel(a.file_type) }} {{ a.filename || '附件' }}
                          </a>
                        </div>
                      </div>
                    </div>
                    <div v-else class="muted empty-comment">暂无评论</div>
                    <div class="comment-compose">
                      <el-input v-model="commentForm(m).body" type="textarea" :rows="3"
                        maxlength="2000" show-word-limit placeholder="写给达人的修改意见、交付反馈或补充说明" />
                      <div class="comment-compose-actions">
                        <span class="file-pick-wrap">
                          <el-button size="small" :loading="commentForm(m).uploading" :disabled="commentForm(m).uploading">
                            上传附件
                          </el-button>
                          <input v-if="!commentForm(m).uploading" class="file-overlay-input" type="file" multiple
                            accept="image/*,video/*,application/pdf" title="选择评论附件"
                            @change="handleCommentFileChange($event, m)" />
                        </span>
                        <span v-if="commentForm(m).uploading" class="muted upload-progress">
                          {{ commentForm(m).stage === 'confirming' ? '正在确认...' : `上传中 ${commentForm(m).progress}%` }}
                        </span>
                        <el-button size="small" type="primary" :loading="commentForm(m).saving"
                          :disabled="commentForm(m).uploading" @click="submitMaterialComment(m)">
                          提交评论
                        </el-button>
                      </div>
                      <div v-if="commentForm(m).attachments.length" class="comment-draft-files">
                        <el-tag v-for="(a, idx) in commentForm(m).attachments" :key="`${a.oss_key}-${idx}`"
                          closable @close="removeCommentAttachment(m, idx)">
                          {{ a.filename }}
                        </el-tag>
                      </div>
                    </div>
                  </div>
                </div>
                <el-empty v-if="!materialsOf(t.v).length" :description="`暂无${t.l}`" :image-size="50" />
              </el-tab-pane>
            </el-tabs>
          </el-tab-pane>

          <!-- 带货达人 -->
          <el-tab-pane label="带货达人" name="applications">
            <div class="mat-add">
              <InfluencerSelect v-model="applicationInfluencerId" style="flex:1" />
              <el-button type="primary" size="small" :disabled="!applicationInfluencerId"
                :loading="addingApplication" @click="addApplication">
                添加带货
              </el-button>
              <router-link class="overview-link" :to="{ path: '/applications', query: { q: detail.name, tab: 'all' } }">
                完整管理
              </router-link>
            </div>
            <el-table :data="detail.application_overview?.items || []" size="small">
              <el-table-column label="达人" min-width="120">
                <template #default="{ row }">
                  <router-link :to="`/influencers/${row.influencer_id}`" class="link">{{ row.nickname }}</router-link>
                </template>
              </el-table-column>
              <el-table-column prop="douyin_id" label="抖音号" />
              <el-table-column prop="owner_bd_name" label="归属商务" width="100" />
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag size="small" :type="applicationStatusTag(row.status)">{{ applicationStatusLabel(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="视频/GMV" width="150">
                <template #default="{ row }">视频 {{ row.video_count || 0 }} / ¥{{ Number(row.gmv || 0).toFixed(2) }}</template>
              </el-table-column>
              <el-table-column label="更新" width="120"><template #default="{ row }">{{ ft(row.updated_at) }}</template></el-table-column>
            </el-table>
            <el-empty v-if="!detail.application_overview?.items?.length" description="暂无带货达人" :image-size="50" />
          </el-tab-pane>

          <!-- 千川店铺绑定 -->
          <el-tab-pane label="千川店铺绑定" name="qianchuan">
            <div class="qianchuan-head">
              <div>
                <el-tag size="small" :type="qianchuan.configured ? 'success' : 'warning'">
                  {{ qianchuan.configured ? '已维护店铺映射' : '未绑定店铺' }}
                </el-tag>
                <el-tag size="small" style="margin-left:6px" :type="qianchuan.can_start_oauth ? 'primary' : 'info'">
                  {{ qianchuan.can_start_oauth ? '可发起授权' : '待配置开放平台' }}
                </el-tag>
                <el-tag size="small" style="margin-left:6px" :type="qianchuan.can_sync_cooperation ? 'success' : 'info'">
                  {{ qianchuan.can_sync_cooperation ? '合作同步可用' : '合作同步待接入' }}
                </el-tag>
              </div>
              <div class="qc-actions">
                <el-button size="small" @click="loadShopAuths">刷新授权店铺</el-button>
                <el-button size="small" type="primary" :disabled="!qianchuan.can_start_oauth"
                  :loading="startingOauth" @click="startQianchuanOauth">
                  跳转授权千川店铺
                </el-button>
              </div>
            </div>
            <el-alert v-if="!qianchuan.can_start_oauth" type="warning" :closable="false" show-icon
              :title="`待配置: ${(qianchuan.missing_config || []).join(' / ') || '开放平台参数'}`" />
            <el-form label-width="110px" style="max-width:580px">
              <el-form-item label="已授权店铺">
                <el-select v-model="qianchuan.shop_auth_id" clearable filterable placeholder="选择已授权店铺"
                  style="width:100%" @change="applyShopAuth">
                  <el-option v-for="shop in qianchuanShopAuths" :key="shop.id"
                    :label="shopAuthLabel(shop)" :value="shop.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="本地状态">
                <el-segmented v-model="qianchuan.bind_status" :options="QIANCHUAN_STATUS_OPTIONS" />
              </el-form-item>
              <el-form-item label="千川店铺ID"><el-input v-model="qianchuan.shop_id" /></el-form-item>
              <el-form-item label="千川店铺名"><el-input v-model="qianchuan.shop_name" /></el-form-item>
              <el-form-item label="广告主ID"><el-input v-model="qianchuan.advertiser_id" /></el-form-item>
              <el-form-item label="千川商品ID"><el-input v-model="qianchuan.qianchuan_product_id" /></el-form-item>
              <el-form-item label="备注"><el-input v-model="qianchuan.remark" type="textarea" :rows="3" /></el-form-item>
              <el-button type="primary" :loading="savingQianchuan" @click="saveQianchuan">保存本地映射</el-button>
            </el-form>

            <el-divider>达人合作绑定</el-divider>
            <div class="mat-add">
              <InfluencerSelect v-model="qcCoopForm.influencer_id" style="flex:1" />
              <el-input v-model="qcCoopForm.qianchuan_cooperation_id" placeholder="千川合作ID" style="width:180px" />
              <el-input v-model="qcCoopForm.remark" placeholder="备注(选填)" style="width:160px" />
              <el-button type="primary" size="small" :loading="bindingQcCoop" @click="bindQianchuanCoop">
                绑定合作ID
              </el-button>
              <el-button size="small" :disabled="!canSyncQianchuanCoop" :loading="syncingQcCoop"
                @click="syncQianchuanCoop">
                从已授权店铺同步
              </el-button>
              <span class="muted" style="font-size:12px">{{ qianchuanSyncText }}</span>
            </div>
            <el-table :data="qianchuanCoops" size="small">
              <el-table-column prop="influencer_nickname" label="达人" />
              <el-table-column prop="douyin_id" label="抖音号" width="120" />
              <el-table-column prop="qianchuan_cooperation_id" label="千川合作ID" width="150" />
              <el-table-column label="方式" width="90">
                <template #default="{ row }">{{ row.bind_method === 'manual_id' ? '手动ID' : '店铺授权' }}</template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }"><el-tag size="small">{{ row.bind_status }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="last_error" label="异常" width="120" show-overflow-tooltip />
              <el-table-column prop="remark" label="备注" show-overflow-tooltip />
              <el-table-column width="70">
                <template #default="{ row }">
                  <el-button size="small" text type="danger" @click="removeQianchuanCoop(row)">移除</el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-if="!qianchuanCoops.length" description="暂无千川合作绑定" :image-size="50" />
          </el-tab-pane>

          <!-- 出单登记(GMV) -->
          <el-tab-pane label="出单登记" name="orders">
            <div class="mat-add">
              <InfluencerSelect v-model="orderForm.influencer_id" style="flex:1" />
              <el-date-picker v-model="orderForm.order_date" type="date" placeholder="出单日期"
                value-format="YYYY-MM-DD" style="width:150px" />
              <el-input-number v-model="orderForm.amount" :min="0" :precision="2" placeholder="金额" :controls="false" style="width:120px" />
              <el-input v-model="orderForm.note" placeholder="备注(选填)" style="width:140px" />
              <el-button type="primary" size="small" @click="addOrder">登记</el-button>
            </div>
            <el-table :data="orders" size="small">
              <el-table-column prop="influencer_nickname" label="达人" />
              <el-table-column prop="order_date" label="日期" width="120" />
              <el-table-column label="金额" width="110"><template #default="{ row }">¥{{ row.amount }}</template></el-table-column>
              <el-table-column prop="note" label="备注" show-overflow-tooltip />
              <el-table-column width="110"><template #default="{ row }">
                <el-button size="small" text @click="openEditOrder(row)">改</el-button>
                <el-button size="small" text type="danger" @click="delOrder(row)">删</el-button>
              </template></el-table-column>
            </el-table>
            <el-empty v-if="!orders.length" description="暂无出单登记" :image-size="50" />
            <div class="muted" style="text-align:right; margin-top:8px">合计 GMV: ¥{{ orderTotal.toFixed(2) }}</div>
          </el-tab-pane>

          <!-- 动态 -->
          <el-tab-pane label="动态" name="activity">
            <div class="section-title">寄样 {{ act.samples.length }}</div>
            <div v-for="s in act.samples" :key="'s'+s.id" class="mat-row">
              <span>{{ s.nickname }}</span>
              <el-tag size="small" :type="sampleTag(s.status).type">{{ sampleTag(s.status).label }}</el-tag>
              <span class="muted">{{ ft(s.created_at) }}</span>
            </div>
            <el-empty v-if="!act.samples.length" description="暂无寄样" :image-size="40" />
            <div class="section-title" style="margin-top:16px">视频 {{ act.videos.length }}</div>
            <div v-for="v in act.videos" :key="'v'+v.id" class="mat-row">
              <span>{{ v.nickname }}</span>
              <el-tag size="small" :type="videoTag(v.status).type">{{ videoTag(v.status).label }}</el-tag>
              <span class="muted">{{ ft(v.created_at) }}</span>
            </div>
            <el-empty v-if="!act.videos.length" description="暂无视频" :image-size="40" />
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-drawer>

    <!-- 上传素材:先选类型,再传文件/填内容,传完进对应类型 tab -->
    <el-dialog v-model="uploadVisible" title="上传素材" width="480px" append-to-body>
      <el-form label-width="64px">
        <el-form-item label="类型">
          <el-select v-model="uploadForm.type" style="width:100%" @change="onUploadTypeChange">
            <el-option v-for="t in uploadMatTypes" :key="t.v" :label="t.l" :value="t.v" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="uploadForm.type !== 'copy'" label="文件">
          <div class="upload-file-box">
            <span class="file-pick-wrap">
              <el-button size="small" type="primary" :loading="matUploading" :disabled="matUploading">
                {{ matUploading ? '上传中...' : (uploadIsBatch ? '选择视频(可多选)' : (uploadForm.oss_key ? '重新上传文件' : '选择文件上传')) }}
              </el-button>
              <input v-if="!matUploading" :id="uploadFileInputId" ref="uploadFileInput" class="file-overlay-input"
                type="file" :accept="acceptOf(uploadForm.type)" :multiple="uploadIsBatch"
                title="选择文件上传" @change="handleUploadFileChange" />
            </span>
            <span v-if="matUploading" class="muted upload-progress">{{ uploadStatusText }}</span>
            <template v-if="uploadForm.oss_key && !matUploading && !uploadIsBatch">
              <span class="muted file-name">{{ uploadForm.file_name || '已上传文件' }}</span>
              <el-button size="small" text type="danger" @click="clearUploadFile">移除</el-button>
            </template>
          </div>
          <div v-if="uploadIsBatch" class="muted" style="font-size:12px;margin-top:4px">
            可一次选多个视频,上传后每个自动生成一条 AI 视频(无需填文案)
          </div>
          <!-- 回显:上传成功后预览,确认无误再点「添加」入库(批量模式自动入库,不回显) -->
          <div v-if="uploadForm.oss_key && !matUploading && !uploadIsBatch" class="upload-preview">
            <el-image v-if="uploadIsImage" :src="uploadForm.url" fit="contain" class="up-img" />
            <video v-else-if="uploadIsVideo && uploadForm.url" :src="uploadForm.url" class="up-video" controls preload="metadata" />
            <a v-else :href="uploadForm.url" target="_blank" class="up-file">已上传:{{ uploadForm.file_name }}</a>
          </div>
        </el-form-item>
        <el-form-item v-if="uploadForm.type === 'video_hot'" label="链接">
          <el-input v-model="uploadForm.source_link" placeholder="可选,爆款视频链接" />
        </el-form-item>
        <el-form-item v-if="uploadForm.type === 'pdf'" label="报告ID">
          <el-input v-model="uploadForm.report_id" placeholder="可选" />
        </el-form-item>
        <el-form-item v-if="!uploadIsBatch" :label="uploadForm.type === 'copy' ? '文案' : '说明文案'">
          <el-input v-model="uploadForm.parsed_text" type="textarea" :rows="4"
            :placeholder="uploadForm.type === 'copy' ? '可选,填写文案内容' : '可选,描述这个素材给达人看的用途、亮点或拍摄参考'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="uploadVisible = false">关闭</el-button>
        <el-button v-if="!uploadIsBatch" type="primary" :loading="materialSaving" :disabled="matUploading" @click="addMaterial">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'
import CopyText from '../components/CopyText.vue'
import InfluencerSelect from '../components/InfluencerSelect.vue'
import MaterialPreview from '../components/MaterialPreview.vue'
import MultiUpload from '../components/MultiUpload.vue'
import { uploadMaterialFile } from '../services/materialUpload'
import { formatTime as ft } from '../utils/time'
import { SAMPLE_STATUS, VIDEO_STATUS, tag } from '../utils/status'

// 图片类型下线(用不到);质检报告改为兼收 PDF/图片。达人成片商务可见可评论,仅管理员可维护。
const MAT_TYPES = [
  { v: 'video_ai', l: 'AI视频' }, { v: 'video_hot', l: '爆款参考' },
  { v: 'video_output', l: '达人成片', adminOnly: true },
  { v: 'pdf', l: '质检报告' }, { v: 'copy', l: '文案' },
]
const user = JSON.parse(localStorage.getItem('user') || '{}')
const isAdmin = user.role === 'admin'
// 达人成片所有内部用户可看可评论;上传、编辑、删除、公开仍按 adminOnly 收口。
const visibleMatTypes = computed(() => MAT_TYPES)
const uploadMatTypes = computed(() => MAT_TYPES.filter((t) => isAdmin || !t.adminOnly))
const AUDIT_TYPES = [
  { label: '不需审核', value: 'none' }, { label: '必须审核', value: 'must' },
  { label: '18:30自动通过', value: 'auto1830' },
]
const QIANCHUAN_STATUS_OPTIONS = [
  { label: '草稿', value: 'draft' },
  { label: '已配置', value: 'configured' },
  { label: '停用', value: 'disabled' },
]
const QIANCHUAN_STATUS = {
  unconfigured: { label: '未配置', type: 'info' },
  draft: { label: '草稿', type: 'warning' },
  configured: { label: '已配置', type: 'success' },
  disabled: { label: '停用', type: 'info' },
}

const route = useRoute()
const rows = ref([])
const search = ref('')
const page = ref(1)
const total = ref(0)
const pageSize = 50
const createVisible = ref(false)
const form = reactive({})
const drawer = ref(false)
const detailLoading = ref(false)
const detail = ref(null)
const dtab = ref('info')
const mtype = ref('video_ai')
const matUploading = ref(false)
const matProgress = ref(0)
const matUploadStage = ref('')
const matBatch = ref(null)   // 批量上传进度 {index, total};非批量为 null
const materialSaving = ref(false)
const uploadFileInput = ref(null)
const editFileInput = ref(null)
const uploadFileInputId = 'product-material-upload-file-input'
const editFileInputId = 'product-material-edit-file-input'
const applicationInfluencerId = ref(null)
const addingApplication = ref(false)
const act = ref({ samples: [], videos: [] })
const orders = ref([])
const orderForm = reactive({ influencer_id: null, order_date: '', amount: null, note: '' })
const orderTotal = computed(() => orders.value.reduce((s, o) => s + Number(o.amount || 0), 0))
const editOrderVisible = ref(false)
const orderEdit = reactive({})
const qianchuan = reactive({ bind_status: 'draft' })
const savingQianchuan = ref(false)
const startingOauth = ref(false)
const qianchuanCoops = ref([])
const qianchuanShopAuths = ref([])
const bindingQcCoop = ref(false)
const syncingQcCoop = ref(false)
const qcCoopForm = reactive({ influencer_id: null, qianchuan_cooperation_id: '', remark: '' })
const commentDrafts = reactive({})

const sampleTag = (s) => tag(SAMPLE_STATUS, s)
const videoTag = (s) => tag(VIDEO_STATUS, s)
const qianchuanTag = (s) => QIANCHUAN_STATUS[s] || QIANCHUAN_STATUS.unconfigured
const pct = (value) => (value != null ? `${value}%` : '—')
const fileTypeLabel = (type) => ({ image: '图片', video: '视频', pdf: 'PDF', file: '附件' }[type] || '附件')
const applicationStatusLabel = (status) => ({
  pending: '审核中',
  approved: '待发货',
  rejected: '已拒绝',
  shipped: '已发货',
  in_transit: '运输中',
  signed: '已签收',
  cancelled: '已取消',
}[status] || status)
const applicationStatusTag = (status) => {
  if (status === 'pending' || status === 'approved') return 'warning'
  if (status === 'rejected') return 'danger'
  if (status === 'signed') return 'success'
  if (status === 'cancelled') return 'info'
  return 'primary'
}
const uploadStatusText = computed(() => {
  const prefix = matBatch.value ? `第 ${matBatch.value.index}/${matBatch.value.total} 个 · ` : ''
  if (matUploadStage.value === 'confirming') return `${prefix}已传完，正在确认...`
  if (matUploadStage.value === 'oss') return `${prefix}OSS直传中 ${matProgress.value}%`
  if (matUploadStage.value === 'fallback') return `${prefix}直传不可用，正在切换兜底...`
  if (matUploadStage.value === 'backend') return `${prefix}后端上传中 ${matProgress.value}%`
  if (matUploadStage.value === 'backend_confirming') return `${prefix}已传完，正在保存...`
  return `${prefix}上传中 ${matProgress.value}%`
})
const canSyncQianchuanCoop = computed(() => Boolean(
  qcCoopForm.influencer_id && qianchuan.can_sync_cooperation && qianchuan.qianchuan_product_id,
))
const qianchuanSyncText = computed(() => {
  if (!qianchuan.cooperation_sync_configured) return '合作同步接口待接入'
  if (!qianchuan.shop_auth_id) return '请先选择已授权店铺'
  if (!qianchuan.qianchuan_product_id) return '请先填写千川商品ID'
  if (!qcCoopForm.influencer_id) return '请选择达人'
  return ''
})
const materialsOf = (t) => (detail.value?.materials || []).filter((m) => m.type === t)
const countOf = (t) => materialsOf(t).length
const canMaintainMaterial = (m) => isAdmin || m?.type !== 'video_output'
const acceptOf = (type) => {
  if (type === 'image') return 'image/*'
  if (type === 'pdf') return 'application/pdf,image/*'   // 质检报告:PDF 或图片皆可
  return 'video/*'
}
// 旧图预览映射:{oss_key: 签名URL},供 MultiUpload 编辑时展示已存图
const imgPreviewMap = computed(() => {
  const keys = detail.value?.product_images_keys || []
  const urls = detail.value?.product_images || []
  return Object.fromEntries(keys.map((k, i) => [k, urls[i]]))
})

let listSeq = 0
async function load() {
  const seq = ++listSeq
  try {
    const r = await api.get('/api/products', {
      params: { q: search.value || undefined, page: page.value, page_size: pageSize, paged: true },
    })
    if (seq !== listSeq) return   // 快速搜索/翻页时丢弃过期响应
    rows.value = r.items
    total.value = r.total
  } catch (e) {
    if (seq === listSeq) ElMessage.error(e.response?.data?.detail || '加载失败')
  }
}
function reload() { page.value = 1; load() }
function onPage(p) { page.value = p; load() }

function openCreate() {
  Object.keys(form).forEach((k) => delete form[k])
  form.default_commission = 5
  form.merchant_promotion_commission = 5
  createVisible.value = true
}
async function saveCreate() {
  if (!form.name) return ElMessage.warning('请填写名称')
  try {
    await api.post('/api/products', { ...form })
    ElMessage.success('已创建'); createVisible.value = false; load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '创建失败')
  }
}

function resetQianchuan(value = {}) {
  Object.keys(qianchuan).forEach((key) => delete qianchuan[key])
  Object.assign(qianchuan, {
    shop_auth_id: null,
    shop_id: '',
    shop_name: '',
    advertiser_id: '',
    qianchuan_product_id: '',
    bind_status: 'draft',
    remark: '',
    configured: false,
    integration_status: 'config_missing',
    missing_config: [],
    can_start_oauth: false,
    cooperation_sync_configured: false,
    missing_cooperation_sync_config: [],
    can_sync_cooperation: false,
  }, value)
}

async function loadShopAuths() {
  try {
    qianchuanShopAuths.value = await api.get('/api/qianchuan/shop-auths')
  } catch (e) {
    qianchuanShopAuths.value = []
    ElMessage.error(e.response?.data?.detail || '授权店铺加载失败')
  }
}

function shopAuthLabel(shop) {
  const name = shop.shop_name || shop.shop_id || '未命名店铺'
  const parts = [name]
  if (shop.advertiser_id) parts.push(`广告主 ${shop.advertiser_id}`)
  if (shop.shop_id && shop.shop_id !== name) parts.push(`店铺 ${shop.shop_id}`)
  return parts.join(' / ')
}

function applyShopAuth(id) {
  const shop = qianchuanShopAuths.value.find((item) => item.id === Number(id))
  if (!shop) return
  qianchuan.shop_id = shop.shop_id || ''
  qianchuan.shop_name = shop.shop_name || ''
  qianchuan.advertiser_id = shop.advertiser_id || ''
  if (qianchuan.bind_status === 'draft') qianchuan.bind_status = 'configured'
}

let openSeq = 0
async function open(row, tabName = 'info') {
  const targetTab = typeof tabName === 'string' ? tabName : 'info'
  const productId = Number(row.id)
  const seq = ++openSeq
  drawer.value = true
  detailLoading.value = true
  detail.value = null
  dtab.value = targetTab
  mtype.value = 'video_ai'
  applicationInfluencerId.value = null
  act.value = { samples: [], videos: [] }
  orders.value = []
  qianchuanCoops.value = []
  qianchuanShopAuths.value = []
  Object.assign(qcCoopForm, { influencer_id: null, qianchuan_cooperation_id: '', remark: '' })

  const detailReq = api.get(`/api/products/${productId}`)
  const relatedReq = Promise.allSettled([
    api.get('/api/qianchuan/shop-auths'),
    api.get(`/api/products/${productId}/activity`),
    api.get(`/api/products/${productId}/orders`),
    api.get(`/api/products/${productId}/qianchuan-cooperations`),
  ])

  try {
    const product = await detailReq
    if (seq !== openSeq) return
    detail.value = product
    resetQianchuan(product.qianchuan_binding || {})
  } catch (e) {
    if (seq === openSeq) {
      drawer.value = false
      ElMessage.error(e.response?.data?.detail || '产品详情加载失败')
    }
    return
  } finally {
    if (seq === openSeq) detailLoading.value = false
  }

  relatedReq.then((results) => {
    if (seq !== openSeq) return
    const [shopAuths, actRes, ordersRes, coopsRes] = results
    qianchuanShopAuths.value = shopAuths.status === 'fulfilled' ? shopAuths.value : []
    act.value = actRes.status === 'fulfilled' ? actRes.value : { samples: [], videos: [] }
    orders.value = ordersRes.status === 'fulfilled' ? ordersRes.value : []
    qianchuanCoops.value = coopsRes.status === 'fulfilled' ? coopsRes.value : []
    if (results.some((item) => item.status === 'rejected')) {
      ElMessage.warning('部分关联数据加载失败,可切换 tab 后重试')
    }
  })
}

// ---- 素材上传:顶部一个入口,弹框选类型,传完进对应类型 tab ----
const uploadVisible = ref(false)
const uploadForm = reactive({
  type: 'video_ai',
  oss_key: '',
  file_name: '',
  url: '',            // 上传成功后的内联预览地址(回显用)
  source_link: '',
  parsed_text: '',
  report_id: '',
})
const materialCount = computed(() => (detail.value?.materials || []).length)
const UPLOAD_FORM_BLANK = { type: 'video_ai', oss_key: '', file_name: '', url: '', source_link: '', parsed_text: '', report_id: '' }
// 图片/视频类型 → 回显时用对应预览控件
// 质检报告可传图片:按已上传文件的扩展名判断,而非仅按类型
const IMG_EXT_RE = /\.(png|jpe?g|webp|gif|bmp)$/i
const uploadIsImage = computed(() =>
  uploadForm.type === 'image' || (uploadForm.type === 'pdf' && IMG_EXT_RE.test(uploadForm.file_name || uploadForm.oss_key || '')))
const uploadIsVideo = computed(() => ['video_ai', 'video_hot', 'video_output'].includes(uploadForm.type))
// AI视频:批量上传,每个视频自动生成一条,不需要文案
const uploadIsBatch = computed(() => uploadForm.type === 'video_ai')

function openUpload() {
  const initialType = uploadMatTypes.value.some((t) => t.v === mtype.value) ? mtype.value : uploadMatTypes.value[0]?.v || 'video_ai'
  Object.assign(uploadForm, { ...UPLOAD_FORM_BLANK, type: initialType })
  uploadVisible.value = true
}

function cleanText(value) {
  return (value || '').trim()
}

function hasMaterialContent(form) {
  return Boolean(cleanText(form.oss_key) || cleanText(form.source_link) || cleanText(form.parsed_text))
}

function clearUploadFile() {
  uploadForm.oss_key = ''
  uploadForm.file_name = ''
  uploadForm.url = ''
  if (uploadFileInput.value) uploadFileInput.value.value = ''
}

function onUploadTypeChange(type) {
  clearUploadFile()
  uploadForm.source_link = ''
  uploadForm.report_id = ''
  if (type === 'copy') uploadForm.parsed_text = ''
  if (uploadFileInput.value) uploadFileInput.value.value = ''
}

async function loadOrders() { orders.value = await api.get(`/api/products/${detail.value.id}/orders`) }
async function addOrder() {
  if (!orderForm.influencer_id || !orderForm.order_date || orderForm.amount == null) {
    return ElMessage.warning('请填写达人、日期、金额')
  }
  try {
    await api.post(`/api/products/${detail.value.id}/orders`, { ...orderForm })
    Object.assign(orderForm, { influencer_id: null, order_date: '', amount: null, note: '' })
    ElMessage.success('已登记'); loadOrders()
  } catch (e) { ElMessage.error(e.response?.data?.detail || '登记失败') }
}
function openEditOrder(row) {
  Object.assign(orderEdit, { id: row.id, order_date: row.order_date, amount: row.amount, note: row.note })
  editOrderVisible.value = true
}
async function saveOrder() {
  try {
    await api.patch(`/api/products/orders/${orderEdit.id}`, {
      order_date: orderEdit.order_date, amount: orderEdit.amount, note: orderEdit.note,
    })
    editOrderVisible.value = false; ElMessage.success('已保存'); loadOrders()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  }
}
async function delOrder(row) {
  await ElMessageBox.confirm('确认删除该出单记录?', '提示', { type: 'warning' })
  try {
    await api.delete(`/api/products/orders/${row.id}`); ElMessage.success('已删除'); loadOrders()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}
async function refreshDetail() {
  if (!detail.value?.id) return   // 抽屉已关闭则不刷新,避免读空指针
  detail.value = await api.get(`/api/products/${detail.value.id}`)
}

async function toggleProduct(row) {
  const action = row.status === 'on' ? '禁用' : '启用'
  await ElMessageBox.confirm(`确认${action}该产品?`, '提示', { type: 'warning' })
  try {
    const r = await api.post(`/api/products/${row.id}/toggle`)
    row.status = r.status
    if (detail.value?.id === row.id) detail.value.status = r.status
    ElMessage.success(`已${action}`)
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
  }
}

function prependMaterial(material) {
  if (!detail.value?.materials || !material?.id) return
  detail.value.materials = [
    material,
    ...detail.value.materials.filter((item) => item.id !== material.id),
  ]
}

function updateMaterialLocal(materialId, patch) {
  if (!detail.value?.materials) return
  detail.value.materials = detail.value.materials.map((item) => (
    item.id === materialId ? { ...item, ...patch } : item
  ))
}

async function togglePublish(m) {
  const next = !m.is_public
  try {
    await api.post(`/api/products/materials/${m.id}/publish`, { is_public: next }, { skipBadgeRefresh: true })
    updateMaterialLocal(m.id, { is_public: next })
    ElMessage.success(next ? '已公开(达人端可见)' : '已取消公开')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
  }
}

async function uploadSelectedFile(file, target, { syncTitle = false } = {}) {
  matUploading.value = true
  matProgress.value = 0
  matUploadStage.value = 'uploading'
  const displayName = file.name || '已选择文件'
  target.file_name = displayName
  if (syncTitle) target.title = displayName
  try {
    // 后端只签名,文件本体直传 OSS;线上不把视频流量回退到后端。
    const uploaded = await uploadMaterialFile(api, file, (percent, stage) => {
      matProgress.value = percent
      matUploadStage.value = stage || 'uploading'
    }, { direct: true, allowBackendFallback: false })
    target.oss_key = uploaded.key
    target.file_name = displayName
    if (syncTitle) target.title = displayName
    if ('url' in target) target.url = uploaded.url
    ElMessage.success('文件已上传')
    return uploaded
  } catch (error) {
    if (!target.oss_key) target.file_name = ''
    ElMessage.error(error.response?.data?.detail || error.message || '上传失败,请检查网络或存储配置')
    return null
  } finally {
    matUploading.value = false
    matUploadStage.value = ''
  }
}

function commentForm(m) {
  const key = String(m?.id || '')
  if (!commentDrafts[key]) {
    commentDrafts[key] = {
      body: '',
      attachments: [],
      uploading: false,
      saving: false,
      progress: 0,
      stage: '',
    }
  }
  return commentDrafts[key]
}

function fileTypeFromFile(file) {
  const type = (file.type || '').toLowerCase()
  const name = (file.name || '').toLowerCase()
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/.test(name)) return 'image'
  if (type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/.test(name)) return 'video'
  if (type === 'application/pdf' || /\.pdf$/.test(name)) return 'pdf'
  return 'file'
}

async function handleCommentFileChange(event, m) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  if (!files.length) return
  const form = commentForm(m)
  if (form.uploading) return
  if (form.attachments.length + files.length > 9) {
    return ElMessage.warning('单条评论最多上传9个附件')
  }
  form.uploading = true
  form.progress = 0
  form.stage = 'uploading'
  try {
    for (const file of files) {
      const uploaded = await uploadMaterialFile(api, file, (percent, stage) => {
        form.progress = percent
        form.stage = stage || 'uploading'
      }, { prefix: 'comments', direct: true, allowBackendFallback: false })
      form.attachments.push({
        oss_key: uploaded.key,
        filename: file.name || '附件',
        file_type: fileTypeFromFile(file),
        content_type: file.type || '',
      })
    }
    ElMessage.success('附件已上传')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || e.message || '附件上传失败')
  } finally {
    form.uploading = false
    form.stage = ''
  }
}

function removeCommentAttachment(m, idx) {
  commentForm(m).attachments.splice(idx, 1)
}

async function submitMaterialComment(m) {
  const form = commentForm(m)
  if (form.saving || form.uploading) return
  const body = cleanText(form.body)
  if (!body && !form.attachments.length) return ElMessage.warning('请填写评论或上传附件')
  form.saving = true
  try {
    const created = await api.post(`/api/products/materials/${m.id}/comments`, {
      body: body || undefined,
      attachments: form.attachments.map((a) => ({ ...a })),
    }, { skipBadgeRefresh: true })
    const comments = [...(m.comments || []), created]
    updateMaterialLocal(m.id, { comments, comment_count: comments.length })
    Object.assign(form, { body: '', attachments: [], progress: 0, stage: '' })
    ElMessage.success('评论已提交')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '评论提交失败')
  } finally {
    form.saving = false
  }
}

async function handleUploadFileChange(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  if (!files.length) return
  if (uploadIsBatch.value) {
    // AI视频批量:每个视频上传后直接建一条(标题=文件名,无需文案),不回显
    await batchUploadAiVideos(files)
    return
  }
  // 单文件:只上传 + 回显,用户核对(可再填说明文案)后点「添加」入库
  await uploadSelectedFile(files[0], uploadForm, { syncTitle: true })
}

async function batchUploadAiVideos(files) {
  if (matUploading.value) return
  const productId = detail.value?.id
  if (!productId) return
  matUploading.value = true
  let ok = 0
  const failed = []
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      matBatch.value = { index: i + 1, total: files.length }
      matUploadStage.value = 'uploading'
      matProgress.value = 0
      try {
        const uploaded = await uploadMaterialFile(api, f, (percent, stage) => {
          matProgress.value = percent
          matUploadStage.value = stage || 'uploading'
        }, { direct: true, allowBackendFallback: false })
        await api.post(`/api/products/${productId}/materials`,
          { type: 'video_ai', title: f.name, oss_key: uploaded.key }, { skipBadgeRefresh: true })
        ok += 1
      } catch (e) {
        failed.push(`${f.name}: ${e.response?.data?.detail || e.message || '上传失败'}`)
      }
    }
  } finally {
    matUploading.value = false
    matUploadStage.value = ''
    matBatch.value = null
  }
  if (ok && failed.length) ElMessage.warning(`已上传 ${ok} 条,失败 ${failed.length} 条:${failed[0]}`)
  else if (ok) ElMessage.success(`已上传 ${ok} 条 AI 视频`)
  else ElMessage.error(failed[0] || '上传失败,请检查网络或存储配置')
  uploadVisible.value = false
  mtype.value = 'video_ai'
  await refreshDetail()   // 重新拉取素材列表
  load()
}

async function addMaterial(options = {}) {
  if (materialSaving.value) return false
  if (!hasMaterialContent(uploadForm)) return ElMessage.warning('请先上传文件、填写链接或填写文案')
  const body = {
    type: uploadForm.type,
    title: uploadForm.file_name || undefined,
    oss_key: cleanText(uploadForm.oss_key) || undefined,
    parsed_text: cleanText(uploadForm.parsed_text) || undefined,
    report_id: cleanText(uploadForm.report_id) || undefined,
  }
  if (uploadForm.type === 'video_hot') body.source_link = cleanText(uploadForm.source_link) || undefined
  materialSaving.value = true
  try {
    const created = await api.post(`/api/products/${detail.value.id}/materials`, body, { skipBadgeRefresh: true })
    ElMessage.success(options.autoFromUpload ? '文件已上传并展示' : '已添加')
    prependMaterial(created)
    uploadVisible.value = false
    mtype.value = uploadForm.type   // 添加后切到对应类型 tab
    load()
    return true
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '素材添加失败')
    return false
  } finally {
    materialSaving.value = false
  }
}
async function delMaterial(m) {
  await ElMessageBox.confirm('确认删除该素材?', '提示', { type: 'warning' })
  try {
    await api.delete(`/api/products/materials/${m.id}`, { skipBadgeRefresh: true })
    detail.value.materials = detail.value.materials.filter((item) => item.id !== m.id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}

const editMatVisible = ref(false)
const matEdit = reactive({})
function openEditMat(m) {
  Object.assign(matEdit, { id: m.id, type: m.type, title: m.title, file_name: m.title || '', oss_key: m.oss_key, url: m.url,
    parsed_text: m.parsed_text, source_link: m.source_link,
    report_id: m.report_id, downloadable: m.downloadable })
  editMatVisible.value = true
}
async function handleEditFileChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  await uploadSelectedFile(file, matEdit, { syncTitle: true })
}
function clearEditFile() {
  matEdit.oss_key = ''
  matEdit.url = ''
  matEdit.title = ''
  matEdit.file_name = ''
  if (editFileInput.value) editFileInput.value.value = ''
}
async function saveMat() {
  if (!hasMaterialContent(matEdit)) return ElMessage.warning('请保留文件、链接或文案中的至少一项')
  try {
    await api.put(`/api/products/materials/${matEdit.id}`, {
      title: matEdit.title || undefined,
      oss_key: cleanText(matEdit.oss_key) || null,
      parsed_text: cleanText(matEdit.parsed_text) || null,
      source_link: cleanText(matEdit.source_link) || null,
      report_id: cleanText(matEdit.report_id) || null,
      downloadable: matEdit.downloadable,
    }, { skipBadgeRefresh: true })
    updateMaterialLocal(matEdit.id, {
      title: matEdit.title,
      oss_key: cleanText(matEdit.oss_key) || null,
      url: matEdit.oss_key ? matEdit.url : null,
      parsed_text: cleanText(matEdit.parsed_text) || null,
      source_link: cleanText(matEdit.source_link) || null,
      report_id: cleanText(matEdit.report_id) || null,
      downloadable: matEdit.downloadable,
    })
    editMatVisible.value = false; ElMessage.success('已保存')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  }
}
async function removeProduct(row) {
  await ElMessageBox.confirm('确认删除该产品?(仅无寄样/视频/出单记录时可删)', '删除', { type: 'warning' })
  try {
    await api.delete(`/api/products/${row.id}`)
    ElMessage.success('已删除')
    if (detail.value?.id === row.id) drawer.value = false
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}

async function saveInfo() {
  try {
    await api.put(`/api/products/${detail.value.id}`, {
      name: detail.value.name, shop_name: detail.value.shop_name,
      price_text: detail.value.price_text, shop_product_id: detail.value.shop_product_id,
      link: detail.value.link,
      product_images: detail.value.product_images_keys || [],
      default_commission: detail.value.default_commission,
      merchant_promotion_commission: detail.value.merchant_promotion_commission,
      selling_points: detail.value.selling_points, shooting_notes: detail.value.shooting_notes,
      sample_remark: detail.value.sample_remark, promo_remark: detail.value.promo_remark,
      auto_audit_type: detail.value.auto_audit_type, allow_promotion: detail.value.allow_promotion,
    })
    ElMessage.success('已保存')
    load()            // 刷新列表行
    await refreshDetail()   // 同步抽屉头部封面/佣金摘要,免得换图后要重开才更新
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败,请重试')
  }
}

async function saveQianchuan() {
  savingQianchuan.value = true
  try {
    const saved = await api.put(`/api/products/${detail.value.id}/qianchuan-binding`, {
      // 显式传 null 才能解绑;传 undefined 会被 JSON 丢键,后端无法区分"未改"与"清空"
      shop_auth_id: qianchuan.shop_auth_id || null,
      shop_id: qianchuan.shop_id,
      shop_name: qianchuan.shop_name,
      advertiser_id: qianchuan.advertiser_id,
      qianchuan_product_id: qianchuan.qianchuan_product_id,
      bind_status: qianchuan.bind_status || 'draft',
      remark: qianchuan.remark,
    })
    resetQianchuan(saved)
    detail.value.qianchuan_binding = saved
    ElMessage.success('千川本地映射已保存')
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  } finally {
    savingQianchuan.value = false
  }
}

async function startQianchuanOauth() {
  startingOauth.value = true
  try {
    const r = await api.post('/api/qianchuan/oauth/start', { product_id: detail.value.id })
    window.open(r.auth_url, '_blank')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '千川授权暂不可用')
  } finally {
    startingOauth.value = false
  }
}

async function refreshQianchuanBinding() {
  if (!detail.value?.id) return
  await loadShopAuths()
  const saved = await api.get(`/api/products/${detail.value.id}/qianchuan-binding`)
  resetQianchuan(saved)
  detail.value.qianchuan_binding = saved
  load()
}

async function bindQianchuanCoop() {
  if (!qcCoopForm.influencer_id) return ElMessage.warning('请选择达人')
  if (!qcCoopForm.qianchuan_cooperation_id?.trim()) return ElMessage.warning('请填写千川合作ID')
  bindingQcCoop.value = true
  try {
    await api.post(`/api/products/${detail.value.id}/qianchuan-cooperations`, {
      influencer_id: qcCoopForm.influencer_id,
      qianchuan_cooperation_id: qcCoopForm.qianchuan_cooperation_id,
      remark: qcCoopForm.remark || undefined,
    })
    Object.assign(qcCoopForm, { influencer_id: null, qianchuan_cooperation_id: '', remark: '' })
    qianchuanCoops.value = await api.get(`/api/products/${detail.value.id}/qianchuan-cooperations`)
    ElMessage.success('千川合作已绑定')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '绑定失败')
  } finally {
    bindingQcCoop.value = false
  }
}

async function syncQianchuanCoop() {
  if (!qcCoopForm.influencer_id) return ElMessage.warning('请选择达人')
  if (!qianchuan.can_sync_cooperation) return ElMessage.warning('千川合作同步接口未接入')
  if (!qianchuan.qianchuan_product_id) return ElMessage.warning('请先填写千川商品ID')
  syncingQcCoop.value = true
  try {
    await api.post(`/api/products/${detail.value.id}/qianchuan-cooperations/sync`, {
      influencer_id: qcCoopForm.influencer_id,
      remark: qcCoopForm.remark || undefined,
    })
    Object.assign(qcCoopForm, { influencer_id: null, qianchuan_cooperation_id: '', remark: '' })
    qianchuanCoops.value = await api.get(`/api/products/${detail.value.id}/qianchuan-cooperations`)
    ElMessage.success('千川合作已同步')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '同步失败')
  } finally {
    syncingQcCoop.value = false
  }
}

async function removeQianchuanCoop(row) {
  await ElMessageBox.confirm('确认移除该千川合作绑定?', '提示', { type: 'warning' })
  try {
    await api.delete(`/api/products/${detail.value.id}/qianchuan-cooperations/${row.id}`)
    qianchuanCoops.value = await api.get(`/api/products/${detail.value.id}/qianchuan-cooperations`)
    ElMessage.success('已移除')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '移除失败')
  }
}

async function addApplication() {
  if (!applicationInfluencerId.value) return ElMessage.warning('请选择达人')
  addingApplication.value = true
  try {
    await api.post('/api/product-applications', {
      influencer_id: applicationInfluencerId.value,
      product_id: detail.value.id,
    }, { skipBadgeRefresh: true })
    ElMessage.success('已添加到带货流程')
    applicationInfluencerId.value = null
    await refreshDetail()
    load()
    window.dispatchEvent(new Event('nav-badge-refresh'))
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '添加失败')
  } finally {
    addingApplication.value = false
  }
}

function onQianchuanMessage(event) {
  if (event.data?.type === 'qianchuan-oauth-finished') refreshQianchuanBinding()
}

onMounted(async () => {
  await load()
  window.addEventListener('message', onQianchuanMessage)
  // 从寄样/视频/达人详情"点产品名"深链进来:自动打开该产品抽屉
  if (route.query.open) {
    try { await open({ id: Number(route.query.open) }) } catch (e) { /* 产品可能已删除 */ }
  }
})
onBeforeUnmount(() => window.removeEventListener('message', onQianchuanMessage))
</script>

<style scoped>
.tab-toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
.prod-cell { display: flex; align-items: center; gap: 10px; }
.prod-img { width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0; }
.prod-img.placeholder { background: #eef0f5; }
.prod-img.broken, .head-img.broken { display: flex; align-items: center; justify-content: center;
  background: #f7f8fa; color: #b3392f; font-size: 11px; }
.prod-name { font-weight: 500; }
.link { color: #6b5cf6; text-decoration: none; }
.link:hover { text-decoration: underline; }
.commission-cell { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: #606266; line-height: 1.35; }
.prod-head { display: flex; gap: 14px; align-items: flex-start; padding-bottom: 16px; border-bottom: 1px solid #f0f1f5; }
.head-img { width: 64px; height: 64px; border-radius: 10px; }
.head-img.placeholder { background: #eef0f5; }
.head-info { flex: 1; }
.head-name { font-weight: 600; font-size: 15px; }
.mat-tabs { min-height: 220px; }
.mat-add { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
.application-overview {
  display: flex;
  align-items: stretch;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.overview-stat {
  min-width: 78px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f8f9fc;
  border: 1px solid #eef0f5;
}
.overview-stat span { display: block; color: #8a93a6; font-size: 12px; }
.overview-stat b { display: block; margin-top: 2px; color: #303545; font-size: 15px; }
.overview-stat.warn b { color: #b36b00; }
.overview-stat.ok b { color: #2f9f5b; }
.overview-stat.danger b { color: #d93030; }
.overview-link {
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid #e2ddff;
  color: #6254e8;
  text-decoration: none;
  font-size: 13px;
}
.application-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.app-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 999px;
  background: #f7f8fb;
  color: #303545;
  font-size: 12px;
}
.app-chip em { color: #8a93a6; font-style: normal; }
.upload-progress { font-size: 12px; }
/* 透明 <input type=file> 直接盖在按钮上:点击落在原生 input 本体,
   不走 label[for]/JS.click() 间接触发——微信/企业微信等 webview 里最稳。 */
.file-pick-wrap { position: relative; display: inline-flex; }
.file-overlay-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  font-size: 0;
}
.upload-file-box, .file-edit-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.upload-preview { margin-top: 10px; }
.upload-preview .up-img { max-width: 220px; max-height: 160px; border-radius: 8px; border: 1px solid #eef0f5; }
.upload-preview .up-video { max-width: 320px; max-height: 200px; border-radius: 8px; background: #000; }
.upload-preview .up-file { font-size: 13px; color: #6b5cf6; }
.file-name, .material-file-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-name { max-width: 230px; }
.material-file-name { max-width: 360px; }
.material-card { padding: 12px; margin-bottom: 12px; border: 1px solid #eceef3; border-radius: 10px; }
.material-card-head { display: flex; align-items: center; gap: 10px; }
.video-comment-panel {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #e5e7ef;
}
.comment-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}
.comment-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.comment-item { padding: 10px; border-radius: 8px; background: #f8f9fc; border: 1px solid #eef0f5; }
.comment-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.comment-author { font-weight: 600; color: #303545; }
.comment-body { margin-top: 6px; white-space: pre-wrap; line-height: 1.6; color: #4f566b; font-size: 13px; }
.comment-attachments, .comment-draft-files { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.comment-file {
  max-width: 220px;
  padding: 4px 8px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #e5e7ef;
  color: #6254e8;
  font-size: 12px;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-comment { margin: 4px 0 10px; font-size: 12px; }
.comment-compose { display: flex; flex-direction: column; gap: 8px; }
.comment-compose-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mat-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f4f5f8; }
.mat-ops { margin-left: auto; display: flex; gap: 10px; }
.qianchuan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0 14px;
}
.qc-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
</style>
