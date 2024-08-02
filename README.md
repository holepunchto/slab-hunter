# Slab Hunter

Hunt down Buffer slabs which are retaining more memory than they should.

Warning: this is a debugging tool, do not use it in production code.

It detects two behaviours indicative of a memory leak:
- Large buffers which are long-lived
- Long-lived buffers which are part of a large slab

It works by monkey-patching `Buffer.allocUnsafe` to keep track of the state of every non-garbage-collected buffer, so memory usage and CPU will be higher than for a normal run.

## API

```
const huntSlabs = require('./slab-hunter')

const getLeakStats = huntSlabs()
setInterval(() => {
  console.log(getLeakStats())
}, 1000 * 60 * 2)
```
