"""Bounded source-to-GLB feasibility check, not a production art build.

Invoke in Blender with factory startup, disabled autoexec and offline mode,
after opening the acquired Casual.blend or the pinned weight-repair study.
Never saves or alters that source. This is not a general-purpose exporter.
"""
import hashlib
import sys
from pathlib import Path
import bpy

assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
assert not bpy.app.online_access
source = Path(bpy.data.filepath)
variants = {
    "Casual.blend": ("204d82f2f481116cbb4433e69075b52e99f49b0df60ac04b44462f5704f3ee9f", "Casual.source-study.glb"),
    "Casual.weight-repaired-study.blend": ("216fc727182f827c9774d862e2f161c58d3d7e63367f43ad9c3984d386cc0395", "Casual.weight-repaired-study.glb"),
}
expected_hash, output_name = variants[source.name]
assert hashlib.sha256(source.read_bytes()).hexdigest() == expected_hash
arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
assert arguments in ([], ["--all-influences"]), "Unknown study export option."
full_influences = arguments == ["--all-influences"]
if full_influences:
    assert source.name == "Casual.weight-repaired-study.blend", "Use the verified weight repair for full-influence export."
    output_name = "Casual.full-influence-study.glb"
output = source.with_name(output_name)
assert not output.exists(), "Keep prior study evidence; do not overwrite it."
# Apply Mirror geometry, retain the Armature and export its separate actions.
# Shape keys would be lost by export_apply; the acquired source has none.
assert all(not mesh.shape_keys for mesh in bpy.data.meshes)
result = bpy.ops.export_scene.gltf(
    filepath=str(output), export_format="GLB", export_apply=True,
    export_animations=True, export_animation_mode="ACTIONS",
    export_all_influences=full_influences,
    export_unused_images=False, export_unused_textures=False, will_save_settings=False,
)
assert result == {"FINISHED"}
print("BLUEPRINT_SOURCE_EXPORT", output.name, output.stat().st_size,
      hashlib.sha256(output.read_bytes()).hexdigest())
