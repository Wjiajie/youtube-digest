"""Read-only rest-shape waist coverage check on the actual authored garment.

This is a seam-fit witness, not a complete collision or animation certificate.
The four robe top edges must sit inside the sash's height and within 6 mm of it.
"""
import hashlib
import json
from pathlib import Path
import bpy
from mathutils.bvhtree import BVHTree

assert not bpy.app.online_access
assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
source = Path(bpy.data.filepath)
before = hashlib.sha256(source.read_bytes()).hexdigest()
arm = bpy.data.objects["CharacterArmature"]
arm.data.pose_position = "REST"
bpy.context.view_layer.update()
sash = bpy.data.objects["Eastern / sash"]
sash_points = [sash.matrix_world @ vertex.co for vertex in sash.data.vertices]
tree = BVHTree.FromPolygons(sash_points, [tuple(face.vertices) for face in sash.data.polygons])
low, high = min(point.z for point in sash_points), max(point.z for point in sash_points)
robes = [obj for obj in bpy.context.scene.objects if obj.name.startswith("Eastern / split robe ")]
assert len(robes) == 4
results = []
for robe in robes:
    points = [robe.matrix_world @ vertex.co for vertex in robe.data.vertices]
    top = max(point.z for point in points)
    boundary = [point for point in points if abs(point.z - top) < 1e-6]
    assert len(boundary) == 13
    distances = [tree.find_nearest(point)[3] for point in boundary]
    results.append({"robe": robe.name, "top": top, "sash_low": low, "sash_high": high,
                    "maximum_distance_mm": max(distances) * 1000,
                    "within_envelope": all(low + .001 <= point.z <= high - .001 for point in boundary)
                               and max(distances) <= .006})
assert hashlib.sha256(source.read_bytes()).hexdigest() == before
print("WAIST_JOIN " + json.dumps({"source_sha256": before, "panels": results,
      "scope": "rest-pose top-row proximity and height only; no animation/collision proof"}))
assert all(row["within_envelope"] for row in results), "Robe waist is outside the sash seam envelope"
