/**
 * Import user-supplied robot models (URDF / MJCF + optional mesh zip) into the
 * MuJoCo WASM virtual filesystem and compile them for retargeting.
 */

import { unzipSync } from 'fflate';
import {
  buildRobotModel,
  disposeRobotModel,
  ensureDir,
  getMujoco,
  prepareRobotSlot,
  removeVfsTree,
  type MujocoModule,
  type RobotModel,
} from './runtime';

export const CUSTOM_ROBOT_ID = '__custom__';

export interface CustomRobotBundle {
  /** Display name (usually derived from the uploaded file). */
  label: string;
  /** Relative path to the main model file inside `files`. */
  rootModel: string;
  /** All asset paths → file bytes (paths use `/`, no leading slash). */
  files: Map<string, Uint8Array>;
  /** Root body name used in ik_config (detected or inferred). */
  baseBody: string;
}

const MODEL_EXT = /\.(urdf|xml)$/i;
const SKIP_PATH = /(?:^|\/)(?:__MACOSX|\.git|\.DS_Store)(?:\/|$)/i;

/** Parse a `.urdf`, `.xml`, or `.zip` upload into an in-memory asset bundle. */
export async function parseCustomRobotImport(file: File): Promise<CustomRobotBundle> {
  const label = file.name.replace(/\.(zip|urdf|xml)$/i, '') || 'custom_robot';
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.zip')) {
    return parseZipImport(label, new Uint8Array(await file.arrayBuffer()));
  }
  if (lower.endsWith('.urdf') || lower.endsWith('.xml')) {
    const text = await file.text();
    const files = new Map<string, Uint8Array>();
    files.set(file.name, new TextEncoder().encode(text));
    const baseBody = lower.endsWith('.urdf')
      ? findUrdfRootLink(text)
      : inferMjcfRootBody(text);
    return { label, rootModel: file.name, files, baseBody };
  }
  throw new Error('Unsupported file type. Upload a .urdf, .xml, or .zip archive.');
}

function parseZipImport(label: string, buf: Uint8Array): CustomRobotBundle {
  const raw = unzipSync(buf);
  const files = new Map<string, Uint8Array>();
  const models: string[] = [];

  for (const [path, data] of Object.entries(raw)) {
    if (path.endsWith('/') || SKIP_PATH.test(path)) continue;
    const norm = path.replace(/\\/g, '/').replace(/^\.?\//, '');
    files.set(norm, data);
    if (MODEL_EXT.test(norm)) models.push(norm);
  }

  if (models.length === 0) {
    throw new Error('No .urdf or .xml model file found in the zip archive.');
  }

  const rootModel = pickMainModel(models);
  const text = new TextDecoder().decode(files.get(rootModel)!);
  const baseBody = rootModel.toLowerCase().endsWith('.urdf')
    ? findUrdfRootLink(text)
    : inferMjcfRootBody(text);

  return { label, rootModel, files, baseBody };
}

function pickMainModel(paths: string[]): string {
  if (paths.length === 1) return paths[0];
  const rootLevel = paths.filter((p) => !p.includes('/'));
  if (rootLevel.length === 1) return rootLevel[0];
  const preferred = paths.find((p) => /(^|\/)robot\.urdf$/i.test(p) || /(^|\/)robot\.xml$/i.test(p));
  if (preferred) return preferred;
  throw new Error(
    `Multiple model files in archive (${paths.join(', ')}). ` +
      'Include only one .urdf/.xml, or name it robot.urdf at the zip root.',
  );
}

/** URDF root link = link that is never referenced as a joint child. */
export function findUrdfRootLink(urdf: string): string {
  const links = [...urdf.matchAll(/<link\s+name="([^"]+)"/gi)].map((m) => m[1]);
  if (links.length === 0) throw new Error('URDF contains no <link> elements.');
  const childLinks = new Set([...urdf.matchAll(/<child\s+link="([^"]+)"/gi)].map((m) => m[1]));
  const roots = links.filter((l) => !childLinks.has(l));
  if (roots.length !== 1) {
    throw new Error(
      roots.length === 0
        ? 'Could not determine URDF root link (cycle in kinematic tree?).'
        : `Ambiguous URDF root links: ${roots.join(', ')}. Expected exactly one root.`,
    );
  }
  return roots[0];
}

/** Heuristic for MJCF: first named body under <worldbody>, else "base_link". */
export function inferMjcfRootBody(mjcf: string): string {
  const m = mjcf.match(/<worldbody>\s*<body\s+name="([^"]+)"/i);
  return m?.[1] ?? 'base_link';
}

export function extractUrdfLinkInertial(urdf: string, linkName: string): string | null {
  const re = new RegExp(
    `<link\\s+name="${escapeRegExp(linkName)}"[^>]*>([\\s\\S]*?)<\\/link>`,
    'i',
  );
  const block = urdf.match(re)?.[1];
  if (!block) return null;
  const inertial = block.match(/<inertial[\s\S]*?<\/inertial>/i)?.[0];
  if (!inertial) return null;
  return urdfInertialToMjcf(inertial);
}

function urdfInertialToMjcf(inertialXml: string): string {
  const mass = inertialXml.match(/<mass\s+value="([^"]+)"/i)?.[1] ?? '1';
  const origin = inertialXml.match(/<origin\s+xyz="([^"]+)"/i)?.[1] ?? '0 0 0';
  const i = inertialXml.match(/<inertia\s+([^/>]+)\/?>/i)?.[1] ?? '';
  const ixx = i.match(/\bixx="([^"]+)"/)?.[1] ?? '0.1';
  const iyy = i.match(/\biyy="([^"]+)"/)?.[1] ?? '0.1';
  const izz = i.match(/\bizz="([^"]+)"/)?.[1] ?? '0.1';
  return `<inertial pos="${origin}" mass="${mass}" diaginertia="${ixx} ${iyy} ${izz}"/>`;
}

