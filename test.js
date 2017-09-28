const EventEmitter = require('events').EventEmitter
const a = new EventEmitter()

function test() {
  return a.on('test', function () {

  })
}

console.log(test())