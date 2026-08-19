/**
 * Chinese translations for the settings panel. Labels/descriptions originate
 * from the OMP binary's English schema; this map overlays them at render time.
 * Generated from the TranslateSettings handoff (/tmp/settings-zh.json).
 */
export interface SettingZh {
  label?: string;
  description?: string;
}

export const SETTINGS_GROUPS_ZH: Record<string, string> = {
  "Advisor": "顾问",
  "Agent": "代理",
  "Approvals": "审批",
  "Auto-Learn": "自动学习",
  "Available Tools": "可用工具",
  "Bash": "Bash",
  "Collab": "协作",
  "Commands & Skills": "命令与技能",
  "Compaction": "上下文压缩",
  "Computer": "计算机控制",
  "Developer": "开发者",
  "Discovery & MCP": "发现与 MCP",
  "Display": "显示",
  "Editing": "编辑",
  "Eval & Runtimes": "Eval 与运行时",
  "Execution": "执行",
  "Experimental": "实验性",
  "Extensions": "扩展",
  "Fireworks": "Fireworks",
  "General": "通用",
  "Git": "Git",
  "GitHub": "GitHub",
  "Grep & Browser": "Grep 与浏览器",
  "Hindsight": "Hindsight",
  "Images": "图片",
  "Input": "输入",
  "Isolation": "隔离",
  "LSP": "LSP",
  "Magic Keywords": "魔法关键词",
  "Mnemopi": "Mnemopi",
  "Modes": "模式",
  "Notifications": "通知",
  "Output Limits": "输出限制",
  "Power (macOS)": "电源 (macOS)",
  "Prewalk": "预走查",
  "Privacy": "隐私",
  "Prompt": "提示词",
  "Protocol": "协议",
  "Read Summaries": "读取摘要",
  "Reading": "读取",
  "Retry & Fallback": "重试与回退",
  "Rules (TTSR)": "规则 (TTSR)",
  "Sampling": "采样",
  "Services": "服务",
  "Speech": "语音",
  "Startup & Updates": "启动与更新",
  "Status Line": "状态栏",
  "Subagents": "子代理",
  "Theme": "主题",
  "Thinking": "思考",
  "Timeouts": "超时",
  "Tiny Model": "Tiny model",
  "Todos": "待办事项",
  "Vision": "视觉"
};

