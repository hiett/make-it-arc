# Arc Experiments

## What this project is
Mangling up modern TypeScript as much as possible to run in the experimental Arc runtime.
The arc source code exists in the arc/ directory.

- Always run `git pull` inside the `arc` directory before doing any work. Arc is updated very frequently by other agents.
- When making changes, always run `bun make-it-arc` to compile the file and get the output.
- Use this to iterate until it works.
- Each time you run `bun make-it-arc`, also show me the error in chat so I can keep up.
- If you hit an erlang/gleam error, then stop and let me know. That likely means I need to ask for runtime changes. You are not the agent to be doing that.