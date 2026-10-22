# CGAL Reference

Use this reference when a CAD geometry task involves CGAL, exact predicates,
polygon mesh processing, AABB trees, self-intersection checks, or exact
polyhedral booleans. CGAL is strongest for triangle meshes, polyhedra, spatial
queries, and exact computational-geometry decisions. It is not a replacement
for a NURBS B-Rep kernel when the input is STEP/IGES faces and trims.

API names here are grounded in CGAL 6.2 official documentation. Check the
installed CGAL version before pasting code into production, especially around
packages that were split from the older Polygon Mesh Processing package.

> **AABB tree kernel note:** `CGAL::Simple_cartesian<double>` is correct for
> broad-phase queries (distance, overlap culling). For narrow-phase decisions
> that produce intersection points fed into later topology — use
> `CGAL::Exact_predicates_inexact_constructions_kernel` (EPICK) or EPECK.
> See the Exactness Decision Table below.

## Core Rule

Use CGAL exactness for decisions that change topology or pass/fail verdicts.
Use floating-point distances and tolerances for reported measurements.

```
Topology decision: exact predicate / exact kernel
Measurement: float or kernel FT + explicit units and tolerance
Display/reporting: convert with CGAL::to_double only at the boundary
```

Do not convert exact values to `double` and then feed those doubles back into a
boolean, hull, self-intersection, or classification decision.

## Kernel Choices

Common kernels:

- `CGAL::Exact_predicates_inexact_constructions_kernel` ("EPICK"):
  exact predicates, inexact constructed points. Good default for many Polygon
  Mesh Processing checks where the decisive operations are predicates.
- `CGAL::Exact_predicates_exact_constructions_kernel` ("EPECK"):
  exact predicates and exact constructions. Prefer it when newly constructed
  intersection points will drive later topology or boolean decisions.
- `CGAL::Simple_cartesian<double>`:
  acceptable for approximate distance, visualization, or quick broad-phase
  checks, but not for topology-changing decisions.

Predicate sketch:

```cpp
#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/enum.h>

using K = CGAL::Exact_predicates_inexact_constructions_kernel;
using Point = K::Point_3;

CGAL::Orientation o = CGAL::orientation(
  Point(0, 0, 0),
  Point(1, 0, 0),
  Point(0, 1, 0),
  Point(0, 0, 1)
);

if (o == CGAL::POSITIVE) {
  // Deterministic sign decision.
}
```

Guidance:

- Exact predicates answer signs such as orientation, coplanarity, and sidedness.
- Exact constructions matter when intersection points, split vertices, or new
  faces become future input.
- Tolerances are still needed for engineering policy: minimum clearance, maximum
  deviation, snap radius, wall thickness, or report thresholds.

## Polygon Mesh Processing Gates

Use `CGAL::Surface_mesh<K::Point_3>` for a compact indexed halfedge mesh, and
read meshes through `CGAL::Polygon_mesh_processing::IO::read_polygon_mesh()`
when using PMP utilities.

Minimum validation flow for a triangle mesh:

1. Load the mesh.
2. Check `CGAL::is_triangle_mesh(mesh)`.
3. Reject or isolate degenerate faces and edges.
4. Check self-intersections.
5. Confirm the mesh has the topology your algorithm requires: closed,
   manifold, consistently oriented, or intentionally open.
6. Only then run classification, booleans, distance gates, or measurements.

Self-intersection sketch:

```cpp
#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Surface_mesh.h>
#include <CGAL/Polygon_mesh_processing/self_intersections.h>
#include <CGAL/Polygon_mesh_processing/IO/polygon_mesh_io.h>
#include <CGAL/tags.h>

#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using K = CGAL::Exact_predicates_inexact_constructions_kernel;
using Mesh = CGAL::Surface_mesh<K::Point_3>;
using face_descriptor = boost::graph_traits<Mesh>::face_descriptor;
namespace PMP = CGAL::Polygon_mesh_processing;

bool has_self_intersections(const std::string& filename) {
  Mesh mesh;
  if (!PMP::IO::read_polygon_mesh(filename, mesh) ||
      !CGAL::is_triangle_mesh(mesh)) {
    throw std::runtime_error("invalid triangle mesh input");
  }

  bool intersects =
    PMP::does_self_intersect<CGAL::Parallel_if_available_tag>(
      mesh,
      CGAL::parameters::vertex_point_map(get(CGAL::vertex_point, mesh))
    );

  std::vector<std::pair<face_descriptor, face_descriptor>> pairs;
  PMP::self_intersections<CGAL::Parallel_if_available_tag>(
    faces(mesh),
    mesh,
    std::back_inserter(pairs)
  );

  return intersects || !pairs.empty();
}
```

