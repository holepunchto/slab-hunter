# Slab Hunter

Hunt down Buffer slabs which are retaining more memory than they should.

Warning: this is a debugging tool, do not use it in production code.

It detects two behaviours indicative of potential memory leaks:
- Large buffers which are long-lived
    - A typical leak here is data being loaded from a networked stream or file-system stream, where the data of a single data-event is all loaded on a shared slab, and some long-lived data is defined using `Buffer.subarray()` or similar which does not copy out the data.
  - The solution for such a leak is to take a heap snapshot to figure out which buffers are retaining the overall slab, and to explicitly unslab those.
- Long-lived buffers which are part of a large slab.
    - A typical leak here is caused by using `b4a.allocUnsafe()` or `b4a.from()` for long-lived buffers. The solution is to use `b4a.allocUnsafeSlow()`

Note: this tool works by monkey-patching `Buffer.allocUnsafe` to keep track of the state of every non-garbage-collected buffer, so memory usage and CPU will be higher than for a normal run.

## Usage

```
const setupSlabHunter = require('./slab-hunter')

const getLeakStats = setupSlabHunter()
setInterval(() => {
  console.log(getLeakStats())
}, 1000 * 60 * 2)
```

## API

### const getLeakStats = huntSlabs(msLeakCutoff=1000*60, bigBufferCutoff=4000)

Returns a function to get the current potential leaks.

`msLeakCutoff` is the amount of milliseconds untiul a buffer is tagged as potentially leaking (and will be included in the analysis).

`bigBufferCutoff` is the amount of bytes from which point onwards a buffer is included in the 'big-buffer analysis'.
