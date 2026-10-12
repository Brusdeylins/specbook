---
Created:  2026-10-12 21:00
Modified: 2026-10-12 21:00
---


ARCH: Processing View (PV)
==========================

##  STRUCTURE: Intake Queue {{intake-queue}}

-   KIND:            Queue
-   CAPACITY:        [[CONSTANT:queue-depth]]
-   OWNER:           [[COMPONENT:ingest]]
-   ACCESSED-BY:     [[UNIT:worker]]
-   SYNCHRONIZATION: single producer, single consumer, lock-free

The queue hands the records over to the worker, BECAUSE the intake must not wait for the processing.

##  ALGORITHM: Record Checksum {{checksum}}

-   TARGET: SIMD
-   BUDGET: [[CONSTANT:batch-budget]]

The checksum adds up the record bytes in vector lanes, BECAUSE a scalar loop would exceed the budget.

##  PIPELINE: Intake Path {{intake-path}}

-   COMPONENTS: [[COMPONENT:ingest]]

The path carries a record from the socket into the queue, BECAUSE every record takes the same way.

### STAGE: Receive Record {{receive}}

-   EXECUTION: [[UNIT:worker]]

The stage reads one record, BECAUSE the records arrive one by one.

### STAGE: Verify Record {{verify}}

-   FED-BY:     [[STAGE:receive]]
-   ALGORITHMS: [[ALGORITHM:checksum]]

The stage verifies the checksum, BECAUSE corrupt records must not enter the queue.
