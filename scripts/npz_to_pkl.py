#!/usr/bin/env python3
"""Convert an NPZ exported by Robot Retarget Online into a GMR-compatible .pkl.

The resulting pickle matches GMR's scripts/bvh_to_robot.py --save_path output:
  {fps, root_pos (T,3), root_rot (T,4) xyzw, dof_pos (T,ndof),
   local_body_pos: None, link_body_list: None}

Usage: python3 npz_to_pkl.py motion.npz [motion.pkl]
"""

import pickle
import sys

import numpy as np


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else src.rsplit(".", 1)[0] + ".pkl"

    data = np.load(src)
    motion_data = {
        "fps": int(round(float(np.asarray(data["fps"]).reshape(-1)[0]))),
        "root_pos": np.asarray(data["root_pos"], dtype=np.float64),
        "root_rot": np.asarray(data["root_rot"], dtype=np.float64),
        "dof_pos": np.asarray(data["dof_pos"], dtype=np.float64),
        "local_body_pos": None,
        "link_body_list": None,
    }
    with open(dst, "wb") as f:
        pickle.dump(motion_data, f)
    print(f"saved {dst}: {motion_data['dof_pos'].shape[0]} frames, "
          f"{motion_data['dof_pos'].shape[1]} dofs @ {motion_data['fps']} fps")


if __name__ == "__main__":
    main()
