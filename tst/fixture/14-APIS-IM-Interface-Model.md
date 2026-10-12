---
Created:  2026-10-12 21:00
Modified: 2026-10-12 21:00
---


APIS: Interface Model (IM)
==========================

##  INTERFACE: Record Feed {{record-feed}}

-   KIND:      Protocol
-   LOCATION:  tcp/7000
-   TRANSPORT: TCP
-   FRAMING:   fixed 8-byte frame header, then the payload

The feed delivers the records to the ingest, BECAUSE the producers push them as they arise.
