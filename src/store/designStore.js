import { create } from 'zustand';

let nextId = 1;
const THEME_STORAGE_KEY = 'pythonizer.theme';

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark';
}

function persistTheme(theme) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export const WIDGET_DEFAULTS = {
  Button: {
    width: 100, height: 32,
    props: { text: 'Button', bg: '#ffffff', fg: '#000000', enabled: true },
  },
  Label: {
    width: 100, height: 25,
    props: { text: 'Label', bg: '#ffffff', fg: '#000000', enabled: true },
  },
  Entry: {
    width: 150, height: 26,
    props: { bg: '#ffffff', fg: '#000000', enabled: true },
  },
  Text: {
    width: 180, height: 80,
    props: { bg: '#ffffff', fg: '#000000', enabled: true },
  },
  Listbox: {
    width: 120, height: 100,
    props: { bg: '#ffffff', fg: '#000000', items: 'Item 1,Item 2,Item 3', enabled: true },
  },
  Checkbutton: {
    width: 120, height: 25,
    props: { text: 'Checkbox', bg: '#ffffff', fg: '#000000', enabled: true },
  },
  Radiobutton: {
    width: 120, height: 25,
    props: { text: 'Option', bg: '#ffffff', fg: '#000000', group: 'group1', value: '1', enabled: true },
  },
  Scale: {
    width: 150, height: 40,
    props: {
      from_: '0', to: '100', orient: 'horizontal', bg: '#ffffff', enabled: true,
      tickinterval: '0', resolution: '1', showvalue: true,
    },
  },
};

export const WIDGET_EVENTS = {
  Button: ['click'],
  Label: [],
  Entry: ['change', 'focus', 'key'],
  Text: ['change', 'key'],
  Listbox: ['select'],
  Checkbutton: ['change'],
  Radiobutton: ['change'],
  Scale: ['change'],
};

const MAX_HISTORY = 100;

function snapshotDesign(s) {
  return {
    widgets: JSON.parse(JSON.stringify(s.widgets)),
    selectedWidgetId: s.selectedWidgetId,
    canvasSize: { ...s.canvasSize },
    windowTitle: s.windowTitle,
    windowResizable: s.windowResizable,
    windowBg: s.windowBg,
  };
}

