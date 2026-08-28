# Observer — task2:压缩包预览

> 范围定稿（2026-08-27)。只做**目录结构预览**，不解压预览包内文件。
> 关联:[docs/design.md](docs/design.md)(架构铁律 / §9 持久化)· [docs/layout.md](docs/layout.md)(§4 宫格 / §5 功能条)· [docs/method.md](docs/method.md)(格式识别)。本文档登记需求与设计，实现后并入 README"当前进度"。

## 1. 目标与范围

- 在宫格里预览**多文件压缩包的目录结构**，以**可折叠树**展示——外观类似左侧文件 frame，但**文件行点击无任何动作**（不预览包内文件，如图片)。
- 覆盖（单文件）:**ZIP / RAR(RAR4+RAR5)/ 7z**。
- 双身份容器（本质是 zip:jar / xlsx / docx / pptx / epub…）支持"以压缩包形式"查看目录（§5)。
- **本轮不做**:解压预览包内文件、tar 系、gz 单文件、分卷压缩（§6)、嵌套压缩包。

## 2. 格式识别

新增 `archive` kind（前后端，`kindForExt` 与 Rust `kind_for_ext` 同步）。两级识别，**不看扩展名下结论**:

| 目标 | 魔数 / 结构嗅探 |
|---|---|
| zip / zip 容器 | `PK\x03\x04`(空包可能 `PK\x05\x06`) |
| RAR4 | `Rar!\x1A\x07\x00` |
| RAR5 | `Rar!\x1A\x07\x01\x00` |
| 7z | `7z\xBC\xAF\x27\x1C` |

**zip 容器细分**(magic 都是 `PK`，靠内部结构区分，防止把 xlsx 误判成普通 zip):

| 容器 | 判据（包内特征条目） | 默认 kind |
|---|---|---|
| jar | `META-INF/MANIFEST.MF` | archive |
| xlsx / docx / pptx | `[Content_Types].xml` + `xl/` `word/` `ppt/` | 保持原 handler(xlsx→spreadsheet) |
| epub | 首条目 `mimetype` 内容 = `application/epub+zip` | archive |

- xlsx 默认仍走表格，"以压缩包打开"只是附加动作（§5)，不改变默认路由。
- jar / epub / docx / pptx 当前无原生预览 → 默认即压缩包目录视图。

## 3. 目录树预览(ArchiveView)

- **Rust 列条目只读 header / 中央目录，不解压任何文件数据**;IPC 只传元数据（相对路径、是否目录、大小、mtime、是否加密)——守铁律 2（媒体字节不走 IPC，这里根本不取字节）。
- 宫格内一棵可折叠树：
  - **文件夹行**点击 = 展开/折叠；
  - **文件行**点击 = 无动作（与左侧文件 frame 的唯一交互差异）。
- 复用文件树的**按类型分色图标**;**大压缩包用 `@tanstack/react-virtual` 虚拟滚动**。
- 空包 / 损坏包 / 不支持格式 → 宫格内错误占位（文件名 + 原因，不崩溃、不影响其他宫格，同 layout.md §8)。

## 4. 加密处理

**关键区分两种加密**（决定要不要弹密码框）:

| 加密层次 | 典型场景 | 能否看目录 | 处理 |
|---|---|---|---|
| 只加密**数据** | 几乎所有带密码的 zip；未勾"加密文件名"的 rar/7z | ✅ 能 | **照常列目录，不弹密码框**；加密条目加**锁标记** |
| **文件头**加密 | `rar -hp` / `7z -mhe=on` | ❌ 不能 | 宫格内显示"**文件头已加密**" + 密码输入框 |

- 后端列目录时返回"头加密"错误类型，前端据此切换为密码框视图。

### 密码记忆：明文存 SQLite

