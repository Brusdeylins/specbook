---
Created:  2026-10-12 21:00
Modified: 2026-10-12 21:00
---


ARCH: Concurrency View (CO)
===========================

##  UNIT: Worker {{worker}}

-   KIND:         Thread
-   HOSTS:        [[COMPONENT:ingest]]
-   MULTIPLICITY: 1
-   COORDINATION: shared queue

The worker drains the queue, BECAUSE the intake must not block.
