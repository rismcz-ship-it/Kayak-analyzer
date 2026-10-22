---
name: computational-geometry
description: Design and review robust computational-geometry algorithms for CAD. Use whenever the task involves ray casting, point-in-polygon or point-in-solid tests, plane/curve/surface intersection, bounding boxes, spatial acceleration (BVH, KD-tree, R-tree), convex hull, boolean operations, distance and closest-point queries, or collision/interference checks — and especially when robustness, degenerate cases, or floating-point reliability matter. Use this skill when geometry code must give correct answers on real-world dirty data.
---

# Computational Geometry for CAD

Geometry algorithms that work on textbook inputs routinely fail on real CAD data: coplanar faces, slivers, coincident vertices, rays grazing edges. This skill helps design and review algorithms that stay correct on degenerate and near-degenerate input. Pair it with `robustness-rules.md` (the predicate/tolerance discipline) and `geometry-algorithms.md` (per-algorithm recipes and failure cases). For CGAL work, read `cgal-reference.md` before naming kernels, Polygon Mesh Processing APIs, AABB tree calls, self-intersection checks, or exact polyhedral booleans.

## When to use this skill

- Implementing or reviewing any of: ray casting, point-in-polygon/solid, intersections, hull, booleans, distance/closest-point, collision/interference, spatial indexing.
- A geometry function "mostly works" but fails on certain models — usually a degeneracy or tolerance bug.
- Choosing an acceleration structure for large geometry.

## Step-by-step workflow

1. **State the exact predicate.** "Is point P strictly inside solid S, on its boundary, or outside?" Boundary handling is where most bugs live — decide it up front.
2. **Choose representation.** Mesh vs B-Rep changes the algorithm (point-in-solid via ray parity needs a watertight mesh; B-Rep uses face classification).
3. **Name the tolerance and its units.** Every comparison gets an explicit `eps` tied to model scale, not a magic literal. See `robustness-rules.md`.
4. **Enumerate degeneracies before coding.** For ray casting: ray through a vertex, ray along an edge, coplanar triangle. For booleans: coplanar faces, coincident edges. Decide each case's behavior.
5. **Pick exactness level.** Float with tolerance (fast, fragile), robust predicates (orient2d/orient3d via adaptive precision, e.g. Shewchuk), or exact arithmetic (CGAL kernels). Match to correctness need.
6. **Add acceleration only after correctness.** Wrap the correct O(n²) check in a BVH/KD-tree/R-tree; verify the accelerated path agrees with brute force on fixtures.
7. **Write degeneracy fixtures** (hand off to cad-test-generator).

## Common mistakes to catch

- **Boundary ambiguity:** point-in-polygon that returns inconsistent results for points exactly on an edge. Use a consistent edge-inclusion rule and a tolerance band.
- **Ray-casting parity bugs:** counting a vertex-piercing intersection twice (or zero times). Perturb the ray direction or use a watertight ray-triangle test (e.g., Möller–Trumbore with consistent edge tests).
- **Naive float orientation:** `(b-a)×(c-a) > 0` flips sign near-collinear. Use robust orient predicates when the verdict drives topology.
- **eps with no units:** `if (d < 1e-6)` on a model in meters vs microns means different things. Scale eps to the bounding box or use relative tolerance.
- **Closest-point on triangle done only for the face interior**, ignoring edge/vertex Voronoi regions → wrong distance near edges.
- **Boolean on non-watertight input:** garbage in, garbage out. Validate manifoldness first.
- **AABB vs OBB confusion:** axis-aligned boxes overestimate overlap for rotated parts → false interference positives.

## Output format

For algorithm design:
```
Predicate: <exact statement incl. boundary behavior>
Representation: <mesh | B-Rep> ; Units: <mm/…> ; eps: <value + how derived>
Approach: <method + why>
Degenerate cases handled: <list, each with chosen behavior>
Exactness: <float+tol | robust predicates | exact kernel>
Acceleration: <none | BVH | KD-tree | R-tree> + reason
Validation: <brute-force cross-check + fixtures>
Complexity: <time/space>
```

## Examples

**Example 1 — point-in-solid (mesh)**
Input: "Robust point-in-solid for a watertight STL."
Output approach: Cast a ray from P in a fixed direction; count watertight ray-triangle intersections; odd = inside. Handle degeneracy by using a watertight ray-triangle test with consistent shared-edge tie-breaking (Möller–Trumbore is the base algorithm; Woop et al. 2013 JCGT provides a watertight variant that eliminates sign-flip errors at edges and vertices — prefer it over random ray jitter, which only reduces the probability of error rather than eliminating it). Precondition: mesh must be watertight + manifold (route to mesh-quality-review first). eps tied to bbox diagonal × 1e-7. Cross-check against winding-number method on fixtures including P on a face, on an edge, and at a vertex.

**Example 2 — interference between two parts**
Input: "Check if two STEP solids interfere in an assembly."
Output approach: Broad phase with AABB/BVH overlap to cull pairs; narrow phase with exact face–face intersection (B-Rep) or triangle–triangle (Möller) on meshed proxies. Distinguish *touching* (distance ≤ eps) from *penetrating* (shared interior volume). Report contact vs clash separately; clearance < required → flag. Note OBB or BVH-of-faces avoids AABB false positives for rotated parts.

## CAD-specific rules

- Decide and document boundary/on-surface behavior for every classification predicate.
- eps is always explicit, unit-aware, and ideally scale-relative.
- Validate watertight/manifold preconditions before parity-based or boolean algorithms.
- Cross-check accelerated results against brute force on a fixture set; they must agree.
- Prefer robust/exact predicates when the result decides topology or pass/fail.

## Limitations / what this skill does NOT do

- It doesn't make a fundamentally non-watertight mesh suitable for parity tests — repair/validate first.
- Float-with-tolerance approaches remain inexact; for guaranteed-correct booleans use an exact kernel (CGAL) — this skill will tell you when you've hit that wall.
- It addresses algorithm correctness, not GPU/SIMD micro-optimization (see cad-performance-optimizer).

Read `geometry-algorithms.md` for per-algorithm recipes, `robustness-rules.md` for the predicate/tolerance discipline, and `cgal-reference.md` for CGAL-specific exact predicates, PMP, AABB tree, self-intersection, and Nef boolean guidance.
