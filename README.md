# VALORANT Sensitivity Finder

无畏契约灵敏度测试工具。通过甩枪、跟枪和微调测试，比较不同灵敏度下的操作表现，给出推荐值和参考区间。

[在线使用](https://neoe-404.github.io/valorant-sensitivity-finder/)

## 使用方法

1. 在电脑浏览器中打开网站，填写鼠标 DPI 和当前游戏灵敏度。
2. 完成校准，熟悉准星移动和测试方式。
3. 按提示完成多轮测试，每轮比较当前灵敏度附近的候选值。
4. 查看推荐结果、eDPI 和各项成绩，也可以在历史记录中回看。

测试时点击页面按钮锁定鼠标，按 `Esc` 暂停。设置和历史记录保存在当前浏览器中，无需注册。

网页通过鼠标输入模拟不同灵敏度下的准星移动，不会修改游戏或系统设置。浏览器输入、系统指针加速和显示缩放都可能影响结果，建议将推荐区间带入游戏训练场再作调整。

## 测试内容

| 项目 | 操作 | 主要记录 |
| --- | --- | --- |
| 甩枪 | 快速移动并点击目标 | 命中率、到达时间、路径效率、过冲与修正 |
| 跟枪 | 持续跟随移动目标 | 跟随误差、覆盖率、速度匹配、抖动 |
| 微调 | 移向小目标并稳定保持 | 定位精度、保持误差、修正次数 |

搜索从当前灵敏度附近开始，根据每轮成绩调整中心并缩小范围。标准模式最多四轮，快速模式最多三轮。结果页提供推荐灵敏度、参考区间、六维能力图和表现分析。

评分与搜索实现分别见 [lib/scoring.ts](lib/scoring.ts) 和 [lib/sensitivity-engine.ts](lib/sensitivity-engine.ts)。结果中的置信指标用于反映本次测试的表现差异与收敛情况，不是统计意义上的准确概率。

## 本地运行

使用 Node.js 24，与部署工作流保持一致。

```bash
npm ci
npm run dev
```

打开 [localhost:3000](http://localhost:3000)。

| 命令 | 用途 |
| --- | --- |
| `npm test` | 运行单元测试 |
| `npm run lint` | 检查代码规范 |
| `npm run typecheck` | 检查 TypeScript 类型 |
| `npm run build` | 生产构建 |
| `npm start` | 启动生产服务器 |

开发时可访问 `/test?debug=true`，查看鼠标增量、灵敏度倍率和帧率。

## 项目结构

项目使用 Next.js App Router、React 和 TypeScript，样式由 Tailwind CSS 管理。测试画面使用 Canvas 2D 绘制，图表使用 Recharts。

```text
app/                 页面与全局样式
components/aim/      测试画布、目标和准星
components/tests/    校准、甩枪、跟枪和微调场景
components/results/  结果卡片与图表
hooks/               鼠标锁定、输入采集和测试流程
lib/                 评分、灵敏度搜索、分析和本地存储
types/               共享类型
tests/               Vitest 单元测试
```

## 部署

网站托管在 GitHub Pages。推送到 `main` 后，[部署工作流](.github/workflows/deploy-pages.yml) 会依次运行测试、Lint、类型检查和静态构建，通过后自动发布。

在自己的仓库部署时，将 **Settings → Pages → Build and deployment → Source** 设为 **GitHub Actions**，然后运行 `Deploy GitHub Pages` 工作流。

工作流通过 `GITHUB_PAGES=true` 启用静态导出，并从 Pages 配置读取 `PAGES_BASE_PATH`。构建产物位于 `out/`，无需提交。普通本地构建仍使用 Next.js 默认运行方式。

## 使用限制

- 瞄准测试需要桌面鼠标和浏览器 Pointer Lock 支持。触屏设备可浏览结果与历史。
- 鼠标锁定失败时可以重试；按 `Esc`、窗口失焦或严重掉帧会暂停测试。
- 支持时优先使用原始鼠标输入，否则使用普通鼠标输入，手感可能受系统指针加速影响。
- 历史记录最多保留 50 条，仅存于当前浏览器。清除站点数据会删除记录，不同设备之间不会同步。
- 结果保存失败时，页面提供 JSON 导出；刷新前请先保存。
