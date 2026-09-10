"""Bounded P2 look development from pinned local sources, not a production asset build.

Blender: factory startup, --disable-autoexec, --offline-mode, repaired Casual source;
script args after --: cyberpunk|eastern revision-number. New outputs only.
"""
import hashlib
import math
import re
import sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
assert not bpy.app.online_access
arguments = sys.argv[sys.argv.index("--") + 1:]
assert len(arguments) == 2 and arguments[0] in ("cyberpunk", "eastern")
theme, revision = arguments
assert re.fullmatch(r"[1-9][0-9]?", revision)
source = Path(bpy.data.filepath)
assert hashlib.sha256(source.read_bytes()).hexdigest() == "216fc727182f827c9774d862e2f161c58d3d7e63367f43ad9c3984d386cc0395"
project = Path(__file__).resolve().parent.parent
output = project / ".tools" / "asset-studies" / ("dual-theme-v" + revision)
blend = output / (theme + ".blend")
glb = output / (theme + ".glb")
assert not blend.exists() and not glb.exists(), "Keep earlier look-development evidence."
output.mkdir(parents=True, exist_ok=True)
arm = bpy.data.objects["CharacterArmature"]
assert all(abs(arm.matrix_world[i][j] - (1 if i == j else 0)) < 1e-6 for i in range(4) for j in range(4))
arm.data.pose_position = "REST"
bpy.context.view_layer.update()


