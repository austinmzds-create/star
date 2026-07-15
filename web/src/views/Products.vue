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
            <el-image v-if="row.product_image" :src="row.product_image" fit="cover" class="prod-img" />
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
      <el-table-column label="默认佣金" width="90">
        <template #default="{ row }">{{ row.default_commission != null ? row.default_commission + '%' : '—' }}</template>
      </el-table-column>
      <el-table-column label="素材" width="70">
        <template #default="{ row }">{{ row.material_count }}</template>
      </el-table-column>
      <el-table-column label="授权达人" width="90">
        <template #default="{ row }">{{ row.granted_count }}</template>
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
        <el-form-item label="默认佣金%"><el-input-number v-model="form.default_commission" :min="0" :max="50" :step="0.5" /></el-form-item>
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
        <el-form-item label="标题"><el-input v-model="matEdit.title" /></el-form-item>
        <el-form-item v-if="matEdit.type === 'copy'" label="文案"><el-input v-model="matEdit.parsed_text" type="textarea" :rows="3" /></el-form-item>
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
    <el-drawer v-model="drawer" :title="detail?.name" size="760px">
      <template v-if="detail">
        <!-- 商品卡 -->
        <div class="prod-head">
          <el-image v-if="detail.product_image" :src="detail.product_image" fit="cover" class="head-img" />
          <div v-else class="head-img placeholder"></div>
          <div class="head-info">
            <div class="head-name">{{ detail.name }}</div>
            <div class="muted" style="font-size:13px">{{ detail.shop_name }} · {{ detail.price_text }} · 默认佣金 {{ detail.default_commission ?? '—' }}%</div>
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
              <el-form-item label="默认佣金%"><el-input-number v-model="detail.default_commission" :min="0" :max="50" :step="0.5" /></el-form-item>
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
          <el-tab-pane :label="`素材 ${posts.length}`" name="materials">
            <!-- 发布素材:直接上传多附件 + 写文案,无需先选类型 -->
            <div class="tab-toolbar">
              <el-button size="small" type="primary" @click="openPostDialog()">+ 发布素材</el-button>
            </div>
            <el-empty v-if="!posts.length" description="还没有素材,点「发布素材」直接上传" :image-size="50" />
            <div v-for="post in posts" :key="post.id" class="post-card">
              <div class="post-head">
                <strong>{{ post.title || POST_CAT_LABEL[post.category] || '内容帖' }}</strong>
                <el-tag v-if="post.status === 'draft'" size="small" type="info">草稿</el-tag>
                <span class="muted post-meta">{{ post.author_name }} · {{ ft(post.created_at) }}</span>
                <div class="post-ops">
                  <el-button size="small" text @click="openPostDialog(post)">编辑</el-button>
                  <el-button size="small" text :type="post.status === 'published' ? 'info' : 'success'"
                    @click="togglePost(post)">{{ post.status === 'published' ? '下架' : '发布' }}</el-button>
                  <el-button size="small" text type="danger" @click="delPost(post)">删除</el-button>
                </div>
              </div>
              <div v-if="post.assets.length" class="post-assets">
                <template v-for="a in post.assets" :key="a.id">
                  <el-image v-if="a.type === 'image'" :src="a.thumb || a.url" fit="cover" class="post-img"
                    :preview-src-list="[a.url]" preview-teleported />
                  <a v-else :href="a.url" target="_blank" class="post-file">
                    <el-icon><Link v-if="a.type === 'link'" /><VideoCamera v-else-if="a.type === 'video'" /><Document v-else /></el-icon>
                    {{ a.filename || a.source_link || a.type }}
                  </a>
                </template>
              </div>
              <div class="post-caption">{{ post.caption }}</div>
              <div class="post-foot muted">
                <el-button size="small" text @click="copyText(post.caption)">复制文案</el-button>
                <span v-if="!post.downloadable">· 仅查看不可下载</span>
              </div>
            </div>

            <el-divider content-position="left">
              <span class="muted" style="font-size:12px">按类型归档(旧素材)</span>
            </el-divider>
            <el-tabs v-model="mtype" tab-position="left" class="mat-tabs">
              <el-tab-pane v-for="t in MAT_TYPES" :key="t.v" :label="`${t.l} ${countOf(t.v)}`" :name="t.v">
                <!-- 添加区 -->
                <div class="mat-add">
                  <template v-if="t.v === 'video_hot'">
                    <el-upload
                      :show-file-list="false"
                      :disabled="matUploading"
                      :before-upload="() => true"
                      :http-request="uploadMat"
                      accept="video/*"
                    >
                      <el-button size="small" :loading="matUploading" :disabled="matUploading">上传视频</el-button>
                    </el-upload>
                    <el-input v-model="matForm.source_link" placeholder="爆款抖音链接" style="flex:1" />
                    <el-input v-model="matForm.title" placeholder="标题(可选，默认文件名)" style="width:180px" />
                  </template>
                  <template v-else-if="t.v === 'copy'">
                    <el-input v-model="matForm.parsed_text" type="textarea" :rows="2" placeholder="文案内容" style="flex:1" />
                  </template>
                  <template v-else>
                    <el-upload
                      :show-file-list="false"
                      :disabled="matUploading"
                      :before-upload="() => true"
                      :http-request="uploadMat"
                      :accept="acceptOf(t.v)"
                    >
                      <el-button size="small" :loading="matUploading" :disabled="matUploading">上传文件</el-button>
                    </el-upload>
                    <el-input v-model="matForm.title" placeholder="标题(可选，默认文件名)" style="width:180px" />
                    <el-input v-if="t.v === 'pdf'" v-model="matForm.report_id" placeholder="报告ID(可选)" style="width:130px" />
                  </template>
                  <span v-if="matUploading" class="muted upload-progress">上传中 {{ matProgress }}%</span>
                  <el-button
                    v-if="t.v === 'video_hot' || t.v === 'copy'"
                    type="primary"
                    size="small"
                    @click="addMaterial"
                  >
                    添加
                  </el-button>
                </div>
                <!-- 列表 -->
                <div v-for="m in materialsOf(t.v)" :key="m.id" class="material-card">
                  <div class="material-card-head">
                    <template v-if="renamingId === m.id">
                      <el-input v-model="renameTitle" size="small" class="rename-input" @keyup.enter="saveRename(m)" />
                      <el-button size="small" text type="primary" @click="saveRename(m)">保存</el-button>
                      <el-button size="small" text @click="cancelRename">取消</el-button>
                    </template>
                    <template v-else>
                      <strong>{{ m.title || MAT_TYPES.find((item) => item.v === m.type)?.l }}</strong>
                      <el-button size="small" text @click="startRename(m)">改名</el-button>
                    </template>
                    <div class="mat-ops">
                      <el-icon class="op" @click="openEditMat(m)"><Edit /></el-icon>
                      <el-icon class="del" @click="delMaterial(m)"><Delete /></el-icon>
                    </div>
                  </div>
                  <MaterialPreview :material="m" />
                </div>
                <el-empty v-if="!materialsOf(t.v).length" :description="`暂无${t.l}`" :image-size="50" />
              </el-tab-pane>
            </el-tabs>
          </el-tab-pane>

          <!-- 朋友圈内容帖(标题 + 说明文案 + 多附件,达人端同款) -->
          <!-- 授权达人 -->
          <el-tab-pane label="授权达人" name="grants">
            <div class="mat-add">
              <InfluencerSelect v-model="grantId" style="flex:1" />
              <el-button type="primary" size="small" :disabled="!grantId" @click="addGrant">开放</el-button>
            </div>
            <el-table :data="grants" size="small">
              <el-table-column prop="nickname" label="达人" />
              <el-table-column prop="douyin_id" label="抖音号" />
              <el-table-column label="授权时间" width="150"><template #default="{ row }">{{ ft(row.granted_at) }}</template></el-table-column>
              <el-table-column width="70"><template #default="{ row }">
                <el-button size="small" text type="danger" @click="removeGrant(row)">移除</el-button>
              </template></el-table-column>
            </el-table>
            <el-empty v-if="!grants.length" description="尚未授权任何达人" :image-size="50" />
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

    <!-- 发布/编辑内容帖 -->
    <el-dialog v-model="postDialogVisible" :title="postForm.id ? '编辑内容帖' : '发布素材'" width="560px" append-to-body>
      <el-form label-width="72px">
        <el-form-item label="标题"><el-input v-model="postForm.title" placeholder="可选,达人端显示" /></el-form-item>
        <el-form-item label="附件">
          <div class="post-upload">
            <div v-for="(a, i) in postForm.assets" :key="i" class="pa-chip">
              <el-image v-if="a.type === 'image'" :src="a.thumb || a.url" fit="cover" class="pa-thumb" />
              <span v-else class="pa-file"><el-icon><Document /></el-icon>{{ a.filename || a.source_link || a.type }}</span>
              <el-icon class="pa-del" @click="removeAsset(i)"><Close /></el-icon>
            </div>
            <el-upload :show-file-list="false" :before-upload="() => true" :http-request="uploadAsset"
              :disabled="assetUploading">
              <div class="pa-add"><el-icon><Plus /></el-icon></div>
            </el-upload>
          </div>
          <div class="post-link-add">
            <el-input v-model="linkInput" size="small" placeholder="或粘贴外链(抖音/网盘)后回车" @keyup.enter="addLink" />
          </div>
        </el-form-item>
        <el-form-item label="说明文案" required>
          <el-input v-model="postForm.caption" type="textarea" :rows="4" placeholder="必填,达人端可复制的完整文案" />
        </el-form-item>
        <el-form-item label="允许下载">
          <el-switch v-model="postForm.downloadable" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="postDialogVisible = false">取消</el-button>
        <el-button @click="savePost('draft')">存草稿</el-button>
        <el-button type="primary" :loading="savingPost" @click="savePost('published')">发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { Close, Delete, Document, Edit, Link, Plus, VideoCamera } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'
