# Geometry Algorithms — Recipes and Failure Cases

Per-algorithm reference for `computational-geometry/SKILL.md`. Each entry: idea, key degeneracies, complexity, and the most common bug.

## Table of contents
- Ray–triangle intersection
- Point-in-polygon (2D)
- Point-in-solid (3D, mesh)
- Plane–plane and line–plane intersection
- Curve/surface intersection
- Bounding boxes (AABB / OBB)
- BVH, KD-tree, R-tree
- Convex hull
- Boolean operations
- Distance and closest-point queries
- Collision / interference

---

## Ray–triangle intersection
- **Idea:** Möller–Trumbore: solve ray = a + t·d against barycentric coords of triangle. Hit if u,v ≥ 0, u+v ≤ 1, t > 0.
- **Degeneracies:** ray parallel to triangle (denominator ≈ 0), ray through shared edge/vertex (double count in mesh traversal).
- **Bug:** using a bare `det == 0` test; use `|det| < eps` with eps scaled to direction/edge magnitudes. For watertight ray counting (point-in-solid parity tests) use a watertight variant with consistent shared-edge sign rules: Woop et al. 2013 JCGT ("Watertight Ray/Triangle Intersection") gives a formulation that eliminates sign ambiguity at edges and vertices. Note: Möller–Trumbore is the base intersection algorithm; Woop et al. is a separate watertight variant — they are not interchangeable.
- **Complexity:** O(1) per triangle.

## Point-in-polygon (2D)
- **Idea:** ray-crossing (parity) or winding number. Winding number is more robust for self-overlapping polygons.
- **Degeneracies:** point on edge/vertex; horizontal edges in ray-crossing.
- **Bug:** inconsistent half-open edge rule → points on shared edges flip. Fix: treat edges as half-open [y_min, y_max) consistently.
- **Complexity:** O(n) per query; O(log n) with preprocessing for convex/monotone.

## Point-in-solid (3D, mesh)
- **Idea:** parity of watertight ray–triangle intersections, OR generalized winding number (Jacobson et al.) which tolerates minor non-watertightness.
- **Precondition:** watertight + manifold for parity. Winding number degrades gracefully.
- **Bug:** double-counting at shared edges; mitigate with watertight intersection test, not random jitter (jitter only reduces probability of error, doesn't eliminate it).
- **Complexity:** O(n) brute, O(log n) amortized with BVH.

## Plane–plane and line–plane intersection
- **Plane–plane:** direction = n1 × n2; if |n1 × n2| ≈ 0 the planes are parallel (no line or coincident). A point on the line solves the 2×2 system from the plane equations.
- **Line–plane:** t = (p0 − l0)·n / (l·n); if |l·n| < eps the line is parallel to the plane.
- **Bug:** dividing by a near-zero dot product without the parallel guard.

## Curve/surface intersection
- **Idea:** for NURBS, subdivision/Newton refinement or interval methods; for analytic surfaces use closed forms (line–cylinder is a quadratic).
- **Degeneracies:** tangential intersection (double root), overlapping (infinite intersections), grazing.
- **Bug:** Newton diverging without a subdivision bracket; always bracket then refine. This is where exact kernels (OpenCascade, CGAL) earn their keep — rolling your own NURBS–NURBS SSI is a research project.

## Bounding boxes (AABB / OBB)
- **AABB:** min/max per axis. Cheap, but loose for rotated geometry.
- **OBB:** oriented box (e.g., from PCA or covariance). Tighter for elongated rotated parts.
- **Bug:** using AABB overlap as "interference" → false positives for diagonal parts. Use AABB only as a broad-phase cull.

## BVH, KD-tree, R-tree
| Structure | Best for | Build | Query |
|---|---|---|---|
| BVH (AABB tree) | triangle meshes, ray/overlap queries | O(n log n) | O(log n) avg |
| KD-tree | point clouds, nearest-neighbor | O(n log n) | O(log n) avg, degrades in high-D |
| R-tree | rectangles/AABBs, disk-backed spatial DB, GIS/large assemblies | O(n log n) | O(log n) avg |
- **Bug:** rebuilding the tree per query instead of once; or querying a stale tree after geometry moves (rebuild/refit on transform). For CGAL-specific `AABB_tree` patterns and degenerate-primitive warnings, see `cgal-reference.md`.

## Convex hull
- **2D:** Andrew's monotone chain, O(n log n). **3D:** incremental or QuickHull.
- **Degeneracies:** collinear (2D) / coplanar (3D) points; duplicate points.
- **Bug:** orientation test via raw float cross product flips on near-collinear input — use a robust orient2d/orient3d predicate.

## Boolean operations
- **Idea:** classify each face of A as inside/outside/on B and vice versa; stitch surviving pieces. Needs exact-ish intersection curves.
- **Degeneracies:** coplanar overlapping faces, coincident edges, near-tangent contact — the classic source of boolean failure.
- **Bug:** float-tolerance booleans on real CAD = intermittent failures. For reliability use an exact/robust kernel (CGAL Nef polyhedra / mesh boolean workflows, OpenCascade BOPAlgo). See `cgal-reference.md` for CGAL exact-kernel guidance and brep-topology-review for B-Rep boolean failure causes.

## Distance and closest-point queries
- **Point–triangle:** project onto plane, then clamp into the triangle via its 7 Voronoi regions (1 face, 3 edges, 3 vertices). Omitting edge/vertex regions is the #1 bug.
- **Mesh–mesh distance:** BVH-accelerated closest-pair; don't brute-force O(n·m).
- **Signed distance:** sign needs a reliable inside/outside test (winding number for dirty meshes).

## Collision / interference
- **Broad phase:** BVH/AABB overlap to cull. **Narrow phase:** triangle–triangle (Möller) or exact B-Rep face intersection.
- **Distinguish:** touching (distance ≤ eps), clearance violation (distance < required), penetration (shared interior). These are three different verdicts; report them separately.
- **Bug:** reporting "collision" for parts that merely share a coincident mounting face — that's contact, not a clash.
