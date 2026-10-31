// 输入：键盘（WASD / 方向键 / Shift / E / H / M / Esc）+ 指针拖动环顾 + 滚轮 + 触屏（左下摇杆、右半屏拖动、双指缩放）。
// 只产出「意图」：move(x,y ∈ [-1,1])、run、look 增量、zoom 增量、动作事件；不知道相机与人物。
// 06b 1.6（C · 09-08）：可选 pointerHandler —— 玩具 / 热点在 busy 时接管指针（拖星、点着折纸），被接管的指针不转相机不发 tap；射线由 LevelSystem.pointer() 算。
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };      // x 右 +，y 前 +
    this.run = false;
    this.lookDelta = { x: 0, y: 0 }; // 本帧累计像素
    this.zoomDelta = 0;              // 本帧累计（正 = 拉远）
    this.enabled = true;
    this.blocked = false; // Exclusive reading/dialog lock; independent of menu/door enabled changes.
    this.dragonKey = 'Digit8';
    this.transportVertical = { up: false, down: false };
    this.listeners = new Map();
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.joystick = { active: false, id: -1, cx: 0, cy: 0, x: 0, y: 0, mag: 0 };
    this.lookPointers = new Map();
    this._pinchDist = 0;
    // 06b 1.6 指针射线（C · 09-08）：外部挂一个 pointerHandler(phase, p) —— phase 'down' | 'move' | 'up'，p = { x, y, nx, ny（NDC）, button, pointerId, type }。
    // 'down' 返回 true 表示这个指针被热点 / 玩具接管：之后它的 move / up 只走 handler，不再转相机、不发 tap；返回 false 一切照旧。
    this.pointerHandler = null;
    this.capturedPointers = new Set();
    this._capturedInfo = new Map();
    this._bind();
  }

  _pointerInfo(e) {
    const rect = this.canvas.getBoundingClientRect();
    const lx = e.clientX - rect.left, ly = e.clientY - rect.top;
    return { x: e.clientX, y: e.clientY, nx: (lx / rect.width) * 2 - 1, ny: -(ly / rect.height) * 2 + 1, button: e.button, pointerId: e.pointerId, type: e.pointerType };
  }

  on(evt, fn) { (this.listeners.get(evt) || this.listeners.set(evt, []).get(evt)).push(fn); return this; }
  emit(evt, data) { for (const fn of this.listeners.get(evt) || []) fn(data); }

  /** 浏览器失焦/隐藏时，结束所有手势；不能把取消的触碰当成一次点击。 */
  reset() {
    const ids = new Set([...this.lookPointers.keys(), ...this.capturedPointers]);
    if (this.joystick.active) ids.add(this.joystick.id);
    for (const id of this.capturedPointers) {
      const info = this._capturedInfo.get(id);
      if (info && this.pointerHandler) {
        try { this.pointerHandler('up', { ...info, cancelled: true }); } catch (err) { console.warn('pointerHandler cancel 失败', err); }
      }
    }
    this.keys.clear(); this.lookPointers.clear(); this.capturedPointers.clear(); this._capturedInfo.clear();
    this.transportVertical.up = this.transportVertical.down = false;
    this.joystick.active = false; this.joystick.id = -1;
    this.joystick.x = this.joystick.y = this.joystick.mag = 0;
    this.move.x = this.move.y = 0; this.run = false;
    this.lookDelta.x = this.lookDelta.y = this.zoomDelta = this._pinchDist = 0;
    this.emit('joystick', { active: false });
    for (const id of ids) {
      try { if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id); } catch (_) { /* 浏览器可能已经释放 */ }
    }
  }

  _bind() {
    const isTyping = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable);
    window.addEventListener('keydown', (e) => {
      const activatesUI = (e.code === 'Enter' || e.code === 'Space') && e.target?.closest?.('button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"]');
      if (this.blocked || isTyping(e) || activatesUI) return;
      if (e.code === 'Escape') { this.emit('menu'); e.preventDefault(); return; }
      if (e.repeat) return;
      if (e.code === this.dragonKey && this.enabled && !e.ctrlKey && !e.metaKey && !e.altKey) { this.emit('dragon'); e.preventDefault(); return; }
      this.keys.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyE') this.emit('interact');
      if (e.code === 'Enter') this.emit('enter');
      if (e.code === 'KeyH') this.emit('help');
      if (e.code === 'KeyM') this.emit('portal');
      if (e.code === 'Space') this.emit('jump');
      if (e.code === 'KeyF' || e.code === 'KeyJ') this.emit('swing');
      if (e.code === 'Digit1' || e.code === 'KeyQ') this.emit('skill', 'dash');
      if (e.code === 'Digit2' || e.code === 'KeyR') this.emit('skill', 'hex');
      if (e.code === 'Digit3' || e.code === 'KeyT') this.emit('skill', 'rose');
      if (e.code === 'Digit4' || e.code === 'KeyY') this.emit('skill', 'ult');
      if (e.code === 'Digit5' || e.code === 'KeyU') this.emit('skill', 'form');
      if (e.code === 'Digit6' || e.code === 'KeyI') this.emit('skill', 'rift');
      if (e.code === 'Digit7' || e.code === 'KeyO') this.emit('skill', 'wings'); // W-004：翅膀 · 飞行（飞行中 Space 升 / C 降，见 poll）
      if (e.code === 'Backquote' || e.code === 'F9') this.emit('debugToggle');
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) this.emit('move');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });

    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      if (this.blocked || !this.enabled) return;
      c.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') {
        const rect = c.getBoundingClientRect();
        const lx = e.clientX - rect.left, ly = e.clientY - rect.top;
        // 左下 45% 宽 × 55% 高区域是摇杆区
        if (!this.joystick.active && lx < rect.width * 0.45 && ly > rect.height * 0.45) {
          this.joystick.active = true; this.joystick.id = e.pointerId; this.joystick.cx = lx; this.joystick.cy = ly; this.joystick.x = 0; this.joystick.y = 0; this.joystick.mag = 0;
          this.emit('joystick', { active: true, cx: lx, cy: ly, x: 0, y: 0 });
          return;
        }
      }
      // 热点 / 玩具接管（只在 handler 说要的时候）：这个指针后续不转相机、不发 tap
      if (this.pointerHandler) { let took = false; try { took = this.pointerHandler('down', this._pointerInfo(e)) === true; } catch (err) { console.warn('pointerHandler down 失败', err); } if (took) { this.capturedPointers.add(e.pointerId); this._capturedInfo.set(e.pointerId, this._pointerInfo(e)); return; } }
      this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, type: e.pointerType, moved: 0, t: performance.now() });
      if (this.lookPointers.size === 2) {
        const [a, b] = [...this.lookPointers.values()];
        this._pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (this.capturedPointers.has(e.pointerId)) { this._capturedInfo.set(e.pointerId, this._pointerInfo(e)); if (this.pointerHandler) { try { this.pointerHandler('move', this._pointerInfo(e)); } catch (err) { console.warn('pointerHandler move 失败', err); } } return; }
      if (this.blocked || !this.enabled) return;
      if (this.joystick.active && e.pointerId === this.joystick.id) {
        const rect = c.getBoundingClientRect();
        const lx = e.clientX - rect.left, ly = e.clientY - rect.top;
        let dx = lx - this.joystick.cx, dy = ly - this.joystick.cy;
        const R = 60, dead = 0.12;
        let mag = Math.hypot(dx, dy) / R;
        if (mag > 1) { dx /= mag; dy /= mag; mag = 1; }
        const m = mag < dead ? 0 : (mag - dead) / (1 - dead);
        const nx = mag > 0 ? dx / (mag * R) : 0, ny = mag > 0 ? dy / (mag * R) : 0;
        this.joystick.x = nx * m; this.joystick.y = -ny * m; this.joystick.mag = m;
        this.emit('joystick', { active: true, cx: this.joystick.cx, cy: this.joystick.cy, x: dx, y: dy });
        return;
      }
      const p = this.lookPointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.moved += Math.abs(dx) + Math.abs(dy);
      p.x = e.clientX; p.y = e.clientY;
      if (this.lookPointers.size === 2) {
        const [a, b] = [...this.lookPointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinchDist > 0) this.zoomDelta += (this._pinchDist - d) * 0.02;
        this._pinchDist = d;
      } else {
        const k = e.pointerType === 'touch' ? 1.6 : 1;
        this.lookDelta.x += dx * k; this.lookDelta.y += dy * k;
      }
    });
    const up = (e, cancelled = false) => {
      if (this.capturedPointers.has(e.pointerId)) { const info = cancelled ? this._capturedInfo.get(e.pointerId) : this._pointerInfo(e); this.capturedPointers.delete(e.pointerId); this._capturedInfo.delete(e.pointerId); if (this.pointerHandler) { try { this.pointerHandler('up', { ...info, cancelled }); } catch (err) { console.warn('pointerHandler up 失败', err); } } return; }
      if (this.joystick.active && e.pointerId === this.joystick.id) {
        this.joystick.active = false; this.joystick.x = this.joystick.y = this.joystick.mag = 0;
        this.emit('joystick', { active: false });
        return;
      }
      const p = this.lookPointers.get(e.pointerId);
      if (p) {
        // 几乎没动 = 点击（用于点大印记）
        if (!cancelled && this.enabled && p.moved < 6 && performance.now() - p.t < 400) this.emit('tap', { x: e.clientX, y: e.clientY });
        this.lookPointers.delete(e.pointerId);
      }
      this._pinchDist = 0;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => up(e, true));
    c.addEventListener('lostpointercapture', (e) => up(e, true));
    c.addEventListener('wheel', (e) => { if (this.blocked || !this.enabled) return; e.preventDefault(); this.zoomDelta += Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) / 100; }, { passive: false });
  }

  /** 每帧调用：把键盘状态折算成 move 向量，并返回本帧 look / zoom 增量后清零 */
  poll() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    let run = k.has('ShiftLeft') || k.has('ShiftRight');
    if (this.joystick.active && this.joystick.mag > 0) {
      x = this.joystick.x; y = this.joystick.y;
      if (this.joystick.mag > 0.92) run = true;
    }
    let up = k.has('Space') || this.transportVertical.up, down = k.has('KeyC') || this.transportVertical.down; // 飞行用；触屏与键盘共用同一复位路径。
    if (this.blocked || !this.enabled) { x = 0; y = 0; run = false; up = false; down = false; }
    this.move.x = x; this.move.y = y; this.run = run;
    const look = { x: this.lookDelta.x, y: this.lookDelta.y };
    const zoom = this.zoomDelta;
    this.lookDelta.x = this.lookDelta.y = 0; this.zoomDelta = 0;
    return { move: this.move, run, up, down, look, zoom };
  }
}