- 新增表 `archive_password(path TEXT PRIMARY KEY, pwd TEXT NOT NULL, updated_at INTEGER NOT NULL)`，按压缩包**绝对路径**存**明文**密码。
- 打开流程：
  1. 探测到头加密 → 查库：有该路径密码 → **先自动尝试**;
  2. 成功 → 直接列目录（用户无感）;
  3. 失败（密码已改）或没有 → 显示密码框（已存则**预填**)→ 用户确认后写入库并列出。
- 密码**只用于列目录**；本轮不解压包内文件，无需用密码取内容。
- **记录管理**(design.md §9.4)：密码记录纳入分组，可单删/清空。
- ⚠️ **风险**:SQLite 明文存密码，本机任何能读 `%APPDATA%/.../observer.db` 的人都可见。本地预览工具可接受；对外分发前评估换 OS 钥匙串（`keyring` crate)。

## 5. 双身份文件（zip 容器）

jar / xlsx / docx / pptx / epub 本质是 zip，可两种视角：

- **入口：功能条加切换按钮**（定稿）。选中格为双身份文件时，功能条（layout.md §5）出现"**压缩包目录 / 原生预览**"切换。
  - xlsx：表格 ↔ 压缩包目录；
  - docx：当前仅压缩包目录，**未来接 Word 原生预览后**可切换（README 已列 word 为后续）;
  - jar / epub / pptx：当前仅压缩包目录。
- 切换只改当前格的展示方式，不改文件本身，也不改默认路由规则。

## 6. 分卷压缩(本轮整体暂缓)

> 用户疑问的解答：分卷 = **一个逻辑压缩包的字节被拆成多个文件**（如 `a.part1.rar`+`a.part2.rar`、`a.7z.001`+`a.7z.002`、`a.zip`+`a.z01`)。读时**从第一卷打开**，库把各卷当作一段连续字节流接力读完；缺任一卷即失败。用户不用手动选卷。

**本轮整体暂缓，记为后续里程碑。** 预留的技术路径：

| 格式 | 分卷形态 | 未来做法 |
|---|---|---|
| RAR | `.part1.rar…` / `.r00…` | `unrar` 自动跟卷（开第一卷即可） |
| 7z | `.7z.001…` | 把 `.001/.002/…` 顺序拼成一个 `Read` 流（7z 分卷就是单文件等切） |
| ZIP | `.z01…` | **难**：非简单字节切分，中央目录跨卷、`zip` crate 基本不支持，需自研跨卷解析 |

- 暂缓期间：文件树把分卷成员（`.z01/.r00/.part2.rar/.7z.002` 等非首卷）当**不可预览文件**处理，避免误开半个包；首卷可识别但提示"分卷压缩，暂不支持"。

## 7. 实现要点（crate / 命令 / 落点)

| 层 | 内容 |
|---|---|
| crate | `zip`（特性 `aes-crypto`)、`unrar`、`sevenz-rust`(tar 系后续 `tar`+`flate2`/`xz2`/`zstd`) |
| 后端命令（lib.rs 注册） | `archive_list(path) -> Vec<EntryMeta>`（错误区分"头加密/损坏/不支持");`archive_pwd_get(path)` / `archive_pwd_set(path, pwd)` / `archive_pwd_remove(path)` |
| db.rs | 新增 `archive_password` 表 + 存取函数 |
| 前端 | `formats/handlers/archive.ts` + `components/preview/ArchiveView.tsx`，在 `registry.ts` 登记一行；功能条按 `archive`/双身份 kind 出切换按钮 |

新增格式完全走现有**插件式注册表**：加一个 handler 文件 + registry 一行（method.md §1)。

## 8. 边界 / 后续

- 嵌套压缩包（zip 套 zip)：不做。
- **包内文件预览**（如图片）：本轮不做；架构上"单条目解压"可复用 M2 的 PNG 磁盘缓存管道（`decode_image` 同款模式：`archive_entry → PNG 缓存 → asset://`)，留作后续。
- tar / tar.gz / tar.xz / tar.zst、gz 单文件、CAB / ISO：后续。
- 分卷压缩：见 §6。
- Word(docx）原生预览：后续（README 已列）。
