# dsh-superagent 是什么？ {#intro}

DeepSeek 开源的研究原型：一个为**单个 GitHub 仓库**服务的主动式 coding agent，以插件形态跑在 DeepSeek Harness 里。它把"尽量少占人的注意力"当作第一设计原则，并用代码强制的授权模型决定 agent 何时行动、何时开口。[](source:repo)

- 事件统一抽象为 Trigger，经确定性 gate 和 LLM 评估两层筛选后才开工。[](source:domain)
- 每个任务携带不可变的授权范围 Mandate，超范围必须重新授权。[](source:authz)
- 只在人必须决策或能用上结果时才发消息，其余时间保持安静。[](source:philosophy)
- 每个 Ticket 在独立的 worker session 和目录里执行，干到 PR 为止。

@answer scope="dsh-superagent 0.1.0 · 研究原型 · 依据官方 docs 与 package.json"
@meta locale=zh-CN
@source repo title="deepseek-ai/dsh-superagent-prototype" url=https://github.com/deepseek-ai/dsh-superagent-prototype
@source philosophy title="docs/000-philosophy.md" url=https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md
@source domain title="docs/001-domain.md" url=https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md
@source authz title="docs/002-authorization.md" url=https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md
@source prompts title="docs/004-prompts.md" url=https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md
@source panel title="docs/005-panel.md" url=https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md

## 一条消息怎么变成 PR？ {#flow}

所有事件走同一条流水线：先进 gate 过权限，再过 LLM 评估判断价值，授权后交给独立 worker 执行。[](source:domain)

@workflow id=request-flow title="从消息到 PR 的完整链路"
| lane intake | 接收与授权 |
| lane exec | 执行与交付 |
| msg | GitHub / 飞书消息 | external | intake |
| trigger | Trigger 入库 | database | intake |
| gate | gate 权限检查 | security | intake |
| drop | 只记录不执行 | external | intake |
| eval | LLM 评估 | backend | intake |
| ticket | Ticket + Mandate | backend | exec |
| worker | Executor Session | backend | exec |
| pr | PR 或回复 | external | exec |
| msg > trigger | |
| trigger > gate | |
| gate > eval | 通过 |
| gate > drop | 无权 | dashed |
| eval > drop | 忽略 | dashed |
| eval > ticket | 接受 | emphasis |
| ticket > worker | Assignment |
| worker > pr | 交付 | emphasis |

@steps id=flow-steps
| s1 | GitHub / 飞书消息 | 任何来源的事件都转成不可变 Trigger；重复接收只产生一个 Ticket，天然幂等。 | request-flow | msg |
| s2 | gate 权限检查 | 白名单与 Policy 由宿主代码强制，消息正文再狡猾也改不了权限。 | request-flow | gate |
| s3 | LLM 评估 | 判断这件事值不值得开工；规则外的主动工作先只记录"本来想做什么"。 | request-flow | eval |
| s4 | Ticket + Mandate | 接受即签发不可变授权：范围、强度、依据的规则。超范围必须开新 Ticket 或问人。 | request-flow | ticket |
| s5 | Executor Session | 每个 Ticket 一个 worker session 和独立目录，shell 超 5 秒自动转后台，不阻塞新消息。 | request-flow | worker |
| s6 | PR 或回复 | 需要决策时一次只问人一个结构化问题，其余时间安静干到交付。 | request-flow | pr |

## 核心概念各管什么？ {#concepts}

领域模型只有少量概念，每个都有明确的规则；业务需求落成概念的属性，而不是新增概念。[](source:domain)

| 概念 | 是什么 | 它保证的规则 |
| --- | --- | --- |
| Source | 事件流（GitHub、飞书） | 重启不重放事件；丢弃自己的消息 |
| Trigger | 一条不可变事件 {good:幂等单位} | 被接受两次也只建一个 Ticket |
| Thread | 按时间排序的 Trigger 序列 | 同一时间最多一个 Eval 在跑 |
| Eval | 对一批 Trigger 的判断 | 分两层：确定性 gate + LLM 评估 |
| Mandate | 接受时签发的授权 {good:不可变} | 扩大范围必须新建 Ticket |
| Ticket | 一个被授权的工作单元 | 只能由 Eval 创建 |
| Policy | 版本化的评估规则与白名单 {good:可回滚} | 规则变更时运行中的 Eval 作废 |

## 什么时候开口，什么时候闭嘴？ {#attention}

每条消息、每个面板元素都要证明价值大于它消耗的注意力，否则删掉。[](source:philosophy)

| 场景 | agent 的行为 |
| --- | --- |
| 没被点名且没有规则允许 | 不动；想做的只记录，不执行 {caution:冷启动默认} |
| 收到明确请求 | 确认一次，说清要做什么，然后安静干活 |
| 干活过程中 | 不发进度消息 |
| 有结果可审、需要决策、做不完 | 发一条短消息，聊天消息不超过 100 词 |
| 系统健康时 | 面板上不占任何空间 {good:安静即正常} |

## 工程形态什么样？ {#engineering}

@facts id=eng-facts
| 形态 | DeepSeek Harness bundle（插件），cordis 4 组装 |
| 语言与构建 | TypeScript，tsdown 打包，vitest 测试 |
| Web 面板 | React 18，回答三个问题：需要我吗、健康吗、历史如何 |
| 运行要求 | Node `^22.19` 或 `>=24`，DSH `^0.2.1-alpha.2` |
| 状态存储 | 本地 stateDir，Store 加文件锁，session 可持久化 |
| prompt 治理 | 团队可改 prompt 分区并版本化；权限部分代码强制，prompt 改不动 |

## 它不适合什么？ {#limits}

@callout id=scope-limits level=warning title="定位与边界"
| 官方声明是研究原型，不是正式产品，不能直接上生产。
| 只服务一个 GitHub 仓库；没有定时任务、多模型调度、浏览器操控和 CI 发布链路。
| 深度绑定 DeepSeek Harness 全家桶，脱离它运行成本高。

## 上手前检查 {#checklist}

- [ ] 已装 Node 22.19+ 或 24+，以及 DeepSeek Harness 环境
- [ ] 让 coding agent 读仓库里的 `SETUP.md`，由它一步步带你装
- [ ] 白名单先收窄，主动工作先设为"只记录"模式
- [ ] 观察记录里它"本来会做什么"，确认合理后再放宽规则
