'use strict'

const EventEmitter = require('events')
const old = require('old')
const mux = require('multiplex')
const random = require('hat')
const onObject = require('on-object')
const pxp = require('./pxp.js')

const PROTOCOL_VERSION = 1
const CANDIDATE_TIMEOUT = 15 * 1000

function isDuplex (stream) {
  return typeof stream === 'object' &&
    typeof stream.pipe === 'function' &&
    typeof stream.write === 'function' &&
    typeof stream.read === 'function'
}

class Peer extends EventEmitter {
  constructor (socket, networks, connectInfo, opts = {}) {
    if (!isDuplex(socket)) {
      throw new Error('socket must be a duplex stream')
    }
    if (!networks || Object.keys(networks).length === 0) {
      throw new Error('must specify supported networks')
    }
    super()

    this.error = this.error.bind(this)
    this.onHello = this.wrapTryCatch(this.onHello)
    this.onGetPeers = this.wrapTryCatch(this.onGetPeers)
    // TODO: wrap other handler methods

    this.connectInfo = connectInfo
    this.networks = networks
    this.candidates = {}
    this.closed = false
    this.ready = false
    this.connected = {}
    this.remoteNetworks = null
    this.remoteConnectInfo = null
    this.relayed = opts.relayed

    this.socket = socket
    onObject(socket).on({
      error: this.error,
      close: this.close.bind(this),
      disconnect: this.close.bind(this)
    })

    this.mux = mux()
    socket.pipe(this.mux).pipe(socket)

    this.pxp = pxp(this.createStream('pxp'))
    this.pxp.once('hello', this.onHello.bind(this))
    this.sendHello()
  }

  wrapTryCatch (f) {
    return function (...args) {
      try {
        f.call(this, ...args)
      } catch (err) {
        this.emit('error', err)
      }
    }.bind(this)
  }

  onceReady (f) {
    if (this.ready) return f()
    this.once('ready', f)
  }

  selfIsAccepting () {
    return !!this.connectInfo
  }

  isAccepting () {
    return !!this.remoteConnectInfo
  }

  error (err) {
    this.emit('error', err)
    this.close()
  }

  close () {
    if (this.closed) return
    this.closed = true
    this.emit('disconnect')
    this.socket.end()
  }

  createStream (id) {
    var stream = this.mux.createSharedStream(id)
    stream.on('error', this.error)
    return stream
  }

  getConnectInfo () {
    return this.remoteConnectInfo
  }

  sendHello () {
    this.pxp.send('hello',
      PROTOCOL_VERSION,
      this.connectInfo,
      Object.keys(this.networks)
    )
  }

  onHello ([ version, connectInfo, networks ]) {
    if (version !== PROTOCOL_VERSION) {
      let err = new Error('Peer has an invalid protocol version.' +
        `theirs=${version}, ours=${PROTOCOL_VERSION}`)
      return this.error(err)
    }

    var commonNetworks = networks.filter(
      (n) => Object.keys(this.networks).indexOf(n) !== -1)
    if (commonNetworks.length === 0) {
      let err = new Error('Peer does not have any networks in common.')
      return this.error(err)
    }

    this.remoteNetworks = networks
    this.remoteConnectInfo = connectInfo
    onObject(this.pxp).on({
      getpeers: this.onGetPeers.bind(this),
      relay: this.onRelay.bind(this),
      upgrade: this.onUpgrade.bind(this),
      connect: this.onConnect.bind(this)
    })
    if (this.selfIsAccepting()) {
      this.pxp.on('incoming', this.onIncoming.bind(this))
    }
    this.ready = true
    this.emit('ready')
  }

  onGetPeers (network, res) {
    if (!this.networks[network]) {
      let err = new Error('Peer requested an unknown network:' +
          `"${network}"`)
      res([ err.message ])
      return this.error(err)
    }
    var getPeers = this.networks[network]
    if (typeof getPeers !== 'function') {
      var err = new Error(`Invalid getPeers function for network "${network}"`)
      return this.error(err)
    }
    getPeers.call(this, (err, peers) => {
      if (err) {
        res([ true ])
        return this.error(err)
      }
      peers = peers.filter((p) => p !== this)
      var peerInfo = []
      for (let peer of peers) {
        var id = this.addCandidate(peer)
        var connectInfo
        if (peer instanceof Peer) {
          connectInfo = peer.getConnectInfo()
        } else if (typeof peer === 'function' || isDuplex(peer)) {
          connectInfo = peer.getConnectInfo ? peer.getConnectInfo() : {
            relay: true,
            pxp: false
          }
        } else {
          let err = new Error('Invalid peer object, must be a Peer instance or a function')
          return this.emit('error', err)
        }
        peerInfo.push({ id, network, connectInfo })
      }
      res(null, peerInfo)
    })
  }

