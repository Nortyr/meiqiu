# Meiqiu 项目长期笔记

## 产品口径（用户 2026-11-14 定）
- 自动化第一版目标：先做出「能拆分工作流、能自动化执行」的工具。不做用历史数据 / 历史会话回放来优化的方向，那是工具跑起来、攒够 Run 之后的事。
- 交互红线：不要 Dify 式繁琐配置（画布、逐节点填表、连线、变量映射）。倾向「描述目标 → 生成可改字的步骤清单 → 确认 → 逐行执行」；用户只填目标 / 完成条件 / 边界三样。
- 清单是给人看的，Graph 是内部表示；「Graph 是唯一底层执行模型」的定案保持不变，不做画布和节点检查器。
- **v1 定案（2026-11-14 15:50 拍板，15:57 修订第 ③ 条）**：① 拆成清单（B 方案）；② 自动触发（定时 / 文件变化 / webhook / launchd 后台）推到 v2，v1 只手动启动 + 前台运行；③ 权限**继承各家 Harness 已有的用户配置**（用户配得紧就紧、不紧我们也不紧），Meiqiu 不定义第二套权限规则；④ 边界选 **B（16:04 定）**：运行中零额外拦截，Run 启动前集中显示一次本次 Harness 的权限模式与配置文件位置，只做知情、不要求确认（沿用草案 §4 第 7 条）。实施规格见 `docs/design/2026-11-14-automation-v1-spec.md`（S1 详细方案在 §10，16:08 起只写方案、未执行、代码零改动，开工需另行确认）。
- 待确认一件事：清单式交互与草案 §4 的「结构化编排 + 原图运行 + 节点检查器 + 方案 A 能力合约」等已定案条款冲突，建议降级为高级视图、不删条款。
- 沟通偏好：术语先解释再使用，避免缩写与隐喻（DoD → 完成条件、三级梯子、组一支队等）。分析要挂代码和事实，别堆概念。

## 技术约束（长期）
- Electron + React + TypeScript，SQLite 用 node:sqlite；ACP 是连接层，不自己实现 harness、模型调用或 subagent runtime；不重写会话 / 记忆 / wiki 数据层。
- 主进程独占状态机，renderer 只发起与观察。曾因 `wikiIngestFinish` 依赖 renderer 的 `turn_end`，切页导致 run 永远停在 prepared。
- 权限走「继承 Harness 配置」：ACP v1 规定按用户配置判断要不要问是 Harness 职责，`session/request_permission` 只在配置没覆盖时到达；Meiqiu 起 Harness 时（`settings.ts` 的 `acpEnv()` + `acp/client.ts` spawn）没有 bypass 或权限环境变量，所以继承本就成立。唯一破坏点是 `client.ts:218-233` 自动选 `allow_always`——按规范这会让 Harness 永久记住放行，等于反向改了用户配置。修法：不判断动作类型、不做分级，只把询问如实转达给人（决策卡原样列 options），`allow_always` 只由用户显式勾选。**renderer 目前没有审批回路，不能先关自动放行再补 UI，否则现有 ACP 聊天会挂住**；改完回归验证提取 skill / wiki 摄入。
- 待实测：ACP 写的是「Agent MAY request permission」，某些 adapter 在 headless 模式可能默认更松或根本不问；S1 先对四家各触发一次不在 allowlist 的命令，确认请求是否到达。
- 数据不出本机；写真实资产前备份，可 diff、可回滚；自动 push / 部署 / 付费 / 对外发消息默认禁止。
- `wiki/ingest.ts` 的 prepare（冻结输入 + 备份）→ 预填指令 → agent 执行 → 程序校验 → 报告 → 回滚，是项目里现成的单节点 durable run 原型，新自动化优先复用而不是重写 Runner。
- 设计 / 评审文档放 `docs/design/`，标注日期与状态（定案 / 未定案），不改动已定案条款。
