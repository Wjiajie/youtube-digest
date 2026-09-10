"""Bounded source-to-GLB feasibility check, not a production art build.

Invoke in Blender with factory startup, disabled autoexec and offline mode,
after opening the acquired Casual.blend. Never saves or alters that source.
"""
import hashlib
from pathlib import Path
import bpy

assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
assert not bpy.app.online_access
source = Path(bpy.data.filepath)
assert source.name == "Casual.blend"
assert hashlib.sha256(source.read_bytes()).hexdigest() == "204d82f2f481116cbb4433e69075b52e99f49b0df60ac04b44462f5704f3ee9f"
output = source.with_name("Casual.source-study.glb")
assert not output.exists(), "Keep prior study evidence; do not overwrite it."
# Apply Mirror geometry, retain the Armature and export its separate actions.
# Shape keys would be lost by export_apply; the acquired source has none.
assert all(not mesh.shape_keys for mesh in bpy.data.meshes)
result = bpy.ops.export_scene.gltf(
    filepath=str(output), export_format="GLB", export_apply=True,
    export_animations=True, export_animation_mode="ACTIONS",
    export_unused_images=False, export_unused_textures=False, will_save_settings=False,
)
assert result == {"FINISHED"}
print("BLUEPRINT_SOURCE_EXPORT", output.name, output.stat().st_size,
      hashlib.sha256(output.read_bytes()).hexdigest())
