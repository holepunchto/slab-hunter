const test = require('brittle')
const setupSlabHunter = require('.')

test('slab leaks are detected', async (t) => {
  const leakCutoffMs = 0 // no delay to simplify test
  const getLeaks = setupSlabHunter(leakCutoffMs)

  {
    const leaks = getLeaks()
    t.is(leaks.bigBufferLeaks.length, 0, 'sanity check: no initial big-buffer leaks')
    t.is(leaks.slabLeaks.length, 0, 'sanity check: no initial slab leaks')
  }

  const retainedBuffers = []
  let nonRetainedBuffers = []
  for (let i = 0; i < 1000; i++) {
    // DEVNOTE: apparently storing a const inside the loop and storing it
    // conditionally retains the last instance of that const, also after the
    // for loop and a gc run. (curious why)
    // To simplify the test, we do not define any variables inside the for loop
    Buffer.allocUnsafe(100)
    if (i % 100 === 0) {
      retainedBuffers.push(Buffer.allocUnsafe(100))
    } else {
      nonRetainedBuffers.push(Buffer.allocUnsafe(100))
    }
  }

  nonRetainedBuffers = null // delete all refs
  t.is(retainedBuffers.length, 10, 'sanity check: 10 retained buffers')

  global.gc() // assumes node is run with --expose-gc flag
  await new Promise(resolve => setTimeout(resolve, 100))

  {
    const leaks = getLeaks()
    t.is(leaks.bigBufferLeaks.length, 0, 'no big-buffer leaks')
    t.is(leaks.slabLeaks.length, 1, 'slab leak detected')
    t.is(leaks.slabLeaks[0].amount, 10, 'all 10 leaks are detected')
  }
})

test.solo('big-buffer leaks are detected', async (t) => {
  const leakCutoffMs = 0 // no delay to simplify test
  const getLeaks = setupSlabHunter(leakCutoffMs)

  {
    const leaks = getLeaks()
    t.is(leaks.bigBufferLeaks.length, 0, 'sanity check: no initial big-buffer leaks')
    t.is(leaks.slabLeaks.length, 0, 'sanity check: no initial slab leaks')
  }

  const retainedBuffers = []
  let nonRetainedBuffers = []
  for (let i = 0; i < 1000; i++) {
    // DEVNOTE: apparently storing a const inside the loop and storing it
    // conditionally retains the last instance of that const, also after the
    // for loop and a gc run. (curious why)
    // To simplify the test, we do not define any variables inside the for loop
    Buffer.allocUnsafe(100)
    if (i % 100 === 0) {
      retainedBuffers.push(Buffer.allocUnsafe(10_000))
    } else {
      nonRetainedBuffers.push(Buffer.allocUnsafe(10_000))
    }
  }

  nonRetainedBuffers = null // delete all refs
  t.is(retainedBuffers.length, 10, 'sanity check: 10 retained buffers')

  global.gc() // assumes node is run with --expose-gc flag
  await new Promise(resolve => setTimeout(resolve, 100))

  {
    const leaks = getLeaks()
    t.is(leaks.bigBufferLeaks.length, 1, 'big-buffer leak detected')
    t.is(leaks.bigBufferLeaks[0].amount, 10, 'all 10 leaks are detected')
    t.is(leaks.slabLeaks.length, 0, 'no slab leaks detected')
  }
})
