# Midship section at the LCG station (real mesh)

Sliced from `tests/test-kayak.stl` -- the mesh the app analyses -- with a plane at
the **LCG station**: 52% of the length from the bow. That station is also where
the waterplane is widest, which is why it reproduces the solver's numbers.

| quantity | this slice | the solver |
| --- | --- | --- |
| waterline beam (BWL) | 612.2 mm | 612.9 mm |
| keel z (local) | -151.2 mm | -162.527 (hull's lowest point) |
| deck z | 120.1 mm | - |
| waterline z | -34.573 mm | -34.573 |
| KB | 116.6 mm above this keel | 75.9 mm |
| LCG z | 117.5 mm | 280 mm above the keel |
| LCB z | -74.6 mm | - |
| GM | 106.9 mm | KM 386.9 - KG 280 |

Coordinates below are `beam height` in millimetres, ordered around the section.
Beam 0 is the centre plane, the deck is above and the keel below.

```
-303.6 2.1
-303.1 -48.0
-277.0 -95.4
-250.7 -119.5
-240.4 -126.0
-230.8 -122.4
-219.5 -125.9
-162.5 -142.7
-93.9 -148.8
76.7 -149.5
162.5 -142.7
218.8 -126.1
230.1 -122.4
240.6 -126.0
254.3 -117.0
280.5 -91.1
303.6 -46.5
305.1 -9.5
294.0 40.9
251.8 96.3
230.9 102.8
215.0 103.1
200.6 107.8
212.0 120.1
205.0 120.1
197.4 117.5
184.6 120.1
92.3 120.0
18.2 119.9
-90.9 120.0
-161.7 120.0
-198.1 118.2
-197.1 116.9
-197.0 114.6
-216.3 120.1
-204.9 104.9
-223.9 103.0
-238.9 101.9
-274.4 77.5
-300.3 19.1
```
