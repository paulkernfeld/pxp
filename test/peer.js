var test = require('tape')
var PassThrough = require('stream').PassThrough
var duplexify = require('duplexify')
var Mux = require('multiplex')
var Peer = require('../')
var PXP = require('../lib/pxp.js')

function createStreams () {
  var pt1 = new PassThrough()
  var pt2 = new PassThrough()
  return [
    duplexify(pt1, pt2),
    duplexify(pt2, pt1)
  ]
}

function createMockPeer (stream) {
  var mux = Mux()
  stream.pipe(mux).pipe(stream)
  var pxpStream = mux.createSharedStream('pxp')
  return PXP(pxpStream)
}

test('create peer instances', function (t) {
  t.test('create with invalid stream', function (t) {
    try {
      var peer = Peer({})
      t.notOk(peer, 'should have thrown')
    } catch (err) {
      t.ok(err, 'error thrown')
      t.equal(err.message, 'socket must be a duplex stream', 'correct error message')
      t.end()
    }
  })

  t.test('create with invalid networks list', function (t) {
    var stream = createStreams()[0]
    try {
      var peer = Peer(stream, 123)
      t.notOk(peer, 'should have thrown')
    } catch (err) {
      t.ok(err, 'error thrown')
      t.equal(err.message, 'must specify an array of supported networks', 'correct error message')
      t.end()
    }
  })

  t.test('create with empty networks list', function (t) {
    var stream = createStreams()[0]
    try {
      var peer = Peer(stream, [])
      t.notOk(peer, 'should have thrown')
    } catch (err) {
      t.ok(err, 'error thrown')
      t.equal(err.message, 'must specify an array of supported networks', 'correct error message')
      t.end()
    }
  })

  t.test('create with empty connectInfo', function (t) {
    var stream = createStreams()[0]
    var peer = Peer(stream, [ 'foo' ])
    t.ok(peer instanceof Peer, 'created Peer instance')
    t.equal(peer.selfIsAccepting(), false, 'peer is not accepting connections')
    t.end()
  })

  t.test('create with connectInfo', function (t) {
    var stream = createStreams()[0]
    var peer = Peer(stream, [ 'foo' ], { webrtc: true })
    t.ok(peer instanceof Peer, 'created Peer instance')
    t.equal(peer.selfIsAccepting(), true, 'peer is accepting connections')
    t.end()
  })

  t.end()
})

test('handshake', function (t) {
  t.test('different versions', function (t) {
    var streams = createStreams()
    var peer = Peer(streams[0], [ 'foo' ])
    var badPeer = createMockPeer(streams[1])
    peer.once('error', function (err) {
      t.ok(err, 'got error event')
      t.equal(err.message, 'Peer has an invalid protocol version.theirs=0, ours=1', 'correct error message')
      t.end()
    })
    badPeer.send('hello', 0, null, [ 'foo' ])
  })

  t.test('invalid networks list', function (t) {
    var streams = createStreams()
    var peer = Peer(streams[0], [ 'foo' ])
    var badPeer = createMockPeer(streams[1])
    peer.once('error', function (err) {
      t.ok(err, 'got error event')
      t.equal(err.message, 'networks.filter is not a function', 'correct error message')
      t.end()
    })
    badPeer.send('hello', 1, null, true)
  })

  t.test('no networks in common', function (t) {
    var streams = createStreams()
    var peer = Peer(streams[0], [ 'foo' ])
    var badPeer = createMockPeer(streams[1])
    peer.once('error', function (err) {
      t.ok(err, 'got error event')
      t.equal(err.message, 'Peer does not have any networks in common.', 'correct error message')
      t.end()
    })
    badPeer.send('hello', 1, null, [ 'bar' ])
  })

  t.end()
})
