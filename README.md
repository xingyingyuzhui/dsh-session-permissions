# dsh-session-permissions · 会话权限

打开任意会话后，会话区会多一个 **权限** tab。

有效权限按更严的一面取交集：

- 工作区会话：只走官方权限。套件不拦截、不收紧、不画本会话天花板
- Claw 会话：官方预设 ∩ Claw 硬顶 ∩ Agent 策略 ∩ 本会话覆盖

工具名按 OpenClaw：`read` / `write` / `edit` / `apply_patch` / `exec`（DSH 的 `bash` 是别名）。文件边界按 `workspaceAccess`：`none` | `ro` | `rw` | `all`，路径用 OpenClaw 的 `isPathInside`。`str_replace_editor` 是 DSH 合体工具，按 `command` 映射到 read/write/edit。bash 整类仍按 Shell 面拦截，不拆命令里的路径（与 OpenClaw 相同：allow `exec` 后不再假装只读）。

Claw 区的 Agent 和会话都到不了官方最高权限 `danger-full-access`（无限制终端、不询问）。文件读/写可以到 `all`，Shell 最高到 `allowlist`，发布工具可以按需打开。工作区会话不受这层硬顶限制，也不走套件白名单。

Claw 没有单独保存时，本会话继承天花板，不会再假装成 research 只读。保存时会按天花板收紧；超限选项在 UI 里不可选。

本插件算三层交集、画会话「权限」tab，并给 Claw 会话钉官方 `sandbox/mode`（只收紧，不放宽）。`BOOTSTRAP.md` 还在时，官方沙箱会先钉到可写本工作区，闸只放行人设文件和 `ask_user_question`。真正拦截、一次性审批和审计在 `dsh-agent-gate`。建议一起装闸。

卸掉闸之后，已经开着的和之后新开的 Claw 会话只要本插件还在，官方文件沙箱仍会钉住。MCP / 技能 / 路径拦截会停。

## 安装

```sh
dsh plugin --profile web add github:xingyingyuzhui/dsh-session-permissions
```

装完重启 `dsh web`。建议同时安装 `dsh-agent-gate`。

本地开发：

```sh
dsh plugin --profile web add link:/abs/path/to/dsh-session-permissions
```

改源码后执行 `npm run build`，不要手改生成的 `client.js`。

## 数据

写在 `~/.dsh/session-permissions/<sessionId>.json`。Agent 策略仍在 `~/.dsh/DSclaw/<slug>/policy.json` 与 registry。

## 卸载

```sh
dsh plugin --profile web remove dsh-session-permissions
```

## License

MIT
