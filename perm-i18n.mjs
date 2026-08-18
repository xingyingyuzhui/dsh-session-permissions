export const NS = 'dsh-session-permissions'

export const COPY = {
  zh: {
    tab: '权限',
    title: '权限',
    intro: '',
    on: '启用',
    off: '停用',
    session: '会话',
    agent: '所属 Agent',
    official: '官方预设',
    ceiling: '天花板',
    effective: '有效权限',
    sourceInherit: '尚未单独保存：工作区默认最大，Claw 继承其天花板',
    sourceSession: '已保存为本会话覆盖（已按天花板收紧）',
    clamped: '已按天花板收紧，超限选项不可选。Claw 不能选无限制终端或官方最高权限。',
    template: '预设基类',
    filesRead: '文件读',
    filesWrite: '文件写',
    shell: '终端',
    approval: '审批',
    mcp: 'MCP',
    delegation: '委派深度',
    tools: '工具',
    tool_read: '读取',
    tool_write: '写入',
    tool_edit: '修改',
    tool_apply_patch: '应用补丁',
    tool_bash: '命令行',
    tool_deploy: '对外发布',
    toolhint_read: '打开并阅读文件内容。',
    toolhint_write: '新建文件，或把整个文件覆盖成新内容。',
    toolhint_edit: '在已有文件里改几处，不整份覆盖。',
    toolhint_apply_patch: '按一段 diff（补丁）一次改多处代码。',
    toolhint_bash: '在这台电脑上执行命令。',
    toolhint_deploy: '允许调用发布类工具，把构建结果推到仓库外或线上。官方默认不带这个工具；打开后，只有装了对应插件或技能才会真正执行。',
    read: '读取',
    write: '写入',
    edit: '修改',
    apply_patch: '应用补丁',
    bash: '命令行',
    deploy: '对外发布',
    save: '保存',
    saved: '已保存（未超过天花板）',
    reset: '恢复继承',
    fail: '操作失败',
    none: '无',
    workspace: '工作区',
    all: '全部',
    deny: '拒绝',
    allowlist: '白名单',
    allow: '允许',
    never: '不询问',
    askExternal: '外部才问',
    askAlways: '每次都问',
    mcpNone: '无',
    mcpExplicit: '仅显式',
    mcpInit: '初始化默认',
    full: '最大',
    research: '只读',
    developer: '开发',
    reviewer: '审阅',
    release: '发布',
    public: '公开',
    officialDanger: '完全访问',
    officialWrite: '工作区写入',
    officialRead: '只读',
    officialCustom: '自定义',
  },
  en: {
    tab: 'Permissions',
    title: 'Permissions',
    intro: '',
    on: 'On',
    off: 'Off',
    session: 'Session',
    agent: 'Agent',
    official: 'Official preset',
    ceiling: 'Ceiling',
    effective: 'Effective',
    sourceInherit: 'Not saved yet: workspace defaults to maximum; Claw inherits its ceiling',
    sourceSession: 'Saved as a session override (clamped to the ceiling)',
    clamped: 'Clamped to the ceiling. Claw cannot choose unrestricted shell, deploy, or danger-full-access.',
    template: 'Preset template',
    filesRead: 'File read',
    filesWrite: 'File write',
    shell: 'Shell',
    approval: 'Approval',
    mcp: 'MCP',
    delegation: 'Delegation depth',
    tools: 'Tools',
    save: 'Save',
    saved: 'Saved (within the ceiling)',
    reset: 'Inherit again',
    fail: 'Request failed',
    none: 'None',
    workspace: 'Workspace',
    all: 'Anywhere',
    deny: 'Deny',
    allowlist: 'Allowlist',
    allow: 'Allow',
    never: 'Never',
    askExternal: 'Ask if external',
    askAlways: 'Ask always',
    mcpNone: 'None',
    mcpExplicit: 'Explicit only',
    mcpInit: 'Init defaults',
    full: 'Maximum',
    research: 'Read only',
    developer: 'Developer',
    reviewer: 'Reviewer',
    release: 'Release',
    public: 'Public',
    tool_read: 'Read',
    tool_write: 'Write',
    tool_edit: 'Edit',
    tool_apply_patch: 'Apply patch',
    tool_bash: 'Command line',
    tool_deploy: 'Publish',
    toolhint_read: 'Open and read file contents.',
    toolhint_write: 'Create a file or overwrite it entirely.',
    toolhint_edit: 'Change parts of an existing file without replacing the whole file.',
    toolhint_apply_patch: 'Apply a diff to change several places at once.',
    toolhint_bash: 'Run commands on this computer.',
    toolhint_deploy: 'Allow publish/deploy tools that push a build outside the workspace. DSH does not ship this tool; turning it on only matters if a plugin or skill provides it.',
    read: 'Read',
    write: 'Write',
    edit: 'Edit',
    apply_patch: 'Apply patch',
    bash: 'Command line',
    deploy: 'Publish',
    officialDanger: 'Full access',
    officialWrite: 'Workspace Write',
    officialRead: 'Read Only',
    officialCustom: 'Custom',
  },
}

export function interpolate(template, params) {
  if (params == null) return template
  return String(template).replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ))
}

export function activeLocaleId(ctx) {
  try {
    const locale = ctx && ctx.locale
    const snap = locale && (locale.getLocale ? locale.getLocale() : locale.getSnapshot && locale.getSnapshot())
    if (snap && typeof snap.active === 'string' && snap.active) return snap.active
  } catch { /* inject miss */ }
  const tag = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'zh'
  return tag
}

export function isZh(ctx) {
  return String(activeLocaleId(ctx)).toLowerCase().indexOf('zh') === 0
}

export function translate(lang, key, params) {
  const table = COPY[lang] || COPY.en
  return interpolate(table[key] ?? COPY.en[key] ?? key, params)
}

export function tWith(ctx, key, params) {
  try {
    const locale = ctx && ctx.locale
    if (locale && typeof locale.bind === 'function') {
      const translated = locale.bind(NS)(key, params)
      if (translated && translated !== key) return interpolate(translated, params)
    }
  } catch { /* fall through */ }
  return translate(isZh(ctx) ? 'zh' : 'en', key, params)
}
