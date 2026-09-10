"""Read-only source coordinates for an independent exported-pose comparison.

Run Blender with --background --factory-startup --disable-autoexec --offline-mode,
the source .blend, --python-exit-code 1, and --python this script. No save/export.
The only machine-readable stdout record begins with SOURCE_POSE_REFERENCE.
"""
import hashlib
import json
import math
from pathlib import Path

import bpy


assert not bpy.app.online_access, "Run with --offline-mode"
assert not bpy.context.preferences.filepaths.use_scripts_auto_execute, "Run with --disable-autoexec"
source = Path(bpy.data.filepath)
assert source.is_file() and source.suffix == ".blend", "Pass an existing .blend to Blender"
source_sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
arm = bpy.data.objects["CharacterArmature"]
assert arm.type == "ARMATURE" and arm.animation_data is not None
targets = {name: bpy.data.objects[name] for name in ("Casual_Body", "Eastern / sash")}
fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
assert math.isfinite(fps) and fps > 0
samples = (("Idle_Neutral", 0), ("Kick_Left", 7), ("Kick_Left", 8), ("Roll", 34))
actions = {action.name: {"start": float(action.frame_range[0]), "end": float(action.frame_range[1])}
           for action in bpy.data.actions}
assert all(math.isfinite(value) for bounds in actions.values() for value in bounds.values())


def topology(mesh):
    return (len(mesh.vertices), tuple(tuple(edge.vertices) for edge in mesh.edges),
            tuple(tuple(face.vertices) for face in mesh.polygons))


expected_topology = {}
weights = {}
raw_weights = {}
for name, obj in targets.items():
    assert obj.type == "MESH"
    assert all(modifier.type == "ARMATURE" and modifier.object == arm for modifier in obj.modifiers), \
        "Reference requires only topology-preserving deformation by the expected armature"
    expected_topology[name] = topology(obj.data)
    weights[name] = []
    raw_weights[name] = []
    for vertex in obj.data.vertices:
        complete = {}
        for group in vertex.groups:
            assert math.isfinite(group.weight) and group.weight >= 0
            if group.weight == 0:
                continue
            bone = obj.vertex_groups[group.group].name
            assert bone in arm.data.bones, "Do not silently discard a positive non-bone vertex group"
            complete[bone] = complete.get(bone, 0.0) + group.weight
        total = sum(complete.values())
        assert math.isfinite(total) and total > 0, "Every reference vertex needs bone weights"
        raw_weights[name].append(complete)
        weights[name].append({bone: value / total for bone, value in complete.items()})


def world_vertices():
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    result = {}
    for name, obj in targets.items():
        evaluated = obj.evaluated_get(graph)
        assert topology(evaluated.data) == expected_topology[name], "Vertex order/topology must remain unchanged"
        points = []
        for vertex in evaluated.data.vertices:
            point = evaluated.matrix_world @ vertex.co
            # Blender Z-up world to the exported glTF Y-up world convention.
            values = [float(point.x), float(point.z), float(-point.y)]
            assert all(math.isfinite(value) for value in values)
            points.append(values)
        result[name] = points
    return result


# Match the existing source audit's explicit action assignment. No invented bone
# TRS resets or NLA blending are introduced into the sampled source animation.
arm.animation_data.use_nla = False
arm.data.pose_position = "REST"
rest = world_vertices()
arm.data.pose_position = "POSE"
poses = []
for action_name, frame in samples:
    bounds = actions[action_name]
    assert bounds["start"] <= frame <= bounds["end"], "Requested source frame is outside its actual action"
    arm.animation_data.action = bpy.data.actions[action_name]
    bpy.context.scene.frame_set(frame)
    assert not arm.animation_data.use_nla
    poses.append({"action": action_name, "frame": frame, "time": (frame - bounds["start"]) / fps,
                  "targets": world_vertices()})

after = hashlib.sha256(source.read_bytes()).hexdigest()
assert after == source_sha256, "Source asset must remain byte-for-byte unchanged"
print("SOURCE_POSE_REFERENCE " + json.dumps({
    "source_sha256": source_sha256,
    "source_sha256_after": after,
    "fps": fps,
    "actions": actions,
    "targets": {name: {"vertex_count": len(points), "rest": points, "weights": weights[name], "raw_weights": raw_weights[name]}
                for name, points in rest.items()},
    "poses": poses,
}, allow_nan=False, separators=(",", ":")))
