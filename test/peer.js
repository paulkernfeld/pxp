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

function createPeers (getPeers, cb) {
  if (!cb) {
    cb = getPeers
    getPeers = function (cb) { cb(new Error('Not implemented')) }
  }
  var streams = createStreams()
  var connectInfo = { pxp: true, relay: true, webrtc: true }
  var peers = [
    Peer(streams[0], { test: getPeers, '1': getPeers }, connectInfo),
    Peer(streams[1], { test: getPeers, '2': getPeers }, connectInfo)
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

function noopGetPeers (cb) {
  cb(new Error('Noop'))
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
      t.equal(err.message, 'must specify supported networks', 'correct error message')
      t.end()
    }
  })

  t.test('create with empty networks list', function (t) {
    var stream = createStreams()[0]
    try {
      var peer = Peer(stream, {})
      t.notOk(peer, 'should have thrown')
    } catch (err) {
      t.ok(err, 'error thrown')
      t.equal(err.message, 'must specify supported networks', 'correct error message')
      t.end()
    }
  })

  t.test('create with empty connectInfo', function (t) {
    var stream = createStreams()[0]
    var peer = Peer(stream, { foo: true })
    t.ok(peer instanceof Peer, 'created Peer instance')
    t.equal(peer.selfIsAccepting(), false, 'peer is not accepting connections')
    t.end()
  })

  t.test('create with connectInfo', function (t) {
    var stream = createStreams()[0]
    var peer = Peer(stream, { foo: noopGetPeers }, { pxp: true })
    t.ok(peer instanceof Peer, 'created Peer instance')
    t.equal(peer.selfIsAccepting(), true, 'peer is accepting connections')
    t.end()
  })

  t.end()
})

