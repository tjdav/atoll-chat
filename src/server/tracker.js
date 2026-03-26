import { Server } from 'bittorrent-tracker'

const port = process.env.TRACKER_PORT || 8000

const server = new Server({
  udp: false, // only enable ws (webrtc tracker)
  http: false,
  ws: true,
  stats: true // update tracker stats
})

server.on('error', function (err) {
  // fatal server error!
  console.log(err.message)
})

server.on('warning', function (err) {
  // client sent bad data. probably not a problem, just a buggy client.
  console.log(err.message)
})

server.on('listening', function () {
  // fired when all requested servers are listening
  console.log('WebRTC Private Tracker listening on ws port ' + port)
})

// start tracker server listening! Use 0.0.0.0 to listen on all interfaces
server.listen(port, '0.0.0.0')
