"""Independent re-open check: exactly four weights changed, mesh data preserved."""
from pathlib import Path
import bpy

assert not bpy.app.online_access
assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
directory = Path(".tools/asset-intake/quaternius-women").resolve()
names = ("Casual_Body", "Casual_Feet", "Casual_Head", "Casual_Legs", "CharacterArmature")

def snapshot(filename):
    with bpy.data.libraries.load(str(directory / filename), link=False) as (_, target):
        target.objects = list(names)
    result = {}
    for name, obj in zip(names, target.objects):
        assert obj is not None
        if obj.type == "ARMATURE":
            result[name] = {"bones": [(bone.name, tuple(bone.head_local), tuple(bone.tail_local)) for bone in obj.data.bones]}
            continue
        result[name] = {
            "positions": [tuple(vertex.co) for vertex in obj.data.vertices],
            "polygons": [tuple(polygon.vertices) for polygon in obj.data.polygons],
            "uv": [[tuple(value.uv) for value in layer.data] for layer in obj.data.uv_layers],
            "modifiers": [modifier.type for modifier in obj.modifiers],
            "groups": [group.name for group in obj.vertex_groups],
            "weights": {(vertex.index, group.group): group.weight for vertex in obj.data.vertices for group in vertex.groups},
        }
    return result

original = snapshot("Casual.blend")
repaired = snapshot("Casual.weight-repaired-study.blend")
changed = []
for name in names:
    before = original[name].pop("weights", {})
    after = repaired[name].pop("weights", {})
    assert original[name] == repaired[name], f"Unexpected geometry, UV, modifier or skeleton change: {name}"
    assert before.keys() == after.keys(), f"Influence removed or added: {name}"
    for key, weight in before.items():
        if weight != after[key]:
            assert weight > 1 and after[key] == 1
            changed.append((name, *key))
assert changed == [("Casual_Body", 280, 19), ("Casual_Body", 290, 19),
                   ("Casual_Body", 406, 23), ("Casual_Legs", 31, 56)]
print("BLUEPRINT_WEIGHT_REPAIR_VERIFIED: four corrected weights; all influence assignments, positions, polygons, UVs, modifier types and bone endpoints unchanged")
