---
Created:  2026-10-12 21:00
Modified: 2026-10-12 21:00
---

ARCH: Functionality View (FV)
=============================

##  LAYER: Access Layer {{access-layer}}

The layer facing the producers, BECAUSE the intake protocol must not leak into the core.

##  LAYER: Core Layer {{core-layer}}

The layer holding the processing, BECAUSE it must stay independent of the intake protocol.

##  COMPONENT: Gateway {{gateway}}

-   KIND:       Component
-   LAYER:      [[LAYER:access-layer]]
-   DEPENDS-ON: [[COMPONENT:ingest]]

The gateway terminates the producer connections, BECAUSE the core must not handle sockets.

##  COMPONENT: Ingest {{ingest}}

-   KIND:       Component
-   LAYER:      [[LAYER:core-layer]]
-   DEPENDS-ON: [[COMPONENT:gateway]]
-   EVIDENCE:   Observed
-   SOURCE:     src/ingest.c:10-80

The component accepts the records, BECAUSE the records arrive from outside.
