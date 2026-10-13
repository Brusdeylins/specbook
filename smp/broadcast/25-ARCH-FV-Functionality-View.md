---
Created:  2026-06-18 10:18
Modified: 2026-09-05 01:00
---

#   ARCH: Functionality View (FV)

![](25-ARCH-FV-Functionality-View-1.svg)

##  LAYER: Client Layer {{client-layer}}

The layer running in the browsers of the attendees and operators, BECAUSE the user interface is delivered as a web
application to arbitrary devices.

##  LAYER: Server Layers {{server-layers}}

The group of all layers running in the data center, BECAUSE everything behind the browser is operated by the solution
itself.

##  LAYER: Broker Layers {{broker-layers}}

-   PART-OF:        [[LAYER:server-layers]]

The group of the layers carrying the live connections of the clients, BECAUSE routing, proxying, and relaying form one
connection path scaled independently of the business logic.

##  LAYER: Router Layer {{router-layer}}

-   PART-OF:        [[LAYER:broker-layers]]

The layer distributing the incoming connections, BECAUSE a single entry point per data center balances the load.

##  LAYER: Proxy Layer {{proxy-layer}}

-   PART-OF:        [[LAYER:broker-layers]]

The layer terminating and forwarding the client protocols, BECAUSE TLS and the protocol dispatch belong in front of
the relays.

##  LAYER: Relay Layer {{relay-layer}}

-   PART-OF:        [[LAYER:broker-layers]]

The layer fanning out the live messages, BECAUSE the MQTT brokers carry the bulk of the connections.

##  LAYER: Service Layer {{service-layer}}

-   PART-OF:        [[LAYER:server-layers]]

The layer holding the business logic, BECAUSE it is the only one deciding about the domain.

##  LAYER: Database Layer {{database-layer}}

-   PART-OF:        [[LAYER:server-layers]]

The layer holding the persistent state, BECAUSE the data outlives every process of the layers above.

##  COMPONENT: Web Client {{client}}

-   KIND:           Subsystem
-   LAYER:          [[LAYER:client-layer]]
-   CONSUMES:       [[INTERFACE:live-topics]]
-   REALIZES:       [[REQUIREMENT:name-appearance]], [[REQUIREMENT:browser-access]], [[REQUIREMENT:individual-url]], [[REQUIREMENT:user-consent]], [[REQUIREMENT:provider-switch]]
-   DEPENDS-ON:     [[COMPONENT:relay]]

The Vue.js single-page application renders the attendee and operator UI and drives all user interaction: it presents the
panel, attendee, studio, moderator, and manager screens, plays the video stream, and exchanges live data over MQTT,
BECAUSE msg.Broadcast delivers its entire experience in the browser.

##  COMPONENT: Client NLP {{client-nlp}}

-   KIND:           Module
-   PART-OF:        [[COMPONENT:client]]
-   REALIZES:       [[REQUIREMENT:client-sentiment]]

The client NLP module performs lightweight client-side sentiment analysis and language identification on attendee input
before it is sent, BECAUSE filtering at the source reduces server load and can prevent improper submissions.

##  COMPONENT: Router {{router}}

-   KIND:           Connector
-   LAYER:          [[LAYER:router-layer]]
-   PATTERNS:       [[PATTERN:reverse-proxy-edge]]
-   DEPENDS-ON:     [[COMPONENT:proxy]]

The router (HAProxy with NFTables) routes incoming HTTP and WebSocket traffic across the proxy instances of an environment
using round-robin and separates the dev, QA, and production environments, BECAUSE traffic must be balanced and environments
isolated at the edge.

##  COMPONENT: Proxy {{proxy}}

-   KIND:           Connector
-   LAYER:          [[LAYER:proxy-layer]]
-   PATTERNS:       [[PATTERN:reverse-proxy-edge]], [[PATTERN:stateless-pool]]
-   DEPENDS-ON:     [[COMPONENT:relay]]

The proxy layer (HAProxy) forwards the HTTP and WebSocket requests of a specific environment to the relay layer and scales
horizontally per environment, BECAUSE request handling must scale independently of the messaging layer.

##  COMPONENT: Relay {{relay}}

