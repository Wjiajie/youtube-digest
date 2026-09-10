"""Measure a rejected four-influence reduction in memory. Never saves any file.

Samples every fifth frame, not an exhaustive animation equivalence test.
Distances are in source world units, not verified human perceptual thresholds.
"""
import hashlib
import json
from pathlib import Path
import bpy

assert not bpy.app.online_access
assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
assert hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest() == "204d82f2f481116cbb4433e69075b52e99f49b0df60ac04b44462f5704f3ee9f"
armature = bpy.data.objects["CharacterArmature"]
objects = sorted([obj for obj in bpy.data.objects if obj.type == "MESH"], key=lambda obj: obj.name)
for track in armature.animation_data.nla_tracks:
    track.mute = True
actions = sorted(bpy.data.actions, key=lambda action: action.name)
poses = [(action, frame) for action in actions
         for frame in range(int(action.frame_range[0]), int(action.frame_range[1]) + 1, 5)]

def positions(action, frame):
    armature.animation_data.action = action
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    result = []
    for obj in objects:
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        try:
            result.append([evaluated.matrix_world @ vertex.co for vertex in mesh.vertices])
        finally:
            evaluated.to_mesh_clear()
    return result

original = [positions(action, frame) for action, frame in poses]
for obj in objects:
    for vertex in obj.data.vertices:
        for group in vertex.groups:
            if group.weight > 1:
                obj.vertex_groups[group.group].add([vertex.index], 1.0, "REPLACE")
baseline = [positions(action, frame) for action, frame in poses]
clamp_distance = max((a - b).length for pose_before, pose_after in zip(original, baseline)
                     for mesh_before, mesh_after in zip(pose_before, pose_after)
                     for a, b in zip(mesh_before, mesh_after))
bone_names = {bone.name for bone in armature.data.bones}
for obj in objects:
    for vertex in obj.data.vertices:
        groups = [(group.group, min(1.0, max(0.0, group.weight))) for group in vertex.groups
                  if obj.vertex_groups[group.group].name in bone_names and group.weight > 0]
        kept = sorted(groups, key=lambda entry: (-entry[1], entry[0]))[:4]
        total = sum(weight for _, weight in kept)
        if not total:
            continue
        for index, _ in groups:
            obj.vertex_groups[index].remove([vertex.index])
        for index, weight in kept:
            obj.vertex_groups[index].add([vertex.index], weight / total, "REPLACE")
report = []
for (action, frame), expected in zip(poses, baseline):
    for obj, left, right in zip(objects, expected, positions(action, frame)):
        assert len(left) == len(right)
        report.append({"action": action.name, "frame": frame, "mesh": obj.name,
                       "maximumDistance": max((a - b).length for a, b in zip(left, right))})
print("DEFORMATION_PROBE " + json.dumps({"samples": len(poses), "clampOnlyMaximumDistance": clamp_distance,
      "worst": sorted(report, key=lambda item: item["maximumDistance"], reverse=True)[:10],
      "idle": sorted([item for item in report if item["action"] == "Idle_Neutral"],
                     key=lambda item: item["maximumDistance"], reverse=True)[:4]}))
