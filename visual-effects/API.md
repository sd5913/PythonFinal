# 调用接口

按顺序加载 `renderer.js`、`effects.js`。预览页专用的 `demo.js` 和 `demo.css` 不需要复制到游戏里。

```html
<canvas id="fx" aria-label="舰船特效"></canvas>
<script src="renderer.js"></script>
<script src="effects.js"></script>
<script>
(async () => {
  const assets = await DarkCampaignFX.loadAssets({ base: 'assets/' });
  const player = new DarkCampaignFX.Player(document.getElementById('fx'), assets,
    { width: 480, height: 260 });
  const handle = player.play('ship_hit', { color: 'yellow', number: 3, x: 240, y: 145 });
  const result = await handle.finished; // {status:'completed'|'cancelled'|'error', error?}
})();
</script>
```

默认图层透明，并绘制动画中的舰船/水滴本身。与游戏叠加时，调用方需要在特效期间隐藏对应原始图标，避免重复绘制；动画完成后恢复，碰撞销毁除外。图层的视觉尺寸可用 CSS 设置，逻辑尺寸由 `width`、`height` 决定，像素密度默认取设备值且最高为2。

## 播放参数

`player.play(effect, options)` 的 `effect` 为 README 表中的六个名称。参数：

| 参数 | 默认值 | 用途 |
|---|---|---|
| `color`, `number` | `blue`, `1` | 舰队颜色和编号。颜色支持 `blue / gray / red / yellow`，编号1—5。 |
| `otherColor`, `otherNumber` | `red`, `1` | 碰撞中的另一艘船。 |
| `x`, `y` | `240`, `145` | 静态舰体效果的中心；不是数字中心。命中点自动对齐数字。 |
| `rotation` | `0` | 静态效果旋转角度，弧度，零度为船头朝上。 |
| `scale` | `1` | 静态效果整体缩放，必须为正数。默认图标画布尺寸108×142，透明边距包含在内。 |
| `path` | 演示弧线 | `ship_move` 和 `droplet_move` 的移动轨迹，至少两个 `{x,y}` 点，按距离匀速采样，逐段连接。 |
| `duration` | 按效果确定 | 完整播放时长，毫秒；包含移动后的尾迹消散。 |
| `onComplete()` | 无 | 完整播放结束调用一次。取消不调用。 |
| `onRemove()` | 无 | 仅碰撞，在爆炸开始约0.35秒、震动结束后调用一次；时长可随 `duration` 成比例变化。 |
| `onShake({x,y})` | 无 | 通知本帧的逻辑像素震动偏移，方便调用方同步其余背景。 |

`path` 使用整个图层的逻辑像素坐标。移动效果根据轨迹自动决定方向，忽略静态参数 `x/y/rotation/scale`；当前移动图标尺寸固定。若需不同尺寸，可缩放整个图层。水滴圆头沿轨迹前进，尖头在后方。

```js
player.play('droplet_move', {
  path: [{x:80,y:150},{x:200,y:100},{x:370,y:150}],
  duration: 2100
});

player.play('ship_collision_destroy', {
  color: 'gray', number: 2, otherColor: 'yellow', otherNumber: 5,
  x: 230, y: 135,
  onRemove() { /* 此处通知显示层隐藏两船；不应在客户端自行判定游戏规则 */ }
});
```

碰撞接口从已重叠的位置开始爆炸，不负责模拟碰撞前的行驶路线。爆炸震动仅作用于本特效画布；`background` 可用于重绘背景，或用 `onShake` 同步其他层。系统启用“减少动态效果”时跳过碰撞震动；构造参数 `reducedMotion:true/false` 可覆盖。

## 生命周期

- `handle.finished`：播放结束、取消、错误时均会结算，不悬挂；错误返回含 `error`。
- `handle.cancel()`：只取消这次播放，不会取消后来开始的事件。
- `player.stop()`：停止当前动画，保留当前帧。
- `player.clear()`：停止并清空，若设置了背景函数会重绘背景。
- `player.preview(effect, options, progress)`：显示0—1之间的静态关键帧，不触发完成、移除、震动回调。
- `player.resize(width,height,pixelRatio?)`：调整逻辑尺寸，清空并重绘背景；正在播放的事件会在下一帧继续。
- `player.dispose()`：停止、清空、释放内部引用；重复调用安全，销毁后不可继续播放。

背景函数通过构造参数设置：`background(ctx, {width,height,shake})`。ctx 已应用像素密度与震动，不要再次叠加震动。未设置背景时特效层透明。

所有图片通过 `loadAssets()` 一次加载并共享。`sources` 可覆盖各资源的 URL，例如 `{'yellow-3': '...png', droplet:'...png'}`，适用于嵌入预览；不会主动联网请求第三方地址。换成不同形状的舰船素材时，需要同步调整 renderer.js 的舰体遮罩和数字锚点。
