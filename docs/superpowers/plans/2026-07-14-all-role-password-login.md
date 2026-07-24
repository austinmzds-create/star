# 全角色账号密码登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员、商务和达人在保留短信验证码登录的同时，都能使用账号/手机号与密码登录。

**Architecture:** 为达人模型增加密码哈希，使用模型事件和启动 seed 为有手机号且尚无密码的账号生成“手机号后 6 位”初始密码。统一登录接口先匹配内部账号、再匹配达人，并返回现有 staff/influencer 会话结构；前端复用现有 `applyRoleSession()` 完成角色跳转。

**Tech Stack:** FastAPI、SQLAlchemy、bcrypt、SQLite/PostgreSQL、Vue 3、Vitest

---

## 文件结构

- Modify `server/app/security.py`：提供手机号默认密码与只补空密码的函数。
- Modify `server/app/models.py`：为达人增加 `password_hash`，新建/更新账号时自动补齐。
- Create `server/app/services/account_passwords.py`：启动时补齐历史账号密码。
- Modify `server/app/main.py`：迁移补列后执行历史密码 seed。
- Modify `server/app/api/auth.py`：统一解析 username、内部手机号和达人手机号。
- Create `server/tests/test_all_role_password_login.py`：后端三角色与安全边界测试。
- Modify `web/src/views/Login.vue`：文案改为全角色可用。
- Modify `web/src/views/Login.test.js`：验证达人密码登录进入 H5。

### Task 1: 默认手机号密码生成与旧数据补齐

**Files:**
- Modify: `server/app/security.py`
- Modify: `server/app/models.py`
- Create: `server/app/services/account_passwords.py`
- Modify: `server/app/main.py`
- Create: `server/tests/test_all_role_password_login.py`

- [ ] **Step 1: 写默认密码生成的失败测试**

创建内存 SQLite fixture，测试新账号自动生成、无手机号不生成、已有密码不覆盖、历史数据 seed：

```python
import pytest
from sqlalchemy import create_engine, update
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import Influencer, User
from app.security import hash_password, verify_password
from app.services.account_passwords import seed_missing_passwords


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()


def test_new_phone_accounts_receive_last_six_password(db):
    bd = User(phone="13900001234", display_name="商务", role="bd")
    inf = Influencer(phone="15095037973", nickname="达人")
    db.add_all([bd, inf])
    db.commit()
    assert verify_password("001234", bd.password_hash)
    assert verify_password("037973", inf.password_hash)


def test_account_without_phone_has_no_default_password(db):
    inf = Influencer(phone=None, nickname="无手机号达人")
    db.add(inf)
    db.commit()
    assert inf.password_hash is None


def test_seed_preserves_existing_password_and_fills_missing(db):
    custom_hash = hash_password("custom-pass")
    existing = User(phone="13800000001", display_name="已有密码", role="bd",
                    password_hash=custom_hash)
    missing = Influencer(phone="15000008888", nickname="待补齐")
    db.add_all([existing, missing])
    db.commit()
    db.execute(update(Influencer).where(Influencer.id == missing.id).values(password_hash=None))
    db.commit()

    seed_missing_passwords(db)

    assert existing.password_hash == custom_hash
    assert verify_password("008888", missing.password_hash)


def test_adding_phone_later_generates_password(db):
    inf = Influencer(phone=None, nickname="后补手机号")
    db.add(inf)
    db.commit()
    inf.phone = "15000007777"
    db.commit()
    assert verify_password("007777", inf.password_hash)
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
cd server
uv run --with-requirements requirements.txt --with pytest pytest tests/test_all_role_password_login.py -v
```

Expected: FAIL，`Influencer` 没有 `password_hash`，且 `account_passwords` 服务不存在。

- [ ] **Step 3: 实现默认密码辅助函数**

在 `security.py` 增加：

```python
def default_password_from_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    return phone[-6:]


def assign_default_password_if_missing(account) -> bool:
    plain = default_password_from_phone(getattr(account, "phone", None))
    if not plain or getattr(account, "password_hash", None):
        return False
    account.password_hash = hash_password(plain)
    return True
```

- [ ] **Step 4: 为达人增加字段并注册模型事件**

在 `Influencer` 增加：

```python
password_hash: Mapped[str | None] = mapped_column(String(128))
```

在模型类定义完成后注册：

```python
from sqlalchemy import event
from .security import assign_default_password_if_missing


def _assign_default_password(_mapper, _connection, target):
    assign_default_password_if_missing(target)


for account_model in (User, Influencer):
    event.listen(account_model, "before_insert", _assign_default_password)
    event.listen(account_model, "before_update", _assign_default_password)
```

`ensure_columns()` 会从模型元数据自动为已有数据库增加可空的 `influencers.password_hash`。

- [ ] **Step 5: 实现启动历史数据 seed**

