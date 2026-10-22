# Robustness Rules — Predicates, Tolerance, and Degeneracy

The discipline that separates geometry code that works in the demo from geometry code that works in production.

## 1. Never compare floats with `==`
Floating-point results of geometric arithmetic are almost never bit-exact.

```python
# WRONG
if cross_product_z == 0.0:        # collinear?
    ...

# BETTER (absolute + relative, unit-aware)
def almost_equal(a, b, eps_abs=1e-9, eps_rel=1e-7):
    return abs(a - b) <= max(eps_abs, eps_rel * max(abs(a), abs(b)))
```

But note: for **orientation/sign** decisions that drive topology, tolerance-based float tests are still wrong near zero. Use robust predicates.

## 2. Use robust predicates for sign-of-determinant decisions
`orient2d`, `orient3d`, `incircle`, `insphere` (Shewchuk's adaptive-precision predicates; available in CGAL, `predicates` packages) return the *exact sign* even when float arithmetic would flip it. Use them whenever the sign decides connectivity, hull membership, or which side of a plane a point is on.

```text
Rule of thumb:
  - quantity is a measurement you'll report  -> float + explicit tolerance is fine
  - quantity is a sign that decides topology  -> robust/exact predicate
```

## 3. Tie eps to scale and units
A fixed `1e-6` is meaningless without units and model size.

```python
eps = max(1e-12, 1e-9 * bbox_diagonal)   # scale-relative, with a floor
```
Document the unit. A part modeled in microns and one in meters need different absolute eps; relative-to-bbox sidesteps most of it.

## 4. Enumerate degeneracies as first-class cases
For each algorithm, list the degenerate inputs and choose explicit behavior:

| Algorithm | Degeneracy | Decide |
|---|---|---|
| Ray cast | ray hits shared edge/vertex | watertight test or consistent tie-break |
| Point-in-poly | point on edge | half-open edge rule |
| Boolean | coplanar overlapping faces | coplanar handling path |
| Hull | collinear/coplanar points | robust orient predicate |
| Closest point | point in edge Voronoi region | clamp via all 7 regions |
| Intersection | parallel/tangent | explicit parallel guard |

"Undefined behavior on degenerate input" is not acceptable in CAD — degenerate input is the norm, not the exception.

## 5. Snapping and tolerance bands cause cascading errors
Snapping vertices within eps can merge features you meant to keep, or create new near-degeneracies. If you snap, do it once, deterministically, and document the radius. Avoid iterative snapping that depends on processing order.

## 6. Cross-validate
Every accelerated or clever implementation must agree with a brute-force reference on a fixture set that *includes* degeneracies. If BVH point-in-solid and winding-number point-in-solid disagree on any fixture, you have a bug — don't ship.

## 7. Determinism
Same input + same tolerances must yield the same verdict across runs and platforms. Avoid order-dependent floating-point reductions where the verdict is sensitive (use stable summation, e.g. Kahan, or integer/exact arithmetic for the decisive part).

## 8. When to escalate to an exact kernel
Reach for CGAL exact kernels / OpenCascade when:
- Booleans must never fail intermittently.
- Self-intersection-free output is contractually required.
- You're stacking many operations and float error accumulates.

The honest tradeoff: exact arithmetic is slower and heavier. Use it where correctness is non-negotiable, float-with-tolerance where speed dominates and small errors are acceptable — and say which regime you're in. For CGAL kernel choices and the exact-predicate vs measurement split, see `cgal-reference.md`.
