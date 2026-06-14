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

  // Video → BVH (in-browser MediaPipe pose capture)
  videoToBvh: { zh: '视频生成 BVH', en: 'Video → BVH' },
  videoToBvhTitle: { zh: '从视频生成 BVH（实验性）', en: 'Generate BVH from Video (experimental)' },
  videoToBvhHint: {
    zh: '在浏览器内用 MediaPipe 姿态估计从单人视频提取动作，生成 LAFAN1 兼容的 BVH，可直接预览与重定向。',
    en: 'Extracts motion from a single-person video using in-browser MediaPipe pose estimation and produces a LAFAN1-compatible BVH ready for preview and retargeting.',
  },
  selectVideo: { zh: '选择视频', en: 'Select video' },
  videoDropTitle: { zh: '拖拽视频到此处', en: 'Drop a video here' },
  videoDropHint: {
    zh: '或点击选择（mp4 / webm / mov）',
    en: 'or click to choose (mp4 / webm / mov)',
  },
  videoChangeFile: { zh: '更换视频', en: 'Change video' },
  generateBvh: { zh: '生成 BVH', en: 'Generate BVH' },
  processingVideo: { zh: '正在分析视频…', en: 'Analyzing video…' },
  videoQualityWarning: {
    zh: '检测质量较低：较多画面未识别到人体。建议使用单人、全身入镜、光照良好、较为正面的视频。',
    en: 'Low detection quality: many frames had no detected person. Use a single-person, full-body, well-lit, mostly front-facing video.',
  },
  videoPrivacyNote: {
    zh: '视频在本地浏览器中处理，不会上传到任何服务器。',
    en: 'The video is processed locally in your browser and is never uploaded.',
  },
  videoLimitations: {
    zh: '单目估计为草稿级：深度、自转与全局位移有限，动作为原地播放。',
    en: 'Monocular estimation is draft quality: limited depth, twist and global translation; motion plays in place.',
  },
  videoInvalidFormat: {
    zh: '不支持的文件类型，请选择 mp4 / webm / mov 视频',
    en: 'Unsupported file type — choose an mp4 / webm / mov video',
  },

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

  importUrdf: { zh: '导入自定义 URDF', en: 'Import Custom URDF' },
  customRobot: { zh: '自定义机器人', en: 'Custom robot' },
  urdfSpecTitle: { zh: 'URDF / 模型导入规范', en: 'URDF / Model Import Spec' },
  urdfSpecFormats: {
    zh: '支持格式：单个 .urdf / .xml（MJCF）文件，或包含模型与网格资源的 .zip 压缩包。',
    en: 'Supported formats: a single .urdf / .xml (MJCF) file, or a .zip archive containing the model and mesh assets.',
  },
  urdfSpecZip: {
    zh: 'ZIP 结构：保留 URDF/MJCF 引用的相对路径（如 meshes/link.stl）。压缩包内只能有一个主模型文件，或将其命名为 robot.urdf / robot.xml 放在根目录。',
    en: 'ZIP layout: preserve relative paths referenced by the URDF/MJCF (e.g. meshes/link.stl). Include only one main model file, or name it robot.urdf / robot.xml at the zip root.',
  },
  urdfSpecUrdf: {
    zh: 'URDF 要求：标准 ROS URDF；每个 <link> 需含有效 <inertial>；旋转关节使用 type="revolute" 并设置 <limit>；网格路径使用相对路径（避免 package://）。建议在 <robot> 内加入 MuJoCo 编译器扩展：',
    en: 'URDF requirements: standard ROS URDF; every <link> needs a valid <inertial>; use type="revolute" joints with <limit>; mesh paths must be relative (avoid package://). Recommended MuJoCo compiler block inside <robot>:',
  },
  urdfSpecCompilerSnippet: {
    zh: '<mujoco><compiler angle="radian" meshdir="meshes" autolimits="true" balanceinertia="true"/></mujoco>',
    en: '<mujoco><compiler angle="radian" meshdir="meshes" autolimits="true" balanceinertia="true"/></mujoco>',
  },
  urdfSpecMeshes: {
    zh: '网格格式：.stl、.obj、.dae（与 MuJoCo 一致）。导入后需手动配置 IK 映射表；也可导入/导出 GMR ik_config JSON。',
    en: 'Mesh formats: .stl, .obj, .dae (MuJoCo-supported). After import, configure the IK mapping tables manually, or import/export a GMR ik_config JSON.',
  },
  urdfSpecFloating: {
    zh: '浮动基座：重定向需要 6-DoF 浮动基座。URDF 导入时会自动在根 link 下注入 free joint；MJCF 需在根 body 上包含 <freejoint/>（导入时会尝试自动补全）。',
    en: 'Floating base: retargeting requires a 6-DoF floating base. URDF imports auto-inject a free joint on the root link; MJCF must include <freejoint/> on the root body (auto-patched on import when missing).',
  },
  urdfSpecLimits: {
    zh: '不支持：Xacro（.xacro）、package:// URI、多个未指定主文件的 URDF。模型仅在浏览器内存中加载，不会上传到服务器。',
    en: 'Not supported: Xacro (.xacro), package:// URIs, or multiple URDF files without a designated main file. Models are loaded in browser memory only — nothing is uploaded to a server.',
  },
  urdfImportSuccess: { zh: '自定义机器人导入成功', en: 'Custom robot imported successfully' },
  urdfDropTitle: { zh: '拖拽文件到此处', en: 'Drop file here' },
  urdfDropHint: {
    zh: '支持 .urdf、.xml（MJCF）或 .zip；校验通过后将加入机器人下拉列表',
    en: 'Supports .urdf, .xml (MJCF), or .zip; valid files are added to the robot dropdown',
  },
  urdfBrowse: { zh: '选择文件', en: 'Browse files' },
  urdfInvalidFormat: {
    zh: '不支持的文件类型，请上传 .urdf、.xml 或 .zip',
    en: 'Unsupported file type — upload a .urdf, .xml, or .zip file',
  },
  urdfSessionHint: {
    zh: '导入的自定义机器人仅保存在当前页面会话中，刷新页面后需重新导入。',
    en: 'Imported custom robots exist only for this page session and are cleared on refresh.',
  },
  removeCustomRobot: { zh: '删除自定义机器人', en: 'Remove custom robot' },
  customRobotRemoved: { zh: '已删除自定义机器人', en: 'Custom robot removed' },
  baseBody: { zh: '根 body', en: 'Root body' },
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