Degenerate element checks:

- `CGAL::Polygon_mesh_processing::is_degenerate_edge(...)`
- `CGAL::Polygon_mesh_processing::degenerate_edges(...)`
- `CGAL::Polygon_mesh_processing::is_degenerate_triangle_face(...)`
- `CGAL::Polygon_mesh_processing::degenerate_faces(...)`
- `CGAL::Polygon_mesh_processing::is_needle_triangle_face(...)`
- `CGAL::Polygon_mesh_processing::is_cap_triangle_face(...)`

Guidance:

- Record counts and entity IDs for failing faces/edges.
- Do not pass degenerate triangles into AABB trees or mesh booleans.
- PMP works on polygon/triangle meshes. It does not validate STEP/NURBS B-Reps.

## Triangle Soup Autorefinement

Use autorefinement when a triangle soup has intersecting triangles and you need
a subdivided triangle set before downstream processing.

Relevant APIs:

- `CGAL::Polygon_mesh_processing::autorefine_triangle_soup(...)`
- `CGAL::Polygon_mesh_processing::autorefine(...)`
- `CGAL::Polygon_mesh_processing::intersection_polylines(...)`

Guidance:

- `autorefine_triangle_soup(...)` subdivides intersecting triangles so that no
  pair of triangles intersects.
- If `apply_iterative_snap_rounding` is enabled, vertices are rounded to fit
  double precision while trying to remove intersections. Record the snap policy.
- If the function returns `false` under iterative snap rounding, the result is
  only a partial result. Do not treat it as validated geometry.
- In CGAL 6.2, `surface_intersection(...)` is deprecated in favor of
  `intersection_polylines(...)`.

## AABB Trees

Use `CGAL::AABB_tree` for static broad-phase and closest-point queries over
triangles, segments, or face-graph primitives.

Mesh-face tree sketch:

```cpp
#include <CGAL/Simple_cartesian.h>
#include <CGAL/Surface_mesh.h>
#include <CGAL/AABB_tree.h>
#include <CGAL/AABB_traits_3.h>
#include <CGAL/AABB_face_graph_triangle_primitive.h>

// Simple_cartesian<double> is appropriate for broad-phase distance/overlap queries.
// For narrow-phase decisions that change topology (e.g. self-intersection narrow
// pass, closest-point used as a future intersection vertex), prefer
// CGAL::Exact_predicates_inexact_constructions_kernel (EPICK) or EPECK.
using K = CGAL::Simple_cartesian<double>;
using Point = K::Point_3;
using Segment = K::Segment_3;
using Mesh = CGAL::Surface_mesh<Point>;
using Primitive = CGAL::AABB_face_graph_triangle_primitive<Mesh>;
using Traits = CGAL::AABB_traits_3<K, Primitive>;
using Tree = CGAL::AABB_tree<Traits>;

struct Mesh_tree {
  explicit Mesh_tree(const Mesh& mesh)
    : tree(faces(mesh).first, faces(mesh).second, mesh) {
    tree.accelerate_distance_queries();
  }

  Tree tree;
};

bool segment_hits_mesh(const Tree& tree, const Segment& segment) {
  return tree.do_intersect(segment);
}

K::FT squared_distance_to_mesh(const Tree& tree, const Point& point) {
  return tree.squared_distance(point);
}
```

Guidance:

- Build the tree once per immutable mesh; rebuild after topology or coordinate
  changes.
- Keep the mesh object alive as long as the tree is used.
- Call `accelerate_distance_queries()` before many closest-point or distance
  queries.
- AABB trees accelerate queries; they do not make invalid geometry valid.
- CGAL warns against degenerate primitives in an AABB tree because predicates
  and constructions may fail or crash.

