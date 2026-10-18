/* Browser entry: the host supplies React and the session-scoped composer slot. */
window.__ModuleLoader__.load({
  id: '@local/dsh-next',
  factory(require) {
    const { useEffect, useRef, useState } = require('react');
    const { jsx, jsxs } = require('react/jsx-runtime');
    const { createPortal } = require('react-dom');
    const { IconDatabaseOutlineRegular, useAnchoredPosition, useDismissOnOutsidePointer } = require('@deepseek-ai/dsh-client-ui-primitives');
    const NS = 'dsh-next';
    const dictionaries = {
      zh: {
        enable: '开启 NEXT，优化此会话的后续调用',
        disable: 'NEXT 已开启，点击关闭后续调用优化',
        inherited: '（继承自父会话）',
        pending: '正在同步 NEXT 状态',
        failed: 'NEXT 切换失败：{detail}',
        unavailable: 'NEXT 命令不可用，请检查插件是否已加载。',
        timeout: 'NEXT 状态尚未同步，请重试。',
        stats: 'Token 用量',
        statsTitle: 'NEXT · 启用期间',
        cacheHit: '缓存命中',
        uncached: '未缓存输入',
        nativeCacheRead: '缓存读取',
        nativeCacheWrite: '缓存写入',
        nativeOutput: '输出',
        breakdown: 'NEXT Token 明细与统计范围',
        scope: '上方为原生会话 Token；下方仅计 NEXT 启用期间，含辅助调用与可归属子代理，范围不同，不相加。',
        calls: '调用次数',
        input: '输入 Token',
        output: '输出 Token',
        cacheRead: '缓存读取 Token',
        cacheWrite: '缓存写入 Token',
        elapsed: '调用累计耗时',
        cost: '估算费用',
        dedup: '重复读取精简次数',
        unknown: '未知',
        missing: '用量缺失 {usage} 次；价格未知 {price} 次。',
        coverage: '统计经宿主调用链发出的请求，含可归属的子代理；第三方直接 HTTP 请求未覆盖。',
        timing: '运行中的调用保持原状态，开关从后续调用生效。',
        close: '关闭统计',
        settingsTitle: 'NEXT 设置',
        settingsScope: '本页偏好由当前配置档案中的所有会话共享；NEXT 开关仍按会话独立保存。',
        settingsIntro: '语言、详略和执行优化在 NEXT 开启时生效。对话中的明确要求优先，更改用于后续请求。',
        outputLanguage: '默认输出语言',
        outputLanguageHelp: '设置回复正文的默认语言，代码、标识符和原样引用保持原文。',
        autoLanguage: '跟随当前对话',
        responseStyle: '回复详略',
        responseStyleHelp: '调整回答的默认详细程度，保留必要的验证与重要信息。',
        standard: '适中', concise: '简洁', detailed: '详细',
        deduplicateReads: '重复读取优化',
        deduplicateReadsHelp: '符合条件的重复文件内容改为短引用，原生读取和完整原文仍保留。',
        efficiencyGuidance: '执行效率提示',
        efficiencyGuidanceHelp: '为后续任务加入简短的执行指导，默认关闭。下方建议不自动跳过验证。',
        methodGuidance: '按需方法指导',
        methodGuidanceHelp: '只在具体任务需要时查阅方法或操作指引，避免例行加载整套文档。',
        targetedVerification: '精准验证建议',
        targetedVerificationHelp: '仅向模型提供建议：复用仍有效的验收证据，优先复测变化、失败及覆盖不足的部分。此设置不认证历史结果，也不自动跳过验证。',
        benefitBasedParallelism: '按收益并行建议',
        benefitBasedParallelismHelp: '仅在独立工作可缩短总耗时或提高质量时建议并行，避免重复执行与协调开销。',
        expandTokenDetails: '默认展开 Token 明细',
        expandTokenDetailsHelp: '打开用量面板时，自动展开 NEXT 的 Token 明细和统计范围。',
        automationEnabled: '主动自动化',
        automationEnabledHelp: 'NEXT 开启时启用下方自动化能力，独立于执行效率提示。不缓存普通 Shell 或 MCP 调用。',
        automationVerification: '修改后自动验证',
        automationVerificationHelp: '文件写入或编辑后，只自动运行匹配的已登记 JSON 检查。未登记时不自动检查，未知结果不视为通过。',
        automationParallelism: '自动只读子代理',
        automationParallelismHelp: 'NEXT 开启时，按任务需要安排独立的只读子代理，独立于执行效率提示。未配置有效价格或价格已过期时，不发起自动代理调用，主任务照常进行。',
        automationBudgetCny: '自动代理预算',
        automationBudgetCnyHelp: '限制自动只读子代理的费用估算，不限制主任务。仅使用当前配置中的 prices 和未过期的 automationPricesValidUntil；此页面不会修改价格或有效期。',
        budgetAmount: '{amount} 元', budgetCustom: '{amount} 元（当前值）',
        automationBudgetTitle: '自动只读代理费用',
        automationSpent: '已结算', automationReserved: '预留', automationUnknown: '未知请求',
        automationBudgetScope: '已结算费用是 NEXT 估算费用的子集，请勿相加。预留是保留上界，不是已结算费用；未知请求不按零计费。',
        verificationRegistration: '登记 JSON 检查',
        verificationRegistrationHelp: '在当前配置档案的 NEXT 插件配置中登记 verificationChecks。每项填写 id、workspace、kind 和 file；kind 支持 json-syntax 或 json-schema，后者还需 schemaFile。此页面不编辑检查清单，恢复默认设置也不清除清单或价格。',
        verificationTitle: 'JSON 验证记录',
        verificationExecuted: '执行通过', verificationReused: '复用先前通过', verificationFailed: '失败', verificationUnknown: '未知',
        verificationRecent: '最近检查',
        verificationHistory: '这里只展示已登记检查的历史记录，不代表当前文件全部通过；未知不算通过。',
        settingsLoading: '正在加载 NEXT 设置…',
        settingsUnavailable: 'NEXT 设置当前不可用，请确认宿主插件已加载。',
        saving: '正在保存…', saved: '已保存', saveFailed: '保存失败，请重试。',
        retrySave: '重试',
        settingsFooter: '设置自动保存，重启后保留。', resetSettings: '恢复默认设置',
      },
      en: {
        enable: 'Turn on NEXT for subsequent calls in this conversation',
        disable: 'NEXT is on. Turn off optimization for subsequent calls',
        inherited: ' (inherited from parent conversation)',
        pending: 'Synchronizing NEXT state',
        failed: 'NEXT could not switch: {detail}',
        unavailable: 'The NEXT command is unavailable. Check that the plugin is loaded.',
        timeout: 'NEXT state did not synchronize. Try again.',
        stats: 'Token usage',
        statsTitle: 'NEXT · While enabled',
        cacheHit: 'Cache hit',
        uncached: 'Uncached input',
        nativeCacheRead: 'Cache read',
        nativeCacheWrite: 'Cache write',
        nativeOutput: 'Output',
        breakdown: 'NEXT token details and scope',
        scope: 'Above: native session tokens. Below: calls started while NEXT was enabled, including auxiliary calls and attributable subagents. The scopes differ; do not add them.',
        calls: 'Calls',
        input: 'Input tokens',
        output: 'Output tokens',
        cacheRead: 'Cache read tokens',
        cacheWrite: 'Cache write tokens',
        elapsed: 'Cumulative call duration',
        cost: 'Estimated cost',
        dedup: 'Repeated reads shortened',
        unknown: 'Unknown',
        missing: 'Usage missing for {usage} calls; prices unknown for {price} calls.',
        coverage: 'Covers host-routed requests and attributable subagents. Third-party direct HTTP requests are not covered.',
        timing: 'Running calls keep their current settings. This switch applies to subsequent calls.',
        close: 'Close statistics',
        settingsTitle: 'NEXT settings',
        settingsScope: 'These preferences are shared by every conversation in the current profile. The NEXT switch is saved separately for each conversation.',
        settingsIntro: 'Language, response detail and execution preferences apply while NEXT is on. Explicit conversation instructions take precedence. Changes apply to subsequent requests.',
        outputLanguage: 'Default response language',
        outputLanguageHelp: 'Sets the language of response prose. Code, identifiers and verbatim quotes keep their original text.',
        autoLanguage: 'Match chat',
        responseStyle: 'Response detail',
        responseStyleHelp: 'Choose the default level of detail while retaining necessary verification and important information.',
        standard: 'Balanced', concise: 'Concise', detailed: 'Detailed',
        deduplicateReads: 'Shorten repeated file reads',
        deduplicateReadsHelp: 'Replace eligible repeated file content with a short reference. Native reads and the complete original remain available.',
        efficiencyGuidance: 'Execution efficiency guidance',
        efficiencyGuidanceHelp: 'Adds brief execution guidance to subsequent tasks. Off by default. These suggestions do not automatically skip verification.',
        methodGuidance: 'On-demand method guidance',
        methodGuidanceHelp: 'Consult methods or operating guidance when the task needs them, avoiding routine loading of entire document sets.',
        targetedVerification: 'Targeted verification suggestions',
        targetedVerificationHelp: 'Only advises the model to reuse still-valid acceptance evidence and focus rechecks on changed inputs, failures and coverage gaps. This setting does not certify earlier results or automatically skip checks.',
        benefitBasedParallelism: 'Benefit-based parallelism suggestions',
        benefitBasedParallelismHelp: 'Suggest parallel work when independent tasks can reduce total time or improve quality, avoiding duplicate work and coordination overhead.',
        expandTokenDetails: 'Expand token details by default',
        expandTokenDetailsHelp: 'Expand NEXT token details and scope when opening the usage panel.',
        automationEnabled: 'Proactive automation',
        automationEnabledHelp: 'Enables the automation below while NEXT is on, independently of execution guidance. Ordinary shell and MCP calls are not cached.',
        automationVerification: 'Verify after file changes',
        automationVerificationHelp: 'After file writes or edits, automatically run only matching registered JSON checks. No registered check means no automatic check. Unknown results are not passing.',
        automationParallelism: 'Automatic read-only subagents',
        automationParallelismHelp: 'Schedule independent read-only subagents when the task needs them while NEXT is on, independently of execution guidance. Missing or expired prices prevent automatic calls; the main task continues.',
        automationBudgetCny: 'Automatic subagent budget',
        automationBudgetCnyHelp: 'Limits the estimated cost of automatic read-only subagents, not the main task. Requires configured prices and an unexpired automationPricesValidUntil. This page does not change prices or their expiry.',
        budgetAmount: 'CNY {amount}', budgetCustom: 'CNY {amount} (custom)',
        automationBudgetTitle: 'Automatic read-only subagent cost',
        automationSpent: 'Settled', automationReserved: 'Reserved', automationUnknown: 'Unknown requests',
        automationBudgetScope: 'Settled cost is already part of the NEXT estimate; do not add it again. Reservations hold an upper bound and are not settled cost. Unknown requests are not treated as free.',
        verificationRegistration: 'Register JSON checks',
        verificationRegistrationHelp: 'Register verificationChecks in the NEXT plugin configuration for this profile. Each entry needs id, workspace, kind and file. The kind is json-syntax or json-schema; the latter also needs schemaFile. This page does not edit the check list. Resetting preferences preserves the list and prices.',
        verificationTitle: 'JSON verification history',
        verificationExecuted: 'Executed and passed', verificationReused: 'Reused earlier success', verificationFailed: 'Failed', verificationUnknown: 'Unknown',
        verificationRecent: 'Recent checks',
        verificationHistory: 'Shows historical records of registered checks, not proof that every current file passes. Unknown is not passing.',
        settingsLoading: 'Loading NEXT settings…',
        settingsUnavailable: 'NEXT settings are unavailable. Check that the Host plugin is loaded.',
        saving: 'Saving…', saved: 'Saved', saveFailed: 'Could not save. Try again.',
        retrySave: 'Retry',
        settingsFooter: 'Changes save automatically and persist after restart.', resetSettings: 'Reset to defaults',
      },
    };

    Object.assign(dictionaries.zh, {
      settingsScope: '按模型设置优化。DeepSeek 官方账号与 API 的相同模型共享 NEXT 设置；NEXT 开关仍按会话独立保存。',
      models: '模型', modelSearch: '搜索模型或提供方', defaults: '继承默认设置',
      defaultsHelp: '保留升级前的偏好。尚未设置的模型继承这些值。',
      tagsTitle: '优化标签', tagsHelp: '手动给模型添加标签。标签只应用已声明的设置，不推断模型能力；更改共享标签会影响所有使用它的模型。',
      orderHelp: '优先级：继承默认 → 标签（从上到下，后者优先）→ 模型独立设置。仅 NEXT 开启时生效。',
      modelHelp: '此页仅影响这个提供方下的此模型，不会切换模型或发送消息。',
      officialDeepSeek: 'DeepSeek 官方 · 账号 / API', officialAccount: '官方账号', officialApi: '官方 API',
      officialModelHelp: '官方账号与 API 中 ID 相同的模型共享 NEXT 标签和独立设置，设置一次同时保存到两种接入。模型路由选择、价格与用量计量仍各自独立。设置不会切换模型或发送消息。',
      officialPolicyConflict: '两种接入已有设置不同，当前以{source}为编辑基础。下次修改会将本页全部标签和独立设置同步到官方账号与 API。',
      catalogLoading: '正在读取宿主模型目录…', catalogFailed: '部分模型目录读取失败；可以重试，已保存的模型仍可编辑。',
      catalogEmpty: '宿主尚未提供模型。请先在宿主设置中配置模型提供方。', noModels: '没有匹配的模型。',
      refreshModels: '刷新模型目录', savedModel: '已保存；当前目录中不可用', noTags: '尚未添加标签',
      addTag: '添加优化标签', editTag: '编辑标签策略', removeTag: '移除标签', moveUp: '上移标签', moveDown: '下移标签',
      tagName: '标签名称', createTag: '创建标签', newTag: '新标签', tagEmpty: '未设置策略：此标签暂时仅作标记。修改下方设置后才会应用相应策略。',
      tagPolicyHelp: '共享标签策略。这里只保存你修改的项目，其余项目沿用模型的其他设置。',
      inheritedValue: '继承', customValue: '模型独立设置', tagValue: '来自标签：{name}',
      clearOverride: '恢复继承', clearTagValue: '移除此项策略', modelReset: '清除本模型标签和独立设置',
      tagReset: '清空此标签策略', backModels: '返回模型列表', backModel: '返回模型',
      economyTag: '低开销', codeTag: '代码验证', detailedTag: '详细解答',
      tagResetHelp: '此操作保留标签名称及模型关联。',
    });
    Object.assign(dictionaries.en, {
      settingsScope: 'Configure optimization by model. Matching model IDs in the official DeepSeek account and API share NEXT settings. The NEXT switch remains separate for each conversation.',
      models: 'Models', modelSearch: 'Search models or providers', defaults: 'Inherited defaults',
      defaultsHelp: 'Preserves your previous preferences. Models without their own policy inherit these values.',
      tagsTitle: 'Optimization tags', tagsHelp: 'Assign tags manually. Tags apply declared settings without inferring model capabilities. Editing a shared tag affects every model using it.',
      orderHelp: 'Priority: defaults → tags (top to bottom, later wins) → model overrides. Applies only while NEXT is on.',
      modelHelp: 'Applies only to this model under this provider. Editing does not switch models or send messages.',
      officialDeepSeek: 'DeepSeek official · Account / API', officialAccount: 'the official account', officialApi: 'the official API',
      officialModelHelp: 'The official account and API share NEXT tags and overrides for matching model IDs. Each edit saves to both connections. Model routing, prices and usage accounting remain separate. Editing does not switch models or send messages.',
      officialPolicyConflict: 'The two connections have different saved settings. This page uses {source} as the editing base. Your next edit will synchronize all tags and overrides shown here to both official connections.',
      catalogLoading: 'Loading the Host model catalog…', catalogFailed: 'Some model catalogs could not load. Retry anytime; saved models remain editable.',
      catalogEmpty: 'The Host has no models yet. Configure a model provider in Host settings first.', noModels: 'No matching models.',
      refreshModels: 'Refresh model catalog', savedModel: 'Saved; unavailable in current catalog', noTags: 'No tags assigned',
      addTag: 'Add optimization tag', editTag: 'Edit tag policy', removeTag: 'Remove tag', moveUp: 'Move tag up', moveDown: 'Move tag down',
      tagName: 'Tag name', createTag: 'Create tag', newTag: 'New tag', tagEmpty: 'No policy yet: this tag is only a label until you change settings below.',
      tagPolicyHelp: 'Shared tag policy. Only changed fields are saved; other fields retain the model’s other settings.',
      inheritedValue: 'Inherited', customValue: 'Model override', tagValue: 'From tag: {name}',
      clearOverride: 'Use inherited value', clearTagValue: 'Remove this policy field', modelReset: 'Clear this model’s tags and overrides',
      tagReset: 'Clear this tag’s policy', backModels: 'Back to models', backModel: 'Back to model',
      economyTag: 'Low overhead', codeTag: 'Code verification', detailedTag: 'Detailed answers',
      tagResetHelp: 'Keeps the tag name and model assignments.',
    });
    Object.assign(dictionaries.zh, {
      automationVerificationHelp: '文件写入或编辑后，只自动运行匹配的已登记检查。未登记时不自动检查，未知结果不视为通过。',
      automationBudgetCnyHelp: '限制自动只读子代理的费用估算，不限制主任务。需要 prices 和未过期的 automationPricesValidUntil；可在“生产能力 / 项目检查 / 价格”中配置。',
      verificationRegistration: '登记项目检查', verificationTitle: '验证记录', verificationExpired: '已过期',
      verificationRegistrationHelp: '在“生产能力 / 项目检查 / 价格”中登记 verificationChecks。扫描只读取项目脚本，点击登记后才允许自动执行；已有 JSON 检查继续有效。恢复默认设置不清除清单或价格。',
      production: '生产能力 / 项目检查 / 价格', productionHelp: '当前会话的实际可用能力。登记检查与核实价格后才开放对应自动化。设置不发送消息或切换模型。',
      productionLoading: '正在读取当前会话能力…', productionUnavailable: '生产能力暂不可用，请确认宿主与 NEXT 已加载，并打开项目会话后重试。配置仍可编辑。',
      productionRefresh: '刷新能力状态', capabilityOptimization: '优化', capabilityVerification: '验证', capabilityRetrieval: '检索', capabilityParallel: '自动只读子代理',
      capabilityReady: '可用', capabilityOff: '关闭', capabilityBlocked: '不可用', capabilityUnknown: '未知', noCurrentSession: '尚无可用的项目会话。',
      workspace: '项目目录', scanChecks: '扫描项目脚本', scanLoading: '正在只读扫描…', scanFailed: '无法扫描，请打开与该目录匹配的项目会话后重试。',
      scanEmpty: '未找到可登记脚本。扫描不运行命令。', scanHelp: '扫描只读取脚本和锁文件。核对完整命令、超时及绑定文件后登记；脚本或锁文件变化后需重新登记。',
      registerCheck: '登记 / 重新登记', removeCheck: '移除检查', registeredChecks: '已登记检查', noChecks: '尚未登记检查。', commandTimeout: '超时 {seconds} 秒',
      checkBindings: '绑定文件', legacyCheck: '兼容 JSON 检查', registeredState: '登记状态',
      artifactCheck: '文件产物检查', checkId: '检查 ID', artifactFile: '文件路径（项目内）', artifactFormat: '文件格式', artifactColumns: '必需 CSV 列（逗号分隔）', artifactText: '必需文本（每行一项）',
      registerArtifact: '登记产物检查', artifactInvalid: '请填写检查 ID、项目目录及项目内文件路径；列名和必需文本不能重复。',
      routePrices: '按实际调用路由设置价格', priceHelp: '单位：人民币 / 百万 Token。请先核实官方价格，未知保持空白。官方账号与 API 分别保存价格，不因模型设置合并而复制。',
      priceExpiryHelp: '有效期是所有自动代理价格共用的期限。请确认所有价格均在此日期前有效；到期暂停自动代理，主任务照常进行。',
      priceProvider: '提供方 ID', priceModel: '模型 ID', priceInput: '未缓存输入', priceCacheRead: '缓存读取', priceCacheWrite: '缓存写入', priceOutput: '输出', priceExpiry: '价格有效期（ISO 8601）',
      savePrice: '保存此路由价格', editPrice: '编辑价格', removePrice: '移除价格', priceInvalid: '请填写准确路由、四项非负有限费率和未来的 ISO 8601 有效期；未知费率不能按零保存。',
      noPrices: '尚未登记价格。', choosePriceRoute: '从宿主目录选择实际路由', checkDefinition: '完整检查定义', currentRoute: '当前实际路由',
    });
    Object.assign(dictionaries.en, {
      automationVerificationHelp: 'After file changes, automatically run only matching registered checks. No registered check means no automatic check. Unknown results are not passing.',
      automationBudgetCnyHelp: 'Limits automatic read-only subagent costs, not the main task. Requires prices and an unexpired automationPricesValidUntil. Configure these under Production / Checks / Prices.',
      verificationRegistration: 'Register project checks', verificationTitle: 'Verification history', verificationExpired: 'Expired',
      verificationRegistrationHelp: 'Manage verificationChecks under Production / Checks / Prices. Scanning only reads scripts; registration enables automatic execution. Existing JSON checks remain supported. Resetting preferences preserves checks and prices.',
      production: 'Production / Checks / Prices', productionHelp: 'Capabilities available to the current conversation. Register checks and confirm prices for automation. Editing never sends messages or switches models.',
      productionLoading: 'Loading conversation capabilities…', productionUnavailable: 'Production capabilities are unavailable. Check that the Host and NEXT are loaded, open a project conversation and retry. Configuration remains editable.',
      productionRefresh: 'Refresh capability status', capabilityOptimization: 'Optimization', capabilityVerification: 'Verification', capabilityRetrieval: 'Retrieval', capabilityParallel: 'Automatic read-only subagents',
      capabilityReady: 'Ready', capabilityOff: 'Off', capabilityBlocked: 'Blocked', capabilityUnknown: 'Unknown', noCurrentSession: 'No project conversation available.',
      workspace: 'Project directory', scanChecks: 'Scan project scripts', scanLoading: 'Scanning read-only…', scanFailed: 'Could not scan. Open a project conversation matching this directory and retry.',
      scanEmpty: 'No candidate scripts found. Scanning never runs commands.', scanHelp: 'Scanning only reads scripts and lockfiles. Review the command, timeout and bound files before registering. Changes to scripts or lockfiles require registration again.',
      registerCheck: 'Register / Register again', removeCheck: 'Remove check', registeredChecks: 'Registered checks', noChecks: 'No checks registered.', commandTimeout: 'Timeout: {seconds} seconds',
      checkBindings: 'Bound files', legacyCheck: 'Compatible JSON check', registeredState: 'Registration status',
      artifactCheck: 'File artifact check', checkId: 'Check ID', artifactFile: 'File path (inside project)', artifactFormat: 'File format', artifactColumns: 'Required CSV columns (comma-separated)', artifactText: 'Required text (one per line)',
      registerArtifact: 'Register artifact check', artifactInvalid: 'Enter a check ID, project directory and project-relative file path. Columns and required text must not contain duplicates.',
      routePrices: 'Prices by actual request route', priceHelp: 'CNY per million tokens. Confirm official prices first; leave unknown values blank. Account and API prices are independent even when model preferences are shared.',
      priceExpiryHelp: 'This expiry is shared by all automatic subagent prices. Confirm all saved prices remain valid through this date. Expired prices pause automatic subagents; the main task continues.',
      priceProvider: 'Provider ID', priceModel: 'Model ID', priceInput: 'Uncached input', priceCacheRead: 'Cache read', priceCacheWrite: 'Cache write', priceOutput: 'Output', priceExpiry: 'Price expiry (ISO 8601)',
      savePrice: 'Save this route’s prices', editPrice: 'Edit prices', removePrice: 'Remove prices', priceInvalid: 'Enter the exact route, four finite nonnegative rates and a future ISO 8601 expiry. Unknown rates cannot be saved as zero.',
      noPrices: 'No prices registered.', choosePriceRoute: 'Choose an actual route from the Host catalog', checkDefinition: 'Complete check definition', currentRoute: 'Current request route',
    });
    const preferenceDefaults = { outputLanguage: 'auto', responseStyle: 'standard', deduplicateReads: true,
      efficiencyGuidance: false, methodGuidance: true, targetedVerification: true, benefitBasedParallelism: true,
      expandTokenDetails: false, automationEnabled: true, automationVerification: true, automationParallelism: true, automationBudgetCny: 3 };
    const defaultTags = [
      { id: 'economy', name: '低开销', preferences: { responseStyle: 'concise', efficiencyGuidance: true, benefitBasedParallelism: false, automationParallelism: false } },
      { id: 'code', name: '代码验证', preferences: { efficiencyGuidance: true, methodGuidance: true, targetedVerification: true } },
      { id: 'detailed', name: '详细解答', preferences: { responseStyle: 'detailed' } },
    ];
    const routeKey = (route) => JSON.stringify([route.provider, route.model]);
    const officialProviders = ['deepseek-account', 'deepseek-official'];
    const isOfficialRoute = (route) => officialProviders.includes(route?.provider);
    const modelSettingRoute = (route) => isOfficialRoute(route) ? { provider: officialProviders[0], model: route.model } : route;
    const profilesOf = (settings) => Array.isArray(settings?.modelProfiles) ? settings.modelProfiles : [];
    const tagsOf = (settings) => Array.isArray(settings?.optimizationTags) ? settings.optimizationTags : defaultTags;
    const hasModelPolicy = (profile) => (profile?.tags?.length ?? 0) > 0 || Object.keys(profile?.overrides ?? {}).length > 0;
    function sameModelPolicy(left, right) {
      const leftTags = left?.tags ?? [], rightTags = right?.tags ?? [];
      const leftOverrides = left?.overrides ?? {}, rightOverrides = right?.overrides ?? {};
      return leftTags.length === rightTags.length && leftTags.every((id, index) => id === rightTags[index]) &&
        Object.keys(leftOverrides).length === Object.keys(rightOverrides).length &&
        Object.keys(leftOverrides).every((field) => Object.hasOwn(rightOverrides, field) && leftOverrides[field] === rightOverrides[field]);
    }
    function profileSelection(settings, route) {
      if (!route) return { profile: undefined, conflict: false };
      const profiles = profilesOf(settings);
      if (!isOfficialRoute(route)) return { profile: profiles.find((item) => routeKey(item) === routeKey(route)), conflict: false };
      const account = profiles.find((item) => item.provider === officialProviders[0] && item.model === route.model);
      const api = profiles.find((item) => item.provider === officialProviders[1] && item.model === route.model);
      const profile = hasModelPolicy(account) ? account : hasModelPolicy(api) ? api : account ?? api;
      return { profile, conflict: !!account && !!api && !sameModelPolicy(account, api) };
    }
    function profilesWithPolicy(settings, next) {
      const providers = isOfficialRoute(next) ? officialProviders : [next.provider];
      const updated = profilesOf(settings).filter((item) => item.model !== next.model || !providers.includes(item.provider));
      if (hasModelPolicy(next)) for (const provider of providers) {
        updated.push({ provider, model: next.model, tags: [...(next.tags ?? [])], overrides: { ...next.overrides } });
      }
      return updated;
    }
    function modelCatalogEntries(groups, profiles, officialName) {
      const entries = new Map();
      function add(entry) {
        const route = modelSettingRoute(entry), key = routeKey(route), previous = entries.get(key);
        const official = isOfficialRoute(entry);
        const preferEntry = !previous || (!previous.available && entry.available) ||
          (previous.available === entry.available && entry.provider === officialProviders[0]);
        entries.set(key, { ...(preferEntry ? entry : previous), ...route, official,
          providerName: official ? officialName : (preferEntry ? entry.providerName : previous.providerName),
          available: !!(previous?.available || entry.available),
          searchText: `${previous?.searchText ?? ''} ${entry.providerName} ${entry.provider} ${entry.name} ${entry.model}${official ? ' deepseek-account deepseek-official 账号 API account official' : ''}`,
        });
      }
      for (const group of groups) for (const model of group.models ?? []) {
        add({ provider: group.id, model: model.id, providerName: group.name ?? group.id, name: model.name ?? model.id, available: true });
      }
      for (const saved of profiles) add({ provider: saved.provider, model: saved.model, providerName: saved.provider, name: saved.model, available: false });
      return entries;
    }
    function modelValues(settings, route, sharedOfficial = false) {
      const values = { ...preferenceDefaults };
      for (const field of Object.keys(values)) if (settings?.[field] !== undefined) values[field] = settings[field];
      const profile = sharedOfficial ? profileSelection(settings, route).profile : route && profilesOf(settings).find((item) => routeKey(item) === routeKey(route));
      for (const id of profile?.tags ?? []) Object.assign(values, tagsOf(settings).find((tag) => tag.id === id)?.preferences ?? {});
      return Object.assign(values, profile?.overrides ?? {});
    }

    const css = `
.dsh-next { position: relative; display: inline-flex; align-items: center; flex: 0 0 auto; gap: 1px; }
.dsh-next__toggle {
  min-height: 28px; border: 1px solid var(--dsw-alias-border-secondary, #62666d);
  border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary, #b7bcc5);
  font-family: inherit; font-size: 12px; font-weight: 600; line-height: 20px; cursor: pointer;
}
.dsh-next__toggle { padding: 0 7px; white-space: nowrap; }
.dsh-next button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #333840); }
.dsh-next__toggle[aria-pressed="true"] { color: var(--dsw-alias-label-primary, #fff); border-color: #5489ff; background: color-mix(in srgb, #5489ff 20%, transparent); }
.dsh-next button:focus-visible { outline: 2px solid #5489ff; outline-offset: 2px; }
.dsh-next__toggle:disabled { cursor: progress; opacity: .65; }
.dsh-next__error {
  position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 40; box-sizing: border-box;
  width: min(320px, calc(100vw - 40px)); padding: 12px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-secondary, #62666d);
  background: var(--dsw-alias-bg-base, #202329); color: var(--dsw-alias-label-primary, #eef0f4);
  font: 12px/1.5 sans-serif; white-space: normal; box-shadow: 0 4px 16px #0004;
}
.dsh-next-usage { min-width: 0; display: inline-flex; }
.dsh-next-usage__trigger { display: inline-flex; align-items: center; gap: 4px; min-width: 0; height: 24px; padding: 2px 8px; border: 0; border-radius: var(--dsw-radius-sm, 8px); background: transparent; color: var(--dsw-alias-label-tertiary, #aaa); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.dsh-next-usage__trigger:hover, .dsh-next-usage__trigger[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover, #333); }
.dsh-next-usage__trigger:focus-visible { outline: 2px solid #5489ff; outline-offset: 2px; }
.dsh-next-usage svg { flex: none; width: 14px; height: 14px; }
.dsh-next-usage__panel { position: fixed; z-index: 1100; box-sizing: border-box; width: max-content; min-width: min(300px, calc(100vw - 24px)); max-width: min(440px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; padding: 16px; border: 0; border-radius: var(--dsw-radius-lg, 16px); background: var(--dsw-specific-menu, #303134); backdrop-filter: var(--dsw-menu-backdrop-filter); --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-secondary, #ddd); font-size: 12px; line-height: 18px; }
.dsh-next-usage__heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; font-weight: 500; color: var(--dsw-alias-label-primary, #eee); }
.dsh-next-usage__heading span:first-child { display: inline-flex; align-items: center; gap: 6px; }
.dsh-next-usage__heading svg { flex: none; width: 14px; height: 14px; }
.dsh-next-usage__rule { border-top: .5px solid var(--dsw-alias-border-l2, #555); margin-bottom: 10px; }
.dsh-next__metrics { display: grid; grid-template-columns: minmax(76px, auto) minmax(0, 1fr); gap: 6px 16px; margin: 0; color: var(--dsw-alias-label-tertiary, #aaa); }
.dsh-next__metrics dt, .dsh-next__metrics dd { margin: 0; }
.dsh-next__metrics dd { text-align: right; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary, #ddd); }
.dsh-next-usage__next { margin-top: 14px; padding-top: 12px; border-top: .5px solid var(--dsw-alias-border-l2, #555); }
.dsh-next-usage__next summary { cursor: pointer; color: var(--dsw-alias-label-tertiary, #aaa); margin: 10px 0; }
.dsh-next-verification, .dsh-next-budget { min-width: 0; margin-top: 12px; padding-top: 12px; border-top: .5px solid var(--dsw-alias-border-l2, #555); }
.dsh-next-verification h3, .dsh-next-verification h4, .dsh-next-budget h3 { margin: 0 0 8px; color: var(--dsw-alias-label-primary, #eee); font-size: 12px; font-weight: 500; overflow-wrap: anywhere; }
.dsh-next-verification h4 { margin-top: 12px; }
.dsh-next-verification__recent { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.dsh-next-verification__recent li { min-width: 0; overflow-wrap: anywhere; }
.dsh-next-verification__recent strong { font-weight: 500; }
.dsh-next-verification__recent [data-next-verification-status="failed"] { color: var(--dsw-alias-error-primary, #ff8f8f); }
.dsh-next-verification__recent [data-next-verification-status="unknown"] { color: var(--dsw-alias-label-tertiary, #aaa); }
.dsh-next-verification__detail { display: block; margin-top: 2px; color: var(--dsw-alias-label-tertiary, #aaa); }
.dsh-next__note { margin: 7px 0 0; max-width: 370px; color: var(--dsw-alias-label-tertiary, #aaa); overflow-wrap: anywhere; }
.dsh-next__error { background: #702b31; color: #fff; }
.dsh-next-settings { box-sizing: border-box; width: 100%; min-width: 0; max-width: 640px; padding: 8px 0 24px; color: var(--dsw-alias-label-primary, #eee); container-type: inline-size; }
.dsh-next-settings h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
.dsh-next-settings__scope, .dsh-next-settings__intro { margin: 0 0 12px; color: var(--dsw-alias-label-tertiary, #aaa); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.dsh-next-settings__intro { margin-bottom: 18px; }
.dsh-next-settings__field { min-width: 0; padding: 18px 0; border-bottom: .5px solid var(--dsw-alias-border-l2, #444); }
.dsh-next-settings__row { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-width: 0; }
.dsh-next-settings__copy { display: grid; flex: 1 1 auto; gap: 6px; min-width: 0; font-size: 14px; overflow-wrap: anywhere; }
.dsh-next-settings__help { color: var(--dsw-alias-label-tertiary, #aaa); font-size: 12px; line-height: 1.6; }
.dsh-next-settings__subgroup { margin-left: 8px; padding-left: 18px; border-left: 2px solid var(--dsw-alias-border-l2, #444); }
.dsh-next-settings__registration { min-width: 0; margin-top: 12px; overflow-wrap: anywhere; }
.dsh-next-settings__registration h3 { margin: 0 0 6px; font-size: 13px; font-weight: 500; }
.dsh-next-settings__registration p { margin: 0; }
.dsh-next-settings select, .dsh-next-settings button { font: inherit; color: var(--dsw-alias-label-primary, #eee); background: var(--dsw-alias-bg-secondary, #303134); border: 1px solid var(--dsw-alias-border-l2, #555); border-radius: var(--dsw-radius-sm, 8px); padding: 7px 10px; }
.dsh-next-settings select { box-sizing: border-box; flex: 0 0 auto; width: 14em; min-width: 10em; max-width: 50%; }
.dsh-next-settings input { width: 18px; height: 18px; accent-color: #5489ff; flex: none; cursor: pointer; }
.dsh-next-settings button { max-width: 100%; white-space: normal; overflow-wrap: anywhere; cursor: pointer; }
.dsh-next-settings :disabled { opacity: .55; cursor: default; }
.dsh-next-settings :focus-visible { outline: 2px solid #5489ff; outline-offset: 3px; }
.dsh-next-settings__footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 20px; color: var(--dsw-alias-label-tertiary, #aaa); font-size: 12px; }
.dsh-next-settings__status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 22px; margin-top: 8px; font-size: 12px; overflow-wrap: anywhere; }
.dsh-next-settings__status button { min-width: 44px; min-height: 28px; padding: 4px 8px; }
.dsh-next-settings__status[role="alert"] { color: var(--dsw-alias-error-primary, #ff8f8f); }
.dsh-next-settings__toolbar { display:flex;flex-wrap:wrap;gap:8px;margin:14px 0;align-items:center; }
.dsh-next-settings input[type="text"], .dsh-next-settings input[type="search"] { width:100%;height:auto;min-width:0;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2,#555);border-radius:8px;background:var(--dsw-alias-bg-secondary,#303134);color:inherit;font:inherit; }
.dsh-next-settings__models { display:grid;gap:8px;margin:14px 0; }
.dsh-next-settings__models button { display:grid;gap:5px;width:100%;text-align:left;padding:14px;min-width:0; }
.dsh-next-settings__models strong, .dsh-next-settings__models span { overflow-wrap:anywhere;min-width:0; }
.dsh-next-settings__models small, .dsh-next-settings__source { color:var(--dsw-alias-label-tertiary,#aaa);font-size:12px;overflow-wrap:anywhere; }
.dsh-next-settings__tags { list-style:none;padding:0;margin:12px 0;display:grid;gap:8px; }
.dsh-next-settings__tags li { display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:9px;border:1px solid var(--dsw-alias-border-l2,#444);border-radius:8px;min-width:0; }
.dsh-next-settings__tags li>span { flex:1 1 140px;min-width:0;overflow-wrap:anywhere; }
.dsh-next-settings__tags button { padding:5px 8px;font-size:12px; }
.dsh-next-settings__source { display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px; }
.dsh-next-settings__source button { padding:3px 7px;font-size:12px; }
.dsh-next-settings h3 { font-size:15px;margin:22px 0 8px;overflow-wrap:anywhere; }
.dsh-next-settings__production-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px; }
.dsh-next-settings__production-grid label, .dsh-next-settings__production-label { display:grid;gap:7px;min-width:0;font-size:13px;margin:12px 0;overflow-wrap:anywhere; }
.dsh-next-settings__production-grid input, .dsh-next-settings__production-label input, .dsh-next-settings textarea { box-sizing:border-box;width:100%;min-width:0; }
.dsh-next-settings textarea { min-height:86px;resize:vertical;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2,#555);border-radius:8px;background:var(--dsw-alias-bg-secondary,#303134);color:inherit;font:inherit; }
.dsh-next-settings__check { border:1px solid var(--dsw-alias-border-l2,#444);border-radius:8px;padding:12px;margin:10px 0;min-width:0;overflow-wrap:anywhere; }
.dsh-next-settings__check pre { white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-width:100%;margin:8px 0; }
.dsh-next-settings__capabilities { padding:0;list-style:none;display:grid;gap:10px;font-size:13px; }
.dsh-next-settings__capabilities li { min-width:0;overflow-wrap:anywhere; }
@container (max-width: 480px) {
  .dsh-next-settings__production-grid { grid-template-columns:minmax(0,1fr); }
  .dsh-next-settings__row { flex-direction: column; align-items: stretch; gap: 12px; }
  .dsh-next-settings select { flex: none; width: 100%; min-width: 0; max-width: 100%; }
  .dsh-next-settings input { align-self: flex-start; }
  .dsh-next-settings__subgroup { margin-left: 0; padding-left: 12px; }
  .dsh-next-settings__footer { align-items: stretch; flex-direction: column; }
}
@media (max-width: 480px) {
  .dsh-next-settings__production-grid { grid-template-columns:minmax(0,1fr); }
  .dsh-next__toggle { padding: 0 5px; }
  .dsh-next-settings__row { flex-direction: column; align-items: stretch; gap: 12px; }
  .dsh-next-settings select { flex: none; width: 100%; min-width: 0; max-width: 100%; }
  .dsh-next-settings input { align-self: flex-start; }
  .dsh-next-settings__subgroup { margin-left: 0; padding-left: 12px; }
  .dsh-next-settings__footer { align-items: stretch; flex-direction: column; }
}
`;

    function validNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    }

    function NextButton({ sessionId, useSessions, execute, t }) {
      const state = useSessions((store) => store.byId[sessionId]?.projectionValues?.next);
      const active = state?.active === true;
      const [pending, setPending] = useState(null);
      const [error, setError] = useState(null);
      const request = useRef(null);
      const latestSession = useRef(sessionId);
      latestSession.current = sessionId;
      const currentPending = pending?.sessionId === sessionId ? pending : null;
      const currentError = error?.sessionId === sessionId ? error.message : null;

      useEffect(() => {
        request.current = null;
        setPending(null);
        setError(null);
        return () => { request.current = null; };
      }, [sessionId]);

      useEffect(() => {
        if (currentPending?.acknowledged && active === currentPending.target) {
          request.current = null;
          setPending(null);
          setError(null);
        }
      }, [active, currentPending]);

      useEffect(() => {
        if (error?.sessionId === sessionId && error.expectedTarget === active) setError(null);
      }, [active, error, sessionId]);

      useEffect(() => {
        if (!currentPending) return undefined;
        const token = request.current;
        const timer = window.setTimeout(() => {
          if (request.current !== token || latestSession.current !== sessionId) return;
          request.current = null;
          setPending(null);
          setError({ sessionId, expectedTarget: currentPending.target, message: t('timeout') });
        }, 8000);
        return () => window.clearTimeout(timer);
      }, [currentPending, sessionId, t]);

      async function toggle() {
        if (request.current !== null) return;
        const target = !active;
        const token = { sessionId, target };
        request.current = token;
        setError(null);
        setPending({ sessionId, target, acknowledged: false });
        try {
          // A direct command RPC does not submit, clear, or otherwise touch the composer draft.
          const result = await execute(sessionId, target ? '/next on' : '/next off', []);
          if (request.current !== token || latestSession.current !== sessionId) return;
          if (!result?.ok) throw new Error(result?.error?.message ?? result?.error?.code ?? t('unavailable'));
          if (result.value === undefined) throw new Error(t('unavailable'));
          if (result.value.result?.kind !== 'success') {
            throw new Error(result.value.result?.text ?? t('unavailable'));
          }
          setPending({ sessionId, target, acknowledged: true });
        } catch (cause) {
          if (request.current !== token || latestSession.current !== sessionId) return;
          request.current = null;
          setPending(null);
          setError({ sessionId, message: t('failed', { detail: cause instanceof Error ? cause.message : String(cause) }) });
        }
      }

      const label = (currentPending ? t('pending') : t(active ? 'disable' : 'enable')) + (state?.inherited ? t('inherited') : '');
      return jsxs('div', {
        className: 'dsh-next',
        children: [
          jsx('button', {
            type: 'button', className: 'dsh-next__toggle', 'aria-label': label,
            'aria-pressed': active, 'aria-busy': currentPending !== null, title: label,
            disabled: currentPending !== null, onClick: () => { void toggle(); }, children: 'NEXT',
          }),
          currentError ? jsx('span', { role: 'alert', className: 'dsh-next__error', children: currentError }) : null,
        ],
      });
    }

    const exact = (value, t) => validNumber(value) ? String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : t('unknown');
    function metricRows(rows, t, attributes = {}) {
      return jsxs('dl', { className: 'dsh-next__metrics', ...attributes, children: rows.flatMap(([key, value]) => [
        jsx('dt', { children: t(key) }, `${key}-label`), jsx('dd', { children: value }, `${key}-value`),
      ]) });
    }

    const verificationStates = Object.freeze({ executed: 'verificationExecuted', reused: 'verificationReused', failed: 'verificationFailed', unknown: 'verificationUnknown', expired: 'verificationExpired' });
    function hasVerificationActivity(verification) {
      return verification !== undefined && verification !== null && (Object.keys(verificationStates).some((status) => validNumber(verification[status]) && verification[status] > 0)
        || (Array.isArray(verification.last) && verification.last.length > 0));
    }

    function hasAutomationBudgetActivity(automation) {
      return automation !== undefined && automation !== null && ['spentCny', 'reservedCny', 'unknownReservations'].some((key) => validNumber(automation[key]) && automation[key] > 0);
    }

    function AutomationBudgetSummary({ sessionId, useSessions, t }) {
      const automation = useSessions((store) => store.byId[sessionId]?.projectionValues?.nextAutomation);
      if (!hasAutomationBudgetActivity(automation)) return null;
      const money = (value) => validNumber(value) ? `¥ ${value.toFixed(4)}` : t('unknown');
      return jsxs('section', { className: 'dsh-next-budget', 'aria-label': t('automationBudgetTitle'), children: [
        jsx('h3', { children: t('automationBudgetTitle') }),
        metricRows([['automationSpent', money(automation.spentCny)], ['automationReserved', money(automation.reservedCny)],
          ['automationUnknown', exact(automation.unknownReservations, t)]], t, { 'data-next-automation-budget': true }),
        jsx('p', { className: 'dsh-next__note', children: t('automationBudgetScope') }),
      ] });
    }

    function VerificationSummary({ sessionId, useSessions, t }) {
      const verification = useSessions((store) => store.byId[sessionId]?.projectionValues?.nextAutomation?.verification);
      if (!hasVerificationActivity(verification)) return null;
      const recent = Array.isArray(verification.last) ? verification.last.slice(-3).reverse() : [];
      return jsxs('section', { className: 'dsh-next-verification', 'aria-label': t('verificationTitle'), children: [
        jsx('h3', { children: t('verificationTitle') }),
        metricRows(['executed', 'reused', 'failed', 'unknown'].map((status) => [verificationStates[status], exact(verification[status], t)]), t,
          { 'data-next-verification-counts': true }),
        recent.length > 0 ? jsxs('div', { children: [
          jsx('h4', { children: t('verificationRecent') }),
          jsx('ol', { className: 'dsh-next-verification__recent', children: recent.map((record, index) => {
            const status = Object.hasOwn(verificationStates, record?.status) ? record.status : 'unknown';
            const detail = typeof record?.detail === 'string' ? record.detail : '';
            return jsxs('li', { 'data-next-verification-status': status, children: [
              jsx('strong', { children: typeof record?.checkId === 'string' ? record.checkId : t('unknown') }),
              ` · ${t(verificationStates[status])}`,
              detail ? jsx('span', { className: 'dsh-next-verification__detail', children: detail.length > 180 ? `${detail.slice(0, 180)}…` : detail }) : null,
            ] }, `${record?.source?.sessionId ?? sessionId}:${record?.source?.callId ?? index}`);
          }) }),
        ] }) : null,
        jsx('p', { className: 'dsh-next__note', children: t('verificationHistory') }),
      ] });
    }

    function NextUsageDetails({ sessionId, useSessions, expandTokenDetails, t }) {
      const metrics = useSessions((store) => store.byId[sessionId]?.projectionValues?.nextMetrics);
      const number = (value) => exact(value, t);
      return jsxs('section', { className: 'dsh-next-usage__next', 'aria-label': t('statsTitle'), children: [
        jsxs('div', { className: 'dsh-next-usage__heading', children: [
          jsx('span', { children: t('statsTitle') }), jsx('span', { children: `${t('calls')} ${number(metrics?.calls)}` }),
        ] }),
        metricRows([
          ['elapsed', validNumber(metrics?.elapsedMs) ? `${(metrics.elapsedMs / 1000).toFixed(1)} s` : t('unknown')],
          ['cost', validNumber(metrics?.costCny) ? `¥ ${metrics.costCny.toFixed(4)}` : t('unknown')],
          ['dedup', number(metrics?.deduplicatedReads)],
        ], t),
        jsxs('details', { open: expandTokenDetails, children: [
          jsx('summary', { children: t('breakdown') }),
          metricRows([['uncached', number(metrics?.inputTokens)], ['cacheRead', number(metrics?.cacheReadTokens)],
            ['cacheWrite', number(metrics?.cacheWriteTokens)], ['output', number(metrics?.outputTokens)]], t),
          jsx('p', { className: 'dsh-next__note', children: t('scope') }),
          (metrics?.unknownUsageCalls > 0 || metrics?.unknownPriceCalls > 0) ? jsx('p', {
            className: 'dsh-next__note', children: t('missing', { usage: number(metrics?.unknownUsageCalls), price: number(metrics?.unknownPriceCalls) }),
          }) : null,
          jsx('p', { className: 'dsh-next__note', children: t('coverage') }),
          ...(Array.isArray(metrics?.warnings) ? metrics.warnings.filter((warning) => typeof warning === 'string').map((warning, index) => jsx('p', { className: 'dsh-next__note', children: warning }, `warning-${index}`)) : []),
        ] }),
        jsx(VerificationSummary, { sessionId, useSessions, t }),
        jsx(AutomationBudgetSummary, { sessionId, useSessions, t }),
      ] });
    }

    // The same usage cell and durable tokenUsage projection as the native pill.
    // Shadowing is disposable: removing NEXT immediately reveals the native entry.
    function UnifiedUsage({ sessionId, useSessions, useProjection, usePerformanceUsage, useNextSettings, t }) {
      const usage = useProjection('tokenUsage');
      const nextCalls = useSessions((store) => store.byId[sessionId]?.projectionValues?.nextMetrics?.calls ?? 0);
      const verificationActive = useSessions((store) => hasVerificationActivity(store.byId[sessionId]?.projectionValues?.nextAutomation?.verification));
      const automationBudgetActive = useSessions((store) => hasAutomationBudgetActivity(store.byId[sessionId]?.projectionValues?.nextAutomation));
      const mode = usePerformanceUsage((value) => value);
      const selection = useProjection('modelSelection');
      const route = selection?.next ?? selection?.lastUsed;
      const expandTokenDetails = useNextSettings((snapshot) => modelValues(snapshot.value, route).expandTokenDetails === true);
      const [openFor, setOpenFor] = useState(null);
      const open = openFor === sessionId;
      const rootRef = useRef(null);
      const panelRef = useRef(null);
      const setOpen = (value) => setOpenFor((previous) => (typeof value === 'function' ? value(previous === sessionId) : value) ? sessionId : null);
      const pos = useAnchoredPosition({ open, anchorRef: rootRef, panelRef, side: 'top', gap: 8, margin: 12 });
      useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);
      useEffect(() => {
        setOpenFor(null);
      }, [sessionId]);
      useEffect(() => {
        if (!open) return undefined;
        const keydown = (event) => { if (event.key === 'Escape') setOpenFor(null); };
        const click = (event) => {
          if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpenFor(null);
        };
        document.addEventListener('keydown', keydown);
        document.addEventListener('click', click, true);
        return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('click', click, true); };
      }, [open]);
      const known = usage && ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'].every((key) => validNumber(usage[key]));
      const input = known ? usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens : null;
      const total = known ? input + usage.outputTokens : null;
      // Keep a partial cache hit below 100%, matching the native display contract.
      let hit = null;
      if (input > 0) {
        const cached = BigInt(Math.round(usage.cacheReadTokens));
        const denominator = BigInt(Math.round(input));
        let scale = 1n;
        let units;
        do {
          units = (cached * 200n * scale + denominator) / (denominator * 2n);
          if (cached === denominator || units < 100n * scale) break;
          scale *= 10n;
        } while (scale <= 1000000000000000000n);
        const fraction = scale === 1n ? '' : String(units % scale).padStart(String(scale).length - 1, '0').replace(/0+$/, '');
        hit = `${units / scale}${fraction ? `.${fraction}` : ''}%`;
      }
      const compact = total === null ? t('unknown') : total < 1000 ? String(total) : total < 1e6 ? `${Number((total / 1000).toFixed(1))}K` : `${Number((total / 1e6).toFixed(1))}M`;
      const label = mode === 'compact' && hit !== null ? `${t('cacheHit')} ${hit}` : `${compact} tok${hit === null ? '' : ` · ${t('cacheHit')} ${hit}`}`;
      const icon = jsx(IconDatabaseOutlineRegular, {});
      if ((!known || total === 0) && nextCalls === 0 && !verificationActive && !automationBudgetActive) return null;
      const rows = [
        ...(hit === null ? [] : [['cacheHit', hit]]),
        ['uncached', `${exact(usage?.uncachedInputTokens, t)} tok`],
        ['nativeCacheRead', `${exact(usage?.cacheReadTokens, t)} tok`],
        ...(usage?.cacheWriteTokens ? [['nativeCacheWrite', `${exact(usage.cacheWriteTokens, t)} tok`]] : []),
        ['nativeOutput', `${exact(usage?.outputTokens, t)} tok`],
      ];
      return jsxs('span', { ref: rootRef, className: 'dsh-next-usage', 'data-composer-stat': 'usage', children: [
        jsxs('button', { type: 'button', className: 'dsh-next-usage__trigger', 'aria-haspopup': 'dialog', 'aria-expanded': open,
          'aria-label': `${t('stats')} · ${label}`, onClick: () => setOpen(!open), children: [icon, jsx('span', { children: label })] }),
        open ? createPortal(jsxs('div', { ref: panelRef, role: 'dialog', 'aria-label': t('stats'), className: 'dsh-next-usage__panel',
          style: pos ?? { visibility: 'hidden', left: 0, top: 0 }, children: [
            jsxs('div', { className: 'dsh-next-usage__heading', children: [jsxs('span', { children: [icon, t('stats')] }), jsx('span', { children: `${exact(total, t)} tok` })] }),
            jsx('div', { className: 'dsh-next-usage__rule', 'aria-hidden': true }),
            metricRows(rows, t, { 'data-session-stats-usage': true }),
            jsx(NextUsageDetails, { sessionId, useSessions, expandTokenDetails, t }, sessionId),
          ] }), document.body) : null,
      ] });
    }

    function NextSettings({ useNextSettings, setPreference, mutatePreferences, resetPreferences, loadModelCatalog, loadProduction, scanProjectChecks, t }) {
      const snapshot = useNextSettings((value) => value);
      const [view, setView] = useState({ kind: 'models' });
      const [catalog, setCatalog] = useState({ phase: 'loading', groups: [], failures: [] });
      const [revision, setRevision] = useState(0);
      const [search, setSearch] = useState('');
      const [newTagName, setNewTagName] = useState('');
      const [status, setStatus] = useState(null);
      const [production, setProduction] = useState({ phase: 'idle', value: null });
      const [productionRevision, setProductionRevision] = useState(0);
      const [workspace, setWorkspace] = useState('');
      const [scan, setScan] = useState({ phase: 'idle', candidates: [] });
      const [artifact, setArtifact] = useState({ id: '', file: '', format: 'json', columns: '', text: '' });
      const [priceDraft, setPriceDraft] = useState({ provider: '', model: '', input: '', cacheRead: '', cacheWrite: '', output: '', expiry: '' });
      const [productionError, setProductionError] = useState('');
      const operation = useRef(null);
      const scanOperation = useRef(null);
      const lastAction = useRef(null);
      const latestSettings = useRef(snapshot.value);
      latestSettings.current = snapshot.value;
      useEffect(() => () => { operation.current = null; scanOperation.current = null; lastAction.current = null; }, []);
      useEffect(() => {
        if (view.kind !== 'production') return undefined;
        let live = true;
        setProduction((current) => ({ ...current, phase: 'loading' }));
        Promise.resolve().then(() => loadProduction?.({})).then((result) => {
          if (!live) return;
          if (result?.ok !== true || !result.value?.capabilities) throw new Error('unavailable');
          setProduction({ phase: 'ready', value: result.value });
          setWorkspace((current) => current || result.value.workspace || '');
          setPriceDraft((current) => ({ ...current,
            provider: current.provider || result.value.route?.provider || '',
            model: current.model || result.value.route?.model || '',
            expiry: current.expiry || latestSettings.current?.automationPricesValidUntil || '',
          }));
        }).catch(() => { if (live) setProduction((current) => ({ ...current, phase: 'failed' })); });
        return () => { live = false; scanOperation.current = null; };
      }, [view.kind, loadProduction, productionRevision]);
      useEffect(() => {
        let live = true;
        setCatalog((current) => ({ ...current, phase: 'loading' }));
        Promise.resolve().then(() => loadModelCatalog()).then((result) => {
          if (!live) return;
          if (result?.ok !== true || !Array.isArray(result.value?.groups)) throw new Error('catalog unavailable');
          setCatalog({ phase: 'ready', groups: result.value.groups, failures: result.value.failures ?? [] });
        }).catch(() => { if (live) setCatalog((current) => ({ ...current, phase: 'failed' })); });
        return () => { live = false; };
      }, [loadModelCatalog, revision]);
      useEffect(() => {
        if (status?.phase !== 'saved') return undefined;
        const timer = window.setTimeout(() => setStatus((current) => current === status ? null : current), 2500);
        return () => window.clearTimeout(timer);
      }, [status]);
      const pending = status?.phase === 'saving';
      const ready = snapshot.status === 'ready' && snapshot.value !== undefined && snapshot.writable &&
        (view.kind !== 'tag' || tagsOf(snapshot.value).some((item) => item.id === view.id));
      const disabled = !ready || pending;
      const settings = snapshot.value;
      const tags = tagsOf(settings);
      const profiles = profilesOf(settings);
      const route = view.kind === 'model' ? modelSettingRoute(view.route) : null;
      const selection = profileSelection(settings, route);
      const profile = selection.profile;
      const tag = view.kind === 'tag' ? tags.find((item) => item.id === view.id) : null;
      const values = tag ? { ...modelValues(settings), ...tag.preferences } : modelValues(settings, route, true);
      const tagName = (item) => {
        const key = { economy: 'economyTag', code: 'codeTag', detailed: 'detailedTag' }[item?.id];
        const initial = defaultTags.find((entry) => entry.id === item?.id);
        return key && item?.name === initial?.name ? t(key) : item?.name ?? '';
      };
      function navigate(next) { if (!pending) { setView(next); setStatus(null); setProductionError(''); lastAction.current = null; } }
      function saveProfile(next) {
        return setPreference('modelProfiles', profilesWithPolicy(latestSettings.current, next));
      }
      function currentProfile() {
        const { profile: current } = profileSelection(latestSettings.current, route);
        return { provider: route.provider, model: route.model, tags: [...(current?.tags ?? [])], overrides: { ...current?.overrides } };
      }
      function writeField(field, value, remove = false) {
        if (route) {
          const next = currentProfile();
          if (remove) delete next.overrides[field]; else next.overrides[field] = value;
          return saveProfile(next);
        }
        if (tag) {
          const currentTags = tagsOf(latestSettings.current);
          const currentTag = currentTags.find((item) => item.id === tag.id);
          if (!currentTag) return Promise.resolve(false);
          const preferences = { ...currentTag.preferences };
          if (remove) delete preferences[field]; else preferences[field] = value;
          return setPreference('optimizationTags', currentTags.map((item) => item.id === tag.id ? { ...item, preferences } : item));
        }
        return setPreference(field, value);
      }
      async function update(field, action) {
        if (!ready || operation.current) return;
        const token = {};
        operation.current = token;
        lastAction.current = { field, action };
        setStatus({ field, phase: 'saving' });
        try {
          if (await action() !== true) throw new Error('rejected');
          if (operation.current === token) {
            setStatus({ field, phase: 'saved' });
            if (view.kind === 'production') setProductionRevision((current) => current + 1);
          }
        } catch {
          if (operation.current === token) setStatus({ field, phase: 'saveFailed' });
        } finally {
          if (operation.current === token) operation.current = null;
        }
      }
      function feedback(field) {
        if (status?.field !== field) return null;
        const failed = status.phase === 'saveFailed';
        return jsxs('div', { id: `next-${field}-status`, className: 'dsh-next-settings__status',
          'data-next-feedback': field, role: failed ? 'alert' : 'status', 'aria-live': failed ? 'assertive' : 'polite', children: [
            jsx('span', { children: t(status.phase) }),
            failed ? jsx('button', { type: 'button', disabled: !ready, 'data-next-retry': field,
              onClick: () => { const retry = lastAction.current; if (retry?.field === field) void update(field, retry.action); }, children: t('retrySave') }) : null,
          ],
        });
      }
      function row(field, control) {
        const own = route ? Object.hasOwn(profile?.overrides ?? {}, field) : tag ? Object.hasOwn(tag.preferences ?? {}, field) : false;
        const source = route && !own ? [...(profile?.tags ?? [])].reverse().map((id) => tags.find((item) => item.id === id)).find((item) => Object.hasOwn(item?.preferences ?? {}, field)) : null;
        return jsxs('div', { className: 'dsh-next-settings__field', children: [
          jsxs('label', { className: 'dsh-next-settings__row', children: [
            jsxs('span', { className: 'dsh-next-settings__copy', children: [jsx('span', { children: t(field) }),
              jsx('span', { id: `next-${field}-help`, className: 'dsh-next-settings__help', children: t(`${field}Help`) })] }),
            control,
          ] }),
          route || tag ? jsxs('div', { className: 'dsh-next-settings__source', children: [
            jsx('span', { children: own ? t(route ? 'customValue' : 'editTag') : source ? t('tagValue', { name: tagName(source) }) : t('inheritedValue') }),
            own ? jsx('button', { type: 'button', disabled, 'data-next-clear': field,
              onClick: () => void update(field, () => writeField(field, undefined, true)), children: t(route ? 'clearOverride' : 'clearTagValue') }) : null,
          ] }) : null,
          feedback(field),
        ] }, field);
      }
      function select(field, options, { dependency, numeric = false, defaultValue = options[0][0] } = {}) {
        const fieldDisabled = disabled || (dependency !== undefined && values?.[dependency] !== true);
        return row(field, jsx('select', { 'aria-label': t(field), 'aria-describedby': `next-${field}-help`,
          'data-next-setting': field, value: values?.[field] ?? defaultValue, disabled: fieldDisabled,
          onChange: (event) => {
            if (fieldDisabled) return;
            const value = numeric ? Number(event.target.value) : event.target.value;
            if (numeric && (event.target.value === '' || !validNumber(value) || value > 3)) return;
            void update(field, () => writeField(field, value));
          },
          children: options.map(([value, label]) => jsx('option', { value, children: label }, value)),
        }));
      }
      function checkbox(field, dependency) {
        const fieldDisabled = disabled || (dependency !== undefined && values?.[dependency] !== true);
        return row(field, jsx('input', { type: 'checkbox', role: 'switch', 'aria-label': t(field),
          'aria-describedby': `next-${field}-help`, 'data-next-setting': field, checked: values?.[field] === true, disabled: fieldDisabled,
          onChange: (event) => { if (fieldDisabled) return; const value = event.target.checked; void update(field, () => writeField(field, value)); },
        }));
      }
      const budgetOptions = [1, 2, 3].map((amount) => [amount, t('budgetAmount', { amount })]);
      const currentBudget = values?.automationBudgetCny;
      if (validNumber(currentBudget) && currentBudget <= 3 && ![1, 2, 3].includes(currentBudget)) {
        budgetOptions.unshift([currentBudget, t('budgetCustom', { amount: currentBudget })]);
      }
      const availableModels = modelCatalogEntries(catalog.groups, profiles, t('officialDeepSeek'));
      const selectedModel = route && availableModels.get(routeKey(route));
      const visibleModels = [...availableModels.values()].filter((item) => `${item.providerName} ${item.searchText}`.toLowerCase().includes(search.toLowerCase()));
      const tagCreation = jsxs('div', { children: [
        jsx('input', { type: 'text', maxLength: 64, disabled, value: newTagName, 'aria-label': t('tagName'), placeholder: t('newTag'), 'data-next-tag-name': true, onChange: (event) => setNewTagName(event.target.value) }),
        jsxs('div', { className: 'dsh-next-settings__toolbar', children: [
          jsx('button', { type: 'button', disabled: disabled || !newTagName.trim() || tags.length >= 100 || (profile?.tags.length ?? 0) >= 64, 'data-next-action': 'create-tag', onClick: () => {
            const name = newTagName.trim();
            if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name) || disabled || tags.length >= 100 || (profile?.tags.length ?? 0) >= 64) return;
            const id = `tag-${Date.now().toString(36)}-${tags.length}`;
            void update('createTag', async () => {
              const currentTags = tagsOf(latestSettings.current);
              const nextTags = currentTags.some((item) => item.id === id) ? currentTags : [...currentTags, { id, name, preferences: {} }];
              const ops = [{ op: 'set', path: ['optimizationTags'], value: nextTags }];
              if (route) {
                const next = currentProfile(); if (!next.tags.includes(id)) next.tags.push(id);
                ops.push({ op: 'set', path: ['modelProfiles'], value: profilesWithPolicy(latestSettings.current, next) });
              }
              const saved = await mutatePreferences(ops);
              if (saved === true && operation.current) { setNewTagName(''); setView({ kind: 'tag', id, ...(route ? { returnRoute: route } : {}) }); }
              return saved;
            });
          }, children: t('createTag') }), feedback('createTag'),
        ] }),
      ] });
      const projectKey = (path) => {
        const normalized = String(path ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
        return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
      };
      const checkKey = (check) => JSON.stringify([projectKey(check.workspace), check.id]);
      const checksOf = (value) => Array.isArray(value?.verificationChecks) ? value.verificationChecks : [];
      const pricesOf = (value) => Array.isArray(value?.prices) ? value.prices : [];
      const cleanText = (value) => typeof value === 'string' && value.trim() !== '' && !/[\u0000-\u001f\u007f]/.test(value);
      const productionField = (key, label, value, onChange, extra = {}) => jsxs('label', { className: 'dsh-next-settings__production-label', children: [
        jsx('span', { children: t(label) }), jsx('input', { type: 'text', disabled, maxLength: 2048, value, 'data-next-production-field': key,
          onChange: (event) => { if (!disabled) onChange(event.target.value); }, ...extra }),
      ] }, key);
      async function scanChecks() {
        if (disabled || !workspace.trim() || scanOperation.current) return;
        const token = {};
        const requestedWorkspace = workspace.trim();
        scanOperation.current = token;
        setScan({ phase: 'loading', candidates: [] });
        try {
          const result = await scanProjectChecks?.({ workspace: requestedWorkspace, ...(production.value?.sessionId ? { sessionId: production.value.sessionId } : {}) });
          if (scanOperation.current !== token) return;
          if (result?.ok !== true || !Array.isArray(result.value?.candidates) || projectKey(result.value.workspace) !== projectKey(requestedWorkspace)) throw new Error('scan unavailable');
          setScan({ phase: 'ready', workspace: result.value.workspace, candidates: result.value.candidates.filter((item) => item?.check?.kind === 'command' &&
            item.check.id && item.check.command && Array.isArray(item.check.bindings) && item.check.bindings.length > 0 && projectKey(item.check.workspace) === projectKey(requestedWorkspace)) });
        } catch { if (scanOperation.current === token) setScan({ phase: 'failed', candidates: [] }); }
        finally { if (scanOperation.current === token) scanOperation.current = null; }
      }
      function registerCheck(check) {
        if (disabled) return;
        setProductionError('');
        void update('verificationChecks', () => {
          const previous = checksOf(latestSettings.current);
          const next = previous.filter((item) => checkKey(item) !== checkKey(check));
          next.push(check);
          return setPreference('verificationChecks', next);
        });
      }
      function registerArtifact() {
        if (disabled) return;
        const columns = artifact.columns.split(',').map((item) => item.trim()).filter(Boolean);
        const requiredText = artifact.text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
        const file = artifact.file.trim();
        if (![artifact.id, workspace, file].every(cleanText) || /^(?:[a-z]:|[\\/])/i.test(file) || file.split(/[\\/]/).includes('..') ||
            !['csv', 'json', 'markdown'].includes(artifact.format) || new Set(columns).size !== columns.length || new Set(requiredText).size !== requiredText.length) {
          setProductionError('artifactInvalid'); return;
        }
        registerCheck({ id: artifact.id.trim(), workspace: workspace.trim(), kind: 'artifact', file, format: artifact.format,
          ...(artifact.format === 'csv' && columns.length ? { requiredColumns: columns } : {}), ...(requiredText.length ? { requiredText } : {}) });
      }
      function savePrice() {
        if (disabled) return;
        const rates = ['input', 'cacheRead', 'cacheWrite', 'output'];
        const expiry = priceDraft.expiry.trim();
        if (![priceDraft.provider, priceDraft.model].every(cleanText) || !rates.every((key) => /^\d+(?:\.\d+)?$/.test(priceDraft[key].trim()) && Number.isFinite(Number(priceDraft[key]))) ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(expiry) || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now() ||
            new Date(`${expiry.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== expiry.slice(0, 10)) {
          setProductionError('priceInvalid'); return;
        }
        setProductionError('');
        const next = { provider: priceDraft.provider.trim(), model: priceDraft.model.trim(), ...Object.fromEntries(rates.map((key) => [key, priceDraft[key].trim()])) };
        void update('prices', () => mutatePreferences([
          { op: 'set', path: ['prices'], value: [...pricesOf(latestSettings.current).filter((item) => routeKey(item) !== routeKey(next)), next] },
          { op: 'set', path: ['automationPricesValidUntil'], value: expiry },
        ]));
      }
      function renderCheck(check, candidate) {
        const registration = production.value?.checks?.find((item) => item.id === check.id && projectKey(item.workspace ?? production.value.workspace) === projectKey(check.workspace));
        return jsxs('article', { className: 'dsh-next-settings__check', 'data-next-check': checkKey(check), children: [
          jsx('strong', { children: candidate?.label || check.id }),
          jsx('p', { className: 'dsh-next-settings__help', children: `${check.workspace} · ${check.kind}` }),
          check.kind === 'command' ? jsxs('div', { children: [jsx('pre', { children: check.command }),
            jsx('p', { className: 'dsh-next-settings__help', children: t('commandTimeout', { seconds: Number(check.timeoutMs) / 1000 }) }),
            jsx('p', { className: 'dsh-next-settings__help', children: `${t('checkBindings')}: ${(check.bindings ?? []).map((item) => `${item.file} · ${item.sha256}`).join('\n')}` }),
          ] }) : jsx('pre', { children: JSON.stringify(check, null, 2), 'aria-label': t('checkDefinition') }),
          registration?.reason ? jsx('p', { className: 'dsh-next-settings__help', children: `${t('registeredState')}: ${registration.reason}` }) : null,
          candidate ? jsx('button', { type: 'button', disabled: disabled || scan.phase !== 'ready' || projectKey(workspace) !== projectKey(scan.workspace),
            'data-next-register-check': candidate.id, onClick: () => { if (!disabled && scan.phase === 'ready' && projectKey(workspace) === projectKey(scan.workspace)) registerCheck(check); }, children: t('registerCheck') }) :
            jsx('button', { type: 'button', disabled, 'data-next-remove-check': checkKey(check), onClick: () => { if (!disabled) void update('verificationChecks', () => setPreference('verificationChecks', checksOf(latestSettings.current).filter((item) => checkKey(item) !== checkKey(check)))); }, children: t('removeCheck') }),
        ] }, `${candidate ? 'candidate' : 'registered'}-${checkKey(check)}`);
      }
      const actualRoutes = catalog.groups.flatMap((group) => (group.models ?? []).map((item) => ({ provider: group.id, model: item.id })));
      const productionPage = jsxs('div', { 'data-next-page': 'production', children: [
        jsxs('div', { className: 'dsh-next-settings__toolbar', children: [
          jsx('button', { type: 'button', disabled: pending, 'data-next-action': 'models', onClick: () => navigate({ kind: 'models' }), children: t('backModels') }),
          jsx('button', { type: 'button', disabled: pending || production.phase === 'loading', 'data-next-action': 'production-refresh', onClick: () => setProductionRevision((current) => current + 1), children: t('productionRefresh') }),
        ] }),
        jsx('h3', { children: t('production') }), jsx('p', { className: 'dsh-next-settings__help', children: t('productionHelp') }),
        production.phase === 'loading' ? jsx('p', { role: 'status', children: t('productionLoading') }) : null,
        production.phase === 'failed' ? jsx('p', { role: 'alert', children: t('productionUnavailable') }) : null,
        production.value?.route ? jsx('p', { className: 'dsh-next-settings__help', children: `${t('currentRoute')}: ${production.value.route.provider} / ${production.value.route.model}` }) : null,
        jsx('ul', { className: 'dsh-next-settings__capabilities', children: ['optimization', 'verification', 'retrieval', 'parallel'].map((key) => {
          const capability = production.phase === 'ready' ? production.value?.capabilities?.[key] : null;
          const state = ['ready', 'off', 'blocked', 'unknown'].includes(capability?.status) ? capability.status : 'unknown';
          return jsxs('li', { 'data-next-capability': key, children: [jsx('strong', { children: `${t(`capability${key[0].toUpperCase()}${key.slice(1)}`)} · ${t(`capability${state[0].toUpperCase()}${state.slice(1)}`)}` }),
            jsx('div', { className: 'dsh-next-settings__help', children: capability?.reason || t('noCurrentSession') })] }, key);
        }) }),
        jsx('h3', { children: t('verificationRegistration') }),
        productionField('workspace', 'workspace', workspace, (value) => { scanOperation.current = null; setScan({ phase: 'idle', candidates: [] }); setWorkspace(value); }),
        jsx('p', { className: 'dsh-next-settings__help', children: t('scanHelp') }),
        jsx('button', { type: 'button', disabled: disabled || !workspace.trim() || scan.phase === 'loading', 'data-next-action': 'scan-checks', onClick: () => void scanChecks(), children: t('scanChecks') }),
        scan.phase === 'loading' ? jsx('p', { role: 'status', children: t('scanLoading') }) : null,
        scan.phase === 'failed' ? jsx('p', { role: 'alert', children: t('scanFailed') }) : null,
        scan.phase === 'ready' && !scan.candidates.length ? jsx('p', { role: 'status', children: t('scanEmpty') }) : null,
        scan.candidates.map((candidate) => renderCheck(candidate.check, candidate)),
        jsx('h3', { children: t('registeredChecks') }),
        !checksOf(settings).length ? jsx('p', { className: 'dsh-next-settings__help', children: t('noChecks') }) : null,
        checksOf(settings).map((check) => renderCheck(check)), feedback('verificationChecks'),
        jsx('h3', { children: t('artifactCheck') }),
        jsx('div', { className: 'dsh-next-settings__production-grid', children: [
          productionField('artifact-id', 'checkId', artifact.id, (value) => setArtifact((current) => ({ ...current, id: value }))),
          productionField('artifact-file', 'artifactFile', artifact.file, (value) => setArtifact((current) => ({ ...current, file: value }))),
        ] }),
        jsxs('label', { className: 'dsh-next-settings__production-label', children: [jsx('span', { children: t('artifactFormat') }), jsx('select', { disabled, 'data-next-production-field': 'artifact-format', value: artifact.format,
          onChange: (event) => { if (!disabled) setArtifact((current) => ({ ...current, format: event.target.value })); }, children: [['json', 'JSON'], ['csv', 'CSV'], ['markdown', 'Markdown']].map(([value, label]) => jsx('option', { value, children: label }, value)) })] }),
        artifact.format === 'csv' ? productionField('artifact-columns', 'artifactColumns', artifact.columns, (value) => setArtifact((current) => ({ ...current, columns: value }))) : null,
        jsxs('label', { className: 'dsh-next-settings__production-label', children: [jsx('span', { children: t('artifactText') }), jsx('textarea', { disabled, value: artifact.text, maxLength: 16384, 'data-next-production-field': 'artifact-text',
          onChange: (event) => { if (!disabled) setArtifact((current) => ({ ...current, text: event.target.value })); } })] }),
        jsx('button', { type: 'button', disabled, 'data-next-action': 'register-artifact', onClick: registerArtifact, children: t('registerArtifact') }),
        jsx('h3', { children: t('routePrices') }), jsx('p', { className: 'dsh-next-settings__help', children: t('priceHelp') }),
        !pricesOf(settings).length ? jsx('p', { className: 'dsh-next-settings__help', children: t('noPrices') }) : null,
        pricesOf(settings).map((price) => jsxs('article', { className: 'dsh-next-settings__check', children: [
          jsx('strong', { children: `${price.provider} / ${price.model}` }), jsx('pre', { children: ['input', 'cacheRead', 'cacheWrite', 'output'].map((key) => `${t(`price${key[0].toUpperCase()}${key.slice(1)}`)}: ${price[key] ?? t('unknown')}`).join('\n') }),
          jsxs('div', { className: 'dsh-next-settings__toolbar', children: [jsx('button', { type: 'button', disabled, 'data-next-edit-price': routeKey(price), onClick: () => { if (!disabled) setPriceDraft({ provider: price.provider, model: price.model, ...Object.fromEntries(['input', 'cacheRead', 'cacheWrite', 'output'].map((key) => [key, price[key] == null ? '' : String(price[key])])), expiry: latestSettings.current?.automationPricesValidUntil || '' }); }, children: t('editPrice') }),
            jsx('button', { type: 'button', disabled, 'data-next-remove-price': routeKey(price), onClick: () => { if (!disabled) void update('prices', () => setPreference('prices', pricesOf(latestSettings.current).filter((item) => routeKey(item) !== routeKey(price)))); }, children: t('removePrice') })] }),
        ] }, routeKey(price))),
        jsx('select', { 'aria-label': t('choosePriceRoute'), 'data-next-price-route': true, value: '', disabled, onChange: (event) => {
          if (disabled) return; const selected = actualRoutes.find((item) => routeKey(item) === event.target.value); if (selected) setPriceDraft((current) => ({ ...current, ...selected, input: '', cacheRead: '', cacheWrite: '', output: '' }));
        }, children: [jsx('option', { value: '', children: t('choosePriceRoute') }, 'placeholder'), ...actualRoutes.map((item) => jsx('option', { value: routeKey(item), children: `${item.provider} / ${item.model}` }, routeKey(item)))] }),
        jsx('div', { className: 'dsh-next-settings__production-grid', children: ['provider', 'model', 'input', 'cacheRead', 'cacheWrite', 'output'].map((key) => productionField(`price-${key}`, `price${key[0].toUpperCase()}${key.slice(1)}`, priceDraft[key], (value) => setPriceDraft((current) => ({ ...current, [key]: value })), ['input', 'cacheRead', 'cacheWrite', 'output'].includes(key) ? { inputMode: 'decimal' } : {})) }),
        productionField('price-expiry', 'priceExpiry', priceDraft.expiry, (value) => setPriceDraft((current) => ({ ...current, expiry: value })), { placeholder: '2026-12-31T00:00:00Z' }),
        jsx('p', { className: 'dsh-next-settings__help', children: t('priceExpiryHelp') }),
        jsx('button', { type: 'button', disabled, 'data-next-action': 'save-price', onClick: savePrice, children: t('savePrice') }), feedback('prices'),
        productionError ? jsx('p', { role: 'alert', 'data-next-production-error': true, children: t(productionError) }) : null,
      ] });
      const modelList = jsxs('div', { 'data-next-page': 'models', children: [
        jsxs('div', { className: 'dsh-next-settings__toolbar', children: [
          jsx('button', { type: 'button', disabled, 'data-next-action': 'defaults', onClick: () => navigate({ kind: 'defaults' }), children: t('defaults') }),
          jsx('button', { type: 'button', disabled: pending, 'data-next-action': 'production', onClick: () => navigate({ kind: 'production' }), children: t('production') }),
          jsx('button', { type: 'button', disabled: pending || catalog.phase === 'loading', 'data-next-action': 'refresh', onClick: () => setRevision((value) => value + 1), children: t('refreshModels') }),
        ] }),
        jsx('p', { className: 'dsh-next-settings__help', children: t('defaultsHelp') }),
        jsx('input', { type: 'search', 'aria-label': t('modelSearch'), placeholder: t('modelSearch'), value: search, onChange: (event) => setSearch(event.target.value) }),
        catalog.phase === 'loading' ? jsx('p', { role: 'status', children: t('catalogLoading') }) : null,
        catalog.phase === 'failed' || catalog.failures.length ? jsx('p', { role: 'alert', children: t('catalogFailed') }) : null,
        !availableModels.size && catalog.phase === 'ready' ? jsx('p', { children: t('catalogEmpty') }) : null,
        availableModels.size && !visibleModels.length ? jsx('p', { children: t('noModels') }) : null,
        jsx('div', { className: 'dsh-next-settings__models', children: visibleModels.map((item) => {
          const assigned = profileSelection(settings, item).profile?.tags ?? [];
          return jsxs('button', { type: 'button', disabled, 'data-next-model': routeKey(item), 'data-next-official-model': item.official || undefined, onClick: () => navigate({ kind: 'model', route: { provider: item.provider, model: item.model } }), children: [
            jsx('strong', { children: item.name }), jsx('span', { children: `${item.providerName} · ${item.model}` }),
            jsx('small', { children: assigned.length ? assigned.map((id) => tagName(tags.find((entry) => entry.id === id)) || id).join(' · ') : t('noTags') }),
            !item.available ? jsx('small', { children: t('savedModel') }) : null,
          ] }, routeKey(item));
        }) }),
        jsx('h3', { children: t('tagsTitle') }), jsx('p', { className: 'dsh-next-settings__help', children: t('tagsHelp') }),
        jsx('div', { className: 'dsh-next-settings__toolbar', children: tags.map((item) => jsx('button', { type: 'button', disabled, 'data-next-tag-edit': item.id,
          onClick: () => navigate({ kind: 'tag', id: item.id }), children: tagName(item) }, item.id)) }),
        tagCreation,
      ] });
      const modelTags = route ? jsxs('div', { children: [
        jsx('h3', { children: t('tagsTitle') }), jsx('p', { className: 'dsh-next-settings__help', children: t('orderHelp') }),
        jsx('ol', { className: 'dsh-next-settings__tags', children: (profile?.tags ?? []).map((id, index) => {
          const item = tags.find((entry) => entry.id === id);
          const changeTags = (action) => { void update('modelTags', () => { const next = currentProfile(); const currentIndex = next.tags.indexOf(id); if (currentIndex < 0) return Promise.resolve(true); action(next.tags, currentIndex); return saveProfile(next); }); };
          return jsxs('li', { children: [
            jsx('span', { children: tagName(item) || id }),
            jsx('button', { type: 'button', disabled: disabled || index === 0, 'aria-label': `${t('moveUp')}: ${tagName(item)}`, 'data-next-tag-up': id,
              onClick: () => changeTags((ids, at) => { if (at > 0) [ids[at - 1], ids[at]] = [ids[at], ids[at - 1]]; }), children: '↑' }),
            jsx('button', { type: 'button', disabled: disabled || index === (profile?.tags.length ?? 0) - 1, 'aria-label': `${t('moveDown')}: ${tagName(item)}`, 'data-next-tag-down': id,
              onClick: () => changeTags((ids, at) => { if (at < ids.length - 1) [ids[at], ids[at + 1]] = [ids[at + 1], ids[at]]; }), children: '↓' }),
            item ? jsx('button', { type: 'button', disabled, 'data-next-tag-edit': id, onClick: () => navigate({ kind: 'tag', id, returnRoute: route }), children: t('editTag') }) : null,
            jsx('button', { type: 'button', disabled, 'data-next-tag-remove': id, 'aria-label': `${t('removeTag')}: ${tagName(item)}`, onClick: () => changeTags((ids, at) => ids.splice(at, 1)), children: t('removeTag') }),
          ] }, id);
        }) }),
        !(profile?.tags.length) ? jsx('p', { className: 'dsh-next-settings__help', children: t('noTags') }) : null,
        jsx('select', { disabled: disabled || (profile?.tags.length ?? 0) >= 64, value: '', 'aria-label': t('addTag'), 'data-next-add-tag': true, onChange: (event) => {
          const id = event.target.value;
          if (disabled || (profile?.tags.length ?? 0) >= 64 || !tags.some((item) => item.id === id) || profile?.tags.includes(id)) return;
          void update('modelTags', () => { const next = currentProfile(); if (!next.tags.includes(id)) next.tags.push(id); return saveProfile(next); });
        }, children: [jsx('option', { value: '', children: t('addTag') }, 'placeholder'), ...tags.filter((item) => !profile?.tags.includes(item.id)).map((item) => jsx('option', { value: item.id, children: tagName(item) }, item.id))] }),
        feedback('modelTags'),
        tagCreation,
      ] }) : null;
      return jsxs('section', { className: 'dsh-next-settings', 'aria-label': t('settingsTitle'), children: [
        jsx('h2', { children: t('settingsTitle') }),
        jsx('p', { className: 'dsh-next-settings__scope', children: t('settingsScope') }),
        jsx('p', { className: 'dsh-next-settings__intro', children: t('settingsIntro') }),
        !ready ? jsx('p', { role: 'status', children: t(snapshot.status === 'loading' ? 'settingsLoading' : 'settingsUnavailable') }) : null,
        view.kind === 'models' ? modelList : view.kind === 'production' ? productionPage : jsxs('div', { 'data-next-page': view.kind, children: [
        jsxs('div', { className: 'dsh-next-settings__toolbar', children: [
          jsx('button', { type: 'button', disabled: pending, 'data-next-action': 'models', onClick: () => navigate({ kind: 'models' }), children: t('backModels') }),
          view.returnRoute ? jsx('button', { type: 'button', disabled: pending, 'data-next-action': 'back-model', onClick: () => navigate({ kind: 'model', route: view.returnRoute }), children: t('backModel') }) : null,
        ] }),
        jsx('h3', { children: route ? isOfficialRoute(route) ? `${selectedModel?.name ?? route.model} · ${t('officialDeepSeek')}` : `${route.model} · ${route.provider}` : tag ? tagName(tag) : t('defaults') }),
        jsx('p', { className: 'dsh-next-settings__help', children: t(route ? isOfficialRoute(route) ? 'officialModelHelp' : 'modelHelp' : tag ? 'tagPolicyHelp' : 'defaultsHelp') }),
        route && selection.conflict ? jsx('p', { role: 'status', className: 'dsh-next-settings__help', 'data-next-policy-conflict': true,
          children: t('officialPolicyConflict', { source: t(profile?.provider === officialProviders[0] ? 'officialAccount' : 'officialApi') }) }) : null,
        tag ? jsx('p', { className: 'dsh-next-settings__help', children: t('tagsHelp') }) : null,
        tag && !Object.keys(tag.preferences).length ? jsx('p', { role: 'status', children: t('tagEmpty') }) : null,
        modelTags,
        select('outputLanguage', [['auto', t('autoLanguage')], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어']]),
        select('responseStyle', [['standard', t('standard')], ['concise', t('concise')], ['detailed', t('detailed')]]),
        checkbox('deduplicateReads'), checkbox('efficiencyGuidance'),
        jsxs('div', { className: 'dsh-next-settings__subgroup', role: 'group', 'aria-label': t('efficiencyGuidance'), children: [
          checkbox('methodGuidance', 'efficiencyGuidance'), checkbox('targetedVerification', 'efficiencyGuidance'), checkbox('benefitBasedParallelism', 'efficiencyGuidance'),
        ] }),
        checkbox('automationEnabled'),
        jsxs('div', { className: 'dsh-next-settings__subgroup', role: 'group', 'aria-label': t('automationEnabled'), children: [
          checkbox('automationVerification', 'automationEnabled'),
          checkbox('automationParallelism', 'automationEnabled'),
          select('automationBudgetCny', budgetOptions, { dependency: 'automationEnabled', numeric: true, defaultValue: 3 }),
          jsxs('section', { className: 'dsh-next-settings__registration', 'aria-label': t('verificationRegistration'), children: [
            jsx('h3', { children: t('verificationRegistration') }),
            jsx('p', { className: 'dsh-next-settings__help', children: t('verificationRegistrationHelp') }),
          ] }),
        ] }),
        checkbox('expandTokenDetails'),
        jsxs('div', { className: 'dsh-next-settings__footer', children: [jsx('span', { children: t('settingsFooter') }),
          jsxs('div', { children: [
            jsx('button', { type: 'button', disabled, 'data-next-action': 'reset', onClick: () => { void update('resetSettings', () => route ? saveProfile({ ...currentProfile(), tags: [], overrides: {} }) : tag ? setPreference('optimizationTags', tagsOf(latestSettings.current).map((item) => item.id === tag.id ? { ...item, preferences: {} } : item)) : resetPreferences()); }, children: t(route ? 'modelReset' : tag ? 'tagReset' : 'resetSettings') }),
            feedback('resetSettings'),
          ] }),
        ] }),
        ] }),
      ] });
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'next: dictionaries');
      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = '@local/dsh-next';
        style.textContent = css;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'next: composer styles');
      const settings = ctx.configForms.get('dsh-next');
      const loadModelCatalog = () => ctx.remote.session.modelCatalog();
      let productionMount = Promise.resolve();
      ctx.effect(() => {
        if (typeof ctx.remote.$mount !== 'function') return undefined;
        productionMount = Promise.resolve().then(() => ctx.remote.$mount({ package: '@local/dsh-next', descriptors: ['inspect', 'scan'].map((method) => ({
          id: `@local/dsh-next#nextProduction/${method}`, service: 'nextProduction', namespace: 'nextProduction', method,
          invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', acceptsUndefined: true, codec: { mode: 'src-json' } }], result: { mode: 'src-json' },
        })) }));
        // Optional RPC availability is reported in the page, without preventing
        // the composer switch or persisted preference editing from loading.
        return productionMount.catch(() => undefined);
      }, 'next: production remote');
      const loadProduction = async (request) => {
        await productionMount;
        if (typeof ctx.remote.nextProduction?.inspect !== 'function') throw new Error('production RPC unavailable');
        return ctx.remote.nextProduction.inspect(request);
      };
      const scanProjectChecks = async (request) => {
        await productionMount;
        if (typeof ctx.remote.nextProduction?.scan !== 'function') throw new Error('production RPC unavailable');
        return ctx.remote.nextProduction.scan(request);
      };
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'next', order: 45, label: 'NEXT', locale: NS,
        inject: () => ({ hooks: { nextSettings: settings }, loadModelCatalog, loadProduction, scanProjectChecks, setPreference: (field, value) => settings.set(field, value), mutatePreferences: (ops) => settings.mutate(ops),
          resetPreferences: () => settings.mutate(['outputLanguage', 'responseStyle', 'deduplicateReads', 'efficiencyGuidance', 'methodGuidance', 'targetedVerification', 'benefitBasedParallelism', 'expandTokenDetails', 'automationEnabled', 'automationVerification', 'automationParallelism', 'automationBudgetCny'].map((field) => ({ op: 'unset', path: [field] }))),
        }),
      }, NextSettings));
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right', id: 'next', order: 20, locale: NS,
        inject: () => ({ execute: ctx.remote.commands.execute.bind(ctx.remote.commands) }),
      }, NextButton));
      ctx.slots.inject('conversation.composer.dock', () => {
        let native;
        let dispose;
        const sync = () => {
          // alpha.5's diagnostic registrant can be absent; the native cell's
          // public id + locale identify it without relying on a fiber name.
          const entry = ctx.slots.entries('conversation.composer.dock').find((item) => item.options.id === 'usage' && item.locale === 'chat');
          if (entry === native) return;
          dispose?.();
          native = entry;
          dispose = entry ? ctx.slots.register({
            name: 'conversation.composer.dock', id: 'usage', order: entry.options.order ?? 1,
            priority: (entry.options.priority ?? 0) - 10, locale: NS, inject: (...args) => {
              const injected = entry.inject?.(...args) ?? {};
              return { ...injected, hooks: { ...injected.hooks, nextSettings: settings } };
            },
          }, UnifiedUsage) : undefined;
        };
        sync();
        const unsubscribe = ctx.slots.subscribe('conversation.composer.dock', sync);
        return () => { unsubscribe(); dispose?.(); };
      });
    }

    return { inject: ['slots', 'remote', 'remote.commands', 'remote.session', 'locale', 'configForms'], apply };
  },
});