import CopyText from '../components/CopyText.vue'
import InfluencerSelect from '../components/InfluencerSelect.vue'
import MaterialPreview from '../components/MaterialPreview.vue'
import MultiUpload from '../components/MultiUpload.vue'
import { uploadAndCreateMaterial } from '../services/materialUpload'
import { formatTime as ft } from '../utils/time'
import { SAMPLE_STATUS, VIDEO_STATUS, tag } from '../utils/status'

const MAT_TYPES = [
  { v: 'video_ai', l: 'AI视频' }, { v: 'video_hot', l: '爆款参考' },
  { v: 'video_output', l: '达人成片' }, { v: 'image', l: '图片' },
  { v: 'pdf', l: '质检报告' }, { v: 'copy', l: '文案' },
]
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
const detail = ref(null)
const dtab = ref('info')
const mtype = ref('video_ai')
const matForm = reactive({})
const matUploading = ref(false)
const matProgress = ref(0)
const renamingId = ref(null)
const renameTitle = ref('')
const grants = ref([])
const grantId = ref(null)
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

const sampleTag = (s) => tag(SAMPLE_STATUS, s)
const videoTag = (s) => tag(VIDEO_STATUS, s)
const qianchuanTag = (s) => QIANCHUAN_STATUS[s] || QIANCHUAN_STATUS.unconfigured
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
const acceptOf = (type) => {
  if (type === 'image') return 'image/*'
  if (type === 'pdf') return 'application/pdf'
  return 'video/*'
}
// 旧图预览映射:{oss_key: 签名URL},供 MultiUpload 编辑时展示已存图
const imgPreviewMap = computed(() => {
  const keys = detail.value?.product_images_keys || []
  const urls = detail.value?.product_images || []
  return Object.fromEntries(keys.map((k, i) => [k, urls[i]]))
})

