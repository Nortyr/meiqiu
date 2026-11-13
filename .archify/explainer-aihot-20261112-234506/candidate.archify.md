# AIHOT 的架构是什么样的？ {#intro}

AIHOT 是一个"行业热点网站引擎"的 monorepo：采集信源，用模型筛选写作，聚成事件，出日报周报月报。部署上是单镜像多角色的自托管形态，核心思路是隔离昂贵和危险的操作：读者永远碰不到它们。[](source:repo)

- 三个进程各司其职，web 只走 HTTP 调 api，不碰数据库和密钥。[](source:agents)
- 读者路径纯读，模型只在 worker 里调用，付费请求有回执和预算熔断。[](source:agents)
- 行业知识参数化在 `industry/` 和 `site/`，换行业基本不改代码。[](source:repo)
- 数据迁移纪律严格：单语句在线 DDL，执行前等每日备份结束。

@answer scope="AIHOT 开源版 · 依据 README、AGENTS.md 与源码结构"
@meta locale=zh-CN
@source repo title="KKKKhazix/AIHOT" url=https://github.com/KKKKhazix/AIHOT
@source agents title="AGENTS.md" url=https://github.com/KKKKhazix/AIHOT/blob/main/AGENTS.md
@source arch title="docs/architecture.md" url=https://github.com/KKKKhazix/AIHOT/blob/main/docs/architecture.md

## 进程之间怎么分工？ {#topology}

`docker compose` 起五个服务，只有 web 的 3000 端口对外。[](source:arch)

@architecture id=topo title="部署拓扑"
| reader | 读者 | external |
| web | web SSR :3000 | frontend |
| api | api Fastify :3001 | backend |
| worker | worker 队列与定时 | backend |
| db | PostgreSQL 17 | database |
| llm | OpenAI 兼容模型 | cloud |
| reader > web | HTTP |
| web > api | 只走 HTTP | emphasis |
| api > db | 只读 publication 层 |
| worker > db | pg-boss 队列 |
| worker > llm | 模型只在这里调 | emphasis |

@steps id=topo-steps
| p1 | 读者 | 全场只暴露 web 的 3000 端口；HTTPS 由可选的 caddy 服务自动签证书。 | topo | reader |
| p2 | web SSR :3000 | React Router 8 服务端渲染，只通过 HTTP 读 api，不连数据库、不持密钥。 | topo | web |
| p3 | api Fastify :3001 | 公开只读 API、RSS、MCP、Agent 端点、admin 后台和 ingest 推送口。 | topo | api |
| p4 | worker 队列与定时 | pg-boss 队列加 cron 定时，采集、打分、归组、报告、备份全在这里。 | topo | worker |
| p5 | OpenAI 兼容模型 | 自实现客户端，DeepSeek、GLM、千问换 base URL 即用；读者请求绝不触发调用。 | topo | llm |

## 一条资料怎么变成日报？ {#pipeline}

每一步的提示词都在 `industry/prompts/`，改标准不用改代码。[](source:repo)

@workflow id=pipeline-flow title="从信源到成刊"
| collect | 六种信源采集 | external |
| prefilter | 判重与预筛 | backend |
| score | 独立打两次分 | backend |
| write | 中文标题与摘要 | backend |
| cluster | 聚成一个事件 | backend |
| publish | 日报周报月报 | external |
| collect > prefilter | |
| prefilter > score | 可能重要 |
| score > write | 过门槛 | emphasis |
| write > cluster | |
| cluster > publish | 按规则成刊 | emphasis |

@callout id=pipeline-note level=note title=两个设计取舍
| 同一件事多个来源报道，聚成一个事件；热度按事件算，不按文章算，刷量排不到前面。
| 日报按规则编，不调模型；周报月报从日报汇编，模型只写总述。省钱，也可复现。

## 五条架构红线 {#red-lines}

写在 AGENTS.md 里，由 `tests/architecture.test.ts` 守。[](source:agents)

| 红线 | 换来的 |
| --- | --- |
| 读者打开页面绝不触发模型调用 {good:最重要} | 页面 P95 约 50ms，成本可控 |
| 公开出口只从 `publication/` 读 | 缓存、ETag、权限一处收口 |
| 付费请求走回执加预算熔断 | 防烧钱，可故障转移 |
| 安全阀默认全关 | 采集、模型、推送都要显式开启 |
| 停用功能同一个 PR 删干净 | 不留死代码、死表、死开关 |

## 代码怎么组织？ {#layout}

@tree id=repo-tree title="monorepo 结构"
| root | AIHOT | - |
| apps | apps 三个进程 | root |
| web | web SSR 网站 | apps |
| api | api Fastify 服务 | apps |
| worker | worker 后台任务 | apps |
| packages | packages 共享层 | root |
| contracts | contracts 纯类型契约 | packages |
| backend | backend 引擎本体 | packages |
| industry | industry 行业知识包 | root |
| site | site 站点定制包 | root |
| modules | modules 插件插座 | root |

换行业只改 `industry/`（分类、信源、29 个提示词、入选门槛）和 `site/`（站名、模型、品牌），`modules/` 留给单个站的专属功能，引擎从不 import 模块。[](source:repo)

## 工程形态 {#engineering}

@facts id=eng-facts
| 运行时 | Node 24 直接跑 TypeScript，后端无构建步骤 |
| 数据层 | PostgreSQL 17，postgres.js 裸 SQL，无 ORM |
| 迁移 | 75 个顺序 SQL 文件；0055 起单语句在线 DDL，执行前等 pg_dump 结束 |
| 测试 | 三档：真实测试库的集成测试、无库单测、真实 web server 前端测试 |
| 队列 | pg-boss，以 Postgres 为底座，不引 Redis |
| LLM | 自实现 OpenAI 兼容客户端，zod 校验结构化输出，不用官方 SDK |

## 值得抄的一点 {#takeaway}

@callout id=lesson level=note title=把成本和危险隔到读者路径之外
| 读者路径只读，模型、付费、DDL 全部收进 worker、回执熔断和迁移安全脚本。
| 一个非专业开发者带 AI 写的项目，靠这几条硬规矩跑到了百万月活。
