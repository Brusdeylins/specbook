---
Created:  2026-08-30 00:49
Modified: 2026-09-09 19:59
---

APIS: Interface Model (IM)
==========================

INTERFACE: Server Command Line {{server-cli}}
---------------------------------------------

-   KIND:      CLI
-   LOCATION:  `broadcast-server`
-   CONSUMERS: [[PERSONA:administrator]]

The command-line program starting the server process of the service
layer, which resolves its runtime parameters from the layered
configuration of built-in defaults, an optional YAML configuration file,
`BROADCAST_*` environment variables, and the command-line options (in
increasing precedence), BECAUSE the administrator and the deployment
automation have to start the very same server with different parameters
per environment without changing any file.

INTERFACE: Live Topics {{live-topics}}
--------------------------------------

-   KIND:      MQTT
-   LOCATION:  `wss://<environment>/mqtt`, topic prefix `broadcast/`
-   TRANSPORT: WebSocket
-   SESSION:   clean session per page load, keep-alive ping every 30 s, retained configuration topics replayed on subscribe
-   STANDARD:  https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html
-   CONSUMERS: [[PERSONA:attendee]], [[PERSONA:moderator-chat]], [[PERSONA:moderator-qa]]

The publish/subscribe topics over which the clients submit their chat and question messages and receive the live state
of the event, BECAUSE thousands of browsers have to receive every change within seconds without polling.