async function load() {
  const r = await api.get('/api/products', {
    params: { q: search.value || undefined, page: page.value, page_size: pageSize, paged: true },
  })
  rows.value = r.items
  total.value = r.total
}
function reload() { page.value = 1; load() }
function onPage(p) { page.value = p; load() }

function openCreate() { Object.keys(form).forEach((k) => delete form[k]); form.default_commission = 5; createVisible.value = true }
async function saveCreate() {
  if (!form.name) return ElMessage.warning('请填写名称')
  await api.post('/api/products', { ...form })
  ElMessage.success('已创建'); createVisible.value = false; load()
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

async function open(row, tabName = 'info') {
  const targetTab = typeof tabName === 'string' ? tabName : 'info'
  detail.value = await api.get(`/api/products/${row.id}`)
  drawer.value = true; dtab.value = targetTab; mtype.value = 'video_ai'
  resetQianchuan(detail.value.qianchuan_binding || {})
  await loadShopAuths()
  Object.keys(matForm).forEach((k) => delete matForm[k])
  grants.value = await api.get(`/api/products/${row.id}/grants`)
  act.value = await api.get(`/api/products/${row.id}/activity`)
  orders.value = await api.get(`/api/products/${row.id}/orders`)
  qianchuanCoops.value = await api.get(`/api/products/${row.id}/qianchuan-cooperations`)
  Object.assign(qcCoopForm, { influencer_id: null, qianchuan_cooperation_id: '', remark: '' })
  await loadPosts()
}

// ---- 朋友圈内容帖(方案B 需求3) ----
const POST_CAT_LABEL = { image: '图片', video: '视频', doc: '文档', copy: '文案' }
const posts = ref([])
const postDialogVisible = ref(false)
const savingPost = ref(false)
const assetUploading = ref(false)
const linkInput = ref('')
const postForm = reactive({ id: null, category: 'image', title: '', caption: '', downloadable: true, assets: [] })

async function loadPosts() {
  posts.value = await api.get(`/api/products/${detail.value.id}/material-posts`)
}
function openPostDialog(post = null) {
  linkInput.value = ''
  if (post) {
    Object.assign(postForm, {
      id: post.id, category: post.category, title: post.title || '',
      caption: post.caption, downloadable: post.downloadable,
      assets: post.assets.map((a) => ({ ...a })),
    })
  } else {
    Object.assign(postForm, { id: null, category: 'image', title: '', caption: '', downloadable: true, assets: [] })
  }
  postDialogVisible.value = true
}
function inferAssetType(name) {
  const n = (name || '').toLowerCase()
  if (/\.(jpg|jpeg|png|gif|webp|bmp)$/.test(n)) return 'image'
  if (/\.(mp4|mov|avi|mkv|webm)$/.test(n)) return 'video'
  if (/\.pdf$/.test(n)) return 'pdf'
  return 'file'
}
async function uploadAsset({ file }) {
  assetUploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const r = await api.post('/api/upload?prefix=materials', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    postForm.assets.push({ type: inferAssetType(file.name), oss_key: r.key, filename: file.name,
      url: r.url || `/api/files/${r.key}`, thumb: r.url || `/api/files/${r.key}` })
  } catch (e) {
    ElMessage.error('上传失败')
  } finally {
    assetUploading.value = false
  }
}
function addLink() {
  const v = (linkInput.value || '').trim()
  if (!v) return
  postForm.assets.push({ type: 'link', source_link: v, filename: v })
  linkInput.value = ''
}
function removeAsset(i) { postForm.assets.splice(i, 1) }
function inferCategory(assets) {
  const types = assets.map((a) => a.type)
  if (types.includes('video')) return 'video'
  if (types.includes('image')) return 'image'
  if (types.some((t) => ['pdf', 'file', 'link'].includes(t))) return 'doc'
  return 'copy'
}
async function savePost(status) {
  if (!postForm.caption || !postForm.caption.trim()) return ElMessage.warning('说明文案必填')
  savingPost.value = true
  try {
    const payload = {
      category: inferCategory(postForm.assets), title: postForm.title || null, caption: postForm.caption,
      downloadable: postForm.downloadable, status,
      assets: postForm.assets.map((a) => ({ type: a.type, oss_key: a.oss_key || null,
        source_link: a.source_link || null, filename: a.filename || null })),
    }
    if (postForm.id) await api.patch(`/api/products/material-posts/${postForm.id}`, payload)
    else await api.post(`/api/products/${detail.value.id}/material-posts`, payload)
    postDialogVisible.value = false
    ElMessage.success(status === 'draft' ? '已存草稿' : '已发布')
    await loadPosts()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  } finally {
    savingPost.value = false
  }
}
async function togglePost(post) {
  await api.patch(`/api/products/material-posts/${post.id}`, { status: post.status === 'published' ? 'draft' : 'published' })
  await loadPosts()
}
async function delPost(post) {
  await ElMessageBox.confirm('确认删除该内容帖?', '提示', { type: 'warning' })
  await api.delete(`/api/products/material-posts/${post.id}`)
  ElMessage.success('已删除')
  await loadPosts()
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text || ''); ElMessage.success('文案已复制') }
  catch (e) { ElMessage.warning('复制失败,请手动选择') }
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
  await api.patch(`/api/products/orders/${orderEdit.id}`, {
    order_date: orderEdit.order_date, amount: orderEdit.amount, note: orderEdit.note,
  })
  editOrderVisible.value = false; ElMessage.success('已保存'); loadOrders()
}
async function delOrder(row) {
  await ElMessageBox.confirm('确认删除该出单记录?', '提示', { type: 'warning' })
  await api.delete(`/api/products/orders/${row.id}`); ElMessage.success('已删除'); loadOrders()
}
async function refreshDetail() { detail.value = await api.get(`/api/products/${detail.value.id}`) }

