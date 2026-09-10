"""Read-only body/sash surface-fit regression on an actual Eastern study.

Checks rest and every source action's integer frames. Surface proximity is not
a trouser-collision, clothing simulation or artistic-quality verdict.
Args: --rest, action frame, or --all-actions (default). Requires the matching
uncompressed GLB and the study export world-coordinate convention.
"""
import bpy
import hashlib
import json
import math
import sys
import struct
from collections import Counter
from pathlib import Path
from mathutils.bvhtree import BVHTree

assert not bpy.app.online_access and not bpy.context.preferences.filepaths.use_scripts_auto_execute
source = Path(bpy.data.filepath)
before = hashlib.sha256(source.read_bytes()).hexdigest()
arm, body, sash = (bpy.data.objects[name] for name in ("CharacterArmature", "Casual_Body", "Eastern / sash"))
arm.animation_data.use_nla = False
arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["--all-actions"]
assert arguments in (["--rest"], ["--all-actions"]) or len(arguments) == 2
# GLB retains the rest-shape triangulation throughout skinning. Re-tessellating
# nonplanar quads after posing changes the surface and can report false contacts.
body.data.calc_loop_triangles()
triangles = [tuple(face.vertices) for face in body.data.loop_triangles
             if "outer cloth" in body.data.materials[face.material_index].name]
assert triangles
assert all(modifier.type == "ARMATURE" for modifier in body.modifiers), "Only topology-preserving armature deformation is supported"

# Check the actual exported primitive, not only an assumption about Blender's
# exporter. This deliberately supports the uncompressed local study format only.
glb = source.with_suffix(".glb")
payload = glb.read_bytes()
assert struct.unpack_from("<III", payload) == (0x46546C67, 2, len(payload))
json_length, json_kind = struct.unpack_from("<II", payload, 12)
assert json_kind == 0x4E4F534A
document = json.loads(payload[20:20 + json_length])
binary_length, binary_kind = struct.unpack_from("<II", payload, 20 + json_length)
assert binary_kind == 0x004E4942 and 28 + json_length + binary_length == len(payload)


def accessor_values(index, kind, components):
    accessor = document["accessors"][index]
    assert accessor["type"] == kind and "sparse" not in accessor
    view = document["bufferViews"][accessor["bufferView"]]
    assert view["buffer"] == 0 and "extensions" not in view
    formats = {5123: "H", 5125: "I", 5126: "f"}
    format_string = "<" + formats[accessor["componentType"]] * components
    size = struct.calcsize(format_string)
    stride = view.get("byteStride", size)
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return [struct.unpack_from(format_string, payload, 28 + json_length + offset + i * stride)
            for i in range(accessor["count"])]


def triangle_key(points):
    rounded = tuple(tuple(round(value, 6) for value in point) for point in points)
    return min(rounded[i:] + rounded[:i] for i in range(3))


node = next(node for node in document["nodes"] if node.get("name") == body.name)
exported = Counter()
for primitive in document["meshes"][node["mesh"]]["primitives"]:
    if "outer cloth" not in document["materials"][primitive["material"]]["name"]:
        continue
    assert primitive.get("mode", 4) == 4
    positions = accessor_values(primitive["attributes"]["POSITION"], "VEC3", 3)
    indices = [value[0] for value in accessor_values(primitive["indices"], "SCALAR", 1)]
    assert len(indices) % 3 == 0
    exported.update(triangle_key([positions[index] for index in indices[i:i + 3]]) for i in range(0, len(indices), 3))
world_points = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
rest_triangles = Counter(triangle_key([(world_points[index].x, world_points[index].z,
                                     -world_points[index].y) for index in face]) for face in triangles)
assert exported == rest_triangles, "Audit surface must match the actual GLB cloth triangulation and winding"


def measure():
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    surface = body.evaluated_get(graph)
    assert len(surface.data.vertices) == len(body.data.vertices), "Audit requires topology-preserving deformation"
    points = [surface.matrix_world @ vertex.co for vertex in surface.data.vertices]
    assert all(math.isfinite(value) for point in points for value in point)
    tree = BVHTree.FromPolygons(points, triangles, all_triangles=True)
    garment = sash.evaluated_get(graph)
    distances, failures = [], []
    for vertex in garment.data.vertices:
        point = garment.matrix_world @ vertex.co
        assert all(math.isfinite(value) for value in point)
        hit, normal, _, distance = tree.find_nearest(point)
        assert hit is not None
        signed = (point - hit).dot(normal)
        assert math.isfinite(signed) and math.isfinite(distance)
        distances.append(distance)
        if signed <= .001 or distance >= .012:
            failures.append({"vertex": vertex.index, "signed_distance_m": signed, "distance_m": distance})
    assert distances
    return {"min_distance_m": min(distances), "max_distance_m": max(distances),
            "failing_vertices": len(failures), "witnesses": failures[:2]}


report = []
if arguments in (["--rest"], ["--all-actions"]):
    arm.data.pose_position = "REST"
    report.append({"action": "REST", "frame": None, **measure()})
arm.data.pose_position = "POSE"
actions = [] if arguments == ["--rest"] else (sorted(bpy.data.actions, key=lambda action: action.name)
           if arguments == ["--all-actions"] else [bpy.data.actions[arguments[0]]])
if arguments == ["--all-actions"]:
    assert len(actions) == 24
for action in actions:
    arm.animation_data.action = action
    start, end = map(float, action.frame_range)
    frames = sorted(set([start, end, *range(math.ceil(start), math.floor(end) + 1)])) if arguments == ["--all-actions"] else [float(arguments[1])]
    for frame in frames:
        assert math.isfinite(frame) and start <= frame <= end
        bpy.context.scene.frame_set(math.floor(frame), subframe=frame % 1)
        report.append({"action": action.name, "frame": frame, **measure()})
assert hashlib.sha256(source.read_bytes()).hexdigest() == before
assert glb.read_bytes() == payload, "Exported asset must remain unchanged"
failures = [row for row in report if row["failing_vertices"]]
print("SASH_FIT " + json.dumps({"source_sha256": before, "samples": len(report), "actions": len(actions),
      "glb_sha256": hashlib.sha256(payload).hexdigest(), "verified_cloth_triangles": sum(exported.values()),
      "min_distance_m": min(row["min_distance_m"] for row in report),
      "max_distance_m": max(row["max_distance_m"] for row in report),
      "failing_samples": len(failures), "first_failures": failures[:3],
      "scope": "sash vertices near the clothed torso; not face-interior or trouser-collision clearance"}))
assert not failures, f"Sash fails fit in {len(failures)}/{len(report)} sampled poses"