创建 `server/app/services/account_passwords.py`：

```python
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Influencer, User
from ..security import assign_default_password_if_missing


def seed_missing_passwords(db: Session) -> int:
    changed = 0
    for model in (User, Influencer):
        accounts = db.scalars(select(model).where(
            model.phone.is_not(None),
            model.password_hash.is_(None),
        )).all()
        for account in accounts:
            changed += int(assign_default_password_if_missing(account))
    if changed:
        db.commit()
    return changed
```

在 `main.startup()` 的 `ensure_columns()` 之后、默认管理员 seed 之后调用：

```python
account_passwords.seed_missing_passwords(db)
```

默认管理员在开发环境仍显式使用 `admin123`，不会被手机号规则覆盖。

- [ ] **Step 6: 运行默认密码测试并确认 GREEN**

Run: `cd server && uv run --with-requirements requirements.txt --with pytest pytest tests/test_all_role_password_login.py -v`

Expected: 本任务的 3 个测试通过。

- [ ] **Step 7: 提交数据模型与 seed**

```bash
git add server/app/security.py server/app/models.py server/app/services/account_passwords.py server/app/main.py server/tests/test_all_role_password_login.py
git commit -m "feat: seed default passwords for all roles"
```

### Task 2: 统一内部账号与达人密码登录

**Files:**
- Modify: `server/app/api/auth.py:126-145`
- Modify: `server/tests/test_all_role_password_login.py`

- [ ] **Step 1: 写三角色登录和状态边界失败测试**

在测试文件增加：

```python
from fastapi import HTTPException

from app.api.auth import LoginIn, login


def test_business_can_login_with_phone_and_default_password(db):
    bd = User(phone="13900001234", display_name="商务", role="bd")
    db.add(bd)
    db.commit()
    result = login(LoginIn(username="13900001234", password="001234"), db)
    assert result["kind"] == "staff"
    assert result["user"]["role"] == "bd"


def test_admin_keeps_username_and_custom_password_login(db):
    admin = User(username="admin", password_hash=hash_password("admin123"),
                 display_name="管理员", role="admin")
    db.add(admin)
    db.commit()
    result = login(LoginIn(username="admin", password="admin123"), db)
    assert result["kind"] == "staff"
    assert result["user"]["role"] == "admin"


def test_influencer_can_login_with_phone_and_default_password(db):
    inf = Influencer(phone="15095037973", nickname="二宝妈妈")
    db.add(inf)
    db.commit()
    result = login(LoginIn(username="15095037973", password="037973"), db)
    assert result["kind"] == "influencer"
    assert result["user"]["role"] == "influencer"


def test_internal_account_wins_when_phone_exists_in_both_tables(db):
    db.add_all([
        User(phone="13900001234", display_name="商务", role="bd"),
        Influencer(phone="13900001234", nickname="同手机号达人"),
    ])
    db.commit()
    result = login(LoginIn(username="13900001234", password="001234"), db)
    assert result["kind"] == "staff"


@pytest.mark.parametrize("account", [
    User(phone="13900001234", display_name="停用商务", role="bd", is_active=False),
    Influencer(phone="15095037973", nickname="停用达人", archived=True),
])
def test_disabled_accounts_cannot_password_login(db, account):
    db.add(account)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        login(LoginIn(username=account.phone, password=account.phone[-6:]), db)
    assert exc.value.status_code == 403


def test_wrong_password_uses_generic_error(db):
    db.add(Influencer(phone="15095037973", nickname="达人"))
    db.commit()
    with pytest.raises(HTTPException) as exc:
        login(LoginIn(username="15095037973", password="wrong"), db)
    assert exc.value.status_code == 401
    assert exc.value.detail == "账号或密码错误"
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `cd server && uv run --with-requirements requirements.txt --with pytest pytest tests/test_all_role_password_login.py -v`

Expected: 达人密码登录测试失败，现有接口只查询 `User.username`。

- [ ] **Step 3: 实现统一账号解析**

在 `auth.py` 引入 `or_`，将 `login()` 改为：

```python
@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalars(select(User).where(or_(
        User.username == body.username,
        User.phone == body.username,
    ))).first()
    if user:
        if not user.password_hash or not verify_password(body.password, user.password_hash):
            raise HTTPException(401, "账号或密码错误")
        if not user.is_active:
            raise HTTPException(403, "账号已停用")
        return _staff_result(user)

    influencer = db.scalars(
        select(Influencer).where(Influencer.phone == body.username).order_by(Influencer.id)
    ).first()
    if not influencer or not influencer.password_hash or not verify_password(
        body.password, influencer.password_hash
    ):
        raise HTTPException(401, "账号或密码错误")
    if influencer.archived:
        raise HTTPException(403, "账号已停用")
    return _influencer_result(influencer)
