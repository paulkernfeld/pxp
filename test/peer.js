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

function createPeers (cb) {
  var streams = createStreams()
  var peers = [
    Peer(streams[0], [ 'test', '1' ]),
    Peer(streams[1], [ 'test', '2' ])
  ]
  var maybeDone = () => {
    if (peers[0].ready && peers[1].ready) cb(null, peers)
  }
  peers[0].once('ready', maybeDone)
  peers[1].once('ready', maybeDone)
}

function isDuplex (stream) {
  return typeof stream === 'object' &&
    typeof stream.pipe === 'function' &&
    typeof stream.write === 'function' &&
    typeof stream.read === 'function'
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

  t.test('normal handshake', function (t) {
    t.plan(7)
    var streams = createStreams()
    var peer = Peer(streams[0], [ 'foo' ])
    var peer2 = createMockPeer(streams[1])
    peer2.once('hello', function ([ version, connectInfo, networks ]) {
      t.pass('peer sent "hello" message')
      t.equal(version, 1, 'correct version')
      t.equal(connectInfo, null, 'null connectInfo')
      t.deepEqual(networks, [ 'foo' ], 'correct networks')
    })
    peer.once('ready', function () {
      t.pass('handshake successful')
      t.notOk(peer.getConnectInfo(), 'empty connectInfo')
      t.equal(peer.isAccepting(), false, 'peer not accepting incoming connections')
    })
    peer2.send('hello', 1, null, [ 'foo' ])
  })

  t.end()
})

test('connect', function (t) {
  t.test('connect on locally unsupported network', function (t) {
    createPeers(function (err, peers) {
      t.error(err, 'no error')
      peers[0].connect('2', function (err, stream) {
        t.ok(err, 'got error')
        t.equal(err.message, 'Peer tried to connect for unsupported network "2"', 'correct error message')
        t.end()
      })
    })
  })

  t.test('connect on remote unsupported network', function (t) {
    createPeers(function (err, peers) {
      t.error(err, 'no error')
      peers[0].connect('1', function (err, stream) {
        t.ok(err, 'got error')
        t.equal(err.message, 'Peer tried to connect for unsupported network "1"', 'correct error message')
        t.end()
      })
    })
  })

  t.test('connect on duplicate network', function (t) {
    createPeers(function (err, peers) {
      t.error(err, 'no error')
      peers[0].connect('test', function (err, stream) {
        t.error(err, 'no error')
        t.ok(stream, 'got stream')
        peers[0].connect('test', function (err, stream) {
          t.ok(err, 'got error')
          t.equal(err.message, 'Already connected for network "test"', 'correct error message')
          t.end()
        })
      })
    })
  })

  t.test('connect on duplicate network', function (t) {
    t.plan(7)
    createPeers(function (err, peers) {
      t.error(err, 'no error')
      peers[0].connect('test', function (err, stream) {
        t.error(err, 'no error')
        t.ok(stream, 'got stream')
        peers[1].once('error', function (err) {
          t.pass('receiving peer emitted error')
          t.equal(err.message, 'Peer tried to connect to network "test" twice', 'correct error message')
        })
        peers[0].pxp.send('connect', 'test', function (err) {
          t.ok(err, 'got error')
          t.equal(err, 'Peer tried to connect to network "test" twice', 'correct error message')
        })
      })
    })
  })

  t.test('normal connect', function (t) {
    t.plan(11)
    createPeers(function (err, peers) {
      t.error(err, 'no error')
      peers[1].once('connect:test', function (stream) {
        t.pass('peer emitted connect:<network> event')
        t.ok(stream, 'got stream')
        t.ok(isDuplex(stream), 'stream is duplex stream')
        stream.write('foo')
        stream.once('data', function (data) {
          t.pass('got stream data')
          t.equal(data.toString(), 'bar', 'correct data')
        })
      })
      peers[0].connect('test', function (err, stream) {
        t.error(err, 'no error')
        t.ok(stream, 'got stream')
        t.ok(isDuplex(stream), 'stream is a duplex stream')
        stream.write('bar')
        stream.once('data', function (data) {
          t.pass('got stream data')
          t.equal(data.toString(), 'foo', 'correct data')
        })
      })
    })
  })

  t.end()
})
