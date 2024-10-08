# Slab Hunter

Hunt down Buffer slabs which are retaining more memory than they should.

Warning: this is a debugging tool, do not use it in production code.

It detects two behaviours indicative of potential memory leaks:
- Slab retainers: long-lived buffers which are part of a slab.
    - A typical leak here is caused by using `Buffer.allocUnsafe()` or `Buffer.from()` for long-lived buffers.
    - The solution is to [unslab](https://github.com/holepunchto/unslab) the buffers, or to use `b4a.allocUnsafeSlow()` instead.
- Big buffers which are long-lived
    - A typical leak here is data being loaded from a networked stream or file-system stream, where the data of a single data-event is all loaded on a shared slab, and some long-lived data is defined using `Buffer.subarray()` or similar, which does not copy out the data.
    - The solution for such a leak is to take a heap snapshot, based on which you can figure out which buffers are retaining the overall slab, and to explicitly [unslab](https://github.com/holepunchto/unslab) those.
    - Note: susceptible to false positives (there can be good reasons to have large buffers)

Note: this tool works by monkey-patching `Buffer.allocUnsafe` to keep track of the state of every non-garbage-collected buffer, so memory usage and CPU will be higher than for a normal run.

## Usage

### CLI

```
npm i -g slab-hunter
slab-hunter <entrypoint>
```

Where `<entrypoint>` is the entrypoint of the program you wish to test. 

For example:
```
slab-hunter index.js
```

Information about the potential leaks will be logged every 2 minutes.

### Programmatic

```
const setupSlabHunter = require('slab-hunter')

const getLeakStats = setupSlabHunter()
setInterval(() => {
  console.log(getLeakStats())
}, 1000 * 60 * 2)
```

### Example Output

```
Big buffer potential leaks:
1 leaks of big buffers of avg size 8.4 MB (total: 8.4 MB) at Object.allocUnsafe (.../node_modules/b4a/index.js:14:17)
    at NoiseSecretStream._onrawdata (.../node_modules/@hyperswarm/secret-stream/index.js:254:33)
    at UDXStream.emit (node:events:513:28)
    at UDXStream.emit (node:domain:489:12)
    at ReadableState.drain (.../node_modules/streamx/index.js:351:64)
    at ReadableState.update (.../node_modules/streamx/index.js:361:12)
    at ReadableState.updateReadNT (.../node_modules/streamx/index.js:543:10)
    at process.processTicksAndRejections (node:internal/process/task_queues:77:11)

...

Slab retainers potential leaks:
2013 leaks of avg 8.1 kB (total: 1.6 MB normalised against retainers) at Object.allocUnsafe (.../node_modules/b4a/index.js:14:17)
    at UDXStream._allocWrite (.../node_modules/udx-native/lib/stream.js:430:26)
    at UDXStream._writev (.../node_modules/udx-native/lib/stream.js:273:23)
    at WritableState.autoBatch (.../node_modules/streamx/index.js:175:12)
    at UDXStream._write (.../node_modules/streamx/index.js:947:25)
    at WritableState.update (.../node_modules/streamx/index.js:187:16)
    at WritableState.updateWriteNT (.../node_modules/streamx/index.js:550:10)
    at process.processTicksAndRejections (node:internal/process/task_queues:77:11)

...

Total potential big buffer leaks: 10.7 MB
Total potential slab-retainer leaks: 3.7 MB

```

## API

### `const getLeakStats = setupSlabHunter(msLeakCutoff=1000*60, bigBufferCutoff=4000)`

Returns a function to get the current potential leaks.

`msLeakCutoff` is the amount of milliseconds until a buffer is tagged as potentially leaking (meaning it will be included in the analysis).

`bigBufferCutoff` is the amount of bytes from which point onwards a buffer is included in the 'big-buffer analysis'.

`getLeakStats` is a function which returns a `LeakOverview` object. The object can be printed to see a complete overview, but can also be accessed programatically.

Note: the total size of a slab-retainer leak is calculated by normalising each leak against the amount of other retainers for that slab (their `normalisedTotalLeakedBytes` value). So if a single 8kb slab is retained by 10 small buffers, each of those will report around 800 bytes leaked.

### `leakOverview.bigBufferLeaks`

Returns a list of big-buffer leaks. Each entry is an object:
```
{
  location, // The stack trace where the leaking buffer was created (this is the unique key for this leak)
  amount, // the amount of leaks created at the location
  totalLeakedBytes // the total amount of leaked bytes (summed across all its ocurrences)
}
```

### `leakOverview.slabLeaks`

Returns a list of slab leaks. Each entry is an object:

```
{
  location, // The stack trace where the leaking buffer was created (this is the unique key for this leak)
  amount, // the amount of leaks created at the location
  totalLeakedBytes // the total size of the leak (summed across all its ocurrences).
  normalisedTotalLeakedBytes // the total size of the leak (summed across all its ocurrences), normalised against the amount of other retainers of the slabs
}
```
