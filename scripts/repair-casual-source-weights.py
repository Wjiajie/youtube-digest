"""Repair only the four confirmed out-of-range weights into a new source copy.

Does not prune influences, change topology, export GLB, or save the original.
Use factory startup, disabled autoexec and offline mode in Blender.
"""
import hashlib
import json
from pathlib import Path
import bpy

assert not bpy.app.online_access
assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
source = Path(bpy.data.filepath)
assert source.name == "Casual.blend"
assert hashlib.sha256(source.read_bytes()).hexdigest() == "204d82f2f481116cbb4433e69075b52e99f49b0df60ac04b44462f5704f3ee9f"
output = source.with_name("Casual.weight-repaired-study.blend")
assert not output.exists(), "Do not overwrite an existing study."
changes = []
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    for vertex in obj.data.vertices:
        for assignment in vertex.groups:
            if assignment.weight > 1:
                changes.append((obj.name, vertex.index, assignment.group, assignment.weight))
assert [(name, vertex, group) for name, vertex, group, _ in changes] == [
    ("Casual_Body", 280, 19), ("Casual_Body", 290, 19),
    ("Casual_Body", 406, 23), ("Casual_Legs", 31, 56),
], "Unexpected source defects: inspect before modifying"
for name, vertex, group, previous in changes:
    bpy.data.objects[name].vertex_groups[group].add([vertex], 1.0, "REPLACE")
for mesh in bpy.data.meshes:
    disposable = mesh.copy()
    try:
        assert not disposable.validate(), "Additional mesh defects remain"
    finally:
        bpy.data.meshes.remove(disposable)
assert bpy.ops.wm.save_as_mainfile(filepath=str(output), copy=True, check_existing=True) == {"FINISHED"}
assert Path(bpy.data.filepath) == source
assert hashlib.sha256(source.read_bytes()).hexdigest() == "204d82f2f481116cbb4433e69075b52e99f49b0df60ac04b44462f5704f3ee9f"
print("BLUEPRINT_WEIGHT_REPAIR " + json.dumps({"changes": changes, "output": output.name,
      "bytes": output.stat().st_size, "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
      "extraInfluencesPreserved": True}))
