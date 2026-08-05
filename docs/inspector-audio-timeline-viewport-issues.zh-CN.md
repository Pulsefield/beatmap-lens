# Inspector 音频校准、时间轴与主视窗改进

- 版本：v1.4
- 状态：已审批
- 日期：2026-08-05
- 范围：`apps/inspector` 的 Annotate 工作区

## 1. 问题分类

| ID | 分类 | 结论 |
| --- | --- | --- |
| INS-01 | 缺失能力 | 接受：允许用户设置播放音频与谱面时钟之间的 offset。 |
| INS-02 | 交互冲突 | 接受：timeline 背景与 viewport window 的普通拖动导航主视窗；拖动已有 selection highlight 则整体平移选区。 |
| INS-03 | 精调阻碍 | 接受：选区只用轻量高亮表达，不显示粗重的可见 handle。 |
| INS-04 | 布局不足 | 接受：活跃标注态的主视窗必须占满浏览器 viewport 的完整垂直高度，timeline 改为贴边竖直放置。 |
| INS-05 | 现有 bug | 接受：pointer 被主视窗捕获后离开短 SVG，仍会用离屏坐标继续扩选 note。 |
| INS-06 | 缺失能力 | 接受：主视窗拖选接近上下边缘时自动滚动，并连续扩展选区。 |
| INS-07 | 缺失能力 | 接受：timeline 必须支持以指针所在时间为锚点缩放，并优先提供 macOS 触控板 pinch；选区整体平移优先支持三指拖拽 timeline。 |

## 2. 精确需求

### INS-01：用户可配置音频 offset

#### 问题

当前 media clock 直接把谱面毫秒映射到 `HTMLMediaElement.currentTime`。当音频编码、设备输出或人工校准需要修正时，用户没有调整入口。

#### 预期行为

- 播放控制区提供以毫秒为单位的 `Audio offset` 设置，默认值为 `0 ms`。
- offset 只改变谱面时间与媒体时间的映射，不改变 `.osu` source time、选区、note 时间、标注 sidecar 或 release 数据。
- UI 必须明确正负方向，不能只显示一个没有语义说明的数字。
- 非零 offset 对 seek、播放、暂停、单次播放选区、循环选区以及 Music 开关切换保持一致。
- synthetic clock 始终保持谱面时间；Music 关闭时 offset 不改变主视窗和 playhead。
- offset 是 Inspector 用户偏好，修改它不产生 annotation draft。

已确认定义：`mediaTimeMs = chartTimeMs + audioOffsetMs`；因此正值表示音频相对谱面提前。

边界语义：chart time 始终保持用户请求的逻辑时间，不能从 clamp 后的 media time 反推并跳动。映射结果小于 `0` 时，媒体停在 `0` 并以逻辑静音推进 chart clock，直到映射进入媒体范围；映射超过 media duration 时，媒体停在末尾并继续以 synthetic progression 推进 chart clock。进入或离开有效媒体区间时无缝切换，seek、selection playback 与 loop 都以完整 chart range 为准。

### INS-02：timeline 导航与选区编辑分离

#### 问题

当前 overview timeline 的普通拖动会创建、移动或缩放选区；用户无法把 timeline 当作主视窗的导航条使用，导航与标注意图互相争夺同一个手势。

#### 预期行为

- 普通单击 timeline：把主视窗定位到该时间；不创建 draft，不改变选区。
- 普通拖动 timeline 背景或 viewport window：抓取并移动主视窗的 viewport window，保持当前 viewport 时长不变；不创建 undo 或 draft。若按下点位于 window 外，先把 viewport 以按下时间为中心重定位，再以该位置作为本次拖动的 grab anchor。
- 普通拖动已有 selection highlight 的 body：保持时长整体平移选区。macOS 启用系统 Three Finger Drag 后，产品预期用同一条标准 pointer drag 路径接住三指拖移，并把真实 Mac 验收作为交付门槛；鼠标按住拖拽与 details rail 的 start/end 数值编辑提供等价能力。
- `Shift + 拖动` timeline 空白区域：从按下点到当前点创建一个全新的选区，替换旧选区。
- `Control + 拖动` 已有选区：修改现有选区。拖动选区内部时整体平移；靠近开始或结束边缘时只调整对应边缘。
- 三指拖拽已有 timeline 选区：整体平移选区，不调整边缘，不创建新选区。该手势是 macOS 首选精修路径，语义等价于普通 pointer 拖动或 `Control + 拖动` 选区 body。
- 选区不存在时，`Control + 拖动` 不隐式创建选区；创建选区只有 `Shift + 拖动` 一条路径。
- 手势模式在 `pointerdown` 时锁定，中途按下或松开修饰键不会切换操作类型。
- 保留现有吸附语义；`Alt/Option` 只在选区创建或修改手势中临时关闭吸附。
- 所有拖动统一使用 Pointer Events、pointer capture 和每帧最多一次的预览更新。Web 端不尝试从合成 pointer 中推断手指数，也不为桌面 trackpad 增加不可验证的 Touch Events 分支。

说明：此处按用户原话保留物理 `Control` 键。macOS 的 `Control + click` 可能触发上下文菜单，实施时必须在 timeline 范围内抑制该默认行为；是否同时接受 `Command` 作为等价修饰键属于兼容性增强，不替换 `Control`。

### INS-03：选区时间与轻量视觉表达

#### 问题

当前 timeline 选区通过带描边的 body、两端可见 handle 和额外 hit area 表达。粗重边界会遮挡密度图，并在微调时产生视觉阻力；同时界面没有稳定显示选区两端的十分之一秒时间。

#### 预期行为

