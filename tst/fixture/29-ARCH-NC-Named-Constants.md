---
Created:  2026-10-12 21:00
Modified: 2026-10-12 21:00
---


ARCH: Named Constants (NC)
==========================

##  CONSTANT: QUEUE_DEPTH {{queue-depth}}

-   CLASS: Size
-   VALUE: 64
-   UNIT:  items

The depth of the intake queue, BECAUSE a burst of 64 records is the largest one observed.

##  CONSTANT: BATCH_BUDGET {{batch-budget}}

-   CLASS: Budget
-   VALUE: 5
-   UNIT:  ms

The time one batch may take, BECAUSE the worker must keep up with the intake.
