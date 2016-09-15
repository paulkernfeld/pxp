var test = require('tape')
var PassThrough = require('stream').PassThrough
var duplexify = require('duplexify')
var PXP = require('../lib/pxp.js')

function createStreams () {
  var pt1 = new PassThrough()
  var pt2 = new PassThrough()
  return [
    duplexify(pt1, pt2),
    duplexify(pt2, pt1)
  ]
}

var streams, pxp
test('create encoder/decoder', function (t) {
  streams = createStreams()
  pxp = [ PXP(streams[0]), PXP(streams[1]) ]
  t.ok(pxp[0] instanceof PXP, 'created PXP instance')
  t.ok(pxp[1] instanceof PXP, 'created PXP instance')
  t.end()
})

test('simple send/receive', function (t) {
  pxp[1].once('hello', function (arg) {
    t.pass('received "hello" message')
    t.deepEqual(arg, { foo: true }, 'got correct data')
    t.end()
  })
  pxp[0].send('hello', { foo: true })
})

test('send with multiple args', function (t) {
  pxp[1].once('hello', function (args) {
    t.pass('received "hello" message')
    t.deepEqual(args, [ 1, 2, 3 ], 'correct first arg')
    t.end()
  })
  pxp[0].send('hello', 1, 2, 3)
})

test('req/res', function (t) {
  pxp[1].once('getpeers', function (arg, res) {
    t.pass('received "getpeers" message')
    t.deepEqual(arg, { foo: true }, 'got correct data')
    res({ bar: false })
  })
  pxp[0].send('getpeers', { foo: true }, function (arg) {
    t.pass('received response')
    t.deepEqual(arg, { bar: false }, 'got correct data')
    t.end()
  })
})

test('invalid messages', function (t) {
  t.test('incorrect frame type', function (t) {
    pxp[0].once('error', function (err) {
      t.ok(err, 'error emitted')
      t.equal(err.message, 'Peer sent invalid PXP message', 'correct error message')
      t.end()
    })
    pxp[1].stream.write(123)
  })

  t.test('incorrect frame length', function (t) {
    pxp[0].once('error', function (err) {
      t.ok(err, 'error emitted')
      t.equal(err.message, 'Peer sent invalid PXP message', 'correct error message')
      t.end()
    })
    pxp[1].stream.write([ 1, 2 ])
  })

  t.test('invalid command', function (t) {
    pxp[0].once('error', function (err) {
      t.ok(err, 'error emitted')
      t.equal(err.message, 'Peer sent unknown PXP message: "notacommand"', 'correct error message')
      t.end()
    })
    pxp[1].stream.write([ 'notacommand', 0, true ])
  })

  t.end()
})