/** Compile URDF → MJCF and wrap the kinematic tree under a floating root body. */
export async function urdfToMjcfWithFloatingBase(
  mujoco: MujocoModule,
  urdfText: string,
  urdfRelPath: string,
  rootLink: string,
): Promise<string> {
  removeVfsTree(mujoco, URDF_COMPILE_DIR);
  ensureDir(mujoco, URDF_COMPILE_DIR);
  const urdfPath = `${URDF_COMPILE_DIR}/${urdfRelPath.split('/').pop() ?? 'robot.urdf'}`;
  mujoco.FS.writeFile(urdfPath, urdfText);

  const model = mujoco.MjModel.loadFromXML(urdfPath);
  if (!model) throw new Error('MuJoCo failed to compile the URDF model.');

  try {
    const mjcfPath = `${URDF_COMPILE_DIR}/compiled.xml`;
    mujoco.mj_saveLastXML(mjcfPath, model);
    let mjcf = mujoco.FS.readFile(mjcfPath, { encoding: 'utf8' }) as string;

    const inertial = extractUrdfLinkInertial(urdfText, rootLink);
    mjcf = injectFloatingBase(mjcf, rootLink, inertial ?? undefined);
    return mjcf;
  } finally {
    model.delete?.();
  }
}

/** Ensure the model has a free joint on the retargeting root body. */
export function injectFloatingBase(mjcf: string, rootName: string, inertial?: string): string {
  if (hasNamedFreeJoint(mjcf, rootName)) return mjcf;

  const existingBodyRe = new RegExp(`<body\\s+name="${escapeRegExp(rootName)}"`, 'i');
  if (existingBodyRe.test(mjcf)) {
    return mjcf.replace(
      new RegExp(`(<body\\s+name="${escapeRegExp(rootName)}"[^>]*>)`, 'i'),
      `$1\n      <freejoint name="${rootName}"/>`,
    );
  }

  const worldMatch = mjcf.match(/<worldbody>([\s\S]*?)<\/worldbody>/i);
  if (!worldMatch) throw new Error('Compiled model has no <worldbody> element.');

  const inner = worldMatch[1].trim();
  if (!inner) throw new Error('Compiled model <worldbody> is empty.');

  const inertialTag =
    inertial ?? '<inertial pos="0 0 0" mass="1" diaginertia="0.1 0.1 0.1"/>';
  const wrapped = `<worldbody>
    <body name="${rootName}">
      ${inertialTag}
      <freejoint name="${rootName}"/>
${inner}
    </body>
  </worldbody>`;

  return mjcf.replace(/<worldbody>[\s\S]*?<\/worldbody>/i, wrapped);
}

function hasNamedFreeJoint(mjcf: string, rootName: string): boolean {
  const bodyRe = new RegExp(
    `<body\\s+name="${escapeRegExp(rootName)}"[^>]*>([\\s\\S]*?)(?=<body|<\\/worldbody>)`,
    'i',
  );
  const bodyBlock = mjcf.match(bodyRe)?.[1] ?? '';
  return /<freejoint/i.test(bodyBlock);
}