  addCandidate (peer) {
    var id = random(32)
    this.candidates[id] = peer
    var timer = setTimeout(
      () => delete this.candidates[id],
      CANDIDATE_TIMEOUT)
    if (timer.unref) timer.unref()
    // TODO: cleanup timeouts on peer close
    return id
  }

  onRelay ([ to ], res) {
    // TODO: rate limiting
    // TODO: ensure there isn't already a relay to this destination
    var sourceStream = this.createStream(`relay:${to}`)
    var dest = this.candidates[to]
    if (!dest) {
      let err = new Error(`Peer requested unknown candidate: id=${to}`)
      res(err.message)
      return this.error(err)
    }
    var connectRelay = (destStream) => {
      sourceStream.pipe(destStream).pipe(sourceStream)
      sourceStream.once('end', () => destStream.end())
      destStream.once('end', () => sourceStream.end())
      res(null)
    }
    if (dest instanceof Peer) {
      let id = random(32)
      dest.pxp.send('incoming', [ id ], () => {
        var destStream = dest.createStream(`relay:${id}`)
        connectRelay(destStream)
      })
    } else if (typeof dest === 'function') {
      dest.call(this, (err, stream) => {
        if (err) return this.error(err)
        if (!isDuplex(stream)) {
          let err = new Error('Candidate function must pass (err, stream) to callback')
          return this.error(err)
        }
        connectRelay(stream)
      })
    }
  }

  onIncoming ([ id ], res) {
    var stream = this.createStream(`relay:${id}`)
    res(null)
    this.emit('incoming', stream)
  }

  onUpgrade (req, res) {
    this.emit('upgrade', req, res)
  }

  onConnect (network, res) {
    if (this.connected[network]) {
      var err = new Error('Peer tried to connect to network ' +
        `"${network}" twice`)
      res(err.message)
      return this.error(err)
    }
    var stream = this.createDataStream(network, res)
    this.emit(`connect:${network}`, stream)
    res(null)
  }

  createDataStream (network) {
    this.connected[network] = true
    var stream = this.createStream(`data:${network}`)
    stream.once('end', () => delete this.connected[network])
    return stream
  }

  connect (network, cb) {
    if (Object.keys(this.networks).indexOf(network) === -1 ||
    this.remoteNetworks.indexOf(network) === -1) {
      let err = new Error(`Peer tried to connect for unsupported network "${network}"`)
      return cb(err)
    }
    if (this.connected[network]) {
      let err = new Error(`Already connected for network "${network}"`)
      return cb(err)
    }
    var stream = this.createDataStream(network)
    this.pxp.send('connect', network, (err) => {
      if (err) return cb(new Error(err))
      cb(null, stream)
    })
  }

  getPeers (network, cb) {
    this.pxp.send('getpeers', network, ([ err, peers ]) => {
      if (err) return cb(new Error(err))
      if (!Array.isArray(peers)) {
        let err = new Error('Peer sent invalid response to "getpeers"')
        return cb(err)
      }
      for (let peer of peers) {
        if (!peer.id || !peer.network) {
          let err = new Error('Peer sent invalid candidate peer')
          return cb(err)
        }
      }
      cb(null, peers)
    })
  }

  relay (candidate, cb) {
    this.pxp.send('relay', [ candidate.id ], (err) => {
      if (err) return cb(new Error(err))
      var relay = this.createStream(`relay:${candidate.id}`)
      cb(null, relay)
    })
  }

  upgrade (request, cb) {
    if (!this.relayed) {
      return cb(new Error('Can only upgrade relayed connections'))
    }
    this.pxp.send('upgrade', request, cb)
  }
}

module.exports = old(Peer)