```

把短信登录和密码登录共用的达人响应提取为：

```python
def _influencer_result(influencer: Influencer) -> dict:
    return {
        "token": make_token("influencer", influencer.id),
        "kind": "influencer",
        "user": {
            "id": influencer.id,
            "name": influencer.nickname,
            "role": "influencer",
        },
    }
```

- [ ] **Step 4: 运行完整后端测试**

Run:

```bash
cd server
uv run --with-requirements requirements.txt --with pytest pytest tests -v
```

Expected: 全部后端测试通过。

- [ ] **Step 5: 提交统一登录接口**

```bash
git add server/app/api/auth.py server/tests/test_all_role_password_login.py
git commit -m "feat: allow influencer password login"
```

### Task 3: 登录页开放全角色密码登录

**Files:**
- Modify: `web/src/views/Login.test.js`
- Modify: `web/src/views/Login.vue:40-75`

- [ ] **Step 1: 写达人密码登录失败测试**

在 `Login.test.js` 增加：

```js
it('enters H5 when password login returns an influencer', async () => {
  mocks.post.mockResolvedValue({
    token: 'influencer-token',
    kind: 'influencer',
    user: { id: 8, name: '二宝妈妈', role: 'influencer' },
  })
  const wrapper = await openPasswordLogin()
  await wrapper.get('input[placeholder="账号或手机号"]').setValue('15095037973')
  await wrapper.get('input[placeholder="密码"]').setValue('037973')
  await wrapper.get('[data-testid="password-submit"]').trigger('click')
  await flushPromises()

  expect(localStorage.getItem('token')).toBe('influencer-token')
  expect(localStorage.getItem('h5_token')).toBe('influencer-token')
  expect(mocks.push).toHaveBeenCalledWith('/h5')
})
```

并把现有密码输入测试的账号 selector 从 `placeholder="账号"` 改为 `placeholder="账号或手机号"`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `cd web && npm test -- src/views/Login.test.js`

Expected: FAIL，找不到 `placeholder="账号或手机号"`。

- [ ] **Step 3: 更新登录页文案**

在 `Login.vue` 修改：

```vue
<el-input v-model="username" placeholder="账号或手机号" size="large" class="fld"
  @keyup.enter="passwordLogin" />
...
<p class="hint">管理员、商务、达人均可使用账号密码登录</p>
```

现有 `passwordLogin()` 已调用 `applyRoleSession(data)`，无需增加重复的 token 或跳转逻辑。

- [ ] **Step 4: 运行完整前端验证**

Run:

```bash
cd web
npm test
npm run build
```

Expected: 前端测试全部通过，Vite build 退出码 0。

- [ ] **Step 5: 提交前端改造**

```bash
git add web/src/views/Login.vue web/src/views/Login.test.js
git commit -m "feat: open password login to all roles"
```

### Task 4: 数据迁移与浏览器验收

**Files:**
- Verify: `server/app/main.py`
- Verify: `server/app/api/auth.py`
- Verify: `web/src/views/Login.vue`

- [ ] **Step 1: 在测试数据库验证自动补列和 seed**

重启当前 Uvicorn 服务，使 `ensure_columns()` 添加达人密码列并执行 seed。然后验证：

```bash
cd server
uv run --with-requirements requirements.txt python - <<'PY'
import sqlite3
con = sqlite3.connect('dev.db')
columns = {row[1] for row in con.execute('pragma table_info(influencers)')}
assert 'password_hash' in columns
missing = con.execute(
    'select count(*) from influencers where phone is not null and password_hash is null'
).fetchone()[0]
assert missing == 0
print('password migration ok')
PY
```

Expected: 输出 `password migration ok`。

- [ ] **Step 2: API 验证三个角色**

分别验证：

```text
管理员：admin / admin123 → kind=staff, role=admin
商务：商务手机号 / 手机号后6位 → kind=staff, role=bd
达人：15095037973 / 037973 → kind=influencer, role=influencer
```

API 响应检查时不输出 token 全文，只检查 `kind` 和 `user.role`。

- [ ] **Step 3: 浏览器验证密码登录跳转**

打开 `/login`，分别完成管理员、商务、达人密码登录。

Expected: 管理员/商务进入 `/workbench`；达人进入 `/h5` 并能打开已授权产品资料中心。

- [ ] **Step 4: 回归短信登录**

分别通过管理员手机号、商务手机号、达人手机号完成验证码登录。

Expected: 三种角色与改造前相同，密码功能不影响短信验证码逻辑。

- [ ] **Step 5: 最终验证**

```bash
cd server
uv run --with-requirements requirements.txt --with pytest pytest tests -v
cd ../web
npm test
npm run build
cd ..
git diff --check origin/claude/influencer-quality-assessment-6rd4lv...HEAD
git status --short --branch
```

Expected: 后端、前端测试和构建全部通过，工作区干净。
