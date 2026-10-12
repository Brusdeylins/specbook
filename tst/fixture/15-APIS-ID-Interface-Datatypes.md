---
Created:  2026-10-12 21:00
Modified: 2026-10-12 21:00
---


APIS: Interface Datatypes (ID)
==============================

##  TYPE: RecordFrame {{record-frame}}

-   INTERFACES: [[INTERFACE:record-feed]]
-   ENCODING:   packed binary
-   ENDIANNESS: Big

The frame carrying one record on the feed, BECAUSE the feed is a plain byte stream.

### FIELD

-   magic; TYPE: `bytes`; OFFSET: 0; SIZE: 2; VALUE: `0x52F1`;
    The marker opening every frame, BECAUSE a reader resynchronizes on it.

-   version; TYPE: `integer`; OFFSET: 2; SIZE: 4 bit; VALUE: `0001`;
    The version of the frame layout, BECAUSE the layout may evolve.

-   urgent; TYPE: `boolean`; OFFSET: 2.4; SIZE: 1 bit;
    Whether the record bypasses the queue, BECAUSE some records must not wait.

-   length; TYPE: `integer`; OFFSET: 4; SIZE: 4;
    The length of the payload in bytes, BECAUSE the payload size varies.

-   payload; TYPE: `bytes`; OFFSET: 8; SIZE: variable;
    The record itself, BECAUSE the frame exists to carry it.
