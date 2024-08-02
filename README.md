# (WIP) Slab Hunter

Hunt down Buffer slabs which are retaining more memory than they should.

Warning: this is a debugging tool, do not use it in production code.

It detects two behaviours indicative of a leak:
- Large buffers which are long-lived
- Long-lived buffers which are part of a large slab