-   KIND:           Connector
-   LAYER:          [[LAYER:relay-layer]]
-   PROVIDES:       [[INTERFACE:live-topics]]
-   PATTERNS:       [[PATTERN:pub-sub]], [[PATTERN:stateless-pool]]
-   DEPENDS-ON:     [[COMPONENT:service]]

The relay layer maintains thousands of bidirectional WebSocket/MQTT connections, brokering MQTT messages between clients
and the service layer and scaling horizontally, BECAUSE real-time fan-out to up to 10000 attendees is the central
performance challenge.

##  COMPONENT: Service {{service}}

-   KIND:           Service
-   LAYER:          [[LAYER:service-layer]]
-   PATTERNS:       [[PATTERN:modular-monolith]]
-   REALIZES:       [[REQUIREMENT:questions]], [[REQUIREMENT:chat]], [[REQUIREMENT:moderation]], [[REQUIREMENT:forward-presenter]], [[REQUIREMENT:config-propagation]]
-   OWNS:           [[ENTITY:Event]], [[ENTITY:AgendaPoint]], [[ENTITY:Channel]], [[ENTITY:Resource]], [[ENTITY:ResourceProviderParam]], [[ENTITY:Role]], [[ENTITY:Message]], [[ENTITY:MessageText]], [[ENTITY:QuestionTag]]
-   PROVIDES:       [[INTERFACE:server-cli]]
-   DEPENDS-ON:     [[FV.database]]

The service layer executes all business logic for events, messages, authentication, and statistics: as the main server it
holds the event, moderation, access, and configuration logic, reacts to MQTT messages, and persists state, BECAUSE the
authoritative business rules must live in a single server tier.

##  COMPONENT: Authentication Service {{auth}}

-   KIND:           Module
-   PART-OF:        [[COMPONENT:service]]
-   REALIZES:       [[REQUIREMENT:authentication]], [[REQUIREMENT:parallel-access]], [[REQUIREMENT:automatic-url]]
-   OWNS:           [[ENTITY:User]], [[ENTITY:AuthorizationToken]], [[ENTITY:SessionToken]]
-   DEPENDS-ON:     [[FV.database]]

The authentication module issues and validates the authorization and session tokens: it generates one-time tokens, sends
them via the email gateway, validates logins, and enforces a single active session per user per event, BECAUSE
email-verified, single-session access is the core security mechanism.

##  COMPONENT: Translation Service {{translation}}

-   KIND:           Module
-   PART-OF:        [[COMPONENT:service]]
-   REALIZES:       [[REQUIREMENT:language-switch]]

The translation module produces language-specific message texts via an external LLM, translating them into the supported
languages on the fly while preserving the original, BECAUSE chat and questions must be available in both German and English.

##  COMPONENT: Statistics Service {{statistics}}

-   KIND:           Module
-   PART-OF:        [[COMPONENT:service]]
-   REALIZES:       [[REQUIREMENT:event-stats]], [[REQUIREMENT:debug-stats]], [[REQUIREMENT:channel-stats]], [[REQUIREMENT:user-stats]], [[REQUIREMENT:stats-snapshots]]
-   OWNS:           [[ENTITY:EventStatistic]], [[ENTITY:ChannelStatistic]], [[ENTITY:UserStatistic]]
-   DEPENDS-ON:     [[FV.database]]

The statistics module generates periodic event, channel, and user statistics snapshots, capturing cumulative counts of
tokens, sessions, connections, and viewers during a running event, BECAUSE trend dashboards require regular snapshots over
the event's lifetime.

##  COMPONENT: Junction Orchestrator {{junction}}

-   KIND:           Component
-   LAYER:          [[LAYER:proxy-layer]]
-   REALIZES:       [[REQUIREMENT:browser-access]]
-   DEPENDS-ON:     [[COMPONENT:relay]]

The Junction component serves the static client bundle and orchestrates its delivery to the relay over MQTT+, BECAUSE the
client must be distributed alongside the same messaging infrastructure used for live data.

##  COMPONENT: Database {{database}}

-   KIND:           Datastore
-   LAYER:          [[LAYER:database-layer]]

The PostgreSQL database with the filesystem persists all business objects and static assets, storing all events, messages,
tokens, and statistics accessed through the Drizzle persistence layer, BECAUSE the authoritative, durable state of every
event must be persisted in one tier.
