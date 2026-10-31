# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-11-01

### Fixed

- Dragging a queued message near the top or bottom edge of a long queue now
  auto-scrolls the list, with the scroll speed growing toward the edge. A message
  can be dragged from the bottom to the top (or back) in one gesture instead of
  releasing, scrolling, and grabbing it again.
- The drop line follows the row under the pointer while the list scrolls beneath
  it, so the insertion point stays correct during auto-scroll.

### Changed

- The drag handle's hint text now mentions edge auto-scroll.

## [0.1.0] - 2026-10-31

### Added

- Drag-to-reorder for the pending message queue: drag the `⠿` grip of one queued
  message onto another row to place it before or after that message.
- Keyboard reordering on the same grip: `ArrowUp` / `ArrowDown` move one step,
  `Home` / `End` move to the front / back, with a screen-reader announcement of
  the new position.
- Replaced queue dock that keeps the shipped dock's abilities: collapsible count
  header, text previews, image thumbnails, file chips, inline editing, removal,
  "steer into the running turn", and local send-in-progress rows.
- Authenticated Host route `POST /api/queue.move` that applies a reorder as one
  durable, non-cancelling Agent Inbox splice and rejects stale drags with `409`.
- Tests for the reorder math, the Host route and its conflict handling, and the
  Client render path (expand, keyboard, drop, edit, remove, steer, pending rows).

### Notes

- Built and verified against DeepSeek Harness `0.2.1-rc.5` (desktop profile).
- Requires the Harness `conversation.input.dock` slot and `conversation` service;
  a future Harness version that changes either needs a matching plugin update.

[0.1.1]: https://github.com/yrui-ql/dsh-queue-reorder/releases/tag/v0.1.1
[0.1.0]: https://github.com/yrui-ql/dsh-queue-reorder/releases/tag/v0.1.0
