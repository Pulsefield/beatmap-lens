# Inspector Loop 连续性与选区稳定提交

- 状态：已确认，设计已审批
- 日期：2026-08-05
- 范围：`apps/inspector` 的 Annotate 工作区
- 设计决策：[ADR 0004](decisions/0004-inspector-viewport-navigation-loop-continuity.md)

## 问题分类

本 issue 只包含两个问题。滚轮和方向键是统一 viewport navigation 的输入方式，也是这两个问题的验收场景，不单独构成第三项功能。

| 编号 | 分类 | 已确认的问题 |
| --- | --- | --- |
| INS-08 | transport 状态耦合 | loop 开启后，selection 编辑会先暂停播放。暂停同时清除 loop 状态，导致一次非 transport 编辑永久停止循环。 |
| INS-09 | selection 事务边界 | range gesture 的每帧 preview 会直接改写 committed selection，并提前触发 note membership、manual exclusions 和派生逻辑。 |

## INS-08：Loop 只能由明确的 transport 意图停止

### 现状证据

`AnnotateWorkspace` 的 range gesture 在开始编辑时调用 `pauseForEdit()`。两个 playback clock 的 `pause()` 都会清除 selection playback，因此一次 selection 创建、平移或缩放会把正在运行的 loop 变成永久停止状态。

普通 seek 本身不会清除 loop。问题来自编辑操作把“暂停以便编辑”当成了 transport 意图，而不是 viewport 跳变或 seek 的固有行为。

### 预期行为

loop 是当前 chart session 内持续存在的用户 transport intent。loop 一旦开启，以下非 transport 操作不得暂停、停止或清除它：

- viewport 的滚轮、方向键、拖动或 seek；
- selection 的创建、平移、边缘调整和手工时间输入；
- note membership、文本、标签、salience、exemplar role 等编辑；
- undo、draft flush、save 等普通编辑和持久化操作。

只有明确的 transport 操作可以停止或替换当前 loop：

- 关闭 Loop；
- Pause 或等价的显式暂停命令；
- Play 或一次性 Selection playback 等明确选择另一种播放模式的命令。

切换 task 或 chart、清空 workspace、销毁当前 playback session 仍会终止 loop。这些是 session 生命周期边界，不是编辑操作。

selection gesture 进行期间，播放继续使用最后一次 committed selection 的 loop range。新的 selection 成功 settle 后，loop 在同一 transport mode 下绑定到新 range，并从新 range 的 `startMs` 重新开始。这个切换不得先暴露 `playing = false` 的中间状态。

gesture 被取消、回滚或得到无效 range 时，committed selection 和原 loop range 都保持不变。

## INS-09：Selection 只在 settle 时提交

### 现状证据

当前 gesture preview 每个 animation frame 都会调用 selection range 的领域更新路径。该路径不只绘制 range band，还会更新 selected note IDs、manual exclusions、candidate notes、overlap warnings 和其他依赖 committed selection 的状态。

这不是尚未证实的性能故障，而是状态语义和事务边界不清。拖动中的临时画面被过早当成了已提交选择。

### 预期行为

selection 明确分成两层：

- transient preview：只保存 gesture anchor、最后一个 pointer 位置、working viewport time 和可视 `previewRange`；
- committed selection：保存 settled range、selected note IDs、manual exclusions，以及由它们驱动的领域状态。

pointermove、滚轮和方向键可以按 animation frame 更新 transient preview，但不得在 gesture 进行期间改写：

- committed range；
- selected note IDs 和 manual exclusions；
- candidate note list 和 overlap warnings；
- undo、draft、autosave 或持久化状态；
- 当前正在播放的 loop range。

pointer gesture 在 `pointerup` 时 settle。手工时间输入在 `Enter` 或 blur 时 settle。按住鼠标时使用滚轮或方向键移动 viewport 仍属于同一个 gesture，并在最终 `pointerup` 时统一 settle。

成功 settle 时只执行一次完整领域提交：

1. 计算最终 snapped range。
2. 计算 note membership 和 manual exclusions。
3. 更新 committed selection 及其派生状态。
4. 产生一条 undo，触发一次 draft 状态转换和一次最终持久化。
5. 若 loop 仍开启，将 loop 绑定到新 range，并从 `startMs` 重新开始。

`Escape`、`pointercancel` 和 `lostpointercapture` 会丢弃 transient preview，不修改 committed selection，也不改变当前 loop。

## 统一 viewport navigation

实现以上状态语义时，主视窗采用一套 viewport navigation 操作：

- 光标位于主视窗时，无修饰键的垂直滚轮移动 viewport。
- 主视窗获得焦点后，`ArrowUp` 和 `ArrowDown` 移动 viewport。主视窗内的 pointerdown 同时让它获得焦点。
- `ArrowUp` 和负 `deltaY` 前往更晚时间，`ArrowDown` 和正 `deltaY` 前往更早时间。结果限制在 `0..chartEndMs`。
- pixel delta 直接按 CSS pixel 计算；line delta 按 `16px` 换算；page delta 按当前 viewport 高度换算。
- 每次方向键输入移动 `40px` 对应的时间。长按沿用浏览器原生 key repeat。
- 高频滚轮输入按 animation frame 合并，每帧最多更新一次 viewport 和 transient preview。
- 带 `Control`、`Meta`、`Alt` 或 `Shift` 的滚轮不由主视窗消费。

没有 active selection gesture 时，这个操作只导航 viewport，并沿用 seek 不改变 transport mode 的语义。active gesture 存在时，anchor time 保持不变，最后一个 pointer 坐标按新 viewport 重新映射为 focus time，因此 `previewRange` 会自然扩大或缩小。这里不新增独立的 keyboard selection mode。

## 验收

- [ ] loop 播放期间执行 viewport seek、滚轮导航或方向键导航，`playing` 和 `looping` 始终保持为 true。
- [ ] loop 播放期间创建、平移、缩放或手工修改 selection，编辑过程中继续循环最后一次 committed range。
- [ ] 新 selection 成功 settle 后，loop 从新 range 的 `startMs` 继续，期间不出现 paused 状态。
- [ ] 取消、回滚或无效 gesture 后，committed selection 和 loop range 均保持原值。
- [ ] gesture preview 期间只有 `previewRange` 变化；selected note IDs、manual exclusions、candidate notes、overlap warnings、undo 和 draft 状态均不变化。
- [ ] pointerup 只计算和提交一次最终 selection，并只产生一条 undo 和一次最终持久化。
- [ ] 按住鼠标创建 selection 时，滚轮或方向键移动 viewport 会改变 transient preview，anchor 不变，pointerup 后才更新 committed selection。
- [ ] pixel、line 和 page 三种 wheel delta 按相同方向工作，并在 chart 起止位置正确停止。
- [ ] 主视窗通过 Tab 或 pointerdown 获得焦点后响应方向键；焦点位于输入框、按钮、timeline 或其他区域时不截获方向键。
- [ ] Music 关闭时 synthetic clock 满足相同的 loop 规则；Music 开启时 media clock 的 transport 状态与其一致。
- [ ] 切换 task 或 chart、清空 workspace 或销毁 playback session 会终止旧 session 的 loop。

## 不在本 issue 内

- 不把 viewport camera 和 playback playhead 拆成两个持久状态。
- 不增加全工作区方向键快捷键、hover 驱动的键盘焦点或独立 keyboard selection mode。
- 不增加滚轮惯性、加速曲线、可配置步长或新的用户偏好。
- 不改变 `.osu`、annotation、draft、release 或 session preference schema。
- 不以本次状态边界调整宣称未经测量的性能收益。
- 不安装新的输入、手势或播放依赖。
