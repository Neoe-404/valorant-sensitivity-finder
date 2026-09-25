# Valorant Sensitivity Finder · 无畏契约灵敏度测试器

通过**你自己的鼠标测试数据**来寻找最适合你的 VALORANT 灵敏度 —— 不是复制职业选手的参数，也不是 eDPI 计算器。

> ⚠️ 说明：网页无法修改 Windows / 游戏内的真实灵敏度。本工具使用浏览器 Pointer Lock API 读取真实的 `movementX/Y`，通过 **Virtual Sensitivity Multiplier** 模拟不同灵敏度的相对控制体验。它是一款**灵敏度推荐工具**，提供基于你自身表现的候选区间与置信度，不是物理级的输入校准设备。

---

## 核心原理

1. **真实数据采集**：Pointer Lock 锁定鼠标后，逐帧累计 `movementX/Y`（含 `getCoalescedEvents`）。优先请求 `unadjustedMovement`；只能使用普通锁定时会提示系统加速的影响。
2. **虚拟灵敏度近似换算**：`px/count = 候选灵敏度 × 0.07 × (画布 CSS 宽度 ÷ 103)`。DPI 决定相同物理距离产生的 count 数，不能重复乘入每 count 倍率。800×0.35 与 1600×0.175 在同一物理移动距离下得到相同虚拟位移；默认 800 DPI、0.35、1920px 约为 0.457 px/count。实际浏览器和显示缩放仍需实测，不能视为物理级校准。
3. **三项专项测试**：
   - **Flick Test**（30%）：20 个大目标，记录命中、到达时间、反应时间、路径效率、过冲/欠冲、修正次数；
   - **Tracking Test**（30%）：20 秒跟随正弦叠加 + 漂移的平滑目标，逐帧记录误差、覆盖、速度匹配、抖动；
   - **Micro Adjustment**（25%）：12 个贴近准星的小目标，需要在目标内稳定保持 400ms 才算命中。
   - **Consistency**（15%）：同一候选三项分数的均衡程度，不等于重复测量稳定性。
4. **多轮搜索**：每轮 3 个候选（初始 = 当前 × {0.8, 1.0, 1.2}），按成绩权重确定下一轮中心，步长逐轮缩小（20% → 12% → 8% → 5% → 3%），最多 4 轮，收敛到稳定区间。
5. **结果**：推荐灵敏度 + 推荐区间 + eDPI + 置信度 + 六维瞄准画像雷达图（Flick / Tracking / Micro / 稳定性 / 速度 / 精度）+ 规则引擎生成的文字分析。

所有成绩 100% 来源于你本次测试的真实鼠标移动路径、时间与点击数据，**无任何随机或伪造数据**。

---

## 技术栈

- Next.js 16（App Router，Turbopack）+ React 19 + TypeScript（strict）
- Tailwind CSS v4（`@theme` 设计令牌，无需 tailwind.config）
- Canvas 2D + requestAnimationFrame 高频渲染（虚拟准星与目标全走 ref，不触发 React 重渲染）
- Vitest 5（评分、搜索、存储、锁定请求及场景回调回归测试；数量以 `npm test` 输出为准）
- Recharts（雷达图 / 趋势图）· Framer Motion（动效）· lucide-react（图标）
- 无数据库：localStorage 仅存本机（`vsf:settings:v1` / `vsf:history:v1` / `vsf:lastSession:v1`），结构上为将来接入 Supabase / Postgres / 账号体系预留

---

## 快速开始

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器 http://localhost:3000
```

流程：首页 → 设置（DPI + 当前灵敏度，实时算 eDPI）→ 校准（~20 秒，不记分）→ 多轮候选测试 → 结果页（推荐 + 雷达 + 分析）→ 历史页（可删/清空，含趋势图）。

### 常用命令

```bash
npm run test       # Vitest 单元测试
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
npm run build      # 生产构建（已验证通过）
npm start          # 生产服务器
```

调试：测试页面 URL 加 `?debug=true` 显示原始/虚拟增量、倍率、FPS 面板（仅开发阶段建议使用）。

### GitHub Pages 部署

在仓库的 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。
推送到 `main` 后，`Deploy GitHub Pages` 工作流会运行测试、Lint、类型检查，导出静态网站并发布。
也可在 Actions 页面手动运行该工作流。

Pages 构建使用 `GITHUB_PAGES=true`，并从 Pages 配置读取 `PAGES_BASE_PATH`，确保子路径下的导航和资源地址正确。
本地开发以及普通 `npm run build` / `npm start` 保持 Next.js 默认运行方式。导出的 `out/` 无需提交。

私有仓库使用 Pages 需要支持该功能的 GitHub 套餐；公开网站与公开源码是两个独立选择，不要为部署直接更改仓库可见性。

---

## 目录结构

```
app/
  page.tsx            # 首页（Hero / How It Works / 示例结果卡 / 为什么不抄职业选手）
  setup/page.tsx      # 设置表单（DPI + 灵敏度，实时 eDPI，模式/水平/惯用手）
  test/page.tsx       # 测试流程编排（校准 → 候选 → 测试 → HUD/就绪/暂停覆盖层）
  results/page.tsx    # 结果页（?id= 查历史，缺省读最后一次会话）
  history/page.tsx    # 历史列表 + 趋势图 + 详情 + 删除/清空
  layout.tsx / globals.css
