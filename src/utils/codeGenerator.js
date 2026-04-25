function esc(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function positiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeUserBlockLines(blockText) {
  const lines = String(blockText || '').replace(/\r/g, '').split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) return [];

  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => (line.match(/^[ \t]*/) || [''])[0].length);
  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;

  return lines.map((line) => {
    if (line.trim() === '') return '';
    return line.slice(commonIndent);
  });
}

function collectEnabledHandlers(widgets) {
  const handlers = [];
  for (const w of widgets) {
    const events = w.events || {};
    for (const [evt, enabled] of Object.entries(events)) {
      if (!enabled) continue;
      const method = `on_${w.name}_${evt}`;
      const args = evt === 'change' && (w.type === 'Scale' || w.type === 'Progressbar') ? 'self, value'
        : evt === 'key' ? 'self, event'
        : 'self';
      handlers.push({ widget: w, event: evt, method, args });
    }
  }
  return handlers;
}

function extractMarkedUserBlocks(code) {
  const blocks = {};
  const re = /# >>> USER CODE START: ([A-Za-z0-9_]+)\n([\s\S]*?)\n\s*# <<< USER CODE END: \1/g;
  let m;
  while ((m = re.exec(String(code || ''))) !== null) {
    blocks[m[1]] = normalizeUserBlockLines(m[2]).join('\n');
  }
  return blocks;
}

function extractLegacyMethodBodies(code) {
  const blocks = {};
  const lines = String(code || '').replace(/\r/g, '').split('\n');
  const generatedHandlersBanner = /^\s{4}#\s*─+\s*Event Handlers/;
  const generatedHandlersBannerNoIndent = /^#\s*─+\s*Event Handlers/;

  for (let i = 0; i < lines.length; i++) {
    const defMatch = lines[i].match(/^\s{4}def\s+([A-Za-z0-9_]+)\([^)]*\):\s*$/);
    if (!defMatch) continue;

    const methodName = defMatch[1];
    const body = [];
    let j = i + 1;
    while (j < lines.length) {
      if (/^\s{4}def\s+/.test(lines[j]) || /^run\(App\)\s*$/.test(lines[j]) || generatedHandlersBanner.test(lines[j])) break;
      body.push(lines[j]);
      j += 1;
    }
    i = j - 1;

    const normalized = normalizeUserBlockLines(body.join('\n'));
    const cleaned = normalized.filter((line) => !generatedHandlersBannerNoIndent.test(line));
    if (cleaned.length) {
      blocks[methodName] = cleaned.join('\n');
    }
  }

  return blocks;
}

function addUserBlockLines(L, key, userBlocks, hintComment) {
  const body = normalizeUserBlockLines(userBlocks[key] || '');
  if (body.length === 0) {
    if (hintComment) L.push(`        ${hintComment}`);
    L.push('        pass');
  } else {
    body.forEach((line) => L.push(`        ${line}`));
  }
}

function isDefaultPygameLoopBody(lines) {
  const nonEmpty = lines.map((line) => line.trim()).filter((line) => line !== '');
  const legacyPatterns = [
    /^# Handle events$/,
    /^for event in pygame\.event\.get\(\):$/,
    /^if event\.type == pygame\.KEYDOWN and event\.key == pygame\.K_SPACE:$/,
    /^pass  # keyboard event$/,
    /^(if|elif) event\.type == pygame\.MOUSEBUTTONDOWN and event\.button == 1:$/,
    /^pass  # mouse click event$/,
    /^# Game logic here$/,
    /^# Draw your scene here$/,
    /^(self\.)?screen\.fill\(\(30, 30, 40\)\)  # background colour$/,
    /^pygame\.display\.update\(\)$/,
    /^# Limit FPS$/,
    /^[A-Za-z_][A-Za-z0-9_]*\.clock\.tick\(([A-Za-z_][A-Za-z0-9_]*\.FPS|FPS)\)$/,
  ];
  const currentPatterns = [
    /^# Handle events$/,
    /^for event in pygame\.event\.get\(\):$/,
    /^if event\.type == pygame\.KEYDOWN and event\.key == pygame\.K_SPACE:$/,
    /^pass  # keyboard event$/,
    /^(if|elif) event\.type == pygame\.MOUSEBUTTONDOWN and event\.button == 1:$/,
    /^pass  # mouse click event$/,
    /^# Game logic here$/,
    /^# Draw your scene here$/,
    /^# Example: screen\.fill\(\(30, 30, 40\)\)$/,
    /^pygame\.display\.update\(\)$/,
    /^# Limit FPS$/,
    /^[A-Za-z_][A-Za-z0-9_]*\.clock\.tick\(([A-Za-z_][A-Za-z0-9_]*\.FPS|FPS)\)$/,
  ];
  const autoPresentPatterns = [
    /^# Handle events$/,
    /^for event in pygame\.event\.get\(\):$/,
    /^if event\.type == pygame\.KEYDOWN and event\.key == pygame\.K_SPACE:$/,
    /^pass  # keyboard event$/,
    /^(if|elif) event\.type == pygame\.MOUSEBUTTONDOWN and event\.button == 1:$/,
    /^pass  # mouse click event$/,
    /^# Game logic here$/,
    /^# Draw your scene here$/,
    /^# Example: screen\.fill\(\(30, 30, 40\)\)$/,
    /^# Limit FPS$/,
    /^[A-Za-z_][A-Za-z0-9_]*\.clock\.tick\(([A-Za-z_][A-Za-z0-9_]*\.FPS|FPS)\)$/,
  ];

  return [legacyPatterns, currentPatterns, autoPresentPatterns].some((patterns) => (
    nonEmpty.length === patterns.length
      && patterns.every((pattern, index) => pattern.test(nonEmpty[index]))
  ));
}

