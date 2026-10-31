# dsh-queue-reorder

A DeepSeek Harness plugin that makes the pending **message queue drag-sortable**.

While an Agent is running, messages you send wait in a queue and are sent in
order when the current turn ends. This plugin turns every queued row into a
draggable item, so a message you sent later can be placed before or after any
other pending message.

DeepSeek Harness 插件：消息发送队列支持**拖动排序**。

在 Agent 运行期间发出的消息会进入「排队消息」队列，等当前轮结束后按顺序发送。这个插件把队列里的每一条变成可拖动项：

- 拖动左侧的 `⠿` 柄，把某条消息放到另一条消息的**前面或后面**；
- 或者聚焦 `⠿` 后用 `↑` `↓` 逐条移动，`Home` / `End` 移到最前 / 最后（结果通过读屏播报）；
- 原有能力保留：折叠计数头、文本/图片/文件预览、内联编辑、删除、运行中「插话发送」、以及尚未被 Host 接收的「发送中」回显行。

## 它怎么工作

Harness 的待发送队列是 **Agent Inbox 的持久状态**（`agent/inbox/spliced` 事件），宿主在步骤边界按顺序领取。调整顺序不能简单地「删除再重新入队」——那会改变消息身份，并让下游（目标循环、子代理、提问回复）误以为消息被取消。

因此：

1. Client 半复用槽位 `conversation.input.dock` 的 `queue` 单元（同 id 即替换内置队列停靠栏），只负责呈现与手势；
2. 拖放/键盘只向 Host 提交坐标 `{ sessionId, itemId, beforeId, expectedIds }`；
3. Host 半重新读取**当前**顺序，若与 `expectedIds` 不一致（拖动期间有消息已被领取）则拒绝并提示重拖；
4. 通过一次连续的 Inbox 变更（同一批消息、新顺序、一次 splice 事件）完成移动，不产生取消语义。

纯函数 `planMove`（`reorder.js`）负责计算这次 splice 的区间，`test/reorder.test.mjs` 覆盖正反方向、边界、无效输入与竞态比较。

## 安装

```bash
git clone https://github.com/yrui-ql/dsh-queue-reorder.git
```

然后在 DSH 会话中通过插件管理器安装（`plugin_manager` 的 `install_bundle`，`target` 指向克隆目录的绝对路径）。安装后：

- 槽位 `conversation.input.dock` 的 `queue` 单元 registrant 变为 `dsh-queue-reorder`；
- 至少两条排队消息时，展开队列即可看到拖动柄与「拖动 ⠿ 调整发送顺序」提示。

卸载：在「设置 → 插件」中禁用或移除 `dsh-queue-reorder`，内置队列停靠栏会立即恢复。

## 开发

```bash
npm test
# 等价于：
node test/reorder.test.mjs        # 重排规划（含正反方向与边界）
node test/host.test.mjs           # Host 路由：校验、竞态拒绝、单次非取消 splice
node test/client-render.test.mjs  # Client 渲染探针：展开、键盘、拖放、编辑/删除/插话
```

要求 Node.js 22+（仅测试需要；插件本身无运行时依赖）。

## 边界

- 只调整 `next-turn`（待发送的下一轮）队列；`next-step` 输入与已进入会话的消息不在范围内。
- 尚未被 Host 接收的本地回显行（「发送中…」）不参与排序。
- 子代理会话仅在其可继续（continuable）时允许调整，与 Harness 自身的队列变更约束一致。
- 在 DeepSeek Harness `0.2.1-rc.5` 上开发与验证；Harness 升级后若 `conversation.input.dock` 槽位或会话内的 `conversation` 服务签名变化，需要同步本插件。

## License

[MIT](LICENSE)