- timeline 始终显示选区开始和结束时间，格式为 `mm:ss.s`，精确到 `0.1 s`。
- `0.1 s` 只规定显示精度，不降低内部毫秒精度，也不改变 note snapping。
- 选区在 timeline 上只表现为覆盖所选时间段的低对比度 highlight；不显示粗边框、端帽或可见 resize handle。
- 边缘和选区 body 仍可通过透明 hit zone 命中，但 hit zone 不参与绘制。
- 创建、移动或调整过程中，两个时间标签随预览帧更新；标签不得遮挡彼此，极窄选区时应放到选区两侧或统一放入 timeline caption。
- playhead、viewport window、saved annotation 和当前选区必须保持可辨认，但不能依靠大面积强调色区分。

### INS-04：主视窗占满浏览器 viewport，timeline 竖直贴边

#### 问题

当前 active annotation workspace 先扣除 68px app bar，再扣除 116px stage header，并在主视窗下方纵向堆叠 overview 与 playback strip。主视窗只得到剩余高度，不符合谱师尽可能扩大可见时间范围的审阅需求。

#### 预期行为

- active annotation shell 固定为 `100dvh`，没有 body/page 级纵向滚动；falling-note SVG 的实际高度等于浏览器 viewport 高度。
- desktop 列顺序为 `source rail | falling-note viewport | vertical timeline | details rail`，四列同高 `100dvh`。
- timeline 紧贴主视窗右边缘，中间只有 1px structural divider；desktop 宽 `64px`，小于 `1160px` 时 `56px`，mobile Preview 为 `48px`。
- timeline 顶部表示 `chartEndMs`（歌曲结束），底部表示 `0ms`（歌曲开始）；向上移动增加 source time，向下移动减少 source time。这与 falling-note 视窗“更晚的内容位于上方”的游玩空间直觉一致。density、viewport window、selection、saved ranges 与 playhead 全部使用同一套反向 Y 轴几何。
- active annotation 不再保留占据文档流的 app bar、stage header 或底部 controls。品牌、workspace mode 和 dataset identity 进入左 rail；save/progress 和 playback controls 进入右 rail 的 sticky section；chart title、difficulty 与 playhead 作为主视窗内的只读 HUD overlay。
- 左右 rail 高度固定为 `100dvh` 并独立滚动，不能通过内容高度压缩主视窗。
- 小于 `920px` 时仍使用 Source / Preview / Details 单面板切换，但 switcher 改为 fixed overlay；Preview 面板保持 `falling-note viewport | vertical timeline` 两列和 `100dvh`。
- passive HUD 使用 `pointer-events: none`；mobile primary transport 可以使用紧凑的底部 overlay，但不能改变 SVG 高度，并必须避开 judgment line 的主要审阅区域。

该决定有意覆盖 `apps/inspector/DESIGN.md` 中 preview 使用 8px vertical gutter 与 22px outer radius 的一般规则，仅限 active Annotate evidence view。Inspect、onboarding 和 read-only 页面继续使用原设计；active view 仍通过白色 rails、1px divider、暗色 SVG inset outline 和紧凑 HUD 保持同一设计语言。

### INS-05：阻止 pointer 离开主视窗后的离屏坐标扩选

#### 问题

主视窗在 `pointerdown` 后会 capture pointer。指针离开当前短 SVG 时，`pointermove` 仍把原始 `clientY` 写入 gesture；`viewportYFromClientY` 会把 SVG 上方或下方的坐标继续投影成 source time，最终在用户看不到对应 note 的情况下扩大 range 与 note selection。

#### 预期行为

- active view 改为 `100dvh` 后，浏览器内部不再存在主视窗上方或下方的普通布局区域。
- range drag 期间，raw pointer Y 只用于判断所处边缘；time projection 必须先 clamp 到 SVG 的 `[top, bottom]`。
- 指针进入 40px edge zone 或因 capture 位于 SVG 外时，不再把离屏距离直接换算成额外 source time，而是按最近的上/下边缘启动自动滚动。
- selection focus 每个 RAF 都用“更新后的 viewport + clamp 后的最后 pointer Y”重新计算；只能通过真实滚入视窗的时间继续扩选。
- `pointerup`、`pointercancel` 和 `lostpointercapture` 都使用同一套 clamp/finalize 规则，不能在最后一帧重新引入离屏范围。
- 不新增 hard-gate note 状态、selected-note keep-alive、离屏指示器或新的虚拟化规则；现有三屏 render buffer 与每页 200 行的 note list 保持不变。

### INS-06：主视窗拖选的边缘自动滚动

#### 问题

当前主视窗手势只使用最后一个 pointer 坐标更新选区；指针到达顶部或底部后，用户无法在一次拖动中继续选择屏幕外的时间范围。

#### 预期行为

- 仅在主视窗的 active range-select 手势中启用自动滚动；Shift scrub、note click 和已结束的手势不启用。
- captured pointer 进入顶部或底部 edge zone 后，即使没有新的 `pointermove`，也通过 `requestAnimationFrame` 连续平移 viewport 并更新选区 focus time。pointer 位于 SVG 外时视为完全进入最近 edge zone。
- 滚动方向由所处边缘决定，速度随进入 edge zone 的深度平滑增加，并在 chart 起止时间处 clamp。
- 离开 edge zone、`pointerup`、`pointercancel`、`lostpointercapture`、Escape、切换 task、锁定工作区或组件卸载时立即停止。
- 自动滚动与普通 pointermove 属于同一个 gesture transaction：整次拖选只产生一个 undo step、一次 clean-to-draft 转换和一次最终持久化。
- 最密真实谱面连续拖选时仍满足现有交互预算：60 Hz 下 Inspector 交互 P95 小于 `16.7 ms`，且不因该功能产生 `50 ms` long task。

