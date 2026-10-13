---
Created:  2026-10-12 20:58
Modified: 2026-10-12 20:58
---

ARCH: Processing View (PV)
==========================

##  STRUCTURE: Submission Throttle Table {{throttle-table}}

-   KIND:            Table
-   LAYOUT:          map from the user id onto a ring of the timestamps of the recent submissions of that user
-   CAPACITY:        [[CONSTANT:max-tracked-submitters]]
-   OWNER:           [[COMPONENT:service]]
-   LIFETIME:        per running event, entries evicted least recently active first
-   ACCESSED-BY:     [[UNIT:service-loop]]
-   SYNCHRONIZATION: confined to the event loop of one service instance, hence no locking

The table remembers per attendee when the recent submissions happened, so that the throttle decides in constant time,
BECAUSE counting the submissions in the database on every submission would add a round-trip to the hot path.

##  ALGORITHM: Sliding Window Throttle {{sliding-window}}

-   TARGET:      CPU
-   OWNER:       [[COMPONENT:service]]
-   INPUT:       the user id and the arrival time of a submission
-   OUTPUT:      the decision to admit or to reject the submission
-   INVARIANTS:  at most [[CONSTANT:submission-limit]] submissions of one user are admitted within any [[CONSTANT:throttle-window]]
-   COMPLEXITY:  O(1) amortized time per submission, O(n) space in the tracked users
-   PARAMETERS:  [[CONSTANT:submission-limit]], [[CONSTANT:throttle-window]]
-   DATA-LAYOUT: one timestamp ring per user in the [[STRUCTURE:throttle-table]]

The throttle drops the timestamps older than the window from the ring of the user and admits the submission only while
fewer than the limit remain, BECAUSE a sliding window, unlike a fixed one, cannot be gamed by a burst around the window
boundary.

```ts
const admit = (ring: number[], now: number, limit: number, window: number) => {
    while (ring.length > 0 && ring[0] <= now - window)
        ring.shift()
    if (ring.length >= limit)
        return false
    ring.push(now)
    return true
}
```

##  ALGORITHM: Sentiment Scoring {{sentiment-scoring}}

-   TARGET:     CPU
-   INPUT:      the text of a message and its language
-   OUTPUT:     a sentiment score in [-1, +1]
-   NUMERICS:   64-bit float, the sum of the word valences normalized by the number of words
-   COMPLEXITY: O(n) time in the number of words
-   BUDGET:     [[CONSTANT:scoring-budget]]
-   TOOLS:      [[COMPONENT:client-sentiment]]

The scoring looks up the valence of every word in a per-language lexicon and averages them, BECAUSE the client module
and the service then judge a message identically, so the client pre-check never contradicts the server decision.

##  PIPELINE: Submission Path {{submission-path}}

-   DATA:       chat and question submissions becoming stored and published [[ENTITY:Message]] objects
-   COMPONENTS: [[COMPONENT:service]], [[COMPONENT:relay]]
-   REALIZES:   [[REQUIREMENT:chat]], [[REQUIREMENT:questions]], [[REQUIREMENT:moderation]]

The path carries a submission from its arrival on the live topics through the throttle, the sentiment triage, and the
persistence onto the topics of the event, every stage running on the event loop of the receiving service instance up to
the broker, BECAUSE the order of the checks has to reject cheap before it scores expensive and has to store before it
publishes.

### STAGE: Throttle Submission {{stage-throttle}}

-   INPUT:      a submission received on the [[INTERFACE:live-topics]] as a [[TYPE:Submission]]
-   OUTPUT:     the admitted submission
-   ALGORITHMS: [[ALGORITHM:sliding-window]]
-   EXECUTION:  [[UNIT:service-loop]]

The stage rejects a submission exceeding the limit of its sender before anything else happens, BECAUSE a flood must cost
as little as possible.

### STAGE: Triage Sentiment {{stage-triage}}

-   FED-BY:     [[STAGE:stage-throttle]]
-   INPUT:      the admitted submission
-   OUTPUT:     the submission marked as auto-accepted, auto-rejected, or pending
-   ALGORITHMS: [[ALGORITHM:sentiment-scoring]]
-   PARAMETERS: [[CONSTANT:sentiment-threshold]]
-   EXECUTION:  [[UNIT:service-loop]]

The stage scores the text and decides automatically where the event enables it, leaving the rest to the moderator,
BECAUSE automated triage relieves the moderators during a busy event.

### STAGE: Persist Message {{stage-persist}}

-   FED-BY:    [[STAGE:stage-triage]]
-   INPUT:     the triaged submission
-   OUTPUT:    the stored [[ENTITY:Message]]
-   EXECUTION: [[UNIT:service-loop]], [[UNIT:database]]
-   TOOLS:     [[COMPONENT:persistence-layer]]

The stage stores the message in one transaction, BECAUSE the database is the authoritative state every later read rests
on.

### STAGE: Publish Message {{stage-publish}}

-   FED-BY:    [[STAGE:stage-persist]]
-   INPUT:     the stored [[ENTITY:Message]]
-   OUTPUT:    the message on the topics of the event
-   EXECUTION: [[UNIT:relay-pool]]
-   TOOLS:     [[COMPONENT:message-broker]]

The stage publishes the stored message to the attendees or, while pending, to the moderators only, BECAUSE publishing
before storing could show a message which a failed transaction then loses.
