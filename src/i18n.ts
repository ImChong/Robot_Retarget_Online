import { computed, ref } from 'vue';

export type Locale = 'zh' | 'en';

const STORAGE_KEY = 'rro-locale';

const messages: Record<string, { zh: string; en: string }> = {
  appTitle: { zh: '在线机器人动作重定向', en: 'Robot Retarget Online' },
  /** Bilingual site header — always English | 中文 regardless of locale */
  appTitleBilingual: { zh: 'Robot Retarget Online | 在线机器人动作重定向', en: 'Robot Retarget Online | 在线机器人动作重定向' },
  navBvh: { zh: 'BVH 预览', en: 'BVH Viewer' },
  navConfig: { zh: '重定向设置', en: 'Retarget Config' },
  navPreview: { zh: '重定向预览', en: 'Retarget Preview' },

  openBvh: { zh: '打开 BVH 文件', en: 'Open BVH File' },
  loadSample: { zh: '加载示例动作', en: 'Load Sample Motion' },
  dropHint: { zh: '拖拽 .bvh 文件到此处，或点击上方按钮选择文件', en: 'Drag & drop a .bvh file here, or use the button above' },
  dropNow: { zh: '松开以加载 BVH 文件', en: 'Release to load the BVH file' },
  motionInfo: { zh: '动作信息', en: 'Motion Info' },
  fileName: { zh: '文件', en: 'File' },
  frames: { zh: '帧数', en: 'Frames' },
  duration: { zh: '时长', en: 'Duration' },
  joints: { zh: '关节数', en: 'Joints' },
  estHeight: { zh: '估计身高', en: 'Est. height' },
  units: { zh: '单位', en: 'Units' },
  jointTree: { zh: '关节层级', en: 'Joint Hierarchy' },
  playbackSpeed: { zh: '速度', en: 'Speed' },
  loop: { zh: '循环', en: 'Loop' },
  showNames: { zh: '显示关节名', en: 'Joint labels' },
  noMotion: { zh: '尚未加载动作', en: 'No motion loaded' },
  noMotionHint: { zh: '请先在「BVH 预览」页加载动作', en: 'Load a motion in the BVH Viewer page first' },
  frame: { zh: '帧', en: 'Frame' },

  robot: { zh: '机器人', en: 'Robot' },
  loadingRobot: { zh: '正在加载机器人模型…', en: 'Loading robot model…' },
  robotLoadComplete: { zh: '机器人模型加载完成', en: 'Robot model loaded' },
  loadingMujoco: { zh: '正在初始化 MuJoCo (WASM)…', en: 'Initializing MuJoCo (WASM)…' },
  globalParams: { zh: '全局参数', en: 'Global Parameters' },
  actualHumanHeight: { zh: '人体实际身高 (m)', en: 'Actual human height (m)' },
  heightAssumption: { zh: '配置假设身高 (m)', en: 'Config height assumption (m)' },
  groundHeight: { zh: '地面高度偏移 (m)', en: 'Ground height offset (m)' },
  solverParams: { zh: '求解器参数', en: 'Solver Parameters' },
  damping: { zh: '阻尼 (damping)', en: 'Damping' },
  maxIter: { zh: '每帧最大迭代', en: 'Max iterations / frame' },
  velocityLimit: { zh: '关节速度限制', en: 'Joint velocity limit' },
  scaleTable: { zh: '人体缩放表', en: 'Human Scale Table' },
  stage1: { zh: '阶段 1（姿态主导）', en: 'Stage 1 (orientation-driven)' },
  stage2: { zh: '阶段 2（位置精调）', en: 'Stage 2 (position refinement)' },
  robotBody: { zh: '机器人身体', en: 'Robot body' },
  humanJoint: { zh: '人体关节', en: 'Human joint' },
  posWeight: { zh: '位置权重', en: 'Pos weight' },
  rotWeight: { zh: '旋转权重', en: 'Rot weight' },
  posOffset: { zh: '位置偏移', en: 'Pos offset' },
  rotOffset: { zh: '旋转偏移 (wxyz)', en: 'Rot offset (wxyz)' },
  importConfig: { zh: '导入配置', en: 'Import Config' },
  exportConfig: { zh: '导出配置', en: 'Export Config' },
  resetConfig: { zh: '恢复默认', en: 'Reset to Default' },
  configHint: {
    zh: '配置与 GMR 的 ik_config JSON 格式完全兼容，可直接用于 GMR Python 管线。',
    en: 'The config is fully compatible with GMR ik_config JSON and can be used directly in the GMR Python pipeline.',
  },
  showLines: { zh: '显示对应关系', en: 'Correspondence lines' },
  showHuman: { zh: '显示人体骨架', en: 'Show human skeleton' },

  runRetarget: { zh: '开始重定向', en: 'Run Retargeting' },
  cancel: { zh: '取消', en: 'Cancel' },
  retargeting: { zh: '重定向中', en: 'Retargeting' },
  retargetDone: { zh: '重定向完成', en: 'Retargeting complete' },
  showGhost: { zh: '叠加人体关键点', en: 'Overlay human keypoints' },
  export: { zh: '导出', en: 'Export' },
  exportNpz: { zh: '导出 NPZ（GMR 格式）', en: 'Export NPZ (GMR format)' },
  exportCsv: { zh: '导出 CSV', en: 'Export CSV' },
  exportJson: { zh: '导出 JSON', en: 'Export JSON' },
  errorChart: { zh: '关键点位置误差', en: 'Keypoint position error' },
  jointPositionChart: { zh: '关节位置', en: 'Joint position' },
  jointVelocityChart: { zh: '关节速度', en: 'Joint velocity' },
  selectJoints: { zh: '选择关节', en: 'Select joints' },
  selectJointsHint: { zh: '请在上方选择要显示的关节', en: 'Select joints above to display curves' },
  collapseMetrics: { zh: '收起数据面板', en: 'Collapse metrics panel' },
  expandMetrics: { zh: '展开数据面板', en: 'Expand metrics panel' },
  dragResizeMetrics: { zh: '上拉调整数据面板高度', en: 'Drag up to resize metrics panel' },
  unitDeg: { zh: '角度 (°)', en: 'Degrees (°)' },
  unitRad: { zh: '弧度 (rad)', en: 'Radians (rad)' },
  resetChartZoom: { zh: '复原缩放', en: 'Reset zoom' },
  meanError: { zh: '平均误差', en: 'Mean error' },
  maxError: { zh: '最大误差', en: 'Max error' },
  solveTime: { zh: '求解耗时', en: 'Solve time' },
  procSpeed: { zh: '处理速度', en: 'Speed' },
  statsTitle: { zh: '统计', en: 'Stats' },
  notRun: { zh: '尚未运行重定向', en: 'Retargeting has not been run yet' },
  missingJoints: {
    zh: 'BVH 缺少所需关节（需要 LAFAN1 命名）',
    en: 'BVH is missing required joints (LAFAN1 naming expected)',
  },
  robotMotion: { zh: '机器人动作', en: 'Robot motion' },
  sourceMotion: { zh: '源动作', en: 'Source motion' },
  followCamera: { zh: '跟随相机', en: 'Follow camera' },
  openPanel: { zh: '打开控制面板', en: 'Open control panel' },
  themeDark: { zh: '切换到白天模式', en: 'Switch to light mode' },
  themeLight: { zh: '切换到黑夜模式', en: 'Switch to dark mode' },

  sponsorTitle: { zh: '赞助我', en: 'Support me' },
  sponsorHint: { zh: '微信扫一扫，赞助支持作者 ❤', en: 'Scan with WeChat to support the author ❤' },
  sponsorImgAlt: { zh: '微信收款码', en: 'WeChat payment QR code' },
  close: { zh: '关闭', en: 'Close' },
};

const stored =
  typeof localStorage !== 'undefined' ? (localStorage.getItem(STORAGE_KEY) as Locale | null) : null;
export const locale = ref<Locale>(stored === 'en' ? 'en' : 'zh');

export function setLocale(l: Locale) {
  locale.value = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* ignore */
  }
}

export function toggleLocale() {
  setLocale(locale.value === 'zh' ? 'en' : 'zh');
}

export function t(key: string): string {
  const entry = messages[key];
  if (!entry) return key;
  return entry[locale.value];
}

/** Reactive translation helper for templates. */
export function useI18n() {
  return {
    t,
    locale,
    toggleLocale,
    localeLabel: computed(() => (locale.value === 'zh' ? 'EN' : '中')),
  };
}
