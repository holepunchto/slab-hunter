const path = require('path')
const setupSlabHunter = require('./')

if (!process.argv[2]) {
  console.error('Usage: slab-hunter <entrypoint> (for example: slab-hunter index.js)')
  process.exit(1)
}
const entryPoint = path.resolve(process.argv[2])
const logInterval = parseInt(process.argv[3] || 1000 * 60 * 2)

console.log(`Setting up slab hunter for entrypoint ${entryPoint}`)
console.log(`Printing leak info every ${logInterval / 1000} seconds`)

const getLeakStats = setupSlabHunter()
setInterval(() => {
  console.log(getLeakStats().toString())
}, logInterval)

require(entryPoint)
