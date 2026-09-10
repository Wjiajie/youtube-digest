"""Read-only check of actual sleeve/torso continuity in an opened study .blend.

Run Blender with --disable-autoexec --offline-mode and --python-exit-code 1.
The source body's Skin/cloth material boundary defines the seam, not a marker.
"""
import bpy

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
arm.animation_data.action = bpy.data.actions["Idle_Neutral"]
maximum = 0
for frame in (0, 4, 19):
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    evaluated_body = body.evaluated_get(graph)
    for sleeve, body_index, sleeve_index in matches:
        evaluated_sleeve = sleeve.evaluated_get(graph)
        point = evaluated_body.matrix_world @ evaluated_body.data.vertices[body_index].co
        other = evaluated_sleeve.matrix_world @ evaluated_sleeve.data.vertices[sleeve_index].co
        error = (point - other).length
        maximum = max(maximum, error)
        assert error < 1e-6, f"Sleeve/torso separated by {error:.6f}m in neutral idle frame {frame}"
print("SLEEVE_JOINS", {"roots": len(matches), "idle_frames": 3, "max_error_m": maximum})