function isDefaultPygameOnStartBody(lines) {
  const nonEmpty = lines.map((line) => line.trim()).filter((line) => line !== '');
  const legacyPatterns = [
    /^# Set up pygame inside the canvas widget \(size must match widget dimensions\)$/,
    /^(self\.)?screen = self\.setup_pygame\([A-Za-z_][A-Za-z0-9_]*, \d+, \d+\)$/,
    /^[A-Za-z_][A-Za-z0-9_]*\.FPS = (30|60)$/,
    /^[A-Za-z_][A-Za-z0-9_]*\.clock = pygame\.time\.Clock\(\)$/,
    /^# Static drawing here \(backgrounds, images etc\.\)$/,
  ];
  const legacyAutoRunPatterns = [
    ...legacyPatterns,
    /^self\._run_loop\(\)$/,
  ];
  const currentPatterns = [
    /^# screen and [A-Za-z_][A-Za-z0-9_]* are ready to use here$/,
    /^pass$/,
  ];
  const shortcutPatterns = [
    /^# screen, [A-Za-z_][A-Za-z0-9_]*, WIDTH, HEIGHT, SIZE, and FPS are ready to use$/,
    /^pass$/,
  ];
  const regularDefaultPatterns = [
    /^# Runs automatically when the app starts\. Use button1, label1 etc\.$/,
    /^pass$/,
  ];

  return [legacyPatterns, legacyAutoRunPatterns, currentPatterns, shortcutPatterns, regularDefaultPatterns].some((patterns) => (
    nonEmpty.length === patterns.length
      && patterns.every((pattern, index) => pattern.test(nonEmpty[index]))
  ));
}