export const SETTINGS_ZH: Record<string, SettingZh> = {
  "autoResume": {
    "label": "自动恢复",
    "description": "自动恢复当前目录中最近的会话"
  },
  "power.sleepPrevention": {
    "label": "防止睡眠",
    "description": "在活动会话期间阻止 macOS 睡眠。每个级别是累积的——会叠加所有更低级别的标志。"
  },
  "advisor.enabled": {
    "label": "启用顾问",
    "description": "搭配第二个 model（分配为 'advisor' 角色），被动审查每一轮并注入笔记。"
  },
  "prewalk.enabled": {
    "label": "启用 Prewalk",
    "description": "先用当前 model 开始，待计划 todo 列表生成后的首次编辑/写入时切换到快速廉价的 model（默认 'smol' 角色）——强 model 负责规划、提交 todo 并开始实现，然后再交接。可用 --prewalk / --no-prewalk 按会话覆盖。"
  },
  "advisor.syncBacklog": {
    "label": "顾问同步积压",
    "description": "若顾问落后这么多轮，主代理最多暂停 30 秒。关闭则禁用追赶延迟。"
  },
  "advisor.immuneTurns": {
    "label": "顾问免疫轮数",
    "description": "顾问的关切或阻塞中断之后，在这么多主轮次内以非中断方式传递后续关切/阻塞。"
  },
  "git.enabled": {
    "label": "启用 Git 集成",
    "description": "在 TUI 中显示 git 分支、状态和 PR 信息，并监听仓库元数据。"
  },
  "providers.maxInFlightRequests": {
    "label": "最大并发请求数",
    "description": "每个 provider id（如 'openai' 或 'anthropic'）的最大并发 LLM 请求数，在同一配置根下的本地 OMP 进程间共享。未列出的 provider 不受限制。"
  },
  "modelRoleStorage": {
    "label": "model 角色存储",
    "description": "model 选择器角色分配保存的位置"
  },
  "theme.dark": {
    "label": "深色主题",
    "description": "终端背景为深色时使用的主题"
  },
  "theme.light": {
    "label": "浅色主题",
    "description": "终端背景为浅色时使用的主题"
  },
  "symbolPreset": {
    "label": "符号预设",
    "description": "图标和符号的字形集（Unicode、Nerd Font 或 ASCII）"
  },
  "colorBlindMode": {
    "label": "色盲模式",
    "description": "diff 新增行用蓝色代替绿色"
  },
  "statusLine.preset": {
    "label": "状态栏预设",
    "description": "预置的状态栏配置"
  },
  "statusLine.separator": {
    "label": "状态栏分隔符",
    "description": "分段之间分隔符的样式"
  },
  "statusLine.sessionAccent": {
    "label": "会话强调色",
    "description": "用会话名称的颜色作为编辑器边框和状态栏间隙的颜色"
  },
  "statusLine.transparent": {
    "label": "透明状态栏",
    "description": "状态栏使用终端默认背景，而不是主题的 `statusLineBg`。Powerline 端帽会被去掉，因为它们需要对比色填充才能衔接周围终端。"
  },
  "statusLine.compactThinkingLevel": {
    "label": "紧凑思考级别",
    "description": "将思考级别显示为 model 名称上的单个图标，而不是单独的 ` · <level>` 后缀。"
  },
  "tools.artifactSpillThreshold": {
    "label": "产物溢出阈值 (KB)",
    "description": "超过此大小的工具输出会保存为 artifact；末尾内容保留内联"
  },
  "tools.artifactTailBytes": {
    "label": "产物尾部大小 (KB)",
    "description": "输出溢出到 artifact 时保留内联的尾部内容量"
  },
  "tools.artifactHeadBytes": {
    "label": "产物头部大小 (KB)",
    "description": "输出溢出到 artifact 时，与尾部一起保留内联的头部内容量（中间省略）。设为 0 禁用——仅保留尾部。"
  },
  "tools.outputMaxColumns": {
    "label": "输出列上限",
    "description": "流式工具输出（bash、python、js eval）和 `read` 的每行字节上限。超过此宽度的行会被省略号截断；到下一个换行符之前的剩余字节被丢弃。0 禁用。"
  },
  "tools.artifactTailLines": {
    "label": "产物尾部行数",
    "description": "输出溢出到 artifact 时保留内联的尾部内容最大行数"
  },
  "statusLine.showHookStatus": {
    "label": "显示 Hook 状态",
    "description": "在状态栏下方显示 hook 状态消息"
  },
  "terminal.showImages": {
    "label": "显示内联图片",
    "description": "在终端内联渲染图片"
  },
  "images.autoResize": {
    "label": "自动缩放图片",
    "description": "将大图片缩放至最大 2000x2000，以获得更好的 model 兼容性"
  },
  "images.blockImages": {
    "label": "阻止图片",
    "description": "阻止图片发送给 LLM provider"
  },
  "images.describeForTextModels": {
    "label": "为文本模型描述图片",
    "description": "当图片附加到不支持视觉的 model 时，将其保存到 local:// 并用具备视觉能力的 model 注入描述，而不是丢弃它"
  },
  "terminal.showProgress": {
    "label": "原生终端进度",
    "description": "在代理或上下文维护运行时发出 OSC 9;4 不定进度"
  },
  "tui.textSizing": {
    "label": "大标题 (Kitty)",
    "description": "使用 Kitty 的 OSC 66 文字缩放协议，将 Markdown H1 标题以 2 倍比例渲染。仅在 Kitty 终端生效；其他终端忽略。默认关闭。"
  },
  "tui.renderMermaid": {
    "label": "渲染 Mermaid 图表",
    "description": "将 Mermaid 围栏代码块渲染为 ASCII 图表"
  },
  "tui.codexResetFireworks": {
    "label": "Codex 重置烟花",
    "description": "用覆盖顶部三分之一的烟花叠加层庆祝计划外的 Codex 每周用量重置和刚存入的已保存重置，按 Escape 前一直显示"
  },
  "tui.titleState": {
    "label": "终端标题运行状态",
    "description": "在终端标题分隔符中显示代理运行状态——工作时显示动画 spinner（Windows 上为静态 ':'），轮到你时显示 '>'，代理等你时显示 '!'"
  },
  "tui.hyperlinks": {
    "label": "终端超链接",
    "description": "将路径和 URL 包装成 OSC 8 超链接，实现终端原生点击打开（auto：检测支持；off：从不；always：无条件）"
  },
  "tui.tight": {
    "label": "紧凑布局",
    "description": "移除终端输出左右两侧 1 字符的水平内边距"
  },
  "tui.scrollbackRebuild": {
    "label": "重写回滚缓冲",
    "description": "当某个块的最终形态替换其实时预览时，擦除并重放终端回滚缓冲。关闭（默认）时，旧的预览副本保留在历史中，最终内容追加在下方。"
  },
  "display.shimmer": {
    "label": "闪烁效果",
    "description": "工作/加载消息的动画样式"
  },
  "display.smoothStreaming": {
    "label": "平滑流式输出",
    "description": "在分块到达时平滑显示助手文本和流式工具输入"
  },
  "display.hideToolActivity": {
    "label": "隐藏工具活动",
    "description": "在记录中隐藏 model 发起的工具调用和结果"
  },
  "display.showTokenUsage": {
    "label": "显示 token 用量",
    "description": "在助手消息上显示每轮的 token 用量"
  },
  "display.cacheMissMarker": {
    "label": "cache 未命中标记",
    "description": "在请求未命中 prompt cache 的助手轮次上方显示分隔线"
  },
  "display.collapseCompacted": {
    "label": "折叠已压缩历史",
    "description": "在实时记录中把压缩前的历史折叠到摘要分隔线之后；禁用则保留完整记录内联，并在每个压缩点显示分隔线"
  },
  "showHardwareCursor": {
    "label": "显示硬件光标",
    "description": "显示终端光标以支持 IME"
  },
  "tui.imeSafeCursor": {
    "label": "IME 安全提示布局",
    "description": "将提示符的底边框移到单独一行，使 macOS IME 预编辑不会挤动它"
  },
  "defaultThinkingLevel": {
    "label": "思考级别",
    "description": "支持思考的 model 的推理深度"
  },
  "hideThinkingBlock": {
    "label": "隐藏思考块",
    "description": "隐藏助手回复中的思考块"
  },
  "proseOnlyThinking": {
    "label": "仅正文思考",
    "description": "在思考摘要中省略代码块，用省略号代替"
  },
  "omitThinking": {
    "label": "省略思考摘要",
    "description": "指示上游 provider 从回复中完全省略思考摘要（在支持时）"
  },
  "externalThinking": {
    "label": "外部思考",
    "description": "私有草稿本；不向用户显示。禁用受支持的 GPT、Claude 和 Gemini 推理"
  },
  "model.loopGuard.enabled": {
    "label": "循环保护",
    "description": "为 model 推理和正文启用自动流式循环检测"
  },
  "model.loopGuard.checkAssistantContent": {
    "label": "循环保护扫描正文",
    "description": "除思考日志外，将循环保护也应用于助手正文消息"
  },
  "model.loopGuard.toolCallReminder": {
    "label": "循环保护工具调用提醒",
    "description": "当 Gemini 推理流连续发出多个规划头却未调用工具时，中断它并注入一条发起工具调用的提醒（需要循环保护）"
  },
  "model.toolCallLoopGuard.enabled": {
    "label": "工具调用循环保护",
    "description": "检测跨轮次的连续相同工具调用，并注入纠正性引导"
  },
  "model.toolCallLoopGuard.threshold": {
    "label": "工具调用循环阈值",
    "description": "注入纠正性引导前所需的连续相同工具调用次数"
  },
  "model.toolCallLoopGuard.exemptTools": {
    "label": "工具调用循环豁免工具",
    "description": "可以连续重复而不触发跨轮循环保护的工具名称"
  },
  "inlineToolDescriptors": {
    "label": "内联工具描述",
    "description": "在系统提示词中渲染完整工具描述，并从 provider 工具 schema 中剥离顶层/嵌套描述，使描述文本只发送一次。对 Gemini model 自动启用，其他则禁用"
  },
  "includeModelInPrompt": {
    "label": "在提示词中包含 model",
    "description": "在系统提示词中呈现当前 model 标识，让代理知道自己使用的是哪个 model"
  },
  "includeWorkspaceTree": {
    "label": "包含工作区目录树",
    "description": "在系统提示词中渲染工作区目录树。警告：文件修改时可能破坏跨会话的 prompt cache。"
  },
  "workspace.additionalDirectories": {
    "label": "额外工作区目录",
    "description": "作为额外根（多根工作区）添加到每个会话的附加工作区目录。通过 /add-dir 和 /remove-dir 实时管理。路径相对 cwd 解析；推荐使用绝对路径。代理会被告知这些根存在，并可 read/grep/glob 它们。"
  },
  "personality": {
    "label": "个性",
    "description": "渲染到系统提示词个性块中的沟通风格"
  },
  "temperature": {
    "label": "温度",
    "description": "采样温度（0 = 确定性，1 = 创意，-1 = provider 默认）"
  },
  "topP": {
    "label": "Top P",
    "description": "核采样截断（0-1，-1 = provider 默认）"
  },
  "topK": {
    "label": "Top K",
    "description": "从 top-K 个 token 中采样（-1 = provider 默认）"
  },
  "minP": {
    "label": "Min P",
    "description": "最小概率阈值（0-1，-1 = provider 默认）"
  },
  "presencePenalty": {
    "label": "存在惩罚",
    "description": "引入已出现 token 的惩罚（-1 = provider 默认）"
  },
  "repetitionPenalty": {
    "label": "重复惩罚",
    "description": "重复 token 的惩罚（-1 = provider 默认）"
  },
  "textVerbosity": {
    "label": "文本详细度",
    "description": "OpenAI Responses 和 Codex 回复的详细程度（low、medium 或 high）"
  },
  "tier.openai": {
    "label": "服务层级 — OpenAI",
    "description": "OpenAI / OpenAI-Codex 请求以及通过 OpenRouter 路由的 OpenAI 系 model 的处理层级（none = 省略）。以 `service_tier` 发送。"
  },
  "tier.anthropic": {
    "label": "服务层级 — Anthropic",
    "description": "Claude 请求的处理层级。`priority` 在受支持的直接 Anthropic model 上实现快速模式（`speed: fast`）；在 Bedrock/Vertex Claude 和通过 OpenRouter 时被忽略。"
  },
  "tier.google": {
    "label": "服务层级 — Google",
    "description": "Gemini（Google AI Studio + Vertex）请求以及通过 OpenRouter 路由的 Google 系 model 的处理层级（none = 省略）。以顶层 `serviceTier` 字段发送。"
  },
  "tier.subagent": {
    "label": "服务层级 — 子代理",
    "description": "生成的 task/eval 子代理的服务层级。Inherit = 匹配主代理当前的各系层级（跟随 /fast）；选择一个值则应用到子代理 model 所属的系列。"
  },
  "tier.advisor": {
    "label": "服务层级 — 顾问",
    "description": "顾问 model 的服务层级。None = 标准处理；Inherit = 匹配主代理当前的各系层级；选择一个值则应用到顾问 model 的系列。"
  },
  "retry.maxRetries": {
    "label": "重试次数",
    "description": "API 错误时的最大重试次数"
  },
  "retry.maxDelayMs": {
    "label": "最大重试延迟",
    "description": "重试之间的最大等待时间（毫秒）。当 provider 要求等待更久且凭据或 model 回退都未成功时，请求会快速失败而不是休眠（例如 Anthropic 3 小时限流窗口）。"
  },
  "retry.modelFallback": {
    "label": "重试 model 回退",
    "description": "允许重试恢复切换到已配置的回退 model"
  },
  "retry.usageAwareFallback": {
    "label": "用量感知回退",
    "description": "使用可靠的 coding-plan 配额报告，在硬性用量限制前优先选择同一 provider 的账号，然后是已配置的回退 model。普通已配置的 API key 被排除。"
  },
  "retry.usageReservePct": {
    "label": "预留余量",
    "description": "剩余百分比低于此值时，将 coding-plan model 视为接近上限。未知或未映射的用量保持主 model。"
  },
  "retry.usageReservePolicy": {
    "label": "预留策略",
    "description": "当每个同 provider 的 coding-plan 账号都处于预留余量内时如何处理。"
  },
  "retry.fallbackChains": {
    "label": "重试回退链",
    "description": "将 model 角色、model 选择器（provider/model-id）或 provider 通配符（provider/*）映射到有序回退选择器的 JSON 对象，例如 {default:[openai/gpt-4o-mini],google-antigravity/*:[google/*,google-vertex/*]}。以 model 为键的条目在该 model/provider 激活时生效（无论角色）；provider/* 条目保留失败 model 的 id 并替换 provider。带 id 前缀的通配符（openrouter/google/*）会为失败 model 的裸 id 重新加前缀（google-antigravity/gemini-x -> openrouter/google/gemini-x），用作键时仅匹配该前缀下该 provider 的 id。"
  },
  "retry.fallbackRevertPolicy": {
    "label": "回退还原策略",
    "description": "回退后何时切回主 model"
  },
  "providers.anthropic.serverSideFallback": {
    "label": "Anthropic 服务端回退 (Fable 5)",
    "description": "当 Claude Fable 5 / Mythos 5 请求被 Anthropic 安全分类器拦截时，在服务端用 Claude Opus 4.8 重试（Anthropic `server-side-fallback-2026-06-01` beta）。需主动开启——保持关闭则所有请求保留回退前的行为。"
  },
  "steeringMode": {
    "label": "引导模式",
    "description": "代理工作时如何处理排队消息"
  },
  "followUpMode": {
    "label": "后续消息模式",
    "description": "一轮完成后如何排空后续消息"
  },
  "interruptMode": {
    "label": "中断模式",
    "description": "引导消息何时中断工具执行"
  },
  "loop.mode": {
    "label": "循环模式",
    "description": "重新提交提示词前 /loop 迭代之间发生什么"
  },
  "doubleEscapeAction": {
    "label": "双击 Escape 动作",
    "description": "编辑器为空时按两次 Escape 的动作"
  },
  "treeFilterMode": {
    "label": "会话树过滤器",
    "description": "打开会话树时的默认过滤模式"
  },
  "autocompleteMaxVisible": {
    "label": "自动补全条目",
    "description": "自动补全下拉中最多可见条目数 (3-20)"
  },
  "emojiAutocomplete": {
    "label": "Emoji 自动补全",
    "description": "根据 `:name:` 短代码建议 emoji，并展开 `:D` 或 `:-)` 之类的文本表情"
  },
  "paste.largeMenuThreshold": {
    "label": "大段粘贴菜单",
    "description": "当粘贴达到这么多行时，弹出菜单以包进代码块、包进 XML 标签或保存到文件。0 禁用菜单（大段粘贴仍折叠为 [Paste] 标记）。"
  },
  "startup.quiet": {
    "label": "静默启动",
    "description": "跳过欢迎屏幕和启动状态消息"
  },
  "startup.showSplash": {
    "label": "显示启动画面",
    "description": "在正常交互式启动时显示完整动画设置画面，而不重新运行设置。静默启动仍会抑制它。"
  },
  "startup.setupWizard": {
    "label": "设置向导",
    "description": "每个设置版本显示一次新增的引导步骤"
  },
  "startup.checkUpdate": {
    "label": "检查更新",
    "description": "启动时检查 omp 更新"
  },
  "marketplace.autoUpdate": {
    "label": "插件市场自动更新",
    "description": "启动时检查插件更新"
  },
  "startup.changelogMode": {
    "label": "启动更新日志",
    "description": "选择更新说明启动时是摘要、完整详情还是保持隐藏"
  },
  "magicKeywords.enabled": {
    "label": "魔法关键词",
    "description": "为独立的 ultrathink、orchestrate 和 workflowz 关键词启用隐藏提示"
  },
  "magicKeywords.ultrathink": {
    "label": "Ultrathink 关键词",
    "description": "让独立的 ultrathink 请求最大自动思考并附加其隐藏提示"
  },
  "magicKeywords.orchestrate": {
    "label": "Orchestrate 关键词",
    "description": "让独立的 orchestrate 附加其隐藏的多代理编排提示"
  },
  "magicKeywords.workflow": {
    "label": "Workflow 关键词",
    "description": "让独立的 workflowz 附加其隐藏的 eval 工作流提示"
  },
  "completion.notify": {
    "label": "完成通知",
    "description": "代理完成一轮时通知"
  },
  "error.notify": {
    "label": "错误通知",
    "description": "代理因错误停止时通知"
  },
  "ask.timeout": {
    "label": "Ask 超时",
    "description": "这么多秒后自动选择推荐的 ask 选项（0 禁用）"
  },
  "ask.notify": {
    "label": "Ask 通知",
    "description": "ask 工具等待输入时通知"
  },
  "recap.enabled": {
    "label": "空闲回顾",
    "description": "终端空闲后生成一份简短的 LLM 回顾，说明当前进展"
  },
  "recap.idleSeconds": {
    "label": "空闲回顾延迟",
    "description": "显示回顾前空闲等待的秒数"
  },
  "collab.relayUrl": {
    "label": "中继 URL",
    "description": "/collab 使用的中继 (wss://host[:port])"
  },
  "collab.webUrl": {
    "label": "Web UI URL",
    "description": "/collab 链接使用的浏览器 UI；为空则从 collab.relayUrl 推导；显式 http:// 仅限 localhost"
  },
  "collab.displayName": {
    "label": "显示名称",
    "description": "向其他协作参与者显示的名称（默认：操作系统用户名）"
  },
  "share.serverUrl": {
    "label": "分享服务器",
    "description": "/share 使用的查看器/上传基础地址（加密 blob 上传 + 查看器；链接形如 <base>/<id>#<key>）"
  },
  "share.store": {
    "label": "分享存储",
    "description": "/share 上传加密会话 blob 的位置"
  },
  "share.redactSecrets": {
    "label": "分享密钥脱敏",
    "description": "上传前对 /share 快照运行密钥混淆器（使用 secrets.* 配置）"
  },
  "stt.enabled": {
    "label": "语音转文字",
    "description": "通过麦克风启用语音转文字输入"
  },
  "stt.modelName": {
    "label": "语音 model",
    "description": "本地设备端语音 model。Parakeet TDT v3 (sherpa-onnx) 是默认的 SoTA；Whisper base/small/large-v3-turbo 各档（transformers.js）以体积换取多语言覆盖。首次使用时下载。"
  },
  "stt.submitTrigger": {
    "label": "语音转文字提交触发",
    "description": "选择语音听写何时自动提交：Never、Release（2+ 词）、Release with complete sentence 或 When I Say Submit。"
  },
  "contextPromotion.enabled": {
    "label": "自动提升上下文",
    "description": "上下文溢出时提升到更大上下文的 model，而不是压缩"
  },
  "compaction.enabled": {
    "label": "自动压缩",
    "description": "上下文过大时自动压缩"
  },
  "compaction.midTurnEnabled": {
    "label": "轮中压缩",
    "description": "在下一次 provider 请求前，于安全的轮中工具循环边界检查阈值"
  },
  "compaction.strategy": {
    "label": "压缩策略",
    "description": "选择原地保全上下文的维护、自动交接、surgical shake（丢弃重内容）、snapcompact（将历史归档为密集图片），或禁用自动维护（off）"
  },
  "compaction.thresholdPercent": {
    "label": "压缩阈值",
    "description": "上下文维护的百分比阈值；设为 Default 则使用旧的基于预留的行为"
  },
  "compaction.thresholdTokens": {
    "label": "压缩 token 上限",
    "description": "上下文维护的固定 token 上限；设置后覆盖百分比"
  },
  "compaction.handoffSaveToDisk": {
    "label": "保存交接文档",
    "description": "将生成的交接文档保存为 markdown 文件，用于自动交接流程"
  },
  "compaction.remoteEnabled": {
    "label": "远程压缩",
    "description": "可用时使用远程压缩端点，而不是本地摘要"
  },
  "compaction.remoteStreamingV2Enabled": {
    "label": "远程压缩 V2",
    "description": "对兼容的远程压缩 model 使用 Responses 流式压缩"
  },
  "compaction.idleEnabled": {
    "label": "空闲压缩",
    "description": "token 数超过阈值时空闲时压缩上下文"
  },
  "compaction.idleThresholdTokens": {
    "label": "空闲压缩阈值",
    "description": "触发空闲压缩的 token 数"
  },
  "compaction.idleTimeoutSeconds": {
    "label": "空闲压缩延迟",
    "description": "压缩前空闲等待的秒数"
  },
  "compaction.supersedeReads": {
    "label": "淘汰陈旧读取",
    "description": "再次读取同一文件时剪掉较旧的读取结果（感知 cache，每轮运行）"
  },
  "compaction.dropUseless": {
    "label": "省略无效结果",
    "description": "剪掉被标记为上下文无用的工具结果（无匹配、等待超时），一旦消费即处理（感知 cache）"
  },
  "snapcompact.systemPrompt": {
    "label": "Snapcompact 系统提示词",
    "description": "实验性：将选定的系统提示词文本渲染为密集 PNG 图片，并附加到第一条用户消息（仅视觉 model）。节省 token；图片化文本会失去 prompt cache。"
  },
  "snapcompact.toolResults": {
    "label": "Snapcompact 工具结果",
    "description": "实验性：将大型历史工具结果渲染为密集 PNG 图片而不是文本（仅视觉 model）。在累积的 read/search 输出上节省 token。"
  },
  "tools.format": {
    "label": "工具调用模式",
    "description": "控制如何向 model 暴露工具。Auto 使用 provider 原生的工具调用，除非所选 model 被标记为不支持，则回退到 GLM 自有方言。Native 强制 provider 原生工具；其他值强制命名的自有方言。会话启动时生效。"
  },
  "snapcompact.shape": {
    "label": "Snapcompact 形状",
    "description": "snapcompact 打印文本所用的框架形状（压缩归档和内联成像）。Auto 选择适合当前 model 的形状。"
  },
  "branchSummary.enabled": {
    "label": "分支摘要",
    "description": "离开分支时提示生成摘要"
  },
  "memory.backend": {
    "label": "记忆后端",
    "description": "Off、本地摘要流水线、Mnemopi SQLite 或 Hindsight 远程记忆"
  },
  "autolearn.enabled": {
    "label": "自动学习（实验性）",
    "description": "代理停止后，引导它将经验捕获到记忆中，并创建/增强隔离的托管技能"
  },
  "autolearn.autoContinue": {
    "label": "停止时自动运行捕获",
    "description": "开启时，停止后自动运行一次私有捕获轮（消耗额外 token）。关闭时，仅保留常设的自动学习引导。"
  },
  "mnemopi.dbPath": {
    "label": "Mnemopi DB 路径",
    "description": "可选 SQLite DB 路径。默认为代理记忆目录。"
  },
  "mnemopi.bank": {
    "label": "Mnemopi 库",
    "description": "可选的共享库基础名。按项目模式由它推导出项目本地库。"
  },
  "mnemopi.scoping": {
    "label": "Mnemopi 作用域",
    "description": "global = 单一共享库；per-project = 每个 cwd 隔离库；per-project-tagged = 项目本地写入外加全局召回可见性"
  },
  "mnemopi.embeddingVariant": {
    "label": "Embedding 变体",
    "description": "本地 embedding model 家族。en = 更强的英文 model；multilingual = 跨语言 model。更改后会在下次启动时重建现有记忆 embedding。"
  },
  "mnemopi.autoRecall": {
    "label": "Mnemopi 自动召回",
    "description": "在每个会话的第一轮召回本地记忆"
  },
  "mnemopi.autoRetain": {
    "label": "Mnemopi 自动留存",
    "description": "将完成的对话轮次留存到本地 Mnemopi 记忆"
  },
  "mnemopi.polyphonicRecall": {
    "label": "Mnemopi 多声部召回",
    "description": "启用 4 声部召回（向量、图、事实、时序），以倒数排名融合"
  },
  "mnemopi.enhancedRecall": {
    "label": "Mnemopi 增强召回",
    "description": "为重复和相似的召回查询启用分层查询结果 cache"
  },
  "mnemopi.proactiveLinking": {
    "label": "Mnemopi 主动关联",
    "description": "新记忆存储时即摄入到情景图，并将其关联到相关实体和记忆"
  },
  "mnemopi.noEmbeddings": {
    "label": "Mnemopi 禁用 Embedding",
    "description": "强制仅使用确定性的 FTS 召回，而不是向量 embedding"
  },
  "mnemopi.embeddingModel": {
    "label": "Mnemopi Embedding Model",
    "description": "高级：显式的 embedding model id，覆盖变体。留空则使用 mnemopi.embeddingVariant。"
  },
  "mnemopi.embeddingApiUrl": {
    "label": "Mnemopi Embedding API URL",
    "description": "传给 Mnemopi 的可选 OpenAI 兼容 embedding 端点"
  },
  "mnemopi.embeddingApiKey": {
    "label": "Mnemopi Embedding API Key",
    "description": "传给 Mnemopi 的可选 embedding API key"
  },
  "mnemopi.llmMode": {
    "label": "Mnemopi LLM 模式",
    "description": "不使用 LLM、使用在线 tiny model（/models 中的 TINY 角色，否则 @smol），或远程 OpenAI 兼容端点"
  },
  "mnemopi.llmBaseUrl": {
    "label": "Mnemopi LLM Base URL",
    "description": "Mnemopi 远程模式的可选 OpenAI 兼容 LLM 端点"
  },
  "mnemopi.llmApiKey": {
    "label": "Mnemopi LLM API Key",
    "description": "Mnemopi 远程模式的可选 LLM API key"
  },
  "mnemopi.llmModel": {
    "label": "Mnemopi LLM Model",
    "description": "Mnemopi 远程模式的可选 LLM model 名称"
  },
  "hindsight.apiUrl": {
    "label": "Hindsight API URL",
    "description": "Hindsight 服务器 URL（Cloud 或自托管）"
  },
  "hindsight.apiToken": {
    "label": "Hindsight API Token",
    "description": "用于已认证 Hindsight 服务器的 Bearer token"
  },
  "hindsight.bankId": {
    "label": "Hindsight 库 ID",
    "description": "记忆库标识（默认：项目名）"
  },
  "hindsight.scoping": {
    "label": "Hindsight 作用域",
    "description": "global = 单一共享库；per-project = 每个 cwd 隔离库；per-project-tagged = 带项目标签的共享库，使全局 + 项目记忆在召回时合并"
  },
  "hindsight.autoRecall": {
    "label": "Hindsight 自动召回",
    "description": "每个会话的第一轮召回记忆"
  },
  "hindsight.autoRetain": {
    "label": "Hindsight 自动留存",
    "description": "每 N 轮及会话边界留存对话记录"
  },
  "hindsight.retainMode": {
    "label": "Hindsight 留存模式",
    "description": "full-session = 每个会话 upsert 一篇文档，last-turn = 分块"
  },
  "hindsight.mentalModelsEnabled": {
    "label": "Hindsight 心智模型",
    "description": "启动时将精选的 reflect 摘要（心智模型）读入开发者指令。仅加载库上已有的模型——不写入。搭配 hindsight.mentalModelAutoSeed 还可自动创建内置种子集。"
  },
  "hindsight.mentalModelAutoSeed": {
    "label": "Hindsight 心智模型自动播种",
    "description": "会话开始时，创建库上尚不存在的内置心智模型（project-conventions、project-decisions、user-preferences）。"
  },
  "ttsr.enabled": {
    "label": "TTSR",
    "description": "当输出匹配规则模式时中断代理输出流（Time-Traveling Stream Rules）"
  },
  "ttsr.contextMode": {
    "label": "TTSR 上下文模式",
    "description": "TTSR 触发时如何处理部分输出"
  },
  "ttsr.interruptMode": {
    "label": "TTSR 中断模式",
    "description": "何时在流中中断，还是完成后再注入警告"
  },
  "ttsr.repeatMode": {
    "label": "TTSR 重复模式",
    "description": "规则如何重复：每个会话一次，或消息间隔后"
  },
  "ttsr.repeatGap": {
    "label": "TTSR 重复间隔",
    "description": "规则再次触发前需经过的消息数"
  },
  "ttsr.builtinRules": {
    "label": "内置规则",
    "description": "加载代理自带的默认规则（可用 ttsr.disabledRules 单独覆盖）"
  },
  "ttsr.disabledRules": {
    "label": "禁用规则",
    "description": "完全忽略的规则名称（适用于内置默认规则和你自己的规则）"
  },
  "edit.mode": {
    "label": "编辑模式",
    "description": "选择 edit 工具变体（replace、patch、hashline 或 apply_patch）"
  },
  "edit.fuzzyMatch": {
    "label": "模糊匹配",
    "description": "对空白差异接受高置信度的模糊匹配"
  },
  "edit.fuzzyThreshold": {
    "label": "模糊匹配阈值",
    "description": "接受模糊匹配的相似度阈值 (0-1)"
  },
  "edit.streamingAbort": {
    "label": "预览失败时中止",
    "description": "patch 预览失败时中止流式 edit 工具调用"
  },
  "edit.blockAutoGenerated": {
    "label": "阻止自动生成文件",
    "description": "阻止编辑看起来是自动生成的文件（protoc、sqlc、swagger 等）"
  },
  "edit.enforceSeenLines": {
    "label": "强制已见行守卫",
    "description": "拒绝锚定在之前 read/search 从未完整显示过的行上的编辑"
  },
  "readLineNumbers": {
    "label": "行号",
    "description": "默认在 read 工具输出前加上行号"
  },
  "read.defaultLimit": {
    "label": "默认读取行数",
    "description": "代理不带 limit 调用 read 时返回的默认行数"
  },
  "read.renderMarkdown": {
    "label": "Markdown 预览",
    "description": "将 Markdown 读取结果渲染为格式化的终端 Markdown 预览，而不是原始源码"
  },
  "read.summarize.enabled": {
    "label": "读取摘要",
    "description": "read 不带显式选择器调用时返回结构化代码摘要"
  },
  "read.summarize.prose": {
    "label": "正文摘要",
    "description": "对 Markdown 和纯文本读取返回结构化摘要"
  },
  "read.summarize.minBodyLines": {
    "label": "读取摘要正文行数",
    "description": "read 摘要折叠前所需的最小多行正文或字面量长度"
  },
  "read.summarize.minCommentLines": {
    "label": "读取摘要注释行数",
    "description": "read 摘要折叠前所需的最小多行块注释长度"
  },
  "read.summarize.minTotalLines": {
    "label": "读取摘要最小文件长度",
    "description": "总行数更少的文件按原文读取，而不是结构化摘要"
  },
  "read.summarize.unfoldUntil": {
    "label": "读取摘要展开目标",
    "description": "BFS 展开可省略区间，直到摘要至少有这么多可见行。0 只保留最外层省略。"
  },
  "read.summarize.unfoldLimit": {
    "label": "读取摘要展开上限",
    "description": "BFS 展开时摘要大小的硬上限。展开后揭示行数会超过此值的区间会被跳过（该区间保持折叠），展开继续处理其余区间。"
  },
  "read.toolResultPreview": {
    "label": "内联读取预览",
    "description": "在记录中内联渲染 read 工具结果，而不是摘要行"
  },
  "lsp.enabled": {
    "label": "LSP",
    "description": "启用 lsp 工具进行代码智能（定义、引用、诊断、重命名）"
  },
  "lsp.lazy": {
    "label": "延迟 LSP 启动",
    "description": "首次使用时启动语言服务器（lsp 工具或编辑匹配的文件类型），而不是会话启动时"
  },
  "lsp.shared": {
    "label": "共享语言服务器",
    "description": "通过守护进程代理在 omp 实例间按项目共享一个语言服务器（不可用时回退到私有服务器）"
  },
  "lsp.formatOnWrite": {
    "label": "写入时格式化",
    "description": "写入后使用 LSP 自动格式化代码文件"
  },
  "lsp.diagnosticsOnWrite": {
    "label": "写入时诊断",
    "description": "写入代码文件后返回 LSP 诊断"
  },
  "lsp.diagnosticsOnEdit": {
    "label": "编辑时诊断",
    "description": "编辑代码文件后返回 LSP 诊断"
  },
  "lsp.diagnosticsDeduplicate": {
    "label": "诊断去重",
    "description": "抑制文件已显示过的编辑后 LSP 诊断；只呈现新的或变化的"
  },
  "bash.enabled": {
    "label": "Bash",
    "description": "启用 bash 工具以执行 shell 命令"
  },
  "bash.autoBackground.enabled": {
    "label": "Bash 自动后台",
    "description": "自动将长时间运行的 bash 命令转入后台，稍后交付结果"
  },
  "bash.patterns": {
    "label": "Bash 审批规则",
    "description": "有序的 bash 命令审批规则。每项含 match 和 approval 字段；仅支持 '*' 通配符。"
  },
  "bashInterceptor.enabled": {
    "label": "Bash 拦截器",
    "description": "拦截有专用工具的 shell 命令"
  },
  "bash.direnv": {
    "label": "direnv 自动加载",
    "description": "将仓库的 direnv/devenv `.envrc` 自动加载到 bash 会话，使 devenv 工具和环境变量无需手动 `direnv exec` 即可存在。遵循 direnv 允许列表：未经 `direnv allow` 的 `.envrc` 永远不会执行"
  },
  "bash.direnvLoadTimeoutMs": {
    "label": "direnv 加载超时 (ms)",
    "description": "首次 `direnv export` 的最大等待时间（冷 devenv shell 可能较慢）；超时后会话在没有 direnv 环境的情况下运行"
  },
  "shellMinimizer.enabled": {
    "label": "Shell 输出精简",
    "description": "返回代理前压缩冗长的 shell 输出（git、npm、cargo 等）"
  },
  "shellMinimizer.sourceOutlineLevel": {
    "label": "Shell 输出精简源概览",
    "description": "cat/read 源文件的源概览模式：default 或 aggressive"
  },
  "eval.py": {
    "label": "Python Eval 后端",
    "description": "允许 eval 工具将 Python 单元分派到 IPython 内核"
  },
  "eval.js": {
    "label": "JavaScript Eval 后端",
    "description": "允许 eval 工具将 JavaScript 单元分派到进程内运行时"
  },
  "eval.rb": {
    "label": "Ruby Eval 后端",
    "description": "允许 eval 工具将 Ruby 单元分派到持久 Ruby 内核"
  },
  "eval.jl": {
    "label": "Julia Eval 后端",
    "description": "允许 eval 工具将 Julia 单元分派到持久 Julia 内核"
  },
  "python.kernelMode": {
    "label": "Python 内核模式",
    "description": "跨 eval 调用保持 IPython 内核存活，或每次重新启动"
  },
  "python.interpreter": {
    "label": "Python 解释器",
    "description": "指定 Python 可执行文件的可选路径。设置后跳过自动 Python 运行时发现。"
  },
  "ruby.interpreter": {
    "label": "Ruby 解释器",
    "description": "指定 Ruby 可执行文件的可选路径。设置后跳过自动 Ruby 运行时发现。"
  },
  "julia.interpreter": {
    "label": "Julia 解释器",
    "description": "指定 Julia 可执行文件的可选路径。设置后跳过自动 Julia 运行时发现。"
  },
  "tools.approval": {
    "label": "工具审批策略",
    "description": "每个工具的审批策略。设为 'allow' 自动批准，'prompt' 需确认，'deny' 阻止。覆盖在所有审批模式下均生效。"
  },
  "tools.approvalMode": {
    "label": "工具审批",
    "description": "工具调用的默认审批行为。'Always ask' 仅自动批准只读工具。'Write' 自动批准读取和工作区写入工具。'Yolo' 自动批准所有层级；用户策略仍可能提示或阻止。"
  },
  "todo.enabled": {
    "label": "待办事项",
    "description": "启用 todo 工具进行任务跟踪"
  },
  "todo.reminders": {
    "label": "待办提醒",
    "description": "提醒代理在停止前完成待办事项"
  },
  "todo.remindersMax": {
    "label": "待办提醒上限",
    "description": "放弃前最多提醒的待办次数"
  },
  "todo.eager": {
    "label": "自动创建待办",
    "description": "首条消息后推送自动创建待办列表的强度"
  },
  "glob.enabled": {
    "label": "Glob",
    "description": "启用 glob 工具进行基于 glob 的文件查找"
  },
  "grep.enabled": {
    "label": "Grep",
    "description": "启用 grep 工具进行正则内容搜索"
  },
  "grep.contextBefore": {
    "label": "Grep 上文行数",
    "description": "每个 grep 匹配之前的上下文行数"
  },
  "grep.contextAfter": {
    "label": "Grep 下文行数",
    "description": "每个 grep 匹配之后的上下文行数"
  },
  "astGrep.enabled": {
    "label": "AST Grep",
    "description": "启用 ast_grep 工具进行结构化 AST 搜索"
  },
  "astEdit.enabled": {
    "label": "AST Edit",
    "description": "启用 ast_edit 工具进行结构化 AST 重写"
  },
  "debug.enabled": {
    "label": "调试",
    "description": "启用 debug 工具进行基于 DAP 的调试"
  },
  "launch.enabled": {
    "label": "启动",
    "description": "启用 launch 工具以监督共享的长期项目进程"
  },
  "speechgen.enabled": {
    "label": "语音合成",
    "description": "启用 tts 工具进行设备端 (Kokoro) 或 xAI Grok Voice 语音文件合成"
  },
  "generate_image.enabled": {
    "label": "生成图片",
    "description": "启用 generate_image 工具（文生图和编辑）。当 tools.xdev 开启时暴露为 xd:// 设备。"
  },
  "inspect_image.mode": {
    "label": "查看图片",
    "description": "控制 inspect_image 工具，它把图片理解委托给具备视觉能力的 model。'auto' 仅在当前 model 缺少原生图片输入时暴露；'on' 始终暴露；'off' 从不暴露。"
  },
  "computer.enabled": {
    "label": "计算机控制",
    "description": "启用可编程的主机桌面控制工具（截图、输入、无障碍）"
  },
  "computer.display": {
    "label": "计算机显示器",
    "description": "合成所有显示器，或选择原生显示器 id"
  },
  "computer.maxWidth": {
    "label": "计算机截图宽度",
    "description": "合成截图的最大宽度（像素）"
  },
  "computer.maxHeight": {
    "label": "计算机截图高度",
    "description": "合成截图的最大高度（像素）"
  },
  "inspect_image.timeoutMs": {
    "label": "查看图片超时",
    "description": "inspect_image 视觉 model 调用的单次请求超时（毫秒）。卡住的 provider 会以超时错误快速失败，而不是阻塞到手动中止。设为 0 禁用超时。"
  },
  "checkpoint.enabled": {
    "label": "检查点/回退",
    "description": "启用 checkpoint 和 rewind 工具进行上下文检查点"
  },
  "fetch.enabled": {
    "label": "读取 URL",
    "description": "允许 read 工具抓取并处理 URL"
  },
  "vault.enabled": {
    "label": "Obsidian Vault",
    "description": "启用 vault:// 内部 URL，通过 Obsidian CLI 读取和编辑 Obsidian vault 内容。禁用时，vault:// 解析被拒绝，vault:// 条目从系统提示词中省略。"
  },
  "github.enabled": {
    "label": "GitHub CLI",
    "description": "启用 github 工具（基于 op 分发仓库、issue、pull request、diff、search、checkout、push 和 Actions watch 工作流）"
  },
  "github.cache.enabled": {
    "label": "GitHub 视图缓存",
    "description": "将渲染的 issue/PR 视图输出缓存到 ~/.omp/cache/github-cache.db，使重复读取零成本"
  },
  "github.cache.softTtlSec": {
    "label": "GitHub 缓存软 TTL",
    "description": "在此窗口内，直接返回缓存的 issue/PR 视图行（秒；默认 5 分钟）"
  },
  "github.cache.hardTtlSec": {
    "label": "GitHub 缓存硬 TTL",
    "description": "超过软 TTL 后返回缓存行并在后台刷新；超过硬 TTL 后丢弃（秒；默认 7 天）"
  },
  "web_search.enabled": {
    "label": "网络搜索",
    "description": "启用 web_search 工具获取实时网络结果"
  },
  "security.enabled": {
    "label": "安全",
    "description": "启用 OMP 原生安全扫描规划、执行，以及只读的 security:// 资源命名空间"
  },
  "ask.enabled": {
    "label": "询问",
    "description": "启用 ask 工具进行交互式用户提问"
  },
  "browser.enabled": {
    "label": "浏览器",
    "description": "启用 browser 工具进行脚本化 Chromium 自动化（puppeteer）"
  },
  "browser.cdpUrl": {
    "label": "浏览器 CDP URL",
    "description": "默认 HTTP CDP 发现端点（例如 http://127.0.0.1:9222），用于附加而不是启动浏览器。工具调用上显式的 app.cdp_url 或 app.path 优先。"
  },
  "browser.relay": {
    "label": "浏览器中继",
    "description": "通过 omp 浏览器中继驱动你自己的 Chrome 标签页。安装一次扩展（`omp browser-relay install`）；中继服务器在浏览器工具需要时自动启动。优先于浏览器 CDP URL；设 PI_BROWSER_RELAY=0 或 PI_BROWSER_RELAY=1 覆盖。"
  },
  "browser.relayUrl": {
    "label": "浏览器中继 URL",
    "description": "omp 浏览器中继端点（默认 http://127.0.0.1:9224）。"
  },
  "browser.headless": {
    "label": "无头浏览器",
    "description": "以无头模式启动浏览器（禁用则显示浏览器 UI）"
  },
  "browser.cmux": {
    "label": "cmux 浏览器",
    "description": "当 cmux socket 可用时，使用 cmux WKWebView 表面进行浏览器自动化。设 PI_BROWSER_CMUX=0 或 PI_BROWSER_CMUX=1 覆盖。"
  },
  "browser.screenshotDir": {
    "label": "截图目录",
    "description": "保存截图的目录。未设置时截图存到临时文件。支持 ~。示例：~/Downloads、~/Desktop、/sdcard/Download (Android)"
  },
  "tools.intentTracing": {
    "label": "意图追踪",
    "description": "让代理在执行每个工具调用前描述其意图"
  },
  "tools.abortOnFabricatedResult": {
    "label": "伪造工具结果时中止",
    "description": "带内工具调用时，当 model 在轮中开始编造工具结果立即停止。禁用则让 model 生成完并丢弃伪造的续写。"
  },
  "tools.maxTimeout": {
    "label": "最大工具超时",
    "description": "代理可为任何工具设置的最大超时秒数（0 = 无限制）"
  },
  "async.enabled": {
    "label": "异步执行",
    "description": "启用异步 bash 命令和后台任务执行"
  },
  "async.pollWaitDuration": {
    "label": "最大轮询时长",
    "description": "`hub` wait 在返回当前状态前监视后台任务多久。固定值每次都等待恰好该时长。`smart` 自适应：从 5s 开始，随每次连续 wait 延长（最多 5m），约一分钟未等待后重置回 5s。"
  },
  "irc.timeoutMs": {
    "label": "IRC 超时",
    "description": "hub 消息等待（及 send await:true）的默认超时（毫秒）；0 禁用超时"
  },
  "tools.xdev": {
    "label": "xd:// 工具",
    "description": "将很少使用的（可发现的）工具挂载到 xd:// 设备 URL 下，通过 read/write 驱动，而不是每次请求都发送它们的 schema。未授予 write 工具的会话跳过挂载并在顶层暴露所有工具。禁用则在顶层暴露每个启用的工具。"
  },
  "tools.xdevDocs": {
    "label": "xd:// 提示词文档",
    "description": "选择哪些挂载设备文档和 schema 内联到系统提示词。Built-ins 保持核心工具内联，而 MCP 和扩展工具按需加载。"
  },
  "tools.xdevInlineDevices": {
    "label": "xd:// 内联设备",
    "description": "当 xd:// 提示词文档为 Built-ins Only 时，内联名称匹配这些 glob 模式的动态设备（例如 mcp__context_mode_*）。Catalog Only 忽略此设置。"
  },
  "mcp.enableProjectConfig": {
    "label": "MCP 项目配置",
    "description": "从项目根加载 .mcp.json/mcp.json"
  },
  "mcp.renderMarkdownResults": {
    "label": "MCP Markdown 结果",
    "description": "将非 JSON 的 MCP 文本结果在记录中渲染为 Markdown"
  },
  "mcp.notifications": {
    "label": "MCP 更新注入",
    "description": "将 MCP 资源更新注入代理对话"
  },
  "mcp.notificationDebounceMs": {
    "label": "MCP 通知去抖",
    "description": "MCP 资源更新注入对话前的去抖窗口（毫秒）"
  },
  "plan.enabled": {
    "label": "计划模式",
    "description": "启用计划模式，在执行前进行只读探索和规划"
  },
  "plan.defaultOnStartup": {
    "label": "以计划模式启动",
    "description": "每个新会话开始时自动进入计划模式"
  },
  "goal.enabled": {
    "label": "目标模式",
    "description": "启用每会话目标模式和隐藏的 goal 工具"
  },
  "goal.statusInFooter": {
    "label": "底栏显示目标状态",
    "description": "在状态栏的目标指示器旁显示 token 预算"
  },
  "goal.continuationModes": {
    "label": "目标延续模式",
    "description": "运行活动目标可在轮次间自动延续的模式"
  },
  "title.refreshOnReplan": {
    "label": "重新规划时刷新标题",
    "description": "todo 初始化重新规划后刷新生成的会话标题，除非标题由用户设置"
  },
  "task.isolation.mode": {
    "label": "隔离模式",
    "description": "子代理的隔离后端。auto 让原生 PAL 选择最佳可用后端（CoW 感知文件系统，然后 overlayfs/ProjFS，最后 git worktree / 递归复制回退）。"
  },
  "task.isolation.apply": {
    "label": "应用隔离更改",
    "description": "自动将成功的隔离任务更改应用到父检出；禁用则保留 patch 或分支产物"
  },
  "task.isolation.merge": {
    "label": "隔离合并策略",
    "description": "隔离任务更改如何集成（patch 应用或分支合并）"
  },
  "task.isolation.commits": {
    "label": "隔离提交风格",
    "description": "嵌套仓库更改的提交消息风格（generic 或 AI 生成）"
  },
  "worktree.base": {
    "label": "worktree 基础目录",
    "description": "代理管理的 worktree 的基础目录——任务隔离副本、`github` PR 检出和 `omp worktree` 清理都在这里。未设置则使用 ~/.omp/wt。必须是绝对路径或 ~ 相对路径；相对路径被忽略。OMP_WORKTREE_DIR 环境变量覆盖此设置。"
  },
  "task.eager": {
    "label": "优先任务委派",
    "description": "推送将工作委派给子代理的强度"
  },
  "task.batch": {
    "label": "批量任务调用",
    "description": "将 task 工具切换为批量形态：一次调用携带 { context, tasks[] }——每个条目一个子代理，可选按条目指定代理（默认使用会话生成策略代理）、按条目隔离，以及一个必须的共享上下文前置到每个任务。当 async.enabled=true 时，每次生成作为独立后台代理运行，遵循正常的 idle/parked 生命周期；否则调用阻塞等待合并结果。禁用则恢复单一生成的扁平 schema。"
  },
  "task.enableEffort": {
    "label": "每任务思考量",
    "description": "在 task 生成上暴露可选的 effort 参数，允许调用者覆盖每个子代理的思考级别"
  },
  "task.maxConcurrency": {
    "label": "最大并发任务数",
    "description": "同时运行的子代理最大数量"
  },
  "task.enableLsp": {
    "label": "子代理中的 LSP",
    "description": "允许通过 task 工具生成的子代理使用 lsp 工具。默认关闭以保持子代理低成本；当 LSP 感知委派值得额外 token 时启用。"
  },
  "task.maxRecursionDepth": {
    "label": "最大任务递归深度",
    "description": "子代理可以生成自己的子代理的层级深度"
  },
  "task.maxRuntimeMs": {
    "label": "最大子代理运行时长",
    "description": "每个子代理的硬性墙钟时长上限（毫秒）。0 禁用。对逃避推理层看门狗的 provider 侧流挂起做纵深防御；以 'timed out' 原因触发正常的子代理中止。"
  },
  "task.agentIdleTtlMs": {
    "label": "代理空闲 TTL",
    "description": "空闲子代理在被存入磁盘前于内存中保持活跃的时长（毫秒）。被消息或恢复时会自动复活已存放的代理。0 让空闲代理存活到退出。"
  },
  "task.softRequestBudget": {
    "label": "子代理软请求预算",
    "description": "每个子代理的软请求预算（每次运行的助手请求数）。超过它注入一条收尾引导通知（见 task.softRequestBudgetNotice）；达到 1.5 倍预算时运行被强制停止，代理必须产出其部分发现。0 禁用该守卫。内置 scout/sonic 代理在更低的内置预算封顶，因此低于该上限的值仍对它们生效。"
  },
  "task.softRequestBudgetNotice": {
    "label": "软请求预算通知",
    "description": "子代理超过其软请求预算时注入一条引导通知，要求它在 1.5 倍强制产出停止前收尾。"
  },
  "task.maxEffort": {
    "label": "每次生成最大思考量",
    "description": "task 工具每次生成 effort 提示允许的最大推理量。较低的值阻止调用者将子代理提升到该上限之上；默认保留 model 的完整范围。"
  },
  "task.prewalk": {
    "label": "通用 Task Prewalk",
    "description": "为内置通用 `task` 子代理武装 prewalk：它从其解析的 model 开始，规划并开始实现，然后在首次编辑/写入时交接给 'smol' 角色。无论此开关如何，按代理覆盖（task.agentPrewalk，从 /agents 中心配置）和用户代理 `prewalk` frontmatter 都适用。"
  },
  "tasks.todoClearDelay": {
    "label": "待办自动清除延迟",
    "description": "已完成或放弃的待办从 todo 组件中移除前的延迟"
  },
  "task.showResolvedModelBadge": {
    "label": "显示已解析 model 徽章",
    "description": "在 task 组件状态栏中显示每个子代理实际使用的 model ID"
  },
  "skills.enableSkillCommands": {
    "label": "技能命令",
    "description": "将技能注册为 /skill:name 命令"
  },
  "commands.enableClaudeUser": {
    "label": "Claude 用户命令",
    "description": "从 ~/.claude/commands/ 加载命令"
  },
  "commands.enableClaudeProject": {
    "label": "Claude 项目命令",
    "description": "从 .claude/commands/ 加载命令"
  },
  "commands.enableOpencodeUser": {
    "label": "OpenCode 用户命令",
    "description": "从 ~/.config/opencode/commands/ 加载命令"
  },
  "commands.enableOpencodeProject": {
    "label": "OpenCode 项目命令",
    "description": "从 .opencode/commands/ 加载命令"
  },
  "secrets.enabled": {
    "label": "隐藏密钥",
    "description": "在发送给 AI provider 前混淆已配置的密钥并脱敏形似凭据的 token"
  },
  "providers.ollama-cloud.maxConcurrency": {
    "label": "Ollama Cloud 最大并发",
    "description": "每个进程的 Ollama Cloud 子代理运行最大并发数；0 禁用该 provider 专属限制"
  },
  "providers.webSearchOrder": {
    "label": "网络搜索 provider 顺序",
    "description": "web_search 工具的 provider 优先级；未列出的 provider 保留其后默认顺序"
  },
  "providers.webSearchExclude": {
    "label": "排除的网络搜索 provider",
    "description": "web_search 永远不应使用的 provider，即使作为回退"
  },
  "providers.webSearchTimeoutSeconds": {
    "label": "网络搜索超时",
    "description": ""
  },
  "providers.webSearchGeminiModel": {
    "label": "Gemini web_search model",
    "description": "Gemini Google 搜索 grounding 的 model ID。默认为 gemini-2.5-flash。"
  },
  "providers.antigravityEndpoint": {
    "label": "Antigravity 端点模式",
    "description": "google-antigravity provider 的端点路由策略（chat、search、image、discovery）"
  },
  "providers.imageOrder": {
    "label": "图片 provider 顺序",
    "description": "图片生成的 provider 优先级；未列出的 provider 遵循活动会话 provider 和内置顺序"
  },
  "providers.fireworksTier": {
    "label": "Fireworks 层级",
    "description": "Fireworks 请求的服务路径。Priority 发送 `service_tier: priority` 以在高峰流量时获得更高可靠性（价格更高）；Standard 省略它。Fast（`-fast`）model 忽略此设置——Fast 是它自己的服务路径。"
  },
  "live.voice": {
    "label": "实时语音",
    "description": "Codex 支持的实时语音会话所使用的语音"
  },
  "providers.tts": {
    "label": "语音合成 provider",
    "description": "tts 工具的后端：本地设备端神经 TTS (Kokoro-82M) 或 xAI Grok Voice"
  },
  "tts.localModel": {
    "label": "本地 TTS model",
    "description": "本地 TTS 后端使用的设备端神经 TTS model (Kokoro-82M)"
  },
  "tts.localVoice": {
    "label": "本地 TTS 语音",
    "description": "本地 TTS 后端使用的 Kokoro 语音（美式/英式，女声/男声）"
  },
  "speech.enabled": {
    "label": "语音朗读",
    "description": "助手输出流式生成时通过扬声器朗读"
  },
  "speech.mode": {
    "label": "语音朗读模式",
    "description": "朗读什么：all = 助手消息 + 思考；assistant = 仅消息；yield = 仅轮末的最终消息"
  },
  "speech.enhanced": {
    "label": "增强语音改写",
    "description": "合成前用 tiny/smol model 将助手输出改写为自然口语（描述代码、去掉链接和 markdown）。失败时回退到机械清理"
  },
  "speech.voice": {
    "label": "语音朗读音色",
    "description": "朗读助手输出时使用的 Kokoro 语音"
  },
  "providers.tinyModel": {
    "label": "Tiny model",
    "description": "会话标题 model：默认在线（/models 中的 TINY 角色，否则 @smol），或本地设备端 model"
  },
  "providers.tinyModelDevice": {
    "label": "Tiny model 设备",
    "description": "本地 tiny model（标题 + 记忆）的 ONNX 执行 provider。默认仅 CPU 推理。PI_TINY_DEVICE 环境变量覆盖此设置。"
  },
  "providers.tinyModelDtype": {
    "label": "Tiny model 精度",
    "description": "本地 tiny model 的 ONNX 量化/精度。默认使用每个 model 自带的 dtype (q4)；精度越低越快，越高越忠实。PI_TINY_DTYPE 环境变量覆盖此设置。"
  },
  "providers.memoryModel": {
    "label": "记忆 model",
    "description": "用于事实提取 + 合并的 Mnemopi LLM：默认在线（/models 中的 TINY 角色，否则 smol/remote），或本地设备端 model"
  },
  "providers.autoThinkingModel": {
    "label": "自动思考 model",
    "description": "`auto` 思考级别的难度分类器：默认在线（/models 中的 TINY 角色，否则 smol），或本地设备端 model"
  },
  "providers.autoThinkingMaxEffort": {
    "label": "自动思考上限",
    "description": "`auto` 分类器可解析的最高思考量。`xhigh` 让分类器保持在顶层之下一级，因此只有显式 `ultrathink` 才能达到 `max`；`max` 允许分类器判定为特殊的轮次在暴露它的 model 上计费到顶层。"
  },
  "features.unexpectedStopDetection": {
    "label": "检测意外停止",
    "description": "用一个小 model 检测助手说将继续却未调用工具就停止的情况；自动提示它继续。"
  },
  "providers.unexpectedStopModel": {
    "label": "意外停止 model",
    "description": "意外停止检测的分类器：默认在线（/models 中的 TINY 角色，否则 smol），或本地设备端 model。"
  },
  "providers.kimiApiFormat": {
    "label": "Kimi API 格式",
    "description": "Kimi Code provider 的 API 格式（auto 跟随实时 model 元数据）"
  },
  "providers.openaiWebsockets": {
    "label": "OpenAI WebSockets",
    "description": "OpenAI Codex model 的 Websocket 策略（auto 使用 model 默认，on 强制，off 禁用）"
  },
  "providers.streamFirstEventTimeoutSeconds": {
    "label": "流首事件超时",
    "description": "等待首个 model 流事件的秒数；-1 使用 provider/环境默认，0 禁用看门狗"
  },
  "providers.streamIdleTimeoutSeconds": {
    "label": "流空闲超时",
    "description": "model 流在事件之间可保持静默的秒数；-1 使用 provider/环境默认，0 禁用看门狗"
  },
  "providers.openrouterVariant": {
    "label": "OpenRouter 路由",
    "description": "追加到 OpenRouter model ID 的默认路由变体后缀（选择器已指定变体时被覆盖）"
  },
  "providers.fetch": {
    "label": "Fetch provider",
    "description": "fetch/read URL 工具的读取后端优先级"
  },
  "codexResets.autoRedeem": {
    "label": "Codex 自动兑换已存重置",
    "description": "自动使用已保存的 Codex 限流重置：当一轮卡住且没有其他账号可接管时，恢复被耗尽的 5h 或每周窗口所阻塞的账号，并抢救即将过期的额度。unset 在首次使用前询问，yes 无需提示即使用，no 禁用两项检查。"
  },
  "codexResets.minBlockedMinutes": {
    "label": "Codex 自动兑换最小阻塞",
    "description": "仅当自然解除阻塞——耗尽的 5h/每周窗口中最近的重置——至少还要这么多分钟才自动兑换（不要为省短暂等待而花费稀缺额度）。调高（如 360）可忽略仅 5h 的阻塞。"
  },
  "codexResets.keepCredits": {
    "label": "Codex 自动兑换保留",
    "description": "从不自动花费到低于这么多已存重置（0 = 最后一个额度也可能被自动使用）。即将过期的额度豁免——一个过期的保留额度不保留任何东西。"
  },
  "codexResets.salvageHorizonHours": {
    "label": "Codex 重置抢救时限",
    "description": "当已存的 Codex 重置会在这么多小时内过期，且任一聊天窗口（5h 或每周）有值得恢复的有意义用量时，自动使用它（0 禁用过期抢救）。"
  },
  "provider.appendOnlyContext": {
    "label": "仅追加上下文",
    "description": "缓存系统提示词 + 工具规格，并保持仅追加的消息日志，使 provider 前缀 cache（DeepSeek、Xiaomi/SGLang、Anthropic）以最大速率命中。对已知前缀 cache provider 自动启用。"
  },
  "exa.enabled": {
    "label": "Exa",
    "description": "启用 Exa 网络搜索 provider"
  },
  "exa.searchDelayMs": {
    "label": "Exa 搜索延迟",
    "description": "Exa 网络搜索请求之间的最小延迟（毫秒）；设 0 禁用限速"
  },
  "searxng.endpoint": {
    "label": "SearXNG 端点",
    "description": "用于网络搜索的自托管 SearXNG 实例的基础 URL"
  },
  "extensionHandlers.toolCallTimeoutMs": {
    "label": "工具调用处理器超时 (ms)",
    "description": "扩展 tool_call 处理器的正有限活动工作超时；无效值使用 30000ms，等待 OMP 自有对话框的时间不计入"
  },
  "dev.autoqa": {
    "label": "自动 QA",
    "description": "自动化的工具问题报告（xd://report_issue）。默认开启；首次报告会请求同意，拒绝则禁用报告，直到显式重新启用"
  },
  "dev.autoqaPush.endpoint": {
    "label": "自动 QA 推送端点",
    "description": "接收 Auto QA JSON 报告的完整 URL（默认 https://qa.omp.sh/v1/grievances）"
  }
};