### INS-07：timeline 在指定时间点进行缩放

#### 问题

整曲 timeline 固定显示全部时长时，长谱面中的窄选区只占少量像素，无法承担 `0.1 s` 级别的观察与微调。缩放如果围绕 timeline 中心而不是用户指向的位置发生，也会让目标时间从指针下滑走。桌面目标环境以 macOS Chromium 为主，交互不能只按鼠标滚轮设计。

#### 预期行为

- timeline 拥有一个独立于主视窗 viewport 的临时 `timelineViewRange`，初始值与 Fit/Reset 结果均为 `[0, chartEndMs]`。它只决定 timeline 当前展示的时间域，不改变 playhead、主视窗、选区、draft、undo 或持久化数据。
- macOS 触控板 pinch 是首要缩放手势。在 Chromium 中以 `ctrlKey === true` 的 `wheel` 事件接收；真实的 `Control + wheel` 与该事件无法可靠区分，因此同样执行 timeline 缩放。
- 缩放以事件发生位置为锚点：除非受到歌曲起止边界 clamp，缩放前后该像素对应的 source time 必须保持不变。缩放本身不 seek。
- 普通双指纵向滚动（`wheel` 且没有 `ctrlKey`）不承担 timeline lens 平移，也不编辑选区；timeline v1 不消费该事件，避免把轻触滚动误解释为导航。
- timeline 只在拥有 `ctrlKey` wheel/pinch 缩放手势时阻止浏览器默认页面缩放；即使已到 zoom clamp 也必须同步取消可取消事件。listener 必须限定在 timeline element，并显式使用 `{ passive: false }`；高频状态更新每帧最多提交一次。
- 三指拖拽已有 selection highlight 时整体平移选区。Apple Three Finger Drag 是系统级拖动方式，浏览器不会提供可靠的“当前有三根手指”标志，因此应用按 pointerdown 的命中对象分流：selection body 锁定 `move-range`，timeline 背景或 viewport window 锁定 `pan-viewport`。这也自然提供鼠标拖拽 fallback。
- timeline 可见时间域最宽为整曲，最窄为 `min(chartEndMs, 1000ms)`。最大放大倍率不与主视窗可见时长绑定，保证长谱面仍可把 `0.1s` 展开为足够的像素距离。
- 主视窗 viewport window、playhead 或 selection 超出当前 lens 时按边界裁切，并显示轻量的上/下方向提示；viewport window 比 lens 更长时允许两端同时越界，不能为了完整显示该 band 而强制缩小 timeline zoom。
- task 切换时重置为 Fit；mobile Preview 临时卸载/重新挂载 timeline 时保留父组件中的当前 view range。v1 不把缩放状态写入用户偏好。
- pointer 与 wheel 按事件类型和命中对象明确分流：背景或 viewport window 的普通 pointer drag 导航主视窗，selection body 的普通 pointer drag 平移选区，`Shift + pointer drag` 新建选区，`Control + pointer drag` 修改选区边缘或 body；`ctrlKey + wheel` 缩放 timeline lens。普通 wheel 不参与 timeline v1 交互。
- 播放时 playhead 或主视窗 window 可以暂时移出 zoomed timeline；v1 不自动 follow，以免播放抢走用户正在检查的位置。用户通过 Fit 或缩小 timeline 主动回到整曲视图；右侧 sticky transport 提供紧凑的 timeline Zoom in、Zoom out、Fit 操作；timeline 获得焦点时 `+`、`-`、`0` 提供等价键盘操作。
- timeline root 必须可通过 Tab 聚焦并显示明确 focus ring，accessible name 要说明“底部是歌曲开始，顶部是歌曲结束”。Zoom in、Zoom out、Fit 使用真实 `<button>` 和完整 label；`+/-/0` 只在 timeline 或这些控制获得焦点时生效。选区 start/end 时间必须作为可访问文本存在，不能只画在 SVG 中，也不能在拖动每一帧用 `aria-live` 打断用户。

## 3. 明确不在本轮需求内

- 不改变 `.osu`、canonical annotation 或 release schema。
- 不加入音频波形编辑器。
- 不以 Canvas/WebGL 重写 falling-note renderer。
- 不新增第二份领域 range、selection 或主视窗 viewport store；只允许父组件持有一份不持久化、不进 draft/undo 的 `timelineViewRange` UI 状态。
- 不改变现有 buffered-scene overscan 或 selected-note 生命周期。
- 不为了通用性引入完整 DAW、通用虚拟列表或新的服务端能力。

## 4. 现状证据

