"""Check actual loaded source mesh validity and four-joint export readiness.

Run in Blender with factory startup, disabled autoexec and offline mode.
Validation uses disposable copies; it never repairs or saves the source.
--mesh-only checks data validity without claiming four-joint readiness.
"""
import json
import sys
import bpy

assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
assert not bpy.app.online_access
assert bpy.data.filepath.endswith(("Casual.blend", "Casual.weight-repaired-study.blend"))

report = []
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    mesh = obj.data.copy()
    try:
        invalid = mesh.validate(verbose=True)
    finally:
        bpy.data.meshes.remove(mesh)
    armature = obj.find_armature()
    bones = {bone.name for bone in armature.data.bones} if armature else set()
    maximum = 0
    over_limit = 0
    for vertex in obj.data.vertices:
        count = sum(group.weight > 0 and obj.vertex_groups[group.group].name in bones for group in vertex.groups)
        maximum = max(maximum, count)
        over_limit += count > 4
    report.append({"object": obj.name, "invalidMesh": invalid, "maximumInfluences": maximum, "overLimitVertices": over_limit})
print("BLUEPRINT_SOURCE_QUALITY " + json.dumps(report))
assert report and all(not item["invalidMesh"] for item in report), "Source contains invalid mesh data"
if "--mesh-only" not in sys.argv:
    assert all(item["overLimitVertices"] == 0 for item in report), "Four-joint readiness remains unproven; do not silently truncate influences"
