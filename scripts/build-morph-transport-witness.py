"""Offline calibration fixture on the pinned v17 robe, NOT a clothing repair.

Creates a new ignored evidence directory; never saves or overwrites a .blend.
Run with the existing v17 eastern.blend and offline/factory/disable-autoexec.
"""
import hashlib
import json
import math
import tempfile
from pathlib import Path

import bpy

assert not bpy.app.online_access
assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
source = Path(bpy.data.filepath)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
assert source_hash == "18e231261cb1b6068f5c1422d6db4268e4bd2e4a1c9ec84af1806e935d42579c"
root = Path(__file__).resolve().parent.parent
output = Path(tempfile.mkdtemp(prefix="morph-transport-", dir=root / ".goal-loop/evidence"))
arm = bpy.data.objects["CharacterArmature"]
arm.animation_data.use_nla = False
arm.data.pose_position = "POSE"
actions = sorted(bpy.data.actions, key=lambda action: action.name)
assert len(actions) == 24
bounds = {action.name: list(action.frame_range) for action in actions}
robes = sorted((obj for obj in bpy.data.objects if obj.name.startswith("Eastern / split robe ")), key=lambda obj: obj.name)
assert len(robes) == 4

# Avoid applying modifiers during morph export. Explicitly bake the existing
# non-armature modifiers in this disposable process first.
baked = []
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    assert obj.data.shape_keys is None
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        if modifier.type != "ARMATURE":
            baked.append([obj.name, modifier.type])
            bpy.ops.object.modifier_apply(modifier=modifier.name)

slots = {}
for obj in robes:
    basis = obj.shape_key_add(name="Basis")
    key = obj.shape_key_add(name="Transport calibration — not garment correction")
    # A bounded visible displacement on real weighted geometry. Top row stays
    # anchored. This is deliberately NOT advertised as clearing intersections.
    sign = -1 if obj.name.endswith("front") else 1
    for index, vertex in enumerate(key.data):
        vertex.co.y += sign * .04 * (index // 13) / 12
    keys = obj.data.shape_keys
    keys.animation_data_create()
    slots[obj.name] = {}
    for action in actions:
        slot = action.slots.new(id_type="KEY", name=obj.name)
        slots[obj.name][action.name] = slot
        keys.animation_data.action = action
        keys.animation_data.action_slot = slot
        start, end = bounds[action.name]
        samples = [(start, 0), (7, .5), (8, 1), (12, 0), (end, 0)] if action.name == "Kick_Left" else [(start, 0), (end, 0)]
        for frame, value in samples:
            key.value = value
            key.keyframe_insert(data_path="value", frame=frame)
        bag = action.layers[0].strips[0].channelbag(slot)
        for curve in bag.fcurves:
            for point in curve.keyframe_points:
                point.interpolation = "LINEAR"
    key.value = 0


def pose(action_name, frame):
    action = bpy.data.actions[action_name]
    arm.animation_data.action = action
    for obj in robes:
        obj.data.shape_keys.animation_data.action = action
        obj.data.shape_keys.animation_data.action_slot = slots[obj.name][action_name]
    bpy.context.scene.frame_set(math.floor(frame), subframe=frame % 1)
    bpy.context.view_layer.update()


def vertices(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    assert len(evaluated.data.vertices) == len(obj.data.vertices)
    points = [evaluated.matrix_world @ vertex.co for vertex in evaluated.data.vertices]
    return [[point.x, point.z, -point.y] for point in points]


pose("Idle_Neutral", 0)
arm.data.pose_position = "REST"
bpy.context.view_layer.update()
rest = {obj.name: {"positions": vertices(obj),
                   "faces": [list(face.vertices) for face in obj.data.polygons]}
        for obj in robes}
arm.data.pose_position = "POSE"
fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
samples = []
# Include partial interpolation and switching out of active corrective motion.
for action_name, frame in [("Idle_Neutral", 0), ("Kick_Left", 7), ("Kick_Left", 7.03125),
                           ("Kick_Left", 7.5), ("Kick_Left", 7.53125), ("Kick_Left", 8),
                           ("Roll", 34), ("Idle_Neutral", 0)]:
    pose(action_name, frame)
    sample = {"action": action_name, "frame": frame, "time": (frame - bounds[action_name][0]) / fps,
                    "value": robes[0].data.shape_keys.key_blocks[1].value,
                    "positions": {obj.name: vertices(obj) for obj in robes}}
    for obj in robes:
        obj.data.shape_keys.animation_data.action = None
        obj.data.shape_keys.key_blocks[1].value = 0
    bpy.context.view_layer.update()
    sample["baseline_positions"] = {obj.name: vertices(obj) for obj in robes}
    samples.append(sample)

pose("Idle_Neutral", 0)
# Blender's exporter samples integer scene frames. In this disposable copy,
# scale both curve times/handles and FPS, preserving seconds while providing
# original sixteenth-frame samples. Source references above remain independent.
sample_scale = 16
assert bpy.context.scene.render.fps == 24 and bpy.context.scene.render.fps_base == 1
for action in actions:
    assert not action.use_frame_range
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    assert not curve.modifiers and not curve.sampled_points
                    original = [(p.co.copy(), p.handle_left.copy(), p.handle_right.copy()) for p in curve.keyframe_points]
                    for point, (co, left, right) in zip(curve.keyframe_points, original):
                        point.co = (co.x * sample_scale, co.y)
                        point.handle_left = (left.x * sample_scale, left.y)
                        point.handle_right = (right.x * sample_scale, right.y)
                    curve.update()
bpy.context.scene.render.fps *= sample_scale
exports = {}
for label in ("unregistered-control", "corrective"):
    if label == "corrective":
        for obj in robes:
            animation = obj.data.shape_keys.animation_data
            animation.action = None
            animation.use_nla = False
            for action in actions:
                track = animation.nla_tracks.new()
                track.name = action.name
                strip = track.strips.new(action.name, int(bounds[action.name][0]), action)
                strip.action_slot = slots[obj.name][action.name]
    path = output / (label + ".glb")
    assert bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_apply=False,
        export_animations=True, export_animation_mode="ACTIONS", export_merge_animation="ACTION",
        export_frame_range=False, export_frame_step=1, export_force_sampling=True,
        export_all_influences=True, export_morph=True, export_morph_animation=True,
        export_cameras=True, export_lights=True, export_extras=True,
        export_import_convert_lighting_mode="COMPAT", export_unused_images=False,
        export_unused_textures=False, will_save_settings=False) == {"FINISHED"}
    exports[label] = hashlib.sha256(path.read_bytes()).hexdigest()
assert len(bpy.data.actions) == 24
assert {action.name: [value / sample_scale for value in action.frame_range] for action in actions} == bounds
assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
report = {"source": str(source), "source_sha256": source_hash, "exports": exports, "sample_scale": sample_scale,
          "actions": bounds, "baked_modifiers": baked, "rest": rest, "samples": samples,
          "scope": "Calibration of morph transport only; not a garment correction, collision result or approved asset."}
(output / "reference.json").write_text(json.dumps(report, allow_nan=False), encoding="utf8")
print("MORPH_TRANSPORT_FIXTURE " + str(output))