- `AnnotateWorkspace.vue` 目前同时负责 workspace、播放、SVG 渲染、timeline、pointer gesture、draft 和两侧编辑器，已经超过适合继续叠加精密交互的组件边界。
- overview timeline 的普通空白拖动是 `create`，选区 body 是 `move`，两端各有一个可见的 `14 × 66` handle；普通点击才是 seek。
- 主视窗当前是普通拖动创建选区、`Shift + 拖动` scrub，已具备 pointer capture、2px gesture threshold、单 RAF preview 和 pointerup flush。
- pointer capture 会在指针离开 SVG 后继续收到事件；当前 `viewportYFromClientY` 不 clamp element rect，`viewportYToSourceTime` 只 clamp 整张 chart，因此离屏坐标会成为有效 range。
- `BufferedSceneController` 的三屏 overscan 是独立的渲染优化，不是这次离屏扩选问题的原因，无需更换 renderer。
- 右侧 range notes 已按每页 200 行分页；当前真实最密谱面约 5,857 notes，现有设计文档已经明确只有实际测量证明分页不足时才升级固定窗口，不应预先加入通用虚拟列表。
- desktop workspace 目前只有 `calc(100svh - 68px)`；中央 116px header、horizontal overview 和 playback strip 又继续扣减高度。满足本 issue 必须移除 active view 的纵向 chrome，而不是再加一个 `height: 100%`。
- overview timeline 的方向写死在 X 轴：`viewBox="0 0 1000 72"`、`clientX`、`x/width` geometry 和 `ew-resize` 都必须转成真实的 Y 轴实现，不能只用 CSS rotate。
- overview timeline 目前总是把整曲映射到固定 1000-unit 宽度，没有独立的 view range、wheel/pinch handler 或 point-anchored zoom；新增缩放必须同时改造坐标域，而不是只放大 SVG 外观。
- 当前 runtime dependency 只有 Vue 和字体；没有 waveform、D3 或 virtual-list 依赖。

## 5. 外部方案调研

### 5.1 成熟库比较