// ══════════════════════════════════════════════════════════
//  gui.py — AUTO-GENERATED (includes boilerplate + runner)
// ══════════════════════════════════════════════════════════
export function generateGuiPy(widgets, windowTitle, canvasSize, windowResizable, windowBg) {
  const L = [];
  const hasPygame = widgets.some((w) => w.type === 'PygameCanvas');
  const hasProgressbar = widgets.some((w) => w.type === 'Progressbar');
  const firstPygame = hasPygame ? widgets.find((w) => w.type === 'PygameCanvas') : null;
  const firstPygameFullscreen = hasPygame ? !!firstPygame.props?.fullscreen : false;
  const firstPygameWidth = hasPygame ? (firstPygameFullscreen ? canvasSize.width : firstPygame.width) : 0;
  const firstPygameHeight = hasPygame ? (firstPygameFullscreen ? canvasSize.height : firstPygame.height) : 0;
  const firstPygameFps = hasPygame ? Math.min(240, positiveInt(firstPygame.props?.fps, 30)) : 30;
  const firstPygameBg = hasPygame ? (firstPygame.props?.bg || '#1e1e2e') : '#000000';

  L.push('# ──────────────────────────────────────────────');
  L.push('# gui.py — AUTO-GENERATED by Pythonizer');
  L.push('# Do not edit this file. Use main.py instead.');
  L.push('# ──────────────────────────────────────────────');
  L.push('import tkinter as tk');
  L.push('from tkinter import messagebox');
  if (hasPygame) {
    L.push('import sys');
    L.push('import os');
    L.push('os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")');
  }
  L.push('');
  L.push('');
  if (hasProgressbar) {
    L.push('class _PythonizerProgressbar(tk.Canvas):');
    L.push('    def __init__(self, master, value=0, maximum=100, orient="horizontal", bg="#e0e0e0", fill="#2f80ed", enabled=True, **kwargs):');
    L.push('        super().__init__(master, bg=bg, bd=0, highlightthickness=0, **kwargs)');
    L.push('        self.maximum = max(float(maximum), 1.0)');
    L.push('        self.value = max(0.0, min(float(value), self.maximum))');
    L.push('        self.orient = orient');
    L.push('        self.fill = fill');
    L.push('        self.track = bg');
    L.push('        self.enabled = enabled');
    L.push('        self.command = None');
    L.push('        self.bind("<Configure>", lambda event: self._draw())');
    L.push('        self._draw()');
    L.push('');
    L.push('    def _draw(self):');
    L.push('        self.delete("bar")');
    L.push('        width = max(1, self.winfo_width())');
    L.push('        height = max(1, self.winfo_height())');
    L.push('        ratio = 0 if self.maximum <= 0 else max(0, min(1, self.value / self.maximum))');
    L.push('        color = self.fill if self.enabled else "#9aa0a6"');
    L.push('        if self.orient == "vertical":');
    L.push('            filled = height * ratio');
    L.push('            self.create_rectangle(0, height - filled, width, height, fill=color, outline="", tags="bar")');
    L.push('        else:');
    L.push('            filled = width * ratio');
    L.push('            self.create_rectangle(0, 0, filled, height, fill=color, outline="", tags="bar")');
    L.push('');
    L.push('    def set(self, value):');
    L.push('        old_value = self.value');
    L.push('        self.value = max(0.0, min(float(value), self.maximum))');
    L.push('        self._draw()');
    L.push('        if self.command and self.value != old_value:');
    L.push('            self.command(self.value)');
    L.push('');
    L.push('    def get(self):');
    L.push('        return self.value');
    L.push('');
    L.push('    def set_command(self, command):');
    L.push('        self.command = command');
    L.push('');
    L.push('    def set_maximum(self, maximum):');
    L.push('        self.maximum = max(float(maximum), 1.0)');
    L.push('        self.value = min(self.value, self.maximum)');
    L.push('        self._draw()');
    L.push('');
    L.push('    def set_fill(self, fill):');
    L.push('        self.fill = fill');
    L.push('        self._draw()');
    L.push('');
    L.push('    def set_background(self, bg):');
    L.push('        self.track = bg');
    L.push('        self.configure(bg=bg)');
    L.push('        self._draw()');
    L.push('');
    L.push('    def set_enabled(self, enabled):');
    L.push('        self.enabled = bool(enabled)');
    L.push('        self._draw()');
    L.push('');
    L.push('');
  }
  L.push('class AppGUI:');
  L.push('    """Base GUI class. All widgets are created here."""');
  L.push('');
  L.push('    def __init__(self, root):');
  L.push('        self.root = root');
  L.push(`        self.root.title("${esc(windowTitle)}")`);
  L.push(`        self.root.geometry("${canvasSize.width}x${canvasSize.height}")`);
  L.push(`        self.root.resizable(${windowResizable ? 'True, True' : 'False, False'})`);
  L.push(`        self.root.configure(bg="${windowBg || '#ffffff'}")`);
  L.push('');
  L.push('        self._create_widgets()');
  if (hasPygame) {
    L.push(`        self._pygame_canvas_name = "${esc(firstPygame.name)}"`);
    L.push(`        self.setup_pygame(self.${firstPygame.name}, ${firstPygameWidth}, ${firstPygameHeight}, ${firstPygameFps}, "${esc(firstPygameBg)}", ${firstPygameFullscreen ? 'True' : 'False'})`);
    L.push(`        self.${firstPygame.name} = self.screen`);
    if (firstPygameFullscreen) {
      L.push('        self.root.bind("<Configure>", self._resize_fullscreen_pygame, add="+")');
    }
  }
  L.push('        self._bind_events()');
  L.push('        self._expose_widgets()');
  L.push('        self.on_start()');
  if (hasPygame) {
    L.push('        if hasattr(self, "screen"):');
    L.push('            self._run_loop()');
  }
  L.push('');
  L.push('    def _create_widgets(self):');

  if (widgets.length === 0) {
    L.push('        pass');
  } else {
    const radioGroups = new Set();

    for (const w of widgets) {
      L.push('');
      const dis = w.props.enabled === false ? ', state="disabled"' : '';
      const widgetBg = w.props.bg || '#ffffff';
      const widgetFg = w.props.fg || '#000000';

      switch (w.type) {
        case 'Button':
          L.push(`        self.${w.name} = tk.Button(self.root, text="${esc(w.props.text)}"${dis})`);
          L.push(`        self.${w.name}.config(bg="${widgetBg}", fg="${widgetFg}", activebackground="${widgetBg}", activeforeground="${widgetFg}")`);
          L.push(`        self.${w.name}.place(x=${w.x}, y=${w.y}, width=${w.width}, height=${w.height})`);
          break;

        case 'Label':
          L.push(`        self.${w.name} = tk.Label(self.root, text="${esc(w.props.text)}"${dis})`);
          L.push(`        self.${w.name}.config(bg="${widgetBg}", fg="${widgetFg}")`);
          L.push(`        self.${w.name}.place(x=${w.x}, y=${w.y}, width=${w.width}, height=${w.height})`);
          break;

        case 'Entry':
          L.push(`        self.${w.name} = tk.Entry(self.root${dis})`);
          L.push(`        self.${w.name}.config(bg="${widgetBg}", fg="${widgetFg}", insertbackground="${widgetFg}")`);
          L.push(`        self.${w.name}.place(x=${w.x}, y=${w.y}, width=${w.width}, height=${w.height})`);
          break;

        case 'Text':
          L.push(`        self.${w.name} = tk.Text(self.root${dis})`);
          L.push(`        self.${w.name}.config(bg="${widgetBg}", fg="${widgetFg}", insertbackground="${widgetFg}")`);
          L.push(`        self.${w.name}.place(x=${w.x}, y=${w.y}, width=${w.width}, height=${w.height})`);
          break;

        case 'Listbox':
          L.push(`        self.${w.name} = tk.Listbox(self.root${dis})`);
          L.push(`        self.${w.name}.config(bg="${widgetBg}", fg="${widgetFg}")`);
          if (w.props.items) {
            w.props.items.split(',').map((s) => s.trim()).forEach((item, i) => {
              L.push(`        self.${w.name}.insert(${i}, "${esc(item)}")`);
            });
          }
          L.push(`        self.${w.name}.place(x=${w.x}, y=${w.y}, width=${w.width}, height=${w.height})`);
          break;

        case 'Checkbutton':
          L.push(`        self.${w.name}_var = tk.BooleanVar()`);
          L.push(`        self.${w.name} = tk.Checkbutton(self.root, text="${esc(w.props.text)}", variable=self.${w.name}_var${dis})`);
          L.push(`        self.${w.name}.config(bg="${widgetBg}", fg="${widgetFg}", activebackground="${widgetBg}", activeforeground="${widgetFg}", selectcolor="#ffffff")`);
          L.push(`        self.${w.name}.place(x=${w.x}, y=${w.y}, width=${w.width}, height=${w.height})`);
          break;

        case 'Radiobutton': {
          const grp = w.props.group || 'group1';
          if (!radioGroups.has(grp)) {
            radioGroups.add(grp);
            L.push(`        self.${grp}_var = tk.StringVar(value="")`);
          }
          L.push(`        self.${w.name} = tk.Radiobutton(self.root, text="${esc(w.props.text)}", variable=self.${grp}_var, value="${esc(w.props.value)}"${dis})`);
          L.push(`        self.${w.name}.config(bg="${widgetBg}", fg="${widgetFg}", activebackground="${widgetBg}", activeforeground="${widgetFg}", selectcolor="#ffffff")`);
          L.push(`        self.${w.name}.place(x=${w.x}, y=${w.y}, width=${w.width}, height=${w.height})`);
          break;
        }

        case 'Scale': {
          const tickInt = parseInt(w.props.tickinterval) || 0;
          const resolution = parseFloat(w.props.resolution) || 1;
          const showVal = w.props.showvalue !== false;
          let scaleOpts = `from_=${w.props.from_}, to=${w.props.to}, orient=tk.${(w.props.orient || 'horizontal').toUpperCase()}`;
          if (tickInt > 0) scaleOpts += `, tickinterval=${tickInt}`;
          if (resolution !== 1) scaleOpts += `, resolution=${resolution}`;
          if (!showVal) scaleOpts += ', showvalue=False';
          L.push(`        self.${w.name} = tk.Scale(self.root, ${scaleOpts}${dis})`);
          L.push(`        self.${w.name}.config(bg="${widgetBg}", fg="${widgetFg}", troughcolor="#e0e0e0", highlightthickness=0)`);
          L.push(`        self.${w.name}.place(x=${w.x}, y=${w.y}, width=${w.width}, height=${w.height})`);
          break;
        }

        case 'Progressbar': {
          const maximum = Math.max(1, finiteNumber(w.props.maximum, 100));
          const value = clampNumber(finiteNumber(w.props.value, 0), 0, maximum);
          const orient = w.props.orient === 'vertical' ? 'vertical' : 'horizontal';
          const fill = w.props.fill || '#2f80ed';
          const enabled = w.props.enabled !== false;
          L.push(`        self.${w.name} = _PythonizerProgressbar(self.root, value=${value}, maximum=${maximum}, orient="${orient}", bg="${widgetBg}", fill="${fill}", enabled=${enabled ? 'True' : 'False'})`);
          L.push(`        self.${w.name}.place(x=${w.x}, y=${w.y}, width=${w.width}, height=${w.height})`);
          break;
        }

        case 'PygameCanvas': {
          const fullscreen = !!w.props.fullscreen;
          const width = fullscreen ? canvasSize.width : w.width;
          const height = fullscreen ? canvasSize.height : w.height;
          L.push(`        self.${w.name} = tk.Frame(self.root, bg="${w.props.bg || '#1e1e2e'}", bd=0, highlightthickness=0)`);
          if (fullscreen) {
            L.push(`        self.${w.name}.place(x=0, y=0, relwidth=1, relheight=1)`);
          } else {
            L.push(`        self.${w.name}.place(x=${w.x}, y=${w.y}, width=${width}, height=${height})`);
          }
          break;
        }
      }
    }
  }

  // ── _bind_events ──
  L.push('');
  L.push('    def _bind_events(self):');
  const bindings = [];
  for (const w of widgets) {
    const events = w.events || {};
    for (const [evt, enabled] of Object.entries(events)) {
      if (!enabled) continue;
      switch (evt) {
        case 'click':
          bindings.push(`        self.${w.name}.config(command=self.on_${w.name}_click)`);
          break;
        case 'change':
          if (w.type === 'Scale') {
            bindings.push(`        self.${w.name}.config(command=self.on_${w.name}_change)`);
          } else if (w.type === 'Progressbar') {
            bindings.push(`        self.${w.name}.set_command(self.on_${w.name}_change)`);
          } else if (w.type === 'Checkbutton' || w.type === 'Radiobutton') {
            bindings.push(`        self.${w.name}.config(command=self.on_${w.name}_change)`);
          } else if (w.type === 'Entry') {
            bindings.push(`        self.${w.name}.bind("<KeyRelease>", lambda e: self.on_${w.name}_change())`);
          } else if (w.type === 'Text') {
            bindings.push(`        self.${w.name}.bind("<KeyRelease>", lambda e: self.on_${w.name}_change())`);
          }
          break;
        case 'select':
          bindings.push(`        self.${w.name}.bind("<<ListboxSelect>>", lambda e: self.on_${w.name}_select())`);
          break;
        case 'focus':
          bindings.push(`        self.${w.name}.bind("<FocusIn>", lambda e: self.on_${w.name}_focus())`);
          break;
        case 'key':
          bindings.push(`        self.${w.name}.bind("<Key>", lambda e: self.on_${w.name}_key(e))`);
          break;
      }
    }
  }
  if (bindings.length === 0) {
    L.push('        pass');
  } else {
    L.push(...bindings);
  }

  // ── _expose_widgets: make widgets available as module-level globals ──
  L.push('');
  L.push('    def _expose_widgets(self):');
  L.push('        import sys');
  L.push('        m = sys.modules.get("__main__")');
  L.push('        if m:');
  L.push('            for k, v in vars(self).items():');
  L.push('                if not k.startswith("_") and k != "root":');
  L.push('                    setattr(m, k, v)');

  // ── on_start stub (overridden in main.py) ──
  L.push('');
  L.push('    def on_start(self):');
  L.push('        """Override this in main.py to run code at startup."""');
  L.push('        pass');

  // ── setup_pygame helper (only when a PygameCanvas widget exists) ──
  if (hasPygame) {
    L.push('');
    L.push('    def setup_pygame(self, frame, width, height, fps=30, bg="#000000", fullscreen=False):');
    L.push('        """Embed a pygame surface into a tkinter frame.');
    L.push('        Works on Windows and Linux. On macOS Pythonizer renders pygame into tkinter.');
    L.push('        Pythonizer calls this automatically for the first pygame canvas."""');
    L.push('        frame.update_idletasks()');
    L.push('        frame.update()');
    L.push('        os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")');
    L.push('        if sys.platform != "darwin":');
    L.push('            os.environ["SDL_WINDOWID"] = str(frame.winfo_id())');
    L.push('            if sys.platform.startswith("linux"):');
    L.push('                os.environ.setdefault("SDL_VIDEODRIVER", "x11")');
    L.push('        try:');
    L.push('            import pygame');
    L.push('        except ModuleNotFoundError as exc:');
    L.push('            raise RuntimeError("This project uses a pygame canvas, but pygame is not installed for the selected Python interpreter.") from exc');
    L.push('        pygame.init()');
    L.push('        class _PythonizerCanvas(pygame.Surface):');
    L.push('            def __init__(self, size, widget, fps_value, background):');
    L.push('                super().__init__(size)');
    L.push('                self.widget = widget');
    L.push('                self.clock = pygame.time.Clock()');
    L.push('                self.FPS = fps_value');
    L.push('                self.WIDTH = size[0]');
    L.push('                self.HEIGHT = size[1]');
    L.push('                self.SIZE = size');
    L.push('                self.BACKGROUND = background');
    L.push('        self._pygame_canvas_class = _PythonizerCanvas');
    L.push('        self._pygame_fullscreen = fullscreen');
    L.push('        if sys.platform == "darwin":');
    L.push('            host = tk.Canvas(frame, bd=0, highlightthickness=0, bg=frame.cget("bg"))');
    L.push('            if fullscreen:');
    L.push('                host.place(x=0, y=0, relwidth=1, relheight=1)');
    L.push('            else:');
    L.push('                host.place(x=0, y=0, width=width, height=height)');
    L.push('            host.configure(takefocus=1)');
    L.push('            host.tk.call("raise", host._w)');
    L.push('            frame.configure(takefocus=1)');
    L.push('            self._pygame_mac_host = host');
    L.push('            self._pygame_mac_image_id = None');
    L.push('            self._pygame_mac_size = (width, height)');
    L.push('            self._pygame_mac_image = None');
    L.push('            def _key_code(event):');
    L.push('                name = (event.keysym or "").lower()');
    L.push('                try:');
    L.push('                    return pygame.key.key_code(name)');
    L.push('                except Exception:');
    L.push('                    return 0');
    L.push('            def _bind_target(widget):');
    L.push('                widget.bind("<Button-1>", lambda e: widget.focus_set())');
    L.push('                widget.bind("<Motion>", lambda e: pygame.event.post(pygame.event.Event(pygame.MOUSEMOTION, {"pos": (e.x, e.y), "rel": (0, 0), "buttons": (0, 0, 0)})))');
    L.push('                widget.bind("<ButtonPress-1>", lambda e: pygame.event.post(pygame.event.Event(pygame.MOUSEBUTTONDOWN, {"pos": (e.x, e.y), "button": 1})))');
    L.push('                widget.bind("<ButtonRelease-1>", lambda e: pygame.event.post(pygame.event.Event(pygame.MOUSEBUTTONUP, {"pos": (e.x, e.y), "button": 1})))');
    L.push('                widget.bind("<KeyPress>", lambda e: pygame.event.post(pygame.event.Event(pygame.KEYDOWN, {"key": _key_code(e), "unicode": e.char or ""})))');
    L.push('                widget.bind("<KeyRelease>", lambda e: pygame.event.post(pygame.event.Event(pygame.KEYUP, {"key": _key_code(e)})))');
    L.push('            _bind_target(frame)');
    L.push('            _bind_target(host)');
    L.push('            display = None');
    L.push('        else:');
    L.push('            display = pygame.display.set_mode((width, height))');
    L.push('        screen = _PythonizerCanvas((width, height), frame, fps, bg)');
    L.push('        screen.fill(bg)');
    L.push('        frame.FPS = screen.FPS');
    L.push('        frame.clock = screen.clock');
    L.push('        self._pygame_canvas = screen');
    L.push('        self._pygame_widget = frame');
    L.push('        self._pygame_display = display');
    L.push('        self._pygame_background = bg');
    L.push('        self.screen = screen');
    L.push('        self.WIDTH = width');
    L.push('        self.HEIGHT = height');
    L.push('        self.SIZE = (width, height)');
    L.push('        self.FPS = screen.FPS');
    L.push('        self._pygame_last_synced_fps = screen.FPS');
    L.push('        if sys.platform == "darwin":');
    L.push('            self._pygame_mac_present_requested = True');
    L.push('            def _display_update(*args, **kwargs):');
    L.push('                self._pygame_mac_present_requested = True');
    L.push('            pygame.display.update = _display_update');
    L.push('            pygame.display.flip = _display_update');
    L.push('            pygame.display.get_surface = lambda: screen');
    L.push('        m = sys.modules.get("__main__")');
    L.push('        if m:');
    L.push('            setattr(m, "screen", screen)');
    L.push('            setattr(m, "WIDTH", width)');
    L.push('            setattr(m, "HEIGHT", height)');
    L.push('            setattr(m, "SIZE", (width, height))');
    L.push('            setattr(m, "FPS", screen.FPS)');
    L.push('        return screen');
    L.push('');
    L.push('    def _publish_pygame_shortcuts(self):');
    L.push('        m = sys.modules.get("__main__")');
    L.push('        if m:');
    L.push('            setattr(m, "screen", self.screen)');
    L.push('            setattr(m, "WIDTH", self.WIDTH)');
    L.push('            setattr(m, "HEIGHT", self.HEIGHT)');
    L.push('            setattr(m, "SIZE", self.SIZE)');
    L.push('            setattr(m, "FPS", self.FPS)');
    L.push('            name = getattr(self, "_pygame_canvas_name", None)');
    L.push('            if name:');
    L.push('                setattr(m, name, self.screen)');
    L.push('');
    L.push('    def _replace_pygame_surface(self, width, height):');
    L.push('        import pygame');
    L.push('        width = max(1, int(width))');
    L.push('        height = max(1, int(height))');
    L.push('        current = getattr(self, "screen", None)');
    L.push('        if current is not None and getattr(current, "WIDTH", None) == width and getattr(current, "HEIGHT", None) == height:');
    L.push('            return');
    L.push('        canvas_class = getattr(self, "_pygame_canvas_class", None)');
    L.push('        widget = getattr(self, "_pygame_widget", None)');
    L.push('        if canvas_class is None or widget is None:');
    L.push('            return');
    L.push('        fps = getattr(current, "FPS", getattr(self, "FPS", 30))');
    L.push('        clock = getattr(current, "clock", pygame.time.Clock())');
    L.push('        bg = getattr(current, "BACKGROUND", self._pygame_background)');
    L.push('        new_screen = canvas_class((width, height), widget, fps, bg)');
    L.push('        new_screen.clock = clock');
    L.push('        new_screen.fill(bg)');
    L.push('        if current is not None:');
    L.push('            new_screen.blit(current, (0, 0))');
    L.push('        self.screen = new_screen');
    L.push('        self._pygame_canvas = new_screen');
    L.push('        self.WIDTH = width');
    L.push('        self.HEIGHT = height');
    L.push('        self.SIZE = (width, height)');
    L.push('        self.FPS = fps');
    L.push('        name = getattr(self, "_pygame_canvas_name", None)');
    L.push('        if name:');
    L.push('            setattr(self, name, new_screen)');
    L.push('        if sys.platform == "darwin":');
    L.push('            self._pygame_mac_size = (width, height)');
    L.push('            if hasattr(self, "_pygame_mac_host") and not getattr(self, "_pygame_fullscreen", False):');
    L.push('                self._pygame_mac_host.place_configure(width=width, height=height)');
    L.push('            self._pygame_mac_present_requested = True');
    L.push('        else:');
    L.push('            self._pygame_display = pygame.display.set_mode((width, height))');
    L.push('        self._publish_pygame_shortcuts()');
    L.push('');
    L.push('    def _resize_fullscreen_pygame(self, event=None):');
    L.push('        if not getattr(self, "_pygame_fullscreen", False):');
    L.push('            return');
    L.push('        if event is not None and event.widget is not self.root:');
    L.push('            return');
    L.push('        self._replace_pygame_surface(self.root.winfo_width(), self.root.winfo_height())');
    L.push('');
    L.push('    def _sync_pygame_shortcuts(self):');
    L.push('        m = sys.modules.get("__main__")');
    L.push('        canvas = getattr(self, "_pygame_canvas", None)');
    L.push('        if not m or canvas is None:');
    L.push('            return');
    L.push('        last = getattr(self, "_pygame_last_synced_fps", canvas.FPS)');
    L.push('        module_fps = getattr(m, "FPS", canvas.FPS)');
    L.push('        try:');
    L.push('            module_fps = int(module_fps)');
    L.push('        except (TypeError, ValueError):');
    L.push('            module_fps = int(last)');
    L.push('        try:');
    L.push('            canvas_fps = int(canvas.FPS)');
    L.push('        except (TypeError, ValueError):');
    L.push('            canvas_fps = int(last)');
    L.push('        if module_fps != last:');
    L.push('            canvas.FPS = module_fps');
    L.push('            canvas_fps = module_fps');
    L.push('        else:');
    L.push('            canvas.FPS = canvas_fps');
    L.push('        fps = canvas_fps');
    L.push('        self.FPS = fps');
    L.push('        setattr(m, "FPS", fps)');
    L.push('        self._pygame_last_synced_fps = fps');
    L.push('');
    L.push('    def _present_pygame(self):');
    L.push('        import pygame');
    L.push('        if sys.platform == "darwin" and hasattr(self, "_pygame_mac_host"):');
    L.push('            width, height = self._pygame_mac_size');
    L.push('            rgb = pygame.image.tostring(self.screen, "RGB")');
    L.push('            ppm = f"P6\\n{width} {height}\\n255\\n".encode("ascii") + rgb');
    L.push('            self._pygame_mac_image = tk.PhotoImage(master=self.root, data=ppm, format="PPM")');
    L.push('            if self._pygame_mac_image_id is None:');
    L.push('                self._pygame_mac_image_id = self._pygame_mac_host.create_image(0, 0, anchor="nw", image=self._pygame_mac_image)');
    L.push('            else:');
    L.push('                self._pygame_mac_host.itemconfig(self._pygame_mac_image_id, image=self._pygame_mac_image)');
    L.push('            self._pygame_mac_host.image = self._pygame_mac_image');
    L.push('            self._pygame_mac_host.tk.call("raise", self._pygame_mac_host._w)');
    L.push('            self._pygame_mac_host.update_idletasks()');
    L.push('            self._pygame_mac_present_requested = False');
    L.push('        else:');
    L.push('            if hasattr(self, "_pygame_display") and self._pygame_display is not None:');
    L.push('                self._pygame_display.blit(self.screen, (0, 0))');
    L.push('            pygame.display.update()');
    L.push('');
    L.push('    def _run_loop(self):');
    L.push('        try:');
    L.push('            if not self.root.winfo_exists():');
    L.push('                return');
    L.push('            self._sync_pygame_shortcuts()');
    L.push('            self.screen.fill(getattr(self.screen, "BACKGROUND", self._pygame_background))');
    L.push('            self._game_loop()');
    L.push('            self._sync_pygame_shortcuts()');
    L.push('            self._present_pygame()');
    L.push('            if self.root.winfo_exists():');
    L.push('                self.root.after(1, self._run_loop)');
    L.push('        except tk.TclError:');
    L.push('            return');
  }

  // ── Event handler stubs (so base class doesn't crash if student forgets) ──
  for (const w of widgets) {
    const events = w.events || {};
    for (const [evt, enabled] of Object.entries(events)) {
      if (!enabled) continue;
      L.push('');
      if (evt === 'change' && (w.type === 'Scale' || w.type === 'Progressbar')) {
        L.push(`    def on_${w.name}_change(self, value):`);
      } else if (evt === 'key') {
        L.push(`    def on_${w.name}_key(self, event):`);
      } else {
        L.push(`    def on_${w.name}_${evt}(self):`);
      }
      L.push('        pass');
    }
  }

  // ── run() helper ──
  L.push('');
  L.push('');
  L.push('def run(app_class):');
  L.push('    """Launch the app. Called from main.py."""');
  L.push('    root = tk.Tk()');
  L.push('    app_class(root)');
  L.push('    root.mainloop()');
  L.push('');

  return L.join('\n');
}

