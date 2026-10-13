---
Created:  2026-10-12 20:58
Modified: 2026-10-12 20:58
---

ARCH: Code Map (CM)
===================

##  SYMBOL: Submission Throttle Module {{symbol-throttle-file}}

-   CLASS:      File
-   LOCATION:   server/src/submission-throttle.ts
-   IMPLEMENTS: [[STAGE:stage-throttle]]

The source file of the submission throttle, BECAUSE the throttle stage is coded in one module of its own.

##  SYMBOL: SubmissionThrottle {{symbol-throttle-class}}

-   CLASS:      Type
-   PART-OF:    [[SYMBOL:symbol-throttle-file]]
-   IMPLEMENTS: [[STRUCTURE:throttle-table]], [[ALGORITHM:sliding-window]]

The class holding the throttle table and deciding the admission, BECAUSE the structure and the algorithm working on it
are encapsulated together.

##  SYMBOL: Statistics Module {{symbol-statistics-file}}

-   CLASS:      File
-   LOCATION:   server/src/statistics.ts
-   IMPLEMENTS: [[COMPONENT:statistics]]

The source file of the statistics service, BECAUSE the module is coded in one file of its own.

##  SYMBOL: SNAPSHOT_INTERVAL {{symbol-snapshot-interval}}

-   CLASS:      Field
-   PART-OF:    [[SYMBOL:symbol-statistics-file]]
-   IMPLEMENTS: [[CONSTANT:snapshot-interval]]

The constant defining the snapshot period, BECAUSE the period is named once in the code, too.
