# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately to
the repository owner through GitHub Security Advisories.

## Data

`dsh-queue-reorder` runs inside the local DeepSeek Harness process and memory:

- it reads the current Session's pending-message queue and posts reorder
  coordinates to the local Host over the authenticated `/api/queue.move` route;
- it writes no files, stores no credentials and sends nothing off the machine;
- queue mutations are recorded in the local Session log like any other queue
  change.

The repository `.gitignore` excludes `node_modules`, logs, local databases and
local configuration so that no Session data can be committed by accident.
