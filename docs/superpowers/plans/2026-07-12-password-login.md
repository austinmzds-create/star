# 内部账号密码登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有登录页增加仅供管理员和商务使用的账号密码入口，同时完整保留三种角色的手机号验证码登录。

**Architecture:** 复用后端现有 `/api/auth/login` staff 登录接口，只改造 Vue 登录组件。前端用 Element Plus tabs 隔离两套表单，通过 Vitest 和 Vue Test Utils 验证请求、存储、导航、错误与回车提交行为。

**Tech Stack:** Vue 3、Element Plus、Axios、Vue Router、Vite、Vitest、Vue Test Utils、jsdom

---

## 文件结构

- 修改 `web/package.json` 与 `web/package-lock.json`：增加前端测试命令和测试依赖。
- 创建 `web/src/views/Login.test.js`：覆盖双登录模式及账号密码登录数据流。
- 修改 `web/src/views/Login.vue`：增加 tabs、账号密码表单及提交函数，不修改手机号登录协议。

### Task 1: 建立登录组件测试基线

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json`
- Create: `web/src/views/Login.test.js`

- [ ] **Step 1: 安装测试依赖并增加测试命令**

Run:

```bash
cd web
npm install --save-dev vitest@^2.1.9 @vue/test-utils@^2.4.6 jsdom@^25.0.1
npm pkg set scripts.test="vitest run"
```

Expected: `package.json` 包含 `"test": "vitest run"`，lockfile 记录三个开发依赖。

- [ ] **Step 2: 写账号密码登录的失败测试**

创建 `web/src/views/Login.test.js`，mock API、路由和消息组件；挂载 `Login.vue` 后验证：

```js
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.vue'

const post = vi.fn()
const push = vi.fn()
const warning = vi.fn()
const error = vi.fn()

vi.mock('../api', () => ({ default: { post } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('element-plus', async (loadOriginal) => {
  const actual = await loadOriginal()
  return { ...actual, ElMessage: { warning, error, success: vi.fn() } }
})

describe('Login', () => {
  beforeEach(() => {
    post.mockReset()
    push.mockReset()
    warning.mockReset()
    error.mockReset()
    localStorage.clear()
  })

  it('defaults to phone login and exposes a password login tab', async () => {
    const wrapper = mount(Login, { global: { plugins: [(await import('element-plus')).default] } })
    expect(wrapper.text()).toContain('手机号登录')
    expect(wrapper.text()).toContain('账号密码登录')
    expect(wrapper.find('input[placeholder="手机号"]').exists()).toBe(true)
  })

  it('submits staff credentials and enters the workbench', async () => {
    post.mockResolvedValue({
      token: 'staff-token',
      kind: 'staff',
      user: { id: 1, name: '管理员', role: 'admin' },
    })
    const wrapper = mount(Login, { global: { plugins: [(await import('element-plus')).default] } })
    await wrapper.get('[data-testid="password-tab"]').trigger('click')
    await wrapper.get('input[placeholder="账号"]').setValue('admin')
    await wrapper.get('input[placeholder="密码"]').setValue('admin123')
    await wrapper.get('[data-testid="password-submit"]').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/auth/login', {
      username: 'admin',
      password: 'admin123',
    })
    expect(localStorage.getItem('token')).toBe('staff-token')
    expect(push).toHaveBeenCalledWith('/workbench')
  })
})
```

在同一测试文件加入以下测试；`openPasswordLogin()` 是文件内辅助函数，负责挂载组件并点击 `data-testid="password-tab"`：

```js
async function openPasswordLogin() {
  const ElementPlus = (await import('element-plus')).default
  const wrapper = mount(Login, { global: { plugins: [ElementPlus] } })
  await wrapper.get('[data-testid="password-tab"]').trigger('click')
  return wrapper
}

it('does not request password login when credentials are missing', async () => {
  const wrapper = await openPasswordLogin()
  await wrapper.get('[data-testid="password-submit"]').trigger('click')
  expect(warning).toHaveBeenCalledWith('请填写账号和密码')
  expect(post).not.toHaveBeenCalled()
})

it('shows the backend password login error', async () => {
  post.mockRejectedValue({ response: { data: { detail: '用户名或密码错误' } } })
  const wrapper = await openPasswordLogin()
  await wrapper.get('input[placeholder="账号"]').setValue('admin')
  await wrapper.get('input[placeholder="密码"]').setValue('wrong')
  await wrapper.get('[data-testid="password-submit"]').trigger('click')
  await flushPromises()
  expect(error).toHaveBeenCalledWith('用户名或密码错误')
  expect(wrapper.get('[data-testid="password-submit"]').attributes('disabled')).toBeUndefined()
})

it('submits password login with Enter', async () => {
  post.mockResolvedValue({ token: 'staff-token', user: { role: 'bd' } })
  const wrapper = await openPasswordLogin()
  await wrapper.get('input[placeholder="账号"]').setValue('business')
  const passwordInput = wrapper.get('input[placeholder="密码"]')
  await passwordInput.setValue('secret')
  await passwordInput.trigger('keyup.enter')
  await flushPromises()
  expect(post).toHaveBeenCalledWith('/api/auth/login', {
    username: 'business',
    password: 'secret',
  })
})
```

- [ ] **Step 3: 运行测试并确认因功能缺失而失败**

Run:

```bash
cd web
npm test -- src/views/Login.test.js
```

Expected: FAIL，失败原因是找不到“账号密码登录”标签或 `data-testid="password-tab"`，而不是测试环境或语法错误。

- [ ] **Step 4: 提交测试基线**

```bash
git add web/package.json web/package-lock.json web/src/views/Login.test.js
git commit -m "test: cover staff password login"
```

### Task 2: 实现双模式登录页

**Files:**
- Modify: `web/src/views/Login.vue`
- Test: `web/src/views/Login.test.js`

- [ ] **Step 1: 增加独立账号密码状态和提交函数**

在 `Login.vue` 的 `<script setup>` 增加：

```js
const activeMode = ref('phone')
const username = ref('')
const password = ref('')
const passwordLoading = ref(false)

async function passwordLogin() {
  if (!username.value || !password.value) {
    return ElMessage.warning('请填写账号和密码')
  }
  passwordLoading.value = true
  try {
    const data = await api.post('/api/auth/login', {
      username: username.value,
      password: password.value,
    })
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    await router.push('/workbench')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '登录失败')
  } finally {
    passwordLoading.value = false
  }
}
```

- [ ] **Step 2: 把现有手机号表单放入默认 tab，并增加密码 tab**

模板使用以下结构，现有手机号输入、验证码、倒计时和 `login` 函数保持不变：

```vue
<el-tabs v-model="activeMode" stretch>
  <el-tab-pane label="手机号登录" name="phone">
    <!-- 现有手机号验证码表单 -->
  </el-tab-pane>
  <el-tab-pane label="账号密码登录" name="password">
    <template #label>
      <span data-testid="password-tab">账号密码登录</span>
    </template>
    <el-input v-model="username" placeholder="账号" size="large" class="fld" />
    <el-input
      v-model="password"
      placeholder="密码"
      type="password"
      show-password
      size="large"
      class="fld password-field"
      @keyup.enter="passwordLogin"
    />
    <el-button
      data-testid="password-submit"
      type="primary"
      size="large"
      class="submit"
      :loading="passwordLoading"
      @click="passwordLogin"
    >
      登录
    </el-button>
    <p class="hint">仅管理员和商务使用账号密码登录</p>
  </el-tab-pane>
