"""Read-only check of actual sleeve/torso continuity in an opened study .blend.

Run Blender with --disable-autoexec --offline-mode and --python-exit-code 1.
Optional -- --all-actions checks every integer frame, not just neutral idle.
The source body's Skin/cloth material boundary defines the seam, not a marker.
Numerical continuity is not a garment collision or visual-quality verdict.
"""
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy

assert not bpy.app.online_access
assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
assert arguments in ([], ["--all-actions"]), "Only the explicit full-action audit is supported"
source_file = Path(bpy.data.filepath)
before = hashlib.sha256(source_file.read_bytes()).hexdigest()
body = bpy.data.objects["Casual_Body"]
arm = bpy.data.objects["CharacterArmature"]
edge_materials = {}
for face in body.data.polygons:
    name = body.data.materials[face.material_index].name
    for edge in face.edge_keys:
        edge_materials.setdefault(tuple(sorted(edge)), []).append(name)
boundary = {index for edge, names in edge_materials.items()
            if any("outer cloth" in name for name in names) and (len(names) == 1 or any("skin" in name for name in names))
            for index in edge if abs(body.data.vertices[index].co.x) > .15 and body.data.vertices[index].co.z > 1.36}
assert len(boundary) == 16, "Expected both original eight-vertex sleeve boundaries"

matches = []
arm.data.pose_position = "REST"
bpy.context.view_layer.update()
for side, sign in (("L", 1), ("R", -1)):
    sleeve = next(obj for obj in bpy.context.scene.objects if obj.name.endswith("shaped sleeve " + side))
    for index in sorted(boundary):
        source = body.data.vertices[index]
        if sign * source.co.x <= 0:
            continue
        point = body.matrix_world @ source.co
        nearest = min(sleeve.data.vertices, key=lambda vertex: (sleeve.matrix_world @ vertex.co - point).length)
        error = (sleeve.matrix_world @ nearest.co - point).length
        assert error < 1e-6, f"{side}: sleeve root separated from torso by {error:.6f}m at rest"
        matches.append((sleeve, index, nearest.index))

arm.data.pose_position = "POSE"
arm.animation_data.use_nla = False
actions = sorted(bpy.data.actions, key=lambda action: action.name) if arguments else [bpy.data.actions["Idle_Neutral"]]
if arguments:
    assert len(actions) == 24, "All 24 source actions must remain inspectable"
skinned = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"
           and any(mod.type == "ARMATURE" and mod.object == arm for mod in obj.modifiers)]
report = []
for action in actions:
    arm.animation_data.action = action
    start, end = map(float, action.frame_range)
    frames = sorted(set([start, end, *range(math.ceil(start), math.floor(end) + 1)])) if arguments else [0, 4, 19]
    maximum = 0
    for frame in frames:
        bpy.context.scene.frame_set(math.floor(frame), subframe=frame % 1)
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        evaluated_body = body.evaluated_get(graph)
        for sleeve, body_index, sleeve_index in matches:
            evaluated_sleeve = sleeve.evaluated_get(graph)
            point = evaluated_body.matrix_world @ evaluated_body.data.vertices[body_index].co
            other = evaluated_sleeve.matrix_world @ evaluated_sleeve.data.vertices[sleeve_index].co
            error = (point - other).length
            maximum = max(maximum, error)
            assert error < 1e-6, f"Sleeve/torso separated by {error:.6f}m in {action.name} frame {frame}"
        for obj in skinned:
            evaluated = obj.evaluated_get(graph)
            assert len(evaluated.data.vertices) == len(obj.data.vertices), f"Unexpected topology change in {obj.name}"
            assert all(math.isfinite(value) for vertex in evaluated.data.vertices
                       for value in evaluated.matrix_world @ vertex.co), f"Non-finite deformation in {action.name} frame {frame}: {obj.name}"
    report.append({"action": action.name, "start": start, "end": end, "samples": len(frames), "max_error_m": maximum})
assert hashlib.sha256(source_file.read_bytes()).hexdigest() == before, "Read-only audit changed the source"
print("SLEEVE_JOINS " + json.dumps({"source_sha256": before, "roots": len(matches), "skinned_meshes": len(skinned),
      "sampling": "integer frames plus endpoints" if arguments else "three neutral idle frames", "actions": report,
      "visual_collisions": "not assessed by this numerical check"}))
