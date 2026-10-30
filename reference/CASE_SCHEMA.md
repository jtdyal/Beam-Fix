# Reference-case schema (units: inch, lb, psi)

Coordinates: x along beam from the LEFT END (0..Ltot), y up from beam bottom (0..d), z across the width (0..b).
Supports are lines across the width at x_s1 = bearing/2 and x_s2 = Ltot - bearing/2 (bearing centres).
Load: downward UDL `w_lb_per_in` on the wood top face between the two support lines only.
Notch: removed wood, y in [0, depth], x in [center-length/2, center+length/2] (full width). Bottom (tension) face.
Plates: steel, thickness t, occupying y in [yb, yb+h], x in [x0, x1].
  side "outside": z in [-t, 0]   side "inside": z in [b, b+t]
Fasteners: lumped x/y springs (K_x, K_y, lb/in) joining the plate inner-face node to the wood face node at each
(fastener_x[i], fastener_y[j]) pair; a spring is SKIPPED if the wood is removed at that (x,y) (inside the notch).
z-direction: tied (very stiff spring or constraint). Plates are otherwise unattached.
