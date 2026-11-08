---
name: wiki-ingest
description: 把 agent 会话里的知识摄入 Meiqiu 知识库（个人 LLM Wiki）。当用户要求把会话摄入知识库、提炼知识到 wiki 时使用。
---

# Wiki Ingest — 把会话知识摄入知识库

## 前提（必读，顺序不能省）

1. 读知识库规范：用户指令里会给 vault 路径，读它的 `CLAUDE.md`。页面格式、依据三级、写作规则全在里面，严格照它执行。
2. 读 `wiki/index.md`：已有哪些页面，避免重复建页。
3. 读 `wiki/log.md` 最后几行：最近摄入了什么，避免重复劳动。

## 素材（用户指令里会给）

- **转写文件**（frozen transcript，turns 已编号）：读内容以它为准。
- **原会话**（agent + 会话路径）：Evidence 引用用它，不要引用转写文件路径。
- **turn 范围**：只处理这个范围内的 turn；范围内是增量内容（之前的 turn 已摄入过）。

## 步骤

1. 通读转写文件指定范围的 turns。
2. 粗筛：只收以后还用得上的——业务规则、系统行为、决策、方案、未决问题、坑。过程描述、寒暄、一次性操作不收。
3. 每条知识决定进哪页：
   - 已有相关页 → 合并进去，只改受影响的小节，不整页重写；
   - 没有 → 新建 entity / concept / analysis 页（一个主题一页，slug 用 kebab-case）。
4. 建/更新 source 页（sources/ 下）：
   - 首次摄入：新建，frontmatter 按规范，agent、session_path、project、turn_count、ingested_through_turn、file_hash 的值用户指令里会给；
   - 增量摄入：更新已有 source 页——摘要（有新结论才改）、ingested_through_turn 和 file_hash 改成指令给的最新值。
5. 每条知识在所在页的 `## Evidence` 里加出处：
   `- supports: <agent> 会话 <session_path> turns <from>-<to> · 依据: 人说的|有代码依据|推测`
   - 同一件事已有条目：只在它的 Evidence 里加出处，不新写一条；
   - 新说法取代旧页：`supersedes: [[旧页slug]]`；说法冲突无法裁决：`contradicts: [[冲突页slug]]`。
6. 依据三级判断：用户说的、或用户明确确认过的 → human；指出了具体代码位置（类、方法、行号）→ code；agent 推断 → inferred（正文句子里标「（推测）」）。页面 evidence_level 取全页最高级。
7. 给新页补 related 交叉链接。index.md、log.md 不要碰（程序维护）。

## 自检（写完过一遍再汇报）

- [ ] frontmatter 字段齐：type / slug / title / summary / status / tags / related / evidence_level / created_at / updated_at；数组写一行方括号 `[a, b]`
- [ ] slug 是 kebab-case，已有页的 slug 没有改动
- [ ] 每页都有 `## Evidence` 和 `## Related` 两节
- [ ] 引用格式正确，turn 号在指令给的范围内
- [ ] 没有删任何页；过时的页标 deprecated
- [ ] 推测句都标了「（推测）」
- [ ] 只改了受影响的小节

完成后告诉用户：新建了哪些页、更新了哪些页、有哪些拿不准的地方。
