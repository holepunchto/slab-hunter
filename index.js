const byteSize = require('byte-size')

const DEFAULT_BIG_BUFFER_CUTOFF = 4000
const DEFAULT_MS_LEAK_CUTOFF = 1000 * 60

function monkeyPatchBuffer (msLeakCutoff, bigBufferCutoff) {
  let bufCounter = 0
  const bufMap = new Map()
  const slabToKeys = new Map()
  const keyToSlab = new Map()
  const leakCounters = new Map()

  const registry = new FinalizationRegistry((key) => {
    const slab = keyToSlab.get(key)
    keyToSlab.delete(key)

    const slabKeys = slabToKeys.get(slab)
    slabKeys.delete(key)
    if (slabKeys.size === 0) {
      slabToKeys.delete(slab)
    }

    clearTimeout(bufMap.get(key))
    bufMap.delete(key)
  })

  const originalAllocUnsafe = Buffer.allocUnsafe

  Buffer.allocUnsafe = function allocUnsafeMonkeyPatch (...args) {
    const res = originalAllocUnsafe(...args)

    const isBigBuffer = res.byteLength >= bigBufferCutoff
    const isPotentialSlabRetainer = res.buffer.byteLength >= 10 * res.byteLength // Note: pretty ad-hoc cut-off
    if (isBigBuffer || isPotentialSlabRetainer) {
      const trace = (new Error()).stack
      const key = bufCounter++
      const slab = res.buffer

      keyToSlab.set(key, slab)
      let slabKeys = slabToKeys.get(slab)
      if (!slabKeys) {
        slabKeys = new Set()
        slabToKeys.set(slab, slabKeys)
      }
      slabKeys.add(key)

      const bufferLength = res.byteLength
      const arrayBufferLength = res.buffer.byteLength

      const timeout = setTimeout(() => {
        const location = trace.split('\n').slice(2).join('\n')
        let current = leakCounters.get(location)
        if (current === undefined) {
          current = {
            keys: [],
            bufferLengths: [],
            arrayBufferLengths: []
          }
          leakCounters.set(location, current)
        }
        current.keys.push(key)
        current.bufferLengths.push(bufferLength)
        current.arrayBufferLengths.push(arrayBufferLength) // TODO: can be removed I think (we store the slab itself)
        bufMap.delete(key)
      }, msLeakCutoff)
      bufMap.set(key, timeout)
      registry.register(res, key)
    }
    return res
  }

  return { leakCounters, keyToSlab, slabToKeys }
}

function getLeakOverview ({ leakCounters, keyToSlab, slabToKeys }) {
  const slabLeaks = []
  const bigBufferLeaks = []
  for (const [location, { keys, bufferLengths, arrayBufferLengths }] of leakCounters.entries()) {
    let amount = 0
    let normalisedTotalLeakedBytes = 0
    let totalLeakedBytes = 0

    let bigBuffersAmount = 0
    let bigBuffersTotalLeakedBytes = 0

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]

      const slab = keyToSlab.get(key)
      if (!slab) continue // Already cleaned up (TODO: cleanly)

      const totalSlab = arrayBufferLengths[i]
      const ownSize = bufferLengths[i]
      const slabLeak = totalSlab - ownSize

      if (ownSize >= DEFAULT_BIG_BUFFER_CUTOFF) {
        bigBuffersAmount++
        bigBuffersTotalLeakedBytes += ownSize
      }
      if (slabLeak > 0) {
        amount++
        totalLeakedBytes += slabLeak
        const totalRetainers = slabToKeys.get(slab).size
        normalisedTotalLeakedBytes += slabLeak / totalRetainers
      }
    }

    if (amount > 0) {
      slabLeaks.push({
        location, normalisedTotalLeakedBytes, amount, totalLeakedBytes
      })
    }

    if (bigBuffersAmount > 0) {
      bigBufferLeaks.push({ amount: bigBuffersAmount, totalLeakedBytes: bigBuffersTotalLeakedBytes, location })
    }
  }

  slabLeaks.sort((e1, e2) => e1.normalisedTotalLeakedBytes < e2.normalisedTotalLeakedBytes ? 1 : e1.normalisedTotalLeakedBytes > e2.normalisedTotalLeakedBytes ? -1 : 0)
  bigBufferLeaks.sort((e1, e2) => e1.totalLeakedBytes < e2.totalLeakedBytes ? 1 : e1.totalLeakedBytes > e2.totalLeakedBytes ? -1 : 0)

  return new LeakOverview(bigBufferLeaks, slabLeaks)
}

class LeakOverview {
  constructor (bigBufferLeaks, slabLeaks) {
    this.bigBufferLeaks = bigBufferLeaks
    this.slabLeaks = slabLeaks
  }

  get totalSlabLeaks () {
    let res = 0
    for (const { normalisedTotalLeakedBytes } of this.slabLeaks) {
      res += normalisedTotalLeakedBytes // todo: put in analysis
    }

    return res
  }

  get totalBigBufferLeaks () {
    let res = 0
    for (const { totalLeakedBytes } of this.bigBufferLeaks) {
      res += totalLeakedBytes
    }

    return res
  }

  get bigBufferOverview () {
    let res = 'Big buffer potential leaks:\n'
    for (const { amount, location, totalLeakedBytes } of this.bigBufferLeaks) {
      res += `${amount} leaks of big buffers of avg size ${byteSize(totalLeakedBytes / amount)} (total: ${byteSize(totalLeakedBytes)}) ${location}\n`
    }

    return res
  }

  get slabOverview () {
    let res = 'Slab retainers potential leaks:\n'
    for (const { amount, normalisedTotalLeakedBytes, totalLeakedBytes, location } of this.slabLeaks) {
      res += `${amount} leaks of avg ${byteSize(totalLeakedBytes / amount)} (total: ${byteSize(normalisedTotalLeakedBytes)} normalised against retainers) ${location}\n`
    }

    return res
  }

  toString () {
    return [
      this.bigBufferOverview,
      this.slabOverview,
      `Total potential big buffer leaks: ${byteSize(this.totalBigBufferLeaks)}`,
      `Total potential slab-retainer leaks: ${byteSize(this.totalSlabLeaks)}`
    ].join('\n')
  }

  [Symbol.for('nodejs.util.inspect.custom')] () {
    return this.toString()
  }
}

function setupSlabHunter (msLeakCutoff = DEFAULT_MS_LEAK_CUTOFF, bigBufferCutoff = DEFAULT_BIG_BUFFER_CUTOFF) {
  const { leakCounters, keyToSlab, slabToKeys } = monkeyPatchBuffer(msLeakCutoff, bigBufferCutoff)

  return () => {
    return getLeakOverview({ leakCounters, keyToSlab, slabToKeys })
  }
}

module.exports = setupSlabHunter