const useDesignStore = create((set, get) => ({
  // ── Project ──
  projectPath: null,
  projectName: null,

  // ── Design ──
  widgets: [],
  selectedWidgetId: null,
  canvasSize: { width: 500, height: 400 },
  windowTitle: 'My App',
  windowResizable: false,
  windowBg: '#ffffff',

  // ── History ──
  _past: [],
  _future: [],

  _pushHistory: () => {
    const s = get();
    const snap = snapshotDesign(s);
    const past = [...s._past, snap];
    if (past.length > MAX_HISTORY) past.shift();
    set({ _past: past, _future: [] });
  },

  designUndo: () => {
    const s = get();
    if (s._past.length === 0) return;
    const past = [...s._past];
    const snap = past.pop();
    const future = [snapshotDesign(s), ...s._future];
    set({ ...snap, _past: past, _future: future });
  },

  designRedo: () => {
    const s = get();
    if (s._future.length === 0) return;
    const future = [...s._future];
    const snap = future.shift();
    const past = [...s._past, snapshotDesign(s)];
    set({ ...snap, _past: past, _future: future });
  },

  // ── Editor ──
  extraFiles: {},
  userCode: '',
  activeTab: 'main.py',

  // ── Theme ──
  theme: getInitialTheme(),

  // ── Console ──
  consoleOutput: '',
  isRunning: false,

  // ── Theme ──
  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    persistTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    persistTheme(newTheme);
    set({ theme: newTheme });
  },

  // ── Project ──
  setProject: (projectPath, projectName) => set({ projectPath, projectName }),

  loadProject: ({ projectPath, projectData, userCode, extraFiles }) => {
    let maxId = 0;
    for (const w of projectData.widgets || []) {
      const num = parseInt(w.id.replace('widget_', ''), 10);
      if (num > maxId) maxId = num;
    }
    nextId = maxId + 1;
    set({
      projectPath,
      projectName: projectData.name || projectPath.split('/').pop(),
      widgets: projectData.widgets || [],
      windowTitle: projectData.windowTitle || 'My App',
      canvasSize: projectData.canvasSize || { width: 500, height: 400 },
      windowResizable: projectData.windowResizable || false,
      windowBg: projectData.windowBg || '#ffffff',
      userCode: userCode || '',
      extraFiles: extraFiles || {},
      selectedWidgetId: null,
      activeTab: 'main.py',
      consoleOutput: '',
    });
  },

  getProjectData: () => {
    const s = get();
    return {
      version: 1,
      name: s.projectName,
      windowTitle: s.windowTitle,
      canvasSize: s.canvasSize,
      windowResizable: s.windowResizable,
      windowBg: s.windowBg,
      widgets: s.widgets,
      extraFileNames: Object.keys(s.extraFiles),
    };
  },

  clearProject: () => {
    nextId = 1;
    set({
      projectPath: null, projectName: null,
      widgets: [], selectedWidgetId: null,
      windowTitle: 'My App', windowResizable: false, windowBg: '#ffffff',
      userCode: '', extraFiles: {},
      activeTab: 'main.py', consoleOutput: '',
    });
  },

  // ── Canvas / window ──
  setCanvasSize: (size) => set({ canvasSize: size }),
  setWindowTitle: (title) => { get()._pushHistory(); set({ windowTitle: title }); },
  setWindowResizable: (r) => { get()._pushHistory(); set({ windowResizable: r }); },
  setWindowBg: (bg) => { get()._pushHistory(); set({ windowBg: bg }); },

  // ── Widgets ──
  isNameTaken: (name, excludeId) => {
    return get().widgets.some((w) => w.name === name && w.id !== excludeId);
  },

  addWidget: (type, x, y) => {
    const defaults = WIDGET_DEFAULTS[type];
    if (!defaults) return;
    get()._pushHistory();
    const id = `widget_${nextId++}`;
    const prefix = type.toLowerCase();
    // Find first available name
    let idx = 1;
    const existingNames = new Set(get().widgets.map((w) => w.name));
    while (existingNames.has(`${prefix}${idx}`)) idx++;
    const name = `${prefix}${idx}`;
    set((s) => ({
      widgets: [...s.widgets, {
        id, type, name,
        x: x ?? 20,
        y: y ?? 20,
        width: defaults.width, height: defaults.height,
        props: { ...defaults.props },
        events: {},
      }],
      selectedWidgetId: id,
    }));
  },

  updateWidget: (id, updates) => {
    set((s) => ({ widgets: s.widgets.map((w) => (w.id === id ? { ...w, ...updates } : w)) }));
  },

  updateWidgetProps: (id, propUpdates) => {
    get()._pushHistory();
    set((s) => ({
      widgets: s.widgets.map((w) =>
        w.id === id ? { ...w, props: { ...w.props, ...propUpdates } } : w
      ),
    }));
  },

  toggleWidgetEvent: (id, eventName) => {
    get()._pushHistory();
    set((s) => ({
      widgets: s.widgets.map((w) => {
        if (w.id !== id) return w;
        const events = { ...(w.events || {}) };
        events[eventName] = !events[eventName];
        return { ...w, events };
      }),
    }));
  },

  removeWidget: (id) => {
    get()._pushHistory();
    set((s) => ({
      widgets: s.widgets.filter((w) => w.id !== id),
      selectedWidgetId: s.selectedWidgetId === id ? null : s.selectedWidgetId,
    }));
  },

  selectWidget: (id) => set({ selectedWidgetId: id }),

  // ── Extra files ──
  addExtraFile: (name) => {
    const s = get();
    if (name === 'main.py' || name === 'gui.py' || s.extraFiles[name]) return;
    set({ extraFiles: { ...s.extraFiles, [name]: `# ${name}\n` }, activeTab: name });
  },

  removeExtraFile: (name) => {
    const s = get();
    const files = { ...s.extraFiles };
    delete files[name];
    set({ extraFiles: files, activeTab: s.activeTab === name ? 'main.py' : s.activeTab });
  },

  updateExtraFile: (name, code) =>
    set((s) => ({ extraFiles: { ...s.extraFiles, [name]: code } })),

  // ── Editor ──
  setUserCode: (code) => set({ userCode: code }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  // ── Console ──
  setConsoleOutput: (output) => set({ consoleOutput: output }),
  appendConsoleOutput: (text) => set((s) => ({ consoleOutput: s.consoleOutput + text })),
  setIsRunning: (running) => set({ isRunning: running }),
  clearConsole: () => set({ consoleOutput: '' }),
}));

export default useDesignStore;
