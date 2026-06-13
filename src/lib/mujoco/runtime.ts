/**
 * MuJoCo WASM runtime: module bootstrap, robot asset mounting, model loading.
 *
 * Uses the official `mujoco-js` bindings (google-deepmind/mujoco wasm build).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MujocoModule = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MjModel = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MjData = any;

let mujocoPromise: Promise<MujocoModule> | null = null;

export function getMujoco(): Promise<MujocoModule> {
  if (!mujocoPromise) {
    mujocoPromise = (async () => {
      const mod = await import('mujoco-js');
      const mujoco = await mod.default();
      mujoco.FS.mkdir('/working');
      mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working');
      return mujoco;
    })();
  }
  return mujocoPromise;
}

export interface RobotManifestEntry {
  id: string;
  label: string;
  xml: string;
  /** files relative to robots/<id>/ */
  files: string[];
  baseBody: string;
  camDistance: number;
  configKey: string;
}

export interface RobotModel {
  id: string;
  mujoco: MujocoModule;
  model: MjModel;
  data: MjData;
  bodyNames: string[]; // index = body id
  bodyIds: Map<string, number>;
  jointNames: string[]; // index = joint id
  /** names of non-free joints in qpos order (for dof_pos export) */
  dofJointNames: string[];
  nq: number;
  nv: number;
}

const loadedRobots = new Map<string, RobotModel>();
let manifestCache: RobotManifestEntry[] | null = null;

export async function getRobotManifest(): Promise<RobotManifestEntry[]> {
  if (manifestCache) return manifestCache;
  const url = `${import.meta.env.BASE_URL}robots/manifest.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch robot manifest: ${res.status}`);
  manifestCache = (await res.json()) as RobotManifestEntry[];
  return manifestCache;
}

export async function loadRobot(
  robotId: string,
  onProgress?: (loaded: number, total: number, file: string) => void,
): Promise<RobotModel> {
  const cached = loadedRobots.get(robotId);
  if (cached) return cached;

  const [mujoco, manifest] = await Promise.all([getMujoco(), getRobotManifest()]);
  const entry = manifest.find((e) => e.id === robotId);
  if (!entry) throw new Error(`Unknown robot: ${robotId}`);

  const dir = `/working/robots/${robotId}`;
  ensureDir(mujoco, dir);

  let done = 0;
  const total = entry.files.length;
  // Fetch sequentially-ish in small batches to keep memory in check.
  const BATCH = 6;
  for (let i = 0; i < entry.files.length; i += BATCH) {
    const batch = entry.files.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (rel) => {
        const url = `${import.meta.env.BASE_URL}robots/${robotId}/${rel}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        const path = `${dir}/${rel}`;
        ensureDir(mujoco, path.substring(0, path.lastIndexOf('/')));
        mujoco.FS.writeFile(path, buf);
        done++;
        onProgress?.(done, total, rel);
      }),
    );
  }

  const model = mujoco.MjModel.loadFromXML(`${dir}/${entry.xml}`);
  const data = new mujoco.MjData(model);
  const robot = buildRobotModel(mujoco, robotId, model, data);
  loadedRobots.set(robotId, robot);
  return robot;
}

/** Build a RobotModel directly from an MJCF string (tests / ad-hoc models). */
export async function loadRobotFromXmlString(id: string, xml: string): Promise<RobotModel> {
  const mujoco = await getMujoco();
  const path = `/working/${id}.xml`;
  mujoco.FS.writeFile(path, xml);
  const model = mujoco.MjModel.loadFromXML(path);
  const data = new mujoco.MjData(model);
  return buildRobotModel(mujoco, id, model, data);
}

export function buildRobotModel(
  mujoco: MujocoModule,
  id: string,
  model: MjModel,
  data: MjData,
): RobotModel {
  const bodyNames: string[] = [];
  const bodyIds = new Map<string, number>();
  for (let b = 0; b < model.nbody; b++) {
    const name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, b) ?? `body_${b}`;
    bodyNames.push(name);
    bodyIds.set(name, b);
  }
  const jointNames: string[] = [];
  for (let j = 0; j < model.njnt; j++) {
    jointNames.push(
      mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT.value, j) ?? `joint_${j}`,
    );
  }
  const FREE = 0; // mjJNT_FREE
  const jntType = model.jnt_type as Int32Array;
  const dofJointNames: string[] = [];
  for (let j = 0; j < model.njnt; j++) {
    if (jntType[j] !== FREE) dofJointNames.push(jointNames[j]);
  }
  return {
    id,
    mujoco,
    model,
    data,
    bodyNames,
    bodyIds,
    jointNames,
    dofJointNames,
    nq: model.nq,
    nv: model.nv,
  };
}

export function ensureDir(mujoco: MujocoModule, path: string) {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur += '/' + p;
    if (!mujoco.FS.analyzePath(cur).exists) mujoco.FS.mkdir(cur);
  }
}