def rgb(hex_value):
    channels = [int(hex_value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in channels)


def material(name, color, roughness=.7, metal=0, emission=0):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*rgb(color), 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metal
    shader.inputs["Emission Color"].default_value = (*rgb(color), 1)
    shader.inputs["Emission Strength"].default_value = emission
    result.diffuse_color = (*rgb(color), 1)
    return result


palette = {
    "skin": material("Identity / warm skin", "CDA484", .74),
    "hair": material("Identity / hair", "3D3742" if theme == "cyberpunk" else "222F30", .6),
    "eyes": material("Identity / eyes", "292428", .6),
    "cloth": material(theme + " / outer cloth", "304B59" if theme == "cyberpunk" else "C7C7AF", .94),
    "lining": material(theme + " / lining", "192C37" if theme == "cyberpunk" else "354C47", .96),
    "accent": material(theme + " / accent", "DDA26D" if theme == "cyberpunk" else "B39560", .45, .35),
    "dark": material(theme + " / dark structure", "18252C" if theme == "cyberpunk" else "43534B", .68, .25 if theme == "cyberpunk" else 0),
    "light": material(theme + " / light detail", "76BFC2" if theme == "cyberpunk" else "DFD5B9", .42, .2, .8 if theme == "cyberpunk" else 0),
}
replacements = {"Skin": "skin", "Hair_Blond": "hair", "Hair_Brown": "hair", "Brown": "eyes", "White": "cloth", "Orange": "lining", "Grey": "dark"}
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    for index, original in enumerate(obj.data.materials):
        obj.data.materials[index] = palette[replacements[original.name]]
    for polygon in obj.data.polygons:
        # Garment panels retain their source positions/weights but no longer
        # read as faceted metal plates. This applies only to the source avatar.
        polygon.use_smooth = obj.data.materials[polygon.material_index] in (
            palette["skin"], palette["hair"], palette["cloth"], palette["lining"], palette["dark"])
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        if modifier.type == "MIRROR":
            bpy.ops.object.modifier_apply(modifier=modifier.name)


def mesh_object(name, vertices, faces, surface, weights=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    result = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(result)
    data.materials.append(surface)
    if weights:
        result.parent = arm
        for index, binding in enumerate(weights):
            for bone, value in binding.items():
                group = result.vertex_groups.get(bone) or result.vertex_groups.new(name=bone)
                group.add([index], value, "REPLACE")
        modifier = result.modifiers.new("Identity armature", "ARMATURE")
        modifier.object = arm
    return result


def box(name, position, size, surface, bevel=.025, bone=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    result = bpy.context.object
    result.name = name
    result.dimensions = size
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    result.data.materials.append(surface)
    if bevel:
        modifier = result.modifiers.new("Made edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    if bone:
        result.parent = arm
        result.vertex_groups.new(name=bone).add(list(range(len(result.data.vertices))), 1, "REPLACE")
        result.modifiers.new("Identity armature", "ARMATURE").object = arm
    return result


def ribbon(name, points, width, surface, bone):
    vertices = [(x + offset, y, z) for x, y, z in points for offset in (-width / 2, width / 2)]
    faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(points) - 1)]
    result = mesh_object(name, vertices, faces, surface, [{bone: 1}] * len(vertices))
    result.data.materials[0].use_backface_culling = False
    return result


def surface_sampler(obj, surface):
    """Sample the real surface and its normalized skinning, not guessed offsets."""
    obj.data.calc_loop_triangles()
    triangles = [tuple(face.vertices) for face in obj.data.loop_triangles
                 if obj.data.materials[face.material_index] == surface]
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    tree = BVHTree.FromPolygons(points, triangles, all_triangles=True)

    def sample(origin, direction, offset):
        hit, normal, triangle, _ = tree.ray_cast(Vector(origin), Vector(direction))
        assert hit is not None, "Authored feature must lie on the actual source surface"
        indices = triangles[triangle]
        factors = barycentric_transform(hit, *(points[index] for index in indices),
                                        Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
        weights = {}
        for index, factor in zip(indices, factors):
            groups = obj.data.vertices[index].groups
            total = sum(group.weight for group in groups)
            assert total > 0
            for group in groups:
                name = obj.vertex_groups[group.group].name
                weights[name] = weights.get(name, 0) + max(0, factor) * group.weight / total
        return tuple(hit + normal * offset), weights
    return sample


# Replace the source's protruding rectangular eye cubes only in this derivative;
# facial features follow the existing Skin surface and Head/Neck deformation.
head = bpy.data.objects["Casual_Head"]
sample_face = surface_sampler(head, palette["skin"])
eye_white = material("Identity / warm sclera", "E5DED0", .64)
iris = material("Identity / iris", "3C4D48", .48)
lip = material("Identity / lip", "A87567", .75)
mouth_line = material("Identity / mouth line", "73534D", .8)


def face_patch(name, outline, center, surface, offset, bulge=0):
    points = [center, *outline]
    samples = [sample_face((x, -1, z), (0, 1, 0), offset + (bulge if index == 0 else 0))
               for index, (x, z) in enumerate(points)]
    faces = [(0, index + 1, (index + 1) % len(outline) + 1) for index in range(len(outline))]
    result = mesh_object(name, [point for point, _ in samples], faces, surface, [weight for _, weight in samples])
    for face in result.data.polygons:
        face.use_smooth = True


def face_stroke(name, points, width, surface, offset):
    samples = [sample_face((x, -1, z + delta), (0, 1, 0), offset)
               for x, z in points for delta in (-width / 2, width / 2)]
    faces = [(2 * index, 2 * index + 1, 2 * index + 3, 2 * index + 2) for index in range(len(points) - 1)]
    mesh_object(name, [point for point, _ in samples], faces, surface, [weight for _, weight in samples])


for side, sign in (("L", 1), ("R", -1)):
    center_x, center_z = sign * .047, 1.689
    outline = [(center_x + .020 * math.cos(step * math.tau / 32),
                center_z + .0085 * math.sin(step * math.tau / 32)) for step in range(32)]
    face_patch("Identity / eye white " + side, outline, (center_x, center_z), eye_white, .001, .001)
    for label, radius_x, radius_z, surface, offset in [("iris", .006, .0073, iris, .003),
                                                     ("pupil", .0031, .0051, palette["eyes"], .004)]:
        outline = [(center_x + radius_x * math.cos(step * math.tau / 24),
                    center_z + radius_z * math.sin(step * math.tau / 24)) for step in range(24)]
        face_patch("Identity / " + label + " " + side, outline, (center_x, center_z), surface, offset)
    face_stroke("Identity / upper lid " + side,
                [(center_x + .020 * math.cos(step * math.pi / 16), center_z + .0085 * math.sin(step * math.pi / 16)) for step in range(17)],
                .0017, palette["eyes"], .0027)
face_patch("Identity / lower lip", [(.022 * math.cos(step * math.tau / 32),
                                     1.6135 + .004 * math.sin(step * math.tau / 32)) for step in range(32)],
           (0, 1.6135), lip, .0007, .001)
face_stroke("Identity / closed smile", [(x / 1000, 1.614 + .0018 * (x / 22) ** 2) for x in range(-22, 23, 2)],
            .0009, mouth_line, .002)
edit_head = bmesh.new()
edit_head.from_mesh(head.data)
bmesh.ops.delete(edit_head, geom=[face for face in edit_head.faces if head.data.materials[face.material_index] == palette["eyes"]], context="FACES")
edit_head.to_mesh(head.data)
edit_head.free()


# Fit the sleeve center and minimum radius to the actual source skin cross-section.
body = bpy.data.objects["Casual_Body"]
skin_vertices = {index for face in body.data.polygons if body.data.materials[face.material_index] == palette["skin"] for index in face.vertices}
skin_points = [body.matrix_world @ body.data.vertices[index].co for index in skin_vertices]
edge_materials = {}
for face in body.data.polygons:
    surface = body.data.materials[face.material_index]
    for edge in face.edge_keys:
        edge_materials.setdefault(tuple(sorted(edge)), set()).add(surface)
sleeve_edges = [edge for edge, surfaces in edge_materials.items()
                if palette["skin"] in surfaces and palette["cloth"] in surfaces
                and all(abs(body.data.vertices[index].co.x) > .15 for index in edge)]

# Sleeves follow the existing rest-pose bones, with a blended elbow, not rigid props.
for side, sign in (("L", 1), ("R", -1)):
    stations = [(.245, .009), (.29, .014), (.35, .014), (.46, .011), (.555, .009)]
    if theme == "eastern":
        stations = [(.245, .015), (.29, .025), (.35, .033), (.46, .039), (.55, .021)]
    root_indices = {index for edge in sleeve_edges for index in edge if sign * body.data.vertices[index].co.x > 0}
    assert len(root_indices) == 8
    root_center = sum((body.data.vertices[index].co for index in root_indices), Vector()) / len(root_indices)
    root_indices = sorted(root_indices, key=lambda index: math.atan2(body.data.vertices[index].co.z - root_center.z,
                                                                    body.data.vertices[index].co.y - root_center.y))
    vertices = [tuple(body.matrix_world @ body.data.vertices[index].co) for index in root_indices]
    # The coincident seam must deform exactly like the torso, including Shoulder
    # influences and original weight sums. Approximate UpperArm binding opens it.
    weights = [{body.vertex_groups[group.group].name: group.weight for group in body.data.vertices[index].groups}
               for index in root_indices]
    angles = [math.atan2(point[2] - root_center.z, point[1] - root_center.y) for point in vertices]
    faces = []
    segments = len(root_indices)
    for x, padding in stations:
        section = [point for point in skin_points if abs(point.x - sign * x) < .038 and point.z > 1.36]
        assert section, "Missing source sleeve fit section"
        center_y = (min(point.y for point in section) + max(point.y for point in section)) / 2
        center_z = (min(point.z for point in section) + max(point.z for point in section)) / 2
        radius_y = max(abs(point.y - center_y) for point in section) + padding
        radius_z = max(abs(point.z - center_z) for point in section) + padding
        elbow = min(1, max(0, (x - .29) / .10))
        for angle in angles:
            vertices.append((sign * x, center_y + math.cos(angle) * radius_y, center_z + math.sin(angle) * radius_z))
            weights.append({"UpperArm." + side: 1 - elbow, "LowerArm." + side: elbow})
    for row in range(len(stations)):
        for step in range(segments):
            following = (step + 1) % segments
            faces.append((row * segments + step, row * segments + following, (row + 1) * segments + following, (row + 1) * segments + step))
    if sign < 0:
        faces = [tuple(reversed(face)) for face in faces]
    sleeve = mesh_object(theme + " / shaped sleeve " + side, vertices, faces, palette["cloth"], weights)
    for face in sleeve.data.polygons:
        face.use_smooth = True

# Long sleeves own this surface now. Remove only covered upper-arm skin from
# the derivative, avoiding skin piercing an otherwise coincident garment seam.
# Original files, shoulder cloth, exposed wrists and hands remain untouched.
edit_body = bmesh.new()
edit_body.from_mesh(body.data)
covered_faces = [face for face in edit_body.faces
                 if body.data.materials[face.material_index] == palette["skin"]
                 and .20 < abs(face.calc_center_median().x) < .515]
assert covered_faces
bmesh.ops.delete(edit_body, geom=covered_faces, context="FACES")
edit_body.to_mesh(body.data)
edit_body.free()

if theme == "cyberpunk":
    sample_cloth = surface_sampler(body, palette["cloth"])
    for side, sign in (("L", 1), ("R", -1)):
        samples = [sample_cloth((sign * x, y, 2), (0, 0, -1), .004)
                   for x in (.115, .145, .175, .20) for y in (-.087, -.065, -.045)]
        faces = [(row * 3 + column, (row + 1) * 3 + column, (row + 1) * 3 + column + 1, row * 3 + column + 1)
                 for row in range(3) for column in range(2)]
        if sign < 0:
            faces = [tuple(reversed(face)) for face in faces]
        mesh_object("Cyber / fitted shoulder yoke " + side, [point for point, _ in samples], faces,
                    palette["dark"], [weight for _, weight in samples])
    ribbon("Cyber / offset fastening", [(.04, -.197, 1.46), (.01, -.207, 1.34), (.015, -.18, 1.10)], .012, palette["accent"], "Torso")
    box("Cyber / chest device", (-.09, -.197, 1.36), (.073, .02, .052), palette["dark"], .006, "Chest")
    box("Cyber / device indicator", (-.09, -.210, 1.36), (.042, .005, .008), palette["light"], .001, "Chest")
    box("Cyber / ear receiver", (.105, -.037, 1.675), (.027, .06, .092), palette["dark"], .008, "Head")
else:
    # Four tailored skirt panels leave front/back movement slits. Idle-only art
    # evidence does not claim these panels are safe in the full combat clip set.
    for side, sign in (("L", 1), ("R", -1)):
        for front, direction in (("front", -1), ("back", 1)):
            vertices, weights = [], []
            # Cloth folds grow out of the fitted waist, taper toward the slit,
            # and carry a curved hem instead of four flat rectangular boards.
            columns, rows = 13, 13
            for row in range(rows):
                drop = row / (rows - 1)
                z = 1.11 - .63 * drop
                width = .172 + .10 * drop
                depth = .116 + .058 * math.sin(drop * math.pi / 2)
                leg_weight = .85 * drop
                for column in range(columns):
                    fraction = .10 + .90 * column / (columns - 1)
                    fold = .014 * math.sin(fraction * math.pi * 6 + .25 * drop) * math.sin(drop * math.pi / 2)
                    hem = .022 * drop ** 5 * (1 - fraction) ** 2
                    vertices.append((sign * width * fraction,
                                     -.052 + direction * (depth * (1 - .27 * fraction ** 2) + fold), z + hem))
                    weights.append({"Hips": 1 - leg_weight, "UpperLeg." + side: leg_weight})
            faces = [(row * columns + column, row * columns + column + 1,
                      (row + 1) * columns + column + 1, (row + 1) * columns + column)
                     for row in range(rows - 1) for column in range(columns - 1)]
            if (sign * direction) < 0:
                faces = [tuple(reversed(face)) for face in faces]
            robe = mesh_object("Eastern / split robe " + side + " " + front, vertices, faces, palette["cloth"], weights)
            robe.data.materials.append(palette["lining"])
            for face in robe.data.polygons:
                face.use_smooth = True
                # The hem is part of the same surface, not a nearly coincident
                # overlay that self-shadows or flickers during skinning.
                if face.index >= (rows - 2) * (columns - 1):
                    face.material_index = 1
    ribbon("Eastern / crossing collar", [(-.08, -.168, 1.50), (.055, -.210, 1.34), (.11, -.172, 1.12)], .037, palette["lining"], "Torso")
    ribbon("Eastern / inner collar", [(.077, -.17, 1.49), (-.008, -.206, 1.39)], .025, palette["lining"], "Chest")
    box("Eastern / sash", (0, -.067, 1.115), (.345, .24, .055), palette["lining"], .020, "Hips")
    box("Eastern / clasp", (.07, -.195, 1.12), (.045, .012, .04), palette["accent"], .006, "Hips")
    box("Eastern / hair pin", (0, .051, 1.80), (.24, .014, .014), palette["accent"], .004, "Head")


def import_nature(name, path, height, position, turn=0):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = list(bpy.context.selected_objects)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    assert meshes
    if "stone bank" in name:
        for obj in meshes:
            for index in range(len(obj.data.materials)):
                obj.data.materials[index] = material(name + " / slate " + str(index), "737F79" if index == 0 else "626F66", .95)
            bevel = obj.modifiers.new("Worn slate edges", "BEVEL")
            bevel.width = .025
            bevel.segments = 2
    if "tree" in name or "canopy" in name:
        for obj in meshes:
            for surface in obj.data.materials:
                if not surface.use_nodes:
                    continue
                bsdf = surface.node_tree.nodes.get("Principled BSDF")
                if not bsdf or not bsdf.inputs["Base Color"].is_linked:
                    continue
                original = bsdf.inputs["Base Color"].links[0].from_socket
                # Blender 4.5 glTF recognizes the modern color Mix node's factor;
                # legacy MixRGB silently drops it from baseColorFactor.
                tint = surface.node_tree.nodes.new("ShaderNodeMix")
                tint.data_type = "RGBA"
                tint.blend_type = "MULTIPLY"
                tint.inputs[0].default_value = 1
                tint.inputs[7].default_value = (.10, .28, .80, 1) if surface.name == "BirchTree_Leaves" else (.72, .68, .58, 1)
                surface.node_tree.links.new(original, tint.inputs[6])
                surface.node_tree.links.new(tint.outputs[2], bsdf.inputs["Base Color"])
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = Vector([min(point[axis] for point in points) for axis in range(3)])
    high = Vector([max(point[axis] for point in points) for axis in range(3)])
    scale = height / (high.z - low.z)
    center = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
    parent = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(parent)
    for obj in objects:
        if obj.parent in objects:
            continue
        obj.parent = parent
        obj.location -= center
    parent.scale = (scale,) * 3
    parent.rotation_euler.z = turn
    parent.location = position
    return parent


tree_path = project / ".tools/asset-intake/quaternius-nature/BirchTree_1.base-color-study.gltf"
rock_path = project / ".tools/asset-intake/kenney-nature/Models/GLTF format/rock_largeA.glb"
assert hashlib.sha256(tree_path.read_bytes()).hexdigest() == "8bb157df6f49a8db04294a30f56cc1f56aaacba34ff539de3b09842e8835fb3a"
assert hashlib.sha256(rock_path.read_bytes()).hexdigest() == "6dd15390fd96501dcd1454765a17ba61dbbd8d47705dfe5149c8dd92b353ce25"
stone = material(theme + " / stone", "59616A" if theme == "cyberpunk" else "777E74", .9)
if theme == "cyberpunk":
    box("Cyber / quiet work deck", (0, .2, -.13), (3.9, 3.3, .26), palette["dark"], .15)
    box("Cyber / avatar step", (.28, -.5, .03), (1.35, 1.05, .08), stone, .05)
    for sign in (-1, 1):
        box("Cyber / portal upright", (sign * 1.18, 1.44, 1.06), (.10, .14, 2.12), palette["dark"], .025)
        box("Cyber / portal inset", (sign * 1.135, 1.357, 1.09), (.012, .008, 1.84), palette["light"], .003)
    # Open above the shoulders: architecture frames, rather than dwarfs, the person.
    # Broad oblique panels leave quiet space behind the face; repeated vertical
    # bars previously overpowered the identity silhouette.
    mesh_object("Cyber / oblique rear panel", [(-1.08,1.64,.20),(.90,1.64,.20),(.90,1.64,.88),(.38,1.64,1.12),(-1.08,1.64,1.12)],
                [(0,1,2,3,4)], palette["lining"])
    mesh_object("Cyber / bevel light seam", [(.37,1.625,1.10),(.91,1.625,.85),(.91,1.625,.88),(.38,1.625,1.13)],
                [(0,1,2,3)], palette["light"])
    for z in (.48, .56, .64):
        box("Cyber / quiet vent", (-.67,1.62,z), (.51,.025,.014), palette["dark"], .003)
    box("Cyber / side console", (1.72, .75, .44), (.42, .66, .88), palette["dark"], .05)
    mesh_object("Cyber / angled console top", [(1.40,.30,.92),(2.02,.30,.92),(2.02,1.05,1.15),(1.40,1.05,1.15)], [(0,1,2,3)], palette["lining"])
    box("Cyber / amber console strip", (1.72, .408, .69), (.24, .013, .03), palette["accent"], .004)
    box("Cyber / planted recess", (-1.36, .9, .14), (.78, .70, .28), stone, .05)
    import_nature("Cyber / living canopy", tree_path, 1.48, (-1.36, .9, .28), .45)
    for index in range(3):
        box("Cyber / deck inlay", (-.5 + index * .5, -.93, .007), (.17, .008, .007), palette["accent"], .002)
    arm.location = (.28, -.5, .08)
else:
    water = material("Eastern / still water", "436D68", .22, .25)
    box("Eastern / water field", (0, .2, -.16), (4.2, 3.7, .08), water, .06)
    box("Eastern / terrace", (.35, -.55, -.03), (2.12, 2.02, .22), stone, .10)
    box("Eastern / standing slab", (.35, -.6, .12), (1.25, .92, .1), material("Eastern / light stone", "A4ACA0", .92), .065)
    for index in range(3):
        box("Eastern / stepping stone", (-.6 - .43 * index, -1.4 - .15 * index, -.06), (.39, .36, .1), stone, .055)
    import_nature("Eastern / layered stone bank", rock_path, .42, (-1.30, 1.15, -.06), .8)
    import_nature("Eastern / low stone bank", rock_path, .34, (1.6, 1.4, -.08), 2.1)
    import_nature("Eastern / sheltering tree", tree_path, 1.85, (-1.40, 1.30, .28), -.7)
    # A short open timber screen gives a human scale without a full temple set.
    for sign in (-1, 1):
        box("Eastern / screen post", (.6 + sign * .7, 1.35, .65), (.07, .07, 1.45), palette["lining"], .012)
    for z in (.28, .85, 1.32):
        box("Eastern / screen rail", (.6, 1.35, z), (1.55, .055, .04), palette["lining"], .008)
    arm.location = (.35, -.6, .17)


def light(name, kind, position, energy, color, target):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = rgb(color)
    result = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(result)
    result.location = position
    result.rotation_euler = (Vector(target) - result.location).to_track_quat("-Z", "Y").to_euler()
    return result


light("Study / key", "SUN", (-3, -4, 6), 2.2 if theme == "eastern" else 1.7, "FFF0D3" if theme == "eastern" else "BDDDE3", (0, 0, 1))
light("Study / edge", "SUN", (3, 2, 4), .7 if theme == "eastern" else 1.4, "CFDBD2" if theme == "eastern" else "E3A875", (0, 0, 1))
camera_data = bpy.data.cameras.new("Study / composed camera")
camera = bpy.data.objects.new("Study / composed camera", camera_data)
bpy.context.collection.objects.link(camera)
camera.location = (2.65, -5.8, 2.5) if theme == "cyberpunk" else (2.8, -6.1, 2.6)
camera.rotation_euler = (Vector((.1, -.15, 1.08)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "PERSP"
camera.data.lens = 48
bpy.context.scene.camera = camera
arm.data.pose_position = "POSE"
bpy.context.scene.frame_set(0)
bpy.context.view_layer.update()
scene = bpy.context.scene
scene["blueprint_study"] = theme
scene["status"] = "internal look development; not licensed for product distribution or final art acceptance"
scene.render.resolution_x, scene.render.resolution_y = 1440, 1000
scene.render.resolution_percentage = 100
scene.world.color = (.08, .08, .08)
assert all(not mesh.shape_keys for mesh in bpy.data.meshes)
result = bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", export_apply=True,
    export_animations=True, export_animation_mode="ACTIONS", export_all_influences=True,
    export_cameras=True, export_lights=True, export_extras=True,
    export_import_convert_lighting_mode="COMPAT",
    export_unused_images=False, export_unused_textures=False, will_save_settings=False)
assert result == {"FINISHED"}
# Preserve all source actions for the GLB export, then save an editable startup
# state that matches the neutral-idle study rather than the source's NLA stack.
arm.animation_data.use_nla = False
arm.animation_data.action = bpy.data.actions["Idle_Neutral"]
scene.frame_set(0)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(blend), copy=True)
assert hashlib.sha256(source.read_bytes()).hexdigest() == "216fc727182f827c9774d862e2f161c58d3d7e63367f43ad9c3984d386cc0395"
print("BLUEPRINT_THEME_STUDY", theme, glb.stat().st_size, hashlib.sha256(glb.read_bytes()).hexdigest())