async function toggleProduct(row) {
  const action = row.status === 'on' ? '禁用' : '启用'
  await ElMessageBox.confirm(`确认${action}该产品?`, '提示', { type: 'warning' })
  const r = await api.post(`/api/products/${row.id}/toggle`)
  row.status = r.status
  if (detail.value?.id === row.id) detail.value.status = r.status
  ElMessage.success(`已${action}`)
  load()
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

async function uploadMat({ file, onProgress, onSuccess, onError }) {
  matUploading.value = true
  matProgress.value = 0
  try {
    const created = await uploadAndCreateMaterial(api, {
      productId: detail.value.id,
      type: mtype.value,
      file,
      title: matForm.title,
      reportId: matForm.report_id,
      onProgress: (percent) => {
        matProgress.value = percent
        onProgress?.({ percent })
      },
    })
    ElMessage.success('上传成功，素材已添加')
    prependMaterial(created)
    Object.keys(matForm).forEach((key) => delete matForm[key])
    onSuccess?.(created)
    load()
    return created
  } catch (error) {
    onError?.(error)
    ElMessage.error(error.materialStage === 'create'
      ? '文件已上传，但素材创建失败，请重试'
      : (error.response?.data?.detail || '文件上传失败'))
    throw error
  } finally {
    matUploading.value = false
  }
}
async function addMaterial() {
  const body = { type: mtype.value, title: matForm.title }
  if (mtype.value === 'video_hot') body.source_link = matForm.source_link
  else if (mtype.value === 'copy') body.parsed_text = matForm.parsed_text
  if (!body.source_link && !body.parsed_text) return ElMessage.warning('请填写内容')
  const created = await api.post(`/api/products/${detail.value.id}/materials`, body)
  ElMessage.success('已添加')
  prependMaterial(created)
  Object.keys(matForm).forEach((k) => delete matForm[k])
  load()
}
async function delMaterial(m) {
  await ElMessageBox.confirm('确认删除该素材?', '提示', { type: 'warning' })
  await api.delete(`/api/products/materials/${m.id}`)
  detail.value.materials = detail.value.materials.filter((item) => item.id !== m.id)
  ElMessage.success('已删除')
  load()
}

const editMatVisible = ref(false)
const matEdit = reactive({})
function openEditMat(m) {
  Object.assign(matEdit, { id: m.id, type: m.type, title: m.title, parsed_text: m.parsed_text,
    source_link: m.source_link, report_id: m.report_id, downloadable: m.downloadable })
  editMatVisible.value = true
}
async function saveMat() {
  await api.put(`/api/products/materials/${matEdit.id}`, {
    title: matEdit.title, parsed_text: matEdit.parsed_text, source_link: matEdit.source_link,
    report_id: matEdit.report_id, downloadable: matEdit.downloadable,
  })
  updateMaterialLocal(matEdit.id, {
    title: matEdit.title,
    parsed_text: matEdit.parsed_text,
    source_link: matEdit.source_link,
    report_id: matEdit.report_id,
    downloadable: matEdit.downloadable,
  })
  editMatVisible.value = false; ElMessage.success('已保存')
}
function startRename(m) {
  renamingId.value = m.id
  renameTitle.value = m.title || ''
}
function cancelRename() {
  renamingId.value = null
  renameTitle.value = ''
}
async function saveRename(m) {
  const title = renameTitle.value.trim()
  if (!title) return ElMessage.warning('名称不能为空')
  await api.put(`/api/products/materials/${m.id}`, { title })
  updateMaterialLocal(m.id, { title })
  cancelRename()
  ElMessage.success('已改名')
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
  await api.put(`/api/products/${detail.value.id}`, {
    name: detail.value.name, shop_name: detail.value.shop_name,
    price_text: detail.value.price_text, shop_product_id: detail.value.shop_product_id,
    link: detail.value.link,
    product_images: detail.value.product_images_keys || [],
    default_commission: detail.value.default_commission,
    selling_points: detail.value.selling_points, shooting_notes: detail.value.shooting_notes,
    sample_remark: detail.value.sample_remark, promo_remark: detail.value.promo_remark,
    auto_audit_type: detail.value.auto_audit_type, allow_promotion: detail.value.allow_promotion,
  })
  ElMessage.success('已保存'); load()
}

async function saveQianchuan() {
  savingQianchuan.value = true
  try {
    const saved = await api.put(`/api/products/${detail.value.id}/qianchuan-binding`, {
      shop_auth_id: qianchuan.shop_auth_id || undefined,
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
  await api.delete(`/api/products/${detail.value.id}/qianchuan-cooperations/${row.id}`)
  qianchuanCoops.value = await api.get(`/api/products/${detail.value.id}/qianchuan-cooperations`)
  ElMessage.success('已移除')
}

async function addGrant() {
  await api.post(`/api/products/${detail.value.id}/grant`, { influencer_id: grantId.value })
  ElMessage.success('已开放'); grantId.value = null
  grants.value = await api.get(`/api/products/${detail.value.id}/grants`); load()
}
async function removeGrant(row) {
  await api.delete(`/api/products/${detail.value.id}/grant/${row.influencer_id}`)
  grants.value = await api.get(`/api/products/${detail.value.id}/grants`); load()
}

function onQianchuanMessage(event) {
  if (event.data?.type === 'qianchuan-oauth-finished') refreshQianchuanBinding()
}

onMounted(async () => {
  await load()
  loadShopAuths()
  window.addEventListener('message', onQianchuanMessage)
  // 从寄样/视频/达人详情"点产品名"深链进来:自动打开该产品抽屉
  if (route.query.open) {
    try { await open({ id: Number(route.query.open) }) } catch (e) { /* 产品可能已删除 */ }
  }
})
onBeforeUnmount(() => window.removeEventListener('message', onQianchuanMessage))
</script>

<style scoped>
/* 内容帖 */
.tab-toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
.post-card { border: 1px solid #eef0f5; border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
.post-head { display: flex; align-items: center; gap: 8px; }
.post-head .post-meta { font-size: 12px; }
.post-ops { margin-left: auto; display: flex; gap: 2px; }
.post-assets { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.post-img { width: 88px; height: 88px; border-radius: 8px; }
.post-file { display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; background: #f6f8fc;
  border-radius: 8px; font-size: 12px; color: #6b5cf6; text-decoration: none; max-width: 220px; }
.post-caption { font-size: 13px; color: #3a4256; white-space: pre-wrap; line-height: 1.6; }
.post-foot { font-size: 12px; margin-top: 6px; display: flex; align-items: center; gap: 4px; }
.post-upload { display: flex; flex-wrap: wrap; gap: 8px; }
.pa-chip { position: relative; }
.pa-thumb { width: 64px; height: 64px; border-radius: 8px; }
.pa-file { display: inline-flex; align-items: center; gap: 4px; padding: 8px 10px; background: #f6f8fc;
  border-radius: 8px; font-size: 12px; max-width: 180px; overflow: hidden; }
.pa-del { position: absolute; top: -6px; right: -6px; background: rgba(0,0,0,.5); color: #fff;
  border-radius: 50%; padding: 2px; cursor: pointer; font-size: 12px; }
.pa-add { width: 64px; height: 64px; border: 1px dashed #cdd2de; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; color: #b3bac9; cursor: pointer; }
.pa-add:hover { border-color: #6b5cf6; color: #6b5cf6; }
.post-link-add { margin-top: 8px; }
.prod-cell { display: flex; align-items: center; gap: 10px; }
.prod-img { width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0; }
.prod-img.placeholder { background: #eef0f5; }
.prod-name { font-weight: 500; }
.prod-head { display: flex; gap: 14px; align-items: flex-start; padding-bottom: 16px; border-bottom: 1px solid #f0f1f5; }
.head-img { width: 64px; height: 64px; border-radius: 10px; }
.head-img.placeholder { background: #eef0f5; }
.head-info { flex: 1; }
.head-name { font-weight: 600; font-size: 15px; }
.mat-tabs { min-height: 220px; }
.mat-add { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
.upload-progress { font-size: 12px; }
.material-card { padding: 12px; margin-bottom: 12px; border: 1px solid #eceef3; border-radius: 10px; }
.material-card-head { display: flex; align-items: center; gap: 10px; }
.mat-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f4f5f8; }
.mat-ops { margin-left: auto; display: flex; gap: 10px; }
.rename-input { width: 220px; max-width: 42vw; }
.material-card .op, .material-card .del { color: #c0c4cc; cursor: pointer; }
.material-card .op:hover { color: #6b5cf6; }
.material-card .del:hover { color: #f56c6c; }
.qianchuan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0 14px;
}
.qc-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
</style>