## Robust Booleans

For exact polyhedral set operations, use `CGAL::Nef_polyhedron_3`.
Nef polyhedra support non-manifold situations and are closed under Boolean set
operations. This is often the right escalation when mesh booleans need exact
polyhedral set semantics.

Nef operation sketch:

```cpp
#include <CGAL/Exact_integer.h>
#include <CGAL/Homogeneous.h>
#include <CGAL/Nef_polyhedron_3.h>

using Kernel = CGAL::Homogeneous<CGAL::Exact_integer>;
using Nef_polyhedron = CGAL::Nef_polyhedron_3<Kernel>;

Nef_polyhedron regularized_union(
  const Nef_polyhedron& a,
  const Nef_polyhedron& b
) {
  Nef_polyhedron result = a + b;      // set union
  return result.regularization();     // physical-solid cleanup
}

Nef_polyhedron regularized_difference(
  const Nef_polyhedron& a,
  const Nef_polyhedron& b
) {
  Nef_polyhedron result = a - b;      // set difference
  return result.regularization();
}
```

Available Nef operations include:

- `operator!` for complement
- `operator+` for union
- `operator*` for intersection
- `operator-` for difference
- `operator^` for symmetric difference
- `interior()`, `closure()`, `boundary()`, and `regularization()`

Guidance:

- Use regularized set operations for physical solids when lower-dimensional
  residues should not remain in the result.
- Nef polyhedra are polyhedral, not NURBS B-Rep. Convert deliberately and state
  the tessellation/deviation assumptions.
- If the final consumer needs a triangle mesh, validate the converted output:
  triangle mesh, no self-intersections, expected orientation, expected volume.
- For CGAL mesh Boolean Operations package APIs, check the installed version's
  examples and headers before naming signatures. The package layout changed in
  recent CGAL releases.

## Exactness Decision Table

| Task | Recommended CGAL mode | Why |
|---|---|---|
| Orientation, coplanarity, sidedness | exact predicates | Sign errors break topology. |
| Self-intersection detection | EPICK or stronger | Predicate-driven; report faces. |
| Splitting/intersection points reused later | EPECK | Constructed points become future topology. |
| Distance report / clearance value | kernel FT or double + tolerance | Measurement needs units and threshold. |
| Broad-phase segment/mesh query | AABB tree | Speed only; validate geometry first. |
| Exact polyhedral boolean | `Nef_polyhedron_3` | Closed under set operations. |
| STEP/NURBS healing | OpenCascade / CAD kernel | CGAL mesh tools are not B-Rep healers. |

## Common Failure Patterns

| Symptom | Likely cause | CGAL-specific response |
|---|---|---|
| Boolean result has tiny slivers | inexact constructions or dirty mesh input | validate degenerates/self-intersections; consider EPECK or Nef |
| AABB query crashes | degenerate triangle or stale mesh reference | remove degenerates; rebuild tree after edits |
| Point-in-solid flips near boundary | boundary ambiguity or self-intersection | define boundary policy; reject self-intersections first |
| Mesh boolean loses a thin feature | snap/tolerance too aggressive | record snap radius; compare Hausdorff/deviation |
| Exact code is too slow | exact constructions used everywhere | keep exactness for decisions; use floats for reports |
| STEP model needs healing | wrong tool class | use OpenCascade/pythonOCC B-Rep workflow first |

## Source Links

- CGAL 2D/3D kernel docs: https://doc.cgal.org/latest/Kernel_23/index.html
- CGAL Polygon Mesh Processing docs: https://doc.cgal.org/latest/Polygon_mesh_processing/index.html
- CGAL PMP predicates: https://doc.cgal.org/latest/Polygon_mesh_processing/group__PMP__predicates__grp.html
- CGAL Boolean Operations on Meshes corefinement/autorefinement docs: https://doc.cgal.org/latest/PMP_Boolean_operations/group__PMP__corefinement__grp.html
- CGAL AABB tree docs: https://doc.cgal.org/latest/AABB_tree/index.html
- CGAL Surface Mesh docs: https://doc.cgal.org/latest/Surface_mesh/index.html
- CGAL Nef polyhedron docs: https://doc.cgal.org/latest/Nef_3/index.html