</el-tabs>
```

品牌副标题改为“手机号验证码或内部账号登录”，并补充 tabs 与密码字段的必要间距样式。

- [ ] **Step 3: 运行目标测试并修到全绿**

Run:

```bash
cd web
npm test -- src/views/Login.test.js
```

Expected: 所有 `Login.test.js` 测试 PASS，0 failed。

- [ ] **Step 4: 运行完整前端验证**

Run:

```bash
cd web
npm test
npm run build
```

Expected: 全部测试 PASS；Vite build 退出码为 0。

- [ ] **Step 5: 提交实现**

```bash
git add web/src/views/Login.vue
git commit -m "feat: add staff password login"
```

### Task 3: 启动并做浏览器冒烟测试

**Files:**
- Verify: `server/app/main.py`
- Verify: `web/src/views/Login.vue`

- [ ] **Step 1: 准备本地环境并启动后端**

保留可用的旧测试数据库时，将其复制到当前 `server/dev.db`；否则由启动 seed 新建管理员。然后运行：

```bash
cd server
python3 -m pip install -r requirements.txt
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Expected: `/api/health` 返回 `{"ok": true, ...}`，启动日志无数据库 schema 错误。

- [ ] **Step 2: 启动前端**

```bash
cd web
npm run dev -- --host 127.0.0.1
```

Expected: Vite 在 `http://127.0.0.1:5173/` 提供页面。

- [ ] **Step 3: 浏览器验证管理员账号密码登录**

打开 `http://127.0.0.1:5173/login`，切换“账号密码登录”，输入 `admin / admin123` 并提交。

Expected: 请求 `/api/auth/login` 返回 200，页面进入 `/workbench`，右上角显示管理员身份。

- [ ] **Step 4: 回归手机号登录入口**

退出后返回登录页，确认默认仍为“手机号登录”，手机号格式校验和获取验证码按钮可用。

Expected: 达人仍只能通过手机号验证码完成身份识别；页面没有达人账号密码注册入口。

- [ ] **Step 5: 检查最终差异**

```bash
git status --short
git diff --check origin/claude/influencer-quality-assessment-6rd4lv...HEAD
git log --oneline -4
```

Expected: 工作区干净、无空白错误，提交只包含设计、计划、测试依赖、登录测试和登录组件改造。
