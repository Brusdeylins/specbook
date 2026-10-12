---
Created:  2026-10-12 20:58
Modified: 2026-10-12 20:58
---

ARCH: Named Constants (NC)
==========================

##  CONSTANT: SUBMISSION_LIMIT {{submission-limit}}

-   CLASS:     Default
-   VALUE:     10
-   UNIT:      submissions per user per window
-   EFFECT:    higher: more chat and question traffic per attendee -- lower: stronger flood protection, more rejected submissions
-   DRIVEN-BY: [[REQUIREMENT:throttling]]

The number of chat and question submissions one attendee may make within one throttle window before further
submissions are rejected, overridable per event, BECAUSE ten submissions per minute exceed every honest use while
stopping a scripted flood.

##  CONSTANT: THROTTLE_WINDOW {{throttle-window}}

-   CLASS:     Duration
-   VALUE:     60000
-   UNIT:      ms
-   EFFECT:    longer: smoother limit, slower recovery of a throttled attendee -- shorter: burstier traffic
-   DRIVEN-BY: [[REQUIREMENT:throttling]]

The length of the sliding window over which the submissions of one attendee are counted, BECAUSE the throttling
requirement states its bound per minute.

##  CONSTANT: SENTIMENT_THRESHOLD {{sentiment-threshold}}

-   CLASS:     Limit
-   VALUE:     -0.1
-   UNIT:      sentiment score in [-1, +1]
-   EFFECT:    higher: more messages auto-rejected -- lower: more messages auto-accepted

The sentiment score below which a message counts as improper for the automatic decisions, BECAUSE the domain rule
[[RULE:sentiment-threshold]] fixes this very value.

##  CONSTANT: MAX_TRACKED_SUBMITTERS {{max-tracked-submitters}}

-   CLASS:     Size
-   VALUE:     10000
-   UNIT:      entries
-   EFFECT:    higher: more memory per service instance -- lower: the least recently active attendees are evicted and lose their count
-   DRIVEN-BY: [[REQUIREMENT:attendee-scale]]

The number of attendees whose recent submissions one service instance tracks at most, BECAUSE an event connects at most
10000 attendees at once, so a larger table would never fill.

##  CONSTANT: SCORING_BUDGET {{scoring-budget}}

-   CLASS:     Budget
-   VALUE:     20
-   UNIT:      ms per message

The time the sentiment scoring of one message may take at most on the service event loop, BECAUSE the single-threaded
loop serves all other messages of the instance meanwhile.

##  CONSTANT: SNAPSHOT_INTERVAL {{snapshot-interval}}

-   CLASS:     Duration
-   VALUE:     300000
-   UNIT:      ms
-   EFFECT:    shorter: fresher counters, more database writes, longer: staler counters
-   DRIVEN-BY: [[REQUIREMENT:observability]]
-   EVIDENCE:  Observed
-   SOURCE:    server/src/statistics.ts

The period at which the statistics scheduler captures a snapshot of the counters of every running event, BECAUSE the
diagnosability requirement accepts counters at most five minutes old.
