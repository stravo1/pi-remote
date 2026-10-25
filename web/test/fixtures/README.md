# Tool-call fixture

`tool-call.jsonl` comes from `spikes/phase-0/out/tool-call.jsonl`.
The fixture keeps message boundaries, text deltas, thinking deltas, and run boundaries.
It removes timestamps, model metadata, system sections, and duplicate partial messages.
This lets tests run without the ignored spike output or a provider key.

The first assistant message calls `bash` and has no text.
The second has this text: ``The output of `echo hello` is: `hello` ``.
