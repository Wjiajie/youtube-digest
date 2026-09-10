"""Read-only exact robe-edge/trouser-surface crossing regression on real poses.

Not a complete collision solver: crossing edges are a sufficient defect witness,
not proof that no face interiors, hands, accessories or subframes intersect.
Run the offline Blender factory/disable-autoexec invocation; args: action frame
or --all-actions for every integer frame plus fractional authored endpoints.
"""
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils.bvhtree import BVHTree

assert not bpy.app.online_access
assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
arguments = sys.argv[sys.argv.index("--") + 1:]
assert arguments == ["--all-actions"] or len(arguments) == 2
source = Path(bpy.data.filepath)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
arm = bpy.data.objects["CharacterArmature"]
arm.data.pose_position = "POSE"
arm.animation_data.use_nla = False
robes = [obj for obj in bpy.context.scene.objects if obj.name.startswith("Eastern / split robe ")]
assert len(robes) == 4


def check_pose(action, frame):
    assert math.isfinite(frame) and action.frame_range[0] <= frame <= action.frame_range[1]
    arm.animation_data.action = action
    bpy.context.scene.frame_set(math.floor(frame), subframe=frame % 1)
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    legs = bpy.data.objects["Casual_Legs"].evaluated_get(graph)
    leg_points = [legs.matrix_world @ vertex.co for vertex in legs.data.vertices]
    assert leg_points and all(math.isfinite(value) for point in leg_points for value in point)
    tree = BVHTree.FromPolygons(leg_points, [tuple(face.vertices) for face in legs.data.polygons])
    crossings = []
    for obj in robes:
        evaluated = obj.evaluated_get(graph)
        points = [evaluated.matrix_world @ vertex.co for vertex in evaluated.data.vertices]
        assert points and evaluated.data.edges and all(math.isfinite(value) for point in points for value in point)
        for edge in evaluated.data.edges:
            start, end = (points[index] for index in edge.vertices)
            delta = end - start
            if delta.length <= 2e-6:
                continue
            direction = delta.normalized()
            hit, normal, face, distance = tree.ray_cast(start + direction * 1e-6, direction, delta.length - 2e-6)
            if hit is not None:
                crossings.append({"robe": obj.name, "edge": edge.index, "leg_face": face, "point": list(hit)})
    return {"action": action.name, "frame": frame, "crossing_count": len(crossings), "witnesses": crossings[:2]}


if arguments == ["--all-actions"]:
    actions = sorted(bpy.data.actions, key=lambda action: action.name)
    assert len(actions) == 24
    results = [check_pose(action, frame) for action in actions
               for frame in sorted(set([float(action.frame_range[0]), float(action.frame_range[1]),
                                        *range(math.ceil(action.frame_range[0]), math.floor(action.frame_range[1]) + 1)]))]
else:
    results = [check_pose(bpy.data.actions[arguments[0]], float(arguments[1]))]
failures = [result for result in results if result["crossing_count"]]
assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
summary = [{"action": name, "samples": sum(row["action"] == name for row in results),
            "failing_frames": sum(row["action"] == name for row in failures),
            "maximum_crossings": max(row["crossing_count"] for row in results if row["action"] == name)}
           for name in sorted({row["action"] for row in results})]
print("ROBE_CLEARANCE " + json.dumps({"source_sha256": source_hash, "samples": len(results), "actions": summary,
      "worst_witnesses": sorted(failures, key=lambda row: row["crossing_count"], reverse=True)[:5],
      "scope": "robe edges against trouser surface only; no face-interior or subframe guarantee"}))
assert not failures, f"Robe crosses trousers in {len(failures)}/{len(results)} sampled poses"