| 方案 | 可借鉴部分 | 不直接采用的原因 |
| --- | --- | --- |
| [wavesurfer.js Regions / Minimap](https://wavesurfer.xyz/docs/) | minimap viewport overlay、低对比度 region、可见时才挂载 region、拖动时维持可见 | 它首先是 waveform/audio player；Region 默认拥有独立拖动/resize 生命周期，引入后仍需重写修饰键路由，并会重复现有 audio 与 buffered scene。 |
| [D3 brush](https://d3js.org/d3-brush) + [D3 zoom](https://d3js.org/d3-zoom) | 一维 brush 的透明 overlay、selection body 与 edge hit zone；point-anchored scale、`deltaMode` 归一化和 wheel gesture batching | D3 会管理 SVG DOM 与自己的 gesture state；其默认 modifier 也不同。为了适配 Vue 单一状态源和现有 draft transaction，接入成本不低于复用其数学与事件约定。 |
| [TanStack Vue Virtual](https://tanstack.com/virtual/latest/docs/framework/vue/vue-virtual) / [VueUse useVirtualList](https://vueuse.org/core/usevirtuallist/) | 适合固定或可测量的滚动行列表 | falling-note viewport 是连续时间几何，不是列表；右侧 notes 已分页，主视窗已有更合适的时间索引和三屏 buffer。 |
| [W3C Pointer Events](https://www.w3.org/TR/pointerevents3/) + Vue | 原生 modifier、统一 mouse/pen/touch、pointer capture、`pointercancel`/`lostpointercapture`，可完全控制状态机 | 需要自行维护小型手势状态机；但仓库已经完成了最难的 capture、RAF batching、事务和清理基础。 |

结论：不安装 wavesurfer、D3、TanStack Virtual 或 VueUse。使用两个受控 Vue 组件，并复用现有 Pointer Events 与纯函数；成熟项目只作为交互机制参考。

### 5.2 成熟编辑器可迁移机制

#### osu!lazer

[TimelineBlueprintContainer](https://github.com/ppy/osu/blob/master/osu.Game/Screens/Edit/Compose/Components/Timeline/TimelineBlueprintContainer.cs) 的 drag auto-scroll 使用 40px edge tolerance、随深入边缘增加的平方速度、最大速度限制和持续时间 ramp。

可迁移到 Inspector：

- 40px 不可见 edge zone。
- 基于 edge penetration 的平方速度曲线和上限。

#### Audacity

[SelectHandle](https://github.com/audacity/audacity/blob/master/au3/src/tracks/ui/SelectHandle.cpp) 把选区保存在共享 project state 中；修饰键调整时选择最近边缘，拖动过程中把指针位置持续反算为时间。其 auto-scroll 在 viewport 移动后使用最后指针坐标重新执行选择更新，而不是等待下一次鼠标事件。

可迁移到 Inspector：

- timeline 子组件不拥有第二份 canonical selection，只持有本次 pointer gesture 的暂态坐标。
- Control 调整通过不可见 hit zone 决定 `move | resize-start | resize-end`。
- auto-scroll 每帧按“新 viewport + 最后 pointer 坐标”重算 focus time。

#### wavesurfer.js

[Regions 源码](https://github.com/katspaugh/wavesurfer.js/blob/main/src/plugins/regions.ts) 展示了低透明度 region fill；Minimap 则用主视窗 scroll 状态计算 viewport overlay，而不是复制一份 viewport model。wavesurfer 的 region 本体和默认 resize handle 仍参与输入与绘制，Inspector 的透明 SVG hit zone 是本项目为 highlight-only 交互作出的独立设计。

可迁移到 Inspector：

- visible highlight 与 invisible hit target 分层。
- timeline viewport window 完全由 `viewportFrame.viewportRange` 派生。

### 5.3 macOS 触控板与 point-anchored zoom

- [MDN `wheel` event](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event) 明确说明 trackpad 的 pan 与 zoom 都通过 wheel 事件暴露，zoom 手势带有 `ctrlKey`。标准事件无法可靠区分 macOS pinch 合成的 `ctrlKey + wheel` 与用户真实按住 Control 滚动，因此两者必须采用相同缩放语义。
- [W3C Wheel Events](https://w3c.github.io/uievents/split/wheel-events.html) 定义了 pixel、line、page 三种 `deltaMode`，并允许取消默认 scroll/zoom；实现不能把所有 `deltaY` 都假设为 CSS pixel。
- [MDN `addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener) 说明 passive listener 中 `preventDefault()` 无效。timeline 必须在自身 element 上注册 `{ passive: false }` 的 wheel listener，但只取消实际消费的事件，不能在 document/window 层截获整页手势。
- [D3 zoom](https://d3js.org/d3-zoom) 的默认 wheel delta 会按 `deltaMode` 归一化，并对 `ctrlKey` wheel 提高灵敏度；其变换在缩放前反算 pointer 下的内容坐标，再调整 translate 使该点留在原像素。Inspector 复用这一数学约定和 `2^delta` 连续缩放，不引入 D3 的 DOM/gesture ownership。
- [Apple Support](https://support.apple.com/en-us/102341) 把 Three Finger Drag 定义为 macOS Pointer Control 下的系统级拖动方式；它不是 Web 标准输入类型。
- [W3C Pointer Events](https://w3c.github.io/pointerevents/) 与 [MDN `pointerType`](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pointerType) 只为事件提供 mouse、pen、touch 等设备类别，没有 trackpad finger count。macOS 将系统手势合成为普通 pointer drag 时，应用无法可靠判断它来自三指还是鼠标。

结论：Chromium/macOS 首选 `wheel + ctrlKey` pinch 合约；普通双指 wheel 不承担 timeline v1 操作。产品把 macOS Three Finger Drag 接入标准 pointer-drag 合约，应用用起点命中对象而非手指数决定语义：selection body 平移选区，其余 timeline 区域导航主视窗。Chromium 是否生成预期 pointer sequence 必须由真实 Mac 验收确认。缩放路径复用受控 `timelineViewRange` 和单 RAF 更新，不新增 Safari 专属 `GestureEvent` 或桌面 Touch Events 分支。Safari/Firefox 不作为 v1 手感基线，但标准鼠标拖拽、`Control + wheel`、按钮和键盘操作仍提供可用 fallback。

## 6. 推荐设计

### 6.1 组件边界

新增两个受控 Vue 组件，不新增全局 store：

1. `apps/inspector/src/AnnotationTimeline.vue`
   - 绘制竖直 density、viewport window、saved bands、selection highlight、playhead 和 `mm:ss.s` 两端时间。
   - 接收父组件传入的 `timelineViewRange`；在内部只持有 pointer ID、初始/最后坐标、锁定的 gesture kind、透明 hit-test 结果以及尚未 flush 的 zoom wheel delta。
   - 只向父组件发送 `view-range-change`、`seek`、`viewport-pan`、`range-preview`、`range-commit`、`range-cancel` 等意图；不直接写 timeline lens、draft、undo 或 selected note IDs。
2. `apps/inspector/src/FallingNoteViewport.vue`
   - 绘制现有 buffered frame、range/saved bands、notes、judgment line、HUD 与 legend。
   - 负责 pointer capture、element-rect clamp、最后 pointer 坐标和 edge-scroll RAF 生命周期。
   - 向父组件发送 seek、note toggle、range preview/commit/cancel 与 viewport-pan 意图；不拥有 annotation 状态。

`AnnotateWorkspace.vue` 继续是唯一领域状态源，负责 snapping、note membership、undo、draft transaction、playback controller 和 session lifecycle；同时持有唯一的 `timelineViewRange` UI ref，使 mobile Preview 卸载子组件时不会丢失 lens。该 ref 不属于 annotation domain，也不持久化。

```text
                         props: chart/range/frame/state
AnnotateWorkspace ─────────────────────────────────────────┐
       │                                                   │
       ├── AnnotationTimeline.vue ── semantic intents ─────┤
       │                                                   │
       ├── FallingNoteViewport.vue ─ semantic intents ─────┤
       │                                                   │
       └── AudioPlaybackController ── clock state ─────────┘
                              │
                              └── MediaPlaybackClock + offset mapping
```

数据只从父组件向下流，用户意图只从子组件向上流，没有组件间直接引用和状态环。

### 6.2 vertical timeline gesture 状态机

所有时间与 pointer 映射使用反向 Y 轴：timeline top 为 chart end、bottom 为 chart start；向上是更晚时间，向下是更早时间。纵向 selection geometry 使用 `y/height`，其中 range 的 `endMs` 是上边缘、`startMs` 是下边缘，边缘 cursor 使用 `ns-resize`。现有 `createTimelineRange`、`moveTimelineRange` 和 `resizeTimelineRange` 的 source-time 纯函数继续复用，屏幕坐标转换集中到新的反向映射 helper。

| pointerdown 条件 | 锁定模式 | pointermove 结果 | pointerup 结果 |
| --- | --- | --- | --- |
| 无修饰键，命中选区 body | `move-range` | 保持时长平移；macOS Three Finger Drag 与鼠标拖拽走同一路径 | 提交调整；一次 undo 和一次 draft flush |
| 无修饰键，命中 viewport window | `pan-viewport` | 保留 window 内的 grab offset 并平移 window | 保留最终 playhead；无 draft/undo |
| 无修饰键，位于 viewport window 外 | `pan-viewport` | 先以按下时间为中心重定位 window，再从该位置连续平移 | 保留最终 playhead；无 draft/undo |
| `Shift` | `create-range` | 从 anchor 到 focus 预览新 range | 替换 range；一次 undo 和一次 draft flush |
| `Control` + 命中开始边缘 | `resize-start` | 调整开始边缘 | 提交调整 |
| `Control` + 命中结束边缘 | `resize-end` | 调整结束边缘 | 提交调整 |
| `Control` + 命中选区 body | `move-range` | 保持时长平移 | 提交调整 |
| `Control` + 未命中选区 | `noop` | 无 | 无 |

边缘 hit target 继续使用现有 40 CSS px 换算，但完全透明；两个 edge zone 重叠时，以离指针更近的边缘为准。命中优先级是 `Control + edge`、selection body、viewport window、timeline background。视觉 cursor 分别使用 `ns-resize`、`grab/grabbing` 和 viewport-pan cursor，让同一区域内的不同拖拽结果可预期。

### 6.3 timeline lens 坐标与 trackpad 状态机

- `timelineViewRange = [viewStartMs, viewEndMs]` 是 `AnnotateWorkspace.vue` 持有的受控 UI state；task 加载时设为整曲，`AnnotationTimeline.vue` 只计算下一值并 emit。
- 反向映射统一为 `time = viewEndMs - y / height × viewDurationMs`，逆映射为 `y = (viewEndMs - time) / viewDurationMs × height`。density、playhead、range、saved band、主视窗 window、pointer seek 和 hit testing 必须调用同一 helper。
- range geometry 的 top 来自 `endMs`，bottom 来自 `startMs`，`height = bottom - top`；不得先按正向 Y 轴算完再用 CSS transform 翻转。
- wheel `deltaMode` 使用 D3 的成熟基线归一化：pixel 为 `0.002`、line 为 `0.05`、page 为 `1`。公式固定为 `zoomDelta = -event.deltaY × factor(deltaMode) × (event.ctrlKey ? 10 : 1)`、`scale = 2^zoomDelta`、`newDuration = oldDuration / scale`；灵敏度常量留在一个纯函数中，依据 macOS 实机手测调整。
- pinch 时先计算指针纵向比例 `r = y / height` 及旧域中的 `anchorMs`，再计算 `newEnd = anchorMs + r × newDuration`、`newStart = anchorMs - (1 - r) × newDuration`，最后整体 clamp 到 `[0, chartEndMs]`。只有触及歌曲边界时才允许 anchor 像素漂移。
- zoom duration clamp 到 `[min(chartEndMs, 1000ms), chartEndMs]`，与 `mainViewportDurationMs` 解耦。Zoom in/out 按钮与焦点内 `+/-` 以可见 playhead 为锚；playhead 不在 lens 内时以 lens 中心为锚。Fit/`0` 直接恢复整曲。
- pointer gesture active 时忽略 wheel，避免一个 transaction 中混入两类 camera 操作。wheel zoom 不产生 pointer capture、range preview、draft 或 undo。
- wheel 事件先同步判断 ownership：`ctrlKey` wheel 始终在事件可取消时立即 `preventDefault()`；普通 wheel 不消费，也不阻止默认行为。zoom delta 随后累加，并在同一个 RAF 中最多 emit 一次 `view-range-change`。listener 只绑定 timeline root，显式 `{ passive: false }`，卸载时使用同一 options 移除。
- zoomed timeline 中，`move-range`、`resize-*`、`create-range` 或 `pan-viewport` pointer gesture 进入顶部/底部 40px edge zone 时，自动平移 `timelineViewRange` 并按更新后的 lens 重算 pointer time。它与当前 gesture 共用一个 RAF 和 transaction，让选区或 viewport window 可以连续拖过当前 lens；普通双指 wheel 仍不承担 lens pan。
- v1 不自动跟随播放。如果 playhead 或主视窗 window 离开 lens，只在 timeline 上显示轻量的越界方向提示；用户通过 Fit 或缩小 timeline 主动返回，不改变当前播放位置。

| 输入 | timeline lens | 主视窗/playhead | selection/draft/undo |
| --- | --- | --- | --- |
| macOS pinch / `ctrlKey + wheel` | 以 pointer 时间为锚 zoom | 不变 | 不变 |
| 普通双指 wheel | 不变 | 不变 | 不变 |
| macOS 三指拖移或鼠标拖拽 selection highlight | 接近边缘时自动 pan | 不变 | 整体平移已有选区；一次 undo 和一次 draft flush |
| Zoom in/out 按钮或焦点内 `+/-` | 以可见 playhead 或 lens 中心 zoom | 不变 | 不变 |
| Fit 按钮或焦点内 `0` | 恢复 `[0, chartEndMs]` | 不变 | 不变 |

### 6.4 主视窗 pointer boundary 与 auto-scroll

- range gesture 保存 raw `clientY`，但 time projection 统一使用 clamp 到当前 SVG rect 的坐标。
- raw Y 位于 rect 外时只表达滚动方向和满速 edge penetration，不直接扩大 range。
- edge zone 固定为顶部和底部各 40 CSS px。
- 进入深度归一化为 `p = 0..1`；滚动速度采用 `p² × viewportDuration` 每秒，并以每秒一个 viewport 为上限。边缘浅处可微调，抵达边缘时仍能快速连续扩展。
- RAF 使用真实帧间隔计算 delta，更新并 clamp playhead 后，立刻用新 frame 与最后 pointer Y 重算 selection focus。
- auto-scroll 复用当前 gesture transaction，不引入第二个定时器写 draft。
- buffered scene、note membership 和右侧分页逻辑不因这项修复改变。

### 6.5 viewport-first 布局

- active root 使用 `height: 100vh; height: 100dvh; overflow: hidden`，以 `100vh` 作为旧浏览器 fallback。
- desktop grid 为 `minmax(260px, 300px) minmax(0, 1fr) 64px minmax(320px, 360px)`；timeline 与主视窗无 gap。
- falling-note shell 和 SVG 高度为 grid 的完整 `100dvh`，去掉 vertical gutter、圆角造成的上下留白和 `min-height: 620px`。
- app-bar 信息按职责迁入 rails/HUD；playback strip 变为 details rail 顶部的 sticky transport，不覆盖 evidence。
- mobile panel switcher fixed overlay 使用 safe-area inset；Preview panel 自身是 `minmax(0, 1fr) 48px` 两列并保持 `100dvh`。
- mobile primary transport 是底部 compact overlay；passive HUD 不接收 pointer，实际按钮仍保留至少 40px hit target。

这仍符合 `apps/inspector/DESIGN.md` 的连续 surface、结构分隔和 preview 主视觉原则，不引入玻璃、卡片网格或厚 accent rail。

### 6.6 audio offset

- `PlaybackClock` 对外继续只表达 chart time。
- `MediaPlaybackClock` 负责 chart time 与 media time 的双向映射；selection end/loop 判断也只使用映射后的 chart time。
- offset 在播放中改变时先保存当前 chart time，再应用新 offset 并重新 seek，保证 playhead/viewport 不跳，只让音频位置改变。
- 映射位于媒体范围外时，用 synthetic progression 表达逻辑静音；跨入或跨出有效媒体区间时切换 clock source，但对订阅者仍是一条连续 chart timeline。
- `SessionPreferences` 增加可选的 `audioOffsetMs`；读取旧 preference 时归一化为 `0`，不升级 IndexedDB version。
- playback strip 使用 number input，步进 `10 ms`，并提供 `-10`、`+10` 和 `Reset` 精调。输入 blur/Enter 后应用并写 preference，不进入 annotation draft。

## 7. 可独立合并的实施顺序

整体会影响 8 个以上文件，因为需要拆出两个组件并同步纯逻辑测试；不增加服务、账户、API key、运行时依赖或 canonical 数据迁移。

### 阶段一：音频 offset

涉及：

- `annotation/media-playback-clock.ts` 与测试：offset 映射、selection/loop 边界、运行中改 offset。
- `annotation/audio-playback.ts` 与测试：controller 切换 synthetic/media 和 fallback 时保持 chart time。
- `annotation/session-store.ts` 与测试：可选 preference 的向后兼容。
- `AnnotateWorkspace.vue`、`style.css`：播放区设置与文案。

阶段完成后 offset 可单独交付；回滚只删除该 preference 字段和 UI，canonical 数据不受影响。

### 阶段二：viewport-first interaction shell

涉及：

- 新增 `AnnotationTimeline.vue`。
- 新增 `FallingNoteViewport.vue`。
- `annotation/overview-density.ts` 与测试：纵向 density path。
- `annotation/timeline-range.ts` 与测试：反向 Y 轴 geometry、按 hit target 分类 gesture、最近边缘、viewport pan clamp、十分之一秒显示。
- 新增 `annotation/timeline-view-range.ts` 与测试：time/Y 双向映射、point-anchored zoom、wheel delta 归一化、duration/boundary clamp、pointer edge-pan 与 Fit。
- 新增 `annotation/viewport-auto-scroll.ts` 与测试：element-rect clamp、edge-zone、平方速度、frame delta 和 chart clamp。
- `AnnotateWorkspace.vue`：持有临时 `timelineViewRange`，接收两个组件的语义 intent，重排 active app chrome，保留唯一领域状态和现有 gesture transaction/draft 路径。
- `style.css`：`100dvh` 四列 desktop shell、mobile overlay、竖直 timeline、highlight-only 外观、透明 hit target、edge-scroll affordance，以及 details rail 内紧凑的 Zoom/Fit fallback controls。

vertical timeline、point-anchored zoom、full-height layout、pointer clamp 与 edge auto-scroll 作为同一个 active-viewport release gate：验收全部通过后才交付。该阶段不改变 buffered renderer、note selection contract 或 canonical 数据；整体可作为一个 UI/gesture commit 回滚。这里不再人为拆成多个阶段，因为只发布布局而保留已知离屏误选，或只发布 zoom 而保留相反的时间方向，都不构成完整可用结果。

## 8. 验证

### 自动测试

- offset：正值、负值、seek、播放、单次 selection、loop、Music on/off、media failure fallback、旧 preference 无字段；负 offset 在 chart start 的逻辑静音、正 offset 接近 media end 的尾部静音，以及跨越两个媒体边界时 chart time 连续。
- vertical timeline：top click 接近 `chartEndMs`，bottom click 接近 `0ms`，向上拖动增加时间；range 的 end edge 在上、start edge 在下；selection body 的普通 drag 整体平移且只提交一次，timeline 背景/viewport window 的普通 pan 不改 range/undo/draft；window 内保持 grab offset；window 外先重定位再连续拖动；click/drag 2px threshold；Shift 正反向新建；Control 最近边缘 resize 与 body move；无选区 noop；Alt free placement；pointercancel/lost capture rollback。
- timeline lens：time/Y 双向映射；pixel/line/page `deltaMode` 与 zoom delta 负号；pinch anchor 在非边界时像素不变；start/end boundary clamp；`1s`/整曲 duration clamp；Fit/reset；task switch reset；mobile 子组件重挂载保留父级 state；viewport window 比 lens 更长或完全在 lens 外时的裁切与方向提示。
- gesture routing：修饰键与 hit target 只读取 pointerdown 快照，拖动中不会换模式；timeline 内 `Control + pointer` 对应的 `contextmenu` 默认行为被抑制，普通右键仍不启动手势；普通 wheel 不改变任何 timeline 状态；`ctrlKey` wheel 只 zoom lens，不改变 playhead、main viewport、selection、draft 或 undo；selection body 的合成三指 pointer drag 与鼠标 drag 都锁定 `move-range`，其余 timeline pointer drag 锁定 `pan-viewport`；active pointer gesture 中 wheel 不混入。
- accessibility：Tab 可到达 timeline root 和 Zoom/Fit buttons，focus ring 可见，`+/-/0` 的 focus scope 正确；screen reader 能读取反向方向、当前 lens 以及 `mm:ss.s` selection start/end 文本，拖动过程不产生逐帧 live announcement。
- timeline pointer edge-pan：四类 active pointer gesture 进入上下 40px 后持续移动 `timelineViewRange`，没有后续 pointermove 仍由 RAF 推进；离开 edge、结束/取消手势、task 切换或组件卸载立即停止，并保持原 gesture 的单次 transaction 语义。
- pointer boundary：rect 内坐标原样映射；rect 外坐标 clamp 到最近边缘；pointerup/cancel/lost capture 不产生最后一帧跳变。
- auto-scroll：上下方向、40px 边界、离开 rect 视为满 penetration、平方曲线、不同 frame delta、chart start/end clamp、停止条件、同一 gesture 只 finalize 一次；只发送一次 pointermove 进入 edge zone 后，不再发送 pointer 事件，后续 RAF 仍持续推进 viewport 与 selection focus。
- 回归：现有 note toggle、saved annotation seek、range snapping、draft flush、buffer reuse 和 keyboard shortcuts。

### 手工验收

- 尺寸：`1440 × 900`、`1280 × 720`、`1024 × 768`、`375 × 667`。
- active session 中 `.falling-note-viewport` 高度与 `window.innerHeight` 相差不超过 1px；vertical timeline 与其 top/bottom 完全对齐并紧贴右边缘。
- desktop rails 分别内部滚动；body 无纵向滚动，sticky transport 不覆盖主视窗。
- mobile Preview 中 viewport 仍是 `100dvh`，fixed switcher 不改变高度，timeline 保持 48px，按钮 hit target 不小于 40px。
- mobile fixed switcher 与 compact transport 的 overlay hit testing 不得覆盖 timeline 上下 edge zone、selection hit zone 或主视窗 judgment-line 操作。
- 在真实 macOS Chromium 上验证触控板 pinch 以触点时间为锚平滑缩放，普通双指滚动不触发 timeline 状态变化；另测真实 `Control + wheel`、鼠标滚轮、非 100% 页面缩放、Zoom/Fit 按钮和焦点内 `+/-/0` fallback。
- 在开启 macOS Accessibility Three Finger Drag 的真实 Chromium 环境中，验证三指拖移 selection highlight 会进入标准 pointer `move-range`；同一位置的鼠标拖拽提供等价结果，拖拽 timeline 背景则只导航主视窗。浏览器事件中不依赖或断言手指数。
- 在 macOS Chromium 上验证 `Control + drag` 不弹出 context menu，普通右键仍保留预期行为。
- 在 zoomed lens 内把 selection、range edge 和 viewport window 分别拖入上下 edge zone，确认 lens 自动平移、目标时间连续且每次 gesture 只产生预期的一次提交。
- 在 zoom duration 的最小/最大 clamp 上继续 pinch，确认事件仍由 timeline 拥有且不会触发浏览器页面缩放；在最长真实谱面缩到 `1s` lens，确认 `0.1s` 区间的像素距离足以读取和微调。
- 在最密真实谱面连续 10 秒拖选，检查边缘微调、滚动速度、选区时间标签遮挡和离屏 note 状态。
- Music 开启时分别设置 `-100 ms`、`0 ms`、`+100 ms`，在播放、loop 与切图后确认方向和持久化一致。
- Chromium Performance trace 验证连续交互 P95 小于 `16.7 ms`，且没有 Inspector 造成的 `50 ms` long task。

### 命令

- `pnpm --filter @pulsefield/beatmap-lens-inspector typecheck`
- `pnpm test`
- `pnpm --filter @pulsefield/beatmap-lens-inspector build`
- 完整交付前运行 `pnpm check`

## 9. 已确认决定与最脆弱前提

- 已确认：`audioOffsetMs > 0` 表示音频提前，映射为 `media = chart + offset`。
- 已确认：主视窗高度是浏览器完整 viewport，即 active state 的 SVG 为 `100dvh`；app bar、header、timeline 和 playback 不从该高度中扣减。
- 已确认：此前所谓 hard gate 不是 selected-note 生命周期或虚拟渲染需求，而是当前短 SVG 配合离屏 pointer projection 造成的误扩选。
- 已确认：timeline 贴主视窗右侧，顶部为歌曲结束、底部为歌曲开始；向上是更晚时间，与 falling-note 视窗的游玩方向一致。
- 已确认：timeline 支持以 pointer 下的 source time 为锚缩放，macOS 触控板 pinch 优先；普通双指滚动不作为 timeline lens 操作；三指拖拽 timeline selection 用于整体平移已有选区。
- 平台约束：浏览器不能可靠报告 macOS trackpad finger count，因此 selection body 的标准 pointer drag 就是该动作的实现合约，三指拖移和鼠标拖拽共享语义；timeline 背景与 viewport window 的 pointer drag 仍导航主视窗。
- 设计决定：zoomed timeline v1 不自动 follow playhead，避免播放抢回用户正在检查的时间域；Fit 与轻量越界提示提供恢复路径。

本方案最脆弱的前提是：把 playback 与编辑控制移入 details rail 不会降低谱师的常用操作效率。键盘快捷键保持不变，transport 设为 sticky；如果真实使用仍频繁需要鼠标跨越主视窗，首选修正是为主视窗增加一条不参与布局的紧凑 overlay toolbar，而不是重新压缩 SVG 高度。