test('handshake', function (t) {
  t.test('different versions', function (t) {
    var streams = createStreams()
    var peer = Peer(streams[0], { foo: noopGetPeers })
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
    var peer = Peer(streams[0], { foo: noopGetPeers })
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
    var peer = Peer(streams[0], { foo: noopGetPeers })
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
    var peer = Peer(streams[0], { foo: noopGetPeers })
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

test('getpeers', function (t) {
  t.test('getpeers with empty response', function (t) {
    t.plan(6)
    function getPeers (cb) {
      cb(null, [])
    }
    createPeers(getPeers, function (err, peers) {
      t.error(err, 'no error')
      peers[0].pxp.once('getpeers', function (network) {
        t.pass('peer 2 received "getpeers" request')
        t.equal(network, 'test', 'correct network')
      })
      peers[1].getPeers('test', function (err, peers) {
        t.error(err, 'no error')
        t.ok(Array.isArray(peers), 'got peers array')
        t.equal(peers.length, 0, 'no peers')
      })
    })
  })

  t.test('getpeers with invalid response type (local handler)', function (t) {
    function getPeers (cb) {
      cb(null, 123)
    }
    createPeers(getPeers, function (err, peers) {
      t.error(err, 'no error')
      peers[0].once('error', function (err) {
        t.pass('receiving peer emitted error event')
        t.equal(err.message, 'peers.filter is not a function',
          'correct error message')
        t.end()
      })
      peers[1].getPeers('test', function () {})
    })
  })

  t.test('getpeers with invalid response type (remote handler)', function (t) {
    var streams = createStreams()
    var peer = Peer(streams[0], { foo: noopGetPeers })
    var badPeer = createMockPeer(streams[1])
    badPeer.on('getpeers', function (network, res) {
      t.pass('received getpeers request')
      res(null, 123)
    })
    peer.getPeers('foo', function (err) {
      t.ok(err, 'got error')
      t.equal(err.message, 'Peer sent invalid response to "getpeers"', 'correct error message')
      t.end()
    })
  })

  t.test('getpeers with invalid peer type (local handler)', function (t) {
    function getPeers (cb) {
      cb(null, [ 1, 2, 3 ])
    }
    createPeers(getPeers, function (err, peers) {
      t.error(err, 'no error')
      peers[0].once('error', function (err) {
        t.ok(err, 'peer emitted error event')
        t.equal(err.message, 'Invalid peer object, must be a Peer instance or a function', 'correct error message')
        t.end()
      })
      peers[1].getPeers('test', function () {})
    })
  })

  t.test('getpeers with invalid peer type (remote handler)', function (t) {
    var streams = createStreams()
    var peer = Peer(streams[0], { foo: noopGetPeers })
    var badPeer = createMockPeer(streams[1])
    badPeer.on('getpeers', function (network, res) {
      t.pass('received getpeers request')
      res(null, [ 1, 2, 3 ])
    })
    peer.getPeers('foo', function (err) {
      t.ok(err, 'got error')
      t.equal(err.message, 'Peer sent invalid candidate peer', 'correct error message')
      t.end()
    })
  })

  t.test('simple getPeers', function (t) {
    createPeers(function (err, peers) {
      t.error(err, 'no error')
      function getPeers (cb) {
        cb(null, [ peers[0] ])
      }
      createPeers(getPeers, function (err, peers) {
        t.error(err, 'no error')
        peers[1].getPeers('test', function (err, peers) {
          t.error(err, 'no error')
          t.ok(Array.isArray(peers), 'got peers array')
          t.equal(peers.length, 1, 'peers.length === 1')
          t.equal(typeof peers[0].id, 'string', 'peer has id')
          t.deepEqual(peers[0].connectInfo, {
            pxp: true,
            relay: true,
            webrtc: true
          }, 'correct connectInfo')
          t.end()
        })
      })
    })
  })

  t.test('getPeers with duplex stream', function (t) {
    var streams = createStreams()
    function getPeers (cb) {
      cb(null, [ streams[0] ])
    }
    createPeers(getPeers, function (err, peers) {
      t.error(err, 'no error')
      peers[1].getPeers('test', function (err, peers) {
        t.error(err, 'no error')
        t.ok(Array.isArray(peers), 'got peers array')
        t.equal(peers.length, 1, 'peers.length === 1')
        t.equal(typeof peers[0].id, 'string', 'peer has id')
        t.deepEqual(peers[0].connectInfo, { relay: true, pxp: false }, 'correct connectInfo')
        t.end()
      })
    })
  })

  t.end()
})

test('relay', function (t) {
  t.test('relay to simple peer candidate', function (t) {
    t.plan(11)
    createPeers(function (err, peers1) {
      t.error(err, 'no error')
      function getPeers (cb) {
        cb(null, [ peers1[0] ])
      }
      createPeers(getPeers, function (err, peers2) {
        t.error(err, 'no error')
        peers2[1].getPeers('test', function (err, candidates) {
          t.error(err, 'no error')
          t.ok(Array.isArray(candidates), 'got candidates array')
          t.ok(candidates.length === 1, '1 candidate')
          peers1[1].on('incoming', function (stream) {
            t.pass('remote peer emitted "incoming" event')
            t.ok(isDuplex(stream), 'got duplex stream')
            stream.on('data', function (data) {
              t.equal(data.toString(), 'foo', 'correct stream data')
            })
            stream.write('bar')
          })
          peers2[1].relay(candidates[0], function (err, stream) {
            t.error(err, 'no error')
            t.ok(isDuplex(stream), 'got duplex stream')
            stream.on('data', function (data) {
              t.equal(data.toString(), 'bar', 'correct stream data')
            })
            stream.write('foo')
          })
        })
      })
    })
  })

  t.test('relay to function peer candidate', function (t) {
    t.plan(9)
    var streams
    function getPeers (cb) {
      streams = createStreams()
      cb(null, [ function (cb) { cb(null, streams[0]) } ])
    }
    createPeers(getPeers, function (err, peers) {
      t.error(err, 'no error')
      peers[1].getPeers('test', function (err, candidates) {
        t.error(err, 'no error')
        t.ok(Array.isArray(candidates), 'got candidates array')
        t.ok(candidates.length === 1, '1 candidate')
        streams[1].on('data', function (data) {
          t.pass('stream got data')
          t.equal(data.toString(), '456', 'correct stream data (456)')
        })
        streams[1].write('123')
        peers[1].relay(candidates[0], function (err, stream) {
          t.error(err, 'no error')
          t.ok(isDuplex(stream), 'got duplex stream')
          stream.on('data', function (data) {
            t.equal(data.toString(), '123', 'correct stream data (123)')
          })
          stream.write('456')
        })
      })
    })
  })

  t.end()
})