// ══════════════════════════════════════════════════════════
//  main.py — STUDENT CODE (minimal template)
// ══════════════════════════════════════════════════════════
export function generateMainPyTemplate(widgets, userBlocks = {}) {
  const L = [];
  const handlers = collectEnabledHandlers(widgets);
  const pygameWidgets = widgets.filter((w) => w.type === 'PygameCanvas');
  const hasPygame = pygameWidgets.length > 0;
  const firstPygame = hasPygame ? pygameWidgets[0] : null;

  L.push('from gui import AppGUI, run');
  if (hasPygame) {
    L.push('import pygame');
  }
  L.push('');
  L.push('');
  L.push('class App(AppGUI):');
  if (hasPygame) {
    L.push(`    # screen, ${firstPygame.name}, WIDTH, HEIGHT, SIZE, and FPS are ready to use`);
  }
  L.push('');
  L.push('    def on_start(self):');

  // on_start body — pygame gets richer starter hints
  const onStartBody = normalizeUserBlockLines(userBlocks['on_start'] || '');
  if (onStartBody.length > 0 && !isDefaultPygameOnStartBody(onStartBody)) {
    onStartBody.forEach((line) => L.push(`        ${line}`));
  } else if (hasPygame) {
    L.push('        pass');
  } else {
    L.push('        # Runs automatically when the app starts. Use button1, label1 etc.');
    L.push('        pass');
  }

  if (handlers.length > 0) {
    L.push('');
    L.push('    # ── Event Handlers ─────────────────────────');
    for (const h of handlers) {
      L.push('');
      L.push(`    def ${h.method}(${h.args}):`);
      addUserBlockLines(L, h.method, userBlocks, `# Called on ${h.event} for ${h.widget.name}. Use ${h.widget.name} directly.`);
    }
  }

  // Pygame game loop method
  if (hasPygame) {
    L.push('');
    L.push('    def _game_loop(self):');
    const loopBody = normalizeUserBlockLines(userBlocks['_game_loop'] || '');
    if (loopBody.length > 0 && !isDefaultPygameLoopBody(loopBody)) {
      loopBody.forEach((line) => L.push(`        ${line}`));
    } else {
      const cn = firstPygame.name;
      L.push('        # Handle events');
      L.push('        for event in pygame.event.get():');
      L.push('            if event.type == pygame.KEYDOWN and event.key == pygame.K_SPACE:');
      L.push('                pass  # keyboard event');
      L.push('            elif event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:');
      L.push('                pass  # mouse click event');
      L.push('');
      L.push('        # Game logic here');
      L.push('');
      L.push('        # Draw your scene here');
      L.push('        # Example: screen.fill((30, 30, 40))');
      L.push('        pygame.display.update()');
      L.push('');
      L.push('        # Limit FPS');
      L.push(`        ${cn}.clock.tick(FPS)`);
    }
  }

  L.push('');
  L.push('');
  L.push('run(App)');
  L.push('');

  return L.join('\n');
}

function collectUserBlocks(mainPyCode, fallbackCode = '') {
  const marked = extractMarkedUserBlocks(mainPyCode);
  if (Object.keys(marked).length > 0) return marked;

  const legacyMain = extractLegacyMethodBodies(mainPyCode);
  const legacyFallback = extractLegacyMethodBodies(fallbackCode);
  return { ...legacyFallback, ...legacyMain };
}

export function enforceMainPyTemplate(mainPyCode, widgets, fallbackCode = '') {
  const userBlocks = collectUserBlocks(mainPyCode, fallbackCode);
  return generateMainPyTemplate(widgets, userBlocks);
}
