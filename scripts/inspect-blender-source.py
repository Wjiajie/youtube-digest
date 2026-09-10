"""Read-only source intake inside Blender; never execute embedded text or save.

Run with --background --factory-startup --disable-autoexec --offline-mode,
then the acquired .blend, --python-exit-code 1, and --python this file.
This inspection is not a declaration of final art or export compatibility.
"""
import json
import os
import bpy

assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
assert not bpy.app.online_access

report = {
    "blender": bpy.app.version_string,
    "source": bpy.data.filepath,
    "autoexec": bpy.context.preferences.filepaths.use_scripts_auto_execute,
    "online": bpy.app.online_access,
    "objects": [],
    "actions": [{"name": action.name, "frames": list(action.frame_range)} for action in bpy.data.actions],
    "materials": [{"name": material.name, "nodes": material.use_nodes} for material in bpy.data.materials],
    "externalLibraries": [library.filepath for library in bpy.data.libraries],
    "images": [{"name": image.name, "source": image.source, "users": image.users,
                "packed": bool(image.packed_file), "path": image.filepath,
                "fileExists": os.path.isfile(bpy.path.abspath(image.filepath)) if image.source == "FILE" else None}
               for image in bpy.data.images],
    "embeddedTextNames": [text.name for text in bpy.data.texts],
}
for obj in bpy.data.objects:
    entry = {"name": obj.name, "type": obj.type, "parent": obj.parent.name if obj.parent else None}
    if obj.type == "MESH":
        entry.update({"vertices": len(obj.data.vertices), "polygons": len(obj.data.polygons),
                      "vertexGroups": len(obj.vertex_groups), "shapeKeys": bool(obj.data.shape_keys),
                      "modifiers": [modifier.type for modifier in obj.modifiers]})
    if obj.type == "ARMATURE":
        entry["bones"] = len(obj.data.bones)
        entry["nla"] = [track.name for track in obj.animation_data.nla_tracks] if obj.animation_data else []
    report["objects"].append(entry)
print("BLUEPRINT_SOURCE_INSPECTION " + json.dumps(report, ensure_ascii=False))