components/
  aim/                # AimArena（Pointer Lock + Canvas 主循环 + Scene）+ 准星/目标绘制
  tests/              # Calibration / Flick / Tracking / MicroAdjustment + 通用配置
  results/            # ScoreCard / 雷达图 / 推荐卡 / 历史趋势图
  layout/Navbar.tsx · DebugPanel.tsx
hooks/
  usePointerLock.ts · useMouseTracking.ts · useSensitivitySession.ts（会话状态机）
lib/
  statistics.ts       # mean/median/std/cv/percentile/clamp
  mouse-math.ts       # eDPI、倍率、距离、路径
  scoring.ts          # Flick/Tracking/Micro/综合评分 + 惩罚
  sensitivity-engine.ts # SensitivitySearch：候选生成、加权中心、收敛、推荐
  analysis-engine.ts  # 规则引擎：雷达画像 + 文字分析（无 AI 依赖）
  storage.ts          # localStorage SSR 安全封装
types/                # 所有数据模型（settings/aim/sensitivity/analysis）
tests/                # 单元、场景回调与会话流程回归测试
```

---

## 评分模型

- **Flick**：命中率 28% + 到达速度 22% + 反应 12% + 路径效率 18% + 时间一致性 20%，减去 过冲率×16 / 欠冲率×12 / 修正次数惩罚。
- **Tracking**：平均误差（相对目标半径规范化）+ 覆盖率 + 稳定性 + 速度匹配 + 抖动惩罚。
- **Micro**：命中精度 + hold 误差 + 稳定性 + 修正惩罚。
- **综合分** = 0.30×Flick + 0.30×Tracking + 0.25×Micro + 0.15×Consistency − Penalties。

阈值基线（针对目标半径 Flick≈36px / Tracking≈26px / Micro≈8px 调校）在 `lib/scoring.ts` 顶部有注释说明。

---

## 灵敏度搜索算法

`lib/sensitivity-engine.ts`（纯函数类，可单测，无外部数学库）：

1. 第 1 轮：`base × {0.8, 1.0, 1.2}`；
2. 完成一轮后，用候选池内得分最高的 3 个候选（分数²加权）求下一轮中心：
   `center = Σ(scoreᵢ²·sensᵢ) / Σ(scoreᵢ²)`；
3. 候选 = `center × (1 ± step)`，步长序列 `[0.20, 0.12, 0.08, 0.05, 0.03]`；
4. 收敛条件：相邻轮中心位移 < 初始灵敏度 × 1%，或轮数耗尽（标准 4 轮 / 快速 3 轮）；
5. 推荐 = 得分达到最佳分数 92% 的候选按分数加权平均；区间限制在候选范围及推荐值 ± 最佳灵敏度 × 最新步长内。置信指标综合区间跨度、前两名分差和轮数，是启发式指标，不是经统计校准的概率。所有候选均为零分时不生成推荐。

---

## 浏览器限制（请知悉）

- **仅桌面端**：测试需要 Pointer Lock 与真实鼠标增量；`(pointer: coarse)` 触屏设备会显示提示，只能浏览首页/结果/历史。
- **Pointer Lock 需要用户手势**：每次测试点击“锁定鼠标并开始”；ESC、失焦或严重丢帧会暂停。就绪和暂停时间不计入测试。恢复时重做当前目标；跟踪测试重做当前整段并清空旧样本。
- **系统指针加速**：请求锁定时会附带 `unadjustedMovement`（Chrome 支持）以禁用 Windows“提高指针精度”，使增量接近游戏 raw input；不支持时自动降级为普通指针增量（手感会受系统加速影响）。
- **换算近似**：采用 0.07°/count/sens 与水平 FOV 103°的线性近似，倍率按实际画布宽度更新。不同浏览器、显示缩放及长宽比需要在真实设备上验证。
- Pointer Lock 被浏览器拒绝时：测试保持未开始或暂停状态，显示重试提示，不使用系统光标生成正式推荐。
- 校准与测试期间请**关闭 FPS 工具 / 其它全屏覆盖**，避免锁定被抢占。
- 设置与历史只保存在本机 localStorage，历史最多保留最近 50 条。保存设置失败会阻止进入测试；结果保存失败时在当前页面临时保留并提供 JSON 导出，刷新可能丢失。删除历史会同步删除对应最近快照；指定不存在的结果 ID 不会显示其他会话。

---

## 路线图（未来）

- Supabase/Postgres 账号体系：云端保存设置与历史、跨设备同步
- 更多瞄准画像维度（反恐精英灵敏度换算 → VALORANT）
- 分模式（步枪/狙击）灵敏度建议
- 测试回放（轨迹录像）
- 社区匿名对比：与同段位玩家的画像分布对比