export function modelHasFreeJoint(mujoco: MujocoModule, model: { jnt_type: Int32Array | number[]; njnt: number }): boolean {
  const jntType = model.jnt_type as Int32Array;
  for (let j = 0; j < model.njnt; j++) {
    if (jntType[j] === 0) return true;
  }
  return false;
}

const CUSTOM_VFS_DIR = '/working/custom_robot';
const URDF_COMPILE_DIR = '/working/_urdf_compile';

let customRobotCache: RobotModel | null = null;
let customBundleCache: CustomRobotBundle | null = null;

function disposeCustomRobotCache(mujoco?: MujocoModule) {
  if (customRobotCache) {
    disposeRobotModel(customRobotCache);
    customRobotCache = null;
  }
  customBundleCache = null;
  if (mujoco) {
    removeVfsTree(mujoco, CUSTOM_VFS_DIR);
    removeVfsTree(mujoco, URDF_COMPILE_DIR);
  }
}

let customRobotLoadChain: Promise<unknown> = Promise.resolve();

function serializeCustomRobotLoad<T>(fn: () => Promise<T>): Promise<T> {
  const run = customRobotLoadChain.then(fn, fn);
  customRobotLoadChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function clearCustomRobotCache() {
  if (customRobotCache) {
    disposeCustomRobotCache(customRobotCache.mujoco);
    return;
  }
  customBundleCache = null;
}

/** Mount bundle assets and load a RobotModel ready for IK / rendering. */
export async function loadCustomRobot(
  bundle: CustomRobotBundle,
  onProgress?: (loaded: number, total: number, file: string) => void,
): Promise<RobotModel> {
  return serializeCustomRobotLoad(() => loadCustomRobotImpl(bundle, onProgress));
}

async function loadCustomRobotImpl(
  bundle: CustomRobotBundle,
  onProgress?: (loaded: number, total: number, file: string) => void,
): Promise<RobotModel> {
  const reuse =
    customRobotCache && customBundleCache === bundle ? customRobotCache : null;
  const cached = await prepareRobotSlot(CUSTOM_ROBOT_ID, reuse);
  if (cached) return cached;

  const mujoco = await getMujoco();
  ensureDir(mujoco, CUSTOM_VFS_DIR);

  const entries = [...bundle.files.entries()];
  let done = 0;
  const total = entries.length + 1;
  const BATCH = 8;

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async ([rel, data]) => {
        const path = `${CUSTOM_VFS_DIR}/${rel}`;
        ensureDir(mujoco, path.substring(0, path.lastIndexOf('/')));
        mujoco.FS.writeFile(path, data);
        done++;
        onProgress?.(done, total, rel);
      }),
    );
  }

  const rootPath = `${CUSTOM_VFS_DIR}/${bundle.rootModel}`;
  const isUrdf = bundle.rootModel.toLowerCase().endsWith('.urdf');
  let xmlPath = rootPath;

  if (isUrdf) {
    const urdfText = new TextDecoder().decode(bundle.files.get(bundle.rootModel)!);
    const mjcf = await urdfToMjcfWithFloatingBase(mujoco, urdfText, bundle.rootModel, bundle.baseBody);
    xmlPath = `${CUSTOM_VFS_DIR}/compiled.mjcf.xml`;
    mujoco.FS.writeFile(xmlPath, mjcf);
  } else {
    const mjcfText = new TextDecoder().decode(bundle.files.get(bundle.rootModel)!);
    if (!hasNamedFreeJoint(mjcfText, bundle.baseBody)) {
      const patched = injectFloatingBase(mjcfText, bundle.baseBody);
      xmlPath = `${CUSTOM_VFS_DIR}/patched.mjcf.xml`;
      mujoco.FS.writeFile(xmlPath, patched);
    }
  }

  const model = mujoco.MjModel.loadFromXML(xmlPath);
  if (!model) throw new Error('MuJoCo failed to load the robot model.');
  if (!modelHasFreeJoint(mujoco, model)) {
    throw new Error(
      `Model has no floating base (free joint). ` +
        `Add <freejoint name="${bundle.baseBody}"/> to the root body in MJCF, ` +
        `or use URDF with a single root link (auto-wrapped on import).`,
    );
  }

  const data = new mujoco.MjData(model);
  const robot = buildRobotModel(mujoco, CUSTOM_ROBOT_ID, model, data);
  customRobotCache = robot;
  customBundleCache = bundle;
  done++;
  onProgress?.(done, total, bundle.rootModel);
  return robot;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
